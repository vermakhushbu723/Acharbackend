import { Router } from 'express';
import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { asyncHandler } from '../lib/http.js';
import { config } from '../config.js';

/**
 * robots.txt and sitemap.xml for the storefront, generated from live data.
 * The website host should rewrite /robots.txt and /sitemap.xml to these routes (see README).
 */
const router = Router();

const STATIC_PAGES = [
  ['/', 'daily', '1.0'],
  ['/shop', 'daily', '0.9'],
  ['/shop?bestseller=1', 'weekly', '0.7'],
  ['/about', 'monthly', '0.5'],
  ['/our-process', 'monthly', '0.5'],
  ['/faqs', 'monthly', '0.5'],
  ['/contact', 'monthly', '0.4'],
  ['/track-order', 'monthly', '0.3'],
  ['/policies/shipping', 'yearly', '0.2'],
  ['/policies/returns', 'yearly', '0.2'],
  ['/policies/privacy', 'yearly', '0.2'],
  ['/policies/terms', 'yearly', '0.2'],
  ['/policies/food-safety', 'yearly', '0.2'],
];

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

router.get('/robots.txt', (_req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /cart',
      'Disallow: /checkout',
      'Disallow: /order/',
      'Disallow: /api/',
      'Disallow: /shop?q=',
      '',
      `Sitemap: ${config.siteUrl}/sitemap.xml`,
      '',
    ].join('\n'),
  );
});

router.get(
  '/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const [products, categories, productCounts] = await Promise.all([
      Product.find({ status: 'published' }).select('slug updatedAt images name').lean(),
      Category.find({ isActive: true }).select('slug updatedAt').lean(),
      Product.aggregate([{ $match: { status: 'published' } }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
    ]);
    const hasProducts = new Set(productCounts.map((c) => String(c._id)));

    const url = (loc, { lastmod, changefreq, priority, images = [] } = {}) =>
      [
        '  <url>',
        `    <loc>${xmlEscape(config.siteUrl + loc)}</loc>`,
        lastmod ? `    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : '',
        changefreq ? `    <changefreq>${changefreq}</changefreq>` : '',
        priority ? `    <priority>${priority}</priority>` : '',
        ...images.map((img) => `    <image:image><image:loc>${xmlEscape(img)}</image:loc></image:image>`),
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n');

    const entries = [
      ...STATIC_PAGES.map(([loc, changefreq, priority]) => url(loc, { changefreq, priority })),
      ...categories
        .filter((c) => hasProducts.has(String(c._id)))
        .map((c) => url(`/shop?category=${encodeURIComponent(c.slug)}`, { lastmod: c.updatedAt, changefreq: 'weekly', priority: '0.8' })),
      ...products.map((p) =>
        url(`/products/${encodeURIComponent(p.slug)}`, {
          lastmod: p.updatedAt,
          changefreq: 'weekly',
          priority: '0.8',
          images: (p.images || []).map((i) => (/^https?:/.test(i.url) ? i.url : config.siteUrl + i.url)),
        }),
      ),
    ];

    res
      .type('application/xml')
      .set('Cache-Control', 'public, max-age=3600')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries.join('\n')}\n</urlset>\n`,
      );
  }),
);

export default router;
