import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withSpring,
  withTiming,
  withSequence,
  Easing,
  useDerivedValue,
} from 'react-native-reanimated';
import Svg, { Path, Circle, Text as SvgText, G, Defs, ClipPath } from 'react-native-svg';
import { EmotionState, getEyeParams } from '../engine/EmotionEngine';
import { gaugeColor } from '../engine/SpeedToRpm';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedSvgText = Animated.createAnimatedComponent(SvgText);
const AnimatedG = Animated.createAnimatedComponent(G);

interface EyeSvgProps {
  emotion: EmotionState;
  blinkTrigger: number;
  driftX: number;
  driftY: number;
  size?: number;
  isSpeaking?: boolean;
  gaugeValue: number;     // 0-1 normalized (speed/220 or rpm/8000)
  gaugeLabel: string;     // e.g. "120" or "4500"
  gaugeUnit: string;      // e.g. "km/h" or "RPM"
  gaugeRawValue: number;  // Raw value for color computation
  gaugeMax: number;       // Max value for color computation (220 or 8000)
}

// SVG viewBox dimensions
const VB_W = 200;
const VB_H = 280;
const CX = VB_W / 2;  // Center X
const CY = VB_H / 2;  // Center Y

// Gauge arc config
const GAUGE_R = 60;          // Radius of gauge arc
const ARC_START = 225;       // Start angle (7 o'clock) in degrees
const ARC_SWEEP = 270;       // Sweep angle in degrees
const ARC_CIRCUMFERENCE = 2 * Math.PI * GAUGE_R;
const ARC_LENGTH = ARC_CIRCUMFERENCE * (ARC_SWEEP / 360);

/**
 * Build an angular almond eye path.
 * openness: 0 (closed slit) to 1 (wide open)
 * topFlatness: 0 (rounded) to 1 (flat menacing)
 * cornerSharpness: 0 (rounded corners) to 1 (sharp pointed)
 * innerCornerDroop: -1 to 1 (lift to droop on inner corner)
 * browAngle: -1 (menacing down) to 1 (surprised up)
 */
function buildEyePath(
  openness: number,
  topFlatness: number,
  cornerSharpness: number,
  innerCornerDroop: number,
  browAngle: number,
): string {
  'worklet';

  const halfHeight = (VB_H * 0.45) * Math.max(openness, 0.02); // Min slit
  const cornerExtend = 20 + cornerSharpness * 15; // How pointy the corners are

  // Left corner (inner corner of eye)
  const lx = 5 - cornerSharpness * 5;
  const ly = CY + innerCornerDroop * 15;

  // Right corner (outer corner)
  const rx = VB_W - 5 + cornerSharpness * 5;
  const ry = CY;

  // Top edge control points — flatten with topFlatness
  const topY = CY - halfHeight;
  const topCpYOffset = halfHeight * (1 - topFlatness * 0.6); // Flatter top = less curve
  const browOffset = browAngle * 20; // Brow tilt

  // Bottom edge control points — always rounder than top
  const botY = CY + halfHeight;
  const botCpYOffset = halfHeight * 0.9; // Always curvy bottom

  // Path: left corner → top bezier → right corner → bottom bezier → close
  return [
    `M ${lx} ${ly}`,
    // Top edge: left to right
    `C ${lx + 40} ${topY - topCpYOffset + browOffset},`,
    `  ${rx - 40} ${topY - topCpYOffset + browOffset * 0.5},`,
    `  ${rx} ${ry}`,
    // Bottom edge: right to left
    `C ${rx - 40} ${botY + botCpYOffset * 0.3},`,
    `  ${lx + 40} ${botY + botCpYOffset * 0.3},`,
    `  ${lx} ${ly}`,
    'Z',
  ].join(' ');
}

/**
 * Build a circular arc path for the gauge.
 * startAngle and sweepAngle in degrees.
 */
