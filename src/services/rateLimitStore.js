const store = new Map();

export function checkDailyLimit(ip) {
  const today = new Date().toISOString().split('T')[0];
  const key = `${ip}:${today}`;
  const count = store.get(key) || 0;
  return { allowed: count < 1, count, limit: 1 };
}

export function incrementDailyCount(ip) {
  const today = new Date().toISOString().split('T')[0];
  const key = `${ip}:${today}`;
  const count = store.get(key) || 0;
  store.set(key, count + 1);

  for (const [k] of store) {
    if (!k.endsWith(today)) store.delete(k);
  }
}
