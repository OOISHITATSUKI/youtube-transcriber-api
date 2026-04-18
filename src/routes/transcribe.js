import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fetchTranscript, cleanupAudio } from '../services/youtube.js';
import { transcribeAudio } from '../services/whisper.js';

export const transcribeRouter = Router();

// File upload config
const storage = multer.diskStorage({
  destination: '/tmp/audio',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `upload_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(mp3|mp4|m4a|wav|webm|ogg|mov|flac)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format'));
    }
  },
});

// POST /api/transcribe — YouTube URL → fetch subtitles via innertube API
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
    const { transcript, title, duration } = await fetchTranscript(url);

    if (transcript) {
      return res.json({
        transcript,
        title,
        duration,
        isTruncated: false,
        processedDuration: duration,
        source: 'subtitles',
      });
    }

    // No subtitles available
    return res.status(422).json({
      error: 'No subtitles available for this video. Please upload the audio/video file for AI transcription.',
      code: 'UPLOAD_REQUIRED',
      title,
      duration,
    });

  } catch (error) {
    console.error('Transcript fetch error:', error);
    return res.status(422).json({
      error: 'Could not fetch subtitles. Please upload the audio/video file directly.',
      code: 'UPLOAD_REQUIRED',
    });
  }
});

// POST /api/transcribe/upload — File upload → Whisper API
transcribeRouter.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const audioPath = req.file.path;

  try {
    const transcript = await transcribeAudio(audioPath);

    res.json({
      transcript,
      title: req.file.originalname.replace(/\.[^.]+$/, ''),
      duration: 0,
      isTruncated: false,
      processedDuration: 0,
      source: 'whisper',
    });

  } catch (error) {
    console.error('Upload transcription error:', error);
    res.status(500).json({
      error: error.message || 'Transcription failed',
    });
  } finally {
    await cleanupAudio(audioPath);
  }
});
