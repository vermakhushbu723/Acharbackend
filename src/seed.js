/**
 * Seeds categories, placeholder products, store settings and the first owner account.
 *
 *   npm run seed            -> adds missing data, never overwrites existing products
 *   npm run seed -- --reset -> deletes ALL products and categories first (orders are kept)
 *
 * IMPORTANT: Product names, prices, ingredients, shelf life and stock below are PLACEHOLDERS.
 * Replace them in the admin panel with your actual recipes and label information before launch.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { assertConfig } from './config.js';
import { connectDb } from './db.js';
import { Category } from './models/Category.js';
import { Product } from './models/Product.js';
import { AdminUser } from './models/AdminUser.js';
import { getSettings } from './models/Setting.js';

assertConfig();
await connectDb();

const reset = process.argv.includes('--reset');
if (reset) {
  await Product.deleteMany({});
  await Category.deleteMany({});
  console.log('Cleared products and categories.');
}

const categoryData = [
  { name: 'Mango', slug: 'mango', description: 'Kachche aam ke tukde, sarson ka tel aur saboot masale. Har Indian ghar ka sabse pasandida achaar: khatta, teekha aur chatpata.', sortOrder: 1 },
  { name: 'Lemon', slug: 'lemon', description: 'Nimbu ka tangy, khatta-meetha swaad. Curd rice, khichdi aur poha ke saath ekdum perfect.', sortOrder: 2 },
  { name: 'Chilli', slug: 'chilli', description: 'Hari mirch ho ya masala bhari laal mirch: teekha khaane walon ke liye chatpata achaar.', sortOrder: 3 },
  { name: 'Garlic', slug: 'garlic', description: 'Lehsun ki kaliyon ka teekha, khushbudaar achaar. Dal-chawal aur paratha ka swaad doguna kar de.', sortOrder: 4 },
  { name: 'Ginger', slug: 'ginger', description: 'Adrak ka zesty, halka teekha achaar. Khaane ke saath ek taazgi bhara kick.', sortOrder: 5 },
  { name: 'Mixed Vegetable', slug: 'mixed-vegetable', description: 'Gajar, gobhi, shalgam aur mirchi: ek hi jar mein kai sabziyon ka swaad.', sortOrder: 6 },
  { name: 'Sweet Achaar', slug: 'sweet-achaar', description: 'Gud ya cheeni ke saath bana khatta-meetha achaar. Bachchon aur bado, sabka favourite.', sortOrder: 7 },
  { name: 'Combo Packs', slug: 'combo-packs', description: 'Ek order mein kai flavours. Family ke liye ya gifting ke liye behtareen.', sortOrder: 8 },
];

// Creates missing categories only; existing ones (and admin edits to them) are left untouched.
const cats = {};
for (const c of categoryData) {
  cats[c.slug] = await Category.findOneAndUpdate({ slug: c.slug }, { $setOnInsert: c }, { upsert: true, returnDocument: 'after' });
}

const storage = 'Store in a cool, dry place away from direct sunlight. Always use a clean, dry spoon. Keep the lid tightly closed. Refrigerate after opening if the label says so.';
const placeholderNote = '[PLACEHOLDER: replace with your actual recipe and label details]';

const products = [
  {
    name: 'Traditional Mango Achaar',
    slug: 'traditional-mango-achaar',
    category: cats.mango._id,
    shortDescription: 'Kachche aam ke tukde, sarson ke tel aur masalon ke saath, khatta aur teekha.',
    description: `Kachche aam ke crunchy tukde, sarson ka tel aur saboot masale. Dal-chawal, paratha ya khichdi ke saath perfect. ${placeholderNote}`,
    spiceLevel: 'medium',
    tasteNotes: ['tangy', 'spicy'],
    ingredients: 'Raw mango, mustard oil, salt, red chilli powder, fenugreek seeds, fennel seeds, turmeric, nigella seeds',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Paratha, dal-chawal, khichdi, curd rice.',
    accentColor: '#C9821F',
    isBestseller: true,
    sortOrder: 1,
    variants: [
      { label: '250 g', sku: 'ACH-MNG-250', netQuantity: '250 g', price: 199, mrp: 199, stock: 40, shippingWeightGrams: 400 },
      { label: '500 g', sku: 'ACH-MNG-500', netQuantity: '500 g', price: 349, mrp: 349, stock: 25, shippingWeightGrams: 700 },
    ],
  },
  {
    name: 'Nimbu Achaar',
    slug: 'nimbu-achaar',
    category: cats.lemon._id,
    shortDescription: 'Khatta-meetha nimbu achaar, halke masalon ke saath.',
    description: `Nimbu ke tukde namak aur masalon mein dhire-dhire tayyar. Halka khatta, halka teekha. ${placeholderNote}`,
    spiceLevel: 'mild',
    tasteNotes: ['tangy', 'mild'],
    ingredients: 'Lemon, salt, sugar, red chilli powder, turmeric, carom seeds',
    allergens: '',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Curd rice, poha, khichdi, upma.',
    accentColor: '#D4B32A',
    isBestseller: true,
    sortOrder: 2,
    variants: [
      { label: '250 g', sku: 'ACH-LMN-250', netQuantity: '250 g', price: 179, mrp: 179, stock: 30, shippingWeightGrams: 400 },
      { label: '500 g', sku: 'ACH-LMN-500', netQuantity: '500 g', price: 319, mrp: 319, stock: 20, shippingWeightGrams: 700 },
    ],
  },
  {
    name: 'Hari Mirch Achaar',
    slug: 'hari-mirch-achaar',
    category: cats.chilli._id,
    shortDescription: 'Hari mirch, rai aur nimbu ka teekha combo.',
    description: `Taazi hari mirch, rai aur nimbu ke ras ke saath. Teekha khaane walon ke liye. ${placeholderNote}`,
    spiceLevel: 'hot',
    tasteNotes: ['spicy', 'tangy'],
    ingredients: 'Green chilli, mustard oil, mustard seeds, salt, lemon juice, turmeric, fenugreek seeds',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Dal, sabzi-roti, pakode.',
    accentColor: '#4F6B3C',
    sortOrder: 3,
    variants: [{ label: '250 g', sku: 'ACH-GCH-250', netQuantity: '250 g', price: 169, mrp: 169, stock: 30, shippingWeightGrams: 400 }],
  },
  {
    name: 'Bharwa Lal Mirch Achaar',
    slug: 'bharwa-lal-mirch-achaar',
    category: cats.chilli._id,
    shortDescription: 'Masala bhari laal mirch, sarson ke tel mein.',
    description: `Moti laal mirch mein masala bhar ke sarson ke tel mein. Swaad mein teekha aur chatpata. ${placeholderNote}`,
    spiceLevel: 'hot',
    tasteNotes: ['spicy'],
    ingredients: 'Red chilli, mustard oil, fennel seeds, mustard seeds, salt, dry mango powder, turmeric, asafoetida',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Paratha, puri, dal-chawal.',
    accentColor: '#A8321F',
    isBestseller: true,
    sortOrder: 4,
    variants: [
      { label: '250 g', sku: 'ACH-RCH-250', netQuantity: '250 g', price: 229, mrp: 229, stock: 3, lowStockThreshold: 5, shippingWeightGrams: 400 },
    ],
  },
  {
    name: 'Mixed Vegetable Achaar',
    slug: 'mixed-vegetable-achaar',
    category: cats['mixed-vegetable']._id,
    shortDescription: 'Gajar, gobhi, shalgam aur hari mirch, ek hi jar mein.',
    description: `Mausami sabziyon ka mix, rai aur masalon ke saath. ${placeholderNote}`,
    spiceLevel: 'medium',
    tasteNotes: ['tangy', 'spicy'],
    ingredients: 'Carrot, cauliflower, turnip, green chilli, mustard oil, salt, mustard seeds, red chilli powder, turmeric',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Roti-sabzi, sandwich, pulao.',
    accentColor: '#B5562B',
    sortOrder: 5,
    variants: [
      { label: '250 g', sku: 'ACH-MIX-250', netQuantity: '250 g', price: 189, mrp: 189, stock: 25, shippingWeightGrams: 400 },
      { label: '500 g', sku: 'ACH-MIX-500', netQuantity: '500 g', price: 339, mrp: 339, stock: 0, shippingWeightGrams: 700 },
    ],
  },
  {
    name: 'Lehsun ka Achaar',
    slug: 'lehsun-ka-achaar',
    category: cats.garlic._id,
    shortDescription: 'Saboot lehsun ki kaliyan, laal mirch aur sarson ke tel mein. Teekha aur khushbudaar.',
    description: `Chhili hui lehsun ki kaliyan masalon aur sarson ke tel mein. Har bite mein lehsun ki khushbu aur halka teekhapan. ${placeholderNote}`,
    spiceLevel: 'hot',
    tasteNotes: ['spicy', 'garlicky'],
    ingredients: 'Garlic, mustard oil, red chilli powder, salt, mustard seeds, fenugreek seeds, turmeric, vinegar',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Dal-chawal, paratha, bajra roti, khichdi.',
    accentColor: '#C9A27A',
    sortOrder: 7,
    variants: [{ label: '250 g', sku: 'ACH-GRL-250', netQuantity: '250 g', price: 219, mrp: 219, stock: 20, shippingWeightGrams: 400 }],
  },
  {
    name: 'Adrak ka Achaar',
    slug: 'adrak-ka-achaar',
    category: cats.ginger._id,
    shortDescription: 'Taaze adrak ke lachhe, nimbu ke ras aur halke masalon ke saath. Zesty aur fresh.',
    description: `Patle kate adrak ke lachhe, nimbu ka ras aur halki mirch. Khaane ke saath ek taazgi bhara, tangy kick. ${placeholderNote}`,
    spiceLevel: 'mild',
    tasteNotes: ['tangy', 'zesty'],
    ingredients: 'Ginger, lemon juice, salt, green chilli, mustard seeds, turmeric',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Dal, sabzi-roti, curd rice, sandwich.',
    accentColor: '#D9B26A',
    sortOrder: 8,
    variants: [{ label: '200 g', sku: 'ACH-GNG-200', netQuantity: '200 g', price: 169, mrp: 169, stock: 20, shippingWeightGrams: 350 }],
  },
  {
    name: 'Meetha Aam Chunda',
    slug: 'meetha-aam-chunda',
    category: cats['sweet-achaar']._id,
    shortDescription: 'Kaddukas kiye kachche aam, cheeni aur halke masale. Khatta-meetha, bachchon ka favourite.',
    description: `Kaddukas kiye kachche aam ko cheeni ki chaashni aur halke masalon ke saath pakaya gaya. Paratha aur thepla ke saath lajawaab. ${placeholderNote}`,
    spiceLevel: 'mild',
    tasteNotes: ['sweet', 'tangy'],
    ingredients: 'Raw mango, sugar, salt, red chilli powder, cumin, cardamom',
    allergens: '',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Paratha, thepla, puri, bread.',
    accentColor: '#E9A23B',
    isBestseller: true,
    sortOrder: 9,
    variants: [
      { label: '250 g', sku: 'ACH-CHN-250', netQuantity: '250 g', price: 199, mrp: 199, stock: 25, shippingWeightGrams: 400 },
      { label: '500 g', sku: 'ACH-CHN-500', netQuantity: '500 g', price: 359, mrp: 359, stock: 15, shippingWeightGrams: 700 },
    ],
  },
  {
    name: 'Family Combo: Aam + Nimbu + Mirchi',
    slug: 'family-combo-aam-nimbu-mirchi',
    category: cats['combo-packs']._id,
    shortDescription: 'Teen favourite flavours, 3 × 250 g jars.',
    description: `Traditional Mango, Nimbu aur Hari Mirch achaar ka combo. Ghar ke liye ya gifting ke liye. ${placeholderNote}`,
    spiceLevel: 'medium',
    tasteNotes: ['tangy', 'spicy'],
    ingredients: 'See individual jar labels.',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see individual labels',
    servingIdeas: 'Everyday meals and gifting.',
    accentColor: '#8F2D24',
    sortOrder: 6,
    variants: [{ label: '3 × 250 g', sku: 'ACH-CMB-3X250', netQuantity: '750 g (3 × 250 g)', price: 499, mrp: 547, stock: 15, shippingWeightGrams: 1200 }],
  },
];

// More launch varieties (placeholders, same rules as above: replace with real recipes/prices).
products.push(
  {
    name: 'Punjabi Aam ka Achaar',
    slug: 'punjabi-aam-ka-achaar',
    category: cats.mango._id,
    shortDescription: 'Bade tukdon wala Punjabi style aam ka achaar, saunf aur kalonji ke saath.',
    description: `Moti guthli wale kachche aam ke bade tukde, saunf, kalonji aur sarson ke tel mein. Punjabi thaali ka asli saathi. ${placeholderNote}`,
    spiceLevel: 'hot',
    tasteNotes: ['spicy', 'tangy'],
    ingredients: 'Raw mango, mustard oil, salt, red chilli powder, fennel seeds, nigella seeds, fenugreek seeds, turmeric',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Aloo paratha, makki ki roti, rajma-chawal.',
    accentColor: '#D07A1C',
    sortOrder: 10,
    variants: [
      { label: '250 g', sku: 'ACH-PMG-250', netQuantity: '250 g', price: 209, mrp: 229, stock: 30, shippingWeightGrams: 400 },
      { label: '500 g', sku: 'ACH-PMG-500', netQuantity: '500 g', price: 369, mrp: 399, stock: 20, shippingWeightGrams: 700 },
      { label: '1 kg', sku: 'ACH-PMG-1000', netQuantity: '1 kg', price: 679, mrp: 749, stock: 10, shippingWeightGrams: 1300 },
    ],
  },
  {
    name: 'Nimbu Mirch Achaar',
    slug: 'nimbu-mirch-achaar',
    category: cats.lemon._id,
    shortDescription: 'Nimbu ki khatas aur hari mirch ka teekhapan, ek hi jar mein.',
    description: `Nimbu ke tukde aur hari mirch, namak aur masalon ke saath. Khatta bhi, teekha bhi. ${placeholderNote}`,
    spiceLevel: 'medium',
    tasteNotes: ['tangy', 'spicy'],
    ingredients: 'Lemon, green chilli, salt, mustard seeds, turmeric, fenugreek seeds, asafoetida',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Dal-chawal, khichdi, parathe.',
    accentColor: '#B8A428',
    sortOrder: 11,
    variants: [{ label: '250 g', sku: 'ACH-LMC-250', netQuantity: '250 g', price: 189, mrp: 189, stock: 25, shippingWeightGrams: 400 }],
  },
  {
    name: 'Gud Wala Meetha Nimbu',
    slug: 'gud-wala-meetha-nimbu',
    category: cats['sweet-achaar']._id,
    shortDescription: 'Gud aur nimbu ka khatta-meetha achaar, halki kaali mirch ke saath.',
    description: `Nimbu ke tukde gud ki chaashni mein, halki kaali mirch aur jeere ke saath. Bachchon ka favourite. ${placeholderNote}`,
    spiceLevel: 'mild',
    tasteNotes: ['sweet', 'tangy'],
    ingredients: 'Lemon, jaggery, salt, black pepper, cumin, carom seeds',
    allergens: '',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Paratha, puri, khichdi.',
    accentColor: '#9C5B1E',
    sortOrder: 12,
    variants: [
      { label: '250 g', sku: 'ACH-GLM-250', netQuantity: '250 g', price: 199, mrp: 199, stock: 20, shippingWeightGrams: 400 },
      { label: '500 g', sku: 'ACH-GLM-500', netQuantity: '500 g', price: 359, mrp: 359, stock: 12, shippingWeightGrams: 700 },
    ],
  },
  {
    name: 'Gajar Mooli Achaar',
    slug: 'gajar-mooli-achaar',
    category: cats['mixed-vegetable']._id,
    shortDescription: 'Sardiyon ka khaas: gajar aur mooli ke lambe tukde, rai ke masale mein.',
    description: `Taazi gajar aur mooli ke lambe tukde, rai aur laal mirch ke saath. Sardiyon ka pasandida achaar. ${placeholderNote}`,
    spiceLevel: 'medium',
    tasteNotes: ['tangy', 'spicy'],
    ingredients: 'Carrot, radish, mustard oil, mustard seeds, salt, red chilli powder, turmeric',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Makki ki roti, paratha, dal-chawal.',
    accentColor: '#D9622B',
    sortOrder: 13,
    variants: [{ label: '250 g', sku: 'ACH-GMO-250', netQuantity: '250 g', price: 179, mrp: 179, stock: 25, shippingWeightGrams: 400 }],
  },
  {
    name: 'Lehsun Mirch Achaar',
    slug: 'lehsun-mirch-achaar',
    category: cats.garlic._id,
    shortDescription: 'Lehsun aur hari mirch ka extra teekha combo. Teekhe ke shaukeenon ke liye.',
    description: `Lehsun ki kaliyan aur hari mirch, sarson ke tel aur masalon mein. Ek bite, poora swaad. ${placeholderNote}`,
    spiceLevel: 'hot',
    tasteNotes: ['spicy', 'garlicky'],
    ingredients: 'Garlic, green chilli, mustard oil, salt, mustard seeds, red chilli powder, turmeric',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Dal-baati, bajra roti, khichdi.',
    accentColor: '#7A8B3A',
    isBestseller: true,
    sortOrder: 14,
    variants: [{ label: '250 g', sku: 'ACH-GRC-250', netQuantity: '250 g', price: 229, mrp: 249, stock: 18, shippingWeightGrams: 400 }],
  },
  {
    name: 'Kachchi Haldi Adrak Achaar',
    slug: 'kachchi-haldi-adrak-achaar',
    category: cats.ginger._id,
    shortDescription: 'Kachchi haldi aur adrak ke lachhe, nimbu ke ras mein. Sardiyon ka special.',
    description: `Kachchi haldi aur adrak ke patle lachhe, nimbu ke ras aur namak ke saath. Halka teekha aur khushbudaar. ${placeholderNote}`,
    spiceLevel: 'mild',
    tasteNotes: ['zesty', 'tangy'],
    ingredients: 'Fresh turmeric root, ginger, lemon juice, salt, green chilli',
    allergens: '',
    storageInstructions: storage,
    shelfLife: 'Best before: see label',
    servingIdeas: 'Dal, sabzi-roti, khichdi.',
    accentColor: '#E3A21A',
    sortOrder: 15,
    variants: [{ label: '200 g', sku: 'ACH-HGA-200', netQuantity: '200 g', price: 189, mrp: 189, stock: 15, shippingWeightGrams: 350 }],
  },
  {
    name: 'Achaar Gift Box: 4 Flavours',
    slug: 'achaar-gift-box-4-flavours',
    category: cats['combo-packs']._id,
    shortDescription: 'Aam, Nimbu, Lehsun aur Meetha Chunda: 4 × 200 g jars, gift-ready box mein.',
    description: `Chaar pasandida flavours ek sundar gift box mein: Aam, Nimbu, Lehsun aur Meetha Chunda. Tyohaar aur gifting ke liye perfect. ${placeholderNote}`,
    spiceLevel: 'medium',
    tasteNotes: ['tangy', 'spicy', 'sweet'],
    ingredients: 'See individual jar labels.',
    allergens: 'Contains mustard.',
    storageInstructions: storage,
    shelfLife: 'Best before: see individual labels',
    servingIdeas: 'Gifting, family meals.',
    accentColor: '#8E3B2A',
    isBestseller: true,
    sortOrder: 16,
    variants: [{ label: '4 × 200 g', sku: 'ACH-GFT-4X200', netQuantity: '800 g (4 × 200 g)', price: 749, mrp: 816, stock: 10, shippingWeightGrams: 1500 }],
  },
);

let created = 0;
for (const p of products) {
  const exists = await Product.exists({ slug: p.slug });
  if (exists) continue;
  await Product.create({ ...p, status: 'published' });
  created++;
}
console.log(`Products: ${created} created, ${products.length - created} already existed.`);

await getSettings();
console.log('Store settings ready.');

const email = (process.env.SEED_ADMIN_EMAIL || '').toLowerCase().trim();
const password = process.env.SEED_ADMIN_PASSWORD || '';
if (email && password) {
  const existing = await AdminUser.findOne({ email });
  if (existing) {
    console.log(`Admin ${email} already exists (password unchanged).`);
  } else {
    if (password.length < 10) {
      console.warn('SEED_ADMIN_PASSWORD should be at least 10 characters; skipping admin creation.');
    } else {
      await AdminUser.create({
        name: process.env.SEED_ADMIN_NAME || 'Store Owner',
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'owner',
      });
      console.log(`Owner account created: ${email}. Log in to the admin panel (http://localhost:5174) and remove SEED_ADMIN_PASSWORD from .env afterwards.`);
    }
  }
} else {
  console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set; no admin created.');
}

await mongoose.disconnect();
