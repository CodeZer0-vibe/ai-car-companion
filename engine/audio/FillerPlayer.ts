import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { RuntimeTelemetry } from "../RuntimeTelemetry";

export interface PlayClipOptions {
  onFinished?: () => void;
}

export class FillerPlayer {
  private current: AudioPlayer | null = null;
  private currentOnFinished: (() => void) | null = null;
  private loading = false;
  private playing = false;

  public async playClip(
    requireId: number,
    options?: PlayClipOptions
  ): Promise<void> {
    this.stop();
    this.loading = true;
    this.playing = true;
    const onFinished = options?.onFinished ?? null;
    try {
      const player = createAudioPlayer(requireId, { updateInterval: 250 });
      player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) {
          this.handleFinished(player);
        }
      });
      this.current = player;
      this.currentOnFinished = onFinished;
      this.loading = false;
      player.play();
      RuntimeTelemetry.event("filler_player_play", { requireId });
    } catch (err) {
      this.loading = false;
      this.playing = false;
      this.current = null;
      this.currentOnFinished = null;
      RuntimeTelemetry.error("filler_player_load_failed", err, { requireId });
      throw err;
    }
  }

  public stop(): void {
    const player = this.current;
    this.current = null;
    this.currentOnFinished = null;
    this.playing = false;
    this.loading = false;
    if (!player) return;
    try {
      player.pause();
    } catch (err) {
      RuntimeTelemetry.error("filler_player_pause_failed", err);
    }
    try {
      player.remove();
    } catch (err) {
      RuntimeTelemetry.error("filler_player_remove_failed", err);
    }
  }

  public isPlaying(): boolean {
    return this.playing || this.loading;
  }

  public dispose(): void {
    this.stop();
  }

  private handleFinished(player: AudioPlayer): void {
    if (this.current !== player) return;
    const onFinished = this.currentOnFinished;
    this.current = null;
    this.currentOnFinished = null;
    this.playing = false;
    try {
      player.remove();
    } catch (err) {
      RuntimeTelemetry.error("filler_player_remove_failed", err);
    }
    if (onFinished) {
      try {
        onFinished();
      } catch (err) {
        RuntimeTelemetry.error("filler_player_listener_failed", err);
      }
    }
  }
}
