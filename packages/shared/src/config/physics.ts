/**
 * Physics constants, grouped into per-discipline profiles so pool and carom can be tuned apart.
 * Every value that changes how balls move is here; physics/ code must not contain tuning numbers.
 *
 * Coefficients follow the usual billiards literature (Marlow, Alciatore "TP" notes, Han 2005)
 * and are tuned by feel. When a value is changed, record it in README → "물리 수치 변경 이력".
 */

export type PhysicsProfileId = 'pool' | 'carom';

export interface PhysicsProfile {
  id: PhysicsProfileId;
  /** Fixed simulation step (s). Rendering interpolates independently of this. */
  timeStep: number;
  /** Gravitational acceleration (m/s²). */
  gravity: number;

  /** Ball–ball coefficient of restitution (normal direction). */
  ballBallRestitution: number;
  /** Ball–ball sliding friction (causes cut-induced throw and side-spin transfer). */
  ballBallFriction: number;

  /** Ball–cushion coefficient of restitution (normal direction). */
  cushionRestitution: number;
  /** Ball–cushion friction: how strongly side spin bends the rebound angle. */
  cushionFriction: number;

  /** Cloth sliding friction μs (ball skids, spin not matched to speed). */
  clothSlidingFriction: number;
  /** Cloth rolling resistance μr (natural roll). */
  clothRollingFriction: number;
  /** Cloth "spin" friction μsp, decays vertical-axis (side) spin: dωz/dt = −5·μsp·g / (2R). */
  clothSpinFriction: number;

  /** Cue speed at full power (m/s). */
  maxCueSpeed: number;
  /** Cue speed at the smallest power the UI allows (m/s). */
  minCueSpeed: number;
  /** Largest tip offset from ball centre, as a fraction of the radius (miscue limit ≈ 0.5). */
  maxTipOffset: number;
  /**
   * Spin per unit tip offset: ω = k · v · offset / R. For a solid sphere struck by a level cue
   * k = 5/2 (impulse J at height b gives ω = J·b / I, I = 2/5·m·R²). Kept configurable so the
   * spin feel can be tuned without touching the physics code.
   */
  cueSpinFactor: number;

  /** Below this speed (m/s) a rolling ball is considered stopped. */
  stopSpeed: number;
  /** Safety cap on simulated shot duration (s). */
  maxShotTime: number;
  /** Safety cap on collisions resolved within one fixed step (break shots resolve many at t=0). */
  maxCollisionsPerStep: number;
  /** Gap left between racked balls so the rack is not pre-compressed (m). */
  rackGap: number;
}

const COMMON = {
  timeStep: 1 / 240,
  gravity: 9.81,
  stopSpeed: 0.004,
  maxShotTime: 60,
  maxCollisionsPerStep: 256,
  cueSpinFactor: 2.5,
  maxTipOffset: 0.5,
} as const;

export const PHYSICS: Record<PhysicsProfileId, PhysicsProfile> = {
  pool: {
    ...COMMON,
    id: 'pool',
    ballBallRestitution: 0.95, // spec: ~0.95 (phenolic balls 0.92–0.98)
    ballBallFriction: 0.06, // literature: 0.03–0.08
    cushionRestitution: 0.78, // spec: 0.75–0.8
    cushionFriction: 0.2, // literature ~0.14–0.25; tuned by feel
    clothSlidingFriction: 0.2, // literature 0.15–0.4
    clothRollingFriction: 0.011, // literature 0.005–0.015
    clothSpinFriction: 0.044, // literature (Marlow)
    maxCueSpeed: 9.0, // strong break ~ 9–11 m/s
    minCueSpeed: 0.15,
    rackGap: 0.0001,
  },
  carom: {
    ...COMMON,
    id: 'carom',
    ballBallRestitution: 0.95, // spec: ~0.95
    ballBallFriction: 0.05,
    cushionRestitution: 0.8, // spec upper end: carom cushions are lively
    cushionFriction: 0.22, // side spin is the heart of 3-cushion: slightly stronger than pool
    clothSlidingFriction: 0.2,
    clothRollingFriction: 0.009, // heated carom cloth runs longer than pool cloth (TODO(확인 필요))
    clothSpinFriction: 0.044,
    maxCueSpeed: 8.0,
    minCueSpeed: 0.15,
    rackGap: 0,
  },
};
