import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { checkCredits, addCredits } from '../services/credits.js';

export const adminRouter = Router();

function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'] || req.query.password;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || password !== adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = (process.env.SUPABASE_SERVICE_KEY || '').replace(/\s+/g, '');
  if (!url || !key) return null;
  return createClient(url, key);
}

adminRouter.use(adminAuth);

// GET /api/admin/stats
adminRouter.get('/stats', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.json({ message: 'Supabase not configured', summary: {}, users: [], recentUsage: [] });
    }

    const { data: credits } = await db
      .from('user_credits')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    const { data: usage } = await db
      .from('credit_usage')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    const totalCredits = (credits || []).reduce((a, c) => a + c.credits_total, 0);
    const totalUsed = (usage || []).reduce((a, u) => a + u.credits_used, 0);

    res.json({
      summary: {
        totalUsers: (credits || []).length,
        totalCreditsPurchased: totalCredits,
        totalCreditsUsed: totalUsed,
      },
      users: credits || [],
      recentUsage: usage || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/test-credits
adminRouter.post('/test-credits', async (req, res) => {
  const { amount = 10 } = req.body;
  const adminToken = 'admin-test-token';

  try {
    const result = await addCredits(adminToken, amount);
    res.json({
      adminToken,
      creditsAdded: amount,
      creditsRemaining: result.creditsRemaining,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/check/:token
adminRouter.get('/check/:token', async (req, res) => {
  try {
    const result = await checkCredits(req.params.token);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
