import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AdminUser } from '../models/AdminUser.js';
import { Order, ORDER_STATUSES } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { ContactMessage } from '../models/ContactMessage.js';
import { Setting, getSettings } from '../models/Setting.js';
import { AuditLog, audit } from '../models/AuditLog.js';
import { asyncHandler, parse, HttpError, escapeRegex, slugify } from '../lib/http.js';
import { TRANSITIONS } from '../lib/orders.js';
import { releaseOrderStock } from '../lib/stock.js';
import { requireAdmin, allowRoles, setAdminSession, clearAdminSession } from '../middleware/auth.js';

const router = Router();

// ---------- Auth ----------

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });

router.post(
  '/auth/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }), req.body);
    const admin = await AdminUser.findOne({ email: body.email }).select('+passwordHash');
    const ok = admin && admin.isActive && (await bcrypt.compare(body.password, admin.passwordHash));
    if (!ok) throw new HttpError(401, 'Incorrect email or password.');
    admin.lastLoginAt = new Date();
    await admin.save();
    setAdminSession(res, admin);
    audit(admin.email, 'admin.login', 'admin', admin._id);
    res.json({ admin: { name: admin.name, email: admin.email, role: admin.role } });
  }),
);

router.post('/auth/logout', (_req, res) => {
  clearAdminSession(res);
  res.json({ ok: true });
});

router.use(requireAdmin);

router.get('/auth/me', (req, res) => {
  const { name, email, role } = req.admin;
  res.json({ admin: { name, email, role } });
});

// ---------- Dashboard ----------

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const since30 = new Date(Date.now() - 30 * 86400_000);
    const countedStatuses = ['placed', 'confirmed', 'packing', 'shipped', 'out_for_delivery', 'delivered'];

    const [byStatus, today, last30, recent, products, needsReview, newMessages] = await Promise.all([
      Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: { createdAt: { $gte: startOfDay }, status: { $in: countedStatuses } } },
        { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: since30 }, status: { $in: countedStatuses } } },
        { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
      ]),
      Order.find().sort({ createdAt: -1 }).limit(8).select('orderNumber createdAt customer.name pricing.total payment status').lean(),
      Product.find({ status: { $ne: 'archived' } }).select('name slug variants').lean(),
      Order.countDocuments({ needsReview: { $ne: '' } }),
      ContactMessage.countDocuments({ status: 'new' }),
    ]);

    const lowStock = [];
    for (const p of products) {
      for (const v of p.variants) {
        if (v.isActive && v.stock <= v.lowStockThreshold) {
          lowStock.push({ productId: p._id, name: p.name, variant: v.label, sku: v.sku, stock: v.stock });
        }
      }
    }

    res.json({
      statusCounts: Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
      today: today[0] || { orders: 0, revenue: 0 },
      last30: last30[0] || { orders: 0, revenue: 0 },
      recent,
      lowStock,
      needsReview,
      newMessages,
    });
  }),
);

// ---------- Orders ----------

const orders = Router();
orders.use(allowRoles('order_manager'));

orders.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(ORDER_STATUSES).optional(),
        payment: z.enum(['pending', 'paid', 'failed', 'refunded']).optional(),
        method: z.enum(['cod', 'razorpay']).optional(),
        q: z.string().trim().max(60).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    );
    const filter = {};
    if (q.status) filter.status = q.status;
    if (q.payment) filter['payment.status'] = q.payment;
    if (q.method) filter['payment.method'] = q.method;
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ orderNumber: rx }, { 'customer.phone': rx }, { 'customer.name': rx }];
    }
    if (q.from || q.to) {
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = new Date(q.from);
      if (q.to) filter.createdAt.$lt = new Date(new Date(q.to).getTime() + 86400_000);
    }
    const limit = 25;
    const [items, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * limit)
        .limit(limit)
        .select('orderNumber createdAt customer pricing.total payment status needsReview items.quantity')
        .lean(),
      Order.countDocuments(filter),
    ]);
    res.json({ items, total, page: q.page, pages: Math.ceil(total / limit) });
  }),
);

