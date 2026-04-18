import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import http from 'http';

const execFileAsync = promisify(execFile);

/**
 * Download a file from URL to local path
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = require('fs').createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed with status ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', (err) => { file.close(); reject(err); });
  });
}

/**
 * Extract video ID from YouTube URL
 */
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Get video info using yt-dlp (metadata only, no download)
 * Falls back to basic info if bot-detected
 */
async function getVideoInfo(url) {
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--dump-json',
      '--no-download',
      '--no-check-certificates',
      '--extractor-args', 'youtube:player_client=ios',
      url,
    ], { timeout: 30000 });
    const info = JSON.parse(stdout);
    return { title: info.title || 'Unknown', duration: Math.ceil(info.duration || 0) };
  } catch {
    // Fallback: return minimal info
    return { title: 'YouTube Video', duration: 0 };
  }
}

/**
 * Download audio using yt-dlp with multiple client fallbacks
 */
async function downloadWithYtdlp(url, outputPath) {
  const clients = ['ios', 'android', 'web_embedded', 'tv'];

  for (const client of clients) {
    try {
      await execFileAsync('yt-dlp', [
        '--no-check-certificates',
        '--no-cache-dir',
        '--extractor-args', `youtube:player_client=${client}`,
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '4',
        '-o', outputPath,
        '--no-playlist',
        '--max-filesize', '50m',
        url,
      ], { timeout: 180000 });
      return true;
    } catch (err) {
      console.log(`yt-dlp client ${client} failed, trying next...`);
      continue;
    }
  }
  return false;
}

export async function downloadAudio(url, maxSeconds = null) {
  const jobId = uuidv4();
  const outputDir = '/tmp/audio';
  const outputPath = path.join(outputDir, `${jobId}.%(ext)s`);
  const mp3Path = path.join(outputDir, `${jobId}.mp3`);

  try {
    // Get video info
    const { title, duration } = await getVideoInfo(url);

    // Try yt-dlp with multiple clients
    let success = await downloadWithYtdlp(url, outputPath);

    // If all yt-dlp clients fail, try direct audio extraction via yt-dlp with different approach
    if (!success) {
      try {
        await execFileAsync('yt-dlp', [
          '--no-check-certificates',
          '-f', 'bestaudio[ext=m4a]/bestaudio',
          '-o', mp3Path,
          '--no-playlist',
          url,
        ], { timeout: 180000 });
        success = true;
      } catch {
        throw new Error('All download methods failed. YouTube may be blocking this server.');
      }
    }

    // Find the output file
    const files = await fs.readdir(outputDir);
    const audioFile = files.find(f => f.startsWith(jobId));

    if (!audioFile) {
      throw new Error('Failed to generate audio file');
    }

    const audioPath = path.join(outputDir, audioFile);

    // If we need to truncate and have ffmpeg
    if (maxSeconds && duration > maxSeconds) {
      const truncatedPath = path.join(outputDir, `${jobId}_cut.mp3`);
      try {
        await execFileAsync('ffmpeg', [
          '-i', audioPath,
          '-t', String(maxSeconds),
          '-c', 'copy',
          truncatedPath,
        ], { timeout: 30000 });
        await fs.unlink(audioPath);
        return { audioPath: truncatedPath, title, duration, jobId };
      } catch {
        // If ffmpeg truncation fails, return full file
      }
    }

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
