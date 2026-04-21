import { Router } from 'express';
import { generateSeoAdvice } from '../services/seoAdvisor.js';

export const seoAdviceRouter = Router();

seoAdviceRouter.post('/', async (req, res) => {
  const { transcript } = req.body;

  if (!transcript) {
    return res.status(400).json({ error: 'Transcript is required' });
  }

  try {
    const advice = await generateSeoAdvice(transcript);
    res.json(advice);
  } catch (error) {
    console.error('SEO advice error:', error);
    res.status(500).json({ error: 'Failed to generate SEO advice' });
  }
});
