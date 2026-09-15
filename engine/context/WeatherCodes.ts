/**
 * WMO Weather Code → human-readable description + personality trigger category.
 * https://open-meteo.com/en/docs (WMO Code Table)
 */

interface WeatherInfo {
  description: string;
  category: 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm' | 'drizzle';
  severity: number; // 0 (mild) to 3 (extreme)
}

const WMO_CODES: Record<number, WeatherInfo> = {
  0:  { description: 'clear sky', category: 'clear', severity: 0 },
  1:  { description: 'mostly clear', category: 'clear', severity: 0 },
  2:  { description: 'partly cloudy', category: 'cloudy', severity: 0 },
  3:  { description: 'overcast', category: 'cloudy', severity: 0 },
  45: { description: 'fog', category: 'fog', severity: 1 },
  48: { description: 'freezing fog', category: 'fog', severity: 2 },
  51: { description: 'light drizzle', category: 'drizzle', severity: 0 },
  53: { description: 'moderate drizzle', category: 'drizzle', severity: 1 },
  55: { description: 'dense drizzle', category: 'drizzle', severity: 1 },
  56: { description: 'freezing drizzle', category: 'drizzle', severity: 2 },
  57: { description: 'heavy freezing drizzle', category: 'drizzle', severity: 2 },
  61: { description: 'light rain', category: 'rain', severity: 0 },
  63: { description: 'moderate rain', category: 'rain', severity: 1 },
  65: { description: 'heavy rain', category: 'rain', severity: 2 },
  66: { description: 'freezing rain', category: 'rain', severity: 3 },
  67: { description: 'heavy freezing rain', category: 'rain', severity: 3 },
  71: { description: 'light snow', category: 'snow', severity: 1 },
  73: { description: 'moderate snow', category: 'snow', severity: 2 },
  75: { description: 'heavy snow', category: 'snow', severity: 3 },
  77: { description: 'snow grains', category: 'snow', severity: 1 },
  80: { description: 'light rain showers', category: 'rain', severity: 0 },
  81: { description: 'moderate rain showers', category: 'rain', severity: 1 },
  82: { description: 'violent rain showers', category: 'rain', severity: 3 },
  85: { description: 'light snow showers', category: 'snow', severity: 1 },
  86: { description: 'heavy snow showers', category: 'snow', severity: 2 },
  95: { description: 'thunderstorm', category: 'storm', severity: 2 },
  96: { description: 'thunderstorm with hail', category: 'storm', severity: 3 },
  99: { description: 'thunderstorm with heavy hail', category: 'storm', severity: 3 },
};

export function parseWeatherCode(code: number): WeatherInfo {
  return WMO_CODES[code] ?? { description: 'unknown', category: 'clear', severity: 0 };
}

export type { WeatherInfo };
