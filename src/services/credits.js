import { createClient } from '@supabase/supabase-js';

let supabase;
function getDb() {
  if (!supabase && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const key = (process.env.SUPABASE_SERVICE_KEY || '').replace(/\s+/g, '');
    supabase = createClient(process.env.SUPABASE_URL, key);
  }
  return supabase;
}

// In-memory fallback
const memoryStore = new Map();

export async function checkCredits(userToken) {
  if (!userToken) return { isPaid: false, credits: 0 };

  const db = getDb();
  if (!db) {
    const credits = memoryStore.get(userToken) || 0;
    return { isPaid: credits > 0, credits };
  }

  try {
    const { data, error } = await db
      .from('user_credits')
      .select('credits_remaining')
      .eq('user_token', userToken)
      .single();

    if (error || !data) return { isPaid: false, credits: 0 };
    return { isPaid: data.credits_remaining > 0, credits: data.credits_remaining };
  } catch {
    return { isPaid: false, credits: 0 };
  }
}

export async function consumeCredit(userToken, amount = 1, meta = {}) {
  if (!userToken) return { success: false, creditsRemaining: 0 };

  const db = getDb();
  if (!db) {
    const current = memoryStore.get(userToken) || 0;
    if (current < amount) return { success: false, creditsRemaining: current };
    memoryStore.set(userToken, current - amount);
    return { success: true, creditsRemaining: current - amount };
  }

  try {
    const { data: current } = await db
      .from('user_credits')
      .select('credits_remaining')
      .eq('user_token', userToken)
      .single();

    if (!current || current.credits_remaining < amount) {
      return { success: false, creditsRemaining: current?.credits_remaining || 0 };
    }

    const newBalance = current.credits_remaining - amount;
    await db
      .from('user_credits')
      .update({ credits_remaining: newBalance, updated_at: new Date().toISOString() })
      .eq('user_token', userToken);

    await db.from('credit_usage').insert({
      user_token: userToken,
      credits_used: amount,
      usage_type: meta.type || 'unknown',
      video_url: meta.url || null,
      file_name: meta.fileName || null,
      duration_seconds: meta.duration || null,
    });

    return { success: true, creditsRemaining: newBalance };
  } catch (err) {
    console.error('Credit consumption error:', err);
    return { success: false, creditsRemaining: 0 };
  }
}

export async function addCredits(userToken, amount) {
  const db = getDb();
  if (!db) {
    const current = memoryStore.get(userToken) || 0;
    memoryStore.set(userToken, current + amount);
    return { success: true, creditsRemaining: current + amount };
  }

  try {
    const { data: existing } = await db
      .from('user_credits')
      .select('credits_remaining, credits_total')
      .eq('user_token', userToken)
      .single();

    if (existing) {
      await db
        .from('user_credits')
        .update({
          credits_remaining: existing.credits_remaining + amount,
          credits_total: existing.credits_total + amount,
          updated_at: new Date().toISOString(),
        })
        .eq('user_token', userToken);
      return { success: true, creditsRemaining: existing.credits_remaining + amount };
    } else {
      await db.from('user_credits').insert({
        user_token: userToken,
        credits_remaining: amount,
        credits_total: amount,
      });
      return { success: true, creditsRemaining: amount };
    }
  } catch (err) {
    console.error('Add credits error:', err);
    return { success: false, creditsRemaining: 0 };
  }
}
