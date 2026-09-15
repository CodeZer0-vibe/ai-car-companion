export type LatencySource = 'audio' | 'transcript' | 'turnComplete';

export class TurnLatencyTracker {
  private readonly maxSamples: number;
  private samples: number[] = [];
  private waitingSince = 0;
  private captured = false;

  constructor(maxSamples: number = 30) {
    this.maxSamples = maxSamples;
  }

  public startWaiting(now: number = Date.now()) {
    this.waitingSince = now;
    this.captured = false;
  }

  public stopWaiting() {
    this.waitingSince = 0;
  }

  public capture(now: number = Date.now()): number | null {
    if (this.waitingSince <= 0 || this.captured) return null;
    const delta = now - this.waitingSince;
    this.captured = true;
    this.samples.push(delta);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    return delta;
  }

  public getWaitingMs(now: number = Date.now()): number {
    if (this.waitingSince <= 0 || this.captured) return 0;
    return now - this.waitingSince;
  }

  public getAverage(): number | null {
    if (this.samples.length === 0) return null;
    return Math.round(this.samples.reduce((sum, ms) => sum + ms, 0) / this.samples.length);
  }

  public getSampleCount(): number {
    return this.samples.length;
  }
}
