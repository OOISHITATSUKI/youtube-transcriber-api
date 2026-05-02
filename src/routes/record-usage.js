import { Router } from 'express';
import { consumeCredit, checkCredits } from '../services/credits.js';

export const recordUsageRouter = Router();

recordUsageRouter.post('/', async (req, res) => {
  const { sessionId, url, title, duration } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    const { isPaid } = await checkCredits(sessionId);
    if (!isPaid) {
      return res.json({ creditsRemaining: 0 });
    }

    const creditsNeeded = duration > 1200 ? 2 : 1;
    const result = await consumeCredit(sessionId, creditsNeeded, {
      type: 'youtube',
      url: url || '',
      fileName: title || '',
      duration: duration || 0,
    });

    res.json({ creditsRemaining: result.creditsRemaining });
  } catch (err) {
    console.error('Record usage error:', err);
    res.status(500).json({ error: 'Failed to record usage' });
  }
});
