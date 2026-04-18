import { Supadata } from '@supadata/js';

const supadata = new Supadata({
  apiKey: process.env.SUPADATA_API_KEY,
});

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function transcribeVideo(url, maxSeconds = null) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  // Get transcript via Supadata API
  const transcriptResult = await supadata.transcript({
    url,
    text: false,  // Get timestamped chunks
    mode: 'auto', // native → AI fallback
  });

  // Handle async jobs (large files)
  let transcriptData;
  if (transcriptResult && 'jobId' in transcriptResult) {
    transcriptData = await pollForResult(transcriptResult.jobId);
  } else {
    transcriptData = transcriptResult;
  }

  const content = transcriptData.content || [];
  if (content.length === 0) {
    throw new Error('No transcript available for this video');
  }

  // Get title/duration from first/last segments
  const title = transcriptData.title || 'YouTube Video';
  const lastSeg = content[content.length - 1];
  const duration = lastSeg ? Math.ceil((lastSeg.offset + (lastSeg.duration || 0)) / 1000) : 0;

  // Truncate for free users
  const filteredContent = maxSeconds
    ? content.filter(seg => (seg.offset / 1000) <= maxSeconds)
    : content;

  // Format with timestamps
  const transcript = filteredContent.map(seg => {
    const totalSec = Math.floor(seg.offset / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const timestamp = `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`;
    return `${timestamp} ${seg.text}`;
  }).join('\n');

  return {
    transcript,
    duration,
    title,
    isTruncated: maxSeconds ? duration > maxSeconds : false,
    processedDuration: maxSeconds ? Math.min(duration, maxSeconds) : duration,
  };
}

async function pollForResult(jobId, maxAttempts = 30, intervalMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await supadata.transcript.getJobStatus(jobId);
    if (result.status === 'completed') return result;
    if (result.status === 'failed') throw new Error('Transcription job failed');
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error('Transcription timed out');
}
