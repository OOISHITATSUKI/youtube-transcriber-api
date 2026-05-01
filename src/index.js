import dotenv from 'dotenv';
dotenv.config({ override: false });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { transcribeRouter } from './routes/transcribe.js';
import { summarizeRouter } from './routes/summarize.js';
import { audioTranscribeRouter } from './routes/audio-transcribe.js';
import { checkoutRouter } from './routes/checkout.js';
import { webhookRouter } from './routes/webhook.js';
import { verifyPaymentRouter } from './routes/verify-payment.js';
import { adminRouter } from './routes/admin.js';
import { seoAdviceRouter } from './routes/seo-advice.js';
import { rateLimiter } from './middleware/rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_HOST = 'yt-transcriber.com';

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// 301 redirect: Railway URL → canonical domain (production only)
app.use((req, res, next) => {
  // Skip in dev
  if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT) {
    return next();
  }
  // Skip health check
  if (req.path === '/health') return next();
  // Skip API routes
  if (req.path.startsWith('/api/')) return next();

  const host = req.hostname;
  if (host === CANONICAL_HOST || host === `www.${CANONICAL_HOST}` || host === 'localhost') {
    return next();
  }

  // Redirect to canonical domain
  const redirectUrl = `https://${CANONICAL_HOST}${req.originalUrl}`;
  return res.redirect(301, redirectUrl);
});

// Stripe webhook needs raw body — mount before json parser
app.use('/api/webhook', webhookRouter);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow Chrome extension origins
    if (origin.startsWith('chrome-extension://')) return callback(null, true);
    // Allow configured frontend URL or all
    const allowed = process.env.FRONTEND_URL || '*';
    if (allowed === '*') return callback(null, true);
    if (origin === allowed) return callback(null, true);
    // Allow same-domain
    if (origin.includes('yt-transcriber.com')) return callback(null, true);
    callback(null, true);
  }
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// API routes
app.use('/api/transcribe', rateLimiter, transcribeRouter);
app.use('/api/summarize', rateLimiter, summarizeRouter);
app.use('/api/audio-transcribe', rateLimiter, audioTranscribeRouter);
app.use('/api/checkout', checkoutRouter);
app.use('/api/verify-payment', verifyPaymentRouter);
app.use('/api/admin', adminRouter);
app.use('/api/seo-advice', rateLimiter, seoAdviceRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend
const publicPath = path.resolve(__dirname, '..', 'public');
if (fs.existsSync(path.join(publicPath, 'index.html'))) {
  app.use(express.static(publicPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
