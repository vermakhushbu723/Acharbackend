import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { asyncHandler, parse, HttpError } from '../lib/http.js';
import { buildQuote, PINCODE_RE } from '../lib/pricing.js';
import { reserveStock, releaseOrderStock } from '../lib/stock.js';
import { newOrderNumber, newAccessKey, publicOrder } from '../lib/orders.js';
import { createRazorpayOrder } from '../lib/razorpay.js';
import { config, razorpayEnabled } from '../config.js';
import { cartItemsSchema } from './public.js';

const router = Router();

const PHONE_RE = /^[6-9]\d{9}$/;
const normalisePhone = (p) => String(p).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');

const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const trackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });

const createSchema = z.object({
  clientRequestId: z.string().uuid(),
  items: cartItemsSchema,
  customer: z.object({
    name: z.string().trim().min(2, 'Please enter your full name').max(80),
    phone: z
      .string()
      .transform(normalisePhone)
      .refine((p) => PHONE_RE.test(p), 'Enter a valid 10-digit mobile number'),
    email: z.string().trim().toLowerCase().email('Enter a valid email').max(120).optional().or(z.literal('')),
  }),
  address: z.object({
    line1: z.string().trim().min(3, 'House / flat details are required').max(150),
    line2: z.string().trim().min(3, 'Street / locality is required').max(150),
    landmark: z.string().trim().max(100).optional().default(''),
    city: z.string().trim().min(2, 'City is required').max(60),
    state: z.string().trim().min(2, 'State is required').max(60),
    pincode: z.string().regex(PINCODE_RE, 'Enter a valid 6-digit PIN code'),
  }),
  paymentMethod: z.enum(['cod', 'razorpay']),
  note: z.string().trim().max(300).optional().default(''),
  consent: z.object({
    terms: z.literal(true, { message: 'Please accept the Terms and Privacy Policy' }),
    marketing: z.boolean().optional().default(false),
  }),
});

function paymentPayload(order) {
  if (order.payment.method !== 'razorpay' || order.payment.status === 'paid') return null;
  return {
    keyId: config.razorpay.keyId,
    razorpayOrderId: order.payment.razorpayOrderId,
    amount: Math.round(order.pricing.total * 100),
    currency: 'INR',
    name: 'Acharika',
    prefill: { name: order.customer.name, contact: order.customer.phone, email: order.customer.email || undefined },
  };
}

router.post(
  '/',
  orderLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);

    // Idempotency: a double-click / retry returns the same order instead of creating another.
    const existing = await Order.findOne({ clientRequestId: body.clientRequestId }).select('+accessKey');
    if (existing) {
      return res.json({ orderNumber: existing.orderNumber, accessKey: existing.accessKey, status: existing.status, payment: paymentPayload(existing) });
    }

    const quote = await buildQuote({ items: body.items, pincode: body.address.pincode, paymentMethod: body.paymentMethod });
    if (quote.issues.length) {
      throw new HttpError(409, 'Some items in your cart changed. Please review your cart.', { issues: quote.issues });
    }
    if (!quote.serviceable) throw new HttpError(400, 'Sorry, we do not deliver to this PIN code yet.', { fields: { 'address.pincode': 'Not serviceable' } });
    if (body.paymentMethod === 'cod' && !quote.codAvailable) throw new HttpError(400, 'Cash on Delivery is not available for this order.');
    if (body.paymentMethod === 'razorpay' && !razorpayEnabled()) throw new HttpError(400, 'Online payment is not available right now.');

    const reserved = await reserveStock(quote.lines);
    if (!reserved) throw new HttpError(409, 'An item just went out of stock. Please review your cart.');

    const isCod = body.paymentMethod === 'cod';
    let order;
    try {
      order = await Order.create({
        orderNumber: newOrderNumber(),
        accessKey: newAccessKey(),
        clientRequestId: body.clientRequestId,
        items: quote.lines.map(({ image, accentColor, ...l }) => l),
        customer: { ...body.customer, email: body.customer.email || '' },
        address: body.address,
        pricing: quote.pricing,
        payment: { method: body.paymentMethod, status: 'pending' },
        status: isCod ? 'placed' : 'pending_payment',
        statusHistory: [{ status: isCod ? 'placed' : 'pending_payment', by: 'customer' }],
        customerNote: body.note,
        consent: body.consent,
      });
    } catch (err) {
      await releaseLinesSafely(quote.lines);
      throw err;
    }

    if (!isCod) {
      try {
        const rp = await createRazorpayOrder({
          amountRupees: order.pricing.total,
          receipt: order.orderNumber,
          notes: { orderNumber: order.orderNumber },
        });
        order.payment.razorpayOrderId = rp.id;
        await order.save();
      } catch (err) {
        order.status = 'cancelled';
        order.payment.status = 'failed';
        order.statusHistory.push({ status: 'cancelled', note: 'Could not start online payment' });
        await order.save();
        await releaseOrderStock(order._id);
        throw err;
      }
    }

    res.status(201).json({ orderNumber: order.orderNumber, accessKey: order.accessKey, status: order.status, payment: paymentPayload(order) });
  }),
);

async function releaseLinesSafely(lines) {
  for (const l of lines) {
    await Product.updateOne({ _id: l.product, 'variants._id': l.variantId }, { $inc: { 'variants.$.stock': l.quantity } }).catch(() => {});
  }
}

/** Secure tracking link: order number + secret access key (from the success page / email). */
router.get(
  '/:orderNumber',
  trackLimiter,
  asyncHandler(async (req, res) => {
    const key = String(req.query.k || '');
    const order = await Order.findOne({ orderNumber: String(req.params.orderNumber).toUpperCase() }).select('+accessKey').lean();
    if (!order || !key || order.accessKey !== key) throw new HttpError(404, 'Order not found.');
    res.json({ order: publicOrder(order), payment: paymentPayload(order) });
  }),
);

/** Track by order number + the phone number used on the order. Never by order number alone. */
router.post(
  '/track',
  trackLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        orderNumber: z.string().trim().toUpperCase().min(5, 'Enter your order ID').max(30),
        phone: z.string().transform(normalisePhone).refine((p) => PHONE_RE.test(p), 'Enter the 10-digit mobile number used on the order'),
      }),
      req.body,
    );
    const order = await Order.findOne({ orderNumber: body.orderNumber, 'customer.phone': body.phone }).lean();
    if (!order) throw new HttpError(404, 'No order found with these details. Please check the order ID and phone number.');
    res.json({ order: publicOrder(order) });
  }),
);

export default router;
