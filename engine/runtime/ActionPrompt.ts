import type { TriggerType } from '../PersonalityEngine';

export function getActionPrompt(action: TriggerType): string {
  switch (action) {
    case 'shake': return 'YOU WERE JUST SHAKEN VIOLENTLY. React right now — you are furious and dizzy.';
    case 'tap': return 'The driver just poked your screen with their greasy finger. React.';
    case 'doubleTap': return 'The driver double-tapped you impatiently. Say something about their impatience.';
    case 'longPress': return 'The driver is holding your face. You feel violated. Demand personal space.';
    case 'hardBrake': return 'HARD BRAKE — you nearly flew off the dashboard. React immediately.';
    case 'speeding': return 'You are speeding. Express terror and excitement about the speed.';
    default: return `Something just happened: ${action}. React to it.`;
  }
}
