import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const authRouter = Router();

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = (process.env.SUPABASE_SERVICE_KEY || '').replace(/\s+/g, '');
  if (url && key) return createClient(url, key);
  return null;
}

// POST /api/auth/google - Verify Google token and return/create user
authRouter.post('/google', async (req, res) => {
  const { token, email, name, googleId } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Verify Google token (optional - if token provided, verify with Google)
    if (token) {
      const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
      if (!googleRes.ok) {
        return res.status(401).json({ error: 'Invalid Google token' });
      }
      const googleData = await googleRes.json();
      if (googleData.email !== email) {
        return res.status(401).json({ error: 'Email mismatch' });
      }
    }

    const db = getDb();
    if (!db) {
      // Fallback: just return a token based on email
      const userToken = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
      return res.json({ userToken, email, credits: 0 });
    }

    // Check if user exists in users table
    let { data: user } = await db
      .from('users')
      .select('user_token, email, name')
      .eq('email', email)
      .single();

    let userToken;

    if (user) {
      userToken = user.user_token;
    } else {
      // Create new user
      userToken = crypto.randomUUID();
      await db.from('users').insert({
        user_token: userToken,
        email,
        name: name || '',
        google_id: googleId || '',
      });
    }

    // Get credits
    let credits = 0;
    const { data: creditData } = await db
      .from('user_credits')
      .select('credits_remaining')
      .eq('user_token', userToken)
      .single();

    if (creditData) {
      credits = creditData.credits_remaining;
    }

    res.json({ userToken, email, name: user?.name || name, credits });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// GET /api/auth/me - Get current user info
authRouter.get('/me', async (req, res) => {
  const userToken = req.headers['x-user-token'] || req.query.token;
  if (!userToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database unavailable' });
    }

    const { data: user } = await db
      .from('users')
      .select('user_token, email, name')
      .eq('user_token', userToken)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { data: creditData } = await db
      .from('user_credits')
      .select('credits_remaining, credits_total')
      .eq('user_token', userToken)
      .single();

    res.json({
      email: user.email,
      name: user.name,
      credits: creditData?.credits_remaining || 0,
      totalCredits: creditData?.credits_total || 0,
    });
  } catch (err) {
    console.error('Auth me error:', err);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});
