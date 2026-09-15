import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { TriggerType } from '../PersonalityEngine';
import type { RelationshipEngine } from '../RelationshipEngine';
import type { MemoryEngine } from '../MemoryEngine';
import type { EmotionState } from '../EmotionEngine';
import { APP_RUNTIME } from './AppRuntimeConfig';

interface ReactionRuntimeDeps {
  action: TriggerType;
  setEmotionState: Dispatch<SetStateAction<EmotionState>>;
  emotionTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  timeSinceActionRef: MutableRefObject<number>;
  totalInteractionsRef: MutableRefObject<number>;
  lastActionRef: MutableRefObject<TriggerType | null>;
  lastActionSentTimeRef: MutableRefObject<number>;
  logAction: (action: TriggerType) => void;
  sendContextUpdate: (prompt: string) => void;
  getActionPrompt: (action: TriggerType) => string;
  relationshipEngineRef: MutableRefObject<RelationshipEngine | null>;
  memoryEngineRef: MutableRefObject<MemoryEngine | null>;
}

export function applyReactionRuntime(deps: ReactionRuntimeDeps) {
  const {
    action,
    setEmotionState,
    emotionTimeoutRef,
    timeSinceActionRef,
    totalInteractionsRef,
    lastActionRef,
    lastActionSentTimeRef,
    logAction,
    sendContextUpdate,
    getActionPrompt,
    relationshipEngineRef,
    memoryEngineRef,
  } = deps;

  const previousAction = lastActionRef.current;
  lastActionRef.current = action;
  timeSinceActionRef.current = 0;
  totalInteractionsRef.current += 1;
  setEmotionState('focused');
  logAction(action);

  if (emotionTimeoutRef.current) clearTimeout(emotionTimeoutRef.current);
  emotionTimeoutRef.current = setTimeout(() => {
    setEmotionState((prev) => (prev === 'focused' ? 'idle' : prev));
  }, APP_RUNTIME.focusResetMs);

  const now = Date.now();
  const isHighPriority = action === 'hardBrake' || action === 'shake';
  const sameHighPriorityActionBurst =
    isHighPriority &&
    previousAction === action &&
    now - lastActionSentTimeRef.current < APP_RUNTIME.actionHighPriorityCooldownMs;

  if (sameHighPriorityActionBurst) {
    console.log(`Action coalesced: ${action} (${Math.round((now - lastActionSentTimeRef.current) / 1000)}s since last)`);
  } else if (isHighPriority || now - lastActionSentTimeRef.current >= APP_RUNTIME.actionRateLimitMs) {
    lastActionSentTimeRef.current = now;
    sendContextUpdate(getActionPrompt(action));
  } else {
    console.log(`Action rate-limited: ${action} (${Math.round((now - lastActionSentTimeRef.current) / 1000)}s since last)`);
  }

  if (action === 'hardBrake') {
    relationshipEngineRef.current?.recordGrudgeEvent('hardBrake');
    memoryEngineRef.current?.addMemory('The user slammed on the brakes.');
  } else if (action === 'shake') {
    relationshipEngineRef.current?.recordGrudgeEvent('shake');
    memoryEngineRef.current?.addMemory('The user shook the phone violently.');
  }
}
