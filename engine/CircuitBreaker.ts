/**
 * Circuit breaker: prevents cascading failures by failing fast when a system is degraded.
 * Once threshold of failures is reached, all calls fail immediately until recovery window.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerConfig {
  failureThreshold: number; // Failures to open circuit (e.g., 5 failures)
  resetTimeoutMs: number;    // Time before attempting recovery (e.g., 10s)
  windowMs: number;          // Time window for counting failures (e.g., 60s)
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private failureTimes: number[] = [];
  private lastOpenAt = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeoutMs: config.resetTimeoutMs ?? 10000,
      windowMs: config.windowMs ?? 60000,
    };
  }

  public recordSuccess() {
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failureCount = 0;
      this.failureTimes = [];
    }
  }

  public recordFailure() {
    const now = Date.now();

    // Prune old failures outside the window
    this.failureTimes = this.failureTimes.filter((t) => now - t < this.config.windowMs);
    this.failureCount = this.failureTimes.length;

    // Record new failure
    this.failureTimes.push(now);
    this.failureCount = this.failureTimes.length;

    // Transition to open if threshold reached
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
      this.lastOpenAt = now;
    }
  }

  public canAttempt(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastOpenAt >= this.config.resetTimeoutMs) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }

    // half-open: allow attempt
    return true;
  }

  public getState(): CircuitState {
    return this.state;
  }

  public getFailureCount(): number {
    return this.failureCount;
  }

  public reset() {
    this.state = 'closed';
    this.failureCount = 0;
    this.failureTimes = [];
    this.lastOpenAt = 0;
  }
}
