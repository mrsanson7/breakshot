import { describe, expect, it } from 'vitest';
import { createRng, eightBallRack, Simulation, simulateShot, type ShotInput } from '../src';
import { ball, kineticEnergy, setup } from './helpers';

const shot = (angle: number, power: number, spinX = 0, spinY = 0): ShotInput => ({ angle, power, spinX, spinY });

describe('physics: basics', () => {
  it('a struck ball slides, starts rolling, then stops inside the table', () => {
    const { geom, phys, R } = setup('caromLarge', 'carom');
    const sim = new Simulation(geom, phys, [ball('white', 0.5, 0.71)]);
    sim.strike('white', shot(0, 0.15));
    const b = sim.ball('white');
    expect(b.vx).toBeGreaterThan(0);
    expect(b.wy).toBe(0); // centre-ball hit: no spin yet, pure slide
    let rolledAt = -1;
    while (sim.step()) {
      const slip = Math.hypot(b.vx - R * b.wy, b.vy + R * b.wx);
      if (rolledAt < 0 && slip < 1e-9 && b.vx > 0) rolledAt = sim.time;
    }
    expect(rolledAt).toBeGreaterThan(0);
    expect(b.vx).toBe(0);
    expect(b.x).toBeGreaterThan(0.5);
    expect(b.x).toBeLessThan(geom.length - R);
  });

  it('after sliding ends the ball keeps 5/7 of a stun speed (solid sphere)', () => {
    const { geom, phys } = setup('caromLarge', 'carom');
    const sim = new Simulation(geom, phys, [ball('white', 0.3, 0.71)]);
    sim.strike('white', shot(0, 0.2));
    const v0 = sim.ball('white').vx;
    const R = geom.spec.ball.diameter / 2;
    // Step until rolling.
    let v = v0;
    for (let i = 0; i < 2000; i++) {
      sim.step();
      const b = sim.ball('white');
      if (Math.abs(b.vx - R * b.wy) < 1e-9) {
        v = b.vx;
        break;
      }
    }
    // Rolling resistance acts only once rolling, so the ratio is very close to 5/7.
    expect(v / v0).toBeCloseTo(5 / 7, 2);
  });

  it('total kinetic energy never increases', () => {
    const { geom, phys, spec, R } = setup('pool9ft', 'pool');
    const balls = eightBallRack(spec, createRng(7), phys.rackGap);
    const sim = new Simulation(geom, phys, balls);
    sim.strike('cue', shot(0.01, 1, 0.3, -0.4));
    let prev = kineticEnergy(sim.balls, spec.ball.mass, R);
    while (sim.step()) {
      const e = kineticEnergy(sim.balls, spec.ball.mass, R);
      expect(e).toBeLessThanOrEqual(prev + 1e-9);
      prev = e;
    }
  });
});

