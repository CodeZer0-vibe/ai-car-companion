# Offline Filler Audio — Design Spec

**Date:** 2026-04-18
**Feature:** F20 — Offline filler audio pack
**Status:** Revised after L-1 skeptic (3 CRITICAL + 5 IMPORTANT resolved)

## Problem

Dashboard Pet is silent whenever Gemini Live is unreachable: during the 1–3s cold-start window before the WebSocket is ready, during network loss, between reconnect attempts, after reconnect exhaustion, and when the API key is missing. Silence breaks the "sentient passenger" illusion — the character appears dead, not stranded.

Idle silence within a live session has the same effect: the car feels empty on long quiet stretches.

## Goal

Play pre-generated Riley-voiced MP3 clips (and three short SFX cues) at the moments the live model cannot fill. Clips are bundled in the app binary — zero network dependency. They maintain the character's voice, tone, and self-preservation instinct from `CHARACTER_ANCHOR`.

## Non-goals

- Generating filler on-device (ElevenLabs is build-time only — no runtime TTS).
- Replacing the live Gemini voice — filler is strictly a gap-filler.
- Overlapping filler and live voice.
- Looped ambient beds (the car itself is the soundscape).

## Assets (already generated)

Voice: Riley (`yoZ06aMxZJJ28mfd3POQ` → resolves to Riley in this account). Gravelly, raspy, tough — matches Charon without clashing with Romanian mode.

Verbatim script (for persona-compliance audit trail):

| File                     | Text                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `cold-start-1.mp3`       | "Give me a second. Brain's still booting."                      |
| `cold-start-2.mp3`       | "Eyes on. Mouth almost. Hold."                                  |
| `cold-start-3.mp3`       | "Warming up the sarcasm generator."                             |
| `network-lost-1.mp3`     | "Signal's dead. You driving through a Faraday cage or what."    |
| `network-lost-2.mp3`     | "Lost connection. Awkward. I had a good one lined up too."      |
| `network-lost-3.mp3`     | "Great. No bars. Now we're just two idiots in a metal box."     |
| `reconnecting-1.mp3`     | "Trying to reconnect. Don't touch anything."                    |
| `reconnecting-2.mp3`     | "Hold. Reaching for the cloud."                                 |
| `brain-down-1.mp3`       | "Brain's out. Cloud's down. I'm basically a toaster right now." |
| `brain-down-2.mp3`       | "Give it a minute. Or restart me. I don't care which."          |
| `api-missing-1.mp3`      | "No brain today. Config's broken. Yell at whoever set this up." |
| `idle-1.mp3`             | "Still here. Still judging."                                    |
| `idle-2.mp3`             | "Still watching. Still taking notes."                           |
| `idle-3.mp3`             | "Quiet in here. Too quiet. Say something stupid."               |
| `idle-4.mp3`             | "Forty minutes staring at your dashboard. Living the dream."    |
| `sfx-boot-chirp.mp3`     | (1s synth pulse)                                                |
| `sfx-glitch-crackle.mp3` | (2s digital crackle)                                            |
| `sfx-reconnect-ping.mp3` | (2s soft sonar chime)                                           |

## Triggers

| State           | When                                                                                                                                        | Clip                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| COLD_START      | Fire at `AppSessionRuntime.start()` line immediately after `bootstrapRuntime` resolves, before `Promise.all([connect, startAudioPipeline])` | `sfx-boot-chirp` → one random `cold-start-*`       |
| NETWORK_LOST    | `NetInfo` reports `isConnected=false` (with 2s debounce)                                                                                    | `sfx-glitch-crackle` → one random `network-lost-*` |
| RECONNECTING    | `GeminiCallbacks.onReconnectScheduled(attempt)` fires with `attempt >= 2`                                                                   | One `reconnecting-*` (max once per 15s)            |
| BRAIN_DOWN      | `onReconnectExhausted` fires                                                                                                                | `sfx-reconnect-ping` → one `brain-down-*`          |
| API_KEY_MISSING | `d.apiKey` is empty at `start()`                                                                                                            | `api-missing-1` (alongside existing UI error text) |
| IDLE_FILLER     | Live session active, no user/Gemini audio for ≥ 90s                                                                                         | One `idle-*` (max once per 90s)                    |

