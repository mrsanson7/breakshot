import type { TableSpec } from '../config/tables';
import type { Vec2 } from '../math/vec';

export type RailId = 'bottom' | 'top' | 'left' | 'right' | 'jaw';

/** A straight cushion face. Balls collide with it as a capsule (segment + rounded ends). */
export interface CushionSegment {
  a: Vec2;
  b: Vec2;
  /** Unit normal pointing into the free (playing) side. */
  n: Vec2;
  rail: RailId;
}

export interface Pocket {
  id: string;
  /** Pocket hole centre (drawn hole + drop zone). */
  center: Vec2;
  radius: number;
  /** The two jaw tips, for drawing the mouth. */
  tips: [Vec2, Vec2];
  /** Jaw face end points (throat), for drawing. */
  throat: [Vec2, Vec2];
}

export interface Diamond {
  x: number;
  y: number;
}

export interface TableGeometry {
  spec: TableSpec;
  length: number;
  width: number;
  segments: CushionSegment[];
  pockets: Pocket[];
  diamonds: Diamond[];
}

const DEG = Math.PI / 180;

function segment(a: Vec2, b: Vec2, rail: RailId, towards: Vec2): CushionSegment {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  let n = { x: -dy / l, y: dx / l };
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if ((towards.x - mx) * n.x + (towards.y - my) * n.y < 0) n = { x: -n.x, y: -n.y };
  return { a, b, n, rail };
}

/**
 * Pocket built in a local frame where the cushion nose runs along +x through the origin and the
 * pocket lies at negative y. `mouth` is the tip-to-tip opening along the rail line for side
 * pockets; corner pockets are built separately because they span two rails.
 */
function rotateFrame(p: Vec2, origin: Vec2, ux: Vec2, uy: Vec2): Vec2 {
  return { x: origin.x + p.x * ux.x + p.y * uy.x, y: origin.y + p.x * ux.y + p.y * uy.y };
}

