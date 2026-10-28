/** Client-only UI tuning (input feel). Game numbers live in @breakshot/shared config. */
export const CONTROLS = {
  /** Arrow keys: fine aim step (deg); with Shift: coarse step. */
  fineAimStepDeg: 0.1,
  coarseAimStepDeg: 1,
  /** Pulling the mouse back this many CSS pixels gives full power. */
  pullPixelsForFullPower: 240,
  /** Releases below this power cancel the shot instead of tapping the ball. */
  minShotPower: 0.03,
  /** Spin keys (W/A/S/D) step, as a fraction of the maximum tip offset. */
  spinKeyStep: 0.1,
  /** Pressing within this many radii of the cue ball during ball-in-hand picks it up. */
  pickRadiusFactor: 2.2,
} as const;
