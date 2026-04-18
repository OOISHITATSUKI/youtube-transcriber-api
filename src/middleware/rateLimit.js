import rateLimit from 'express-rate-limit';

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Rate limit reached. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});
