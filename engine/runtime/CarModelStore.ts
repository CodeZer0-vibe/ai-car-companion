import AsyncStorage from "@react-native-async-storage/async-storage";
import { RuntimeTelemetry } from "../RuntimeTelemetry";

// Persists the driver-declared car model across sessions so the 18
// car-specific roast profiles in PersonalityEngine become reachable.
// The AI asks casually on first run via the setCarModel tool call.

const STORAGE_KEY = "@dashboardpet/carModel/v1";

export interface CarModelRecord {
  model: string;
  setAt: number;
  refused?: boolean;
}

export const UNKNOWN_CAR = "Unknown Car";

export async function loadCarModel(): Promise<CarModelRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CarModelRecord;
    if (
      typeof parsed?.model !== "string" ||
      typeof parsed?.setAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch (e) {
    RuntimeTelemetry.error("car_model_load_failed", e);
    return null;
  }
}

export async function saveCarModel(
  model: string
): Promise<CarModelRecord | null> {
  const trimmed = model.trim();
  if (!trimmed) return null;
  const record: CarModelRecord = { model: trimmed, setAt: Date.now() };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    RuntimeTelemetry.event("car_model_set", { model: trimmed });
    return record;
  } catch (e) {
    RuntimeTelemetry.error("car_model_save_failed", e, { model: trimmed });
    return null;
  }
}

export async function markCarModelRefused(): Promise<CarModelRecord | null> {
  const record: CarModelRecord = {
    model: UNKNOWN_CAR,
    setAt: Date.now(),
    refused: true,
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    RuntimeTelemetry.event("car_model_refused");
    return record;
  } catch (e) {
    RuntimeTelemetry.error("car_model_save_failed", e, { refused: true });
    return null;
  }
}
