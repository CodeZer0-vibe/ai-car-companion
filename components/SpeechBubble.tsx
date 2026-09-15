import React, { useEffect, useRef, useCallback } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
  runOnJS,
} from "react-native-reanimated";

interface Props {
  text: string | null; // Text to display, null hides it
  onDismiss?: () => void; // Called when auto-dismiss finishes
  durationMs?: number; // How long to show before fading out
  color?: string; // Neon color
}

function SpeechBubble({
  text,
  onDismiss,
  durationMs = 4000,
  color = "#00ffff",
}: Props) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);
  const scale = useSharedValue(0.9);

  // Holds the pending fade-out timer so a user tap can cancel it before the
  // auto-dismiss fires (prevents a second onDismiss, e.g. unprompted Settings open).
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Effect to trigger animations when text changes
  useEffect(() => {
    if (text) {
      // Animate IN (Pop and fade, slight glitch)
      opacity.value = withSequence(
        withTiming(0.8, { duration: 50 }),
        withTiming(0.3, { duration: 50 }),
        withTiming(1, { duration: 150 })
      );
      translateY.value = withTiming(0, {
        duration: 300,
        easing: Easing.out(Easing.back(1.5)),
      });
      scale.value = withTiming(1, {
        duration: 300,
        easing: Easing.out(Easing.back(1.5)),
      });

      // Schedule Animate OUT
      const outDuration = Math.max(durationMs, text.length * 80); // Ensure long text stays longer

      fadeTimeoutRef.current = setTimeout(() => {
        opacity.value = withTiming(0, { duration: 500 }, (finished) => {
          if (finished && onDismiss) {
            runOnJS(onDismiss)();
          }
        });
        translateY.value = withTiming(-10, { duration: 500 });
        scale.value = withTiming(0.95, { duration: 500 });
      }, outDuration);

      return () => {
        if (fadeTimeoutRef.current) {
          clearTimeout(fadeTimeoutRef.current);
          fadeTimeoutRef.current = null;
        }
      };
    } else {
      // Force hide if text is set to null externally
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [text, durationMs]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  // A tap on the bubble honors the on-screen "Tap me" recovery copy: cancel the
  // pending auto-fade so onDismiss runs exactly once, then route to the real
  // recovery (handleSpeechDismiss: openSettings / manualRetry) via onDismiss.
  const handlePress = useCallback(() => {
    if (fadeTimeoutRef.current) {
      clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = null;
    }
    onDismiss?.();
  }, [onDismiss]);

  if (!text) return null;

  return (
    <Animated.View
      style={[styles.container, { shadowColor: color }, animatedStyle]}
    >
      <Pressable onPress={handlePress} accessibilityRole="button">
        <Text style={[styles.text, { color: color, textShadowColor: color }]}>
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    maxWidth: "80%",
    zIndex: 100,
    // Cyberpunk glow
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 5,
  },
  text: {
    fontFamily: "Courier", // Monospace for robotic feel (fallback to system mono)
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    letterSpacing: 1,
    // Text glow
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
});

export default React.memo(SpeechBubble, (prev, next) => {
  return prev.text === next.text && prev.color === next.color;
});