v1 tradeoff: idle filler does NOT check driving/parked status. `drivingStatusRef` is not a current runtime field; adding a GPS-speed gate is deferred to v2 pending device testing. Acceptable because idle filler is already rate-limited to once per 90s and skipped when Gemini is speaking.

## Playback rules

1. **Never overlap with live voice.** Before `FillerCoordinator.trigger(bucket)` picks a clip, it checks `playbackControllerRef.current?.isSpeaking() === false`. If speaking, filler is dropped (not queued).
2. **Filler interrupts other filler.** Only one filler clip plays at a time; newer trigger calls `FillerPlayer.stop()` then `playClip()`.
3. **Filler is preempted by live voice.** `onGeminiAudioChunk` calls `fillerCoordinator.onLiveAudioArrived()` → `FillerPlayer.stop()`.
4. **Mic gating.** `FillerCoordinator.isFillerPlaying()` exposes the current state. `AppRealtimeHandlers.ts` checks BOTH `playbackControllerRef.current?.isSpeaking()` AND `fillerCoordinatorRef.current?.isFillerPlaying()` in the `onAudioChunk` mic callback; audio frames are dropped while either is true. No modification to `PlaybackController` internals.
5. **No loops.** Each clip plays once per trigger. No static bed.
6. **No repeats within a bucket until all variants played.** `FillerBank` maintains a shuffle-bag per bucket; `pick(bucket)` pops a random unused clip and refills the bag when empty.

## State machine

```
IDLE ─ bootstrap ─▶ COLD_START ─ gemini ready ─▶ LIVE
  │                                                │
  │    ┌─────────── NetInfo offline ──────────────┘
  │    ▼                                           ▲
  │ NETWORK_LOST ──── NetInfo online ──────────────┤
  │    │                                           │
  │    ▼                                           │
  │ RECONNECTING ── connect success ───────────────┤
  │    │                                           │
  │    └── max attempts ──▶ BRAIN_DOWN ── user tap reconnect ─▶ COLD_START
  │
  └─ api key empty on start() ──▶ API_KEY_MISSING (terminal, shows UI error + plays clip)
```

## Files touched

### New

- `engine/audio/FillerPlayer.ts` — single-Sound wrapper via `expo-audio`. Exposes `playClip(requireId: number)`, `stop()`, `isPlaying()`, `dispose()`. Reuses the audio session already configured by `AppSessionRuntime.ts` via `setAudioModeAsync(RECORDING_AUDIO_MODE)` — does NOT re-configure the session.
- `engine/audio/FillerBank.ts` — `Record<Bucket, number[]>` where values are Metro `require()` ids. Shuffle-bag picker. All `require()` calls static at top of file so Metro bundles MP3s.
- `engine/runtime/NetworkMonitor.ts` — thin `@react-native-community/netinfo` wrapper with 2s debounce. Emits `onOnline()` / `onOffline()`.
- `engine/runtime/FillerCoordinator.ts` — subscribes to runtime events, enforces playback rules, calls `FillerPlayer.playClip`. Exposes `isFillerPlaying()` for mic gate.

### Modified

- `engine/GeminiLiveClient.ts`:
  - Add `onReconnectScheduled?: (attempt: number) => void` to `GeminiCallbacks` interface (line 24–33 region).
  - Invoke `this.callbacks?.onReconnectScheduled(this.reconnectAttempts)` in `scheduleReconnect()` right before the existing `RuntimeTelemetry.event("gemini_reconnect_scheduled", ...)` call.
- `engine/runtime/AppSessionRuntimeTypes.ts` — add `fillerCoordinatorRef: RefObject<FillerCoordinator | null>`. Update `AppSessionRuntimeDeps`.
- `engine/runtime/AppRuntimeBootstrap.ts` — construct `FillerPlayer`, `NetworkMonitor`, `FillerCoordinator` after the existing bootstrap I/O fan-out. Assign to refs.
- `engine/runtime/AppSessionRuntime.ts`:
  - When `API_KEY` is empty (line 33–38 region), call `fillerCoordinatorRef.current?.trigger("API_KEY_MISSING")` alongside the existing `setSpeechText`.
  - After `bootstrapRuntime` resolves and before the `Promise.all([connect, startAudioPipeline])` call, call `fillerCoordinatorRef.current?.trigger("COLD_START")`.
  - Start `NetworkMonitor`. Start `idleFillerTimer` (1s interval, checks last-audio timestamp).
