import * as ScreenOrientation from "expo-screen-orientation";
import { setAudioModeAsync } from "expo-audio";
import { Platform } from "react-native";
import { APP_RUNTIME } from "./AppRuntimeConfig";
import { AutonomousEventLoop } from "../AutonomousEventLoop";
import { RuntimeTelemetry } from "../RuntimeTelemetry";
import { RECORDING_AUDIO_MODE } from "./AudioConfig";
import type { AppSessionRuntimeDeps } from "./AppSessionRuntimeTypes";
import { registerGeminiRuntimeCallbacks } from "./AppRealtimeHandlers";
import { cleanupRuntimeResources } from "./AppShutdownCoordinator";
import { bootstrapRuntime } from "./AppRuntimeBootstrap";
import { startMotionTracking } from "./AppMotionRuntime";
import { startAudioPipeline } from "./AppAudioRuntime";
import { FillerCoordinator } from "./FillerCoordinator";

export class AppSessionRuntime {
  private cancelled = false;
  private cleaned = false;
  private deps: AppSessionRuntimeDeps;

  constructor(deps: AppSessionRuntimeDeps) {
    this.deps = deps;
  }

  public async start() {
    const d = this.deps;
    RuntimeTelemetry.event("runtime_stage", { stage: "start_entered" });
    await ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE
    );
    RuntimeTelemetry.event("runtime_stage", { stage: "orientation_locked" });
    if (this.cancelled) return;

    d.fillerCoordinatorRef.current = new FillerCoordinator({
      isSpeaking: () => d.playbackControllerRef.current?.isSpeaking() ?? false,
      lastMicChunkAtRef: d.lastMicChunkAtRef,
    });

    const API_KEY = d.apiKey;
    if (!API_KEY) {
      d.setSpeechText("Can't reach my brain. Something's off on my end.");
      RuntimeTelemetry.event("runtime_stage", { stage: "missing_api_key" });
      d.fillerCoordinatorRef.current?.start();
      d.fillerCoordinatorRef.current?.trigger("API_KEY_MISSING");
      return;
    }

    RuntimeTelemetry.event("runtime_stage", { stage: "bootstrap_begin" });
    const personalityCtx = await bootstrapRuntime(d, API_KEY);
    RuntimeTelemetry.event("runtime_stage", { stage: "bootstrap_done" });
    if (this.cancelled) return;

    // Pin iOS audio session to PlayAndRecord at boot. No filler/chirp plays
    // on cold start — expo-audio's createAudioPlayer would otherwise flip
    // the session to Playback-only, blocking mic capture until a watchdog
    // rearm. With no startup playback, the mic is hot the moment Gemini
    // connects.
    if (Platform.OS === "ios") {
      await setAudioModeAsync(RECORDING_AUDIO_MODE);
      RuntimeTelemetry.event("runtime_stage", { stage: "ios_session_pinned" });
    }

    d.fillerCoordinatorRef.current?.start();
    const geminiClient = d.geminiClientRef.current;
    const memoryEngine = d.memoryEngineRef.current;
    if (!geminiClient || !memoryEngine) {
      RuntimeTelemetry.error(
        "runtime_bootstrap_incomplete",
        new Error("Missing Gemini or Memory engine after bootstrap")
      );
      return;
    }

    registerGeminiRuntimeCallbacks(d);
    RuntimeTelemetry.event("runtime_stage", { stage: "callbacks_registered" });

    // Gemini WebSocket setup and mic permission/start are independent —
    // fan out both. Early mic chunks can't leak: GeminiLiveClient.sendAudioChunk
    // drops anything sent before its internal isReady (set after setupComplete)
    // is true. The runtime-level geminiReadyRef gate then opens at connect-ready
    // (see AppRealtimeHandlers.ts onConnectionChange) so mic flows immediately
    // — no waiting for Gemini's first response.
    RuntimeTelemetry.event("runtime_stage", { stage: "parallel_bring_up" });
    await Promise.all([
      geminiClient.connect(personalityCtx),
      startAudioPipeline(d),
    ]);
    RuntimeTelemetry.event("runtime_stage", {
      stage: "parallel_bring_up_done",
    });
    if (this.cancelled) return;

    if (Platform.OS !== "ios") {
      await setAudioModeAsync(RECORDING_AUDIO_MODE);
    }

    d.autonomousLoopRef.current = new AutonomousEventLoop(
      geminiClient,
      memoryEngine,
      d.relationshipEngineRef.current,
      APP_RUNTIME.autonomousLoopMs,
      {
        getConversationSilenceMs: () =>
          Date.now() - d.lastConversationAtRef.current,
        isTurnPending: () => d.waitingForGeminiRef.current,
      }
    );
    d.autonomousLoopRef.current.setDrivingStatus(false);
    d.autonomousLoopRef.current.start();
    RuntimeTelemetry.event("runtime_stage", {
      stage: "autonomous_loop_started",
    });

    d.idleTimerRef.current = setInterval(() => {
      d.timeSinceActionRef.current += 1;
    }, 1000);

    const idleFillerTimer = setInterval(() => {
      d.fillerCoordinatorRef.current?.checkIdle();
    }, 1000);
    d.idleFillerTimerRef.current = idleFillerTimer;

    startMotionTracking(d);
    RuntimeTelemetry.event("runtime_stage", {
      stage: "motion_tracking_started",
    });
  }

  public cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    this.cancelled = true;
    const d = this.deps;

    return cleanupRuntimeResources(d);
  }
}
