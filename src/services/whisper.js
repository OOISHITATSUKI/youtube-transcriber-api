import OpenAI, { toFile } from 'openai';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);

let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    const key = (process.env.OPENAI_API_KEY || '').replace(/\s+/g, '');
    if (!key) throw new Error('OPENAI_API_KEY is not set');
    openaiClient = new OpenAI({ apiKey: key });
  }
  return openaiClient;
}

const WHISPER_MAX_SIZE = 24 * 1024 * 1024; // 24MB (safe margin under 25MB limit)
const CHUNK_DURATION = 600; // 10 minutes per chunk

/**
 * Get audio duration in seconds using ffprobe
 */
async function getAudioDuration(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

/**
 * Compress audio to mono MP3 16kHz (optimal for Whisper)
 * Returns path to compressed file
 */
async function compressAudio(filePath) {
  const outPath = path.join(path.dirname(filePath), `compressed_${uuidv4()}.mp3`);
  await execFileAsync('ffmpeg', [
    '-i', filePath,
    '-vn',              // strip video
    '-ac', '1',         // mono
    '-ar', '16000',     // 16kHz (Whisper's native rate)
    '-b:a', '32k',      // 32kbps (sufficient for speech)
    '-map_metadata', '-1', // strip metadata
    '-y',               // overwrite
    outPath,
  ]);
  return outPath;
}

/**
 * Split audio into chunks of CHUNK_DURATION seconds
 * Returns array of { path, startOffset } objects
 */
async function splitAudio(filePath, totalDuration) {
  const chunks = [];
  for (let start = 0; start < totalDuration; start += CHUNK_DURATION) {
    const chunkPath = path.join(path.dirname(filePath), `chunk_${uuidv4()}.mp3`);
    await execFileAsync('ffmpeg', [
      '-i', filePath,
      '-ss', String(start),
      '-t', String(CHUNK_DURATION),
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k',
      '-y',
      chunkPath,
    ]);
    chunks.push({ path: chunkPath, startOffset: start });
  }
  return chunks;
}

/**
 * Transcribe a single file with Whisper API
 */
async function transcribeSingle(filePath, language) {
  const client = getClient();
  const fileName = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  const file = await toFile(buffer, fileName, { type: 'audio/mpeg' });

  const transcription = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  return transcription.segments || [];
}

/**
 * Safely delete temporary files
 */
async function cleanupFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch {}
  }
}

/**
 * Main transcription function with compression and chunking
 */
export async function transcribeAudioFile(filePath, language = 'ja') {
  const tempFiles = [];

  try {
    // Step 1: Compress to mono MP3 16kHz
    console.log(`[whisper] Compressing audio: ${filePath}`);
    const compressedPath = await compressAudio(filePath);
    tempFiles.push(compressedPath);

    const compressedSize = fs.statSync(compressedPath).size;
    const compressedMB = (compressedSize / 1024 / 1024).toFixed(1);
    console.log(`[whisper] Compressed: ${compressedMB}MB`);

    let allSegments = [];

    if (compressedSize <= WHISPER_MAX_SIZE) {
      // Small enough to send directly
      console.log('[whisper] Sending directly to Whisper API');
      allSegments = await transcribeSingle(compressedPath, language);
    } else {
      // Need to split into chunks
      const totalDuration = await getAudioDuration(compressedPath);
      console.log(`[whisper] File too large, splitting ${Math.ceil(totalDuration)}s into chunks`);

      const chunks = await splitAudio(compressedPath, totalDuration);
      tempFiles.push(...chunks.map(c => c.path));

      // Transcribe chunks in parallel (max 3 concurrent)
      const CONCURRENCY = 3;
      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const batch = chunks.slice(i, i + CONCURRENCY);
        console.log(`[whisper] Processing chunks ${i + 1}-${i + batch.length} of ${chunks.length}`);

        const results = await Promise.all(
          batch.map(async (chunk) => {
            const segments = await transcribeSingle(chunk.path, language);
            // Offset timestamps by chunk's start position
            return segments.map(seg => ({
              ...seg,
              start: seg.start + chunk.startOffset,
              end: seg.end + chunk.startOffset,
            }));
          })
        );

        for (const segments of results) {
          allSegments.push(...segments);
        }
      }

      // Sort by start time (parallel results may be out of order)
      allSegments.sort((a, b) => a.start - b.start);
    }

    // Build transcript with timestamps
    const transcript = allSegments.map(seg => {
      const min = Math.floor(seg.start / 60);
      const sec = Math.floor(seg.start % 60);
      const timestamp = `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`;
      return `${timestamp} ${seg.text.trim()}`;
    }).join('\n');

    const rawSegments = allSegments.map(seg => ({
      text: seg.text.trim(),
      offset: Math.round(seg.start * 1000),
      duration: Math.round((seg.end - seg.start) * 1000),
    }));

    const duration = allSegments.length > 0
      ? Math.ceil(allSegments[allSegments.length - 1].end)
      : 0;

    console.log(`[whisper] Done: ${duration}s, ${allSegments.length} segments`);

    return { transcript, rawSegments, duration };

  } finally {
    cleanupFiles(tempFiles);
  }
}
