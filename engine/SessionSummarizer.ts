import { GoogleGenAI } from "@google/genai";
import { MemoryEngine } from "./MemoryEngine";
import { RelationshipEngine } from "./RelationshipEngine";

/**
 * Compresses a drive session into ~100 tokens of episodic memory.
 * Called at session end, before the app closes.
 * Uses Gemini text API (not Live) for summarization.
 */
export class SessionSummarizer {
  private ai: GoogleGenAI;
  private memory: MemoryEngine;
  private relationship: RelationshipEngine;

  constructor(
    apiKey: string,
    memory: MemoryEngine,
    relationship: RelationshipEngine
  ) {
    this.ai = new GoogleGenAI({ apiKey });
    this.memory = memory;
    this.relationship = relationship;
  }

  /**
   * Summarize the current session and store as a compressed memory.
   * Returns the summary text, or null if there was nothing to summarize.
   */
  public async summarizeSession(): Promise<string | null> {
    try {
      await this.memory.flushPendingWrites();

      // Gather raw episodic memories from this session
      const recentContext = await this.memory.getRecentContextString(15);
      if (!recentContext || recentContext.trim().length < 20) {
        console.log("SessionSummarizer: not enough content to summarize");
        return null;
      }

      const state = this.relationship.getState();
      const tier = this.relationship.getTier();

      const prompt = `You are compressing a drive session into a brief memory for an AI car companion.

SESSION DATA:
- Session #${state.sessionCount} (relationship tier: ${tier})
- Grudge events this session: ${state.grudgeScore > 0 ? "yes" : "none"}
- Events that happened:
${recentContext}

INSTRUCTIONS:
Write a 1-2 sentence summary of this drive from the AI companion's perspective. Include:
- What the driver did (driving style, interactions)
- Any notable moments (funny, scary, emotional)
- How the AI felt about it

Keep it under 100 tokens. Write as if you're jotting a diary entry. Be specific, not generic.
Example: "Session 12: They drove aggressively through rain, almost rear-ended a truck, then apologized by playing my favorite song. Grudgingly forgave them."`;

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });
      const summary = (response.text ?? "").trim();

      if (summary) {
        await this.memory.addSessionSummary(summary);
        console.log(`SessionSummarizer: "${summary}"`);
        return summary;
      }

      return null;
    } catch (error) {
      console.error("SessionSummarizer: failed", error);
      return null;
    }
  }
}
