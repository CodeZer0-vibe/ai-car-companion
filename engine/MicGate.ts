import { toByteArray } from 'base64-js';
import { APP_RUNTIME } from './runtime/AppRuntimeConfig';

interface MicGateConfig {
  minThreshold?: number;
  maxThreshold?: number;
  holdoverMs?: number;
  noiseMultiplier?: number;
  maxOpenMs?: number;
  reopenCooldownMs?: number;
}

const DEFAULT_CONFIG: Required<MicGateConfig> = {
  minThreshold: APP_RUNTIME.micGateMinThreshold,
  maxThreshold: APP_RUNTIME.micGateMaxThreshold,
  holdoverMs: APP_RUNTIME.micGateHoldoverMs,
  noiseMultiplier: APP_RUNTIME.micGateNoiseMultiplier,
  maxOpenMs: APP_RUNTIME.micGateMaxOpenMs,
  reopenCooldownMs: APP_RUNTIME.micGateReopenCooldownMs,
};

export class MicGate {
  private config: Required<MicGateConfig>;
  private active = false;
  private noiseFloor = 8;
  private chunkCount = 0;
  private activeSince = 0;
  private loudChunkStreak = 0;
  private reopenCooldownUntil = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: MicGateConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public shouldForward(base64Data: string): boolean {
    const bytes = toByteArray(base64Data);
    let maxAmp = 0;

    for (let i = 0; i < bytes.length - 1; i += 20) {
      const sample = bytes[i] | (bytes[i + 1] << 8);
      const signed = sample > 32767 ? sample - 65536 : sample;
      const abs = signed < 0 ? -signed : signed;
      if (abs > maxAmp) maxAmp = abs;
    }

    this.chunkCount += 1;
    // Keep adapting noise floor even while active so prolonged road noise
    // raises threshold and prevents the gate from staying open forever.
    // Use slower adaptation to be less aggressive in car environments.
    const adaptRate = this.active ? 0.04 : 0.03;
    this.noiseFloor = this.noiseFloor * (1 - adaptRate) + maxAmp * adaptRate;

    const dynamicThreshold = Math.max(
      this.config.minThreshold,
      Math.min(this.config.maxThreshold, Math.round(this.noiseFloor * this.config.noiseMultiplier))
    );

    if (this.chunkCount % 50 === 0) {
      console.log(`[MIC] amp=${maxAmp} active=${this.active} (threshold=${dynamicThreshold}, floor=${Math.round(this.noiseFloor)})`);
    }

    const now = Date.now();
    if (maxAmp >= dynamicThreshold) {
      const inReopenCooldown = !this.active && now < this.reopenCooldownUntil;
      const hugeSpikeBypass = maxAmp >= Math.round(dynamicThreshold * 2.4);
      if (inReopenCooldown && !hugeSpikeBypass) {
        return this.active;
      }

      this.loudChunkStreak += 1;
      // Require a tiny loud streak to avoid opening on one-frame spikes.
      const shouldOpen = this.active || this.loudChunkStreak >= 2;
      if (shouldOpen) {
        if (!this.active) console.log(`[MIC] GATE OPEN — amp=${maxAmp}`);
        if (!this.active) this.activeSince = Date.now();
        this.active = true;
      }
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.silenceTimer = setTimeout(() => {
        console.log('[MIC] GATE CLOSED (silence)');
        this.active = false;
        this.activeSince = 0;
        this.loudChunkStreak = 0;
      }, this.config.holdoverMs);
    } else {
      this.loudChunkStreak = 0;
    }

    // Safety valve: if gate has been open too long with only medium amplitude
    // (typical road/fan noise), force-close and let it retrigger naturally.
    if (
      this.active &&
      this.activeSince > 0 &&
      Date.now() - this.activeSince > this.config.maxOpenMs &&
      maxAmp < Math.round(dynamicThreshold * 1.35)
    ) {
      console.log(`[MIC] GATE FORCE-CLOSED (max-open) amp=${maxAmp} threshold=${dynamicThreshold}`);
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      this.active = false;
      this.activeSince = 0;
      this.loudChunkStreak = 0;
      this.reopenCooldownUntil = Date.now() + this.config.reopenCooldownMs;
    }

    return this.active;
  }

  public dispose() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.active = false;
    this.activeSince = 0;
    this.loudChunkStreak = 0;
    this.reopenCooldownUntil = 0;
  }

  public isActive(): boolean {
    return this.active;
  }
}
