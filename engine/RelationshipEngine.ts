import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildRelationshipPrompt } from './relationship/RelationshipPromptBuilder';
import {
  DEFAULT_RELATIONSHIP_STATE,
  RELATIONSHIP_STORAGE_KEY,
} from './relationship/RelationshipConfig';
import type {
  RelationshipTier,
  MoodAxes,
  Milestone,
  RelationshipState,
} from './relationship/RelationshipConfig';
import {
  applyGrudgeEvent,
  applyPositiveEvent,
  applySessionEnd,
  applySessionStart,
  getTierForSessionCount,
  getVulnerabilityChanceForTier,
} from './relationship/RelationshipLifecycle';
export type { RelationshipTier, MoodAxes, Milestone, RelationshipState } from './relationship/RelationshipConfig';

export class RelationshipEngine {
  private state: RelationshipState = { ...DEFAULT_RELATIONSHIP_STATE };
  private sessionGrudgeEvents = 0; // Grudge events this session
  private loaded = false;

  // --- Persistence ---

  public async load(): Promise<void> {
    try {
      const json = await AsyncStorage.getItem(RELATIONSHIP_STORAGE_KEY);
      if (json) {
        const saved = JSON.parse(json) as Partial<RelationshipState>;
        this.state = { ...DEFAULT_RELATIONSHIP_STATE, ...saved };
      }
    } catch (e) {
      console.error('RelationshipEngine: load failed', e);
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    try {
      await AsyncStorage.setItem(RELATIONSHIP_STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('RelationshipEngine: save failed', e);
    }
  }

  // --- Session Lifecycle ---

  public async startSession(): Promise<{
    tier: RelationshipTier;
    sessionCount: number;
    milestone: Milestone | null;
    absenceDays: number;
    mood: MoodAxes;
  }> {
    if (!this.loaded) await this.load();

    this.sessionGrudgeEvents = 0;
    const milestone = applySessionStart(this.state);

    await this.save();

    return {
      tier: this.getTier(),
      sessionCount: this.state.sessionCount,
      milestone,
      absenceDays: this.state.absenceDays,
      mood: { ...this.state.mood },
    };
  }

  public async endSession(): Promise<void> {
    applySessionEnd(this.state, this.sessionGrudgeEvents);
    await this.save();
  }

  // --- Grudge System ---

  public recordGrudgeEvent(type: 'hardBrake' | 'shake' | 'aggressive'): void {
    this.sessionGrudgeEvents += 1;
    applyGrudgeEvent(this.state, type);
    this.save(); // Fire and forget
  }

  public recordPositiveEvent(type: 'compliment' | 'calmDriving' | 'laugh'): void {
    applyPositiveEvent(this.state, type);
    this.save();
  }

  // --- Tier Calculation ---

  public getTier(): RelationshipTier {
    return getTierForSessionCount(this.state.sessionCount);
  }

  // --- Vulnerability ---
  // Chance of a soft/vulnerable moment based on tier
  public getVulnerabilityChance(): number {
    return getVulnerabilityChanceForTier(this.getTier());
  }

  public shouldBeVulnerable(): boolean {
    return Math.random() < this.getVulnerabilityChance();
  }

  // --- Context for PersonalityEngine ---

  public getContextForPrompt(): string {
    const tier = this.getTier();
    return buildRelationshipPrompt(this.state, tier);
  }

  // --- Getters ---

  public getState(): RelationshipState {
    return { ...this.state };
  }

  public getSessionCount(): number {
    return this.state.sessionCount;
  }

  public getMood(): MoodAxes {
    return { ...this.state.mood };
  }

  public getAbsenceDays(): number {
    return this.state.absenceDays;
  }

  // --- Debug/Reset ---

  public async reset(): Promise<void> {
    this.state = { ...DEFAULT_RELATIONSHIP_STATE };
    await AsyncStorage.removeItem(RELATIONSHIP_STORAGE_KEY);
  }
}
