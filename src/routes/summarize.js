import { Router } from 'express';
import { summarizeTranscript } from '../services/summarizer.js';

export const summarizeRouter = Router();

summarizeRouter.post('/', async (req, res) => {
  const { transcript } = req.body;

  if (!transcript) {
    return res.status(400).json({ error: 'Transcript text is required' });
  }

  try {
    const summary = await summarizeTranscript(transcript);
    res.json({ summary });
  } catch (error) {
    console.error('Summary error:', error);
    const cause = error.cause ? `(cause: ${error.cause.message || error.cause})` : '';
    res.status(500).json({ error: 'Summarization failed', debug: `${error.name}: ${error.message} ${cause}`, status: error.status || null });
  }
});
