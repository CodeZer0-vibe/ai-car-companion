export const MEMORY_POLICY = {
  noveltyThreshold: 0.92,
  noveltyWindow: 20,
  maxEpisodic: 300,
  maxSemantic: 100,
  maxSummary: 100,
  queryEmbeddingTtlMs: 10 * 60 * 1000,
  maxTextChars: 500,
  maxAcceptsPerSession: 20,
} as const;
