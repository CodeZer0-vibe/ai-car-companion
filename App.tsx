import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  SetStateAction,
} from "react";
import {
  StyleSheet,
  View,
  StatusBar,
  Pressable,
  Text,
  Share as NativeShare,
  AppState,
  Linking,
} from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { CameraView, useCameraPermissions } from "expo-camera";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { useSharedValue } from "react-native-reanimated";
import * as Sentry from "@sentry/react-native";
import Face from "./components/Face";
import { EmotionState } from "./engine/EmotionEngine";
import { TriggerType } from "./engine/PersonalityEngine";
import { AudioManager } from "./engine/AudioManager";
import { GeminiLiveClient } from "./engine/GeminiLiveClient";
import { MemoryEngine } from "./engine/MemoryEngine";
import { RelationshipEngine } from "./engine/RelationshipEngine";
import { AutonomousEventLoop } from "./engine/AutonomousEventLoop";
import { SessionLogger } from "./engine/SessionLogger";
import { MicGate } from "./engine/MicGate";
import { RuntimeTelemetry } from "./engine/RuntimeTelemetry";
import { GrowthEngine } from "./engine/GrowthEngine";
import { getActionPrompt } from "./engine/runtime/ActionPrompt";
import { PlaybackController } from "./engine/audio/PlaybackController";
import { FillerCoordinator } from "./engine/runtime/FillerCoordinator";
import { TurnLatencyTracker } from "./engine/runtime/TurnLatencyTracker";
import { TranscriptCoordinator } from "./engine/runtime/TranscriptCoordinator";
import { applyReactionRuntime } from "./engine/runtime/ReactionRuntime";
import { sharePetInvite } from "./engine/growth/SharePetService";
import { AppSessionRuntime } from "./engine/runtime/AppSessionRuntime";
import { APP_RUNTIME } from "./engine/runtime/AppRuntimeConfig";
import {
  startLocationTracking,
  LocationContext,
} from "./engine/runtime/AppLocationRuntime";
import { extractMusicMention } from "./engine/runtime/MusicContextExtractor";
import { extractVisionQuestion } from "./engine/runtime/VisionQuestionExtractor";
import { getTimeContext } from "./engine/context/TimeContext";
import {
  getCachedWeather,
  weatherToContext,
} from "./engine/runtime/AppWeatherRuntime";
import { sanitizeModelSpeechText } from "./engine/runtime/transcript/TranscriptNormalizer";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  debug: __DEV__,
  tracesSampleRate: 0.2,
});