orders.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id).lean();
    if (!order) throw new HttpError(404, 'Order not found');
    const history = await AuditLog.find({ entity: 'order', entityId: String(order._id) }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ order, allowedNext: TRANSITIONS[order.status] || [], audit: history });
  }),
);

orders.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        status: z.enum(ORDER_STATUSES),
        note: z.string().trim().max(300).optional().default(''),
        tracking: z
          .object({
            courier: z.string().trim().max(60).optional().default(''),
            awb: z.string().trim().max(60).optional().default(''),
            url: z.string().trim().url().max(300).optional().or(z.literal('')),
          })
          .optional(),
      }),
      req.body,
    );
    const order = await Order.findById(req.params.id);
    if (!order) throw new HttpError(404, 'Order not found');
    const from = order.status;
    if (!(TRANSITIONS[from] || []).includes(body.status)) {
      throw new HttpError(400, `Cannot move an order from "${from}" to "${body.status}".`);
    }
    if (body.status === 'shipped' && !(body.tracking?.awb || order.tracking?.awb)) {
      throw new HttpError(400, 'Add the courier and AWB / tracking number before marking as shipped.');
    }

    // Conditional update so two admins can't apply conflicting transitions.
    const set = { status: body.status };
    if (body.tracking) set.tracking = { ...order.tracking?.toObject?.(), ...body.tracking };
    if (body.status === 'delivered' && order.payment.method === 'cod') {
      set['payment.status'] = 'paid';
      set['payment.paidAt'] = new Date();
    }
    if (body.status === 'refunded') set['payment.status'] = 'refunded';
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: from },
      { $set: set, $push: { statusHistory: { status: body.status, by: req.admin.email, note: body.note } } },
      { returnDocument: 'after' },
    );
    if (!updated) throw new HttpError(409, 'This order was just updated by someone else. Refresh and try again.');

    if (body.status === 'cancelled') await releaseOrderStock(order._id);
    audit(req.admin.email, 'order.status', 'order', order._id, { from, to: body.status, note: body.note, tracking: body.tracking });
    res.json({ ok: true });
  }),
);

orders.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        adminNotes: z.string().max(2000).optional(),
        tracking: z
          .object({ courier: z.string().trim().max(60), awb: z.string().trim().max(60), url: z.string().trim().url().max(300).or(z.literal('')) })
          .partial()
          .optional(),
        clearReview: z.boolean().optional(),
      }),
      req.body,
    );
    const set = {};
    if (body.adminNotes !== undefined) set.adminNotes = body.adminNotes;
    if (body.tracking) for (const [k, v] of Object.entries(body.tracking)) set[`tracking.${k}`] = v;
    if (body.clearReview) set.needsReview = '';
    const order = await Order.findByIdAndUpdate(req.params.id, { $set: set }, { returnDocument: 'after' });
    if (!order) throw new HttpError(404, 'Order not found');
    audit(req.admin.email, 'order.edit', 'order', order._id, body);
    res.json({ ok: true });
  }),
);

router.use('/orders', orders);

// ---------- Products & inventory ----------

const products = Router();
products.use(allowRoles('product_manager'));

const variantInput = z.object({
  _id: z.string().optional(),
  label: z.string().trim().min(1).max(40),
  sku: z.string().trim().min(2).max(40),
  netQuantity: z.string().trim().max(40).optional().default(''),
  price: z.coerce.number().int().min(0),
  mrp: z.coerce.number().int().min(0).optional().nullable(),
  lowStockThreshold: z.coerce.number().int().min(0).default(5),
  shippingWeightGrams: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  stock: z.coerce.number().int().min(0).optional(), // only honoured for new variants
});

const productInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(140).optional().default(''),
  shortDescription: z.string().max(300).default(''),
  description: z.string().max(5000).default(''),
  category: z.string().optional().nullable(),
  spiceLevel: z.enum(['mild', 'medium', 'hot', '']).default(''),
  tasteNotes: z.array(z.string().trim().max(30)).max(10).default([]),
  ingredients: z.string().max(2000).default(''),
  allergens: z.string().max(500).default(''),
  dietaryNotes: z.string().max(500).default(''),
  storageInstructions: z.string().max(1000).default(''),
  shelfLife: z.string().max(200).default(''),
  servingIdeas: z.string().max(1000).default(''),
  images: z.array(z.object({ url: z.string().trim().url().max(500), alt: z.string().max(200).default('') })).max(10).default([]),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#8F2D24'),
  variants: z.array(variantInput).min(1, 'Add at least one pack size'),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  isBestseller: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
  seo: z.object({ title: z.string().max(70).default(''), description: z.string().max(170).default('') }).default({ title: '', description: '' }),
});

function normaliseProduct(body) {
  const data = { ...body, slug: slugify(body.slug || body.name) };
  if (!data.slug) throw new HttpError(400, 'Product needs a name or slug.');
  data.category = data.category && mongoose.isValidObjectId(data.category) ? data.category : null;
  const skus = data.variants.map((v) => v.sku.toUpperCase());
  if (new Set(skus).size !== skus.length) throw new HttpError(400, 'Each pack size needs a unique SKU.');
  return data;
}

products.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = ['draft', 'published', 'archived'].includes(req.query.status) ? req.query.status : undefined;
    const items = await Product.find(status ? { status } : { status: { $ne: 'archived' } })
      .populate('category', 'name')
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();
    res.json({ items });
  }),
);

products.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id).lean();
    if (!product) throw new HttpError(404, 'Product not found');
    res.json({ product });
  }),
);

products.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = normaliseProduct(parse(productInput, req.body));
    data.variants = data.variants.map(({ _id, ...v }) => ({ ...v, stock: v.stock ?? 0 }));
    const product = await Product.create(data);
    audit(req.admin.email, 'product.create', 'product', product._id, { name: product.name });
    res.status(201).json({ product });
  }),
);

products.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = normaliseProduct(parse(productInput, req.body));
    const product = await Product.findById(req.params.id);
    if (!product) throw new HttpError(404, 'Product not found');

    // Stock is changed only via the stock-adjust endpoint (audited); keep existing stock on edit.
    const existing = new Map(product.variants.map((v) => [String(v._id), v]));
    const removed = product.variants.filter((v) => !data.variants.some((nv) => nv._id === String(v._id)));
    if (removed.length) {
      const used = await Order.exists({ 'items.variantId': { $in: removed.map((v) => v._id) } });
      if (used) throw new HttpError(400, 'A pack size that appears in past orders cannot be removed. Mark it inactive instead.');
    }
    product.set({
      ...data,
      variants: data.variants.map(({ _id, stock, ...v }) => {
        const prev = _id && existing.get(_id);
        return prev ? { _id: prev._id, ...v, stock: prev.stock } : { ...v, stock: stock ?? 0 };
      }),
    });
    await product.save();
    audit(req.admin.email, 'product.update', 'product', product._id, { name: product.name, status: product.status });
    res.json({ product });
  }),
);

products.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) throw new HttpError(404, 'Product not found');
    const used = await Order.exists({ 'items.product': product._id });
    if (used) {
      product.status = 'archived';
      await product.save();
      audit(req.admin.email, 'product.archive', 'product', product._id, { reason: 'referenced by orders' });
      return res.json({ archived: true, message: 'This product appears in past orders, so it was archived instead of deleted.' });
    }
    await product.deleteOne();
    audit(req.admin.email, 'product.delete', 'product', product._id, { name: product.name });
    res.json({ deleted: true });
  }),
);

products.post(
  '/:id/variants/:variantId/stock',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        delta: z.coerce.number().int().refine((n) => n !== 0, 'Change cannot be zero'),
        reason: z.string().trim().min(3, 'Please give a reason').max(200),
      }),
      req.body,
    );
    const filter = { _id: req.params.id, 'variants._id': req.params.variantId };
    if (body.delta < 0) filter.variants = { $elemMatch: { _id: req.params.variantId, stock: { $gte: -body.delta } } };
    const updated = await Product.findOneAndUpdate(filter, { $inc: { 'variants.$.stock': body.delta } }, { returnDocument: 'after' });
    if (!updated) throw new HttpError(400, 'Stock cannot go below zero.');
    const v = updated.variants.id(req.params.variantId);
    audit(req.admin.email, 'stock.adjust', 'product', updated._id, { sku: v.sku, delta: body.delta, reason: body.reason, newStock: v.stock });
    res.json({ stock: v.stock });
  }),
);

