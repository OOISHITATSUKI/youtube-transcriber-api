import { Router } from 'express';
import { transcribeVideo } from '../services/transcriber.js';

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

  try {
    // Free tier: 180 seconds
    const maxSeconds = 180;
    const result = await transcribeVideo(url, maxSeconds);
    res.json(result);

  } catch (error) {
    console.error('Transcription error:', error);

    let errorMessage = 'Transcription failed';
    if (error.message.includes('Invalid YouTube URL')) {
      errorMessage = error.message;
    } else if (error.message.includes('not-found') || error.message.includes('video')) {
      errorMessage = 'Video not found. Please check the URL.';
    } else if (error.message.includes('No transcript')) {
      errorMessage = 'No transcript available for this video.';
    }

    res.status(500).json({ error: errorMessage });
  }
});
