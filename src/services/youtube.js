import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);

// Common yt-dlp args to avoid bot detection
const COMMON_ARGS = [
  '--no-check-certificates',
  '--no-cache-dir',
  '--extractor-args', 'youtube:player_client=web',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

export async function downloadAudio(url, maxSeconds = null) {
  const jobId = uuidv4();
  const outputDir = '/tmp/audio';
  const outputPath = path.join(outputDir, `${jobId}.%(ext)s`);

  try {
    // Get video metadata
    const { stdout: infoJson } = await execFileAsync('yt-dlp', [
      ...COMMON_ARGS,
      '--dump-json',
      '--no-download',
      url,
    ], { timeout: 60000 });

    const info = JSON.parse(infoJson);
    const duration = Math.ceil(info.duration);
    const title = info.title || 'Unknown video';

    // Download audio
    const ytdlpArgs = [
      ...COMMON_ARGS,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '4',
      '-o', outputPath,
      '--no-playlist',
      '--max-filesize', '50m',
    ];

    if (maxSeconds && duration > maxSeconds) {
      ytdlpArgs.push('--download-sections', `*0-${maxSeconds}`);
    }

    ytdlpArgs.push(url);

    await execFileAsync('yt-dlp', ytdlpArgs, { timeout: 180000 });

    const files = await fs.readdir(outputDir);
    const audioFile = files.find(f => f.startsWith(jobId));

    if (!audioFile) {
      throw new Error('Failed to generate audio file');
    }

    const audioPath = path.join(outputDir, audioFile);
    return { audioPath, title, duration, jobId };

  } catch (error) {
    try {
      const files = await fs.readdir(outputDir);
      for (const f of files) {
        if (f.startsWith(jobId)) {
          await fs.unlink(path.join(outputDir, f));
        }
      }
    } catch {}
    throw new Error(`Audio download failed: ${error.message}`);
  }
}

export async function cleanupAudio(audioPath) {
  try {
    await fs.unlink(audioPath);
  } catch {}
}
