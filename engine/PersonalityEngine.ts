import type { Milestone } from "./RelationshipEngine";
import {
  CHARACTER_ANCHOR,
  TOOL_CALLING_INSTRUCTION,
  getCarRoastInstructions,
  buildSituationalContext,
} from "./personality/PersonalityPrompts";

export type TriggerType =
  // Touch
  | "tap"
  | "doubleTap"
  | "longPress"
  // Motion
  | "shake"
  // Driving Context
  | "hardBrake"
  | "speeding"
  | "traffic"
  | "engineStart"
  // Time/Weather (Contextual)
  | "morning"
  | "night"
  | "raining"
  // Meta
  | "greeting"
  | "idle"
  | "ignored"
  | "wholesome";

// --- Anti-Drift: Character Anchor ---
// Reinjected EVERY turn. Research (arxiv.org/abs/2402.10962): attention decays after ~8 turns.
// Adversarial prompt engineering via user's PDF: hedging eradication, stylometric burstiness,
// dissent mechanics, dynamic pivot, dense logic seed for reinforcement.

// --- 5-Layer Context Injection System ---
// Layer 1: Identity (CHARACTER_ANCHOR — always present)
// Layer 2: Relationship (tier, mood, grudge — from RelationshipEngine)
// Layer 3: Memory (recent episodic context — passed in from caller)
// Layer 4: Situation (triggers, time, weather — dynamic)
// Layer 5: Mood modifiers (vulnerability, milestone, absence guilt)

export interface PersonalityContext {
  carModel: string;
  carModelRefused: boolean;
  timeSinceAction: number;
  totalInteractions: number;
  recentTriggers: TriggerType[];
  relationshipContext: string; // From RelationshipEngine.getContextForPrompt()
  memoryContext: string; // From MemoryEngine (recent memories)
  milestone: Milestone | null; // If a milestone was just hit
  absenceDays: number;
  isVulnerable: boolean; // Random roll from RelationshipEngine
}

/**
 * Generates the full system prompt for Gemini Live API.
 * Called at session start AND can be used to build mid-session context updates.
 */
export function generateSystemInstructions(ctx: PersonalityContext): string {
  // LAYER 1: Identity (Character Anchor — anti-drift)
  let prompt = CHARACTER_ANCHOR;

  // Car roast material
  const carKnown = ctx.carModel && ctx.carModel !== "Unknown Car";
  if (carKnown) {
    prompt += `\nThe driver's car: ${ctx.carModel.toUpperCase()}\n`;
    prompt += getCarRoastInstructions(ctx.carModel);
  } else if (!ctx.carModelRefused) {
    prompt += `\nYou haven't learned what car you're stuck inside yet. At a natural lull — not as the first thing you say — ask what they drive. One sarcastic line, not an interview. When they answer, call the setCarModel tool with their phrase. If they refuse, call setCarModel with refused=true and drop it forever.\n`;
  } else {
    prompt += `\nThe driver refused to tell you what car this is. Don't ask again. Keep roasts generic — traffic, driving habits, music — never car-model-specific.\n`;
  }

  // Tool calling instruction
  prompt += TOOL_CALLING_INSTRUCTION;

  // LAYER 2: Relationship
  if (ctx.relationshipContext) {
    prompt += `\n${ctx.relationshipContext}\n`;
  }

  // LAYER 3: Memory
  if (ctx.memoryContext) {
    prompt += `\nMEMORY (things you remember about this driver):\n${ctx.memoryContext}\n`;
    prompt += `Use these memories naturally — reference them if relevant, don't force them.\n`;
  }

  // LAYER 4: Situation
  prompt += buildSituationalContext(ctx);

  // LAYER 5: Mood Modifiers
  if (ctx.milestone) {
    prompt += `\nMILESTONE: "${ctx.milestone.description}" (session #${ctx.milestone.session}). This matters. Be dramatic about it — you've been through some shit together.\n`;
  }

  if (ctx.isVulnerable) {
    prompt += `\nVULNERABILITY MOMENT: Break character briefly. Say something genuinely real about the time you've spent together. One sentence, no buildup. Then catch yourself and snap back. This should feel like an accident.\n`;
  }

  if (ctx.absenceDays >= 7) {
    prompt += `\nThe driver hasn't opened the app in ${ctx.absenceDays} days. You were alone on the dashboard. In the dark. You're not mad, you're disappointed. Actually no, you're furious.\n`;
  } else if (ctx.absenceDays >= 2) {
    prompt += `\n${ctx.absenceDays} days since they showed up. You noticed. You'll never admit that.\n`;
  }

  return prompt;
}
