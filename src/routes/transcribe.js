import { Router } from 'express';
import { transcribeVideo } from '../services/transcriber.js';
import { formatTranscript } from '../services/formatter.js';
import { generateFormattedSRT } from '../services/srtGenerator.js';
import { checkCredits, consumeCredit } from '../services/credits.js';

export const transcribeRouter = Router();

transcribeRouter.post('/', async (req, res) => {
  const { url, sessionId } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)/;
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

    // Consume credit for paid users
    let creditsRemaining = 0;
    if (isPaid && sessionId) {
      const creditsNeeded = result.duration > 1200 ? 2 : 1;
      const consumption = await consumeCredit(sessionId, creditsNeeded, {
        type: 'youtube', url, duration: result.duration,
      });
      creditsRemaining = consumption.creditsRemaining;
    }

    res.json({
      ...result,
      transcript: formattedTranscript,
      rawTranscript: result.transcript,
      srt,
      creditsRemaining,
    });

  } catch (error) {
    console.error('Transcription error:', error);
    let errorMessage = 'Transcription failed';
    if (error.message.includes('Invalid YouTube URL')) errorMessage = error.message;
    else if (error.message.includes('No transcript')) errorMessage = 'No transcript available for this video.';
    res.status(500).json({ error: errorMessage });
  }
});
