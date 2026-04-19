import { Router } from 'express';
import { transcribeVideo } from '../services/transcriber.js';
import { formatTranscript } from '../services/formatter.js';
import { generateFormattedSRT } from '../services/srtGenerator.js';

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
    const maxSeconds = 180;
    const result = await transcribeVideo(url, maxSeconds);

    // Format transcript with speaker labels via Claude
    let formattedTranscript = result.transcript;
    try {
      formattedTranscript = await formatTranscript(result.transcript);
    } catch (formatError) {
      console.error('Format error (using raw transcript):', formatError);
    }

    // Generate SRT from formatted transcript
    let srt = '';
    try {
      srt = generateFormattedSRT(formattedTranscript);
    } catch (srtError) {
      console.error('SRT generation error:', srtError);
    }

    res.json({
      ...result,
      transcript: formattedTranscript,
      rawTranscript: result.transcript,
      srt,
    });

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
