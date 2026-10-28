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
  /** Behind-the-cue camera: aim turn per CSS pixel of sideways drag (deg). */
  dragAimDegPerPx: 0.15,
  /** Pressing within this many radii of the cue ball during ball-in-hand picks it up. */
  pickRadiusFactor: 2.2,
} as const;

/** Synthesised background music (calm ambient pads + sparse pentatonic notes). */
export const MUSIC = {
  bpm: 60,
  beatsPerChord: 8,
  /** Chords as MIDI note numbers: Fmaj7 → Em7 → Dm7 → Cmaj7/G. */
  chords: [
    [53, 57, 60, 64],
    [52, 55, 59, 62],
    [50, 53, 57, 60],
    [43, 55, 59, 64],
  ],
  /** Melody notes (MIDI), C major pentatonic, one octave above the pads. */
  melody: [72, 74, 76, 79, 81, 84],
  /** Chance that a beat gets a melody note. */
  melodyChance: 0.3,
  /** Overall music volume (0–1), well under the sound effects. */
  volume: 0.07,
  padDetuneCents: 7,
  padAttackSeconds: 2.5,
  padLowpassHz: 900,
  noteDecaySeconds: 3,
  delaySeconds: 0.45,
  delayFeedback: 0.35,
  /** Scheduler: how far ahead notes are queued (s) and how often it runs (ms). */
  lookaheadSeconds: 1.5,
  schedulerIntervalMs: 250,
  fadeSeconds: 1.5,
} as const;

/** 3D view (three.js). Lengths in metres, angles in degrees. */
export const RENDER3D = {
  /** Cap on device pixel ratio (phones report 3; 2 looks the same and costs less). */
  maxPixelRatio: 2,
  shadowMapSize: 1024,
  fovDeg: 38,
  /** Extra room around the table in the top view (fraction). */
  topViewMargin: 0.04,
  /** Use the upright (portrait) top view when it makes the table this much bigger. */
  portraitGain: 1.15,
  /** Camera behind the cue ball while aiming. */
  cueView: { distance: 0.95, height: 0.42, lookAhead: 0.7 },
  /** While balls roll in cue view the camera rises to look over the whole table. */
  overview: { height: 3.1, back: 1.7 },
  /** Camera easing rate (1/s): higher = snappier. */
  cameraFollowRate: 6,
  cue: {
    length: 1.45,
    /** Tip to ball distance at zero power. */
    gap: 0.015,
    /** Back-swing at full power. */
    maxPull: 0.3,
    tipRadius: 0.0065,
    buttRadius: 0.0145,
    /** Minimum butt elevation; raised further when needed to clear the rail. */
    minElevationDeg: 4,
    railClearance: 0.02,
  },
  ballSegments: { width: 40, height: 28 },
  ballTexturePx: 512,
  /** Carom balls get small dots so their spin is visible (like TV/measle balls). */
  caromDotDeg: 9,
  aimLine: { width: 0.0035, dash: 0.02, gap: 0.014, lift: 0.0008 },
  /** Rail top above the cushion top. */
  railRise: 0.004,
  /** Wooden apron below the bed. */
  skirtDepth: 0.2,
  ringPool: 16,
} as const;
