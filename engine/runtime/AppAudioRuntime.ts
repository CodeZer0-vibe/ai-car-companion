import { AudioManager } from "../AudioManager";
import { MicGate } from "../MicGate";
import { APP_RUNTIME } from "./AppRuntimeConfig";
import type { AppSessionRuntimeDeps } from "./AppSessionRuntimeTypes";
import { RuntimeTelemetry } from "../RuntimeTelemetry";

export async function startAudioPipeline(d: AppSessionRuntimeDeps) {
  d.audioManagerRef.current = new AudioManager();
  d.micGateRef.current = new MicGate();
  const micStats = {
    total: 0,
    forwarded: 0,
    droppedNotReady: 0,
    droppedSpeaking: 0,
    droppedGate: 0,
  };
  d.audioManagerRef.current.setOnPermissionDenied(() => {
    d.onMicPermissionDenied();
  });
  d.audioManagerRef.current.setOnAudioChunk((base64Data) => {
    micStats.total += 1;
    d.lastMicChunkAtRef.current = Date.now();
    if (!d.geminiReadyRef.current) {
      micStats.droppedNotReady += 1;
      return;
    }
    // Half-duplex: drop mic chunks during Gemini playback. Without OS-level
    // AEC, the speaker's TTS bleeds into the mic, server VAD trips, fires
    // `interrupted`, and Gemini cuts ITSELF off mid-sentence (self-barge-in
    // loop). Barge-in is sacrificed for clean turn-taking.
    if (d.playbackControllerRef.current?.isSpeaking()) {
      micStats.droppedSpeaking += 1;
      return;
    }
    if (d.fillerCoordinatorRef.current?.isFillerPlaying()) {
      micStats.droppedSpeaking += 1;
      return;
    }
    // MicGate is DIAGNOSTIC ONLY now — we no longer DROP on its decision.
    // Client-side amplitude gating ate sub-threshold speech (word onsets,
    // fricatives, the first ~128-256ms of each utterance) and handed Gemini a
    // gapped PCM stream, which it reconstructed as the WRONG words. Gemini's
    // server-side VAD (realtimeInputConfig.automaticActivityDetection) owns
    // endpointing on the continuous stream. We still RUN the gate to record how
    // many chunks it WOULD have dropped (droppedGate) — that quantifies the
    // damage and lets us delete MicGate once VAD-only is device-confirmed.
    // The half-duplex gate ABOVE (isSpeaking/isFiller) stays: iOS has no AEC.
    const gateWouldForward =
      d.micGateRef.current?.shouldForward(base64Data) ?? true;
    if (!gateWouldForward) micStats.droppedGate += 1;
    micStats.forwarded += 1;
    // Forward every chunk (transcription needs the continuous stream), but pass
    // the gate's speech verdict so the client only treats real speech as "user
    // spoke recently" — otherwise continuous mic perma-defers ambient context.
    d.geminiClientRef.current?.sendAudioChunk(base64Data, gateWouldForward);
  });
  await d.audioManagerRef.current.startRecording();

  d.lastMicChunkAtRef.current = Date.now();
  let lastMicHealthRearmAt = 0;
  d.micHealthIntervalRef.current = setInterval(() => {
    const now = Date.now();
    const silentForMs = Date.now() - d.lastMicChunkAtRef.current;
    const speaking = d.playbackControllerRef.current?.isSpeaking() ?? false;
    const micActive = d.micGateRef.current?.isActive() ?? false;
    const canRearmNow = now - lastMicHealthRearmAt > 12000;
    if (
      silentForMs > APP_RUNTIME.micSilenceRearmMs &&
      !speaking &&
      !micActive &&
      canRearmNow
    ) {
      d.audioManagerRef.current?.rearmRecording();
      lastMicHealthRearmAt = now;
    }
  }, APP_RUNTIME.micHealthCheckMs);

  let reconnectTriggered = false;
  let lastPipelineStatsLogAt = 0;
  d.responseWatchdogRef.current = setInterval(() => {
    const now = Date.now();
    if (now - lastPipelineStatsLogAt >= 6000) {
      lastPipelineStatsLogAt = now;
      RuntimeTelemetry.event("audio_pipeline_stats", {
        ...micStats,
        connected: d.geminiClientRef.current?.connected ?? false,
        geminiReady: d.geminiReadyRef.current,
        waitingForGemini: d.waitingForGeminiRef.current,
        waitingMs: d.turnLatencyTrackerRef.current.getWaitingMs(),
        speaking: d.playbackControllerRef.current?.isSpeaking() ?? false,
        bufferedChunks:
          d.playbackControllerRef.current?.getBufferedChunkCount() ?? 0,
      });
      micStats.total = 0;
      micStats.forwarded = 0;
      micStats.droppedNotReady = 0;
      micStats.droppedSpeaking = 0;
      micStats.droppedGate = 0;
    }

    if (!d.geminiClientRef.current?.connected) return;

    // Only run stall detection when we're actually waiting for a response.
    // An idle-but-ready session that hasn't been spoken to yet should not
    // be force-reconnected just because no traffic has flowed.
    if (!d.waitingForGeminiRef.current) {
      reconnectTriggered = false;
      return;
    }

    if (d.geminiClientRef.current.checkStreamingStall()) {
      if (!reconnectTriggered) {
        reconnectTriggered = true;
        RuntimeTelemetry.event("response_watchdog_stall_recovery", {
          silentMs: d.geminiClientRef.current.getStreamingSilentMs(),
          turnId: d.activeTurnIdRef.current,
          waitingMs: d.turnLatencyTrackerRef.current.getWaitingMs(),
        });
        d.geminiClientRef.current.forceReconnect("streaming_stall_recovery");
      }
      return;
    }

    const waitingMs = d.turnLatencyTrackerRef.current.getWaitingMs();
    if (!reconnectTriggered && waitingMs > APP_RUNTIME.responseReconnectMs) {
      reconnectTriggered = true;
      RuntimeTelemetry.event("gemini_stall_recovery_triggered", {
        waitingMs,
        turnId: d.activeTurnIdRef.current,
      });
      d.geminiClientRef.current.forceReconnect("response_stall");
    }
  }, APP_RUNTIME.responseWatchdogMs);
}
