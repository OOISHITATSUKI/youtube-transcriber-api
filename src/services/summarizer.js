import Anthropic from '@anthropic-ai/sdk';

let anthropic;
function getClient() {
  if (!anthropic) {
    const key = (process.env.ANTHROPIC_API_KEY || '').replace(/\s+/g, '');
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
    anthropic = new Anthropic({ apiKey: key });
  }
  return anthropic;
}

export async function summarizeTranscript(transcript) {
  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `You MUST write your response in the SAME language as the transcript below. If the transcript is in Japanese, respond in Japanese. If in Spanish, respond in Spanish. Never respond in English unless the transcript is in English.

Summarize the transcript:
- Natural flowing prose, no bullet points
- Cover all major points
- 100-200 words
- Simplify jargon

Transcript:
${transcript}`,
      },
    ],
  });

  return message.content[0].text;
}
