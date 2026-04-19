import { Router } from 'express';
import Stripe from 'stripe';
import { checkCredits } from '../services/credits.js';

let stripe;
function getStripe() {
  if (!stripe) {
    const key = (process.env.STRIPE_SECRET_KEY || '').replace(/\s+/g, '');
    stripe = new Stripe(key);
  }
  return stripe;
}

export const verifyPaymentRouter = Router();

verifyPaymentRouter.post('/', async (req, res) => {
  const { checkoutSessionId } = req.body;
  if (!checkoutSessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(checkoutSessionId);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed' });
    }

    const userToken = session.metadata?.user_token;
    const { credits } = await checkCredits(userToken);

    res.json({
      accessToken: userToken,
      credits,
      plan: session.metadata?.plan,
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});
