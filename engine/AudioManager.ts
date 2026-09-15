import LiveAudioStream from "react-native-live-audio-stream";
import { PermissionsAndroid, Platform } from "react-native";
import {
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import { RuntimeTelemetry } from "./RuntimeTelemetry";

// iOS audio session configuration for noise suppression + echo cancellation
async function configureIOSAudioSession() {
  if (Platform.OS !== "ios") return;
  try {
    // Set audio session to record mode with voice processing
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "duckOthers",
    });
    RuntimeTelemetry.event("ios_audio_mode_configured");
  } catch (e) {
    console.warn("iOS audio session config warning:", e);
    // Non-critical, continue anyway
  }
}

export class AudioManager {
  private isRecording = false;
  private onAudioChunk: ((base64Data: string) => void) | null = null;
  private onPermissionDenied: (() => void) | null = null;
  private streamInitialized = false;
  private lastRearmAt = 0;
  private streamChunkCount = 0;
  private streamBytesApprox = 0;
  private lastStreamHeartbeatAt = Date.now();
  private lastChunkAt = Date.now();
  private streamHealthTimer: ReturnType<typeof setInterval> | null = null;

  public setOnAudioChunk(callback: (base64Data: string) => void) {
    this.onAudioChunk = callback;
  }

  public setOnPermissionDenied(callback: () => void) {
    this.onPermissionDenied = callback;
  }

  private ensureStreamHealthTimer() {
    if (this.streamHealthTimer) return;
    this.streamHealthTimer = setInterval(() => {
      if (!this.isRecording) return;
      const silenceMs = Date.now() - this.lastChunkAt;
      if (silenceMs > 7000) {
        RuntimeTelemetry.event("sensor_mic_inactive_warning", {
          silenceMs,
          streamInitialized: this.streamInitialized,
        });
      }
    }, 3000);
  }

  private initStream() {
    if (this.streamInitialized) return;
    this.streamInitialized = true;

    const options: any = {
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      bufferSize: 4096,
      wavFile: "audio_stream.wav",
      // audioSource 6 is Android-only (VOICE_RECOGNITION)
      ...(Platform.OS === "android" ? { audioSource: 6 } : {}),
    };

    LiveAudioStream.init(options);
    RuntimeTelemetry.event("sensor_mic_stream_initialized", {
      sampleRate: options.sampleRate,
      channels: options.channels,
      bitsPerSample: options.bitsPerSample,
      bufferSize: options.bufferSize,
      platform: Platform.OS,
    });

    LiveAudioStream.on("data", (data: string) => {
      this.streamChunkCount += 1;
      this.streamBytesApprox += Math.floor((data.length * 3) / 4);
      this.lastChunkAt = Date.now();

      const now = Date.now();
      if (now - this.lastStreamHeartbeatAt >= 5000) {
        this.lastStreamHeartbeatAt = now;
        RuntimeTelemetry.event("sensor_mic_stream_stats", {
          chunks: this.streamChunkCount,
          bytesApprox: this.streamBytesApprox,
          isRecording: this.isRecording,
          hasCallback: Boolean(this.onAudioChunk),
        });
        this.streamChunkCount = 0;
        this.streamBytesApprox = 0;
      }

      if (this.onAudioChunk) {
        this.onAudioChunk(data);
      }
    });

    this.ensureStreamHealthTimer();
  }

  public async requestPermissions(): Promise<boolean> {
    if (Platform.OS === "android") {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: "Dashboard Pet Microphone",
            message: "The AI needs to hear you to judge you.",
            buttonNeutral: "Ask Me Later",
            buttonNegative: "Cancel",
            buttonPositive: "OK",
          }
        );
        RuntimeTelemetry.event("sensor_mic_permission", {
          platform: "android",
          granted: granted === PermissionsAndroid.RESULTS.GRANTED,
          result: granted,
        });
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        console.warn(err);
        RuntimeTelemetry.error("sensor_mic_permission_failed", err, {
          platform: "android",
        });
        return false;
      }
    }

    // iOS: request permission explicitly — returning true without asking causes silent blocking
    const { status } = await requestRecordingPermissionsAsync();
    console.log(`iOS mic permission: ${status}`);
    RuntimeTelemetry.event("sensor_mic_permission", {
      platform: "ios",
      status,
      granted: status === "granted",
    });
    return status === "granted";
  }

  public async startRecording() {
    if (this.isRecording) return;
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      console.warn("No mic permission granted.");
      RuntimeTelemetry.event("sensor_mic_permission_denied_startRecording");
      if (this.onPermissionDenied) {
        this.onPermissionDenied();
      }
      return;
    }

    // Configure iOS audio session for voice processing (noise suppression, echo cancellation)
    await configureIOSAudioSession();

    // Init AFTER permission is granted — on iOS, native audio init before permission
    // can silently consume the permission slot and block all subsequent requests
    this.initStream();

    try {
      LiveAudioStream.start();
      this.isRecording = true;
      this.ensureStreamHealthTimer();
      console.log("LiveAudioStream started");
      RuntimeTelemetry.event("sensor_mic_stream_started");
    } catch (e) {
      console.error("Failed to start LiveAudioStream:", e);
      RuntimeTelemetry.error("sensor_mic_stream_start_failed", e);
    }
  }

  public stopRecording() {
    if (!this.isRecording) return;
    try {
      LiveAudioStream.stop();
      this.isRecording = false;
      console.log("LiveAudioStream stopped");
      RuntimeTelemetry.event("sensor_mic_stream_stopped");
      if (this.streamHealthTimer) {
        clearInterval(this.streamHealthTimer);
        this.streamHealthTimer = null;
      }
    } catch (e) {
      console.error("Failed to stop LiveAudioStream:", e);
      RuntimeTelemetry.error("sensor_mic_stream_stop_failed", e);
    }
  }

  // iOS can drop the native recorder when playback reconfigures the audio session.
  // Rearm the native stream without re-requesting permissions.
  public async rearmRecording() {
    if (!this.streamInitialized) {
      await this.startRecording();
      return;
    }
    const now = Date.now();
    const sinceLastRearmMs = this.lastRearmAt > 0 ? now - this.lastRearmAt : -1;
    if (this.lastRearmAt > 0 && sinceLastRearmMs < 1200) {
      return;
    }
    this.lastRearmAt = now;
    try {
      LiveAudioStream.stop();
    } catch {}
    // iOS needs ~80ms for the native AudioSession to fully release the
    // recorder before .start() can bind to the mic again (esp. after
    // an interruption ended event from a phone call or Siri).
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    try {
      LiveAudioStream.start();
      this.isRecording = true;
      console.log("LiveAudioStream rearmed");
      RuntimeTelemetry.event("sensor_mic_stream_rearmed", {
        sinceLastRearmMs,
      });
    } catch (e) {
      this.isRecording = false;
      console.error("Failed to rearm LiveAudioStream:", e);
      RuntimeTelemetry.error("sensor_mic_stream_rearm_failed", e);
    }
  }

  public dispose() {
    this.stopRecording();
  }
}
