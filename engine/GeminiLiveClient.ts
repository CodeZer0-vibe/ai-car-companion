// @monolith-locked: .council/decisions/geminiliveclient-monolith.md
// 1001 lines, 4x the 250-line ceiling. Split DEFERRED until the demo batch is
// device-confirmed + committed (see ADR). Do not grow further without cause.
import { GoogleGenAI } from "@google/genai";
import type { Session } from "@google/genai";
import {
  generateSystemInstructions,
  PersonalityContext,
} from "./PersonalityEngine";
import { EmotionState } from "./EmotionEngine";
import { RuntimeTelemetry } from "./RuntimeTelemetry";
import { GEMINI_CLIENT_CONFIG } from "./gemini/GeminiClientConfig";
import {
  handleServerContentMessage,
  handleToolCallMessage,
} from "./gemini/GeminiMessageHandlers";
import { GeminiReconnectPolicy } from "./gemini/GeminiReconnectPolicy";
import { buildGeminiConnectRequest } from "./gemini/GeminiLiveRequestBuilder";
import { closeGeminiSession } from "./gemini/GeminiConnectionState";
import { GeminiReconnectScheduler } from "./gemini/GeminiReconnectScheduler";
import { StreamingTimeoutGuard } from "./gemini/StreamingTimeoutGuard";
import { VideoBudgetTracker } from "./gemini/VideoBudgetTracker";
import { SessionBudgetTimer } from "./gemini/SessionBudgetTimer";
import { CircuitBreaker } from "./CircuitBreaker";
import { sanitizeModelSpeechText } from "./runtime/transcript/TranscriptNormalizer";
import { APP_RUNTIME } from "./runtime/AppRuntimeConfig";

export interface GeminiCallbacks {
  onAudio: (base64Audio: string) => void;
  onEmotion: (emotion: EmotionState) => void;
  onTranscript: (speaker: "user" | "gemini", text: string) => void;
  onTurnComplete: () => void;
  onInterrupted: () => void;
  onConnectionChange: (connected: boolean) => void;
  onCarModelSet: (payload: { model: string; refused: boolean }) => void;
  onLookThroughCamera?: () => void;
  onGetDriveContext?: () => Record<string, unknown>;
  onReconnectExhausted: () => void;
  onReconnectScheduled?: (attempt: number) => void;
}

export class GeminiLiveClient {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private callbacks: GeminiCallbacks | null = null;

  // Connection state
  private isReady = false;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private connectionGeneration = 0;

  // Store connect params for reconnect
  private lastPersonalityCtx: PersonalityContext | null = null;

  // Deduplicate turnComplete — server sends it multiple times per turn
  private turnCompleteFired = false;

