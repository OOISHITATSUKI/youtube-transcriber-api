import { Router } from 'express';
import Stripe from 'stripe';

let stripe;
function getStripe() {
  if (!stripe) {
    const key = (process.env.STRIPE_SECRET_KEY || '').replace(/\s+/g, '');
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    stripe = new Stripe(key);
  }
  return stripe;
}

export const checkoutRouter = Router();

const PLANS = {
  pack5: {
    name: '5 Credit Pack',
    credits: 5,
    amountCents: 100,
    description: '5 transcription credits ($0.20 each)',
  },
  pack10: {
    name: '10 Credit Pack (25% OFF)',
    credits: 10,
    amountCents: 150,
    description: '10 transcription credits ($0.15 each)',
  },
};

checkoutRouter.post('/', async (req, res) => {
  const { plan, userToken } = req.body;

  const selectedPlan = PLANS[plan];
  if (!selectedPlan) {
    return res.status(400).json({ error: 'Invalid plan', availablePlans: Object.keys(PLANS) });
  }

  try {
    const token = userToken || crypto.randomUUID();
    let frontendUrl = (process.env.FRONTEND_URL || '').replace(/\s+/g, '').replace(/\/$/, '');
    if (!frontendUrl || !frontendUrl.startsWith('http')) {
      frontendUrl = `https://${req.headers.host}`;
    }

    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: selectedPlan.name, description: selectedPlan.description },
          unit_amount: selectedPlan.amountCents,
        },
        quantity: 1,
      }],
      metadata: {
        plan,
        credits: String(selectedPlan.credits),
        user_token: token,
      },
      success_url: `${frontendUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}?payment=cancelled`,
    });

    res.json({ url: session.url, sessionId: session.id, userToken: token });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ error: 'Checkout creation failed', debug: error.message });
  }
});

checkoutRouter.get('/plans', (req, res) => {
  res.json({
    plans: Object.entries(PLANS).map(([key, plan]) => ({
      id: key,
      name: plan.name,
      credits: plan.credits,
      price: plan.amountCents / 100,
      pricePerCredit: (plan.amountCents / 100 / plan.credits).toFixed(2),
    })),
  });
});