- `engine/runtime/AppRealtimeHandlers.ts`:
  - In the `onAudioChunk` mic callback, check `fillerCoordinatorRef.current?.isFillerPlaying() === true` and drop the frame if so (same treatment as `playbackControllerRef.current?.isSpeaking()`).
  - In `registerGeminiRuntimeCallbacks`, pipe the new `onReconnectScheduled` → `fillerCoordinator.onReconnectScheduled`, existing `onReconnectExhausted` → `fillerCoordinator.trigger("BRAIN_DOWN")`, and in the Gemini audio-chunk path call `fillerCoordinator.onLiveAudioArrived()`.
  - In the existing `onConnectionChange(true)` branch, call `fillerCoordinator.onGeminiReady()` so COLD_START state clears.
- `engine/runtime/AppShutdownCoordinator.ts` — dispose `FillerCoordinator` (which disposes `FillerPlayer` + `NetworkMonitor`).
- `package.json` — add `@react-native-community/netinfo`.

**Build note:** Adding `@react-native-community/netinfo` is a native module. The Expo dev-client must be rebuilt (`eas build --profile development` or `expo prebuild && expo run:ios/android`) before testing on device. This is NOT a Metro-only change.

No changes to `PlaybackController.ts` or `StreamingPlayer.ts`. Filler is a parallel audio path sharing the same iOS AudioSession.

## Data flow

```
NetInfo / GeminiLiveClient / AppSessionRuntime events
        │
        ▼
FillerCoordinator (enforces playback rules + rate limits)
        │  picks clip via FillerBank shuffle-bag
        ▼
FillerPlayer (expo-audio Sound, shared audio session)
        │
        ▼
speakers  ——  mic gate reads fillerCoordinator.isFillerPlaying()
              via AppRealtimeHandlers.ts in parallel to
              playbackController.isSpeaking() before forwarding
              mic frames to Gemini.
```

## Edge cases

| Case                                    | Behavior                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| App backgrounded mid-clip               | `FillerCoordinator.dispose()` in shutdown → `FillerPlayer.stop()`.                                                                                 |
| Gemini recovers mid `reconnecting-1`    | `onLiveAudioArrived()` stops filler on first chunk arrival.                                                                                        |
| Two offline→online flips within 2s      | Debounced in `NetworkMonitor`: only the final state fires.                                                                                         |
| Idle trigger while user is mid-sentence | `FillerCoordinator` receives `lastMicChunkAtRef` at construction and defers if `Date.now() - lastMicChunkAtRef.current < 2000`; re-polls after 5s. |
| Brain-down retry succeeds               | `sfx-reconnect-ping` plays once, then normal cold-start sequence.                                                                                  |
| Romanian mode                           | Filler plays English Riley clips regardless (accepted tradeoff for v1).                                                                            |

## Success criteria

1. Cold-start silence eliminated: user hears Riley within 1s of bootstrap.
2. Airplane-mode test: app plays network-lost voice within 3s, plays brain-down after exhaustion, never crashes.
3. Mic never records filler audio back into Gemini (verified: `AppRealtimeHandlers` drops frames while `isFillerPlaying()` is true).
4. No clip repeats within the same bucket before all siblings are exhausted.
5. Filler never overlaps live voice: toggling airplane mode during active Gemini turn — filler waits until live voice finishes.
6. Cold-boot to first audible clip ≤ 1.5s on a mid-tier device.

## Open questions

1. Romanian mode: v2 generates Romanian filler pack. Log in handoff.
2. Parked-vs-driving gate on idle filler deferred to v2 (see §Triggers tradeoff note).
3. `api-missing-1` plays alongside the existing UI error text, not instead.
