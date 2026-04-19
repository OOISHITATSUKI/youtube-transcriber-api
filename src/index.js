import dotenv from 'dotenv';
dotenv.config({ override: false });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { transcribeRouter } from './routes/transcribe.js';
import { summarizeRouter } from './routes/summarize.js';
import { audioTranscribeRouter } from './routes/audio-transcribe.js';
import { rateLimiter } from './middleware/rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// API routes (before static files)
app.use('/api/transcribe', rateLimiter, transcribeRouter);
app.use('/api/summarize', rateLimiter, summarizeRouter);
app.use('/api/audio-transcribe', rateLimiter, audioTranscribeRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend static files
const publicPath = path.resolve(__dirname, '..', 'public');

import fs from 'fs';
const indexExists = fs.existsSync(path.join(publicPath, 'index.html'));
console.log(`Public path: ${publicPath}, index.html exists: ${indexExists}`);

if (indexExists) {
  app.use(express.static(publicPath));

  // SPA fallback — all non-API routes serve index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({ error: 'Frontend not found', publicPath, cwd: process.cwd() });
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
