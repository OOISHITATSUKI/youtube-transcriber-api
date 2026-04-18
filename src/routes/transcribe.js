import { Router } from 'express';
import { downloadAudio, cleanupAudio } from '../services/youtube.js';
import { transcribeAudio } from '../services/whisper.js';

export const transcribeRouter = Router();

transcribeRouter.post('/', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)/;
  if (!youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Please enter a valid YouTube URL' });
  }

  let audioPath = null;

  try {
    // Free tier: first 180 seconds
    const maxSeconds = 180;

    const { audioPath: path, title, duration } = await downloadAudio(url, maxSeconds);
    audioPath = path;

    const transcript = await transcribeAudio(audioPath);

    res.json({
      transcript,
      title,
      duration,
      isTruncated: duration > maxSeconds,
      processedDuration: Math.min(duration, maxSeconds),
    });

  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({
      error: error.message || 'Transcription failed',
    });
  } finally {
    if (audioPath) await cleanupAudio(audioPath);
  }
});
