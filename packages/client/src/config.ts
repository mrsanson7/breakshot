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
  /** Q/E keys: cue elevation step (deg). */
  elevationKeyStepDeg: 5,
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
  cueView: {
    distance: 0.95,
    height: 0.42,
    lookAhead: 0.7,
    /** At a vertical cue the camera rises this much and steps this far to the right (scaled by sin α). */
    raisedLift: 0.7,
    raisedSideStep: 0.35,
  },
  /** While balls roll in cue view the camera rises until the whole table fits, tilted this much from straight down. */
  overview: { tiltDeg: 28, margin: 0.12 },
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

/**
 * 파이브앤하프 (Five & Half) system, Korean convention. Canonical view: the ball starts from the
 * right (start rail = right long rail / bottom short rail), hits the left long rail first, then the
 * top short rail, then arrives on the right long rail. Positions are in diamonds:
 *  - v: along the long rails, measured from the top (2nd-rail) end;
 *  - u: across, measured from the 1st (left) rail.
 * 출발값/1쿠션값 use frame points (the diamonds), 3쿠션값 uses rail (cushion nose) points.
 * Formula: 3쿠션 = 출발 − 1쿠션. Values from windcjg.blogspot.com/2017/04/3.html and
 * 3c-master.com/systems/five-and-half; half-diamond steps beyond 50 (1쿠션), 70 (출발, short rail)
 * and 40 (3쿠션) follow those pages. TODO(확인 필요): corrections near the corners are not modelled.
 */
export const FIVE_AND_HALF = {
  /** 1쿠션 values on the left long rail: [v, value]. */
  first: [[0, 0], [1, 10], [2, 20], [3, 30], [4, 40], [5, 50], [5.5, 60], [6, 70], [6.5, 80], [7, 90]],
  /** 출발값 on the right long rail (frame): [v, value]; the bottom-right corner (v = 8) is 50. */
  startLong: [[2, 20], [3, 25], [4, 30], [5, 35], [6, 40], [7, 45], [8, 50]],
  /** 출발값 on the bottom short rail (frame): [u, value]; the corner (u = 4) is 50. */
  startShort: [[0.5, 100], [1, 90], [1.5, 80], [2, 70], [3, 60], [4, 50]],
  /** 3쿠션 arrival values on the right long rail (cushion): [v, value]. */
  third: [[0, 0], [1, 10], [2, 20], [3, 30], [4, 40], [4.5, 50], [5, 60], [5.5, 70], [6, 80]],
} as const;

/** Practice guide: simulated cue-ball path. */
export const GUIDE = {
  /** Power used for the path preview before the player has pulled the cue. */
  previewPower: 0.55,
  /** Stop the preview after this many cue-ball cushions or this much simulated time. */
  maxCushions: 6,
  maxSeconds: 8,
  /** Record a path point every n physics steps. */
  sampleEvery: 2,
} as const;
