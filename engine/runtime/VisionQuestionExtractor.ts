export interface VisionQuestion {
  query: string;
}

const ENGLISH_VISION_PATTERNS: RegExp[] = [
  /\bcan you see\b/i,
  /\bcan you see (?:it|that|this|the car|the vehicle|another car|a car)\b/i,
  /\bcan you\b.*\bcamera\b/i,
  /\bdo you see\b/i,
  /\bdo you see (?:it|that|this|the car|the vehicle|another car|a car)\b/i,
  /\bwhat do you see\b/i,
  /\blook at\b/i,
  /\bhow many fingers\b/i,
  /\bcan you read\b/i,
  /\bwhat'?s on (?:the )?(screen|display|laptop)\b/i,
  /\bcan you see (?:another|a|the) car\b/i,
  /\bis (?:there|that|this) (?:a |the )?(?:car|vehicle)\b/i,
  /\bwhat (?:car|vehicle) do you see\b/i,
];

const ROMANIAN_VISION_PATTERNS: RegExp[] = [
  /\bpo(?:ț|t)i\s+s[ăa]\s+vezi\b/i,
  /\bvezi\b/i,
  /\bce\s+vezi\b/i,
  /\bc(?:â|a)te\s+degete\b/i,
  /\bvezi\s+(?:ecranul|laptopul|drumul|in\s+fa(?:ț|t)[ăa])\b/i,
];

const VISION_SUBJECT_HINTS = /\b(camera|camer[ăa]|ecran|screen|display|laptop|deget|degete|finger|fingers|road|drum|traffic|mașin|masin|bord)\b/i;

function normalizeQuestion(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function extractVisionQuestion(text: string): VisionQuestion | null {
  const query = normalizeQuestion(text);
  if (!query) return null;

  const looksLikeVisionQuestion =
    ENGLISH_VISION_PATTERNS.some((pattern) => pattern.test(query)) ||
    ROMANIAN_VISION_PATTERNS.some((pattern) => pattern.test(query));

  if (!looksLikeVisionQuestion) return null;

  if (!VISION_SUBJECT_HINTS.test(query) && !/[?]/.test(query)) {
    return null;
  }

  return { query };
}
