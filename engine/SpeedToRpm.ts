/**
 * Simulates a 5-speed manual gearbox RPM from GPS speed.
 * Creates realistic gear-shift drops in the tachometer.
 */

interface GearRange {
  maxSpeed: number; // km/h upper bound for this gear
  rpmAt0: number;   // RPM at the bottom of this gear
  rpmPerKmh: number; // RPM gained per km/h in this gear
}

const GEARS: GearRange[] = [
  { maxSpeed: 20, rpmAt0: 800, rpmPerKmh: 200 },   // 1st: 800 → 4800
  { maxSpeed: 45, rpmAt0: 1500, rpmPerKmh: 130 },   // 2nd: 1500 → 4750
  { maxSpeed: 80, rpmAt0: 1500, rpmPerKmh: 100 },   // 3rd: 1500 → 5000
  { maxSpeed: 120, rpmAt0: 1500, rpmPerKmh: 75 },   // 4th: 1500 → 4500
  { maxSpeed: 300, rpmAt0: 1500, rpmPerKmh: 60 },   // 5th: 1500 → cruise
];

const IDLE_RPM = 800;
const MAX_RPM = 8000;

export function speedToRpm(speedKmh: number): number {
  if (speedKmh <= 0) return IDLE_RPM;

  let prevMax = 0;
  for (const gear of GEARS) {
    if (speedKmh <= gear.maxSpeed) {
      const speedInGear = speedKmh - prevMax;
      return Math.min(gear.rpmAt0 + speedInGear * gear.rpmPerKmh, MAX_RPM);
    }
    prevMax = gear.maxSpeed;
  }

  return MAX_RPM;
}

/**
 * Returns a color for the gauge arc based on value/max ratio.
 * Cyan (low) → Green (medium) → Amber (high) → Red (danger)
 */
export function gaugeColor(value: number, max: number): string {
  const ratio = Math.min(Math.max(value / max, 0), 1);

  if (ratio < 0.36) return '#00ffff'; // Cyan
  if (ratio < 0.55) return '#00ff66'; // Green
  if (ratio < 0.73) return '#ffaa00'; // Amber
  return '#ff2200';                    // Red
}

/**
 * Returns a normalized 0-1 value for gauge arc sweep.
 */
export function speedToGauge(speedKmh: number, maxSpeed: number = 220): number {
  return Math.min(Math.max(speedKmh / maxSpeed, 0), 1);
}

export function rpmToGauge(rpm: number, maxRpm: number = 8000): number {
  return Math.min(Math.max(rpm / maxRpm, 0), 1);
}
