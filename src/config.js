const env = process.env;

function corsOrigins(values) {
  const list = values.flatMap((v) => v.split(',')).map((v) => v.trim().replace(/\/$/, '')).filter(Boolean);
  return list.includes('*') ? true : list;
}

export const config = {
  port: Number(env.PORT || 5000),
  isProd: env.NODE_ENV === 'production',
  mongoUri: env.MONGODB_URI || '',
  jwtSecret: env.JWT_SECRET || '',
  // Public storefront URL, used in sitemap.xml and robots.txt. Empty = use the domain the request came in on.
  siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
  // Browser origins allowed to call the API (website and admin panel are deployed separately).
  // `*` allows any domain; otherwise a comma-separated list of origins.
  corsOrigins: corsOrigins([env.WEBSITE_ORIGIN || 'http://localhost:5173', env.ADMIN_ORIGIN || 'http://localhost:5174']),
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  // Unpaid online orders are cancelled (and stock released) after this many minutes.
  pendingPaymentTtlMinutes: 30,
};

export const razorpayEnabled = () => Boolean(config.razorpay.keyId && config.razorpay.keySecret);

export function assertConfig() {
  const problems = [];
  if (!config.mongoUri) problems.push('MONGODB_URI is not set (MongoDB Atlas connection string).');
  if (!config.jwtSecret || config.jwtSecret.length < 32 || config.jwtSecret.startsWith('change-me')) {
    problems.push('JWT_SECRET must be a random string of at least 32 characters.');
  }
  if (problems.length) {
    console.error(
      '\nConfiguration error. Fill in Acharbackend/.env (copy of .env.example), then run `npm run dev` from the Acharbackend folder:\n  - ' +
        problems.join('\n  - ') +
        '\n',
    );
    process.exit(1);
  }
}
