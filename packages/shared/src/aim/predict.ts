import type { AimAssistSpec } from '../config/aim';
import type { TableGeometry } from '../physics/geometry';
import type { BallPosition } from '../physics/types';
import type { Vec2 } from '../math/vec';

export interface AimPrediction {
  /** Polyline of the cue ball centre: start, cushion bounces, end. */
  cuePath: Vec2[];
  /** Cue ball position at contact with the first object ball. */
  ghost?: Vec2;
  /** First ball the cue ball would hit. */
  target?: string;
  /** Object ball departure line. */
  objectPath?: [Vec2, Vec2];
  /** Cue ball departure line after the contact (tangent line, stun approximation). */
  deflectPath?: [Vec2, Vec2];
}

interface RayHit {
  t: number;
  kind: 'ball' | 'cushion';
  ball?: BallPosition;
  normal?: Vec2;
}

/** First thing a ball of radius R hits travelling from p along unit direction d. */
function castRay(geom: TableGeometry, balls: readonly BallPosition[], skip: string, p: Vec2, d: Vec2, R: number): RayHit | null {
  let best: RayHit | null = null;
  for (const b of balls) {
    if (b.pocketed || b.id === skip) continue;
    const ox = b.x - p.x;
    const oy = b.y - p.y;
    const proj = ox * d.x + oy * d.y;
    if (proj <= 0) continue;
    const perp2 = ox * ox + oy * oy - proj * proj;
    const r2 = 4 * R * R;
    if (perp2 > r2) continue;
    const t = proj - Math.sqrt(r2 - perp2);
    if (t >= 0 && (!best || t < best.t)) best = { t, kind: 'ball', ball: b };
  }
  for (const seg of geom.segments) {
    const vn = d.x * seg.n.x + d.y * seg.n.y;
    if (vn >= 0) continue;
    const dist = (p.x - seg.a.x) * seg.n.x + (p.y - seg.a.y) * seg.n.y - R;
    if (dist < -1e-9) continue;
    const t = Math.max(0, dist / -vn);
    const ex = seg.b.x - seg.a.x;
    const ey = seg.b.y - seg.a.y;
    const u = ((p.x + d.x * t - seg.a.x) * ex + (p.y + d.y * t - seg.a.y) * ey) / (ex * ex + ey * ey);
    if (u < 0 || u > 1) continue;
    if (!best || t < best.t) best = { t, kind: 'cushion', normal: seg.n };
  }
  return best;
}

/**
 * Aim-assist prediction: straight lines and mirror reflections only (no friction, no spin),
 * which is what players expect from a guide line. The real shot uses the full physics.
 */
export function predictAim(
  geom: TableGeometry,
  balls: readonly BallPosition[],
  cueBall: string,
  angle: number,
  assist: AimAssistSpec,
): AimPrediction {
  const R = geom.spec.ball.diameter / 2;
  const cue = balls.find((b) => b.id === cueBall);
  if (!cue) return { cuePath: [] };
  let p: Vec2 = { x: cue.x, y: cue.y };
  let d: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };
  const path: Vec2[] = [p];
  let remaining = assist.pathLength;
  let bounces = 0;

  for (;;) {
    const hit = castRay(geom, balls, cueBall, p, d, R);
    if (!hit || hit.t >= remaining) {
      path.push({ x: p.x + d.x * remaining, y: p.y + d.y * remaining });
      return { cuePath: path };
    }
    const at = { x: p.x + d.x * hit.t, y: p.y + d.y * hit.t };
    path.push(at);
    remaining -= hit.t;

    if (hit.kind === 'ball' && hit.ball) {
      const b = hit.ball;
      const nx = (b.x - at.x) / (2 * R);
      const ny = (b.y - at.y) / (2 * R);
      const cosCut = Math.max(0, d.x * nx + d.y * ny);
      const tx = d.x - cosCut * nx;
      const ty = d.y - cosCut * ny;
      const tl = Math.hypot(tx, ty);
      const objLen = assist.objectLineLength * (0.25 + 0.75 * cosCut);
      const defLen = assist.deflectLineLength * (0.25 + 0.75 * tl);
      return {
        cuePath: path,
        ghost: at,
        target: b.id,
        objectPath: [
          { x: b.x, y: b.y },
          { x: b.x + nx * objLen, y: b.y + ny * objLen },
        ],
        deflectPath:
          tl > 1e-6
            ? [at, { x: at.x + (tx / tl) * defLen, y: at.y + (ty / tl) * defLen }]
            : undefined,
      };
    }
    if (bounces >= assist.cushionBounces || !hit.normal) return { cuePath: path };
    const n = hit.normal;
    const dn = d.x * n.x + d.y * n.y;
    d = { x: d.x - 2 * dn * n.x, y: d.y - 2 * dn * n.y };
    p = at;
    bounces++;
  }
}
