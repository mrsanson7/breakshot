/** Aim-assist presets selectable per room. Lengths in metres along the predicted path. */
export type AimAssistLevel = 'full' | 'short' | 'off';

export interface AimAssistSpec {
  /** Total length of the drawn cue-ball path. */
  pathLength: number;
  /** Cushion reflections followed by the cue-ball path (without spin). */
  cushionBounces: number;
  /** Length of the object-ball and cue-ball deflection lines at a full / zero cut. */
  objectLineLength: number;
  deflectLineLength: number;
}

export const AIM_ASSIST: Record<AimAssistLevel, AimAssistSpec | null> = {
  full: { pathLength: 4, cushionBounces: 2, objectLineLength: 0.6, deflectLineLength: 0.45 },
  short: { pathLength: 0.6, cushionBounces: 0, objectLineLength: 0.15, deflectLineLength: 0.12 }, // 경쟁전
  off: null,
};
