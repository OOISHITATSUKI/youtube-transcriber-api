import { Router } from 'express';
import { formatTranscript } from '../services/formatter.js';
import { generateFormattedSRT } from '../services/srtGenerator.js';
import { consumeCredit, checkCredits } from '../services/credits.js';

export const formatTranscriptRouter = Router();

formatTranscriptRouter.post('/', async (req, res) => {
  const { transcript, sessionId } = req.body;

  if (!transcript) {
    return res.status(400).json({ error: 'Transcript is required' });
  }

  try {
    // Format with Claude
    let formattedTranscript = transcript;
    try {
      formattedTranscript = await formatTranscript(transcript);
    } catch (e) {
      console.error('Format error:', e);
    }

    // Generate SRT
    let srt = '';
    try {
      srt = generateFormattedSRT(formattedTranscript);
    } catch (e) {
      console.error('SRT error:', e);
    }

    res.json({ transcript: formattedTranscript, srt });
  } catch (err) {
    console.error('Format transcript error:', err);
    res.status(500).json({ error: 'Failed to format transcript' });
  }
});
