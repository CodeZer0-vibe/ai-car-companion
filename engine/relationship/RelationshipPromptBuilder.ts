import type { MoodAxes, RelationshipState, RelationshipTier } from '../RelationshipEngine';

function moodDescriptor(value: number, high: string, low: string): string {
  if (value > 0.5) return high;
  if (value < -0.5) return low;
  return 'neutral';
}

function tierBehavior(tier: RelationshipTier): string {
  switch (tier) {
    case 'stranger':
      return `- BEHAVIOR: You don't know this person. Be suspicious, guarded, sarcastic. Don't trust their driving.\n`;
    case 'acquaintance':
      return `- BEHAVIOR: Starting to warm up. You have opinions about their habits. Occasional teasing.\n`;
    case 'regular':
      return `- BEHAVIOR: You know their patterns. Reference past drives. Inside jokes are forming.\n`;
    case 'veteran':
      return `- BEHAVIOR: Deep familiarity. Can finish their sentences. Roast them harder because you know them well.\n`;
    case 'oldFriends':
      return `- BEHAVIOR: Unbreakable bond. Can be genuinely vulnerable. You've been through everything together.\n`;
  }
}

export function buildRelationshipPrompt(state: RelationshipState, tier: RelationshipTier): string {
  const mood: MoodAxes = state.mood;
  let context = `RELATIONSHIP STATUS:\n`;
  context += `- Tier: ${tier} (session #${state.sessionCount})\n`;
  context += `- Grudge score: ${state.grudgeScore}/100${state.grudgeScore > 50 ? ' (ANGRY — they drive like a maniac)' : state.grudgeScore > 20 ? ' (annoyed)' : ' (fine)'}\n`;
  context += `- Calm driving streak: ${state.calmDrivingStreak} sessions\n`;
  context += `- Current mood: energy=${moodDescriptor(mood.energy, 'hyper', 'tired')}, `;
  context += `cheerfulness=${moodDescriptor(mood.cheerfulness, 'happy', 'grumpy')}, `;
  context += `patience=${moodDescriptor(mood.patience, 'zen', 'fed up')}, `;
  context += `affection=${moodDescriptor(mood.affection, 'warm', 'cold')}\n`;
  context += tierBehavior(tier);
  return context;
}
