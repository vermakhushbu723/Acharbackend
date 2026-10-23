import mongoose from 'mongoose';

export const ORDER_STATUSES = [
  'pending_payment',
  'placed',
  'confirmed',
  'packing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refunded',
];

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: String,
    slug: String,
    variantLabel: String,
    sku: String,
    unitPrice: Number,
    quantity: Number,
    lineTotal: Number,
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    accessKey: { type: String, required: true, select: false }, // secret for the customer's tracking link
    clientRequestId: { type: String, unique: true, sparse: true }, // idempotency for double clicks
    items: { type: [itemSchema], required: true },
    customer: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, default: '' },
    },
    address: {
      line1: { type: String, required: true },
      line2: { type: String, required: true },
      landmark: { type: String, default: '' },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
    },
    pricing: {
      subtotal: Number,
      shipping: Number,
      codFee: Number,
      discount: { type: Number, default: 0 },
      total: Number,
    },
    payment: {
      method: { type: String, enum: ['cod', 'razorpay'], required: true },
      status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
      razorpayOrderId: { type: String },
      razorpayPaymentId: String,
      paidAt: Date,
    },
    status: { type: String, enum: ORDER_STATUSES, required: true },
    statusHistory: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: String, default: 'system' },
        note: { type: String, default: '' },
        _id: false,
      },
    ],
    tracking: { courier: String, awb: String, url: String },
    customerNote: { type: String, default: '' },
    adminNotes: { type: String, default: '' },
    needsReview: { type: String, default: '' }, // set when a human must look (e.g. payment after cancellation)
    consent: { terms: Boolean, marketing: Boolean },
    stockReleased: { type: Boolean, default: false },
  },
  { timestamps: true },
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'customer.phone': 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'payment.razorpayOrderId': 1 }, { sparse: true });

export const Order = mongoose.model('Order', orderSchema);
