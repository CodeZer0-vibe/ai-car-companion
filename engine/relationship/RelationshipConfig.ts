export type RelationshipTier =
  | 'stranger'
  | 'acquaintance'
  | 'regular'
  | 'veteran'
  | 'oldFriends';

export interface MoodAxes {
  energy: number;
  cheerfulness: number;
  patience: number;
  affection: number;
}

export interface Milestone {
  session: number;
  id: string;
  description: string;
}

export interface RelationshipState {
  sessionCount: number;
  grudgeScore: number;
  totalShakes: number;
  totalHardBrakes: number;
  calmDrivingStreak: number;
  milestonesSeen: string[];
  mood: MoodAxes;
  lastSessionDate: string;
  absenceDays: number;
}

export const MILESTONES: Milestone[] = [
  { session: 1, id: 'first_drive', description: 'First drive together' },
  { session: 5, id: 'regular_now', description: 'Starting to recognize the driver' },
  { session: 10, id: 'knows_you', description: 'Knows your driving habits' },
  { session: 20, id: 'inside_jokes', description: 'Has inside jokes about your driving' },
  { session: 50, id: 'old_soul', description: 'Has seen things together' },
  { session: 100, id: 'ride_or_die', description: 'Ride or die — unbreakable bond' },
];

export const RELATIONSHIP_STORAGE_KEY = '@dashboard_pet_relationship';

export const DEFAULT_RELATIONSHIP_STATE: RelationshipState = {
  sessionCount: 0,
  grudgeScore: 0,
  totalShakes: 0,
  totalHardBrakes: 0,
  calmDrivingStreak: 0,
  milestonesSeen: [],
  mood: { energy: 0, cheerfulness: 0, patience: 0.5, affection: 0 },
  lastSessionDate: '',
  absenceDays: 0,
};
