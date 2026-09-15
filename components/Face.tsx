import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import EyeSvg from "./EyeSvg";
import SpeechBubble from "./SpeechBubble";
import { EmotionState, generateIdleDrift } from "../engine/EmotionEngine";
import { speedToRpm, speedToGauge, rpmToGauge } from "../engine/SpeedToRpm";

interface FaceProps {
  emotionState: EmotionState;
  speechText: string | null;
  onSpeechDismiss: () => void;
  isSpeaking?: boolean;
  tiltX?: SharedValue<number>;
  tiltY?: SharedValue<number>;
  onSharePress?: () => void;
  speedKmh?: number; // GPS speed in km/h
}

function getDriftProfile(emotion: EmotionState): {
  scale: number;
  minDelayMs: number;
  maxDelayMs: number;
} {
  switch (emotion) {
    case "suspicious":
      return { scale: 1.6, minDelayMs: 500, maxDelayMs: 1300 };
    case "judging":
    case "focused":
      return { scale: 0.9, minDelayMs: 700, maxDelayMs: 1600 };
    case "excited":
    case "glitch":
    case "surprised":
      return { scale: 1.3, minDelayMs: 450, maxDelayMs: 1100 };
    case "sleeping":
      return { scale: 0.15, minDelayMs: 2200, maxDelayMs: 3400 };
    case "angry":
      return { scale: 0.5, minDelayMs: 900, maxDelayMs: 1800 };
    case "sad":
      return { scale: 0.6, minDelayMs: 1200, maxDelayMs: 2400 };
    case "idle":
    default:
      return { scale: 1.0, minDelayMs: 900, maxDelayMs: 2200 };
  }
}

function FaceComponent({
  emotionState,
  speechText,
  onSpeechDismiss,
  isSpeaking = false,
  tiltX,
  tiltY,
  onSharePress,
  speedKmh = 0,
}: FaceProps) {
  const { width } = useWindowDimensions();

  // Calculate eye size based on screen width (responsive)
  const eyeSize = Math.max(100, Math.min(width * 0.25, 180));

  // Compute gauge values
  const rpm = speedToRpm(speedKmh);
  const speedGauge = speedToGauge(speedKmh);
  const rpmGauge = rpmToGauge(rpm);

  // ------------------------------------------------------------------
  // State: Blinking & Drifting
  // ------------------------------------------------------------------
  const [blinkTrigger, setBlinkTrigger] = useState(0);
  const [driftX, setDriftX] = useState(0);
  const [driftY, setDriftY] = useState(0);

  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const driftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doubleBlinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // ------------------------------------------------------------------
  // Ambient Breathing Glow (Face wide)
  // ------------------------------------------------------------------
  const ambientGlow = useSharedValue(0.2);

  useEffect(() => {
    if (isSpeaking) {
      // Faster, brighter pulse while Gemini speaks
      ambientGlow.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 400, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    } else {
      // Slow, rhythmic breathing effect
      ambientGlow.value = withRepeat(
        withSequence(
          withTiming(0.4, {
            duration: 2500,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(0.2, { duration: 2500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    }
  }, [isSpeaking]);

  const animatedBackgroundStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: `rgba(20, 25, 30, ${ambientGlow.value})`, // Extremely subtle tint over pure black
    };
  });

  // ------------------------------------------------------------------
  // Life Systems: Blinking
  // ------------------------------------------------------------------
  useEffect(() => {
    const applyBlink = () => {
      setBlinkTrigger((prev) => prev + 1);

      // Randomize next blink between 3 and 7 seconds
      const nextBlink = 3000 + Math.random() * 4000;

      // 10% chance of double blink!
      if (Math.random() < 0.1) {
        if (doubleBlinkTimerRef.current)
          clearTimeout(doubleBlinkTimerRef.current);
        doubleBlinkTimerRef.current = setTimeout(
          () => setBlinkTrigger((prev) => prev + 1),
          200
        );
      }

      blinkTimerRef.current = setTimeout(applyBlink, nextBlink);
    };

    // Start cycle
    blinkTimerRef.current = setTimeout(applyBlink, 2000);

    return () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
      if (doubleBlinkTimerRef.current)
        clearTimeout(doubleBlinkTimerRef.current);
    };
  }, []);

  // ------------------------------------------------------------------
  // Life Systems: Pupil Drift + Tilt (from App.tsx accelerometer)
  // ------------------------------------------------------------------
  useEffect(() => {
    // Ambient drift (always running, but scaled per emotion for stronger expressiveness)
    const applyDrift = () => {
      const profile = getDriftProfile(emotionState);
      const drift = generateIdleDrift();
      const targetX = (drift.pupilX || 0) * profile.scale;
      const targetY = (drift.pupilY || 0) * profile.scale;
      setDriftX((prev) => prev * 0.45 + targetX * 0.55);
      setDriftY((prev) => prev * 0.45 + targetY * 0.55);

      const nextDrift =
        profile.minDelayMs +
        Math.random() * (profile.maxDelayMs - profile.minDelayMs);
      driftTimerRef.current = setTimeout(applyDrift, nextDrift);
    };
    applyDrift();

    return () => {
      if (driftTimerRef.current) clearTimeout(driftTimerRef.current);
    };
  }, [emotionState]);

  return (
    <Animated.View style={[styles.faceContainer, animatedBackgroundStyle]}>
      {/* Left Eye — Speedometer */}
      <EyeSvg
        emotion={emotionState}
        blinkTrigger={blinkTrigger}
        driftX={driftX}
        driftY={driftY}
        size={eyeSize}
        isSpeaking={isSpeaking}
        gaugeValue={speedGauge}
        gaugeLabel={Math.round(speedKmh).toString()}
        gaugeUnit="km/h"
        gaugeRawValue={speedKmh}
        gaugeMax={220}
      />

      {/* Spacing between eyes */}
      <Animated.View style={{ width: eyeSize * 0.8 }} />

      {/* Right Eye — Tachometer */}
      <EyeSvg
        emotion={emotionState}
        blinkTrigger={blinkTrigger}
        driftX={driftX}
        driftY={driftY}
        size={eyeSize}
        isSpeaking={isSpeaking}
        gaugeValue={rpmGauge}
        gaugeLabel={Math.round(rpm).toString()}
        gaugeUnit="RPM"
        gaugeRawValue={rpm}
        gaugeMax={8000}
      />

      {/* Temporary Speech Overlay */}
      <SpeechBubble text={speechText} onDismiss={onSpeechDismiss} />
      {onSharePress ? (
        <Pressable style={styles.shareButton} onPress={onSharePress}>
          <Text style={styles.shareText}>Share Pet</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export default React.memo(FaceComponent, (prev, next) => {
  return (
    prev.emotionState === next.emotionState &&
    prev.speechText === next.speechText &&
    prev.isSpeaking === next.isSpeaking &&
    prev.speedKmh === next.speedKmh
  );
});

const styles = StyleSheet.create({
  faceContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000000", // Pure black for OLED screens
  },
  shareButton: {
    position: "absolute",
    bottom: 18,
    right: 18,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderWidth: 1,
    borderColor: "rgba(0,255,255,0.45)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 96,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  shareText: {
    color: "#00ffff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
});
