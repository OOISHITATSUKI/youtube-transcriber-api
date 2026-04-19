import OpenAI, { toFile } from 'openai';
import fs from 'fs';
import path from 'path';

let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    const key = (process.env.OPENAI_API_KEY || '').replace(/\s+/g, '');
    if (!key) throw new Error('OPENAI_API_KEY is not set');
    openaiClient = new OpenAI({ apiKey: key });
  }
  return openaiClient;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
    '.mpeg': 'audio/mpeg',
    '.mpga': 'audio/mpeg',
    '.mov': 'audio/mp4',
  };
  return mimeMap[ext] || 'audio/mpeg';
}

export async function transcribeAudioFile(filePath, language = 'ja') {
  const client = getClient();

  const fileName = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  const file = await toFile(buffer, fileName, { type: getMimeType(filePath) });

  const transcription = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file: file,
    language: language,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  const segments = transcription.segments || [];

  const transcript = segments.map(seg => {
    const min = Math.floor(seg.start / 60);
    const sec = Math.floor(seg.start % 60);
    const timestamp = `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`;
    return `${timestamp} ${seg.text.trim()}`;
  }).join('\n');

  const rawSegments = segments.map(seg => ({
    text: seg.text.trim(),
    offset: Math.round(seg.start * 1000),
    duration: Math.round((seg.end - seg.start) * 1000),
  }));

  const duration = segments.length > 0
    ? Math.ceil(segments[segments.length - 1].end)
    : 0;

  return { transcript, rawSegments, duration };
}