describe('physics: no overlap, no tunnelling', () => {
  /** Smallest pair gap and largest excursion beyond the cushion lines seen so far. */
  function worst(sim: Simulation, R: number, L: number, W: number, acc: { gap: number; out: number }) {
    const live = sim.balls.filter((b) => !b.pocketed);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const d = Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y) - 2 * R;
        if (d < acc.gap) acc.gap = d;
      }
      const b = live[i];
      const out = Math.max(R - b.x, b.x - (L - R), R - b.y, b.y - (W - R));
      if (out > acc.out) acc.out = out;
    }
  }

  it('full-power pool break keeps every ball separated', () => {
    const { geom, phys, spec, R } = setup('pool9ft', 'pool');
    for (let seed = 1; seed <= 5; seed++) {
      const sim = new Simulation(geom, phys, eightBallRack(spec, createRng(seed), phys.rackGap));
      sim.strike('cue', shot((seed - 3) * 0.002, 1));
      const acc = { gap: Infinity, out: -Infinity };
      let steps = 0;
      while (sim.step()) {
        worst(sim, R, geom.length, geom.width, acc);
        steps++;
      }
      expect(acc.gap).toBeGreaterThan(-1e-9);
      expect(steps).toBeGreaterThan(100);
      expect(sim.events.filter((e) => e.type === 'ballBall').length).toBeGreaterThan(10);
    }
  });

  it('random max-power carom shots never leave the cushions or overlap', () => {
    const { geom, phys, R } = setup('caromLarge', 'carom');
    const rng = createRng(42);
    for (let k = 0; k < 25; k++) {
      const sim = new Simulation(geom, phys, [
        ball('white', 0.3 + rng() * 2.2, 0.1 + rng() * 1.2),
        ball('yellow', 0.71, 0.71),
        ball('red', 2.13, 0.71),
      ]);
      // Skip setups that start overlapped.
      const [a, b, c] = sim.balls;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 2 * R || Math.hypot(a.x - c.x, a.y - c.y) < 2 * R) continue;
      sim.strike('white', shot(rng() * Math.PI * 2, 1, rng() * 2 - 1, rng() * 2 - 1));
      const acc = { gap: Infinity, out: -Infinity };
      while (sim.step()) worst(sim, R, geom.length, geom.width, acc);
      expect(acc.gap).toBeGreaterThan(-1e-9);
      expect(acc.out).toBeLessThan(1e-9);
    }
  });

  it('a max-speed ball cannot skip through a ball it is about to hit', () => {
    const { geom, phys, R } = setup('caromLarge', 'carom');
    // Gap smaller than one step of travel at max speed.
    const gap = phys.maxCueSpeed * phys.timeStep * 0.5;
    const log = simulateShot(geom, phys, [ball('white', 1, 0.71), ball('red', 1 + 2 * R + gap, 0.71)], 'white', shot(0, 1));
    expect(log.events.find((e) => e.type === 'ballBall')).toBeTruthy();
  });
});

describe('physics: determinism', () => {
  it('same start + same input → identical shot log', () => {
    const { geom, phys, spec } = setup('pool9ft', 'pool');
    const rack = eightBallRack(spec, createRng(3), phys.rackGap);
    const input = shot(0.004, 0.93, -0.2, 0.35);
    const a = simulateShot(geom, phys, rack, 'cue', input);
    const b = simulateShot(geom, phys, rack, 'cue', input);
    expect(b).toEqual(a);
    expect(a.final).toHaveLength(16);
  });
});

describe('physics: spin', () => {
  const { geom, phys, R } = setup('caromLarge', 'carom');
  /** Full hit on a ball 0.6 m away; cue ball velocity 0.3 s after the impact. */
  const afterFullHit = (spinY: number, distance = 0.6, power = 0.35) => {
    const sim = new Simulation(geom, phys, [ball('white', 0.8, 0.71), ball('red', 0.8 + distance, 0.71)]);
    sim.strike('white', shot(0, power, 0, spinY));
    while (!sim.events.some((e) => e.type === 'ballBall')) sim.step();
    const vAtImpact = Math.abs(sim.ball('red').vx);
    const until = sim.time + 0.3;
    while (sim.time < until) sim.step();
    return { vx: sim.ball('white').vx, vAtImpact };
  };

  it('follow keeps the cue ball going forward after a full hit', () => {
    expect(afterFullHit(0.9).vx).toBeGreaterThan(0.1);
  });

  it('draw brings the cue ball back after a full hit', () => {
    expect(afterFullHit(-0.9).vx).toBeLessThan(-0.1);
  });

  it('stun (centre ball, short distance) leaves the cue ball almost dead', () => {
    const { vx, vAtImpact } = afterFullHit(0, 0.1, 0.3);
    expect(Math.abs(vx)).toBeLessThan(vAtImpact * 0.06);
  });

  /** Fire straight into the top cushion with side spin and return where it comes back. */
  const bankRebound = (spinX: number) => {
    const sim = new Simulation(geom, phys, [ball('white', 1.42, 0.9)]);
    sim.strike('white', shot(Math.PI / 2, 0.3, spinX, 0));
    let afterCushion: { vx: number; vy: number } | null = null;
    while (sim.step()) {
      if (!afterCushion && sim.events.some((e) => e.type === 'cushion')) {
        const b = sim.ball('white');
        afterCushion = { vx: b.vx, vy: b.vy };
      }
    }
    return afterCushion!;
  };

  it('side spin changes the cushion rebound angle (right english → bends right)', () => {
    const none = bankRebound(0);
    const right = bankRebound(0.9);
    const left = bankRebound(-0.9);
    expect(Math.abs(none.vx)).toBeLessThan(1e-9);
    expect(right.vx).toBeGreaterThan(0.1);
    expect(left.vx).toBeLessThan(-0.1);
    expect(right.vy).toBeLessThan(0);
    // Symmetric.
    expect(right.vx).toBeCloseTo(-left.vx, 9);
  });

  it('running english lengthens an angled rebound, reverse english shortens it', () => {
    const angled = (spinX: number) => {
      const sim = new Simulation(geom, phys, [ball('white', 1.0, 0.5)]);
      // 45° towards the top rail, moving right; right english is "running" for this path.
      sim.strike('white', shot(Math.PI / 4, 0.4, spinX, 0));
      while (!sim.events.some((e) => e.type === 'cushion')) sim.step();
      const b = sim.ball('white');
      return Math.atan2(-b.vy, b.vx); // rebound angle measured from the rail
    };
    const neutral = angled(0);
    expect(angled(0.8)).toBeLessThan(neutral); // flatter, runs longer along the rail
    expect(angled(-0.8)).toBeGreaterThan(neutral);
  });
});

