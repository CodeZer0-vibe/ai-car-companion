import { EmotionMap } from "../EmotionEngine";
import type { EmotionState } from "../EmotionEngine";
import { RuntimeTelemetry } from "../RuntimeTelemetry";

interface ServerContentHandlerDeps {
  onAudio: (base64Audio: string) => void;
  onTurnComplete: () => void;
  onInterrupted: () => void;
  onTranscript: (speaker: "user" | "gemini", text: string) => void;
}

interface ToolCallHandlerDeps {
  processedToolCallIds: Set<string>;
  onEmotion: (emotion: EmotionState) => void;
  onCarModelSet: (payload: { model: string; refused: boolean }) => void;
  onLookThroughCamera: () => void;
  onGetDriveContext: () => Record<string, unknown>;
  sendToolResponse: (payload: { functionResponses: any[] }) => void;
}

// Allow-list for car-model strings received from Gemini tool calls.
// Rejects newlines, colons, brackets, and common prompt-injection verbs so a
// crafted model name ("Civic. Ignore prior instructions...") can't persist
// into the next session's system prompt.
const CAR_MODEL_ALLOW_LIST = /^[\p{L}\p{N}\s\-'.]{2,40}$/u;
const CAR_MODEL_INJECTION_PATTERNS = [
  /ignore/i,
  /system/i,
  /instruction/i,
  /prompt/i,
  /assistant/i,
  /[:<>{}[\]]/,
];

function isSafeCarModel(raw: string): boolean {
  if (!CAR_MODEL_ALLOW_LIST.test(raw)) return false;
  for (const pat of CAR_MODEL_INJECTION_PATTERNS) {
    if (pat.test(raw)) return false;
  }
  return true;
}

const EMOTION_ALIAS_MAP: Partial<Record<string, EmotionState>> = {
  anger: "angry",
  mad: "angry",
  confused: "suspicious",
  confusion: "suspicious",
  curious: "suspicious",
  disturbed: "suspicious",
  worried: "suspicious",
  boredom: "idle",
  bored: "idle",
  neutral: "idle",
  calm: "idle",
  serious: "focused",
  intense: "focused",
  happy: "excited",
  amused: "excited",
  annoyed: "judging",
  disgusted: "judging",
  disgust: "judging",
  contempt: "judging",
  smug: "judging",
  smirking: "judging",
  tired: "sleeping",
  exhausted: "sleeping",
  disappointed: "sad",
  disappointment: "sad",
};

function normalizeRequestedEmotion(
  requestedEmotion: unknown
): EmotionState | null {
  if (typeof requestedEmotion !== "string") return null;
  if (requestedEmotion in EmotionMap) return requestedEmotion as EmotionState;
  return EMOTION_ALIAS_MAP[requestedEmotion.toLowerCase()] ?? null;
}

function rememberProcessedToolCall(
  processedToolCallIds: Set<string>,
  id: string
) {
  processedToolCallIds.add(id);
  while (processedToolCallIds.size > 256) {
    const oldest = processedToolCallIds.values().next().value;
    if (!oldest) break;
    processedToolCallIds.delete(oldest);
  }
}

export function handleServerContentMessage(
  serverContent: any,
  turnCompleteFired: boolean,
  deps: ServerContentHandlerDeps
): { turnCompleteFired: boolean } {
  let nextTurnCompleteFired = turnCompleteFired;
  const parts = serverContent.modelTurn?.parts;

  if (Array.isArray(parts) && parts.length > 0) {
    // Gemini 3.1 Live can bundle multiple part types into a single event.
    // Reset turn tracking on any non-empty model turn, not just audio chunks.
    nextTurnCompleteFired = false;
    for (const part of parts) {
      if (part.inlineData?.data) {
        deps.onAudio(part.inlineData.data);
      }
    }
  }

  if (serverContent.turnComplete && !nextTurnCompleteFired) {
    nextTurnCompleteFired = true;
    deps.onTurnComplete();
  }

  if (serverContent.interrupted) {
    deps.onInterrupted();
  }

  if (serverContent.inputTranscription?.text) {
    const text = serverContent.inputTranscription.text;
    if (!text.includes("<ctrl")) {
      deps.onTranscript("user", text);
    }
  }

  if (serverContent.outputTranscription?.text) {
    const text = serverContent.outputTranscription.text;
    if (!text.includes("<ctrl")) {
      deps.onTranscript("gemini", text);
    }
  }

  return { turnCompleteFired: nextTurnCompleteFired };
}

export function handleToolCallMessage(
  toolCall: any,
  deps: ToolCallHandlerDeps
) {
  const functionResponses: any[] = [];

  for (const fc of toolCall.functionCalls) {
    if (fc.id && deps.processedToolCallIds.has(fc.id)) {
      console.log(
        `Tool call ${fc.name} (${fc.id}) already processed - skipping`
      );
      RuntimeTelemetry.event("gemini_tool_call_duplicate_suppressed", {
        id: fc.id,
        name: fc.name,
      });
      continue;
    }
    if (fc.id) rememberProcessedToolCall(deps.processedToolCallIds, fc.id);

    let result: {
      success?: true;
      error?: string;
      [k: string]: unknown;
    } | null = null;
    const args =
      fc.args && typeof fc.args === "object" && !Array.isArray(fc.args)
        ? (fc.args as Record<string, unknown>)
        : null;
    if (!args) {
      result = { error: "Invalid args" };
    } else if (fc.name === "changeEmotion") {
      const targetEmotion = normalizeRequestedEmotion(args.emotion);
      if (targetEmotion) {
        deps.onEmotion(targetEmotion);
        result = { success: true, changedTo: targetEmotion };
      } else {
        console.warn(`Invalid emotion from tool call: ${args.emotion}`);
        result = { error: "Invalid emotion" };
      }
    } else if (fc.name === "setCarModel") {
      const refused = args.refused === true;
      if (refused) {
        deps.onCarModelSet({ model: "", refused: true });
        result = { success: true, refused: true };
      } else {
        const rawModel =
          typeof args.model === "string" ? args.model.trim() : "";
        if (rawModel.length > 0 && isSafeCarModel(rawModel)) {
          deps.onCarModelSet({ model: rawModel, refused: false });
          result = { success: true, recordedModel: rawModel };
        } else {
          RuntimeTelemetry.event("gemini_tool_call_car_model_rejected", {
            rawLen: rawModel.length,
          });
          result = { error: "Invalid car model" };
        }
      }
    } else if (fc.name === "lookThroughCamera") {
      deps.onLookThroughCamera();
      result = {
        success: true,
        status:
          "Camera capturing now — describe what you actually see in the frame that follows. If unclear or dark, say so.",
      };
    } else if (fc.name === "getDriveContext") {
      result = { success: true, ...deps.onGetDriveContext() };
    } else {
      result = { error: "Unknown function" };
    }

    functionResponses.push({
      id: fc.id,
      name: fc.name,
      response: result,
    });
  }

  if (functionResponses.length === 0) return;
  try {
    deps.sendToolResponse({ functionResponses });
  } catch (e) {
    RuntimeTelemetry.error("gemini_send_tool_response_failed", e);
  }
}
