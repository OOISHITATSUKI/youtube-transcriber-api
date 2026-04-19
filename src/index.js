import dotenv from 'dotenv';
dotenv.config({ override: false });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { transcribeRouter } from './routes/transcribe.js';
import { summarizeRouter } from './routes/summarize.js';
import { rateLimiter } from './middleware/rateLimit.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
}));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimiter);

app.use('/api/transcribe', transcribeRouter);
app.use('/api/summarize', summarizeRouter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      SUPADATA: process.env.SUPADATA_API_KEY ? 'ok' : 'MISSING',
      ANTHROPIC: process.env.ANTHROPIC_API_KEY ? `${process.env.ANTHROPIC_API_KEY.substring(0, 10)}...` : 'MISSING',
    },
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
