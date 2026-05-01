import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Parse VTT subtitle content into segments with timestamps
 * Handles YouTube's duplicated auto-caption lines
 */
function parseVTT(vttContent) {
  const lines = vttContent.split('\n');
  const segments = [];
  let i = 0;

  // Skip header
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i];
    const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);

    if (timeMatch) {
      const startMs = (parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3])) * 1000 + parseInt(timeMatch[4]);
      const endMs = (parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7])) * 1000 + parseInt(timeMatch[8]);

      i++;
      let text = '';
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
        // Remove HTML tags and timestamps like <00:00:01.234>
        const cleaned = lines[i].replace(/<[^>]+>/g, '').trim();
        if (cleaned) text += (text ? ' ' : '') + cleaned;
        i++;
      }

      if (text) {
        segments.push({ offset: startMs, endMs, text, duration: endMs - startMs });
      }
    } else {
      i++;
    }
  }

  // Deduplicate: YouTube auto-captions repeat text with overlapping timestamps
  const deduped = [];
  const seen = new Set();
  for (const seg of segments) {
    const key = `${Math.floor(seg.offset / 1000)}_${seg.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(seg);
    }
  }

  return deduped;
}

/**
 * Parse JSON3 subtitle format (YouTube's native JSON)
 */
function parseJSON3(jsonContent) {
  const data = JSON.parse(jsonContent);
  const events = data.events || [];
  const segments = [];

  for (const event of events) {
    if (!event.segs || event.tStartMs === undefined) continue;
    const text = event.segs.map(s => s.utf8 || '').join('').trim();
    if (!text || text === '\n') continue;

    segments.push({
      offset: event.tStartMs,
      endMs: event.tStartMs + (event.dDurationMs || 0),
      text,
      duration: event.dDurationMs || 0,
    });
  }

  return segments;
}

export async function transcribeVideo(url, maxSeconds = null) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  const tmpDir = os.tmpdir();
  const outputTemplate = path.join(tmpDir, `yt-sub-${videoId}-${Date.now()}`);

  try {
    // First, try to get video title and available subs info
    let title = `YouTube Video (${videoId})`;
    try {
      const { stdout: infoJson } = await execFileAsync('yt-dlp', [
        '--dump-json',
        '--skip-download',
        '--no-warnings',
        `https://www.youtube.com/watch?v=${videoId}`,
      ], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      const info = JSON.parse(infoJson);
      title = info.title || title;
    } catch (e) {
      // Non-critical, continue without title
    }

    // Try JSON3 format first (easier to parse accurately)
    let segments = null;

    // Attempt 1: Get auto-generated subtitles in json3 format
    try {
      await execFileAsync('yt-dlp', [
        '--skip-download',
        '--write-auto-subs',
        '--sub-format', 'json3',
        '--sub-langs', 'ja,en,en-orig',
        '--output', outputTemplate,
        '--no-warnings',
        `https://www.youtube.com/watch?v=${videoId}`,
      ], { timeout: 30000 });

      // Find the downloaded subtitle file
      const subFile = findSubFile(outputTemplate, 'json3');
      if (subFile) {
        const content = fs.readFileSync(subFile, 'utf-8');
        segments = parseJSON3(content);
        fs.unlinkSync(subFile);
      }
    } catch (e) {
      // json3 failed, try VTT
    }

    // Attempt 2: Try VTT format
    if (!segments || segments.length === 0) {
      try {
        await execFileAsync('yt-dlp', [
          '--skip-download',
          '--write-auto-subs',
          '--write-subs',
          '--sub-format', 'vtt',
          '--sub-langs', 'ja,en,en-orig',
          '--output', outputTemplate,
          '--no-warnings',
          `https://www.youtube.com/watch?v=${videoId}`,
        ], { timeout: 30000 });

        const subFile = findSubFile(outputTemplate, 'vtt');
        if (subFile) {
          const content = fs.readFileSync(subFile, 'utf-8');
          segments = parseVTT(content);
          fs.unlinkSync(subFile);
        }
      } catch (e) {
        // VTT also failed
      }
    }

    if (!segments || segments.length === 0) {
      throw new Error('No transcript available for this video');
    }

    // Calculate duration
    const lastSeg = segments[segments.length - 1];
    const duration = lastSeg ? Math.ceil((lastSeg.offset + (lastSeg.duration || 0)) / 1000) : 0;

    // Truncate for free users
    const filteredContent = maxSeconds
      ? segments.filter(seg => (seg.offset / 1000) <= maxSeconds)
      : segments;

    // Format with timestamps
    const transcript = filteredContent.map(seg => {
      const totalSec = Math.floor(seg.offset / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      const timestamp = `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`;
      return `${timestamp} ${seg.text}`;
    }).join('\n');

    return {
      transcript,
      duration,
      title,
      isTruncated: maxSeconds ? duration > maxSeconds : false,
      processedDuration: maxSeconds ? Math.min(duration, maxSeconds) : duration,
      lang: 'auto',
      rawSegments: filteredContent,
    };

  } finally {
    // Cleanup any remaining temp files
    cleanupTempFiles(outputTemplate);
  }
}

function findSubFile(basePath, ext) {
  const dir = path.dirname(basePath);
  const base = path.basename(basePath);
  try {
    const files = fs.readdirSync(dir);
    const match = files.find(f => f.startsWith(base) && f.endsWith(`.${ext}`));
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

function cleanupTempFiles(basePath) {
  const dir = path.dirname(basePath);
  const base = path.basename(basePath);
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.startsWith(base)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  } catch {}
}
