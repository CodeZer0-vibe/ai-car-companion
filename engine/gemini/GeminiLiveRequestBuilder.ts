import { GEMINI_CLIENT_CONFIG } from "./GeminiClientConfig";

interface BuildGeminiConnectRequestDeps {
  systemPrompt: string;
  degradedMode?: boolean;
  sessionResumptionHandle?: string | null;
  callbacks: {
    onopen: () => void;
    onmessage: (message: any) => void;
    onerror: (e: any) => void;
    onclose: (e: any) => void;
  };
}

export function buildGeminiConnectRequest(deps: BuildGeminiConnectRequestDeps) {
  const {
    systemPrompt,
    callbacks,
    degradedMode = false,
    sessionResumptionHandle = null,
  } = deps;

  const config: any = {
    responseModalities: [...GEMINI_CLIENT_CONFIG.responseModalities],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: GEMINI_CLIENT_CONFIG.voiceName,
        },
      },
    },
    systemInstruction: systemPrompt,
  };

  // Transcription is always enabled - lightweight empty config, no reason to gate it.
  config.inputAudioTranscription = {};
  config.outputAudioTranscription = {};

  // Server-side VAD is now the SOLE endpointer for the noisy car cabin.
  // Client-side MicGate no longer drops audio (it ate speech and corrupted
  // transcription) — Gemini sees the full continuous PCM stream and decides
  // turn boundaries itself. If road noise causes spurious activations or
  // missed endpointing on device, tune these values (do NOT re-add a client
  // amplitude gate).
  config.realtimeInputConfig = {
    automaticActivityDetection: {
      prefixPaddingMs: 300,
      silenceDurationMs: 500,
    },
  };

  if (GEMINI_CLIENT_CONFIG.enableSessionResumption) {
    config.sessionResumption = {
      handle: sessionResumptionHandle ?? undefined,
    };
  }

  if (GEMINI_CLIENT_CONFIG.enableContextWindowCompression) {
    config.contextWindowCompression = {
      slidingWindow: {},
    };
  }

  if (!degradedMode) {
    config.tools = GEMINI_CLIENT_CONFIG.tools.map((tool) => ({
      functionDeclarations: [...tool.functionDeclarations],
    }));
  }

  return {
    model: GEMINI_CLIENT_CONFIG.model,
    config,
    callbacks,
  };
}
