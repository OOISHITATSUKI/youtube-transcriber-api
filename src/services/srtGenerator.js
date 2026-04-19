function pad(n) {
  return String(n).padStart(2, '0');
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

function msToSRTTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad3(milliseconds)}`;
}

export function generateSRT(segments) {
  return segments.map((seg, index) => {
    const startMs = seg.offset;
    const endMs = seg.offset + (seg.duration || 3000);
    return `${index + 1}\n${msToSRTTime(startMs)} --> ${msToSRTTime(endMs)}\n${seg.text}\n`;
  }).join('\n');
}

export function generateFormattedSRT(formattedTranscript) {
  const paragraphs = formattedTranscript.split('\n\n').filter(p => p.trim());
  const srtParts = [];

  paragraphs.forEach((paragraph) => {
    const timeMatch = paragraph.match(/\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/);
    let startMs = 0;

    if (timeMatch) {
      if (timeMatch[3]) {
        startMs = (parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3])) * 1000;
      } else {
        startMs = (parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2])) * 1000;
      }
    }

    const text = paragraph.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '').trim();
    if (!text) return;

    const chunks = splitIntoSRTChunks(text, 80);
    const chunkDuration = 10000 / chunks.length;

    chunks.forEach((sentence, j) => {
      srtParts.push({
        index: srtParts.length + 1,
        startMs: Math.round(startMs + chunkDuration * j),
        endMs: Math.round(startMs + chunkDuration * (j + 1)),
        text: sentence,
      });
    });
  });

  // Adjust end times to next segment's start
  for (let i = 0; i < srtParts.length - 1; i++) {
    srtParts[i].endMs = srtParts[i + 1].startMs;
  }

  return srtParts
    .map(p => `${p.index}\n${msToSRTTime(p.startMs)} --> ${msToSRTTime(p.endMs)}\n${p.text}\n`)
    .join('\n');
}

function splitIntoSRTChunks(text, maxChars = 80) {
  if (text.length <= maxChars) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    let splitPos = -1;
    const punctuation = ['。', '、', '！', '？', '. ', ', ', '! ', '? '];
    for (const punct of punctuation) {
      const pos = remaining.lastIndexOf(punct, maxChars);
      if (pos > 0 && pos > splitPos) {
        splitPos = pos + punct.length;
      }
    }

    if (splitPos <= 0) splitPos = maxChars;

    chunks.push(remaining.substring(0, splitPos).trim());
    remaining = remaining.substring(splitPos).trim();
  }

  return chunks;
}
