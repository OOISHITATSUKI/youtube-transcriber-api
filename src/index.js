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
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// API routes
app.use('/api/transcribe', rateLimiter, transcribeRouter);
app.use('/api/summarize', rateLimiter, summarizeRouter);
app.use('/api/audio-transcribe', rateLimiter, audioTranscribeRouter);
app.use('/api/checkout', checkoutRouter);
app.use('/api/verify-payment', verifyPaymentRouter);
app.use('/api/admin', adminRouter);

// Temporary debug — remove after confirming
app.get('/debug-env', (req, res) => {
  const envKeys = Object.keys(process.env).filter(k =>
    ['ADMIN', 'STRIPE', 'SUPABASE', 'OPENAI', 'SUPADATA', 'ANTHROPIC', 'FRONTEND', 'NODE_ENV', 'RAILWAY'].some(prefix => k.toUpperCase().includes(prefix))
  );
  res.json(envKeys.map(k => ({ key: k, hasValue: !!process.env[k], len: process.env[k]?.length })));
});

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