products.get(
  '/:id/audit',
  asyncHandler(async (req, res) => {
    const items = await AuditLog.find({ entity: 'product', entityId: String(req.params.id) }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ items });
  }),
);

router.use('/products', products);

// ---------- Categories ----------

const categories = Router();
categories.use(allowRoles('product_manager'));
const categoryInput = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().max(80).optional().default(''),
  description: z.string().max(300).default(''),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

categories.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ items: await Category.find().sort({ sortOrder: 1, name: 1 }).lean() });
  }),
);
categories.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parse(categoryInput, req.body);
    const cat = await Category.create({ ...data, slug: slugify(data.slug || data.name) });
    audit(req.admin.email, 'category.create', 'category', cat._id, { name: cat.name });
    res.status(201).json({ category: cat });
  }),
);
categories.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = parse(categoryInput, req.body);
    const cat = await Category.findByIdAndUpdate(
      req.params.id,
      { ...data, slug: slugify(data.slug || data.name) },
      { returnDocument: 'after', runValidators: true },
    );
    if (!cat) throw new HttpError(404, 'Category not found');
    audit(req.admin.email, 'category.update', 'category', cat._id, data);
    res.json({ category: cat });
  }),
);
router.use('/categories', categories);

// ---------- Messages ----------

router.get(
  '/messages',
  allowRoles('order_manager'),
  asyncHandler(async (req, res) => {
    const status = ['new', 'in_progress', 'closed'].includes(req.query.status) ? req.query.status : undefined;
    const items = await ContactMessage.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ items });
  }),
);
router.patch(
  '/messages/:id',
  allowRoles('order_manager'),
  asyncHandler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['new', 'in_progress', 'closed']) }), req.body);
    const msg = await ContactMessage.findByIdAndUpdate(req.params.id, { status }, { returnDocument: 'after' });
    if (!msg) throw new HttpError(404, 'Message not found');
    res.json({ ok: true });
  }),
);

// ---------- Settings (owner only) ----------

const settingsInput = z.object({
  announcement: z.string().max(200),
  business: z.object({
    name: z.string().trim().min(1).max(80),
    tagline: z.string().max(120),
    supportPhone: z.string().max(20),
    whatsapp: z.string().regex(/^\d{0,15}$/, 'Digits only, with country code (e.g. 919876543210)'),
    supportEmail: z.string().email().or(z.literal('')),
    supportHours: z.string().max(80),
    address: z.string().max(300),
    fssaiNumber: z.string().max(20),
    instagram: z.string().url().or(z.literal('')),
    facebook: z.string().url().or(z.literal('')),
  }),
  shipping: z.object({
    flatRate: z.coerce.number().int().min(0),
    freeShippingThreshold: z.coerce.number().int().min(0),
    serviceablePincodePrefixes: z.array(z.string().regex(/^[1-9]\d{0,5}$/, 'PIN prefixes must be 1–6 digits')).max(500),
    processingTime: z.string().max(200),
    deliveryEstimate: z.string().max(200),
  }),
  cod: z.object({
    enabled: z.boolean(),
    fee: z.coerce.number().int().min(0),
    maxOrderValue: z.coerce.number().int().min(0),
  }),
});

router.get(
  '/settings',
  allowRoles(),
  asyncHandler(async (_req, res) => res.json({ settings: await getSettings() })),
);
router.put(
  '/settings',
  allowRoles(),
  asyncHandler(async (req, res) => {
    const data = parse(settingsInput, req.body);
    const settings = await Setting.findOneAndUpdate({ key: 'store' }, { $set: data }, { returnDocument: 'after', upsert: true }).lean();
    audit(req.admin.email, 'settings.update', 'settings', 'store', data);
    res.json({ settings });
  }),
);

export default router;
