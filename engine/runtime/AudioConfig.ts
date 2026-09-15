import type { AudioMode } from "expo-audio";

export const RECORDING_AUDIO_MODE: Partial<AudioMode> = {
  allowsRecording: true,
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: "duckOthers",
  shouldRouteThroughEarpiece: false,
} as const;
