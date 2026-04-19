import { Router } from 'express';
import express from 'express';
import Stripe from 'stripe';
import { addCredits } from '../services/credits.js';

let stripe;
function getStripe() {
  if (!stripe) {
    const key = (process.env.STRIPE_SECRET_KEY || '').replace(/\s+/g, '');
    stripe = new Stripe(key);
  }
  return stripe;
}

export const webhookRouter = Router();

webhookRouter.use(express.raw({ type: 'application/json' }));

webhookRouter.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').replace(/\s+/g, '');

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      const credits = parseInt(session.metadata.credits) || 5;
      const userToken = session.metadata.user_token;
      if (userToken) {
        await addCredits(userToken, credits);
        console.log(`Added ${credits} credits to user ${userToken}`);
      }
    } catch (err) {
      console.error('Credit addition failed:', err);
    }
  }

  res.json({ received: true });
});
