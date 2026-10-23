import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config, assertConfig, razorpayEnabled } from './config.js';
import { connectDb } from './db.js';
import { errorMiddleware } from './lib/http.js';
import { expireUnpaidOrders } from './lib/orders.js';
import publicRoutes from './routes/public.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes, { webhookHandler } from './routes/payments.js';
import adminRoutes from './routes/admin.js';
import seoRoutes from './routes/seo.js';

assertConfig();

const app = express();
app.set('trust proxy', 1); // behind a managed host / CDN, so rate limits see the real client IP
app.disable('x-powered-by');

app.use(helmet()); // API only returns JSON; the website and admin apps set their own page headers.
app.use(cors({ origin: config.corsOrigins, credentials: true }));

// Webhook needs the raw body for signature verification, so it is registered before express.json.
app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), webhookHandler);

app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

app.use(seoRoutes); // /robots.txt and /sitemap.xml
app.get('/api/health', (_req, res) => res.json({ ok: true, onlinePayment: razorpayEnabled() }));
app.use('/api', publicRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorMiddleware);

await connectDb();
app.listen(config.port, () => {
  console.log(`Acharika API on http://localhost:${config.port} (online payment: ${razorpayEnabled() ? 'on' : 'off, COD only'})`);
});

// Release stock held by online orders that were never paid.
const sweep = () =>
  expireUnpaidOrders(config.pendingPaymentTtlMinutes)
    .then((n) => n && console.log(`Expired ${n} unpaid order(s)`))
    .catch((err) => console.error('expire sweep failed', err));
setInterval(sweep, 5 * 60_000).unref();
sweep();
