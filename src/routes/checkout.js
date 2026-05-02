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

// One-time credit packs
const CREDIT_PLANS = {
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

// Subscription plan
const SUB_PLAN = {
  id: 'monthly_unlimited',
  name: 'Monthly 300 Credits',
  amountCents: 499,
  credits: 300,
  description: '300 transcription credits per month',
};

checkoutRouter.post('/', async (req, res) => {
  const { plan, userToken } = req.body;

  try {
    const token = userToken || crypto.randomUUID();
    let frontendUrl = (process.env.FRONTEND_URL || '').replace(/\s+/g, '').replace(/\/$/, '');
    if (!frontendUrl || !frontendUrl.startsWith('http')) {
      frontendUrl = `https://${req.headers.host}`;
    }

    // Subscription plan
    if (plan === 'monthly_unlimited') {
      // Create a Stripe Price for the subscription (or use existing)
      const priceId = await getOrCreateSubscriptionPrice();

      const session = await getStripe().checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: {
          plan: 'monthly_unlimited',
          credits: String(SUB_PLAN.credits),
          user_token: token,
        },
        subscription_data: {
          metadata: {
            plan: 'monthly_unlimited',
            credits: String(SUB_PLAN.credits),
            user_token: token,
          },
        },
        success_url: `${frontendUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/pricing?payment=cancelled`,
      });

      return res.json({ url: session.url, sessionId: session.id, userToken: token });
    }

    // One-time credit pack
    const selectedPlan = CREDIT_PLANS[plan];
    if (!selectedPlan) {
      return res.status(400).json({ error: 'Invalid plan', availablePlans: [...Object.keys(CREDIT_PLANS), 'monthly_unlimited'] });
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
      cancel_url: `${frontendUrl}/pricing?payment=cancelled`,
    });

    res.json({ url: session.url, sessionId: session.id, userToken: token });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ error: 'Checkout creation failed', debug: error.message });
  }
});

// Create or find the recurring price for the subscription
let cachedPriceId = null;
async function getOrCreateSubscriptionPrice() {
  if (cachedPriceId) return cachedPriceId;

  const s = getStripe();

  // Search for existing product
  const products = await s.products.list({ limit: 10 });
  let product = products.data.find(p => p.name === 'YT Transcriber Unlimited Monthly');

  if (!product) {
    product = await s.products.create({
      name: 'YT Transcriber Unlimited Monthly',
      description: 'Unlimited YouTube transcriptions per month',
    });
  }

  // Search for existing price
  const prices = await s.prices.list({ product: product.id, limit: 5 });
  let price = prices.data.find(p => p.unit_amount === SUB_PLAN.amountCents && p.recurring?.interval === 'month' && p.active);

  if (!price) {
    price = await s.prices.create({
      product: product.id,
      unit_amount: SUB_PLAN.amountCents,
      currency: 'usd',
      recurring: { interval: 'month' },
    });
  }

  cachedPriceId = price.id;
  return cachedPriceId;
}

checkoutRouter.get('/plans', (req, res) => {
  res.json({
    plans: [
      ...Object.entries(CREDIT_PLANS).map(([key, plan]) => ({
        id: key,
        name: plan.name,
        credits: plan.credits,
        price: plan.amountCents / 100,
        pricePerCredit: (plan.amountCents / 100 / plan.credits).toFixed(2),
        type: 'one_time',
      })),
      {
        id: 'monthly_unlimited',
        name: SUB_PLAN.name,
        credits: SUB_PLAN.credits,
        price: SUB_PLAN.amountCents / 100,
        type: 'subscription',
      },
    ],
  });
});