function describeArc(cx: number, cy: number, r: number, startAngle: number, sweepAngle: number): string {
  'worklet';
  const startRad = (startAngle - 90) * (Math.PI / 180);
  const endRad = (startAngle + sweepAngle - 90) * (Math.PI / 180);

  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);

  const largeArc = sweepAngle > 180 ? 1 : 0;

  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

export default function EyeSvg({
  emotion,
  blinkTrigger,
  driftX = 0,
  driftY = 0,
  size = 120,
  isSpeaking = false,
  gaugeValue,
  gaugeLabel,
  gaugeUnit,
  gaugeRawValue,
  gaugeMax,
}: EyeSvgProps) {
  const params = getEyeParams(emotion);
  const aspectRatio = VB_H / VB_W;
  const displayWidth = size;
  const displayHeight = size * aspectRatio;

  // Shared values for smooth animation
  const openness = useSharedValue(params.openness);
  const topFlatness = useSharedValue(params.topFlatness);
  const cornerSharpness = useSharedValue(params.cornerSharpness);
  const innerCornerDroop = useSharedValue(params.innerCornerDroop);
  const browAngle = useSharedValue(params.browAngle);
  const pupilSize = useSharedValue(params.pupilSize);
  const pupilX = useSharedValue(params.pupilX + driftX);
  const pupilY = useSharedValue(params.pupilY + driftY);
  const glowIntensity = useSharedValue(params.glowIntensity);

  // Emotion transitions
  useEffect(() => {
    const p = getEyeParams(emotion);
    const springConfig = { damping: 12, stiffness: 90 };

    openness.value = withSpring(p.openness, springConfig);
    topFlatness.value = withSpring(p.topFlatness, { damping: 15, stiffness: 100 });
    cornerSharpness.value = withSpring(p.cornerSharpness, { damping: 15, stiffness: 100 });
    innerCornerDroop.value = withSpring(p.innerCornerDroop, springConfig);
    browAngle.value = withSpring(p.browAngle, springConfig);
    pupilSize.value = withSpring(p.pupilSize, { damping: 10, stiffness: 80 });

    const targetGlow = isSpeaking ? Math.min(p.glowIntensity + 0.3, 1.0) : p.glowIntensity;
    glowIntensity.value = withTiming(targetGlow, { duration: p.animationSpeed });
  }, [emotion, isSpeaking]);

  // Pupil drift
  useEffect(() => {
    const p = getEyeParams(emotion);
    pupilX.value = withSpring(p.pupilX + driftX, { damping: 20, stiffness: 50 });
    pupilY.value = withSpring(p.pupilY + driftY, { damping: 20, stiffness: 50 });
  }, [emotion, driftX, driftY]);

  // Blinking
  useEffect(() => {
    if (blinkTrigger > 0 && emotion !== 'sleeping') {
      openness.value = withSequence(
        withTiming(0.02, { duration: 60, easing: Easing.in(Easing.ease) }),
        withTiming(getEyeParams(emotion).openness, { duration: 120, easing: Easing.out(Easing.ease) })
      );
    }
  }, [blinkTrigger]);

  // Animated eye shape path
  const eyePathProps = useAnimatedProps(() => {
    return {
      d: buildEyePath(
        openness.value,
        topFlatness.value,
        cornerSharpness.value,
        innerCornerDroop.value,
        browAngle.value,
      ),
    };
  });

  // Animated pupil position and size
  const pupilR = useDerivedValue(() => 15 * pupilSize.value);
  const pupilCx = useDerivedValue(() => CX + pupilX.value * 30);
  const pupilCy = useDerivedValue(() => CY + pupilY.value * 25);

  const pupilAnimatedProps = useAnimatedProps(() => ({
    cx: pupilCx.value,
    cy: pupilCy.value,
    r: pupilR.value,
  }));

  // Highlight position (follows pupil)
  const highlightAnimatedProps = useAnimatedProps(() => ({
    cx: pupilCx.value + pupilR.value * 0.3,
    cy: pupilCy.value - pupilR.value * 0.3,
    r: pupilR.value * 0.2,
  }));

  // Gauge text position (inside pupil)
  const textAnimatedProps = useAnimatedProps(() => ({
    x: pupilCx.value,
    y: pupilCy.value + 2,
  }));

  const unitTextAnimatedProps = useAnimatedProps(() => ({
    x: pupilCx.value,
    y: pupilCy.value + 10,
  }));

  // Compute gauge colors
  const gColor = gaugeColor(gaugeRawValue, gaugeMax);
  const clampedGauge = Math.min(Math.max(gaugeValue, 0), 1);
  const gaugeStrokeDashoffset = ARC_LENGTH * (1 - clampedGauge);

  // Outer glow color (matches gauge when moving, emotion color when stationary)
  const glowColor = gaugeRawValue > 2 ? gColor : params.colorOuter;

  return (
    <View style={[styles.container, {
      width: displayWidth,
      height: displayHeight,
      shadowColor: glowColor,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: isSpeaking ? 0.9 : 0.6,
      shadowRadius: 20,
      elevation: 10,
    }]}>
      <Svg
        width={displayWidth}
        height={displayHeight}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
      >
        <Defs>
          <ClipPath id="eyeClip">
            <AnimatedPath animatedProps={eyePathProps} />
          </ClipPath>
        </Defs>

        {/* Eye fill (dark interior with subtle color tint) */}
        <AnimatedPath
          animatedProps={eyePathProps}
          fill="rgba(10, 12, 18, 0.95)"
          stroke={params.colorInner}
          strokeWidth={2}
          opacity={0.9}
        />

        {/* Clipped group: everything inside the eye shape */}
        <G clipPath="url(#eyeClip)">
          {/* Background gauge track (always visible, dim) */}
          <Path
            d={describeArc(CX, CY, GAUGE_R, ARC_START, ARC_SWEEP)}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={6}
            strokeLinecap="round"
          />

          {/* Active gauge arc (sweeps with speed/RPM) */}
          <Path
            d={describeArc(CX, CY, GAUGE_R, ARC_START, ARC_SWEEP)}
            fill="none"
            stroke={gColor}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${ARC_LENGTH}`}
            strokeDashoffset={gaugeStrokeDashoffset}
            opacity={clampedGauge > 0.01 ? 0.9 : 0}
          />

          {/* Inner glow ring (subtle color ring following gauge) */}
          <Path
            d={describeArc(CX, CY, GAUGE_R - 8, ARC_START, ARC_SWEEP)}
            fill="none"
            stroke={gColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={`${ARC_LENGTH * 0.8}`}
            strokeDashoffset={ARC_LENGTH * 0.8 * (1 - clampedGauge)}
            opacity={clampedGauge > 0.01 ? 0.3 : 0}
          />

          {/* Pupil (dark center) */}
          <AnimatedCircle
            animatedProps={pupilAnimatedProps}
            fill="#000000"
          />

          {/* Speed/RPM text inside pupil */}
          <AnimatedSvgText
            animatedProps={textAnimatedProps}
            fill={gColor}
            fontSize={gaugeLabel.length > 3 ? 7 : 9}
            fontWeight="bold"
            textAnchor="middle"
            fontFamily="monospace"
            opacity={clampedGauge > 0.01 ? 0.9 : 0.3}
          >
            {gaugeLabel}
          </AnimatedSvgText>
          <AnimatedSvgText
            animatedProps={unitTextAnimatedProps}
            fill={gColor}
            fontSize={5}
            textAnchor="middle"
            fontFamily="monospace"
            opacity={clampedGauge > 0.01 ? 0.6 : 0.2}
          >
            {gaugeUnit}
          </AnimatedSvgText>

          {/* Specular highlight (life dot) */}
          <AnimatedCircle
            animatedProps={highlightAnimatedProps}
            fill="rgba(255, 255, 255, 0.6)"
          />
        </G>

        {/* Outer glow edge on the eye shape */}
        <AnimatedPath
          animatedProps={eyePathProps}
          fill="none"
          stroke={glowColor}
          strokeWidth={1.5}
          opacity={0.5}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
