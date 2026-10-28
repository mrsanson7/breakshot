import { LAYOUT } from '../config/layouts';
import type { TableGeometry } from '../physics/geometry';
import type { BallPosition } from '../physics/types';
import type { Vec2 } from '../math/vec';

/** Where a ball-in-hand cue ball may be placed. 'kitchen' = behind the head string. */
export type PlacementRegion = 'anywhere' | 'kitchen';

/**
 * A cue ball may be placed where it lies fully on the cloth (not over a pocket) and does not
 * touch any other ball.
 */
export function isValidPlacement(
  geom: TableGeometry,
  balls: readonly BallPosition[],
  cueBall: string,
  pos: Vec2,
  region: PlacementRegion,
): boolean {
  const R = geom.spec.ball.diameter / 2;
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
  if (pos.x < R || pos.x > geom.length - R || pos.y < R || pos.y > geom.width - R) return false;
  if (region === 'kitchen' && pos.x > geom.length * LAYOUT.headStringX) return false;
  for (const pk of geom.pockets) {
    if (Math.hypot(pos.x - pk.center.x, pos.y - pk.center.y) < pk.radius + R) return false;
  }
  for (const b of balls) {
    if (b.pocketed || b.id === cueBall) continue;
    if (Math.hypot(pos.x - b.x, pos.y - b.y) < 2 * R) return false;
  }
  return true;
}

/** Clamp a dragged position into the allowed rectangle (overlaps are still reported invalid). */
export function clampPlacement(geom: TableGeometry, pos: Vec2, region: PlacementRegion): Vec2 {
  const R = geom.spec.ball.diameter / 2;
  const maxX = region === 'kitchen' ? geom.length * LAYOUT.headStringX : geom.length - R;
  return {
    x: Math.min(maxX, Math.max(R, pos.x)),
    y: Math.min(geom.width - R, Math.max(R, pos.y)),
  };
}
