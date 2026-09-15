import {
  AudioContext,
  AudioBufferQueueSourceNode,
  AudioManager,
} from "react-native-audio-api";
import { fromByteArray } from "base64-js";

// Native plugins (withIOSAudioSessionLock, withLiveAudioStreamPatch) own the
// AVAudioSession configuration. Prevent react-native-audio-api from stomping
// on it and silencing the mic when AudioContext is created.
let sessionManagementDisabled = false;
function disableSessionManagementOnce() {
  if (sessionManagementDisabled) return;
  try {
    AudioManager.disableSessionManagement();
  } catch {
    // Older platform versions / Android — method may be unavailable.
  }
  sessionManagementDisabled = true;
}

interface StreamingPlayerDeps {
  onQueueDrained: () => void;
  onError: (err: unknown) => void;
}

const PCM_SAMPLE_RATE = 24000;
const PCM_CHANNELS = 1;

export class StreamingPlayer {
  private ctx: AudioContext | null = null;
  private node: AudioBufferQueueSourceNode | null = null;
  private started = false;
  private queuedCount = 0;
  // Bumped on clear/dispose. Decoded buffers tagged with a stale generation
  // are dropped — prevents a mid-flight decodePCMInBase64 from enqueueing
  // leftover audio from an interrupted turn.
  private clearGeneration = 0;
  // Serialize decodePCMInBase64 calls so buffers enqueue in arrival order
  // even when decode promises resolve out of order.
  private enqueueChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: StreamingPlayerDeps) {}

  public getQueuedCount(): number {
    return this.queuedCount;
  }

  public enqueueInt16PcmBase64(base64: string): Promise<void> {
    this.enqueueChain = this.enqueueChain
      .catch(() => undefined)
      .then(() => this.doEnqueue(base64));
    return this.enqueueChain;
  }

  public enqueueInt16PcmBytes(bytes: Uint8Array): Promise<void> {
    return this.enqueueInt16PcmBase64(fromByteArray(bytes));
  }

  public clear(): void {
    this.clearGeneration += 1;
    this.node?.clearBuffers();
    this.queuedCount = 0;
  }

  public async dispose(): Promise<void> {
    this.clearGeneration += 1;
    this.clear();
    if (this.node) {
      try {
        this.node.stop();
      } catch (err) {
        this.deps.onError(err);
      }
      this.node = null;
    }
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch (err) {
        this.deps.onError(err);
      }
      this.ctx = null;
    }
    this.started = false;
  }

  private async doEnqueue(base64: string): Promise<void> {
    await this.ensureStarted();
    const ctx = this.ctx;
    const node = this.node;
    if (!ctx || !node) return;
    const snapshotGeneration = this.clearGeneration;
    try {
      const buffer = await ctx.decodePCMInBase64(
        base64,
        PCM_SAMPLE_RATE,
        PCM_CHANNELS
      );
      // If clear() or dispose() ran while decode was in flight, the buffer
      // belongs to an interrupted turn — drop it instead of appending it
      // to the freshly-cleared queue.
      if (snapshotGeneration !== this.clearGeneration) return;
      if (!this.node) return;
      this.node.enqueueBuffer(buffer);
      this.queuedCount += 1;
    } catch (err) {
      this.deps.onError(err);
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    disableSessionManagementOnce();
    const ctx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
    const node = ctx.createBufferQueueSource();
    node.connect(ctx.destination);
    node.onEnded = (event) => {
      // bufferId undefined = entire node stopped (clear/dispose). Ignore — state
      // transitions are driven explicitly. Numeric bufferId = one buffer ended.
      if (event.bufferId === undefined) return;
      this.queuedCount = Math.max(0, this.queuedCount - 1);
      if (this.queuedCount === 0) {
        this.deps.onQueueDrained();
      }
    };
    node.start(ctx.currentTime);
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch (err) {
        this.deps.onError(err);
      }
    }
    this.ctx = ctx;
    this.node = node;
    this.started = true;
  }
}
