import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { transcribeAudioFile } from '../services/whisper.js';
import { formatTranscript } from '../services/formatter.js';
import { generateFormattedSRT } from '../services/srtGenerator.js';
import { checkCredits, consumeCredit } from '../services/credits.js';
import { checkDailyLimit, incrementDailyCount } from '../services/rateLimitStore.js';

export const audioTranscribeRouter = Router();

const upload = multer({
  dest: '/tmp/audio-uploads/',
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.mp3', '.wav', '.m4a', '.mp4', '.ogg', '.flac', '.webm', '.mov'];
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Supported: MP3, WAV, M4A, MP4, OGG, FLAC, WebM'));
    }
  },
});

audioTranscribeRouter.post('/', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Audio file is required' });
  }

  const filePath = req.file.path;

  try {
    const sessionId = req.body.sessionId || null;
    const { isPaid, credits } = await checkCredits(sessionId);

    // Free user daily limit
    if (!isPaid) {
      const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      const { allowed } = checkDailyLimit(clientIp);
      if (!allowed) {
        return res.status(429).json({
          error: 'Daily free limit reached. Upgrade for unlimited access.',
          limitReached: true,
        });
      }
    }

    // Whisper API
    const { transcript, rawSegments, duration } = await transcribeAudioFile(filePath);

    const maxSeconds = isPaid ? Infinity : 180;
    const isTruncated = duration > maxSeconds && !isPaid;

    let limitedTranscript = transcript;
    let limitedSegments = rawSegments;

    if (isTruncated) {
      limitedSegments = rawSegments.filter(seg => (seg.offset / 1000) <= maxSeconds);
      limitedTranscript = limitedSegments.map(seg => {
        const totalSec = Math.floor(seg.offset / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}] ${seg.text}`;
      }).join('\n');
    }

    // Speaker formatting
    let formattedTranscript = limitedTranscript;
    try {
      formattedTranscript = await formatTranscript(limitedTranscript);
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

    // Consume credit or increment daily count
    if (isPaid) {
      const creditsNeeded = duration > 1200 ? 2 : 1;
      await consumeCredit(sessionId, creditsNeeded, {
        type: 'audio',
        fileName: req.file.originalname,
        duration,
      });
    } else {
      const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      incrementDailyCount(clientIp);
    }

    res.json({
      transcript: formattedTranscript,
      rawTranscript: limitedTranscript,
      srt,
      duration,
      isTruncated,
      processedDuration: Math.min(duration, maxSeconds),
      fileName: req.file.originalname,
    });

  } catch (error) {
    console.error('Audio transcription error:', error);
    res.status(500).json({ error: error.message || 'Transcription failed' });
  } finally {
    try { await fs.unlink(filePath); } catch {}
  }
});
