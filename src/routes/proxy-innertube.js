import { Router } from 'express';

export const proxyInnertubeRouter = Router();

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

const CLIENTS = [
  {
    context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
  },
  {
    context: { client: { clientName: 'IOS', clientVersion: '20.10.38' } },
    ua: 'com.google.ios.youtube/20.10.38',
  },
  {
    context: { client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0' }, thirdParty: { embedUrl: 'https://www.google.com' } },
    ua: 'Mozilla/5.0',
  },
];

// POST /api/innertube - proxy InnerTube player request
proxyInnertubeRouter.post('/', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  let lastError = '';

  for (const client of CLIENTS) {
    try {
      const ytRes = await fetch(INNERTUBE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.ua,
        },
        body: JSON.stringify({ context: client.context, videoId }),
      });

      if (!ytRes.ok) { lastError = `HTTP ${ytRes.status}`; continue; }

      const data = await ytRes.json();
      const status = data?.playabilityStatus?.status;

      if (status === 'LOGIN_REQUIRED' || status === 'ERROR') {
        lastError = status;
        continue;
      }

      // Return full player response to client
      return res.json(data);
    } catch (e) {
      lastError = e.message;
    }
  }

  res.status(502).json({ error: `YouTube API unavailable (${lastError})` });
});

// POST /api/innertube/captions - proxy caption XML fetch
proxyInnertubeRouter.post('/captions', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const ytRes = await fetch(url);
    const text = await ytRes.text();
    res.set('Content-Type', 'text/xml');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch captions' });
  }
});
