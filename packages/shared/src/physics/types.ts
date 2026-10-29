import type { RailId } from './geometry';

/**
 * Full dynamic state of one ball.
 * Angular velocity: wx, wy are the horizontal components (follow/draw roll), wz is side spin
 * (positive = counter-clockwise seen from above, which is what right-of-centre english produces
 * in this y-up frame).
 */
export interface BallState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wx: number;
  wy: number;
  wz: number;
  pocketed: boolean;
}

/** A ball at rest; what the network and rules exchange between shots. */
export interface BallPosition {
  id: string;
  x: number;
  y: number;
  pocketed: boolean;
}

/** Player input for one shot. Angle in radians in table coordinates (0 = +x, CCW positive). */
export interface ShotInput {
  angle: number;
  /** 0..1, mapped linearly to [minCueSpeed, maxCueSpeed]. */
  power: number;
  /** Tip offset, −1..1 each, |(spinX, spinY)| ≤ 1. +x = right english, +y = follow (top). */
  spinX: number;
  spinY: number;
  /** Cue elevation above level (deg), 0 = level. Omitted = level. */
  elevation?: number;
}

export type ShotEvent =
  | { type: 'ballBall'; t: number; a: string; b: string; speed: number }
  | { type: 'cushion'; t: number; ball: string; rail: RailId; speed: number }
  | { type: 'pocket'; t: number; ball: string; pocket: string };

/** Everything the rules need to judge a shot. */
export interface ShotLog {
  cueBall: string;
  events: ShotEvent[];
  /** Ball ids pocketed during the shot, in order. */
  pocketed: string[];
  final: BallPosition[];
  /** Simulated duration (s). */
  duration: number;
}

export const toPosition = (b: BallState): BallPosition => ({
  id: b.id,
  x: b.x,
  y: b.y,
  pocketed: b.pocketed,
});

export const restingBall = (p: BallPosition): BallState => ({
  id: p.id,
  x: p.x,
  y: p.y,
  vx: 0,
  vy: 0,
  wx: 0,
  wy: 0,
  wz: 0,
  pocketed: p.pocketed,
});
