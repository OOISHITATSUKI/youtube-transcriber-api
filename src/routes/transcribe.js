import { Router } from 'express';
import { transcribeVideo } from '../services/transcriber.js';
import { formatTranscript } from '../services/formatter.js';
import { generateFormattedSRT } from '../services/srtGenerator.js';
import { checkCredits, consumeCredit, recordUsage } from '../services/credits.js';

export const transcribeRouter = Router();

transcribeRouter.post('/', async (req, res) => {
  const { url, sessionId } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const youtubeRegex = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/)/;
  if (!youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Please enter a valid YouTube URL' });
  }

  try {
    const { isPaid } = await checkCredits(sessionId);
    const maxSeconds = isPaid ? null : 180;

    const result = await transcribeVideo(url, maxSeconds);

    // Speaker formatting
    let formattedTranscript = result.transcript;
    try {
      formattedTranscript = await formatTranscript(result.transcript);
    } catch (e) {
      console.error('Format error:', e);
    }

    // SRT
    let srt = '';
    try {
      srt = generateFormattedSRT(formattedTranscript);
    } catch (e) {
      console.error('SRT error:', e);
    }

    // Consume credit for paid users, record usage for all
    let creditsRemaining = 0;
    if (isPaid && sessionId) {
      const creditsNeeded = result.duration > 1200 ? 2 : 1;
      const consumption = await consumeCredit(sessionId, creditsNeeded, {
        type: 'youtube', url, duration: result.duration,
      });
      creditsRemaining = consumption.creditsRemaining;
    } else if (sessionId) {
      // Record free usage for history
      recordUsage(sessionId, {
        type: 'youtube_free',
        url,
        fileName: result.title,
        duration: result.duration,
        creditsUsed: 0,
      });
    }

    res.json({
      ...result,
      transcript: formattedTranscript,
      rawTranscript: result.transcript,
      srt,
      creditsRemaining,
    });

  } catch (error) {
    console.error('Transcription error:', error.message, error.stack);
    let errorMessage = 'Transcription failed';
    const msg = error.message || '';
    if (msg.includes('Invalid YouTube URL')) errorMessage = error.message;
    else if (msg.includes('No transcript') || msg.includes('Could not get') || msg.includes('not available')) errorMessage = msg;
    else if (msg.includes('disabled')) errorMessage = 'Transcripts are disabled for this video.';
    else if (msg.includes('Too many requests')) errorMessage = 'Too many requests. Please try again later.';
    else errorMessage = `Transcription failed: ${msg}`;
    res.status(500).json({ error: errorMessage });
  }
});
