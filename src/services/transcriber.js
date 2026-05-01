const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const INNERTUBE_CLIENT_VERSION = '20.10.38';
const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: INNERTUBE_CLIENT_VERSION,
  },
};
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

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

  // Get caption tracks via InnerTube API (Android client)
  const playerRes = await fetch(INNERTUBE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': INNERTUBE_USER_AGENT,
    },
    body: JSON.stringify({
      context: INNERTUBE_CONTEXT,
      videoId,
    }),
  });

  if (!playerRes.ok) {
    throw new Error('Failed to get video info');
  }

  const playerData = await playerRes.json();

  if (playerData.playabilityStatus?.status === 'ERROR' ||
      playerData.playabilityStatus?.status === 'UNPLAYABLE') {
    throw new Error('Video is unavailable');
  }

  const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No transcript available for this video');
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

  // Parse XML
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

  // Format 1: <text start="..." dur="...">text</text> (classic)
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
