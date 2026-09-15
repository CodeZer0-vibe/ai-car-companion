export type EmotionState =
  | 'idle'       // Default ice blue, slightly bored
  | 'judging'    // Squinted amber eyes
  | 'angry'      // Wide glowing red eyes, hard stare
  | 'excited'    // Wide neon green eyes, dilated pupils
  | 'sad'        // Drooping purple eyes, slow blinks
  | 'suspicious' // One eye slightly more closed, shifting amber
  | 'surprised'  // Huge pupils, white/cyan glow
  | 'sleeping'   // Closed eyes, slow breathing rhythm
  | 'glitch'     // Rapid color/size shifting
  | 'focused';   // Narrow slits, bright white (e.g., speeding)

export interface EyeParams {
  openness: number;         // 0 (closed) to 1 (wide open)
  pupilSize: number;        // 0.2 (pinprick) to 1.0 (dilated)
  pupilX: number;           // -1 to 1 (left to right)
  pupilY: number;           // -1 to 1 (up to down)
  squintBot: number;        // 0 to 1 (bottom lid coming up)
  colorInner: string;       // Hex or rgba
  colorOuter: string;       // Hex or rgba for the glow
  glowIntensity: number;    // 0 to 1
  animationSpeed: number;   // ms for transition
  // SVG shape params for angular eye morphing
  topFlatness: number;      // 0 (rounded) to 1 (flat/menacing top edge)
  cornerSharpness: number;  // 0 (rounded corners) to 1 (sharp pointed corners)
  innerCornerDroop: number; // -1 (lifted) to 1 (drooped inner corner) — for sad/suspicious
  browAngle: number;        // -1 (angled down menacing) to 1 (angled up surprised)
}

// ------------------------------------------------------------------
// Emotion Definitions
// ------------------------------------------------------------------
export const EmotionMap: Record<EmotionState, EyeParams> = {
  idle: {
    openness: 0.4,
    pupilSize: 0.5,
    pupilX: 0,
    pupilY: 0,
    squintBot: 0.1,
    colorInner: '#00ffff',
    colorOuter: 'rgba(0, 255, 255, 0.4)',
    glowIntensity: 0.6,
    animationSpeed: 800,
    topFlatness: 0.7,
    cornerSharpness: 0.8,
    innerCornerDroop: 0,
    browAngle: -0.3,
  },
  judging: {
    openness: 0.3,
    pupilSize: 0.4,
    pupilX: 0,
    pupilY: 0.2,
    squintBot: 0.4,
    colorInner: '#ff9900',
    colorOuter: 'rgba(255, 153, 0, 0.5)',
    glowIntensity: 0.8,
    animationSpeed: 400,
    topFlatness: 0.8,
    cornerSharpness: 0.9,
    innerCornerDroop: 0,
    browAngle: -0.5,
  },
  angry: {
    openness: 0.25,
    pupilSize: 0.3,
    pupilX: 0,
    pupilY: -0.1,
    squintBot: 0.2,
    colorInner: '#ff0000',
    colorOuter: 'rgba(255, 0, 0, 0.8)',
    glowIntensity: 1.0,
    animationSpeed: 250,
    topFlatness: 0.9,
    cornerSharpness: 1.0,
    innerCornerDroop: -0.3,
    browAngle: -0.8,
  },
  excited: {
    openness: 0.7,
    pupilSize: 0.8,
    pupilX: 0,
    pupilY: 0,
    squintBot: 0,
    colorInner: '#00ff00',
    colorOuter: 'rgba(0, 255, 0, 0.6)',
    glowIntensity: 0.9,
    animationSpeed: 300,
    topFlatness: 0.4,
    cornerSharpness: 0.5,
    innerCornerDroop: 0,
    browAngle: 0.3,
  },
  sad: {
    openness: 0.5,
    pupilSize: 0.6,
    pupilX: 0,
    pupilY: -0.2,
    squintBot: 0.1,
    colorInner: '#9900ff',
    colorOuter: 'rgba(153, 0, 255, 0.3)',
    glowIntensity: 0.4,
    animationSpeed: 1200,
    topFlatness: 0.3,
    cornerSharpness: 0.3,
    innerCornerDroop: 0.6,
    browAngle: 0.4,
  },
  suspicious: {
    openness: 0.35,
    pupilSize: 0.4,
    pupilX: 0.4,
    pupilY: 0,
    squintBot: 0.3,
    colorInner: '#ffcc00',
    colorOuter: 'rgba(255, 204, 0, 0.3)',
    glowIntensity: 0.5,
    animationSpeed: 600,
    topFlatness: 0.6,
    cornerSharpness: 0.7,
    innerCornerDroop: 0.2,
    browAngle: -0.2,
  },
  surprised: {
    openness: 0.9,
    pupilSize: 0.2,
    pupilX: 0,
    pupilY: 0,
    squintBot: 0,
    colorInner: '#ffffff',
    colorOuter: 'rgba(0, 255, 255, 0.8)',
    glowIntensity: 1.0,
    animationSpeed: 150,
    topFlatness: 0.1,
    cornerSharpness: 0.2,
    innerCornerDroop: 0,
    browAngle: 0.7,
  },
  sleeping: {
    openness: 0.05,
    pupilSize: 0.5,
    pupilX: 0,
    pupilY: 0,
    squintBot: 0.5,
    colorInner: '#0044ff',
    colorOuter: 'rgba(0, 68, 255, 0.1)',
    glowIntensity: 0.2,
    animationSpeed: 2000,
    topFlatness: 0.5,
    cornerSharpness: 0.3,
    innerCornerDroop: 0.3,
    browAngle: 0,
  },
  glitch: {
    openness: 0.8,
    pupilSize: 0.6,
    pupilX: 0,
    pupilY: 0,
    squintBot: 0,
    colorInner: '#ff00ff',
    colorOuter: 'rgba(255, 0, 255, 0.9)',
    glowIntensity: 1.0,
    animationSpeed: 50,
    topFlatness: 0.5,
    cornerSharpness: 0.5,
    innerCornerDroop: 0,
    browAngle: 0,
  },
  focused: {
    openness: 0.3,
    pupilSize: 0.5,
    pupilX: 0,
    pupilY: 0,
    squintBot: 0.1,
    colorInner: '#ffffff',
    colorOuter: 'rgba(255, 255, 255, 0.5)',
    glowIntensity: 0.7,
    animationSpeed: 300,
    topFlatness: 0.8,
    cornerSharpness: 0.9,
    innerCornerDroop: 0,
    browAngle: -0.4,
  },
};

// ------------------------------------------------------------------
// State Machine Helper
// ------------------------------------------------------------------
export function getEyeParams(state: EmotionState): EyeParams {
  return EmotionMap[state] || EmotionMap.idle;
}

// Generate slight random drift for idle state to make it feel alive
export function generateIdleDrift(): Partial<EyeParams> {
  return {
    pupilX: (Math.random() - 0.5) * 0.3, // -0.15 to 0.15
    pupilY: (Math.random() - 0.5) * 0.2, // -0.1 to 0.1
    openness: 0.75 + Math.random() * 0.1, // 0.75 to 0.85
  };
}
