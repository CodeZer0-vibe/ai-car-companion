import { StreamingPlayer } from "./StreamingPlayer";
import { generateRadioStatic } from "./PcmAudioUtils";
import { APP_RUNTIME } from "../runtime/AppRuntimeConfig";
import { RuntimeTelemetry } from "../RuntimeTelemetry";

interface PlaybackControllerDeps {
  onSpeakingChange: (speaking: boolean) => void;
  restoreMicPipeline: () => void;
}

export class PlaybackController {
  private readonly onSpeakingChange: (speaking: boolean) => void;
  private readonly restoreMicPipeline: () => void;

  private readonly player: StreamingPlayer;
  private speaking = false;
  private pendingEnqueue = 0;
  private isFirstChunk = true;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private tailHoldTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBackpressureLogAt = 0;

  constructor(deps: PlaybackControllerDeps) {
    this.onSpeakingChange = deps.onSpeakingChange;
    this.restoreMicPipeline = deps.restoreMicPipeline;
    this.player = new StreamingPlayer({
      onQueueDrained: () => this.onQueueDrained(),
      onError: (err) => RuntimeTelemetry.error("streaming_player_error", err),
    });
  }

  public enqueueChunk(base64Chunk: string): void {
    if (this.tailHoldTimer) {
      clearTimeout(this.tailHoldTimer);
      this.tailHoldTimer = null;
    }

    const totalQueued = this.player.getQueuedCount() + this.pendingEnqueue;
    if (totalQueued >= APP_RUNTIME.playbackMaxBufferedChunks) {
      // Drop the INCOMING chunk so the queued audio keeps playing cleanly.
      // Previously cleared the whole queue, which cut Gemini mid-sentence
      // with an audible jump. Losing the tail of a response is preferable
      // to slicing the middle out.
      const now = Date.now();
      if (now - this.lastBackpressureLogAt > 3000) {
        this.lastBackpressureLogAt = now;
        RuntimeTelemetry.event("playback_backpressure_drop", {
          maxBufferedChunks: APP_RUNTIME.playbackMaxBufferedChunks,
          totalQueued,
        });
      }
      return;
    }

    this.setSpeaking(true);
    this.resetWatchdog();

    if (this.isFirstChunk) {
      this.isFirstChunk = false;
      this.pendingEnqueue += 1;
      this.player
        .enqueueInt16PcmBytes(generateRadioStatic(50))
        .catch((err) => RuntimeTelemetry.error("enqueue_static_failed", err))
        .finally(() => {
          this.pendingEnqueue = Math.max(0, this.pendingEnqueue - 1);
        });
    }

    this.pendingEnqueue += 1;
    this.player
      .enqueueInt16PcmBase64(base64Chunk)
      .catch((err) => RuntimeTelemetry.error("enqueue_chunk_failed", err))
      .finally(() => {
        this.pendingEnqueue = Math.max(0, this.pendingEnqueue - 1);
      });
  }

  public playPending(): void {
    // Streaming node plays buffers as soon as they are enqueued — nothing to do.
  }

  public stopPlayback(restoreMic: boolean = true): void {
    this.player.clear();
    this.isFirstChunk = true;
    this.clearWatchdog();
    if (this.tailHoldTimer) {
      clearTimeout(this.tailHoldTimer);
      this.tailHoldTimer = null;
    }
    this.setSpeaking(false);
    if (restoreMic) {
      this.restoreMicPipeline();
    }
  }

  public dispose(): void {
    this.stopPlayback(false);
    this.player
      .dispose()
      .catch((err) =>
        RuntimeTelemetry.error("streaming_player_dispose_failed", err)
      );
  }

  public isSpeaking(): boolean {
    return this.speaking;
  }

  public getBufferedChunkCount(): number {
    return this.player.getQueuedCount() + this.pendingEnqueue;
  }

  private onQueueDrained(): void {
    if (this.pendingEnqueue > 0) {
      // A later chunk is still decoding — it will enqueue shortly. Don't
      // declare silence yet.
      return;
    }
    if (this.tailHoldTimer) {
      clearTimeout(this.tailHoldTimer);
    }
    // Hold speaking state briefly so the mic doesn't ping-pong between
    // adjacent turns if more audio arrives within the grace window.
    this.tailHoldTimer = setTimeout(() => {
      this.tailHoldTimer = null;
      if (this.player.getQueuedCount() > 0 || this.pendingEnqueue > 0) {
        return;
      }
      this.isFirstChunk = true;
      this.clearWatchdog();
      this.setSpeaking(false);
      this.restoreMicPipeline();
    }, APP_RUNTIME.playbackTailHoldMs);
  }

  private setSpeaking(speaking: boolean): void {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    this.onSpeakingChange(speaking);
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private resetWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      RuntimeTelemetry.event("playback_watchdog_forced_recovery");
      this.player.clear();
      this.isFirstChunk = true;
      this.setSpeaking(false);
      this.restoreMicPipeline();
    }, APP_RUNTIME.playbackWatchdogMs);
  }
}
