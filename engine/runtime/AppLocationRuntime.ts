import * as Location from 'expo-location';
import { RuntimeTelemetry } from '../RuntimeTelemetry';

export interface LocationContext {
  speedKmh: number;
  city: string | null;
  district: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  tripDurationMin: number;
  tripDistanceKm: number;
  averageSpeedKmh: number;
  isMoving: boolean;
  stoppedDurationMin: number;
}

interface LocationCallbacks {
  onSpeed: (speedKmh: number) => void;
  onContext: (ctx: LocationContext) => void;
}

const MS_TO_KMH = 3.6;
const GEOCODE_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const HAVERSINE_R = 6371; // Earth radius in km

function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (d: number) => d * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return HAVERSINE_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Starts GPS tracking. Returns cleanup function.
 * - Speed: 1Hz via watchPositionAsync
 * - Reverse geocode: every 5 min
 * - Trip stats: distance, duration, average speed
 */
export async function startLocationTracking(callbacks: LocationCallbacks): Promise<() => void> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  RuntimeTelemetry.event('sensor_location_permission', { status });
  if (status !== 'granted') {
    console.log('[Location] Permission denied');
    RuntimeTelemetry.event('sensor_location_permission_denied');
    return () => {};
  }

  let city: string | null = null;
  let district: string | null = null;
  let country: string | null = null;
  let lastGeocode = 0;
  let tripStartTime = Date.now();
  let totalDistanceKm = 0;
  let lastLat = 0;
  let lastLon = 0;
  let hasLastPosition = false;
  let speedSamples: number[] = [];
  let lastMovingTime = Date.now();
  let stoppedSince: number | null = null;
  let locationUpdates = 0;
  let lastLocationUpdateAt = Date.now();
  let lastLocationHeartbeatAt = 0;

  const subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 1000,
      distanceInterval: 5,
    },
    async (location) => {
      locationUpdates += 1;
      lastLocationUpdateAt = Date.now();

      const { latitude, longitude, speed } = location.coords;
      const speedKmh = Math.max((speed ?? 0) * MS_TO_KMH, 0);

      callbacks.onSpeed(speedKmh);

      // Track distance
      if (hasLastPosition) {
        const dist = haversineDistance(lastLat, lastLon, latitude, longitude);
        if (dist < 1) { // Ignore GPS jumps > 1km
          totalDistanceKm += dist;
        }
      }
      lastLat = latitude;
      lastLon = longitude;
      hasLastPosition = true;

      // Track speed samples for average
      speedSamples.push(speedKmh);
      if (speedSamples.length > 600) speedSamples = speedSamples.slice(-600); // Keep last 10 min

      // Moving/stopped detection
      const isMoving = speedKmh > 3;
      if (isMoving) {
        lastMovingTime = Date.now();
        stoppedSince = null;
      } else if (!stoppedSince) {
        stoppedSince = Date.now();
      }

      // Reverse geocode periodically
      const now = Date.now();
      if (now - lastGeocode > GEOCODE_INTERVAL_MS) {
        lastGeocode = now;
        try {
          const results = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (results.length > 0) {
            city = results[0].city ?? null;
            district = results[0].district ?? null;
            country = results[0].country ?? null;
          }
        } catch (e) {
          // Geocoding needs internet — fail silently
        }
      }

      // Compute trip stats
      const tripDurationMin = (now - tripStartTime) / 60000;
      const avgSpeed = speedSamples.length > 0
        ? speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length
        : 0;
      const stoppedDurationMin = stoppedSince ? (now - stoppedSince) / 60000 : 0;

      if (now - lastLocationHeartbeatAt >= 10000) {
        lastLocationHeartbeatAt = now;
        RuntimeTelemetry.event('sensor_location_stats', {
          updates: locationUpdates,
          speedKmh: Number(speedKmh.toFixed(1)),
          isMoving,
          tripDurationMin: Number(tripDurationMin.toFixed(2)),
          tripDistanceKm: Number(totalDistanceKm.toFixed(3)),
          averageSpeedKmh: Number(avgSpeed.toFixed(1)),
          hasCity: Boolean(city),
        });
        locationUpdates = 0;
      }

      callbacks.onContext({
        speedKmh,
        city,
        district,
        country,
        latitude,
        longitude,
        tripDurationMin,
        tripDistanceKm: totalDistanceKm,
        averageSpeedKmh: avgSpeed,
        isMoving,
        stoppedDurationMin,
      });
    },
  );

  RuntimeTelemetry.event('sensor_location_started', {
    accuracy: 'balanced',
    timeIntervalMs: 1000,
    distanceIntervalM: 5,
  });

  const healthTimer = setInterval(() => {
    const silenceMs = Date.now() - lastLocationUpdateAt;
    if (silenceMs > 12000) {
      RuntimeTelemetry.event('sensor_location_inactive_warning', {
        silenceMs,
        secondsSinceMove: Math.round((Date.now() - lastMovingTime) / 1000),
      });
    }
  }, 5000);

  return () => {
    clearInterval(healthTimer);
    subscription.remove();
    RuntimeTelemetry.event('sensor_location_stopped');
  };
}
