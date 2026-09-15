export type FillerBucket =
  | "COLD_START"
  | "NETWORK_LOST"
  | "RECONNECTING"
  | "BRAIN_DOWN"
  | "API_KEY_MISSING"
  | "IDLE_FILLER";

export type FillerSfx = "boot-chirp" | "reconnect-ping" | "glitch-crackle";

const VOICE_CLIPS: Record<FillerBucket, number[]> = {
  COLD_START: [
    require("../../assets/sounds/filler/cold-start-1.mp3"),
    require("../../assets/sounds/filler/cold-start-2.mp3"),
    require("../../assets/sounds/filler/cold-start-3.mp3"),
  ],
  NETWORK_LOST: [
    require("../../assets/sounds/filler/network-lost-1.mp3"),
    require("../../assets/sounds/filler/network-lost-2.mp3"),
    require("../../assets/sounds/filler/network-lost-3.mp3"),
  ],
  RECONNECTING: [
    require("../../assets/sounds/filler/reconnecting-1.mp3"),
    require("../../assets/sounds/filler/reconnecting-2.mp3"),
  ],
  BRAIN_DOWN: [
    require("../../assets/sounds/filler/brain-down-1.mp3"),
    require("../../assets/sounds/filler/brain-down-2.mp3"),
  ],
  API_KEY_MISSING: [require("../../assets/sounds/filler/api-missing-1.mp3")],
  IDLE_FILLER: [
    require("../../assets/sounds/filler/idle-1.mp3"),
    require("../../assets/sounds/filler/idle-2.mp3"),
    require("../../assets/sounds/filler/idle-3.mp3"),
    require("../../assets/sounds/filler/idle-4.mp3"),
  ],
};

const SFX_CLIPS: Record<FillerSfx, number> = {
  "boot-chirp": require("../../assets/sounds/filler/sfx-boot-chirp.mp3"),
  "reconnect-ping": require("../../assets/sounds/filler/sfx-reconnect-ping.mp3"),
  "glitch-crackle": require("../../assets/sounds/filler/sfx-glitch-crackle.mp3"),
};

export class FillerBank {
  private readonly bags: Record<FillerBucket, number[]> = {
    COLD_START: [],
    NETWORK_LOST: [],
    RECONNECTING: [],
    BRAIN_DOWN: [],
    API_KEY_MISSING: [],
    IDLE_FILLER: [],
  };
  private readonly lastPicked: Partial<Record<FillerBucket, number>> = {};

  public pick(bucket: FillerBucket): number | null {
    const pool = VOICE_CLIPS[bucket];
    if (!pool || pool.length === 0) return null;
    if (pool.length === 1) {
      this.lastPicked[bucket] = pool[0];
      return pool[0];
    }
    if (this.bags[bucket].length === 0) {
      this.bags[bucket] = shuffled(pool);
      const last = this.lastPicked[bucket];
      const bag = this.bags[bucket];
      if (last !== undefined && bag[bag.length - 1] === last) {
        // Next pop would repeat the most-recent clip. Swap to push it to
        // the end of the queue so the refill doesn't produce a back-to-back.
        const tail = bag.length - 1;
        [bag[0], bag[tail]] = [bag[tail], bag[0]];
      }
    }
    const picked = this.bags[bucket].pop();
    if (picked === undefined) return null;
    this.lastPicked[bucket] = picked;
    return picked;
  }

  public getSfx(name: FillerSfx): number {
    return SFX_CLIPS[name];
  }
}

function shuffled<T>(source: readonly T[]): T[] {
  const arr = [...source];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
