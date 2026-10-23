import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { getSettings } from '../models/Setting.js';

export const PINCODE_RE = /^[1-9][0-9]{5}$/;

export function isServiceable(pincode, settings) {
  if (!pincode || !PINCODE_RE.test(pincode)) return false;
  const prefixes = settings.shipping.serviceablePincodePrefixes || [];
  return prefixes.length === 0 || prefixes.some((p) => pincode.startsWith(p));
}

/**
 * Server-side source of truth for cart contents and totals.
 * Never trusts prices, stock or totals from the browser.
 *
 * @param {{ items: {productId:string, variantId:string, quantity:number}[], pincode?: string, paymentMethod?: 'cod'|'razorpay' }} input
 */
export async function buildQuote({ items, pincode, paymentMethod }) {
  const settings = await getSettings();

  // Merge duplicate lines.
  const merged = new Map();
  for (const it of items) {
    const key = `${it.productId}:${it.variantId}`;
    merged.set(key, { ...it, quantity: (merged.get(key)?.quantity || 0) + it.quantity });
  }
  const wanted = [...merged.values()].filter(
    (it) => mongoose.isValidObjectId(it.productId) && mongoose.isValidObjectId(it.variantId),
  );

  const products = await Product.find({
    _id: { $in: wanted.map((it) => it.productId) },
    status: 'published',
  }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = [];
  const issues = [];
  for (const it of [...merged.values()]) {
    const product = byId.get(String(it.productId));
    const variant = product?.variants.find((v) => String(v._id) === String(it.variantId));
    if (!product || !variant || !variant.isActive) {
      issues.push({ productId: it.productId, variantId: it.variantId, type: 'unavailable', message: 'This item is no longer available.' });
      continue;
    }
    if (variant.stock < it.quantity) {
      issues.push({
        productId: it.productId,
        variantId: it.variantId,
        type: 'stock',
        available: variant.stock,
        message: variant.stock === 0 ? `${product.name} (${variant.label}) is out of stock.` : `Only ${variant.stock} left of ${product.name} (${variant.label}).`,
      });
    }
    lines.push({
      product: product._id,
      variantId: variant._id,
      name: product.name,
      slug: product.slug,
      variantLabel: variant.label,
      sku: variant.sku,
      unitPrice: variant.price,
      quantity: it.quantity,
      lineTotal: variant.price * it.quantity,
      image: product.images?.[0]?.url || '',
      accentColor: product.accentColor,
    });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const { flatRate, freeShippingThreshold } = settings.shipping;
  const shipping = subtotal === 0 ? 0 : freeShippingThreshold > 0 && subtotal >= freeShippingThreshold ? 0 : flatRate;

  const codAvailable =
    settings.cod.enabled && (settings.cod.maxOrderValue === 0 || subtotal + shipping + settings.cod.fee <= settings.cod.maxOrderValue);
  const codFee = paymentMethod === 'cod' ? settings.cod.fee : 0;
  const discount = 0; // coupons are a post-launch feature
  const total = subtotal + shipping + codFee - discount;

  return {
    lines,
    issues,
    pricing: { subtotal, shipping, codFee, discount, total },
    pincode: pincode || null,
    serviceable: pincode ? isServiceable(pincode, settings) : null,
    codAvailable,
    freeShippingThreshold,
    settings,
  };
}