describe('physics: cushions, pockets and the shot log', () => {
  it('logs cushion contacts in order with the rail id', () => {
    const { geom, phys } = setup('caromLarge', 'carom');
    const log = simulateShot(geom, phys, [ball('white', 1.42, 0.71)], 'white', shot(Math.PI / 2 - 0.3, 0.6));
    const rails = log.events.filter((e) => e.type === 'cushion').map((e) => (e as { rail: string }).rail);
    expect(rails[0]).toBe('top');
    expect(rails.length).toBeGreaterThanOrEqual(3);
    const times = log.events.map((e) => e.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('pockets a ball sent straight into a corner pocket', () => {
    const { geom, phys } = setup('pool9ft', 'pool');
    const log = simulateShot(geom, phys, [ball('cue', 0.5, 0.5)], 'cue', shot(-3 * Math.PI / 4, 0.3));
    expect(log.pocketed).toEqual(['cue']);
    const ev = log.events.find((e) => e.type === 'pocket');
    expect(ev && ev.type === 'pocket' && ev.pocket).toBe('BL');
  });

  it('pockets a ball sent straight into a side pocket', () => {
    const { geom, phys } = setup('pool9ft', 'pool');
    const log = simulateShot(geom, phys, [ball('cue', 1.27, 0.6)], 'cue', shot(-Math.PI / 2, 0.3));
    expect(log.pocketed).toEqual(['cue']);
  });

  it('a ball rolling along the long rail past a corner jaw rebounds instead of falling through the rail', () => {
    const { geom, phys, R } = setup('pool9ft', 'pool');
    // Parallel to the bottom rail, two radii above it: misses the jaws, hits the short rail.
    const log = simulateShot(geom, phys, [ball('cue', 1.0, 3 * R + 0.07)], 'cue', shot(0, 0.4));
    expect(log.pocketed).toEqual([]);
    expect(log.events.some((e) => e.type === 'cushion' && e.rail === 'right')).toBe(true);
  });

  it('every shot ends within the time cap', () => {
    const { geom, phys } = setup('caromLarge', 'carom');
    const log = simulateShot(geom, phys, [ball('white', 0.3, 0.3)], 'white', shot(0.4, 1, 0.5, 0.5));
    expect(log.duration).toBeLessThan(phys.maxShotTime);
    expect(log.duration).toBeGreaterThan(1);
  });
});
