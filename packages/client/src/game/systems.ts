import { Simulation, type BallPosition, type PhysicsProfile, type ShotInput, type TableGeometry, type Vec2 } from '@breakshot/shared';
import { FIVE_AND_HALF, GUIDE } from '../config';

type Table = readonly (readonly [number, number])[];

/** Piecewise-linear lookup in a [position, value] table (null outside it). */
function valueAt(t: Table, pos: number): number | null {
  const sorted = [...t].sort((a, b) => a[0] - b[0]);
  if (pos < sorted[0][0] - 1e-9 || pos > sorted[sorted.length - 1][0] + 1e-9) return null;
  for (let i = 1; i < sorted.length; i++) {
    const [p0, v0] = sorted[i - 1];
    const [p1, v1] = sorted[i];
    if (pos <= p1 + 1e-9) return v0 + ((v1 - v0) * (pos - p0)) / (p1 - p0);
  }
  return sorted[sorted.length - 1][1];
}

/** Inverse lookup: position for a value (tables are monotonic in value). */
function positionOf(t: Table, value: number): number | null {
  const sorted = [...t].sort((a, b) => a[1] - b[1]);
  if (value < sorted[0][1] - 1e-9 || value > sorted[sorted.length - 1][1] + 1e-9) return null;
  for (let i = 1; i < sorted.length; i++) {
    const [p0, v0] = sorted[i - 1];
    const [p1, v1] = sorted[i];
    if (value <= v1 + 1e-9) return p0 + ((p1 - p0) * (value - v0)) / (v1 - v0);
  }
  return sorted[sorted.length - 1][0];
}

export interface GuideLabel {
  at: Vec2;
  text: string;
  color: string;
  /** Draw at rail height (frame numbers) instead of on the cloth. */
  onRail?: boolean;
  bold?: boolean;
}

export interface SystemReading {
  /** Line from the start frame point through the cue ball to the 1st-rail frame point. */
  line: Vec2[];
  arrival: Vec2 | null;
  start: number | null;
  first: number | null;
  third: number | null;
  labels: GuideLabel[];
  /** Why the system does not apply to this aim, if it does not. */
  note: string | null;
}

const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));

/**
 * 파이브앤하프 for the current aim. The canonical picture (see FIVE_AND_HALF) is mirrored to match
 * the shot: the 1st rail is the long rail the cue ball is heading to, the 2nd rail the short rail
 * at the end it is travelling towards.
 */
