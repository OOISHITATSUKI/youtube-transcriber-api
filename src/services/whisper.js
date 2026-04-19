import OpenAI from 'openai';
import fs from 'fs';

let openai;
function getClient() {
  if (!openai) {
    const key = (process.env.OPENAI_API_KEY || '').replace(/\s+/g, '');
    if (!key) throw new Error('OPENAI_API_KEY is not set');
    openai = new OpenAI({ apiKey: key });
  }
  return openai;
}

export async function transcribeAudioFile(filePath, language = 'ja') {
  const audioFile = fs.createReadStream(filePath);

  const transcription = await getClient().audio.transcriptions.create({
    model: 'whisper-1',
    file: audioFile,
    language,
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
