import type { PhysicsProfile } from '../config/physics';
import type { CushionSegment, TableGeometry } from './geometry';
import {
  restingBall,
  toPosition,
  type BallPosition,
  type BallState,
  type ShotEvent,
  type ShotInput,
  type ShotLog,
} from './types';

/**
 * Fixed-step billiards simulation.
 *
 * Each step moves balls along straight lines and handles collisions by time of impact (TOI):
 * find the earliest ball–ball or ball–cushion contact inside the step, advance everything to it,
 * resolve it, repeat. Balls therefore never overlap or tunnel, whatever their speed. Cloth
 * friction (sliding → rolling, rolling resistance, side-spin decay) is applied once per step.
 *
 * The class is deterministic: the same initial balls, geometry, profile and input always produce
 * the same events and final positions on the same JS engine.
 */

type Hit =
  | { kind: 'ball'; t: number; i: number; j: number }
  | { kind: 'face'; t: number; i: number; seg: CushionSegment }
  | { kind: 'point'; t: number; i: number; seg: CushionSegment; px: number; py: number };

export class Simulation {
  readonly balls: BallState[];
  readonly events: ShotEvent[] = [];
  readonly pocketed: string[] = [];
  /** Simulated time since the strike (s). */
  time = 0;

  private readonly R: number;
  /** m / I for a solid sphere = 5 / (2R²); impulses below are per unit mass. */
  private readonly mOverI: number;
  /** Horizontal lever arm of the cushion contact, which sits above the ball centre. */
  private readonly cushionArm: number;

  constructor(
    readonly geom: TableGeometry,
    readonly phys: PhysicsProfile,
    balls: readonly (BallState | BallPosition)[],
  ) {
    this.balls = balls.map((b) => ('vx' in b ? { ...b } : restingBall(b)));
    this.R = geom.spec.ball.diameter / 2;
    this.mOverI = 5 / (2 * this.R * this.R);
    const lift = Math.max(0, geom.spec.cushionNoseHeight - this.R);
    this.cushionArm = Math.sqrt(this.R * this.R - lift * lift);
  }

  ball(id: string): BallState {
    const b = this.balls.find((x) => x.id === id);
    if (!b) throw new Error(`unknown ball ${id}`);
    return b;
  }

  /**
   * Apply a cue strike. The cue pushes along c = (d·cos α, −sin α) where α is the elevation; the tip
   * meets the ball at offset e (perpendicular to c). Impulse per unit mass V along c gives
   * ω = k · V · (ê × c) / R with ê = e / R (k = 5/2 for a solid sphere). The bed absorbs the
   * downward part, so the ball leaves at V·cos α along d. Level cue: ω reduces to follow/draw about
   * the horizontal axis and side spin about z. Raised cue with side: part of the spin turns about
   * the travel axis, and cloth friction then bends the path (massé).
   */
  strike(ballId: string, input: ShotInput): void {
    const p = this.phys;
    const b = this.ball(ballId);
    const power = Math.min(1, Math.max(0, input.power));
    const speed = p.minCueSpeed + power * (p.maxCueSpeed - p.minCueSpeed);
    const dx = Math.cos(input.angle);
    const dy = Math.sin(input.angle);
    let sx = input.spinX;
    let sy = input.spinY;
    const sl = Math.hypot(sx, sy);
    if (sl > 1) {
      sx /= sl;
      sy /= sl;
    }
    const elev = (Math.min(p.maxCueElevationDeg, Math.max(0, input.elevation ?? 0)) * Math.PI) / 180;
    const ca = Math.cos(elev);
    const sa = Math.sin(elev);
    // Cue direction c, "right" of the shot (dy, −dx, 0), and "up" perpendicular to the cue.
    const c = [dx * ca, dy * ca, -sa];
    const up = [dx * sa, dy * sa, ca];
    const o = p.maxTipOffset;
    const e = [o * (sx * dy + sy * up[0]), o * (-sx * dx + sy * up[1]), o * sy * up[2]];
    const k = (p.cueSpinFactor * speed) / this.R;
    b.vx = dx * speed * ca;
    b.vy = dy * speed * ca;
    b.wx = k * (e[1] * c[2] - e[2] * c[1]);
    b.wy = k * (e[2] * c[0] - e[0] * c[2]);
    b.wz = k * (e[0] * c[1] - e[1] * c[0]);
  }

