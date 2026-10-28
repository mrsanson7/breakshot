import * as THREE from 'three';
import type { CushionSegment, Pocket, TableGeometry, Vec2 } from '@breakshot/shared';
import { RENDER3D } from '../config';

export interface TableMeshes {
  group: THREE.Group;
  felt: THREE.MeshStandardMaterial;
  cushion: THREE.MeshStandardMaterial;
  /** Height of the cushion top (m). */
  cushionTop: number;
  /** Height of the rail top (m). */
  railTop: number;
}

export interface TablePalette {
  felt: string;
  cushion: string;
  rail: string;
  diamond: string;
}

const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

/**
 * Bed, cushions (with pocket jaws), wooden rail with pocket cut-outs, diamonds and pocket holes.
 * World frame: x along the table, y across, z up; the bed surface is z = 0.
 */
export function buildTable(geom: TableGeometry, palette: TablePalette): TableMeshes {
  const s = geom.spec;
  const L = geom.length;
  const W = geom.width;
  const cw = s.cushionWidth;
  const rail = s.railWidth;
  const cushionTop = s.cushionNoseHeight;
  const railTop = cushionTop + RENDER3D.railRise;
  const group = new THREE.Group();

  const felt = new THREE.MeshStandardMaterial({ color: palette.felt, roughness: 0.92, metalness: 0 });
  const cushion = new THREE.MeshStandardMaterial({ color: palette.cushion, roughness: 0.9, metalness: 0 });
  const wood = new THREE.MeshStandardMaterial({ color: palette.rail, roughness: 0.45, metalness: 0.05 });
  const hole = new THREE.MeshBasicMaterial({ color: 0x050607 });
  const liner = new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.8, side: THREE.DoubleSide });

  // Bed (felt). Runs under the cushions so no gaps show at the jaws.
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(L + 2 * cw, W + 2 * cw), felt);
  bed.position.set(L / 2, W / 2, 0);
  bed.receiveShadow = true;
  group.add(bed);

  // Cushions.
  const extrude = (shape: THREE.Shape, depth: number) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 28 });
  for (const seg of geom.segments) {
    if (seg.rail === 'jaw') continue;
    const poly = cushionPolygon(seg, geom.segments, cw);
    const mesh = new THREE.Mesh(extrude(new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y))), cushionTop), cushion);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Rail: rounded outer rectangle minus (inner rectangle ∪ pocket circles).
  const outer = new THREE.Shape();
  const r = rail * 0.35;
  const x0 = -rail;
  const y0 = -rail;
  const x1 = L + rail;
  const y1 = W + rail;
  outer.moveTo(x0 + r, y0);
  outer.lineTo(x1 - r, y0);
  outer.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  outer.lineTo(x1, y1 - r);
  outer.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  outer.lineTo(x0 + r, y1);
  outer.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  outer.lineTo(x0, y0 + r);
  outer.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  const inner = railOpening(L, W, cw, geom.pockets);
  outer.holes.push(new THREE.Path(inner.map((p) => new THREE.Vector2(p.x, p.y))));
  const railMesh = new THREE.Mesh(extrude(outer, railTop), wood);
  railMesh.receiveShadow = true;
  group.add(railMesh);

  // Apron below the bed.
  const skirt = new THREE.Mesh(extrude(outer.clone(), RENDER3D.skirtDepth), wood);
  skirt.position.z = -RENDER3D.skirtDepth;
  group.add(skirt);

  // Pockets: a dark hole on the bed plus a liner just inside the rail cut (no z-fighting).
  for (const pk of geom.pockets) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(pk.radius, 40), hole);
    disc.position.set(pk.center.x, pk.center.y, 0.0004);
    group.add(disc);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(pk.radius * 0.985, pk.radius * 0.985, railTop + 0.002, 40, 1, true), liner);
    wall.rotation.x = Math.PI / 2;
    wall.position.set(pk.center.x, pk.center.y, railTop / 2);
    group.add(wall);
  }

  // Diamonds on the rail top.
  const dm = new THREE.MeshStandardMaterial({ color: palette.diamond, roughness: 0.3, metalness: 0.2 });
  const dr = s.diamonds.radius;
  const dShape = new THREE.Shape([new THREE.Vector2(0, dr * 1.4), new THREE.Vector2(dr, 0), new THREE.Vector2(0, -dr * 1.4), new THREE.Vector2(-dr, 0)]);
  const dGeom = new THREE.ShapeGeometry(dShape);
  for (const d of geom.diamonds) {
    const m = new THREE.Mesh(dGeom, dm);
    m.position.set(d.x, d.y, railTop + 0.0006);
    // Long axis across the rail.
    if (d.x < 0 || d.x > L) m.rotation.z = Math.PI / 2;
    group.add(m);
  }

  // Spots (head, centre, foot).
  const spotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
  const spotGeom = new THREE.CircleGeometry(0.004, 16);
  for (const fx of [0.25, 0.5, 0.75]) {
    const m = new THREE.Mesh(spotGeom, spotMat);
    m.position.set(L * fx, W / 2, 0.0003);
    group.add(m);
  }

  return { group, felt, cushion, cushionTop, railTop };
}

