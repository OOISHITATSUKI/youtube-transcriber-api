/**
 * YouTube transcript fetcher — scrapes video page for caption data.
 * No audio download, no yt-dlp needed.
 */

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function extractVideoId(url) {
  const m = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export async function fetchTranscript(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Invalid YouTube URL');

  // Step 1: Fetch video page HTML (with consent cookie to bypass EU consent screen)
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+634; SOCS=CAISEwgDEgk2ODA0MTMyNTQaAmVuIAEaBgiA_YGYOA',
    },
  });
  const html = await pageRes.text();

  // Step 2: Extract ytInitialPlayerResponse
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script)/s);
  if (!match) {
    throw new Error('Could not parse video page');
  }

  const data = JSON.parse(match[1]);
  const title = data.videoDetails?.title || 'YouTube Video';
  const duration = parseInt(data.videoDetails?.lengthSeconds || '0');

  // Step 3: Find caption tracks
  const hasCaptions = !!data.captions;
  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  console.log(`[${videoId}] hasCaptions: ${hasCaptions}, tracks: ${tracks?.length || 0}, playability: ${data.playabilityStatus?.status}`);
  if (!tracks || tracks.length === 0) {
    // Fallback: try innertube API with WEB client
    console.log(`[${videoId}] No tracks from page scrape, trying innertube API...`);
    const innerResult = await tryInnertubeApi(videoId);
    if (innerResult) {
      return { ...innerResult, title: innerResult.title || title, duration: innerResult.duration || duration };
    }
    return { transcript: null, title, duration };
  }

  // Prefer: English > auto-generated > first available
  const preferred =
    tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
    tracks.find(t => t.languageCode === 'en') ||
    tracks.find(t => t.kind === 'asr') ||
    tracks[0];

  if (!preferred?.baseUrl) {
    return { transcript: null, title, duration };
  }

  // Step 4: Fetch caption XML
  const capRes = await fetch(preferred.baseUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });
  const xml = await capRes.text();

  // Step 5: Parse
  const transcript = parseCaptionXml(xml);
  return { transcript, title, duration };
}

async function tryInnertubeApi(videoId) {
  const clients = [
    { name: 'WEB', version: '2.20241126', ua: USER_AGENT },
    { name: 'MWEB', version: '2.20241126', ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' },
    { name: 'TV_EMBEDDED', version: '2.0', ua: USER_AGENT },
  ];

  for (const client of clients) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.ua,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: client.name,
              clientVersion: client.version,
            },
          },
          videoId,
        }),
      });

      const data = await res.json();
      const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      console.log(`[${videoId}] innertube ${client.name}: tracks=${tracks?.length || 0}`);

      if (tracks && tracks.length > 0) {
        const preferred = tracks.find(t => t.languageCode === 'en') || tracks[0];
        const capRes = await fetch(preferred.baseUrl, { headers: { 'User-Agent': USER_AGENT } });
        const xml = await capRes.text();
        const transcript = parseCaptionXml(xml);
        const title = data.videoDetails?.title;
        const duration = parseInt(data.videoDetails?.lengthSeconds || '0');
        if (transcript) return { transcript, title, duration };
      }
    } catch (e) {
      console.log(`[${videoId}] innertube ${client.name} failed: ${e.message}`);
    }
  }
  return null;
}

function parseCaptionXml(xml) {
  const regex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([^<]*)<\/text>/g;
  const entries = [];
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const startSec = parseFloat(match[1]);
    const text = decodeHtmlEntities(match[3]).trim();
    if (!text) continue;

    const min = Math.floor(startSec / 60);
    const sec = Math.floor(startSec % 60);
    const timestamp = `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`;
    entries.push({ timestamp, text });
  }

  if (entries.length === 0) return null;

  // Deduplicate
  const deduped = [entries[0]];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].text !== entries[i - 1].text) {
      deduped.push(entries[i]);
    }
  }

  return deduped.map(e => `${e.timestamp} ${e.text}`).join('\n');
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\n/g, ' ');
}

export async function cleanupAudio(audioPath) {
  try {
    const { unlink } = await import('fs/promises');
    await unlink(audioPath);
  } catch {}
}
