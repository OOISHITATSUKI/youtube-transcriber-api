import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { transcribeRouter } from './routes/transcribe.js';
import { summarizeRouter } from './routes/summarize.js';
import { rateLimiter } from './middleware/rateLimit.js';

const app = express();
const PORT = process.env.PORT || 3000;

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
      SUPADATA_API_KEY: process.env.SUPADATA_API_KEY ? `${process.env.SUPADATA_API_KEY.substring(0, 8)}...` : 'MISSING',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING',
    },
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`SUPADATA_API_KEY: ${process.env.SUPADATA_API_KEY ? 'set' : 'MISSING'}`);
});