  // Deduplicate tool calls — Gemini can send the same call multiple times,
  // each sendToolResponse triggers a new generation (causing doubled output)
  private processedToolCallIds = new Set<string>();
  private reconnectPolicy = new GeminiReconnectPolicy();
  private reconnectScheduler = new GeminiReconnectScheduler();
  private streamingTimeoutGuard = new StreamingTimeoutGuard(
    GEMINI_CLIENT_CONFIG.streamStallTimeoutMs
  );
  private videoBudget = new VideoBudgetTracker(
    GEMINI_CLIENT_CONFIG.videoBudgetWarnMs,
    GEMINI_CLIENT_CONFIG.videoBudgetMaxMs
  );
  private outboundBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 15000,
    windowMs: 30000,
  });
  private unsupportedOperationCloseTimes: number[] = [];
  private degradedModeUntil = 0;
  private lastSilentContextSentAt = 0;
  private pendingForcedReconnectReason: string | null = null;
  private lastAudioDropLogAt = 0;
  private lastContextDropLogAt = 0;
  private lastVisionDropLogAt = 0;
  private lastRealtimeAudioSentAt = 0;
  private lastVisionFrameSentAt = 0;
  private modelSpeaking = false;
  private pendingSilentContext: string | null = null;
  private pendingSilentContextKind: string | null = null;
  private pendingSilentContextQueuedAt = 0;
  private pendingSilentContextFingerprint: string | null = null;
  private pendingContextFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastContextFingerprint: string | null = null;
  private lastContextFingerprintAt = 0;
  private outboundAudioChunks = 0;
  private outboundAudioBytesApprox = 0;
  private outboundAudioDropped = 0;
  private outboundVisionFrames = 0;
  private lastOutboundAudioReportAt = Date.now();
  private sessionResumptionHandle: string | null = null;
  private sessionBudget = new SessionBudgetTimer(
    GEMINI_CLIENT_CONFIG.sessionMaxMs,
    () => this.forceReconnect("session_budget_exceeded")
  );

  private classifyContextUpdate(contextString: string): string {
    const s = contextString.toLowerCase();
    if (s.startsWith("turn_language:")) return "turn_language";
    if (s.startsWith("intent_anchor:")) return "intent_anchor";
    if (s.startsWith("turn_correction:")) return "turn_correction";
    if (s.includes("reply now with audio")) return "response_nudge";
    if (s.includes("response is overdue")) return "response_escalation";
    if (s.includes("visual check requested")) return "vision_request";
    if (
      s.includes("just woke up on the dashboard") ||
      s.includes("greet the driver")
    )
      return "wake_prompt";
    if (
      s.includes("anchor refresh") ||
      s.includes("character reinforcement") ||
      s.includes("[anchor]")
    )
      return "character_reinforcement";
    if (s.includes("natural pacing rule") || s.includes("current context"))
      return "autonomous_context";
    if (s.includes("music context")) return "music_context";
    if (
      s.includes("poked your screen") ||
      s.includes("double-tapped") ||
      s.includes("holding your face") ||
      s.includes("personal space") ||
      s.includes("shaken") ||
      s.includes("hard brake") ||
      s.includes("flew off the dashboard") ||
      s.includes("you are speeding")
    )
      return "action_prompt";
    return "other";
  }

  private buildContextPreview(text: string): string {
    const oneLine = text.replace(/\s+/g, " ").trim();
    if (oneLine.length <= 120) return oneLine;
    return `${oneLine.slice(0, 117)}...`;
  }

  private buildContextFingerprint(contextKind: string, text: string): string {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    return `${contextKind}:${normalized}`;
  }

  private maybeEmitOutboundAudioStats() {
    const now = Date.now();
    if (now - this.lastOutboundAudioReportAt < 5000) return;
    this.lastOutboundAudioReportAt = now;
    RuntimeTelemetry.event("gemini_audio_out_stats", {
      sentChunks: this.outboundAudioChunks,
      sentBytesApprox: this.outboundAudioBytesApprox,
      droppedChunks: this.outboundAudioDropped,
      connected: this.isReady,
    });
    this.outboundAudioChunks = 0;
    this.outboundAudioBytesApprox = 0;
    this.outboundAudioDropped = 0;
  }

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });
  }

  public registerCallbacks(callbacks: GeminiCallbacks) {
    this.callbacks = callbacks;
  }

  private clearPendingContextFlushTimer() {
    if (this.pendingContextFlushTimer) {
      clearTimeout(this.pendingContextFlushTimer);
      this.pendingContextFlushTimer = null;
    }
  }

  private schedulePendingContextFlush() {
    if (!this.pendingSilentContext) return;
    this.clearPendingContextFlushTimer();
    this.pendingContextFlushTimer = setTimeout(() => {
      this.pendingContextFlushTimer = null;
      const pending = this.pendingSilentContext;
      if (!pending) return;
      const pendingKind = this.pendingSilentContextKind ?? "other";
      const queuedForMs = Date.now() - this.pendingSilentContextQueuedAt;
      if (queuedForMs > APP_RUNTIME.deferredContextTtlMs) {
        RuntimeTelemetry.event("gemini_context_deferred_dropped_stale", {
          contextKind: pendingKind,
          queuedForMs,
          textLen: pending.length,
          preview: this.buildContextPreview(pending),
        });
        this.pendingSilentContext = null;
        this.pendingSilentContextKind = null;
        this.pendingSilentContextQueuedAt = 0;
        this.pendingSilentContextFingerprint = null;
        return;
      }
      // Retry with the same safety checks that sendSilentContextUpdate applies.
      this.sendSilentContextUpdate(pending);
    }, 1400);
  }

  /**
   * Connect to Gemini Live using @google/genai SDK.
   * The SDK handles setup/setupComplete handshake, message framing,
   * and protocol details that caused 1011 crashes with raw WebSocket.
   */
  public async connect(personalityCtx: PersonalityContext) {
    this.lastPersonalityCtx = personalityCtx;
    this.intentionalClose = false;
    this.isReady = false;
    this.connectionGeneration += 1;
    const generation = this.connectionGeneration;
    this.reconnectScheduler.clear();

    const systemPrompt = generateSystemInstructions(personalityCtx);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const degradedMode = this.isDegradedModeActive();
      RuntimeTelemetry.event("gemini_connect_attempt", {
        generation,
        degradedMode,
        reconnectAttempts: this.reconnectAttempts,
        model: GEMINI_CLIENT_CONFIG.model,
        toolsEnabled: !degradedMode,
        hasSessionResumptionHandle: Boolean(this.sessionResumptionHandle),
        pendingContextLen: this.pendingSilentContext?.length ?? 0,
      });
      const connectPromise = this.ai.live.connect(
        buildGeminiConnectRequest({
          systemPrompt,
          degradedMode,
          sessionResumptionHandle: this.sessionResumptionHandle,
          callbacks: {
            onopen: () => {
              if (generation !== this.connectionGeneration) return;
              console.log("WebSocket connected");
              RuntimeTelemetry.event("gemini_socket_open");
            },
            onmessage: (message: any) => {
              if (generation !== this.connectionGeneration) return;
              this.handleMessage(message);
            },
            onerror: (e: any) => {
              if (generation !== this.connectionGeneration) return;
              console.error("WebSocket error:", e?.message || e);
              RuntimeTelemetry.error("gemini_socket_error", e);
            },
            onclose: (e: any) => {
              if (generation !== this.connectionGeneration) return;
              const code = e?.code ?? "unknown";
              const reason = e?.reason ?? "";
              console.log(`WebSocket closed: code=${code}, reason=${reason}`);
              RuntimeTelemetry.event("gemini_socket_closed", { code, reason });
              RuntimeTelemetry.event("gemini_socket_closed_diagnostics", {
                code,
                generation,
                wasReady: this.isReady,
                modelSpeaking: this.modelSpeaking,
                reconnectAttempts: this.reconnectAttempts,
                pendingContextLen: this.pendingSilentContext?.length ?? 0,
                msSinceRealtimeAudio: Date.now() - this.lastRealtimeAudioSentAt,
              });
              const internalErrorBursts =
                this.reconnectPolicy.recordClose(code);
              if (internalErrorBursts > 0) {
                RuntimeTelemetry.event("gemini_internal_error_burst", {
                  count: internalErrorBursts,
                  windowMs: GEMINI_CLIENT_CONFIG.internalErrorWindowMs,
                });
              }
              const unsupportedBursts =
                this.recordUnsupportedOperationClose(code);
              if (unsupportedBursts >= 1) {
                this.degradedModeUntil =
                  Date.now() + GEMINI_CLIENT_CONFIG.degradedModeCooldownMs;
                RuntimeTelemetry.event("gemini_degraded_mode_enabled", {
                  unsupportedBursts,
                  cooldownMs: GEMINI_CLIENT_CONFIG.degradedModeCooldownMs,
                });
              }
              this.isReady = false;
              this.session = null;
              this.modelSpeaking = false;
              this.callbacks?.onConnectionChange(false);

              if (!this.intentionalClose) {
                this.scheduleReconnect(code);
              }
            },
          },
        })
      );
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                `Gemini connect timeout (${GEMINI_CLIENT_CONFIG.connectTimeoutMs}ms)`
              )
            ),
          GEMINI_CLIENT_CONFIG.connectTimeoutMs
        );
      });
      const session = await Promise.race([connectPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);

      // If disconnect() was called while connect() was pending (race condition with
      // React Strict Mode cleanup), abort — don't establish a zombie session.
      if (this.intentionalClose || generation !== this.connectionGeneration) {
        closeGeminiSession(session);
        return;
      }

      // SDK's connect() resolves after setupComplete — session is ready
      this.session = session;
      this.isReady = true;
      this.modelSpeaking = false;
      this.reconnectAttempts = 0;
      this.reconnectPolicy.reset();
      this.videoBudget.reset();
      // Watchdog clock starts at session-ready, not at construction.
      // Without this, the timer could already be 5–15s stale by the time
      // setup completes, and a tap landing near T+20s gets killed by the
      // stall recovery before the server has a chance to respond.
      this.streamingTimeoutGuard.reset();
      this.sessionBudget.start();
      this.processedToolCallIds.clear();
      this.callbacks?.onConnectionChange(true);
      console.log("Setup complete — session ready (SDK)");
      RuntimeTelemetry.event("gemini_setup_complete", {
        degradedMode: this.isDegradedModeActive(),
      });
      if (this.pendingForcedReconnectReason === "response_stall") {
        RuntimeTelemetry.event("gemini_stall_recovery_reconnected");
      }
      this.pendingForcedReconnectReason = null;
    } catch (e: any) {
      if (timeoutId) clearTimeout(timeoutId);
      if (generation !== this.connectionGeneration) {
        RuntimeTelemetry.event("gemini_connect_stale_failure_ignored", {
          generation,
        });
        return;
      }
      console.error("Failed to connect to Gemini:", e?.message || e);
      RuntimeTelemetry.error("gemini_connect_failed", e, { generation });
      if (this.pendingForcedReconnectReason === "response_stall") {
        RuntimeTelemetry.event("gemini_stall_recovery_failed", {
          reason: e?.message || String(e),
        });
        this.pendingForcedReconnectReason = null;
      }
      if (!this.intentionalClose) {
        this.scheduleReconnect("connect_failed");
      }
    }
  }

  /**
   * Send mic audio via SDK's sendRealtimeInput
   */
  public sendAudioChunk(base64PCM: string, isSpeech: boolean = true) {
    if (!this.session || !this.isReady) {
      this.outboundAudioDropped += 1;
      this.maybeEmitOutboundAudioStats();
      const now = Date.now();
      if (now - this.lastAudioDropLogAt > 3000) {
        this.lastAudioDropLogAt = now;
        RuntimeTelemetry.event("gemini_audio_chunk_dropped", {
          hasSession: this.session !== null,
          isReady: this.isReady,
        });
      }
      return;
    }
    if (!this.outboundBreaker.canAttempt()) {
      this.outboundAudioDropped += 1;
      this.maybeEmitOutboundAudioStats();
      return;
    }
    try {
      // Only SPEECH chunks count as "user spoke recently". Mic streams
      // continuously (MicGate-off), so updating this every chunk made the
      // recent-mic-audio defer guard permanently true — perma-deferring ambient
      // context (time/location) and actions. isSpeech is the amplitude-gate verdict.
      if (isSpeech) this.lastRealtimeAudioSentAt = Date.now();
      this.outboundAudioChunks += 1;
      this.outboundAudioBytesApprox += Math.floor((base64PCM.length * 3) / 4);
      this.session.sendRealtimeInput({
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: base64PCM,
        },
      });
      this.outboundBreaker.recordSuccess();
      this.maybeEmitOutboundAudioStats();
    } catch (e) {
      // WebSocket may have closed between check and send
      this.outboundAudioDropped += 1;
      this.maybeEmitOutboundAudioStats();
      this.outboundBreaker.recordFailure();
      RuntimeTelemetry.error("gemini_send_audio_failed", e);
    }
  }

  public sendVisionFrame(
    base64Image: string,
    mimeType: "image/jpeg" | "image/png" = "image/jpeg"
  ) {
    if (!this.session || !this.isReady) {
      const now = Date.now();
      if (now - this.lastVisionDropLogAt > 3000) {
        this.lastVisionDropLogAt = now;
        RuntimeTelemetry.event("gemini_vision_frame_dropped", {
          reason: "session_not_ready",
          hasSession: this.session !== null,
          isReady: this.isReady,
        });
      }
      return;
    }

    const now = Date.now();
    if (
      now - this.lastVisionFrameSentAt <
      GEMINI_CLIENT_CONFIG.visionFrameMinIntervalMs
    ) {
      if (now - this.lastVisionDropLogAt > 3000) {
        this.lastVisionDropLogAt = now;
        RuntimeTelemetry.event("gemini_vision_frame_dropped", {
          reason: "throttled",
          minIntervalMs: GEMINI_CLIENT_CONFIG.visionFrameMinIntervalMs,
        });
      }
      return;
    }

    const budgetAction = this.videoBudget.noteFrame(now);
    if (budgetAction === "exceed") {
      RuntimeTelemetry.event("gemini_video_budget_exceeded", {
        elapsedMs: this.videoBudget.elapsedMs(now),
        maxMs: GEMINI_CLIENT_CONFIG.videoBudgetMaxMs,
        framesThisGeneration: this.outboundVisionFrames,
      });
      this.reconnect("video_budget_exceeded");
      return;
    }
    if (budgetAction === "warn") {
      RuntimeTelemetry.event("gemini_video_budget_warning", {
        elapsedMs: this.videoBudget.elapsedMs(now),
        warnMs: GEMINI_CLIENT_CONFIG.videoBudgetWarnMs,
        maxMs: GEMINI_CLIENT_CONFIG.videoBudgetMaxMs,
      });
    }

    try {
      this.lastVisionFrameSentAt = now;
      this.outboundVisionFrames += 1;
      this.session.sendRealtimeInput({
        video: {
          mimeType,
          data: base64Image,
        },
      });
      if (
        this.outboundVisionFrames === 1 ||
        this.outboundVisionFrames % 5 === 0
      ) {
        RuntimeTelemetry.event("gemini_vision_frame_sent", {
          count: this.outboundVisionFrames,
          mimeType,
          bytesApprox: Math.floor((base64Image.length * 3) / 4),
        });
      }
    } catch (e) {
      RuntimeTelemetry.error("gemini_send_vision_failed", e, { mimeType });
    }
  }

  /**
   * Send a vision QUESTION as a single ORDERED clientContent turn that bundles
   * the fresh frame (inlineData) and the prompt text in the same parts array.
   *
   * Why not sendVisionFrame (realtimeInput video) + sendSilentContextUpdate:
   * the Live API guarantees ordering for sendClientContent but NOT for
   * sendRealtimeInput ("optimized for responsiveness at the expense of
   * deterministic ordering"). With the split path the prompt could reach the
   * model before the frame, so it answered against STALE buffered frames —
   * intermittently describing the old scene instead of where the user points
   * now. Bundling frame+text in one ordered turn makes the model answer THIS
   * question against THIS frame. Returns true if the turn was sent.
   */
  public sendVisionQuery(
    base64Image: string,
    promptText: string,
    mimeType: "image/jpeg" | "image/png" = "image/jpeg"
  ): boolean {
    if (!this.session || !this.isReady) {
      RuntimeTelemetry.event("gemini_vision_query_dropped", {
        reason: "session_not_ready",
        hasSession: this.session !== null,
        isReady: this.isReady,
      });
      return false;
    }
    if (!this.outboundBreaker.canAttempt()) {
      RuntimeTelemetry.event("gemini_vision_query_dropped", {
        reason: "breaker_open",
      });
      return false;
    }
    try {
      this.session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: base64Image } },
              { text: promptText },
            ],
          },
        ],
        turnComplete: true,
      });
      this.outboundBreaker.recordSuccess();
      this.lastVisionFrameSentAt = Date.now();
      this.outboundVisionFrames += 1;
      RuntimeTelemetry.event("gemini_vision_query_sent", {
        mimeType,
        promptLen: promptText.length,
        bytesApprox: Math.floor((base64Image.length * 3) / 4),
      });
      return true;
    } catch (e) {
      this.outboundBreaker.recordFailure();
      RuntimeTelemetry.error("gemini_send_vision_query_failed", e, {
        mimeType,
      });
      return false;
    }
  }

  /**
   * Inject silent text context (for event loop, memory, sensor data)
   */
  public sendSilentContextUpdate(contextString: string) {
    if (!this.session || !this.isReady) {
      const now = Date.now();
      if (now - this.lastContextDropLogAt > 3000) {
        this.lastContextDropLogAt = now;
        RuntimeTelemetry.event("gemini_context_dropped", {
          reason: "session_not_ready",
          hasSession: this.session !== null,
          isReady: this.isReady,
        });
      }
      return;
    }
    const now = Date.now();
    const contextKind = this.classifyContextUpdate(contextString);
    const fingerprint = this.buildContextFingerprint(
      contextKind,
      contextString
    );
    if (!this.outboundBreaker.canAttempt()) {
      return;
    }
    const highPriorityContextKinds = new Set([
      "wake_prompt",
      "response_nudge",
      "response_escalation",
      "vision_request",
      "turn_language",
      "intent_anchor",
      "turn_correction",
      // Actions (tap/shake/brake/etc) are user-initiated and must reach the
      // model promptly. Without this they get deferred by the recent-mic-audio
      // guard — which is ALWAYS true now that mic streams continuously
      // (MicGate-off) — and then dropped as stale, so the pet never reacts.
      // Still respects the modelSpeaking defer below (avoids mid-generation 1008).
      "action_prompt",
    ]);
    const isHighPriority = highPriorityContextKinds.has(contextKind);

    if (
      !isHighPriority &&
      this.lastContextFingerprint === fingerprint &&
      now - this.lastContextFingerprintAt < APP_RUNTIME.contextDuplicateWindowMs
    ) {
      RuntimeTelemetry.event("gemini_context_skipped_duplicate", {
        contextKind,
        textLen: contextString.length,
        duplicateWindowMs: APP_RUNTIME.contextDuplicateWindowMs,
        preview: this.buildContextPreview(contextString),
      });
      return;
    }

    // Only defer context when the model is actively speaking.
    // Mic audio flows continuously so gating on lastRealtimeAudioSentAt blocks all context.
    if (this.modelSpeaking) {
      if (this.pendingSilentContextFingerprint === fingerprint) {
        return;
      }
      this.pendingSilentContext = contextString;
      this.pendingSilentContextKind = contextKind;
      this.pendingSilentContextQueuedAt = now;
      this.pendingSilentContextFingerprint = fingerprint;
      this.schedulePendingContextFlush();
      RuntimeTelemetry.event("gemini_context_deferred_model_speaking", {
        modelSpeaking: true,
        contextKind,
        textLen: contextString.length,
        preview: this.buildContextPreview(contextString),
      });
      return;
    }

    // Guard non-critical context while user mic audio is actively streaming.
    // This avoids injecting ordered content turns into hot realtime audio windows.
    const msSinceRealtimeAudio = now - this.lastRealtimeAudioSentAt;
    if (!isHighPriority && msSinceRealtimeAudio < 1200) {
      if (this.pendingSilentContextFingerprint === fingerprint) {
        return;
      }
      this.pendingSilentContext = contextString;
      this.pendingSilentContextKind = contextKind;
      this.pendingSilentContextQueuedAt = now;
      this.pendingSilentContextFingerprint = fingerprint;
      this.schedulePendingContextFlush();
      RuntimeTelemetry.event("gemini_context_deferred_recent_mic_audio", {
        contextKind,
        textLen: contextString.length,
        msSinceRealtimeAudio,
        preview: this.buildContextPreview(contextString),
      });
      return;
    }

    if (
      !isHighPriority &&
      now - this.lastSilentContextSentAt <
        GEMINI_CLIENT_CONFIG.silentContextMinIntervalMs
    ) {
      if (this.pendingSilentContextFingerprint === fingerprint) {
        return;
      }
      this.pendingSilentContext = contextString;
      this.pendingSilentContextKind = contextKind;
      this.pendingSilentContextQueuedAt = now;
      this.pendingSilentContextFingerprint = fingerprint;
      this.schedulePendingContextFlush();
      RuntimeTelemetry.event("gemini_context_update_throttled", {
        minIntervalMs: GEMINI_CLIENT_CONFIG.silentContextMinIntervalMs,
        contextKind,
        textLen: contextString.length,
        preview: this.buildContextPreview(contextString),
      });
      return;
    }
    try {
      const transport = this.sendTextContext(contextString);
      this.outboundBreaker.recordSuccess();
      this.lastSilentContextSentAt = now;
      this.lastContextFingerprint = fingerprint;
      this.lastContextFingerprintAt = now;
      if (this.pendingSilentContext === contextString) {
        this.pendingSilentContext = null;
        this.pendingSilentContextKind = null;
        this.pendingSilentContextQueuedAt = 0;
        this.pendingSilentContextFingerprint = null;
      }
      RuntimeTelemetry.event("gemini_context_sent", {
        textLen: contextString.length,
        contextKind,
        transport,
        preview: this.buildContextPreview(contextString),
      });
    } catch (e) {
      // WebSocket may have closed
      this.outboundBreaker.recordFailure();
      RuntimeTelemetry.error("gemini_send_context_failed", e);
    }
  }

  /**
   * Handle all server messages from the SDK
   */
  private handleMessage(message: any) {
    // Notify timeout guard that stream is alive
    this.streamingTimeoutGuard.notifyDataReceived();

    if (message.sessionResumptionUpdate) {
      this.handleSessionResumptionUpdate(message.sessionResumptionUpdate);
    }

    // Server content (audio, turn signals, transcripts)
    if (message.serverContent) {
      this.handleServerContent(message.serverContent);
      const partFunctionCalls = this.extractFunctionCallsFromServerContent(
        message.serverContent
      );
      if (partFunctionCalls.length > 0) {
        this.handleToolCall({ functionCalls: partFunctionCalls });
      }
    }
    // SDK fallback: some builds deliver audio at message level as message.data
    if (message.data && !message.serverContent) {
      this.turnCompleteFired = false;
      this.callbacks?.onAudio(message.data);
    }

    // Tool calls (changeEmotion)
    if (message.toolCall) {
      this.handleToolCall(message.toolCall);
    }

    // GoAway — server is about to disconnect, reconnect proactively
    if (message.goAway) {
      console.log("GoAway received — reconnecting proactively");
      RuntimeTelemetry.event("gemini_goaway_received", {
        connected: this.isReady,
        reconnectAttempts: this.reconnectAttempts,
      });
      this.reconnect("goaway");
    }
  }

  /**
   * Handle serverContent: audio chunks, turn complete, interruption, transcripts
   */
  private handleServerContent(sc: any) {
    const result = handleServerContentMessage(sc, this.turnCompleteFired, {
      onAudio: (base64Audio) => {
        this.modelSpeaking = true;
        this.outboundBreaker.recordSuccess();
        this.callbacks?.onAudio(base64Audio);
      },
      onTurnComplete: () => {
        console.log("Turn complete");
        this.modelSpeaking = false;
        this.schedulePendingContextFlush();
        this.callbacks?.onTurnComplete();
      },
      onInterrupted: () => {
        console.log("Interrupted - clearing playback");
        this.modelSpeaking = false;
        this.schedulePendingContextFlush();
        this.callbacks?.onInterrupted();
      },
      onTranscript: (speaker, text) => {
        if (speaker === "user") {
          // User transcript echo means the server received and processed mic audio —
          // this is a success signal, not a failure.
          this.outboundBreaker.recordSuccess();
          console.log(`User said: "${text}"`);
        } else {
          const cleaned = sanitizeModelSpeechText(text);
          console.log(`Gemini said: "${cleaned || text}"`);
        }
        this.callbacks?.onTranscript(speaker, text);
      },
    });
    this.turnCompleteFired = result.turnCompleteFired;
  }

  /**
   * Handle tool calls and send response via SDK
   */
  private handleToolCall(toolCall: any) {
    handleToolCallMessage(toolCall, {
      processedToolCallIds: this.processedToolCallIds,
      onEmotion: (emotion: EmotionState) => this.callbacks?.onEmotion(emotion),
      onCarModelSet: (payload) => this.callbacks?.onCarModelSet(payload),
      onLookThroughCamera: () => this.callbacks?.onLookThroughCamera?.(),
      onGetDriveContext: () => this.callbacks?.onGetDriveContext?.() ?? {},
      sendToolResponse: (payload) => this.session?.sendToolResponse(payload),
    });
  }

  private extractFunctionCallsFromServerContent(
    serverContent: any
  ): Array<{ id?: string; name: string; args?: any }> {
    const parts = serverContent?.modelTurn?.parts;
    if (!Array.isArray(parts)) return [];

    const calls: Array<{ id?: string; name: string; args?: any }> = [];
    for (const part of parts) {
      const fc = part?.functionCall;
      if (!fc || typeof fc.name !== "string") continue;
      calls.push({
        id: typeof fc.id === "string" ? fc.id : undefined,
        name: fc.name,
        args: fc.args,
      });
    }
    return calls;
  }

  private sendTextContext(
    contextString: string
  ): "realtime_input_text" | "client_content" {
    if (GEMINI_CLIENT_CONFIG.useRealtimeTextInput) {
      this.session?.sendRealtimeInput({
        text: contextString,
      });
      return "realtime_input_text";
    }

    this.session?.sendClientContent({
      turns: [{ role: "user", parts: [{ text: contextString }] }],
      turnComplete: true,
    });
    return "client_content";
  }

  private handleSessionResumptionUpdate(update: any) {
    const resumable = Boolean(update?.resumable);
    const newHandle =
      typeof update?.newHandle === "string" && update.newHandle.length > 0
        ? update.newHandle
        : null;

    if (resumable && newHandle) {
      this.sessionResumptionHandle = newHandle;
    }

    RuntimeTelemetry.event("gemini_session_resumption_update", {
      resumable,
      handlePresent: Boolean(newHandle),
      lastConsumedClientMessageIndex: update?.lastConsumedClientMessageIndex,
    });
  }

  /**
   * Auto-reconnect with exponential backoff
   */
  private scheduleReconnect(reasonCode?: number | string) {
    this.reconnectScheduler.clear();
    if (this.reconnectAttempts >= GEMINI_CLIENT_CONFIG.maxReconnectAttempts) {
      console.error(
        `Max reconnect attempts (${GEMINI_CLIENT_CONFIG.maxReconnectAttempts}) reached`
      );
      RuntimeTelemetry.event("gemini_reconnect_exhausted", {
        maxAttempts: GEMINI_CLIENT_CONFIG.maxReconnectAttempts,
      });
      this.callbacks?.onReconnectExhausted();
      return;
    }

    const {
      delayMs: delay,
      burstMultiplier,
      internalErrorCount,
    } = this.reconnectPolicy.computeDelay(this.reconnectAttempts);
    const adjustedDelay =
      reasonCode === GEMINI_CLIENT_CONFIG.unsupportedOperationCode
        ? this.isDegradedModeActive()
          ? 800
          : Math.max(delay, 2000)
        : delay;
    this.reconnectAttempts++;
    console.log(
      `Reconnecting in ${adjustedDelay}ms (attempt ${this.reconnectAttempts}/${GEMINI_CLIENT_CONFIG.maxReconnectAttempts})`
    );
    this.callbacks?.onReconnectScheduled?.(this.reconnectAttempts);
    RuntimeTelemetry.event("gemini_reconnect_scheduled", {
      delay: adjustedDelay,
      attempt: this.reconnectAttempts,
      reasonCode,
      internalErrorCount,
      burstMultiplier,
      degradedMode: this.isDegradedModeActive(),
    });

    this.reconnectScheduler.schedule(adjustedDelay, () => {
      if (this.lastPersonalityCtx) {
        this.connect(this.lastPersonalityCtx);
      }
    });
  }

  /**
   * Proactive reconnect (e.g., on goAway)
   */
  private reconnect(reason: string = "proactive") {
    const hadActiveSession = this.session !== null;
    this.reconnectScheduler.clear();
    if (hadActiveSession || this.isReady) {
      this.isReady = false;
      this.callbacks?.onConnectionChange(false);
    }
    this.intentionalClose = true;
    this.connectionGeneration += 1;
    RuntimeTelemetry.event("gemini_reconnect_forced", {
      reason,
      generation: this.connectionGeneration,
      hadActiveSession,
    });
    this.pendingForcedReconnectReason = reason;
    this.streamingTimeoutGuard.reset();
    this.videoBudget.reset();
    this.sessionBudget.reset();
    closeGeminiSession(this.session);
    this.session = null;
    this.reconnectAttempts = 0;
    if (this.lastPersonalityCtx) {
      this.connect(this.lastPersonalityCtx);
    }
  }

  public forceReconnect(reason: string) {
    this.reconnect(reason);
  }

  public manualRetry() {
    this.reconnectAttempts = 0;
    this.reconnectPolicy.reset();
    this.reconnectScheduler.clear();
    RuntimeTelemetry.event("gemini_manual_retry_requested");
    if (this.lastPersonalityCtx) {
      this.connect(this.lastPersonalityCtx);
    }
  }

  // Apply a freshly-learned car model (or refusal) to the active session so
  // the AI stops asking and starts roasting NOW, not after a reconnect.
  // Also mutates lastPersonalityCtx so any future reconnect rebuilds the
  // system prompt with the car context baked in.
  public updateCarContext(payload: { model: string; refused: boolean }) {
    if (this.lastPersonalityCtx) {
      this.lastPersonalityCtx = {
        ...this.lastPersonalityCtx,
        carModel: payload.refused ? "Unknown Car" : payload.model,
        carModelRefused: payload.refused,
      };
    }
    if (!this.isReady) return;
    const note = payload.refused
      ? "System note: the driver declined to say what they drive. Drop the topic permanently — do not ask again this session or any future session."
      : `System note: the driver's car is now recorded as ${payload.model}. Stop asking and fold this into your material naturally — no announcement, just use it.`;
    this.sendSilentContextUpdate(note);
    RuntimeTelemetry.event("gemini_car_context_updated", {
      refused: payload.refused,
    });
  }

  public disconnect() {
    this.intentionalClose = true;
    this.connectionGeneration += 1;
    this.reconnectScheduler.clear();
    this.clearPendingContextFlushTimer();
    this.pendingSilentContext = null;
    this.pendingSilentContextKind = null;
    this.pendingSilentContextQueuedAt = 0;
    this.pendingSilentContextFingerprint = null;
    this.modelSpeaking = false;
    this.processedToolCallIds.clear();
    this.unsupportedOperationCloseTimes = [];
    this.reconnectPolicy.reset();
    this.streamingTimeoutGuard.reset();
    this.videoBudget.reset();
    this.sessionBudget.reset();
    closeGeminiSession(this.session);
    this.session = null;
    this.isReady = false;
  }

  public get connected(): boolean {
    return this.isReady;
  }

  /**
   * Check if streaming is stalled (no data for 30s).
   * Returns true if stall detected — caller should force reconnect.
   */
  public checkStreamingStall(): boolean {
    if (!this.isReady) return false; // Not streaming, no stall possible

    const stalled = this.streamingTimeoutGuard.checkStalled();
    if (stalled) {
      const silentMs = this.streamingTimeoutGuard.getSilentMs();
      RuntimeTelemetry.event("gemini_streaming_stall_detected", {
        silentMs,
        connected: this.isReady,
        generation: this.connectionGeneration,
      });
    }
    return stalled;
  }

  public getStreamingSilentMs(): number {
    return this.streamingTimeoutGuard.getSilentMs();
  }
  private recordUnsupportedOperationClose(code: number | string): number {
    if (code !== GEMINI_CLIENT_CONFIG.unsupportedOperationCode) return 0;
    const now = Date.now();
    this.unsupportedOperationCloseTimes.push(now);
    const cutoff = now - GEMINI_CLIENT_CONFIG.internalErrorWindowMs;
    this.unsupportedOperationCloseTimes =
      this.unsupportedOperationCloseTimes.filter((t) => t >= cutoff);
    return this.unsupportedOperationCloseTimes.length;
  }

  private isDegradedModeActive(): boolean {
    return Date.now() < this.degradedModeUntil;
  }
}
