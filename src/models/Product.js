import mongoose from 'mongoose';

const variantSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true }, // e.g. "250 g"
  sku: { type: String, required: true, trim: true, uppercase: true },
  netQuantity: { type: String, default: '' }, // as printed on the label, e.g. "250 g"
  price: { type: Number, required: true, min: 0 }, // selling price in whole rupees, incl. taxes
  mrp: { type: Number, min: 0 }, // printed MRP; strike-through shown only if mrp > price
  stock: { type: Number, default: 0, min: 0 },
  lowStockThreshold: { type: Number, default: 5, min: 0 },
  shippingWeightGrams: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
});

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    shortDescription: { type: String, default: '' },
    description: { type: String, default: '' },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    spiceLevel: { type: String, enum: ['mild', 'medium', 'hot', ''], default: '' },
    tasteNotes: [{ type: String, trim: true }], // e.g. tangy, spicy
    ingredients: { type: String, default: '' }, // descending order by weight, as on the label
    allergens: { type: String, default: '' },
    dietaryNotes: { type: String, default: '' },
    storageInstructions: { type: String, default: '' },
    shelfLife: { type: String, default: '' },
    servingIdeas: { type: String, default: '' },
    images: [{ url: { type: String, required: true }, alt: { type: String, default: '' }, _id: false }],
    accentColor: { type: String, default: '#8F2D24' }, // colours the placeholder jar art
    variants: { type: [variantSchema], default: [] },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    isBestseller: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    seo: { title: { type: String, default: '' }, description: { type: String, default: '' } },
  },
  { timestamps: true },
);

productSchema.index({ status: 1, sortOrder: 1 });
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });

export const Product = mongoose.model('Product', productSchema);
