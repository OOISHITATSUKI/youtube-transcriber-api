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

export async function formatTranscript(rawTranscript) {
  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `以下はYouTube動画の文字起こしです。これを話者ごとに段落分けして読みやすく整形してください。

【ルール】
- 話者が変わるたびに改行して段落を分ける
- 各段落の先頭に「話者A:」「話者B:」のように話者ラベルをつける（話者が判別できない場合は発言の切れ目で段落を分ける）
- 話者が同じ場合は一つの段落にまとめる
- 句読点を適切に追加して読みやすくする
- タイムスタンプは各段落の先頭に [00:00] の形式で、その段落の開始時刻のみ付ける
- 内容は一切変更・要約しない。原文のまま整形のみ行う
- 明らかな音声認識ミスがあっても修正しない
- 文字起こしと同じ言語で出力する

【出力形式の例】
[00:00] 話者A: だめでした。あっちのシャッターも外から鍵がかかってます。

[00:08] 話者B: 非常の内線に電話しましたけど繋がりませんでした。

[00:14] 話者C: 混乱しているようだな。なんだ君たちは人質だ。

【文字起こしテキスト】
${rawTranscript}`,
      },
    ],
  });

  return message.content[0].text;
}