export function buildTableGeometry(spec: TableSpec): TableGeometry {
  const L = spec.length;
  const W = spec.width;
  const centre = { x: L / 2, y: W / 2 };
  const segments: CushionSegment[] = [];
  const pockets: Pocket[] = [];

  const p = spec.pockets;
  if (!p) {
    segments.push(
      segment({ x: 0, y: 0 }, { x: L, y: 0 }, 'bottom', centre),
      segment({ x: L, y: 0 }, { x: L, y: W }, 'right', centre),
      segment({ x: L, y: W }, { x: 0, y: W }, 'top', centre),
      segment({ x: 0, y: W }, { x: 0, y: 0 }, 'left', centre),
    );
  } else {
    const a = p.cornerMouth / Math.SQRT2; // tip distance from the corner along each rail
    const s = p.sideMouth / 2;
    // Rail segments between pocket tips.
    segments.push(
      segment({ x: a, y: 0 }, { x: L / 2 - s, y: 0 }, 'bottom', centre),
      segment({ x: L / 2 + s, y: 0 }, { x: L - a, y: 0 }, 'bottom', centre),
      segment({ x: a, y: W }, { x: L / 2 - s, y: W }, 'top', centre),
      segment({ x: L / 2 + s, y: W }, { x: L - a, y: W }, 'top', centre),
      segment({ x: 0, y: a }, { x: 0, y: W - a }, 'left', centre),
      segment({ x: L, y: a }, { x: L, y: W - a }, 'right', centre),
    );

    // Corner pockets. Local frame: corner at origin, rails along +x and +y, pocket towards (-,-).
    const cornerJaw = (180 - p.cornerJawAngleDeg) * DEG;
    const corners: { id: string; o: Vec2; ux: Vec2; uy: Vec2 }[] = [
      { id: 'BL', o: { x: 0, y: 0 }, ux: { x: 1, y: 0 }, uy: { x: 0, y: 1 } },
      { id: 'BR', o: { x: L, y: 0 }, ux: { x: -1, y: 0 }, uy: { x: 0, y: 1 } },
      { id: 'TL', o: { x: 0, y: W }, ux: { x: 1, y: 0 }, uy: { x: 0, y: -1 } },
      { id: 'TR', o: { x: L, y: W }, ux: { x: -1, y: 0 }, uy: { x: 0, y: -1 } },
    ];
    for (const c of corners) {
      // Tip on the "x" rail at (a, 0); jaw leaves it at the jaw angle, heading back toward the corner
      // and outwards. Mirror for the "y" rail.
      const tipX = { x: a, y: 0 };
      const endX = { x: a - p.jawLength * Math.cos(cornerJaw), y: -p.jawLength * Math.sin(cornerJaw) };
      const tipY = { x: 0, y: a };
      const endY = { x: -p.jawLength * Math.sin(cornerJaw), y: a - p.jawLength * Math.cos(cornerJaw) };
      const mouthMid = rotateFrame({ x: a / 2, y: a / 2 }, c.o, c.ux, c.uy);
      const t1 = rotateFrame(tipX, c.o, c.ux, c.uy);
      const e1 = rotateFrame(endX, c.o, c.ux, c.uy);
      const t2 = rotateFrame(tipY, c.o, c.ux, c.uy);
      const e2 = rotateFrame(endY, c.o, c.ux, c.uy);
      segments.push(segment(t1, e1, 'jaw', mouthMid), segment(t2, e2, 'jaw', mouthMid));
      const off = p.cornerHoleOffset / Math.SQRT2;
      pockets.push({
        id: c.id,
        center: rotateFrame({ x: -off, y: -off }, c.o, c.ux, c.uy),
        radius: p.cornerHoleRadius,
        tips: [t1, t2],
        throat: [e1, e2],
      });
    }

    // Side pockets. Local frame: rail along +x, pocket at negative y, mouth centred on origin.
    const sideJaw = (180 - p.sideJawAngleDeg) * DEG;
    const sides: { id: string; o: Vec2; ux: Vec2; uy: Vec2 }[] = [
      { id: 'BM', o: { x: L / 2, y: 0 }, ux: { x: 1, y: 0 }, uy: { x: 0, y: 1 } },
      { id: 'TM', o: { x: L / 2, y: W }, ux: { x: 1, y: 0 }, uy: { x: 0, y: -1 } },
    ];
    for (const sd of sides) {
      const tipL = { x: -s, y: 0 };
      const endL = { x: -s + p.jawLength * Math.cos(sideJaw), y: -p.jawLength * Math.sin(sideJaw) };
      const tipR = { x: s, y: 0 };
      const endR = { x: s - p.jawLength * Math.cos(sideJaw), y: -p.jawLength * Math.sin(sideJaw) };
      const mid = rotateFrame({ x: 0, y: 0 }, sd.o, sd.ux, sd.uy);
      const t1 = rotateFrame(tipL, sd.o, sd.ux, sd.uy);
      const e1 = rotateFrame(endL, sd.o, sd.ux, sd.uy);
      const t2 = rotateFrame(tipR, sd.o, sd.ux, sd.uy);
      const e2 = rotateFrame(endR, sd.o, sd.ux, sd.uy);
      segments.push(segment(t1, e1, 'jaw', mid), segment(t2, e2, 'jaw', mid));
      pockets.push({
        id: sd.id,
        center: rotateFrame({ x: 0, y: -p.sideHoleOffset }, sd.o, sd.ux, sd.uy),
        radius: p.sideHoleRadius,
        tips: [t1, t2],
        throat: [e1, e2],
      });
    }
  }

  // Diamonds sit on the division points of each rail, offset outwards from the cushion nose.
  const diamonds: Diamond[] = [];
  const d = spec.diamonds;
  for (let i = 0; i <= d.longDivisions; i++) {
    const x = (L * i) / d.longDivisions;
    if (i === 0 || i === d.longDivisions) continue; // corner points are not marked
    if (p && i === d.longDivisions / 2) continue; // side pocket replaces the centre diamond
    diamonds.push({ x, y: -d.offsetFromNose }, { x, y: W + d.offsetFromNose });
  }
  for (let j = 1; j < d.shortDivisions; j++) {
    const y = (W * j) / d.shortDivisions;
    diamonds.push({ x: -d.offsetFromNose, y }, { x: L + d.offsetFromNose, y });
  }

  return { spec, length: L, width: W, segments, pockets, diamonds };
}
