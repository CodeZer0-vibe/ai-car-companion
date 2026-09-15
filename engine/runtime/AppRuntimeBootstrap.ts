import { MemoryEngine } from "../MemoryEngine";
import { RelationshipEngine } from "../RelationshipEngine";
import { GeminiLiveClient } from "../GeminiLiveClient";
import { GrowthEngine } from "../GrowthEngine";
import { TranscriptCoordinator } from "./TranscriptCoordinator";
import { PlaybackController } from "../audio/PlaybackController";
import { RuntimeTelemetry } from "../RuntimeTelemetry";
import { loadCarModel, UNKNOWN_CAR } from "./CarModelStore";
import type { PersonalityContext } from "../PersonalityEngine";
import type { AppSessionRuntimeDeps } from "./AppSessionRuntimeTypes";

export async function bootstrapRuntime(
  d: AppSessionRuntimeDeps,
  apiKey: string
): Promise<PersonalityContext> {
  d.sessionLoggerRef.current.log("SYSTEM", "App started - session beginning");

  d.memoryEngineRef.current = new MemoryEngine(apiKey);
  d.relationshipEngineRef.current = new RelationshipEngine();
  d.geminiClientRef.current = new GeminiLiveClient(apiKey);
  d.growthEngineRef.current = new GrowthEngine();
  d.transcriptCoordinatorRef.current = new TranscriptCoordinator({
    onUserFlush: d.onUserTranscriptFlush,
    onGeminiFlush: d.onGeminiTranscriptFlush,
  });
  d.playbackControllerRef.current = new PlaybackController({
    onSpeakingChange: d.setIsSpeakingState,
    restoreMicPipeline: d.restoreMicPipeline,
  });

  // Fan out every independent cold-start I/O at once. All five calls touch
  // AsyncStorage or remote APIs and have no cross-dependencies.
  const [
    sessionInfo,
    growthSession,
    recentMemories,
    sessionHistory,
    storedCarModel,
  ] = await Promise.all([
    d.relationshipEngineRef.current.startSession(),
    d.growthEngineRef.current.startSession(),
    d.memoryEngineRef.current.retrieveRelevantMemories(
      "recent driving events",
      3
    ),
    d.memoryEngineRef.current.getSessionHistoryString(3),
    loadCarModel(),
  ]);

  d.sessionLoggerRef.current.log(
    "SYSTEM",
    `Session #${sessionInfo.sessionCount} | tier=${sessionInfo.tier} | absent ${sessionInfo.absenceDays}d`
  );
  d.sessionLoggerRef.current.log(
    "SYSTEM",
    `Growth streak=${growthSession.state.streakDays} | reward=${growthSession.reward.title}`
  );
  RuntimeTelemetry.event("growth_daily_reward_granted", {
    streakDays: growthSession.state.streakDays,
    rewardTier: growthSession.reward.tier,
  });

  const carModel = storedCarModel?.model || UNKNOWN_CAR;
  const carModelRefused = storedCarModel?.refused === true;
  d.carModelRefusedRef.current = carModelRefused;
  RuntimeTelemetry.event("car_model_loaded", {
    model: carModel,
    refused: carModelRefused,
    hasStoredRecord: Boolean(storedCarModel),
  });

  const memorySections: string[] = [];
  if (sessionHistory) {
    memorySections.push(`Longer-term session history:\n${sessionHistory}`);
  }
  if (recentMemories.length > 0) {
    memorySections.push(
      `Recent relevant memories:\n${recentMemories
        .map((m) => `- ${m.text}`)
        .join("\n")}`
    );
  }
  const memoryText = memorySections.join("\n\n");

  RuntimeTelemetry.event("memory_bootstrap_context_loaded", {
    relevantMemoryCount: recentMemories.length,
    hasSessionHistory: Boolean(sessionHistory),
  });

  return {
    carModel,
    carModelRefused,
    timeSinceAction: d.timeSinceActionRef.current,
    totalInteractions: d.totalInteractionsRef.current,
    recentTriggers: ["engineStart"],
    relationshipContext: d.relationshipEngineRef.current.getContextForPrompt(),
    memoryContext: memoryText,
    milestone: sessionInfo.milestone,
    absenceDays: sessionInfo.absenceDays,
    isVulnerable: sessionInfo.milestone
      ? false
      : d.relationshipEngineRef.current.shouldBeVulnerable(),
  };
}
