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
