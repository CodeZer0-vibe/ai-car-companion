import { APP_RUNTIME } from "./AppRuntimeConfig";
import { RuntimeTelemetry } from "../RuntimeTelemetry";
import type { AppSessionRuntimeDeps } from "./AppSessionRuntimeTypes";
import { sanitizeModelSpeechText } from "./transcript/TranscriptNormalizer";
import { saveCarModel, markCarModelRefused } from "./CarModelStore";

export function registerGeminiRuntimeCallbacks(d: AppSessionRuntimeDeps) {
  let lastUserBargeInAt = 0;

  d.geminiClientRef.current?.registerCallbacks({
    onAudio: (base64Chunk) => {
      d.fillerCoordinatorRef.current?.onLiveAudioArrived();
      if (!d.geminiReadyRef.current) {
        d.geminiReadyRef.current = true;
        RuntimeTelemetry.event("gemini_mic_gate_opened");
      }
      if (!d.ahaTrackedRef.current) {
        d.ahaTrackedRef.current = true;
        RuntimeTelemetry.metric(
          "onboarding_aha_ms",
          Date.now() - d.appStartAtRef.current
        );
      }
      d.setSystemStatus("Talking.");
      d.markGeminiResponse("audio");
      d.playbackControllerRef.current?.enqueueChunk(base64Chunk);
    },
    onEmotion: (emotion) => {
      if (d.emotionTimeoutRef.current) {
        clearTimeout(d.emotionTimeoutRef.current);
        d.emotionTimeoutRef.current = null;
      }
      d.setEmotionState(emotion);
      d.sessionLoggerRef.current.log("EMOTION", emotion);
    },
    onLookThroughCamera: () => d.onLookThroughCamera(),
    onGetDriveContext: () => d.getDriveContextSnapshot(),
    onTranscript: (speaker, text) => {
      if (speaker === "user" && d.waitingForGeminiRef.current) {
        RuntimeTelemetry.event("gemini_user_transcript_during_wait", {
          textLen: text.length,
          waitingMs: d.turnLatencyTrackerRef.current.getWaitingMs(),
          turnId: d.activeTurnIdRef.current,
        });
      }
      if (speaker === "user") {
        // Early barge-in: require >=3 chars of real speech so road noise,
        // breathing, and single-syllable filler don't cut the pet mid-sentence.
        const trimmedLen = text.trim().length;
        const now = Date.now();
        const canBargeIn = now - lastUserBargeInAt > 250;
        if (
          trimmedLen >= 3 &&
          canBargeIn &&
          (d.playbackControllerRef.current?.isSpeaking() ?? false)
        ) {
          lastUserBargeInAt = now;
          d.playbackControllerRef.current?.stopPlayback();
          RuntimeTelemetry.event("gemini_early_barge_in", {
            textLen: text.length,
            turnId: d.activeTurnIdRef.current,
          });
        }
      }
      if (speaker === "gemini" && d.waitingForGeminiRef.current) {
        d.setSystemStatus("Talking.");
        RuntimeTelemetry.event("gemini_wait_recovery_output", {
          textLen: text.length,
          waitingMs: d.turnLatencyTrackerRef.current.getWaitingMs(),
          turnId: d.activeTurnIdRef.current,
        });
      }
      if (speaker === "gemini") {
        // Avoid per-token UI updates; transcript flushes provide smoother, batched text.
      }
      d.transcriptCoordinatorRef.current?.ingest(speaker, text);
    },
    onTurnComplete: () => {
      if (!d.geminiReadyRef.current) {
        d.geminiReadyRef.current = true;
        RuntimeTelemetry.event("gemini_mic_gate_opened");
      }
      d.markGeminiResponse("turnComplete");
      d.transcriptCoordinatorRef.current?.flushAll();
      d.setSystemStatus("Listening.");
      RuntimeTelemetry.event("gemini_wait_cleared", {
        source: "turnComplete",
        waitingMs: d.turnLatencyTrackerRef.current.getWaitingMs(),
        turnId: d.activeTurnIdRef.current,
      });
      d.waitingForGeminiRef.current = false;
      d.activeTurnIdRef.current = null;
      d.turnLatencyTrackerRef.current.stopWaiting();
      d.playbackControllerRef.current?.playPending();
    },
    onInterrupted: () => {
      d.transcriptCoordinatorRef.current?.flushAll();
      d.setSystemStatus("Hold on...");
      RuntimeTelemetry.event("gemini_wait_cleared", {
        source: "interrupted",
        waitingMs: d.turnLatencyTrackerRef.current.getWaitingMs(),
        turnId: d.activeTurnIdRef.current,
      });
      d.waitingForGeminiRef.current = false;
      d.activeTurnIdRef.current = null;
      d.turnLatencyTrackerRef.current.stopWaiting();
      d.playbackControllerRef.current?.stopPlayback();
    },
    onCarModelSet: async (payload) => {
      const record = payload.refused
        ? await markCarModelRefused()
        : await saveCarModel(payload.model);
      if (!record) return;
      d.carModelRefusedRef.current = record.refused === true;
      d.geminiClientRef.current?.updateCarContext({
        model: record.model,
        refused: record.refused === true,
      });
      d.sessionLoggerRef.current.log(
        "SYSTEM",
        record.refused
          ? "Car model refused — roast profile disabled"
          : `Car model recorded: ${record.model} (live this session)`
      );
    },
    onConnectionChange: (connected) => {
      d.sessionLoggerRef.current.log(
        "SYSTEM",
        connected ? "Gemini connected" : "Gemini disconnected"
      );
      RuntimeTelemetry.event("gemini_connection_state_changed", {
        connected,
        waitingForGemini: d.waitingForGeminiRef.current,
        geminiReady: d.geminiReadyRef.current,
        turnId: d.activeTurnIdRef.current,
      });
      if (!connected) {
        d.setSystemStatus("Lost signal...");
        d.setEmotionState("glitch");
        d.geminiReadyRef.current = false;
        // greetingSentOnceRef intentionally NOT reset on disconnect — we
        // greet once per app session, so reconnects don't re-trigger it.
        d.waitingForGeminiRef.current = false;
        d.activeTurnIdRef.current = null;
        d.turnLatencyTrackerRef.current.stopWaiting();
        d.transcriptCoordinatorRef.current?.flushAll();
        if (d.greetingTimerRef.current) {
          clearTimeout(d.greetingTimerRef.current);
          d.greetingTimerRef.current = null;
        }
        return;
      }

      d.setSystemStatus("Listening.");
      d.setEmotionState("idle");
      // Open mic-forwarding gate as soon as the session is ready. The previous
      // behavior left this false until the first server response, which broke
      // same-day returns (greeting skipped → no first response → mic stayed
      // gated until user tapped). GeminiLiveClient.sendAudioChunk has its own
      // isReady guard, so opening here can't leak chunks pre-setup.
      d.geminiReadyRef.current = true;
      RuntimeTelemetry.event("gemini_mic_gate_opened", { trigger: "connect" });
      d.fillerCoordinatorRef.current?.onGeminiReady();
      if (d.greetingTimerRef.current) {
        clearTimeout(d.greetingTimerRef.current);
      }
      d.greetingTimerRef.current = setTimeout(() => {
        if (
          !d.geminiClientRef.current?.connected ||
          d.greetingSentOnceRef.current
        ) {
          return;
        }
        d.greetingSentOnceRef.current = true;
        d.geminiClientRef.current.sendSilentContextUpdate(
          "The car engine just turned on. You just woke up on the dashboard. Greet the driver - be grumpy about being activated. React right now with audio."
        );
        RuntimeTelemetry.event("gemini_reconnect_wake_prompt_sent");
      }, APP_RUNTIME.greetingDelayMs);
    },
    onReconnectScheduled: (attempt) => {
      d.fillerCoordinatorRef.current?.onReconnectScheduled(attempt);
    },
    onReconnectExhausted: () => {
      d.fillerCoordinatorRef.current?.trigger("BRAIN_DOWN");
      d.onReconnectExhausted();
    },
  });
}
