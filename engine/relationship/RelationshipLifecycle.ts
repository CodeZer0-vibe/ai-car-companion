import { MILESTONES } from './RelationshipConfig';
import type { Milestone, RelationshipState, RelationshipTier } from './RelationshipConfig';

export function getTierForSessionCount(sessionCount: number): RelationshipTier {
  if (sessionCount <= 5) return 'stranger';
  if (sessionCount <= 20) return 'acquaintance';
  if (sessionCount <= 50) return 'regular';
  if (sessionCount <= 100) return 'veteran';
  return 'oldFriends';
}

export function getVulnerabilityChanceForTier(tier: RelationshipTier): number {
  switch (tier) {
    case 'stranger': return 0.02;
    case 'acquaintance': return 0.04;
    case 'regular': return 0.05;
    case 'veteran': return 0.06;
    case 'oldFriends': return 0.08;
  }
}

export function applySessionStart(state: RelationshipState): Milestone | null {
  state.sessionCount += 1;

  const today = new Date().toISOString().split('T')[0];
  if (state.lastSessionDate) {
    const last = new Date(state.lastSessionDate);
    const now = new Date(today);
    state.absenceDays = Math.floor((now.getTime() - last.getTime()) / 86400000);
  }
  state.lastSessionDate = today;

  if (state.absenceDays >= 2) {
    state.mood.cheerfulness = Math.max(-1, state.mood.cheerfulness - 0.3);
    state.mood.affection = Math.max(-1, state.mood.affection - 0.1);
  }

  const hour = new Date().getHours();
  if (hour >= 6 && hour < 10) {
    state.mood.energy = Math.min(1, state.mood.energy + 0.2);
  } else if (hour >= 23 || hour < 5) {
    state.mood.energy = Math.max(-1, state.mood.energy - 0.3);
  }

  return checkMilestone(state);
}

export function applySessionEnd(state: RelationshipState, sessionGrudgeEvents: number): void {
  if (sessionGrudgeEvents === 0) {
    state.calmDrivingStreak += 1;
    state.grudgeScore = Math.max(0, state.grudgeScore - 5);
    state.mood.patience = Math.min(1, state.mood.patience + 0.1);
    state.mood.affection = Math.min(1, state.mood.affection + 0.05);
  } else {
    state.calmDrivingStreak = 0;
  }

  state.mood.energy *= 0.9;
  state.mood.cheerfulness *= 0.85;
  state.mood.patience *= 0.92;
  state.mood.affection *= 0.95;
}

export function applyGrudgeEvent(state: RelationshipState, type: 'hardBrake' | 'shake' | 'aggressive'): void {
  const penalty = type === 'hardBrake' ? 8 : type === 'shake' ? 5 : 3;
  state.grudgeScore = Math.min(100, state.grudgeScore + penalty);

  if (type === 'hardBrake') state.totalHardBrakes += 1;
  if (type === 'shake') state.totalShakes += 1;

  state.mood.patience = Math.max(-1, state.mood.patience - 0.15);
  state.mood.cheerfulness = Math.max(-1, state.mood.cheerfulness - 0.1);
}

export function applyPositiveEvent(state: RelationshipState, type: 'compliment' | 'calmDriving' | 'laugh'): void {
  const boost = type === 'laugh' ? 0.15 : type === 'compliment' ? 0.1 : 0.05;
  state.mood.cheerfulness = Math.min(1, state.mood.cheerfulness + boost);
  state.mood.affection = Math.min(1, state.mood.affection + boost * 0.5);
  state.grudgeScore = Math.max(0, state.grudgeScore - 2);
}

function checkMilestone(state: RelationshipState): Milestone | null {
  for (const m of MILESTONES) {
    if (state.sessionCount === m.session && !state.milestonesSeen.includes(m.id)) {
      state.milestonesSeen.push(m.id);
      return m;
    }
  }
  return null;
}
