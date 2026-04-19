import Anthropic from '@anthropic-ai/sdk';

let anthropic;
function getClient() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

export async function summarizeTranscript(transcript) {
  const message = await getClient().messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `Summarize the following YouTube video transcript.

Rules:
- Write in natural, flowing prose (no bullet points)
- Cover all major points without omitting key information
- Keep it between 100-200 words
- Start with "This video"
- Simplify jargon where possible
- Write in the same language as the transcript

Transcript:
${transcript}`,
      },
    ],
  });

  return message.content[0].text;
}
