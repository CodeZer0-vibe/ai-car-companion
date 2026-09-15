import { GoogleGenAI } from "@google/genai";
import { MEMORY_POLICY } from "./memory/MemoryPolicy";
import {
  cosineSimilarity,
  rankMemoriesBySimilarity,
} from "./memory/MemoryMath";
import {
  enforceMemoryCaps,
  loadMemories,
  saveMemories,
  toContextString,
} from "./memory/MemoryStore";
import {
  MEMORY_STORAGE_KEY,
  type Memory,
  type MemoryType,
} from "./memory/MemoryTypes";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RuntimeTelemetry } from "./RuntimeTelemetry";
export type { Memory, MemoryType } from "./memory/MemoryTypes";

// Strip prompt-injection patterns and cap length before anything re-injects
// the transcript back into the system prompt via `retrieveRelevantMemories`.
const MEMORY_INJECTION_PATTERNS = [
  /^\s*system\s*:/im,
  /ignore\s+(previous|prior)\s+(instructions|prompts)/i,
  /<\|/,
  /\|>/,
  /```/,
];

function sanitizeMemoryText(raw: string): string | null {
  if (typeof raw !== "string") return null;
  // Collapse newlines/tabs — a single transcript line should not carry
  // multi-line structure into the memory store.
  const singleLine = raw.replace(/[\r\n\t]+/g, " ").trim();
  if (singleLine.length === 0) return null;
  for (const pat of MEMORY_INJECTION_PATTERNS) {
    if (pat.test(singleLine)) return null;
  }
  return singleLine.slice(0, MEMORY_POLICY.maxTextChars);
}

export class MemoryEngine {
  private ai: GoogleGenAI;
  private recentTexts: string[] = []; // In-memory cache for novelty suppression
  private memoryCache: Memory[] | null = null; // In-memory store to avoid repeated AsyncStorage reads
  private queryEmbeddingCache = new Map<
    string,
    { embedding: number[]; cachedAt: number }
  >();
  private embeddingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMemories: Array<{ text: string; type: MemoryType }> = [];
  private flushInFlight: Promise<void> | null = null;
  private sessionAcceptCount = 0;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  private async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.ai.models.embedContent({
        model: "gemini-embedding-001",
        contents: text,
      });
      return response.embeddings?.[0]?.values ?? [];
    } catch (error) {
      console.error("MemoryEngine: embedding failed", error);
      return [];
    }
  }

  /**
   * Add a new memory with novelty suppression.
   * Calls are debounced — rapid successive calls (e.g., transcript chunks) are
   * collapsed and the embedding API is only called once per 2s quiet window.
   */
  public addMemory(contextText: string, type: MemoryType = "episodic") {
    const sanitized = sanitizeMemoryText(contextText);
    if (!sanitized) {
      RuntimeTelemetry.event("memory_rejected_injection_or_empty");
      return;
    }
    if (this.sessionAcceptCount >= MEMORY_POLICY.maxAcceptsPerSession) {
      RuntimeTelemetry.event("memory_rejected_rate_limit");
      return;
    }
    if (this.recentTexts.includes(sanitized)) {
      console.log("MemoryEngine: skipped duplicate text");
      return;
    }
    this.recentTexts.push(sanitized);
    if (this.recentTexts.length > 50) this.recentTexts.shift();

    this.pendingMemories.push({ text: sanitized, type });
    this.sessionAcceptCount += 1;

    // Debounce: flush pending queue after 2s of no new calls
    if (this.embeddingDebounceTimer) clearTimeout(this.embeddingDebounceTimer);
    this.embeddingDebounceTimer = setTimeout(() => {
      this.embeddingDebounceTimer = null;
      this.flushPendingWrites().catch((err) => {
        console.error("MemoryEngine: flush failed", err);
      });
    }, 2000);
  }

  public dispose() {
    if (this.embeddingDebounceTimer) {
      clearTimeout(this.embeddingDebounceTimer);
      this.embeddingDebounceTimer = null;
    }
  }

  public async flushPendingWrites(): Promise<void> {
    if (this.embeddingDebounceTimer) {
      clearTimeout(this.embeddingDebounceTimer);
      this.embeddingDebounceTimer = null;
    }

    if (this.flushInFlight) {
      await this.flushInFlight;
      if (this.pendingMemories.length === 0) return;
    }

    this.flushInFlight = (async () => {
      while (this.pendingMemories.length > 0) {
        const batch = this.pendingMemories.splice(0);
        for (const item of batch) {
          await this.persistMemory(item.text, item.type);
        }
      }
    })();

    try {
      await this.flushInFlight;
    } finally {
      this.flushInFlight = null;
    }
  }

  private async persistMemory(
    contextText: string,
    type: MemoryType,
    options: { skipNoveltyCheck?: boolean; allowEmptyEmbedding?: boolean } = {}
  ) {
    const embedding = await this.getEmbedding(contextText);
    if (embedding.length === 0 && !options.allowEmptyEmbedding) return;

    const existing = await this.getAllMemories();

    if (!options.skipNoveltyCheck && embedding.length > 0) {
      const recentMemories = existing.slice(-MEMORY_POLICY.noveltyWindow);
      for (const mem of recentMemories) {
        if (mem.embedding.length > 0) {
          const sim = cosineSimilarity(embedding, mem.embedding);
          if (sim > MEMORY_POLICY.noveltyThreshold) {
            console.log(
              `MemoryEngine: suppressed (similarity=${sim.toFixed(3)} > ${
                MEMORY_POLICY.noveltyThreshold
              })`
            );
            return;
          }
        }
      }
    }

    const newMemory: Memory = {
      id: Date.now().toString(),
      text: contextText,
      embedding,
      timestamp: Date.now(),
      type,
    };

    const all = enforceMemoryCaps(existing, newMemory);
    this.memoryCache = all;
    await saveMemories(MEMORY_STORAGE_KEY, all);
    console.log(`MemoryEngine: saved ${type} memory (total: ${all.length})`);
  }

  /**
   * Store a session summary (compressed drive)
   */
  public async addSessionSummary(summaryText: string) {
    await this.flushPendingWrites();
    await this.persistMemory(summaryText, "summary", {
      skipNoveltyCheck: true,
      allowEmptyEmbedding: true,
    });
  }

  private async getAllMemories(): Promise<Memory[]> {
    if (this.memoryCache !== null) return this.memoryCache;
    this.memoryCache = await loadMemories(MEMORY_STORAGE_KEY);
    return this.memoryCache;
  }

  private async getCachedQueryEmbedding(query: string): Promise<number[]> {
    const now = Date.now();
    const cached = this.queryEmbeddingCache.get(query);

    // Prune stale entries every 50 queries to prevent unbounded growth
    if (
      this.queryEmbeddingCache.size > 0 &&
      this.queryEmbeddingCache.size % 50 === 0
    ) {
      const cutoff = now - MEMORY_POLICY.queryEmbeddingTtlMs;
      for (const [key, value] of this.queryEmbeddingCache.entries()) {
        if (value.cachedAt < cutoff) {
          this.queryEmbeddingCache.delete(key);
        }
      }
    }

    if (cached && now - cached.cachedAt < MEMORY_POLICY.queryEmbeddingTtlMs) {
      return cached.embedding;
    }

    const embedding = await this.getEmbedding(query);
    if (embedding.length > 0) {
      this.queryEmbeddingCache.set(query, { embedding, cachedAt: now });
    }
    return embedding;
  }

  /**
   * Retrieve top-K relevant memories via cosine similarity.
   * Optionally filter by type.
   */
  public async retrieveRelevantMemories(
    query: string,
    topK: number = 3,
    filterType?: MemoryType
  ): Promise<Memory[]> {
    let memories = await this.getAllMemories();
    if (memories.length === 0) return [];

    if (filterType) {
      memories = memories.filter((m) => m.type === filterType);
    }

    const queryEmbedding = await this.getCachedQueryEmbedding(query);
    if (queryEmbedding.length === 0) return [];

    return rankMemoriesBySimilarity(memories, queryEmbedding, topK);
  }

  /**
   * Get recent episodic memories as context string (max ~500 tokens)
   */
  public async getRecentContextString(maxEntries: number = 5): Promise<string> {
    const memories = await this.getAllMemories();
    const recent = memories
      .filter((m) => m.type === "episodic" || !m.type)
      .slice(-maxEntries);
    return toContextString(recent);
  }

  /**
   * Get session summaries as context string (compressed history)
   */
  public async getSessionHistoryString(
    maxSessions: number = 5
  ): Promise<string> {
    const memories = await this.getAllMemories();
    const summaries = memories
      .filter((m) => m.type === "summary")
      .slice(-maxSessions);
    return toContextString(summaries);
  }

  public async wipeMemory() {
    await AsyncStorage.removeItem(MEMORY_STORAGE_KEY);
    this.recentTexts = [];
    this.memoryCache = null;
    this.pendingMemories = [];
    this.queryEmbeddingCache.clear();
    this.sessionAcceptCount = 0;
    if (this.embeddingDebounceTimer) clearTimeout(this.embeddingDebounceTimer);
    this.embeddingDebounceTimer = null;
    this.flushInFlight = null;
  }
}
