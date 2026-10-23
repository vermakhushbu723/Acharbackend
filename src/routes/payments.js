import { Router } from 'express';
import { z } from 'zod';
import { Order } from '../models/Order.js';
import { asyncHandler, parse, HttpError } from '../lib/http.js';
import { verifyCheckoutSignature, verifyWebhookSignature } from '../lib/razorpay.js';
import { markOrderPaid } from '../lib/orders.js';
import { razorpayEnabled } from '../config.js';

const router = Router();

/** Called by the browser after Razorpay Checkout succeeds. The signature proves it came from Razorpay. */
router.post(
  '/verify',
  asyncHandler(async (req, res) => {
    if (!razorpayEnabled()) throw new HttpError(400, 'Online payment is not configured.');
    const body = parse(
      z.object({
        orderNumber: z.string().max(30),
        accessKey: z.string().max(60),
        razorpay_order_id: z.string().max(60),
        razorpay_payment_id: z.string().max(60),
        razorpay_signature: z.string().max(200),
      }),
      req.body,
    );
    const order = await Order.findOne({ orderNumber: body.orderNumber }).select('+accessKey');
    if (!order || order.accessKey !== body.accessKey) throw new HttpError(404, 'Order not found.');
    if (order.payment.razorpayOrderId !== body.razorpay_order_id) throw new HttpError(400, 'Payment does not match this order.');

    const valid = verifyCheckoutSignature({
      razorpayOrderId: body.razorpay_order_id,
      razorpayPaymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature,
    });
    if (!valid) throw new HttpError(400, 'Payment could not be verified. If money was deducted, please contact support.');

    await markOrderPaid(order, { razorpayPaymentId: body.razorpay_payment_id, source: 'razorpay-checkout' });
    res.json({ ok: true, status: order.status });
  }),
);

/**
 * Razorpay webhook (configure in Razorpay Dashboard > Webhooks, events: payment.captured, order.paid, payment.failed).
 * Mounted with express.raw so the signature is checked against the exact bytes received.
 */
export const webhookHandler = asyncHandler(async (req, res) => {
  const raw = req.body; // Buffer
  if (!verifyWebhookSignature(raw, req.get('X-Razorpay-Signature'))) {
    return res.status(400).json({ error: 'Invalid signature' });
  }
  const event = JSON.parse(raw.toString('utf8'));
  const payment = event.payload?.payment?.entity;
  const rzpOrderId = payment?.order_id || event.payload?.order?.entity?.id;
  if (!rzpOrderId) return res.json({ ok: true });

  const order = await Order.findOne({ 'payment.razorpayOrderId': rzpOrderId });
  if (!order) return res.json({ ok: true });

  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    await markOrderPaid(order, { razorpayPaymentId: payment?.id, source: 'razorpay-webhook' });
  } else if (event.event === 'payment.failed' && order.payment.status === 'pending') {
    // Customer may retry with another method; the order stays pending until it expires.
    order.statusHistory.push({ status: order.status, by: 'razorpay-webhook', note: 'A payment attempt failed' });
    await order.save();
  }
  res.json({ ok: true });
});

export default router;
