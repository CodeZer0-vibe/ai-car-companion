import AsyncStorage from "@react-native-async-storage/async-storage";

export interface GrowthState {
  streakDays: number;
  lastActiveDate: string;
  sessions: number;
  sharesSent: number;
  invitesOpened: number;
}

export interface DailyReward {
  tier: "common" | "rare" | "epic";
  title: string;
  boost: string;
}

const STORAGE_KEY = "@dashboard_pet_growth";

const DEFAULT_STATE: GrowthState = {
  streakDays: 0,
  lastActiveDate: "",
  sessions: 0,
  sharesSent: 0,
  invitesOpened: 0,
};

function dayKeyNow(): string {
  return new Date().toISOString().split("T")[0];
}

function diffDays(fromIsoDay: string, toIsoDay: string): number {
  const from = new Date(fromIsoDay);
  const to = new Date(toIsoDay);
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

export class GrowthEngine {
  private state: GrowthState = { ...DEFAULT_STATE };

  public async load() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.state = {
          ...DEFAULT_STATE,
          ...(JSON.parse(raw) as Partial<GrowthState>),
        };
      }
    } catch (e) {
      console.error("GrowthEngine: load failed", e);
    }
  }

  private async save() {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error("GrowthEngine: save failed", e);
    }
  }

  public async startSession(): Promise<{
    state: GrowthState;
    reward: DailyReward;
  }> {
    await this.load();
    const today = dayKeyNow();
    if (!this.state.lastActiveDate) {
      this.state.streakDays = 1;
    } else {
      const gap = diffDays(this.state.lastActiveDate, today);
      if (gap === 1) this.state.streakDays += 1;
      else if (gap > 1) this.state.streakDays = 1;
    }

    this.state.lastActiveDate = today;
    this.state.sessions += 1;
    await this.save();
    return { state: this.getState(), reward: this.getDailyReward() };
  }

  public async markShareSent() {
    this.state.sharesSent += 1;
    await this.save();
  }

  public getState(): GrowthState {
    return { ...this.state };
  }

  public getDailyReward(): DailyReward {
    const s = this.state.streakDays;
    if (s > 0 && s % 14 === 0) {
      return {
        tier: "epic",
        title: "Dashboard Legend Drop",
        boost: "Pet unlocks rare roast pack + neon aura today.",
      };
    }
    if (s > 0 && s % 5 === 0) {
      return {
        tier: "rare",
        title: "Chaos Upgrade",
        boost: "Pet gets a special voice persona for this drive.",
      };
    }
    return {
      tier: "common",
      title: "Daily Spark",
      boost: "Pet gives one fresh custom reaction this session.",
    };
  }

  public buildGeminiNudgeContext(): string {
    const days = this.state.streakDays;
    if (days <= 1) return "";
    return `CONTEXT (do NOT repeat this verbatim): This driver has shown up ${days} days in a row. You can reference this naturally — mock their dedication, question their social life, or begrudgingly acknowledge it. Do NOT use words like "streak", "reward", "unlock", "level up", or "daily spark". You are not a game.`;
  }

  public buildSharePayload(inviteCode: string): {
    title: string;
    message: string;
  } {
    const reward = this.getDailyReward();
    const message =
      `My AI dashboard pet is on a ${this.state.streakDays}-day streak and just dropped: ${reward.title}. ` +
      `Adopt your own chaos co-driver: https://dashboardpet.app/invite/${inviteCode}`;
    return {
      title: "Adopt my Dashboard Pet",
      message,
    };
  }
}
