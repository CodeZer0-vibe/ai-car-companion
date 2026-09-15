import { GeminiLiveClient } from "./GeminiLiveClient";
import { MemoryEngine } from "./MemoryEngine";
import { RelationshipEngine } from "./RelationshipEngine";
import { composeLightweightContext } from "./runtime/AutonomousContextComposer";
import { RuntimeTelemetry } from "./RuntimeTelemetry";
import type { LocationContext } from "./runtime/AppLocationRuntime";
import { APP_RUNTIME } from "./runtime/AppRuntimeConfig";

interface AutonomousEventLoopOptions {
  getConversationSilenceMs?: () => number;
  isTurnPending?: () => boolean;
}

/**
 * Periodic environmental context injector — feeds driving state, location, weather,
 * and memory into the Gemini session every 90s so the AI stays situation-aware.
 */
export class AutonomousEventLoop {
  private client: GeminiLiveClient;
  private memory: MemoryEngine;
  private relationship: RelationshipEngine | null;
  private loopInterval: ReturnType<typeof setInterval> | null = null;
  private primerTimeout: ReturnType<typeof setTimeout> | null = null;
  private loopMs: number;
  private isDriving = false;
  private locationCtx: LocationContext | null = null;
  private tickCount = 0;
  private injectInProgress = false;
  private active = false;
  private getConversationSilenceMs?: () => number;
  private isTurnPending?: () => boolean;

  constructor(
    client: GeminiLiveClient,
    memory: MemoryEngine,
    relationship: RelationshipEngine | null = null,
    loopMs: number = 90000,
    options: AutonomousEventLoopOptions = {}
  ) {
    this.client = client;
    this.memory = memory;
    this.relationship = relationship;
    this.loopMs = loopMs;
    this.getConversationSilenceMs = options.getConversationSilenceMs;
    this.isTurnPending = options.isTurnPending;
  }

  public setDrivingStatus(isDriving: boolean) {
    this.isDriving = isDriving;
  }

  public setLocationContext(ctx: LocationContext | null) {
    this.locationCtx = ctx;
  }

  public start() {
    if (this.loopInterval) clearInterval(this.loopInterval);
    this.active = true;

    // Primer: push fresh time/location/weather ~6s after connect so the session
    // starts situation-aware. The 90s loop + 20s-silence gate otherwise leaves
    // Gemini with no real clock/location for the first minute+ → wrong-time answers.
    if (this.primerTimeout) clearTimeout(this.primerTimeout);
    this.primerTimeout = setTimeout(() => {
      this.injectContext(true);
    }, 6000);

    this.loopInterval = setInterval(() => {
      this.injectContext();
    }, this.loopMs);
    console.log(`Context loop started (${this.loopMs}ms interval)`);
  }

  public stop() {
    this.active = false;
    if (this.primerTimeout) {
      clearTimeout(this.primerTimeout);
      this.primerTimeout = null;
    }
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }

  private async injectContext(force = false) {
    if (!this.active || !this.client.connected) return;
    if (this.injectInProgress) {
      RuntimeTelemetry.event("autonomous_loop_tick_skipped_overlap");
      return;
    }
    this.injectInProgress = true;

    try {
      this.tickCount += 1;
      const silenceMs = this.getConversationSilenceMs?.() ?? 0;
      RuntimeTelemetry.event("autonomous_loop_tick", {
        tick: this.tickCount,
        isDriving: this.isDriving,
        hasLocation: Boolean(this.locationCtx),
        silenceMs,
      });

      // Avoid injecting ordered user turns while the app is already waiting
      // for a model response to the driver's latest utterance.
      if (this.isTurnPending?.()) {
        RuntimeTelemetry.event("autonomous_loop_tick_skipped_waiting_turn", {
          tick: this.tickCount,
          silenceMs,
        });
        return;
      }

      if (!force && silenceMs < APP_RUNTIME.autonomousContextMinSilenceMs) {
        RuntimeTelemetry.event("autonomous_loop_tick_skipped_recent_activity", {
          tick: this.tickCount,
          silenceMs,
          minSilenceMs: APP_RUNTIME.autonomousContextMinSilenceMs,
        });
        return;
      }

      const context = await composeLightweightContext(
        this.memory,
        this.isDriving,
        this.locationCtx
      );
      if (!this.active) return;
      this.client.sendSilentContextUpdate(context);
      RuntimeTelemetry.event("autonomous_loop_context_sent", {
        mode: "lightweight_context",
        textLen: context.length,
        tick: this.tickCount,
      });
    } catch (e) {
      RuntimeTelemetry.error("autonomous_loop_inject_failed", e);
    } finally {
      this.injectInProgress = false;
    }
  }
}
