import { YoutubeTranscript } from 'youtube-transcript';

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

export async function transcribeVideo(url, maxSeconds = null) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  // Try preferred languages in order: ja, en, then any available
  let segments = null;
  let lang = 'unknown';

  const langAttempts = ['ja', 'en', undefined]; // undefined = default/any

  for (const tryLang of langAttempts) {
    try {
      const config = tryLang ? { lang: tryLang } : {};
      const data = await YoutubeTranscript.fetchTranscript(videoId, config);
      if (data && data.length > 0) {
        segments = data;
        lang = data[0]?.lang || tryLang || 'auto';
        break;
      }
    } catch (e) {
      // If "no transcript" error, try next language
      if (!e.message?.includes('Could not get the transcript') &&
          !e.message?.includes('No transcript')) {
        throw e;
      }
    }
  }

  if (!segments || segments.length === 0) {
    throw new Error('No transcript available for this video');
  }

  // Calculate duration from last segment
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
    const text = seg.text.replace(/\n/g, ' ').trim();
    return `${timestamp} ${text}`;
  }).join('\n');

  return {
    transcript,
    duration,
    title: `YouTube Video (${videoId})`,
    isTruncated: maxSeconds ? duration > maxSeconds : false,
    processedDuration: maxSeconds ? Math.min(duration, maxSeconds) : duration,
    lang,
    rawSegments: filteredContent,
  };
}
