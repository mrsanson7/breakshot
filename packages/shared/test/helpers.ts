import {
  buildTableGeometry,
  PHYSICS,
  TABLES,
  type BallPosition,
  type BallState,
  type TableId,
  type PhysicsProfileId,
} from '../src';

export function setup(table: TableId, profile: PhysicsProfileId) {
  const spec = TABLES[table];
  return { spec, geom: buildTableGeometry(spec), phys: PHYSICS[profile], R: spec.ball.diameter / 2 };
}

export const ball = (id: string, x: number, y: number): BallPosition => ({ id, x, y, pocketed: false });

export function kineticEnergy(balls: BallState[], mass: number, R: number): number {
  const I = 0.4 * mass * R * R;
  let e = 0;
  for (const b of balls) {
    if (b.pocketed) continue;
    e += 0.5 * mass * (b.vx * b.vx + b.vy * b.vy) + 0.5 * I * (b.wx * b.wx + b.wy * b.wy + b.wz * b.wz);
  }
  return e;
}
