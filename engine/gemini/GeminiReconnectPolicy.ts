import { GEMINI_CLIENT_CONFIG } from './GeminiClientConfig';

export class GeminiReconnectPolicy {
  private internalErrorCloseTimes: number[] = [];

  public reset() {
    this.internalErrorCloseTimes = [];
  }

  public recordClose(code: number | string): number {
    if (code !== GEMINI_CLIENT_CONFIG.internalErrorCode) return 0;
    const now = Date.now();
    this.internalErrorCloseTimes.push(now);
    this.prune(now);
    return this.internalErrorCloseTimes.length;
  }

  public getInternalErrorBurstCount(): number {
    this.prune(Date.now());
    return this.internalErrorCloseTimes.length;
  }

  public computeDelay(attempt: number): { delayMs: number; burstMultiplier: number; internalErrorCount: number } {
    const baseDelay = GEMINI_CLIENT_CONFIG.reconnectBaseDelayMs * Math.pow(2, attempt);
    const internalErrorCount = this.getInternalErrorBurstCount();
    const burstMultiplier = internalErrorCount >= GEMINI_CLIENT_CONFIG.internalErrorBurstThreshold
      ? GEMINI_CLIENT_CONFIG.internalErrorBurstMultiplier
      : 1;
    const cappedDelay = Math.min(
      GEMINI_CLIENT_CONFIG.reconnectMaxDelayMs,
      Math.floor(baseDelay * burstMultiplier)
    );
    // Full-jitter backoff avoids synchronized reconnect storms across clients.
    const jitteredDelay = Math.floor(Math.random() * (cappedDelay + 1));

    return {
      delayMs: Math.max(GEMINI_CLIENT_CONFIG.reconnectMinDelayMs, jitteredDelay),
      burstMultiplier,
      internalErrorCount,
    };
  }

  private prune(now: number) {
    const cutoff = now - GEMINI_CLIENT_CONFIG.internalErrorWindowMs;
    this.internalErrorCloseTimes = this.internalErrorCloseTimes.filter((t) => t >= cutoff);
  }
}
