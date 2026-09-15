import type { MemoryEngine } from "../MemoryEngine";
import type { LocationContext } from "./AppLocationRuntime";
import {
  getCachedWeather,
  weatherToContext,
  fetchWeather,
} from "./AppWeatherRuntime";
import { getTimeContext } from "../context/TimeContext";

const MEMORY_QUERY = "recent things the driver did or said";

export async function composeLightweightContext(
  memory: MemoryEngine,
  isDriving: boolean,
  locationCtx?: LocationContext | null
): Promise<string> {
  let context =
    "SILENT CONTEXT UPDATE (internal, do not repeat this to the user):\n";

  // Driving state
  context += isDriving
    ? "Driver is currently driving. "
    : "Car is parked/idle. ";

  // Location + city
  if (locationCtx) {
    if (locationCtx.city) {
      context += `Location: ${locationCtx.city}`;
      if (locationCtx.country) context += `, ${locationCtx.country}`;
      context += ". ";
    }
    context += `Speed: ${Math.round(locationCtx.speedKmh)} km/h. `;

    // Trip stats
    if (locationCtx.tripDurationMin > 5) {
      context += `Trip: ${Math.round(
        locationCtx.tripDurationMin
      )} min, ${locationCtx.tripDistanceKm.toFixed(1)} km, avg ${Math.round(
        locationCtx.averageSpeedKmh
      )} km/h. `;
    }
    if (locationCtx.tripDurationMin > 60) {
      context += "ROAD TRIP MODE: they've been driving over an hour. ";
    }
    if (locationCtx.stoppedDurationMin > 20) {
      context += `Parked for ${Math.round(
        locationCtx.stoppedDurationMin
      )} min — are they coming back? `;
    }

    // Trigger weather fetch if we have coords
    if (locationCtx.latitude && locationCtx.longitude) {
      await fetchWeather(locationCtx.latitude, locationCtx.longitude);
    }
  }

  // Weather
  const weatherLine = weatherToContext(getCachedWeather());
  if (weatherLine) {
    context += weatherLine + ". ";
  }

  // Time — send the ACTUAL clock (device-local) so the model never invents it.
  // Gemini has no real clock; without the digits it hallucinates the hour.
  const timeCtx = getTimeContext();
  context += `Current local time: ${timeCtx.clock} (${timeCtx.contextLine}). `;

  // Memory
  const memories = await memory.retrieveRelevantMemories(MEMORY_QUERY, 1);
  if (memories.length > 0) {
    context += `You recall: "${memories[0].text}". `;
  }

  context +=
    "\nUse this context naturally if relevant. Do not repeat it verbatim. Do not force a response.";
  return context;
}
