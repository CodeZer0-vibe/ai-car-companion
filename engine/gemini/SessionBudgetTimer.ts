import { RuntimeTelemetry } from "../RuntimeTelemetry";

export class SessionBudgetTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;

  constructor(
    private readonly maxMs: number,
    private readonly onExceeded: () => void
  ) {}

  public start(): void {
    this.reset();
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      RuntimeTelemetry.event("gemini_session_budget_exceeded", {
        maxMs: this.maxMs,
        elapsedMs: Date.now() - this.startedAt,
      });
      this.onExceeded();
    }, this.maxMs);
  }

  public reset(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.startedAt = 0;
  }

  public elapsedMs(): number {
    return this.startedAt === 0 ? 0 : Date.now() - this.startedAt;
  }
}
