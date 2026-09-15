import AsyncStorage from "@react-native-async-storage/async-storage";
import { RuntimeTelemetry } from "../RuntimeTelemetry";

// Persists the "greeting already sent today" flag so mid-drive
// reconnects (and same-day relaunches) don't replay the wake prompt.
// Key rotates per local date — a new calendar day = fresh greeting.

const STORAGE_KEY = "@dashboardpet/greeting/lastSentDate/v1";

function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function wasGreetingSentToday(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === todayKey();
  } catch (e) {
    RuntimeTelemetry.error("greeting_state_load_failed", e);
    return false;
  }
}

export async function markGreetingSentToday(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, todayKey());
  } catch (e) {
    RuntimeTelemetry.error("greeting_state_save_failed", e);
  }
}
