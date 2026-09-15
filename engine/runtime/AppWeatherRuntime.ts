import { parseWeatherCode, type WeatherInfo } from '../context/WeatherCodes';

export interface WeatherData {
  tempC: number;
  feelsLikeC: number;
  weatherCode: number;
  weatherInfo: WeatherInfo;
  windKmh: number;
  humidity: number;
  isDay: boolean;
}

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 min

let cachedWeather: WeatherData | null = null;
let lastFetchTime = 0;
let lastLat = 0;
let lastLon = 0;

/**
 * Fetch current weather from Open-Meteo (free, no API key).
 * Caches result for 15 minutes. Returns null on failure.
 */
export async function fetchWeather(latitude: number, longitude: number): Promise<WeatherData | null> {
  const now = Date.now();
  if (cachedWeather && now - lastFetchTime < POLL_INTERVAL_MS && latitude === lastLat && longitude === lastLon) {
    return cachedWeather;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day`;
    const response = await fetch(url);
    if (!response.ok) return cachedWeather;

    const data = await response.json();
    const current = data.current;

    cachedWeather = {
      tempC: current.temperature_2m,
      feelsLikeC: current.apparent_temperature,
      weatherCode: current.weather_code,
      weatherInfo: parseWeatherCode(current.weather_code),
      windKmh: current.wind_speed_10m,
      humidity: current.relative_humidity_2m,
      isDay: current.is_day === 1,
    };

    lastFetchTime = now;
    lastLat = latitude;
    lastLon = longitude;

    return cachedWeather;
  } catch {
    return cachedWeather; // Return stale data on network error
  }
}

export function getCachedWeather(): WeatherData | null {
  return cachedWeather;
}

/**
 * Build a context string for Gemini from weather data.
 */
export function weatherToContext(weather: WeatherData | null): string {
  if (!weather) return '';
  const { tempC, feelsLikeC, weatherInfo, windKmh, isDay } = weather;
  let line = `Weather: ${weatherInfo.description}, ${Math.round(tempC)}°C`;
  if (Math.abs(tempC - feelsLikeC) > 3) {
    line += ` (feels like ${Math.round(feelsLikeC)}°C)`;
  }
  if (windKmh > 30) line += `, wind ${Math.round(windKmh)} km/h`;
  line += isDay ? '' : ' (night)';
  return line;
}
