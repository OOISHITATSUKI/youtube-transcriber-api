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
import { rateLimiter } from './middleware/rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

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
