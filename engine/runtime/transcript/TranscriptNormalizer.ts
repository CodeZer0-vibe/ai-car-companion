function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripEmotionToolLeak(text: string): string {
  // Removes common leaked tool-call strings such as:
  // 1. `changeEmotion("angry")`
  // 2. changeEmotion('judging')
  // 3. changeEmotion(emotion='angry')
  // 4. <call:changeEmotion{emotion:angry}>
  return text
    .replace(/<\s*call\s*:\s*changeEmotion\s*\{\s*emotion\s*:\s*[a-z]+\s*\}\s*>/gi, ' ')
    .replace(/\b\d+\.\s*`?\s*changeEmotion\s*\(\s*(?:emotion\s*=\s*)?['"`][a-z]+['"`]\s*\)\s*`?/gi, ' ')
    .replace(/`?\s*changeEmotion\s*\(\s*(?:emotion\s*=\s*)?['"`][a-z]+['"`]\s*\)\s*`?/gi, ' ')
    .replace(/\bchangeEmotion\s*\(\s*\{?\s*emotion\s*:\s*[a-z]+\s*\}?\s*\)/gi, ' ')
    .replace(/\s*<\/?call>\s*/gi, ' ');
}

function stripReasoningLeak(text: string): string {
  const normalized = text.toLowerCase();

  // Full-thought leakage signatures seen in live responses.
  const hardDropSignals = [
    'thinking process:',
    'analyze current situation:',
    'context awareness:',
    'if i must generate text',
    'i should just provide nothing and wait',
  ];

  if (hardDropSignals.some((signal) => normalized.includes(signal))) {
    return '';
  }

  // Trim accidental "thought ..." preambles without deleting legit speech.
  return text
    .replace(/^\s*thought\s+/i, ' ')
    .replace(/^\s*internal reasoning\s*:\s*/i, ' ')
    .replace(/^\s*reasoning\s*:\s*/i, ' ');
}

function sharedOverlapSuffixPrefix(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  for (let size = max; size > 0; size--) {
    // Ignore tiny overlaps; they create bad joins like "knowhat" or "wasleep".
    if (size < 3) return 0;
    if (left.slice(-size) === right.slice(0, size)) return size;
  }
  return 0;
}

export function normalizeTranscriptChunk(text: string): string {
  return normalizeSpaces(stripReasoningLeak(stripEmotionToolLeak(text)));
}

export function sanitizeModelSpeechText(text: string): string {
  const sanitized = normalizeSpaces(stripReasoningLeak(stripEmotionToolLeak(text)).replace(/`+/g, ''));
  // Drop leading punctuation left by removed tool strings.
  return sanitized.replace(/^[\s.,:;\-]+/, '').trim();
}

export function mergeTranscriptChunk(buffer: string, chunk: string): string {
  const base = normalizeSpaces(buffer);
  const next = normalizeSpaces(chunk);
  if (!next) return base;
  if (!base) return next;
  if (base === next || base.endsWith(` ${next}`) || base.endsWith(next)) return base;
  if (next.startsWith(base)) return next;

  const overlap = sharedOverlapSuffixPrefix(base, next);
  if (overlap > 0) {
    return normalizeSpaces(base + next.slice(overlap));
  }
  return normalizeSpaces(`${base} ${next}`);
}
