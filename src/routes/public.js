import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { ContactMessage } from '../models/ContactMessage.js';
import { getSettings } from '../models/Setting.js';
import { asyncHandler, parse, escapeRegex, HttpError } from '../lib/http.js';
import { buildQuote, isServiceable, PINCODE_RE } from '../lib/pricing.js';
import { razorpayEnabled } from '../config.js';

const router = Router();

/** Storefront-safe product shape: no exact stock numbers or internal fields. */
export function publicProduct(p) {
  const variants = p.variants
    .filter((v) => v.isActive)
    .map((v) => ({
      _id: v._id,
      label: v.label,
      netQuantity: v.netQuantity,
      price: v.price,
      mrp: v.mrp && v.mrp > v.price ? v.mrp : null,
      inStock: v.stock > 0,
      lowStock: v.stock > 0 && v.stock <= v.lowStockThreshold,
      maxQty: Math.min(v.stock, 10),
    }));
  return {
    _id: p._id,
    name: p.name,
    slug: p.slug,
    shortDescription: p.shortDescription,
    description: p.description,
    category: p.category && p.category.slug ? { name: p.category.name, slug: p.category.slug } : null,
    spiceLevel: p.spiceLevel,
    tasteNotes: p.tasteNotes,
    ingredients: p.ingredients,
    allergens: p.allergens,
    dietaryNotes: p.dietaryNotes,
    storageInstructions: p.storageInstructions,
    shelfLife: p.shelfLife,
    servingIdeas: p.servingIdeas,
    images: p.images,
    accentColor: p.accentColor,
    isBestseller: p.isBestseller,
    seo: p.seo,
    variants,
    fromPrice: variants.length ? Math.min(...variants.map((v) => v.price)) : null,
    inStock: variants.some((v) => v.inStock),
  };
}

router.get(
  '/settings/public',
  asyncHandler(async (_req, res) => {
    const s = await getSettings();
    res.json({
      announcement: s.announcement,
      business: s.business,
      shipping: {
        flatRate: s.shipping.flatRate,
        freeShippingThreshold: s.shipping.freeShippingThreshold,
        processingTime: s.shipping.processingTime,
        deliveryEstimate: s.shipping.deliveryEstimate,
      },
      cod: s.cod,
      onlinePayment: razorpayEnabled(),
    });
  }),
);

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const [categories, counts] = await Promise.all([
      Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      Product.aggregate([{ $match: { status: 'published' } }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
    ]);
    const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
    // Only show categories that actually have products (PRD: "sirf available products dikhayein").
    res.json(
      categories
        .map((c) => ({ _id: c._id, name: c.name, slug: c.slug, description: c.description, productCount: countBy.get(String(c._id)) || 0 }))
        .filter((c) => c.productCount > 0),
    );
  }),
);

const listQuery = z.object({
  category: z.string().max(80).optional(),
  q: z.string().trim().max(80).optional(),
  spice: z.enum(['mild', 'medium', 'hot']).optional(),
  bestseller: z.enum(['1']).optional(),
  sort: z.enum(['popular', 'price_asc', 'price_desc', 'newest']).default('popular'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const q = parse(listQuery, req.query);
    const filter = { status: 'published' };
    if (q.category) {
      const cat = await Category.findOne({ slug: q.category, isActive: true }).lean();
      if (!cat) return res.json({ items: [], total: 0, page: 1, pages: 0 });
      filter.category = cat._id;
    }
    if (q.spice) filter.spiceLevel = q.spice;
    if (q.bestseller) filter.isBestseller = true;
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      const cats = await Category.find({ name: rx }).select('_id').lean();
      filter.$or = [{ name: rx }, { shortDescription: rx }, { tasteNotes: rx }, { category: { $in: cats.map((c) => c._id) } }];
    }

    // Catalogue is small (tens of products), so sort by computed price in memory.
    let items = (await Product.find(filter).populate('category', 'name slug').lean()).map(publicProduct);
    const sorters = {
      popular: (a, b) => Number(b.isBestseller) - Number(a.isBestseller) || Number(b.inStock) - Number(a.inStock),
      price_asc: (a, b) => (a.fromPrice ?? 0) - (b.fromPrice ?? 0),
      price_desc: (a, b) => (b.fromPrice ?? 0) - (a.fromPrice ?? 0),
      newest: () => 0,
    };
    if (q.sort === 'newest') items.reverse();
    else items.sort(sorters[q.sort]);

    const total = items.length;
    const start = (q.page - 1) * q.limit;
    res.json({ items: items.slice(start, start + q.limit), total, page: q.page, pages: Math.ceil(total / q.limit) });
  }),
);

router.get(
  '/products/:slug',
  asyncHandler(async (req, res) => {
    const p = await Product.findOne({ slug: String(req.params.slug).toLowerCase(), status: 'published' })
      .populate('category', 'name slug')
      .lean();
    if (!p) throw new HttpError(404, 'Product not found');
    const related = await Product.find({ _id: { $ne: p._id }, status: 'published', ...(p.category ? { category: p.category._id } : {}) })
      .limit(4)
      .populate('category', 'name slug')
      .lean();
    let relatedItems = related.map(publicProduct);
    if (relatedItems.length < 4) {
      const more = await Product.find({ _id: { $nin: [p._id, ...related.map((r) => r._id)] }, status: 'published' })
        .limit(4 - relatedItems.length)
        .populate('category', 'name slug')
        .lean();
      relatedItems = relatedItems.concat(more.map(publicProduct));
    }
    res.json({ product: publicProduct(p), related: relatedItems });
  }),
);

router.get(
  '/pincode/:pin',
  asyncHandler(async (req, res) => {
    const pin = String(req.params.pin);
    if (!PINCODE_RE.test(pin)) return res.json({ valid: false, serviceable: false });
    const s = await getSettings();
    res.json({ valid: true, serviceable: isServiceable(pin, s), deliveryEstimate: s.shipping.deliveryEstimate });
  }),
);

export const cartItemsSchema = z
  .array(
    z.object({
      productId: z.string().min(1).max(40),
      variantId: z.string().min(1).max(40),
      quantity: z.number().int().min(1).max(20),
    }),
  )
  .min(1, 'Your cart is empty.')
  .max(30);

router.post(
  '/cart/validate',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        items: cartItemsSchema,
        pincode: z.string().regex(PINCODE_RE).optional().or(z.literal('')),
        paymentMethod: z.enum(['cod', 'razorpay']).optional(),
      }),
      req.body,
    );
    const quote = await buildQuote({ ...body, pincode: body.pincode || undefined });
    const { settings, ...rest } = quote;
    res.json(rest);
  }),
);

const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });

router.post(
  '/contact',
  contactLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2, 'Please enter your name').max(80),
        contact: z.string().trim().min(5, 'Please enter a phone number or email').max(120),
        orderNumber: z.string().trim().max(30).optional().default(''),
        subject: z.string().trim().max(120).optional().default(''),
        message: z.string().trim().min(5, 'Please write a message').max(2000),
        website: z.string().max(0).optional(), // honeypot: real users leave it empty
      }),
      req.body,
    );
    const { website, ...data } = body;
    await ContactMessage.create(data);
    res.status(201).json({ ok: true });
  }),
);

export default router;