export function fiveAndHalf(geom: TableGeometry, cue: Vec2, angle: number): SystemReading {
  const L = geom.length;
  const W = geom.width;
  const d = L / geom.spec.diamonds.longDivisions;
  const dw = W / geom.spec.diamonds.shortDivisions;
  const f = geom.spec.diamonds.offsetFromNose;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  // Canonical → world.
  const xOfV = (v: number) => (sx > 0 ? L - v * d : v * d);
  const yOfU = (u: number) => (sy > 0 ? W - u * dw : u * dw);
  const vOfX = (x: number) => (sx > 0 ? (L - x) / d : x / d);
  const uOfY = (y: number) => (sy > 0 ? (W - y) / dw : y / dw);
  const firstFrameY = sy > 0 ? W + f : -f;
  const startFrameY = sy > 0 ? -f : W + f;
  const shortFrameX = sx > 0 ? -f : L + f;
  const thirdNoseY = sy > 0 ? 0 : W;

  // Rail numbers.
  const labels: GuideLabel[] = [];
  for (const [v, val] of FIVE_AND_HALF.first) labels.push({ at: { x: xOfV(v), y: firstFrameY + sy * f * 0.6 }, text: String(val), color: '#ffd666', onRail: true });
  for (const [v, val] of FIVE_AND_HALF.startLong) labels.push({ at: { x: xOfV(v), y: startFrameY - sy * f * 0.6 }, text: String(val), color: '#8cc8ff', onRail: true });
  for (const [u, val] of FIVE_AND_HALF.startShort) {
    if (u === 4) continue; // the corner is already labelled on the long rail
    labels.push({ at: { x: shortFrameX - sx * f * 0.6, y: yOfU(u) }, text: String(val), color: '#8cc8ff', onRail: true });
  }
  for (const [v, val] of FIVE_AND_HALF.third) labels.push({ at: { x: xOfV(v), y: thirdNoseY + sy * 0.035 }, text: String(val), color: '#ff9ad5' });

  const empty = (note: string): SystemReading => ({ line: [], arrival: null, start: null, first: null, third: null, labels, note });
  if (Math.abs(dy) < 0.05) return empty('장쿠션으로 먼저 가는 샷에만 쓸 수 있어요');

  // Forward: the 1st-rail frame point.
  const tf = (firstFrameY - cue.y) / dy;
  const fx = cue.x + tf * dx;
  const vFirst = vOfX(fx);
  if (vFirst < 0) return empty('단쿠션을 먼저 맞는 샷이에요');
  const first = valueAt(FIVE_AND_HALF.first, vFirst);

  // Backward: the start frame point (long rail or short rail, whichever the line meets first).
  const ty = (startFrameY - cue.y) / dy;
  const tx = Math.abs(dx) > 1e-9 ? (shortFrameX - cue.x) / dx : -Infinity;
  let start: number | null;
  let startPt: Vec2;
  if (ty >= tx) {
    startPt = { x: cue.x + ty * dx, y: startFrameY };
    start = valueAt(FIVE_AND_HALF.startLong, vOfX(startPt.x));
  } else {
    startPt = { x: shortFrameX, y: cue.y + tx * dy };
    start = valueAt(FIVE_AND_HALF.startShort, uOfY(startPt.y));
  }
  const line = [startPt, { x: fx, y: firstFrameY }];
  if (first === null) return { ...empty('1쿠션 지점이 표 밖이에요'), line };
  if (start === null) return { ...empty('출발 지점이 표 밖이에요'), line, first };
  const third = start - first;
  const vThird = positionOf(FIVE_AND_HALF.third, third);
  const arrival = vThird === null ? null : { x: xOfV(vThird), y: thirdNoseY };
  labels.push(
    { at: { x: startPt.x, y: startPt.y - sy * f * 1.6 }, text: `출발 ${fmt(start)}`, color: '#8cc8ff', onRail: true, bold: true },
    { at: { x: fx, y: firstFrameY + sy * f * 1.6 }, text: `1쿠션 ${fmt(first)}`, color: '#ffd666', onRail: true, bold: true },
  );
  if (arrival) labels.push({ at: { x: arrival.x, y: arrival.y + sy * 0.09 }, text: `3쿠션 ${fmt(third)}`, color: '#ff9ad5', bold: true });
  return { line, arrival, start, first, third, labels, note: arrival ? null : '3쿠션 값이 표 밖이에요' };
}

export interface Trajectory {
  path: Vec2[];
  /** Where the cue ball touched a cushion, in order. */
  cushions: Vec2[];
}

/** Where the cue ball would really go with this input (practice only: the same physics as the game). */
export function cueTrajectory(geom: TableGeometry, phys: PhysicsProfile, balls: readonly BallPosition[], cueBall: string, input: ShotInput): Trajectory {
  const sim = new Simulation(geom, phys, balls);
  sim.strike(cueBall, input);
  const b = sim.ball(cueBall);
  const path: Vec2[] = [{ x: b.x, y: b.y }];
  const cushions: Vec2[] = [];
  let seen = 0;
  let step = 0;
  const maxSteps = GUIDE.maxSeconds / phys.timeStep;
  while (step++ < maxSteps) {
    const moving = sim.step();
    for (; seen < sim.events.length; seen++) {
      const e = sim.events[seen];
      if (e.type === 'cushion' && e.ball === cueBall) cushions.push({ x: b.x, y: b.y });
    }
    if (step % GUIDE.sampleEvery === 0 || !moving) path.push({ x: b.x, y: b.y });
    if (!moving || b.pocketed || cushions.length >= GUIDE.maxCushions) break;
  }
  path.push({ x: b.x, y: b.y });
  return { path, cushions };
}

