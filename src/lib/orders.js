import crypto from 'node:crypto';
import { Order } from '../models/Order.js';
import { audit } from '../models/AuditLog.js';
import { releaseOrderStock, rereserveOrderStock } from './stock.js';

export function newOrderNumber() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  // 6 chars from an unambiguous alphabet
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  const suffix = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `ACH-${ymd}-${suffix}`;
}

export const newAccessKey = () => crypto.randomBytes(18).toString('base64url');

/** Allowed admin transitions. Payment-driven moves (pending_payment -> placed) happen in code, not here. */
export const TRANSITIONS = {
  pending_payment: ['cancelled'],
  placed: ['confirmed', 'cancelled'],
  confirmed: ['packing', 'cancelled'],
  packing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded: [],
};

/** Customer-facing view of an order (no internal notes / secrets). */
export function publicOrder(o) {
  return {
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    status: o.status,
    statusHistory: o.statusHistory.map(({ status, at, note }) => ({ status, at, note })),
    items: o.items.map(({ name, slug, variantLabel, unitPrice, quantity, lineTotal }) => ({
      name, slug, variantLabel, unitPrice, quantity, lineTotal,
    })),
    customer: { name: o.customer.name, phone: maskPhone(o.customer.phone) },
    address: o.address,
    pricing: o.pricing,
    payment: { method: o.payment.method, status: o.payment.status },
    tracking: o.tracking?.awb || o.tracking?.url ? o.tracking : null,
  };
}

const maskPhone = (p) => (p && p.length >= 4 ? `${'•'.repeat(p.length - 4)}${p.slice(-4)}` : p);

/** Marks an online order paid. Idempotent; handles payment arriving after auto-cancel. */
export async function markOrderPaid(order, { razorpayPaymentId, source }) {
  if (order.payment.status === 'paid') return order;
  order.payment.status = 'paid';
  order.payment.razorpayPaymentId = razorpayPaymentId;
  order.payment.paidAt = new Date();

  if (order.status === 'pending_payment') {
    order.status = 'placed';
    order.statusHistory.push({ status: 'placed', by: source, note: 'Online payment received' });
  } else if (order.status === 'cancelled') {
    // Payment captured after the order timed out. Try to reinstate it.
    const ok = await rereserveOrderStock(order);
    if (ok) {
      order.stockReleased = false;
      order.status = 'placed';
      order.statusHistory.push({ status: 'placed', by: source, note: 'Payment received after timeout; order reinstated' });
    } else {
      order.needsReview = 'Payment received after the order was cancelled and stock is no longer available. Refund or arrange stock.';
    }
  }
  await order.save();
  audit(source, 'payment.paid', 'order', order._id, { razorpayPaymentId });
  return order;
}

/** Cancels online orders that stayed unpaid too long and releases their stock. */
export async function expireUnpaidOrders(ttlMinutes) {
  const cutoff = new Date(Date.now() - ttlMinutes * 60_000);
  const stale = await Order.find({ status: 'pending_payment', createdAt: { $lt: cutoff } });
  for (const order of stale) {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: 'pending_payment' },
      {
        $set: { status: 'cancelled', 'payment.status': 'failed' },
        $push: { statusHistory: { status: 'cancelled', by: 'system', note: 'Payment not completed in time' } },
      },
    );
    if (updated) await releaseOrderStock(order._id);
  }
  return stale.length;
}
