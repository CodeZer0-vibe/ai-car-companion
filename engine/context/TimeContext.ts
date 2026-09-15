/**
 * Time-based context intelligence.
 * Returns personality-relevant time info for Gemini context injection.
 */

export interface TimeInfo {
  hour: number;
  clock: string; // Device-local HH:MM, 24h — the ACTUAL time to give the driver
  dayOfWeek: string;
  isWeekend: boolean;
  timeOfDay:
    | "lateNight"
    | "earlyMorning"
    | "morning"
    | "afternoon"
    | "evening"
    | "night";
  holiday: string | null;
  contextLine: string; // One-line summary for Gemini
}

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function getTimeOfDay(hour: number): TimeInfo["timeOfDay"] {
  if (hour < 4) return "lateNight";
  if (hour < 7) return "earlyMorning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function detectHoliday(month: number, day: number): string | null {
  // Month is 0-indexed (Jan = 0)
  if (month === 0 && day === 1) return "New Year's Day";
  if (month === 1 && day === 14) return "Valentine's Day";
  if (month === 2 && day === 8) return "International Women's Day";
  if (month === 3 && day === 1) return "April Fools' Day";
  if (month === 9 && day === 31) return "Halloween";
  if (month === 11 && day === 24) return "Christmas Eve";
  if (month === 11 && day === 25) return "Christmas Day";
  if (month === 11 && day === 31) return "New Year's Eve";
  // Romanian holidays
  if (month === 11 && day === 1) return "Romania National Day";
  if (month === 0 && day === 24) return "Union Day (Romania)";
  return null;
}

export function getTimeContext(): TimeInfo {
  const now = new Date();
  const hour = now.getHours();
  const clock = `${hour.toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  const dayIndex = now.getDay();
  const dayOfWeek = DAYS[dayIndex];
  const isWeekend = dayIndex === 0 || dayIndex === 6;
  const timeOfDay = getTimeOfDay(hour);
  const holiday = detectHoliday(now.getMonth(), now.getDate());

  let contextLine = `${dayOfWeek} ${timeOfDay}`;
  if (holiday) contextLine += ` (${holiday})`;

  if (timeOfDay === "lateNight") {
    contextLine += " — why is the driver up at this hour?";
  } else if (timeOfDay === "earlyMorning") {
    contextLine += " — painfully early, the driver looks half-asleep";
  } else if (isWeekend && hour < 10) {
    contextLine += " — weekend morning, shouldn't they be sleeping in?";
  } else if (dayOfWeek === "Friday" && hour >= 17) {
    contextLine += " — Friday evening, freedom at last";
  } else if (dayOfWeek === "Monday" && hour < 10) {
    contextLine += " — Monday morning, nobody wants to be here";
  }

  return { hour, clock, dayOfWeek, isWeekend, timeOfDay, holiday, contextLine };
}