  isMoving(): boolean {
    for (const b of this.balls) if (!b.pocketed && (b.vx !== 0 || b.vy !== 0 || b.wx !== 0 || b.wy !== 0)) return true;
    return false;
  }

  /** Advance one fixed time step. Returns whether anything is still moving. */
  step(): boolean {
    const dt = this.phys.timeStep;
    const start = this.time;
    let elapsed = 0;
    let guard = 0;
    for (;;) {
      const hit = this.findEarliest(dt - elapsed);
      if (!hit) {
        this.advance(dt - elapsed);
        break;
      }
      this.advance(hit.t);
      elapsed += hit.t;
      this.time = start + elapsed;
      this.resolve(hit);
      if (++guard >= this.phys.maxCollisionsPerStep) {
        this.advance(dt - elapsed);
        this.separateOverlaps();
        break;
      }
    }
    this.time = start + dt;
    this.capturePockets();
    for (const b of this.balls) if (!b.pocketed) this.applyCloth(b, dt);
    return this.isMoving();
  }

  /** Run until every ball stops (or the safety cap) and return the shot log. */
  run(cueBall: string): ShotLog {
    const maxSteps = Math.ceil(this.phys.maxShotTime / this.phys.timeStep);
    for (let s = 0; s < maxSteps && this.step(); s++);
    this.settle();
    return this.log(cueBall);
  }

  /** Force everything to rest (used when the safety cap is hit or when snapping animations). */
  settle(): void {
    for (const b of this.balls) b.vx = b.vy = b.wx = b.wy = b.wz = 0;
  }

  log(cueBall: string): ShotLog {
    return {
      cueBall,
      events: this.events.slice(),
      pocketed: this.pocketed.slice(),
      final: this.balls.map(toPosition),
      duration: this.time,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Collision detection

  private findEarliest(maxT: number): Hit | null {
    const balls = this.balls;
    const R = this.R;
    const D = 2 * R;
    let best: Hit | null = null;
    let bestT = maxT;

    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.pocketed) continue;
      const aMoving = a.vx !== 0 || a.vy !== 0;

      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.pocketed) continue;
        if (!aMoving && b.vx === 0 && b.vy === 0) continue;
        const t = timeToCircle(b.x - a.x, b.y - a.y, b.vx - a.vx, b.vy - a.vy, D);
        if (t <= bestT) {
          bestT = t;
          best = { kind: 'ball', t, i, j };
        }
      }

