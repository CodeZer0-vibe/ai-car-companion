// Tracks video streaming time per Gemini Live session generation.
// Gemini Live caps mixed audio+video sessions at ~120s; we warn at 90s and
// force a reconnect at 110s so we never hit the cap mid-burst.

export type VideoBudgetAction = "ok" | "warn" | "exceed";

export class VideoBudgetTracker {
  private firstFrameAt = 0;
  private warned = false;

  constructor(
    private readonly warnMs: number,
    private readonly maxMs: number
  ) {}

  noteFrame(now: number): VideoBudgetAction {
    if (this.firstFrameAt === 0) {
      this.firstFrameAt = now;
      return "ok";
    }
    const elapsed = now - this.firstFrameAt;
    if (elapsed >= this.maxMs) return "exceed";
    if (elapsed >= this.warnMs && !this.warned) {
      this.warned = true;
      return "warn";
    }
    return "ok";
  }

  elapsedMs(now: number): number {
    return this.firstFrameAt === 0 ? 0 : now - this.firstFrameAt;
  }

  reset(): void {
    this.firstFrameAt = 0;
    this.warned = false;
  }
}
