import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { downloadAudio, cleanupAudio } from '../services/youtube.js';
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
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB (Whisper API limit)
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/x-m4a', 'audio/m4a', 'video/mp4', 'video/webm', 'video/quicktime'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|mp4|m4a|wav|webm|ogg|mov)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format'));
    }
  },
});

// POST /api/transcribe — YouTube URL
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
    const maxSeconds = 180;
    const { audioPath: dlPath, title, duration } = await downloadAudio(url, maxSeconds);
    audioPath = dlPath;

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

    // If yt-dlp fails, tell frontend to use file upload
    if (error.message.includes('download failed') || error.message.includes('bot')) {
      return res.status(422).json({
        error: 'YouTube download blocked. Please upload the audio/video file directly.',
        code: 'UPLOAD_REQUIRED',
      });
    }

    res.status(500).json({
      error: error.message || 'Transcription failed',
    });
  } finally {
    if (audioPath) await cleanupAudio(audioPath);
  }
});

// POST /api/transcribe/upload — Direct file upload
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
      duration: 0, // Unknown from file upload
      isTruncated: false,
      processedDuration: 0,
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
