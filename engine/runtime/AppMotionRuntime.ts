import { Accelerometer } from 'expo-sensors';
import type { AppSessionRuntimeDeps } from './AppSessionRuntimeTypes';
import { RuntimeTelemetry } from '../RuntimeTelemetry';

export function startMotionTracking(d: AppSessionRuntimeDeps) {
  const updateIntervalMs = 32;
  Accelerometer.setUpdateInterval(updateIntervalMs);
  RuntimeTelemetry.event('sensor_motion_start', { updateIntervalMs });

  let lastShakeTime = 0;
  let sampleCount = 0;
  let shakeCount = 0;
  let lastSampleAt = Date.now();
  let lastHeartbeatAt = 0;

  const sub = Accelerometer.addListener(({ x, y, z }) => {
    sampleCount += 1;
    lastSampleAt = Date.now();

    const magSq = x * x + y * y + z * z;
    const now = Date.now();
    if (magSq > 3.24 && now - lastShakeTime > 1000) {
      lastShakeTime = now;
      shakeCount += 1;
      RuntimeTelemetry.event('sensor_motion_shake_detected', {
        magSq: Number(magSq.toFixed(3)),
        shakeCount,
      });
      d.triggerReaction('shake');
    }

    if (now - lastHeartbeatAt >= 5000) {
      lastHeartbeatAt = now;
      RuntimeTelemetry.event('sensor_motion_stats', {
        samples: sampleCount,
        shakes: shakeCount,
        lastMagSq: Number(magSq.toFixed(3)),
      });
      sampleCount = 0;
      shakeCount = 0;
    }

    const newTiltX = Math.max(-1, Math.min(1, -y * 1.5));
    const newTiltY = Math.max(-1, Math.min(1, x * 1.5));
    if (Math.abs(newTiltX) > 0.1 || Math.abs(newTiltY) > 0.1) {
      d.tiltX.value = newTiltX;
      d.tiltY.value = newTiltY;
    }
  });

  const healthTimer = setInterval(() => {
    const silenceMs = Date.now() - lastSampleAt;
    if (silenceMs > 8000) {
      RuntimeTelemetry.event('sensor_motion_inactive_warning', { silenceMs });
    }
  }, 4000);

  d.accelSubRef.current = {
    remove: () => {
      clearInterval(healthTimer);
      sub.remove();
      RuntimeTelemetry.event('sensor_motion_stopped');
    },
  };
}
