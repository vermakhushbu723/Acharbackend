import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';

/**
 * Atomically decrements stock for every line. If any line can't be reserved,
 * already-reserved lines are rolled back and false is returned.
 */
export async function reserveStock(lines) {
  const done = [];
  for (const line of lines) {
    const res = await Product.updateOne(
      { _id: line.product, variants: { $elemMatch: { _id: line.variantId, stock: { $gte: line.quantity } } } },
      { $inc: { 'variants.$.stock': -line.quantity } },
    );
    if (res.modifiedCount !== 1) {
      await releaseLines(done);
      return false;
    }
    done.push(line);
  }
  return true;
}

async function releaseLines(lines) {
  for (const line of lines) {
    await Product.updateOne(
      { _id: line.product, 'variants._id': line.variantId },
      { $inc: { 'variants.$.stock': line.quantity } },
    );
  }
}

/** Returns an order's items to stock exactly once (guarded by stockReleased). */
export async function releaseOrderStock(orderId) {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, stockReleased: false },
    { $set: { stockReleased: true } },
    { returnDocument: 'after' },
  );
  if (order) await releaseLines(order.items);
  return Boolean(order);
}

/** Re-reserve stock for an order whose stock had been released (e.g. late payment). */
export async function rereserveOrderStock(order) {
  if (!order.stockReleased) return true;
  const ok = await reserveStock(order.items);
  if (ok) await Order.updateOne({ _id: order._id }, { $set: { stockReleased: false } });
  return ok;
}
