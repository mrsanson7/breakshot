import { LAYOUT } from '../config/layouts';
import type { PhysicsProfile } from '../config/physics';
import type { TableGeometry } from '../physics/geometry';
import { simulateShot } from '../physics/simulation';
import type { BallPosition, ShotInput } from '../physics/types';
import type { Seat } from './state';

/**
 * Lag (뱅킹) for the opening break: each player shoots their own ball from the head string to the
 * foot cushion and back; the ball that stops closest to the head cushion wins the break.
 * Each lag is simulated on its own (no interference between the two balls).
 */
export function lagBallId(seat: Seat, carom: boolean): string {
  if (carom) return seat === 0 ? 'white' : 'yellow';
  return seat === 0 ? 'cue' : 'lag';
}

export function lagStart(geom: TableGeometry, seat: Seat, carom: boolean): BallPosition {
  return {
    id: lagBallId(seat, carom),
    x: geom.length * LAYOUT.headStringX,
    y: geom.width * LAYOUT.centreY + (seat === 0 ? -1 : 1) * LAYOUT.lagOffset,
    pocketed: false,
  };
}

/** Returns the final ball and its distance from the head cushion, or null distance if invalid. */
export function simulateLag(geom: TableGeometry, phys: PhysicsProfile, start: BallPosition, input: ShotInput) {
  const log = simulateShot(geom, phys, [start], start.id, input);
  const final = log.final[0];
  const touchedFoot = log.events.some((e) => e.type === 'cushion' && e.rail === 'right');
  const valid = touchedFoot && !final.pocketed;
  return { final, distance: valid ? final.x : null };
}

/** Lag winner (breaks first), or null for a re-lag (tie or both invalid). */
export function lagWinner(d0: number | null, d1: number | null): Seat | null {
  if (d0 === null && d1 === null) return null;
  if (d0 === null) return 1;
  if (d1 === null) return 0;
  if (d0 === d1) return null;
  return d0 < d1 ? 0 : 1;
}
