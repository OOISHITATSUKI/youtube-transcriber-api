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

export async function generateSeoAdvice(transcript) {
  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `You are a YouTube SEO and VSEO expert. Based on the following video transcript, generate SEO optimization suggestions.

IMPORTANT: Respond in the SAME language as the transcript. If the transcript is in Japanese, respond entirely in Japanese.

Generate the following in valid JSON format only (no markdown, no explanation outside JSON):

{
  "titles": [
    {"title": "...", "reason": "..."},
    {"title": "...", "reason": "..."},
    {"title": "...", "reason": "..."}
  ],
  "description": "...",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"],
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "keyMoments": [
    {"time": "00:00", "label": "..."},
    {"time": "01:23", "label": "..."}
  ],
  "tips": ["tip1", "tip2", "tip3"]
}

Rules for each field:
- titles: 3 title suggestions, each under 60 chars. Include a reason why it works for SEO. Use power words, numbers, or questions.
- description: YouTube description (first 2 lines most important for search). 150-300 chars. Include a hook and key topics.
- tags: 10 relevant search tags/keywords
- hashtags: 5 hashtags for the video
- keyMoments: Suggested chapter timestamps based on topic changes in the transcript (for YouTube chapters)
- tips: 3 actionable VSEO tips specific to this video's content

Transcript:
${transcript.substring(0, 4000)}`,
      },
    ],
  });

  const text = message.content[0].text;

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse SEO advice');

  return JSON.parse(jsonMatch[0]);
}
