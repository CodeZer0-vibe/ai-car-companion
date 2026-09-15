/**
 * Detects streaming stalls: if no data received for 30s, triggers forced reconnect.
 * Prevents zombie connections that appear alive but aren't receiving data.
 */
export class StreamingTimeoutGuard {
  private lastDataAt = Date.now();
  private stalledAt = 0;
  private isStalled = false;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = 30000) {
    this.timeoutMs = timeoutMs;
  }

  public notifyDataReceived() {
    this.lastDataAt = Date.now();
    if (this.isStalled) {
      this.isStalled = false;
      this.stalledAt = 0;
    }
  }

  public checkStalled(): boolean {
    const now = Date.now();
    const silentMs = now - this.lastDataAt;

    if (silentMs > this.timeoutMs && !this.isStalled) {
      this.isStalled = true;
      this.stalledAt = now;
      return true;
    }

    return this.isStalled;
  }

  public getSilentMs(): number {
    return Date.now() - this.lastDataAt;
  }

  public getStallDurationMs(): number {
    return this.isStalled ? Date.now() - this.stalledAt : 0;
  }

  public reset() {
    this.lastDataAt = Date.now();
    this.isStalled = false;
    this.stalledAt = 0;
  }
}
