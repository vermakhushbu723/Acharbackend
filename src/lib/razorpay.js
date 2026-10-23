import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from './http.js';

const API = 'https://api.razorpay.com/v1';

function authHeader() {
  const { keyId, keySecret } = config.razorpay;
  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

/** Creates a Razorpay order. amountRupees is converted to paise. */
export async function createRazorpayOrder({ amountRupees, receipt, notes }) {
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.round(amountRupees * 100), currency: 'INR', receipt, notes }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Razorpay order create failed', res.status, body);
    throw new HttpError(502, 'Could not start online payment. Please try again or choose another method.');
  }
  return body; // { id, amount, currency, ... }
}

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

/** Verifies the signature returned to the browser by Razorpay Checkout. */
export function verifyCheckoutSignature({ razorpayOrderId, razorpayPaymentId, signature }) {
  const expected = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return safeEqual(expected, signature);
}

/** Verifies the X-Razorpay-Signature header against the raw webhook body. */
export function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}