/** Cushion cross-section in plan: nose segment, jaw faces, then the back line `cw` behind the nose. */
function cushionPolygon(seg: CushionSegment, all: CushionSegment[], cw: number): Vec2[] {
  const n = seg.n;
  const tx = seg.b.x - seg.a.x;
  const ty = seg.b.y - seg.a.y;
  const tl = Math.hypot(tx, ty);
  const t = { x: tx / tl, y: ty / tl };
  const jawAt = (p: Vec2) => all.find((j) => j.rail === 'jaw' && near(j.a, p));
  // Point pushed straight back from the nose line to the cushion's back line.
  const toBack = (p: Vec2): Vec2 => {
    const depth = (seg.a.x - p.x) * n.x + (seg.a.y - p.y) * n.y;
    const k = cw - depth;
    return { x: p.x - n.x * k, y: p.y - n.y * k };
  };
  const ja = jawAt(seg.a);
  const jb = jawAt(seg.b);
  const pts: Vec2[] = [];
  if (ja) pts.push(toBack(ja.b), ja.b, seg.a);
  else pts.push({ x: seg.a.x - t.x * cw - n.x * cw, y: seg.a.y - t.y * cw - n.y * cw }, seg.a);
  pts.push(seg.b);
  if (jb) pts.push(jb.b, toBack(jb.b));
  else pts.push({ x: seg.b.x + t.x * cw - n.x * cw, y: seg.b.y + t.y * cw - n.y * cw });
  return pts;
}

/**
 * Outline (counter-clockwise) of the rail's inner opening: the rectangle at the cushion back line
 * united with the pocket circles that bite into it.
 */
function railOpening(L: number, W: number, cw: number, pockets: Pocket[]): Vec2[] {
  const corners: Vec2[] = [
    { x: -cw, y: -cw },
    { x: L + cw, y: -cw },
    { x: L + cw, y: W + cw },
    { x: -cw, y: W + cw },
  ];
  type Piece = { a: Vec2; b: Vec2; endCircle: Pocket | null };
  const pieces: Piece[] = [];
  for (let i = 0; i < 4; i++) {
    const p0 = corners[i];
    const p1 = corners[(i + 1) % 4];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const covered: { t0: number; t1: number; pk: Pocket }[] = [];
    for (const pk of pockets) {
      // |p0 + t d − c|² = r²
      const fx = p0.x - pk.center.x;
      const fy = p0.y - pk.center.y;
      const A = dx * dx + dy * dy;
      const B = 2 * (fx * dx + fy * dy);
      const C = fx * fx + fy * fy - pk.radius * pk.radius;
      const disc = B * B - 4 * A * C;
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc);
      const t0 = Math.max(0, (-B - sq) / (2 * A));
      const t1 = Math.min(1, (-B + sq) / (2 * A));
      if (t1 > t0) covered.push({ t0, t1, pk });
    }
    covered.sort((a, b) => a.t0 - b.t0);
    let t = 0;
    for (const c of covered) {
      if (c.t0 > t) pieces.push({ a: lerp(p0, p1, t), b: lerp(p0, p1, c.t0), endCircle: c.pk });
      t = Math.max(t, c.t1);
    }
    if (t < 1) pieces.push({ a: lerp(p0, p1, t), b: p1, endCircle: null });
  }
  const out: Vec2[] = [];
  const push = (p: Vec2) => {
    if (out.length === 0 || !near(out[out.length - 1], p)) out.push(p);
  };
  pieces.forEach((pc, i) => {
    push(pc.a);
    push(pc.b);
    const next = pieces[(i + 1) % pieces.length];
    const c = pc.endCircle;
    if (!c) return;
    // Walk the outside of the pocket circle counter-clockwise to where the next straight piece starts.
    const a0 = Math.atan2(pc.b.y - c.center.y, pc.b.x - c.center.x);
    let a1 = Math.atan2(next.a.y - c.center.y, next.a.x - c.center.x);
    while (a1 <= a0) a1 += Math.PI * 2;
    const steps = Math.max(4, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 48));
    for (let k = 1; k < steps; k++) {
      const a = a0 + ((a1 - a0) * k) / steps;
      push({ x: c.center.x + Math.cos(a) * c.radius, y: c.center.y + Math.sin(a) * c.radius });
    }
  });
  if (out.length > 1 && near(out[0], out[out.length - 1])) out.pop();
  return out;
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
