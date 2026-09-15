import type { MutableRefObject } from "react";
import { RuntimeTelemetry } from "../RuntimeTelemetry";
import { FillerBank, type FillerBucket } from "../audio/FillerBank";
import { FillerPlayer } from "../audio/FillerPlayer";
import { NetworkMonitor } from "./NetworkMonitor";

export type { FillerBucket } from "../audio/FillerBank";

const RECONNECTING_COOLDOWN_MS = 15_000;
const IDLE_FILLER_COOLDOWN_MS = 90_000;
const IDLE_FILLER_SILENCE_THRESHOLD_MS = 90_000;
const MIC_FRESH_DEFER_MS = 2_000;

interface FillerCoordinatorDeps {
  isSpeaking: () => boolean;
  lastMicChunkAtRef: MutableRefObject<number>;
}

export class FillerCoordinator {
  private readonly player: FillerPlayer;
  private readonly bank: FillerBank;
  private readonly networkMonitor: NetworkMonitor;
  private readonly isSpeaking: () => boolean;
  private readonly lastMicChunkAtRef: MutableRefObject<number>;

  private started = false;
  private disposed = false;
  private coldStartCancelled = false;
  private lastReconnectingAt = 0;
  private lastIdleAt = 0;
  private lastLiveAudioAt = 0;

  constructor(deps: FillerCoordinatorDeps) {
    this.isSpeaking = deps.isSpeaking;
    this.lastMicChunkAtRef = deps.lastMicChunkAtRef;
    this.player = new FillerPlayer();
    this.bank = new FillerBank();
    this.networkMonitor = new NetworkMonitor({
      onOnline: () => {
        // Reconnect flow is handled by Gemini client; no filler trigger here.
      },
      onOffline: () => {
        this.trigger("NETWORK_LOST");
      },
    });
  }

  public start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.networkMonitor.start();
  }

  public trigger(bucket: FillerBucket): void {
    if (this.disposed) return;
    if (this.isSpeaking()) {
      RuntimeTelemetry.event("filler_drop_speaking", { bucket });
      return;
    }
    if (bucket === "RECONNECTING") {
      const now = Date.now();
      if (now - this.lastReconnectingAt < RECONNECTING_COOLDOWN_MS) {
        RuntimeTelemetry.event("filler_drop_cooldown", { bucket });
        return;
      }
      this.lastReconnectingAt = now;
    }
    if (bucket === "IDLE_FILLER") {
      const now = Date.now();
      if (now - this.lastIdleAt < IDLE_FILLER_COOLDOWN_MS) {
        RuntimeTelemetry.event("filler_drop_cooldown", { bucket });
        return;
      }
      if (now - this.lastMicChunkAtRef.current < MIC_FRESH_DEFER_MS) {
        RuntimeTelemetry.event("filler_drop_mic_fresh", { bucket });
        return;
      }
      this.lastIdleAt = now;
    }

    if (bucket === "COLD_START") {
      this.coldStartCancelled = false;
      this.playSequenced(bucket, "boot-chirp");
      return;
    }
    if (bucket === "BRAIN_DOWN") {
      this.playSequenced(bucket, "reconnect-ping");
      return;
    }
    this.playVoice(bucket);
  }

  public isFillerPlaying(): boolean {
    return this.player.isPlaying();
  }

  public onLiveAudioArrived(): void {
    if (this.disposed) return;
    this.lastLiveAudioAt = Date.now();
    if (this.player.isPlaying()) {
      this.player.stop();
      RuntimeTelemetry.event("filler_preempted_by_live_audio");
    }
  }

  public onGeminiReady(): void {
    if (this.disposed) return;
    // Cancel any pending COLD_START sequence — Gemini is live now.
    this.coldStartCancelled = true;
    if (this.player.isPlaying()) {
      this.player.stop();
      RuntimeTelemetry.event("filler_cancelled_on_gemini_ready");
    }
  }

  public onReconnectScheduled(attempt: number): void {
    if (this.disposed) return;
    if (attempt < 2) return;
    this.trigger("RECONNECTING");
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.networkMonitor.dispose();
    this.player.dispose();
  }

  public checkIdle(): void {
    if (this.disposed) return;
    if (this.player.isPlaying()) return;
    if (this.isSpeaking()) return;
    const now = Date.now();
    const sinceMic = now - this.lastMicChunkAtRef.current;
    const sinceLive = now - this.lastLiveAudioAt;
    const silenceMs = Math.min(sinceMic, sinceLive);
    if (silenceMs < IDLE_FILLER_SILENCE_THRESHOLD_MS) return;
    this.trigger("IDLE_FILLER");
  }

  private playVoice(bucket: FillerBucket): void {
    const clipId = this.bank.pick(bucket);
    if (clipId === null) {
      RuntimeTelemetry.event("filler_empty_bucket", { bucket });
      return;
    }
    this.player.playClip(clipId).catch((err) => {
      RuntimeTelemetry.error("filler_play_voice_failed", err, { bucket });
    });
    RuntimeTelemetry.event("filler_played", { bucket });
  }

  private playSequenced(
    bucket: FillerBucket,
    sfxName: "boot-chirp" | "reconnect-ping"
  ): void {
    const sfxId = this.bank.getSfx(sfxName);
    const voiceId = this.bank.pick(bucket);
    if (voiceId === null) {
      RuntimeTelemetry.event("filler_empty_bucket", { bucket });
      return;
    }
    const onSfxFinished = () => {
      if (this.disposed) return;
      if (bucket === "COLD_START" && this.coldStartCancelled) {
        RuntimeTelemetry.event("filler_cold_start_cancelled_mid_sequence");
        return;
      }
      if (this.isSpeaking()) {
        RuntimeTelemetry.event("filler_drop_speaking_midsequence", { bucket });
        return;
      }
      this.player.playClip(voiceId).catch((err) => {
        RuntimeTelemetry.error("filler_play_voice_failed", err, { bucket });
      });
    };
    this.player.playClip(sfxId, { onFinished: onSfxFinished }).catch((err) => {
      RuntimeTelemetry.error("filler_play_sfx_failed", err, {
        bucket,
        sfxName,
      });
    });
    RuntimeTelemetry.event("filler_played_sequenced", { bucket, sfxName });
  }
}
