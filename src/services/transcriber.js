import { YoutubeTranscript } from 'youtube-transcript';

const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

// Multiple client configs to try (YouTube blocks some from certain IPs)
const CLIENTS = [
  {
    name: 'ANDROID',
    context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
  },
  {
    name: 'IOS',
    context: { client: { clientName: 'IOS', clientVersion: '20.10.38' } },
    ua: 'com.google.ios.youtube/20.10.38',
  },
  {
    name: 'TVHTML5_SIMPLY_EMBEDDED',
    context: { client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0' }, thirdParty: { embedUrl: 'https://www.google.com' } },
    ua: 'Mozilla/5.0',
  },
];

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

  // Try multiple clients until one works
  let playerData = null;
  let captionTracks = null;
  let lastError = '';

  for (const client of CLIENTS) {
    try {
      const res = await fetch(INNERTUBE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.ua,
        },
        body: JSON.stringify({
          context: client.context,
          videoId,
        }),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const status = data?.playabilityStatus?.status;

      if (status === 'LOGIN_REQUIRED' || status === 'ERROR' || status === 'UNPLAYABLE') {
        lastError = `${client.name}: ${status}`;
        continue;
      }

      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        playerData = data;
        captionTracks = tracks;
        break;
      }

      lastError = `${client.name}: no caption tracks (status: ${status})`;
    } catch (e) {
      lastError = `${client.name}: ${e.message}`;
    }
  }

  // Fallback: use youtube-transcript package
  if (!captionTracks || captionTracks.length === 0) {
    try {
      return await transcribeViaPackage(videoId, maxSeconds);
    } catch (pkgErr) {
      throw new Error(`No transcript available for this video (InnerTube: ${lastError}, Package: ${pkgErr.message})`);
    }
  }

  // Select best track (prefer ja > asr > en > first)
  let selectedTrack =
    captionTracks.find(t => t.languageCode === 'ja') ||
    captionTracks.find(t => t.kind === 'asr') ||
    captionTracks.find(t => t.languageCode === 'en') ||
    captionTracks[0];

  // Fetch the transcript XML
  const transcriptRes = await fetch(selectedTrack.baseUrl);
  const xmlText = await transcriptRes.text();

  if (!xmlText || xmlText.length === 0) {
    throw new Error('Failed to fetch transcript data');
  }

  const segments = parseTranscriptXML(xmlText);

  if (segments.length === 0) {
    throw new Error('No transcript available for this video');
  }

  // Calculate duration
  const lastSeg = segments[segments.length - 1];
  const duration = parseInt(playerData?.videoDetails?.lengthSeconds || '0') ||
    Math.ceil((lastSeg.offset + lastSeg.duration) / 1000);

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
    title: playerData?.videoDetails?.title || `YouTube Video (${videoId})`,
    isTruncated: maxSeconds ? duration > maxSeconds : false,
    processedDuration: maxSeconds ? Math.min(duration, maxSeconds) : duration,
    lang: selectedTrack.languageCode || 'auto',
    rawSegments: filteredContent,
  };
}

function parseTranscriptXML(xmlText) {
  const segments = [];

  // Format 1: <text start="..." dur="...">text</text>
  const regex1 = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  let match;
  while ((match = regex1.exec(xmlText)) !== null) {
    const start = parseFloat(match[1]) * 1000;
    const dur = parseFloat(match[2]) * 1000;
    const text = decodeEntities(match[3]);
    if (text) segments.push({ offset: start, duration: dur, text });
  }

  // Format 2: <p t="..." d="..."><s>text</s></p> (timedtext format 3)
  if (segments.length === 0) {
    const regex2 = /<p t="(\d+)"(?: d="(\d+)")?[^>]*><s[^>]*>([^<]*)<\/s><\/p>/g;
    while ((match = regex2.exec(xmlText)) !== null) {
      const start = parseInt(match[1]);
      const dur = parseInt(match[2] || '0');
      const text = decodeEntities(match[3]);
      if (text) segments.push({ offset: start, duration: dur, text });
    }
  }

  return segments;
}

async function transcribeViaPackage(videoId, maxSeconds) {
  const langAttempts = [undefined, 'ja', 'en'];
  let segments = null;
  let lang = 'auto';

  for (const tryLang of langAttempts) {
    try {
      const config = tryLang ? { lang: tryLang } : {};
      const data = await YoutubeTranscript.fetchTranscript(videoId, config);
      if (data && data.length > 0) {
        segments = data.map(s => ({
          offset: s.offset,
          duration: s.duration || 0,
          text: s.text.replace(/\n/g, ' ').trim(),
        }));
        lang = data[0]?.lang || tryLang || 'auto';
        break;
      }
    } catch (e) {
      if (e.message?.includes('disabled') || e.message?.includes('not available')) continue;
      throw e;
    }
  }

  if (!segments || segments.length === 0) {
    throw new Error('No transcript via package');
  }

  const lastSeg = segments[segments.length - 1];
  const duration = Math.ceil((lastSeg.offset + lastSeg.duration) / 1000);

  const filteredContent = maxSeconds
    ? segments.filter(seg => (seg.offset / 1000) <= maxSeconds)
    : segments;

  const transcript = filteredContent.map(seg => {
    const totalSec = Math.floor(seg.offset / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}] ${seg.text}`;
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

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n/g, ' ')
    .trim();
}
