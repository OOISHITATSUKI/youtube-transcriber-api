import OpenAI from 'openai';
import fs from 'fs';

let openai;
function getClient() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

export async function transcribeAudio(audioPath) {
  const audioFile = fs.createReadStream(audioPath);

  const transcription = await getClient().audio.transcriptions.create({
    model: 'whisper-1',
    file: audioFile,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  const segments = transcription.segments || [];

  if (segments.length === 0) {
    return transcription.text || '';
  }

  const formattedText = segments.map(seg => {
    const startMin = Math.floor(seg.start / 60);
    const startSec = Math.floor(seg.start % 60);
    const timestamp = `[${String(startMin).padStart(2, '0')}:${String(startSec).padStart(2, '0')}]`;
    return `${timestamp} ${seg.text.trim()}`;
  }).join('\n');

  return formattedText;
}