      if (!aMoving) continue;
      for (const seg of this.geom.segments) {
        // Face of the segment.
        const vn = a.vx * seg.n.x + a.vy * seg.n.y;
        if (vn < 0) {
          const d = (a.x - seg.a.x) * seg.n.x + (a.y - seg.a.y) * seg.n.y - R;
          if (d > -R) {
            const t = d <= 0 ? 0 : d / -vn;
            if (t <= bestT) {
              const ex = seg.b.x - seg.a.x;
              const ey = seg.b.y - seg.a.y;
              const px = a.x + a.vx * t - seg.a.x;
              const py = a.y + a.vy * t - seg.a.y;
              const u = (px * ex + py * ey) / (ex * ex + ey * ey);
              if (u >= 0 && u <= 1) {
                bestT = t;
                best = { kind: 'face', t, i, seg };
              }
            }
          }
        }
        // Rounded ends (pocket jaw tips and throats).
        for (const p of [seg.a, seg.b]) {
          const t = timeToCircle(p.x - a.x, p.y - a.y, -a.vx, -a.vy, R);
          if (t <= bestT) {
            bestT = t;
            best = { kind: 'point', t, i, seg, px: p.x, py: p.y };
          }
        }
      }
    }
    return best;
  }

  private advance(t: number): void {
    if (t <= 0) return;
    for (const b of this.balls) {
      if (b.pocketed) continue;
      b.x += b.vx * t;
      b.y += b.vy * t;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Collision response

  private resolve(hit: Hit): void {
    if (hit.kind === 'ball') {
      this.resolveBallBall(this.balls[hit.i], this.balls[hit.j]);
      return;
    }
    const b = this.balls[hit.i];
    let nx: number;
    let ny: number;
    if (hit.kind === 'face') {
      nx = hit.seg.n.x;
      ny = hit.seg.n.y;
    } else {
      const dx = b.x - hit.px;
      const dy = b.y - hit.py;
      const l = Math.hypot(dx, dy) || 1;
      nx = dx / l;
      ny = dy / l;
    }
    this.resolveCushion(b, nx, ny, hit.seg.rail);
  }

  private resolveBallBall(a: BallState, b: BallState): void {
    const p = this.phys;
    let nx = b.x - a.x;
    let ny = b.y - a.y;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; // > 0 when approaching
    if (vrel <= 0) return;

    // Normal impulse per unit mass (equal masses share it).
    const jn = ((1 + p.ballBallRestitution) * vrel) / 2;
    a.vx -= jn * nx;
    a.vy -= jn * ny;
    b.vx += jn * nx;
    b.vy += jn * ny;

    // Tangential friction at the contact (throw, side-spin transfer).
    // Slip of a's contact point relative to b's along t = ẑ × n.
    const tx = -ny;
    const ty = nx;
    const slip = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty + this.R * (a.wz + b.wz);
    // Impulse per unit mass that would stop the slip is slip/7 (two balls, solid spheres),
    // limited by Coulomb friction μ·jn.
    const cap = p.ballBallFriction * jn;
    const jf = Math.max(-cap, Math.min(cap, slip / 7));
    a.vx -= jf * tx;
    a.vy -= jf * ty;
    b.vx += jf * tx;
    b.vy += jf * ty;
    const dwz = this.R * jf * this.mOverI;
    a.wz -= dwz;
    b.wz -= dwz;

    this.events.push({ type: 'ballBall', t: this.time, a: a.id, b: b.id, speed: vrel });
  }

  private resolveCushion(b: BallState, nx: number, ny: number, rail: CushionSegment['rail']): void {
    const p = this.phys;
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return;

    // Normal impulse per unit mass.
    const jn = -(1 + p.cushionRestitution) * vn;
    b.vx += jn * nx;
    b.vy += jn * ny;

    // Friction at the cushion nose (above the ball centre). Two slip directions:
    //  - along the rail (t = ẑ × n): side spin makes the contact point slide → bends the rebound.
    //  - vertical: forward roll makes the contact point slide down → cushion kills/reverses roll.
    const tx = -ny;
    const ty = nx;
    const c = this.cushionArm;
    const mOverI = this.mOverI;
    const slipT = b.vx * tx + b.vy * ty - c * b.wz;
    const slipZ = -c * (b.wx * ny - b.wy * nx);
    // Impulse (per unit mass) that would stop each slip on its own.
    let jt = slipT / (1 + c * c * mOverI);
    let jz = slipZ / (c * c * mOverI);
    const cap = p.cushionFriction * jn;
    const mag = Math.hypot(jt, jz);
    if (mag > cap) {
      jt *= cap / mag;
      jz *= cap / mag;
    }
    // Along-rail friction impulse −jt·t acts on velocity and side spin.
    b.vx -= jt * tx;
    b.vy -= jt * ty;
    b.wz += c * jt * mOverI;
    // Vertical friction impulse −jz·ẑ (opposes slipZ) acts on the roll about t.
    b.wx += -c * jz * mOverI * tx;
    b.wy += -c * jz * mOverI * ty;

    this.events.push({ type: 'cushion', t: this.time, ball: b.id, rail, speed: -vn });
  }

  /** Last-resort positional fix if a pathological pile-up exhausted the collision budget. */
  private separateOverlaps(): void {
    const D = 2 * this.R;
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i];
        const b = balls[j];
        if (a.pocketed || b.pocketed) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= D || d === 0) continue;
        const push = (D - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Pockets and cloth

  private capturePockets(): void {
    const pockets = this.geom.pockets;
    if (pockets.length === 0) return;
    const spec = this.geom.spec.pockets!;
    const L = this.geom.length;
    const W = this.geom.width;
    for (const b of this.balls) {
      if (b.pocketed) continue;
      const beyond = Math.max(-b.x, b.x - L, -b.y, b.y - W);
      let nearest = pockets[0];
      let nd = Infinity;
      for (const pk of pockets) {
        const d = Math.hypot(b.x - pk.center.x, b.y - pk.center.y);
        if (d < nd) {
          nd = d;
          nearest = pk;
        }
      }
      if (beyond > spec.captureDepth || nd < nearest.radius) {
        b.pocketed = true;
        b.x = nearest.center.x;
        b.y = nearest.center.y;
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
        this.pocketed.push(b.id);
        this.events.push({ type: 'pocket', t: this.time, ball: b.id, pocket: nearest.id });
      }
    }
  }

  private applyCloth(b: BallState, dt: number): void {
    if (b.vx === 0 && b.vy === 0 && b.wx === 0 && b.wy === 0) {
      b.wz = 0;
      return;
    }
    const p = this.phys;
    const g = p.gravity;
    const R = this.R;

    // Side spin decays independently of the translational state.
    const dwz = ((5 * p.clothSpinFriction * g) / (2 * R)) * dt;
    b.wz = Math.abs(b.wz) <= dwz ? 0 : b.wz - Math.sign(b.wz) * dwz;

    // Velocity of the contact point with the cloth.
    const ux = b.vx - R * b.wy;
    const uy = b.vy + R * b.wx;
    const u = Math.hypot(ux, uy);
    const slipDecel = 3.5 * p.clothSlidingFriction * g; // du/dt for a sliding solid sphere

    if (u > slipDecel * dt) {
      // Sliding: friction opposes the contact slip.
      const k = (p.clothSlidingFriction * g * dt) / u;
      b.vx -= k * ux;
      b.vy -= k * uy;
      b.wx -= (2.5 * k * uy) / R;
      b.wy += (2.5 * k * ux) / R;
      return;
    }

    if (u > 0) {
      // Slip ends inside this step: apply exactly the impulse that removes it, then roll.
      const k = (p.clothSlidingFriction * g * dt * (u / (slipDecel * dt))) / u;
      b.vx -= k * ux;
      b.vy -= k * uy;
    }
    // Rolling: rolling resistance slows the ball, spin follows speed.
    const speed = Math.hypot(b.vx, b.vy);
    const next = speed - p.clothRollingFriction * g * dt;
    if (next <= p.stopSpeed) {
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      return;
    }
    b.vx *= next / speed;
    b.vy *= next / speed;
    b.wx = -b.vy / R;
    b.wy = b.vx / R;
  }
}

/**
 * Earliest t ≥ 0 at which |d + dv·t| = r for a relative position d and velocity dv,
 * only while approaching. Already-touching approaching pairs return 0. Infinity if never.
 */
function timeToCircle(dx: number, dy: number, dvx: number, dvy: number, r: number): number {
  const b = dx * dvx + dy * dvy;
  if (b >= 0) return Infinity;
  const c = dx * dx + dy * dy - r * r;
  if (c <= 0) return 0;
  const a = dvx * dvx + dvy * dvy;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  return (-b - Math.sqrt(disc)) / a;
}

/** Convenience: simulate a whole shot from resting positions. */
export function simulateShot(
  geom: TableGeometry,
  phys: PhysicsProfile,
  balls: readonly BallPosition[],
  cueBall: string,
  input: ShotInput,
): ShotLog {
  const sim = new Simulation(geom, phys, balls);
  sim.strike(cueBall, input);
  return sim.run(cueBall);
}