export default function App() {
  useKeepAwake();

  const [emotionState, setEmotionState] = useState<EmotionState>("idle");
  const [speechText, setSpeechText] = useState<string | null>(null);
  const [isSpeakingState, setIsSpeakingState] = useState(false);
  const [systemStatus, setSystemStatus] = useState("Waking up...");
  const [speedKmh, setSpeedKmh] = useState(0);
  const [appLifecycleState, setAppLifecycleState] = useState(
    AppState.currentState ?? "active"
  );
  const [isVisionEnabled, setIsVisionEnabled] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastVisionObservation, setLastVisionObservation] = useState<
    string | null
  >(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const locationCleanupRef = useRef<(() => void) | null>(null);
  const locationContextRef = useRef<LocationContext | null>(null);
  const emotionStateRef = useRef<EmotionState>("idle");
  const speedKmhRef = useRef(0);
  const cameraRef = useRef<CameraView | null>(null);
  const visionCaptureInFlightRef = useRef(false);
  const isVisionEnabledRef = useRef(false);
  const isCameraReadyRef = useRef(false);
  const cameraPermissionGrantedRef = useRef(false);
  const cameraPermissionStatusRef = useRef("unknown");
  const cameraReadyAtRef = useRef(0);
  const visionBurstUntilRef = useRef(0);
  const visionBurstIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  // Tilt as SharedValues — updated at 31fps by accelerometer without causing React re-renders
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);

  const totalInteractions = useRef(0);
  const appStartAtRef = useRef(Date.now());
  const ahaTrackedRef = useRef(false);
  const lastAction = useRef<TriggerType | null>(null);
  const timeSinceAction = useRef(0);
  const lastTapTime = useRef(0);
  const lastManualRecoveryAt = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debugSnapshotIntervalRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const accelSubRef = useRef<{ remove: () => void } | null>(null);
  const emotionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef<string>(AppState.currentState ?? "active");

  const sessionLogger = useRef<SessionLogger>(new SessionLogger());

  // Gate: don't forward mic audio until Gemini has completed its first turn with audio.
  // Without this, mic floods Gemini with audio before the wake-up message arrives,
  // causing an immediate 'interrupted' signal and a broken conversation state.
  const geminiReady = useRef(false);

  const audioManager = useRef<AudioManager | null>(null);
  const geminiClient = useRef<GeminiLiveClient | null>(null);
  const memoryEngine = useRef<MemoryEngine | null>(null);
  const relationshipEngine = useRef<RelationshipEngine | null>(null);
  const autonomousLoop = useRef<AutonomousEventLoop | null>(null);
  const growthEngine = useRef<GrowthEngine | null>(null);

  const playbackControllerRef = useRef<PlaybackController | null>(null);
  const fillerCoordinatorRef = useRef<FillerCoordinator | null>(null);
  const micGateRef = useRef<MicGate | null>(null);
  const greetingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micHealthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const idleFillerTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const lastMicChunkAtRef = useRef(Date.now());
  const lastConversationAtRef = useRef(Date.now());
  const carModelRefusedRef = useRef(false);
  const responseWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const turnLatencyTrackerRef = useRef(new TurnLatencyTracker(30));
  const waitingForGeminiRef = useRef(false);
  const activeTurnIdRef = useRef<string | null>(null);
  const turnIdSequenceRef = useRef(0);
  const lastGeminiUtteranceRef = useRef<string>("");
  const lastGeminiUtteranceAtRef = useRef(0);
  const shouldRecoverOnForegroundRef = useRef(false);
  const lastForegroundRecoveryAtRef = useRef(0);
  const micDeniedRef = useRef(false);
  const reconnectExhaustedRef = useRef(false);
  const transcriptCoordinatorRef = useRef<TranscriptCoordinator | null>(null);
  const greetingSentOnceRef = useRef(false);
  const persistenceFlushInFlightRef = useRef<Promise<void> | null>(null);

  // Debounce speech text updates to avoid re-render spam during streaming
  const pendingSpeechTextRef = useRef<string | null>(null);
  const speechTextDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const debouncedSetSpeechText = useCallback(
    (update: SetStateAction<string | null>) => {
      const next = typeof update === "function" ? update(speechText) : update;
      if (next === null) {
        setSpeechText(null);
        if (speechTextDebounceRef.current)
          clearTimeout(speechTextDebounceRef.current);
        return;
      }
      pendingSpeechTextRef.current = next;
      if (speechTextDebounceRef.current)
        clearTimeout(speechTextDebounceRef.current);
      speechTextDebounceRef.current = setTimeout(() => {
        const pending = pendingSpeechTextRef.current;
        if (pending !== null) {
          setSpeechText(pending);
          pendingSpeechTextRef.current = null;
        }
      }, 80);
    },
    [speechText]
  );

  // Rate-limit action prompts: max 1 every 8s to avoid flooding Gemini with
  // text turns that can trigger 1011 on the preview model.
  const lastActionSentTime = useRef(0);
  const lastMusicMentionAtRef = useRef(0);

  useEffect(() => {
    isVisionEnabledRef.current = isVisionEnabled;
  }, [isVisionEnabled]);

  useEffect(() => {
    isCameraReadyRef.current = isCameraReady;
  }, [isCameraReady]);

  useEffect(() => {
    cameraPermissionStatusRef.current = cameraPermission?.status ?? "unknown";
    cameraPermissionGrantedRef.current = Boolean(cameraPermission?.granted);
  }, [cameraPermission?.status]);

  const triggerReaction = useCallback((action: TriggerType) => {
    lastConversationAtRef.current = Date.now();
    applyReactionRuntime({
      action,
      setEmotionState,
      emotionTimeoutRef,
      timeSinceActionRef: timeSinceAction,
      totalInteractionsRef: totalInteractions,
      lastActionRef: lastAction,
      lastActionSentTimeRef: lastActionSentTime,
      logAction: (a) => sessionLogger.current.log("ACTION", a),
      sendContextUpdate: (prompt) => {
        if (waitingForGeminiRef.current) {
          RuntimeTelemetry.event("action_prompt_deferred_waiting_turn", {
            action,
            textLen: prompt.length,
            turnId: activeTurnIdRef.current,
          });
          return;
        }
        geminiClient.current?.sendSilentContextUpdate(prompt);
      },
      getActionPrompt,
      relationshipEngineRef: relationshipEngine,
      memoryEngineRef: memoryEngine,
    });
  }, []);

  const flushSessionArtifacts = useCallback(async (reason: string) => {
    if (persistenceFlushInFlightRef.current) {
      await persistenceFlushInFlightRef.current;
      return;
    }

    const flushPromise = (async () => {
      RuntimeTelemetry.event("session_artifacts_flush_requested", { reason });
      try {
        await Promise.all([
          memoryEngine.current?.flushPendingWrites(),
          sessionLogger.current.saveToFile(),
        ]);
        RuntimeTelemetry.event("session_artifacts_flush_complete", { reason });
      } catch (error) {
        RuntimeTelemetry.error("session_artifacts_flush_failed", error, {
          reason,
        });
      }
    })();

    persistenceFlushInFlightRef.current = flushPromise;
    try {
      await flushPromise;
    } finally {
      persistenceFlushInFlightRef.current = null;
    }
  }, []);

  const handleSharePet = useCallback(async () => {
    await sharePetInvite({
      growthEngine: growthEngine.current,
      relationshipEngine: relationshipEngine.current,
      share: NativeShare.share,
      sharedAction: NativeShare.sharedAction,
      onEvent: RuntimeTelemetry.event,
      onError: RuntimeTelemetry.error,
    });
  }, []);

  const handleVisionToggle = useCallback(async () => {
    if (isVisionEnabled) {
      setIsVisionEnabled(false);
      setIsCameraReady(false);
      setLastVisionObservation(null);
      cameraReadyAtRef.current = 0;
      setCameraError(null);
      RuntimeTelemetry.event("vision_camera_disabled");
      geminiClient.current?.sendSilentContextUpdate(
        "Vision feed is offline. Do not imply that you can currently see the road, traffic, or nearby scene."
      );
      return;
    }

    try {
      if (
        cameraPermission &&
        !cameraPermission.granted &&
        !cameraPermission.canAskAgain
      ) {
        setCameraError("Camera permission is blocked in system settings.");
        RuntimeTelemetry.event("sensor_camera_permission_blocked");
        await Linking.openSettings();
        return;
      }

      const permission = cameraPermission?.granted
        ? cameraPermission
        : await requestCameraPermission();

      if (permission) {
        RuntimeTelemetry.event("sensor_camera_permission", {
          status: permission.status,
          granted: permission.granted,
          canAskAgain: permission.canAskAgain,
        });
      }

      if (!permission?.granted) {
        setCameraError(
          permission?.canAskAgain === false
            ? "Camera permission is blocked in system settings."
            : "Camera permission denied."
        );
        return;
      }

      setCameraError(null);
      setIsVisionEnabled(true);
      setLastVisionObservation(null);
      RuntimeTelemetry.event("vision_camera_enabled");
    } catch (e) {
      setCameraError("Unable to start the rear camera.");
      RuntimeTelemetry.error("vision_camera_toggle_failed", e);
    }
  }, [cameraPermission, isVisionEnabled, requestCameraPermission]);

  const handleCameraReady = useCallback(() => {
    cameraReadyAtRef.current = Date.now();
    setIsCameraReady(true);
    setCameraError(null);
    RuntimeTelemetry.event("vision_camera_ready");
  }, []);

  const handleCameraMountError = useCallback((event: { message: string }) => {
    // Render a fixed in-character line; never surface the raw native
    // CameraMountError.message on screen (developer-flavored text in a
    // recorded frame). The raw message is preserved in telemetry only.
    setIsCameraReady(false);
    setLastVisionObservation(null);
    cameraReadyAtRef.current = 0;
    setCameraError("Rear cam won't wake up.");
    RuntimeTelemetry.event("vision_camera_mount_error", {
      message: event.message || "(empty)",
    });
  }, []);

  const takeVisionSnapshot = useCallback(
    async (
      quality: number,
      source: "passive" | "question"
    ): Promise<string | null> => {
      RuntimeTelemetry.event("vision_snapshot_requested", { source, quality });
      if (!isVisionEnabledRef.current) {
        RuntimeTelemetry.event("vision_snapshot_skipped", {
          source,
          reason: "vision_disabled",
        });
        return null;
      }
      if (!cameraPermissionGrantedRef.current) {
        RuntimeTelemetry.event("vision_snapshot_skipped", {
          source,
          reason: "permission_not_granted",
        });
        return null;
      }
      if (!isCameraReadyRef.current) {
        RuntimeTelemetry.event("vision_snapshot_skipped", {
          source,
          reason: "camera_not_ready",
        });
        return null;
      }
      if (appStateRef.current !== "active") {
        RuntimeTelemetry.event("vision_snapshot_skipped", {
          source,
          reason: "app_not_active",
          appState: appStateRef.current,
        });
        return null;
      }
      if (visionCaptureInFlightRef.current) {
        RuntimeTelemetry.event("vision_snapshot_skipped", {
          source,
          reason: "capture_in_flight",
        });
        return null;
      }
      if (Date.now() - cameraReadyAtRef.current < APP_RUNTIME.visionWarmupMs) {
        RuntimeTelemetry.event("vision_snapshot_skipped", {
          source,
          reason: "camera_warming_up",
        });
        return null;
      }

      const camera = cameraRef.current;
      if (!camera) {
        RuntimeTelemetry.event("vision_snapshot_skipped", {
          source,
          reason: "missing_camera_ref",
        });
        return null;
      }

      visionCaptureInFlightRef.current = true;
      const captureStartedAt = Date.now();
      try {
        const picture = await camera.takePictureAsync({
          quality: 1,
          shutterSound: false,
          skipProcessing: true,
        });
        if (!picture.uri) {
          RuntimeTelemetry.event("vision_frame_capture_missing_uri");
          return null;
        }
        const resized = await manipulateAsync(
          picture.uri,
          [{ resize: { width: APP_RUNTIME.visionFrameWidth } }],
          { base64: true, compress: quality, format: SaveFormat.JPEG }
        );
        if (!resized.base64) {
          RuntimeTelemetry.event("vision_frame_capture_missing_base64");
          return null;
        }
        // captureMs measures the full client-side capture+resize+encode cost —
        // the part of vision latency we can cut (e.g. via a pre-held frame).
        RuntimeTelemetry.event("vision_snapshot_captured", {
          source,
          quality,
          captureMs: Date.now() - captureStartedAt,
          widthPx: APP_RUNTIME.visionFrameWidth,
          bytesApprox: Math.floor((resized.base64.length * 3) / 4),
        });
        return resized.base64;
      } catch (e) {
        RuntimeTelemetry.error("vision_frame_capture_failed", e, {
          source,
          quality,
        });
      } finally {
        visionCaptureInFlightRef.current = false;
      }
      return null;
    },
    []
  );

  const stopVisionBurst = useCallback((reason: string) => {
    if (visionBurstIntervalRef.current) {
      clearInterval(visionBurstIntervalRef.current);
      visionBurstIntervalRef.current = null;
    }
    if (visionBurstUntilRef.current > 0) {
      visionBurstUntilRef.current = 0;
      RuntimeTelemetry.event("vision_burst_stopped", { reason });
    }
  }, []);

  const captureAndSendVisionFrame = useCallback(async () => {
    if (Date.now() > visionBurstUntilRef.current) {
      stopVisionBurst("window_expired");
      return;
    }
    if (appStateRef.current !== "active") {
      stopVisionBurst("app_backgrounded");
      return;
    }
    try {
      const base64Jpeg = await takeVisionSnapshot(
        APP_RUNTIME.visionBurstFrameQuality,
        "question"
      );
      if (!base64Jpeg) return;
      geminiClient.current?.sendVisionFrame(base64Jpeg, "image/jpeg");
    } catch (e) {
      RuntimeTelemetry.error("vision_burst_tick_failed", e);
    }
  }, [stopVisionBurst, takeVisionSnapshot]);

  const startVisionBurst = useCallback(
    async (query: string) => {
      const now = Date.now();
      const alreadyActive = visionBurstUntilRef.current > now;
      visionBurstUntilRef.current = now + APP_RUNTIME.visionBurstWindowMs;

      const promptText = `Visual check requested: "${query}". Look at the image attached to THIS message and describe what you actually see right now. If it is unclear or too dark, say so directly.`;

      // Capture a FRESH frame and send it bundled WITH the prompt in ONE ordered
      // clientContent turn. The Live API does not guarantee delivery order for
      // sendRealtimeInput, so the old split path (realtime video + realtime/
      // silent text) let the prompt beat the frame and Gemini answered stale
      // buffered frames — intermittently describing the previous scene. Bundling
      // guarantees the model answers THIS question against THIS frame.
      const sendFreshVisionQuery = async () => {
        const frame = await takeVisionSnapshot(
          APP_RUNTIME.visionBurstFrameQuality,
          "question"
        );
        if (frame && geminiClient.current?.sendVisionQuery(frame, promptText)) {
          return;
        }
        // No fresh frame (camera warming/in-flight) or send failed. Fall back to
        // text only; the continuous burst frames below feed ambient context.
        RuntimeTelemetry.event("vision_query_no_fresh_frame_fallback", {
          hadFrame: Boolean(frame),
        });
        geminiClient.current?.sendSilentContextUpdate(promptText);
      };

      if (alreadyActive) {
        // Burst already running — STILL capture a fresh frame for the new query.
        // The old extend path re-prompted with no fresh frame, so a follow-up
        // question always answered the previous direction's stale frames.
        await sendFreshVisionQuery();
        RuntimeTelemetry.event("vision_burst_extended", {
          queryLen: query.length,
          windowMs: APP_RUNTIME.visionBurstWindowMs,
        });
        return;
      }

      RuntimeTelemetry.event("vision_burst_started", {
        queryLen: query.length,
        windowMs: APP_RUNTIME.visionBurstWindowMs,
        frameIntervalMs: APP_RUNTIME.visionBurstFrameIntervalMs,
      });

      await sendFreshVisionQuery();

      visionBurstIntervalRef.current = setInterval(() => {
        captureAndSendVisionFrame().catch((e) =>
          RuntimeTelemetry.error("vision_burst_interval_tick_failed", e)
        );
      }, APP_RUNTIME.visionBurstFrameIntervalMs);
    },
    [captureAndSendVisionFrame, takeVisionSnapshot]
  );

  const handleVisionQuestion = useCallback((text: string) => {
    const visionQuestion = extractVisionQuestion(text);
    if (!visionQuestion) return;
    RuntimeTelemetry.event("vision_question_detected", {
      textLen: visionQuestion.query.length,
    });

    if (
      !isVisionEnabledRef.current ||
      !isCameraReadyRef.current ||
      cameraPermissionStatusRef.current !== "granted"
    ) {
      geminiClient.current?.sendSilentContextUpdate(
        "Visual check requested, but vision is currently unavailable. If the user asks what you can see, say you cannot verify it visually right now."
      );
      RuntimeTelemetry.event("vision_question_skipped_unavailable", {
        visionEnabled: isVisionEnabledRef.current,
        visionReady: isCameraReadyRef.current,
        permission: cameraPermissionStatusRef.current,
      });
      return;
    }

    startVisionBurst(visionQuestion.query);
  }, []);

  useEffect(() => {
    emotionStateRef.current = emotionState;
  }, [emotionState]);

  useEffect(() => {
    speedKmhRef.current = speedKmh;
  }, [speedKmh]);

  // --- Audio playback ---

  const restoreMicPipeline = useCallback(() => {
    audioManager.current?.rearmRecording();
  }, []);

  const onMicPermissionDenied = useCallback(() => {
    micDeniedRef.current = true;
    RuntimeTelemetry.event("mic_permission_denied_user_surface");
    setSpeechText("Mic's muted. Tap me, then flip it on in Settings.");
  }, []);

  const onReconnectExhausted = useCallback(() => {
    reconnectExhaustedRef.current = true;
    RuntimeTelemetry.event("gemini_reconnect_exhausted_user_surface");
    setSystemStatus("Brain down.");
    setSpeechText("Lost the signal. Tap me to reboot.");
  }, []);

  const onUserTranscriptFlush = useCallback(
    (text: string) => {
      // Hard barge-in: user speech immediately cancels any in-flight playback.
      playbackControllerRef.current?.stopPlayback();

      lastConversationAtRef.current = Date.now();
      sessionLogger.current.log("USER", text);
      memoryEngine.current?.addMemory(`User said: "${text}"`);

      const mention = extractMusicMention(text);
      if (mention) {
        const now = Date.now();
        if (now - lastMusicMentionAtRef.current > 45000) {
          lastMusicMentionAtRef.current = now;
          const songCtx = mention.artist
            ? `Music context (internal): Driver is listening to "${mention.track}" by ${mention.artist}. If natural, roast their music taste in one short line.`
            : `Music context (internal): Driver is listening to "${mention.track}". If natural, roast their music taste in one short line.`;
          geminiClient.current?.sendSilentContextUpdate(songCtx);
          RuntimeTelemetry.event("music_context_captured", {
            hasArtist: Boolean(mention.artist),
            trackLen: mention.track.length,
          });
        }
      }

      void handleVisionQuestion(text);

      // Every flushed user utterance is a fresh turn boundary.
      // Reset wait tracking to avoid stale waiting windows across utterances.
      turnIdSequenceRef.current += 1;
      activeTurnIdRef.current = `turn-${turnIdSequenceRef.current}`;
      turnLatencyTrackerRef.current.startWaiting();
      waitingForGeminiRef.current = true;
      setSystemStatus("Listening...");
      RuntimeTelemetry.event("gemini_wait_started", {
        textLen: text.length,
        turnId: activeTurnIdRef.current,
      });
    },
    [handleVisionQuestion]
  );

  const markGeminiResponse = useCallback(
    (source: "audio" | "transcript" | "turnComplete") => {
      if (!waitingForGeminiRef.current) return;
      const delta = turnLatencyTrackerRef.current.capture();
      if (delta === null) return;
      const avg = turnLatencyTrackerRef.current.getAverage();
      RuntimeTelemetry.metric("gemini_round_trip_ms", delta, {
        source,
        avgMs: avg,
        turnId: activeTurnIdRef.current,
      });
    },
    []
  );

  const onGeminiTranscriptFlush = useCallback(
    (text: string) => {
      // A real transcript arrived — clear wait state regardless of sanitized
      // content. Otherwise a sanitize-to-empty or duplicate path lets the
      // watchdog fire an 18s force-reconnect mid-conversation.
      lastConversationAtRef.current = Date.now();
      markGeminiResponse("transcript");
      if (waitingForGeminiRef.current) {
        RuntimeTelemetry.event("gemini_wait_cleared", {
          source: "transcript",
          waitingMs: turnLatencyTrackerRef.current.getWaitingMs(),
          textLen: text.length,
          turnId: activeTurnIdRef.current,
        });
        waitingForGeminiRef.current = false;
        activeTurnIdRef.current = null;
        turnLatencyTrackerRef.current.stopWaiting();
      }

      const cleanedText = sanitizeModelSpeechText(text);
      if (!cleanedText) return;

      const now = Date.now();
      const normalized = cleanedText.toLowerCase();
      const isRapidDuplicate =
        normalized.length > 12 &&
        normalized === lastGeminiUtteranceRef.current &&
        now - lastGeminiUtteranceAtRef.current < 12000;
      if (isRapidDuplicate) {
        RuntimeTelemetry.event("gemini_transcript_duplicate_suppressed", {
          textLen: cleanedText.length,
          withinMs: now - lastGeminiUtteranceAtRef.current,
        });
        return;
      }

      lastGeminiUtteranceRef.current = normalized;
      lastGeminiUtteranceAtRef.current = now;

      sessionLogger.current.log("GEMINI", cleanedText);
      setSpeechText(cleanedText);
      setSystemStatus("Talking.");
    },
    [markGeminiResponse]
  );

  // --- Main setup ---

  useEffect(() => {
    RuntimeTelemetry.installGlobalHandlers();
    const runtime = new AppSessionRuntime({
      apiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY,
      setSpeechText: debouncedSetSpeechText,
      setSystemStatus,
      setEmotionState,
      setIsSpeakingState,
      appStartAtRef,
      ahaTrackedRef,
      timeSinceActionRef: timeSinceAction,
      totalInteractionsRef: totalInteractions,
      sessionLoggerRef: sessionLogger,
      emotionTimeoutRef,
      geminiReadyRef: geminiReady,
      audioManagerRef: audioManager,
      geminiClientRef: geminiClient,
      memoryEngineRef: memoryEngine,
      relationshipEngineRef: relationshipEngine,
      autonomousLoopRef: autonomousLoop,
      growthEngineRef: growthEngine,
      playbackControllerRef,
      micGateRef,
      transcriptCoordinatorRef,
      fillerCoordinatorRef,
      greetingTimerRef,
      micHealthIntervalRef,
      responseWatchdogRef,
      idleTimerRef,
      idleFillerTimerRef,
      accelSubRef,
      lastMicChunkAtRef,
      lastConversationAtRef,
      carModelRefusedRef,
      waitingForGeminiRef,
      activeTurnIdRef,
      turnIdSequenceRef,
      greetingSentOnceRef,
      turnLatencyTrackerRef,
      tiltX,
      tiltY,
      triggerReaction,
      onUserTranscriptFlush,
      onGeminiTranscriptFlush,
      markGeminiResponse,
      restoreMicPipeline,
      onMicPermissionDenied,
      onReconnectExhausted,
      // Agent-first: Gemini PULLS vision/context via tools (immune to transcript
      // language). lookThroughCamera → the proven on-demand vision burst.
      onLookThroughCamera: () => {
        startVisionBurst(
          "the driver asked you to look — say what the camera actually sees"
        ).catch((e) =>
          RuntimeTelemetry.error("look_through_camera_tool_failed", e)
        );
      },
      getDriveContextSnapshot: () => {
        const t = getTimeContext();
        const loc = locationContextRef.current;
        const weather = weatherToContext(getCachedWeather());
        return {
          localTime: t.clock,
          timeOfDay: t.timeOfDay,
          dayOfWeek: t.dayOfWeek,
          city: loc?.city ?? null,
          country: loc?.country ?? null,
          speedKmh: Math.round(loc?.speedKmh ?? speedKmhRef.current ?? 0),
          isMoving: loc?.isMoving ?? false,
          weather: weather || null,
        };
      },
    });

    runtime.start().catch((e) => RuntimeTelemetry.error("app_setup_failed", e));
    setSystemStatus("Waking up...");

    if (debugSnapshotIntervalRef.current) {
      clearInterval(debugSnapshotIntervalRef.current);
    }
    debugSnapshotIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const location = locationContextRef.current;
      RuntimeTelemetry.event("debug_runtime_snapshot", {
        appState: appStateRef.current,
        visionEnabled: isVisionEnabledRef.current,
        visionReady: isCameraReadyRef.current,
        cameraPermission: cameraPermissionStatusRef.current,
        emotion: emotionStateRef.current,
        connected: geminiClient.current?.connected ?? false,
        geminiReady: geminiReady.current,
        waitingForGemini: waitingForGeminiRef.current,
        activeTurnId: activeTurnIdRef.current,
        waitingMs: turnLatencyTrackerRef.current.getWaitingMs(),
        playbackSpeaking: playbackControllerRef.current?.isSpeaking() ?? false,
        playbackBufferedChunks:
          playbackControllerRef.current?.getBufferedChunkCount() ?? 0,
        micGateActive: micGateRef.current?.isActive() ?? false,
        msSinceMicChunk: now - lastMicChunkAtRef.current,
        speedKmh: Number(speedKmhRef.current.toFixed(1)),
        hasLocation: Boolean(location),
        city: location?.city ?? null,
        isMoving: location?.isMoving ?? false,
        tripDistanceKm: location
          ? Number(location.tripDistanceKm.toFixed(3))
          : null,
        tripDurationMin: location
          ? Number(location.tripDurationMin.toFixed(2))
          : null,
        tiltX: Number(tiltX.value.toFixed(3)),
        tiltY: Number(tiltY.value.toFixed(3)),
      });
    }, APP_RUNTIME.debugSnapshotMs);

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      const wasWaiting = waitingForGeminiRef.current;
      const wasSpeaking = playbackControllerRef.current?.isSpeaking() ?? false;
      const wasConnected = geminiClient.current?.connected ?? false;
      appStateRef.current = nextState;
      setAppLifecycleState(nextState);
      RuntimeTelemetry.event("app_state_changed", { nextState });

      // iOS fires "inactive" for transient FOREGROUND interruptions that do
      // NOT background the app: Control Center, notification banners, the
      // app-switcher peek, the native Share sheet, and the first camera
      // permission dialog. Tearing down + reconnecting Gemini on those drops
      // the in-flight turn and paints "Lost signal...". Treat "inactive" as a
      // no-op (vision burst already pauses via the appLifecycleState effect
      // since appStateRef/appLifecycleState are updated above). Only a real
      // "background" transition triggers teardown.
      if (nextState === "inactive") {
        RuntimeTelemetry.event("app_state_inactive_noop", { nextState });
        stopVisionBurst("app_inactive");
        return;
      }

      if (nextState === "background") {
        const shouldRecover =
          wasWaiting || wasSpeaking || isVisionEnabledRef.current;
        shouldRecoverOnForegroundRef.current = shouldRecover || wasConnected;
        setSystemStatus(shouldRecover ? "Pausing..." : "Going to sleep...");
        RuntimeTelemetry.event("app_foreground_recovery_marked", {
          nextState,
          marked: shouldRecoverOnForegroundRef.current,
          waitingForGemini: wasWaiting,
          playbackSpeaking: wasSpeaking,
          connected: wasConnected,
          visionEnabled: isVisionEnabledRef.current,
        });
        RuntimeTelemetry.event("app_state_persistence_flush_requested", {
          nextState,
        });
        stopVisionBurst("app_backgrounded");
        audioManager.current?.stopRecording();
        autonomousLoop.current?.stop();
        geminiClient.current?.disconnect();
        flushSessionArtifacts(`app_state_${nextState}`).catch((err) => {
          RuntimeTelemetry.error("app_state_flush_failed", err, { nextState });
        });
        return;
      }

      if (nextState !== "active") {
        // Any other non-active AppStateStatus (e.g. "unknown", "extension"):
        // do not tear down — just stop the vision burst defensively.
        RuntimeTelemetry.event("app_state_other_noop", { nextState });
        stopVisionBurst("app_state_other");
        return;
      }

      const now = Date.now();
      if (
        shouldRecoverOnForegroundRef.current &&
        now - lastForegroundRecoveryAtRef.current >=
          APP_RUNTIME.foregroundRecoveryDebounceMs
      ) {
        lastForegroundRecoveryAtRef.current = now;
        shouldRecoverOnForegroundRef.current = false;
        const connected = geminiClient.current?.connected ?? false;
        const shouldForceReconnect =
          waitingForGeminiRef.current || !connected || !geminiReady.current;
        RuntimeTelemetry.event("app_foreground_recovery_triggered", {
          waitingForGemini: waitingForGeminiRef.current,
          playbackSpeaking:
            playbackControllerRef.current?.isSpeaking() ?? false,
          connected,
          geminiReady: geminiReady.current,
          shouldForceReconnect,
          visionEnabled: isVisionEnabledRef.current,
        });
        setSystemStatus(
          shouldForceReconnect ? "Reconnecting..." : "Listening."
        );
        audioManager.current?.rearmRecording();
        autonomousLoop.current?.start();
        if (shouldForceReconnect) {
          geminiClient.current?.forceReconnect("app_foreground_resume");
        }
      }
    });

    return () => {
      appStateSub.remove();
      if (debugSnapshotIntervalRef.current) {
        clearInterval(debugSnapshotIntervalRef.current);
        debugSnapshotIntervalRef.current = null;
      }
      void flushSessionArtifacts("unmount");
      void runtime.cleanup();
    };
  }, [
    flushSessionArtifacts,
    triggerReaction,
    onUserTranscriptFlush,
    onGeminiTranscriptFlush,
    markGeminiResponse,
    restoreMicPipeline,
    onMicPermissionDenied,
    onReconnectExhausted,
    tiltX,
    tiltY,
  ]);

  // Stop any in-flight vision burst if camera, permission, or app lifecycle
  // state changes — avoids sending frames after disable/backgrounding.
  useEffect(() => {
    if (!isVisionEnabled || !cameraPermission?.granted || !isCameraReady) {
      stopVisionBurst("vision_unavailable");
    }
    if (appLifecycleState !== "active") {
      stopVisionBurst("app_not_active");
    }
  }, [
    appLifecycleState,
    cameraPermission?.granted,
    isCameraReady,
    isVisionEnabled,
    stopVisionBurst,
  ]);

  useEffect(
    () => () => {
      if (visionBurstIntervalRef.current) {
        clearInterval(visionBurstIntervalRef.current);
        visionBurstIntervalRef.current = null;
      }
    },
    []
  );

  // --- GPS Location Tracking ---
  useEffect(() => {
    startLocationTracking({
      onSpeed: setSpeedKmh,
      onContext: (ctx) => {
        locationContextRef.current = ctx;
        autonomousLoop.current?.setLocationContext(ctx);
        autonomousLoop.current?.setDrivingStatus(ctx.isMoving);
      },
    })
      .then((cleanup) => {
        locationCleanupRef.current = cleanup;
      })
      .catch((e) => RuntimeTelemetry.error("location_setup_failed", e));

    return () => {
      locationCleanupRef.current?.();
      if (speechTextDebounceRef.current)
        clearTimeout(speechTextDebounceRef.current);
    };
  }, []);

  // --- Touch handlers ---

  const handleSpeechDismiss = useCallback(() => {
    if (micDeniedRef.current) {
      micDeniedRef.current = false;
      setSpeechText(null);
      Linking.openSettings().catch((e) =>
        RuntimeTelemetry.error("mic_settings_open_failed", e)
      );
      return;
    }
    if (reconnectExhaustedRef.current) {
      reconnectExhaustedRef.current = false;
      setSpeechText(null);
      setSystemStatus("Waking up...");
      geminiClient.current?.manualRetry();
      RuntimeTelemetry.event("gemini_manual_retry_tap");
      return;
    }
    setSpeechText(null);
  }, []);

  const handlePress = useCallback(() => {
    const now = Date.now();
    if (waitingForGeminiRef.current) {
      const waitingMs = turnLatencyTrackerRef.current.getWaitingMs();
      if (
        waitingMs > APP_RUNTIME.responseReconnectMs &&
        now - lastManualRecoveryAt.current > 8000
      ) {
        lastManualRecoveryAt.current = now;
        RuntimeTelemetry.event("gemini_manual_recovery_requested", {
          waitingMs,
          source: "tap",
          turnId: activeTurnIdRef.current,
        });
        geminiClient.current?.forceReconnect("user_tap_waiting");
        return;
      }
    }

    const timeSinceLastTap = now - lastTapTime.current;
    lastTapTime.current = now;

    if (timeSinceLastTap < 300) {
      triggerReaction("doubleTap");
    } else {
      setTimeout(() => {
        if (Date.now() - lastTapTime.current >= 280) {
          triggerReaction("tap");
        }
      }, 300);
    }
  }, [triggerReaction]);

  const handleLongPress = useCallback(() => {
    if (waitingForGeminiRef.current) {
      const now = Date.now();
      const waitingMs = turnLatencyTrackerRef.current.getWaitingMs();
      if (
        waitingMs > APP_RUNTIME.responseReconnectMs &&
        now - lastManualRecoveryAt.current > 8000
      ) {
        lastManualRecoveryAt.current = now;
        RuntimeTelemetry.event("gemini_manual_recovery_requested", {
          waitingMs,
          source: "longPress",
          turnId: activeTurnIdRef.current,
        });
        geminiClient.current?.forceReconnect("user_longpress_waiting");
        return;
      }
    }
    triggerReaction("longPress");
  }, [triggerReaction]);

  const cameraToggleLabel = isVisionEnabled
    ? "Hide Rear Cam"
    : cameraPermission &&
      !cameraPermission.granted &&
      !cameraPermission.canAskAgain
    ? "Open Camera Settings"
    : "Enable Rear Cam";

  const cameraStatusText =
    cameraError ??
    (isVisionEnabled
      ? isCameraReady
        ? lastVisionObservation
          ? `Rear cam live. Last scene read: ${lastVisionObservation}`
          : "Rear cam live. No useful scene read yet."
        : "Starting rear camera..."
      : "Let Gemini see the road and nearby scene through the rear camera.");

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <Pressable
        style={styles.pressable}
        onPress={handlePress}
        onLongPress={handleLongPress}
        delayLongPress={600}
      >
        <Face
          emotionState={emotionState}
          speechText={speechText}
          onSpeechDismiss={handleSpeechDismiss}
          isSpeaking={isSpeakingState}
          tiltX={tiltX}
          tiltY={tiltY}
          onSharePress={handleSharePet}
          speedKmh={speedKmh}
        />
      </Pressable>
      <View pointerEvents="box-none" style={styles.overlayLayer}>
        {__DEV__ ? (
          <View style={styles.statusBanner}>
            <Text style={styles.statusLabel}>System</Text>
            <Text style={styles.statusText}>{systemStatus}</Text>
          </View>
        ) : null}
        {isVisionEnabled && cameraPermission?.granted ? (
          <View style={styles.cameraDock}>
            <CameraView
              ref={cameraRef}
              style={styles.cameraPreview}
              facing="back"
              active={appLifecycleState === "active"}
              animateShutter={false}
              pictureSize="1280x720"
              onCameraReady={handleCameraReady}
              onMountError={handleCameraMountError}
            />
            <View style={styles.cameraInfo}>
              <Text style={styles.cameraTitle}>Rear cam live</Text>
              <Text style={styles.cameraText}>{cameraStatusText}</Text>
            </View>
            <Pressable style={styles.cameraButton} onPress={handleVisionToggle}>
              <Text style={styles.cameraButtonText}>{cameraToggleLabel}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.cameraToggle} onPress={handleVisionToggle}>
            <Text style={styles.cameraTitle}>{cameraToggleLabel}</Text>
            <Text style={styles.cameraText}>{cameraStatusText}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  pressable: {
    flex: 1,
  },
  overlayLayer: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: "box-none",
  },
  statusBanner: {
    position: "absolute",
    top: 16,
    right: 16,
    minWidth: 220,
    maxWidth: 320,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,255,0.28)",
    backgroundColor: "rgba(0,0,0,0.85)",
  },
  statusLabel: {
    color: "#d9ffff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  statusText: {
    marginTop: 6,
    color: "rgba(217,255,255,0.95)",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "700",
  },
  cameraDock: {
    position: "absolute",
    top: 16,
    left: 16,
    width: 260,
    padding: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,255,0.28)",
    backgroundColor: "rgba(0,0,0,0.82)",
  },
  cameraPreview: {
    width: "100%",
    height: 150,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#111111",
  },
  cameraInfo: {
    marginTop: 10,
    gap: 4,
  },
  cameraToggle: {
    position: "absolute",
    top: 16,
    left: 16,
    width: 260,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,255,0.28)",
    backgroundColor: "rgba(0,0,0,0.82)",
  },
  cameraTitle: {
    color: "#d9ffff",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  cameraText: {
    marginTop: 4,
    color: "rgba(217,255,255,0.78)",
    fontSize: 12,
    lineHeight: 16,
  },
  cameraButton: {
    marginTop: 10,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(0,255,255,0.16)",
  },
  cameraButtonText: {
    color: "#d9ffff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
