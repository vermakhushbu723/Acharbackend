import mongoose from 'mongoose';

// A single document (key: "store") holding editable store settings.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    announcement: {
      type: String,
      default: 'Freshly packed achaar | Secure checkout | Delivery availability at checkout',
    },
    business: {
      name: { type: String, default: 'Acharika' },
      tagline: { type: String, default: 'Har Bite Mein Ghar Ka Swaad' },
      supportPhone: { type: String, default: '' },
      whatsapp: { type: String, default: '' }, // digits with country code, e.g. 919876543210
      supportEmail: { type: String, default: '' },
      supportHours: { type: String, default: 'Mon–Sat, 10 AM – 6 PM' },
      address: { type: String, default: '' }, // only if the owner wants it public
      fssaiNumber: { type: String, default: '' },
      instagram: { type: String, default: '' },
      facebook: { type: String, default: '' },
    },
    shipping: {
      flatRate: { type: Number, default: 60 },
      freeShippingThreshold: { type: Number, default: 0 }, // 0 = no free shipping
      serviceablePincodePrefixes: { type: [String], default: [] }, // empty = every valid Indian PIN code
      processingTime: { type: String, default: 'Orders are usually packed within 1–2 working days.' },
      deliveryEstimate: {
        type: String,
        default: 'Delivery usually takes 3–7 working days after dispatch, depending on your PIN code.',
      },
    },
    cod: {
      enabled: { type: Boolean, default: true },
      fee: { type: Number, default: 0 },
      maxOrderValue: { type: Number, default: 3000 }, // 0 = no cap
    },
  },
  { timestamps: true },
);

export const Setting = mongoose.model('Setting', settingSchema);

export async function getSettings() {
  return Setting.findOneAndUpdate(
    { key: 'store' },
    { $setOnInsert: { key: 'store' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
}
