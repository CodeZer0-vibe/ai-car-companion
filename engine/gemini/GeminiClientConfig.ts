import { Type, Modality } from "@google/genai";

export const GEMINI_CLIENT_CONFIG = {
  maxReconnectAttempts: 5,
  reconnectMinDelayMs: 300,
  reconnectBaseDelayMs: 500,
  reconnectMaxDelayMs: 30000,
  connectTimeoutMs: 10000,
  streamStallTimeoutMs: 20000,
  visionFrameMinIntervalMs: 1200,
  // Gemini Live caps mixed audio+video sessions at ~120s of continuous streaming.
  // Warn at 90s, force-reconnect at 110s to dodge mid-burst cutoffs.
  videoBudgetWarnMs: 90000,
  videoBudgetMaxMs: 110000,
  sessionMaxMs: 20 * 60 * 1000,
  internalErrorCode: 1011,
  unsupportedOperationCode: 1008,
  internalErrorWindowMs: 60000,
  internalErrorBurstThreshold: 3,
  internalErrorBurstMultiplier: 2,
  unsupportedOperationBurstThreshold: 2,
  degradedModeCooldownMs: 120000,
  silentContextMinIntervalMs: 1200,
  model: "gemini-3.1-flash-live-preview",
  responseModalities: [Modality.AUDIO],
  voiceName: "Charon",
  useRealtimeTextInput: true,
  enableSessionResumption: true,
  enableContextWindowCompression: true,
  tools: [
    {
      functionDeclarations: [
        {
          name: "changeEmotion",
          description:
            "Changes the visual emotion/expression of the Dashboard Pet Face. Call this whenever your mood changes based on what you are saying.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              emotion: {
                type: Type.STRING,
                description: "The target emotion state.",
                enum: [
                  "idle",
                  "sad",
                  "angry",
                  "surprised",
                  "sleeping",
                  "judging",
                  "glitch",
                  "suspicious",
                  "focused",
                  "excited",
                  "disgusted",
                  "contempt",
                  "smug",
                  "amused",
                  "tired",
                  "disappointed",
                ],
              },
            },
            required: ["emotion"],
          },
        },
        {
          name: "setCarModel",
          description:
            "Records the make/model of the car you are installed in, so future drives load the correct roast material. Call ONCE when the driver tells you what they drive. If they refuse to say, call with refused=true instead of guessing.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              model: {
                type: Type.STRING,
                description:
                  "The car as the driver described it (e.g. 'BMW', '2018 Civic hatchback', 'Tesla Model 3'). Pass the raw phrase — matching is fuzzy.",
              },
              refused: {
                type: Type.BOOLEAN,
                description:
                  "Set true if the driver explicitly declined to share. Leave omitted/false when model is provided.",
              },
            },
            required: [],
          },
        },
        {
          name: "lookThroughCamera",
          description:
            "Look at what the rear camera sees RIGHT NOW. You are BLIND until you call this — you have no passive video feed. Call it the instant the driver asks what you see, to look, 'ce vezi', 'vezi?', points at something, or whenever you want to react to the scene — in ANY language. After calling, describe what you actually see; if the frame is unclear or dark, say so.",
          parameters: { type: Type.OBJECT, properties: {}, required: [] },
        },
        {
          name: "getDriveContext",
          description:
            "Get the real current time, city/location, speed, and weather. You do NOT know these unless you call this — they change constantly. Call it whenever you reference the time, where you are, how fast you're going, or the weather. Never guess them.",
          parameters: { type: Type.OBJECT, properties: {}, required: [] },
        },
      ],
    },
  ],
} as const;
