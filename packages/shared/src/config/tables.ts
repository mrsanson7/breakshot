/**
 * Table and ball specifications. Every physical dimension lives here, in metres and kilograms.
 *
 * Coordinate system used everywhere in shared/: origin at the bottom-left intersection of the
 * cushion noses, x along the long side, y across the table (pointing up on screen), so the
 * playing surface is [0, length] × [0, width].
 *
 * Values marked `TODO(확인 필요)` are best estimates and are listed in README → "확인 필요 목록".
 */

export type TableId = 'pool9ft' | 'caromLarge' | 'caromMedium';

export interface BallSpec {
  /** Ball diameter (m). */
  diameter: number;
  /** Ball mass (kg). */
  mass: number;
}

export interface PocketSpec {
  /** Corner pocket mouth, measured between the two jaw tips (cushion noses) (m). */
  cornerMouth: number;
  /** Side pocket mouth, measured between the two jaw tips (m). */
  sideMouth: number;
  /** Angle between the cushion nose line and the corner jaw face (deg). WPA: 142° ±1. */
  cornerJawAngleDeg: number;
  /** Angle between the cushion nose line and the side jaw face (deg). WPA: 104° ±1. */
  sideJawAngleDeg: number;
  /** Length of the modelled jaw face, from tip towards the pocket throat (m). */
  jawLength: number;
  /**
   * A ball whose centre gets this far beyond the cushion nose line has fallen (m).
   * Only reachable through a pocket mouth because the rails block everywhere else.
   */
  captureDepth: number;
  /** Radius of the drawn pocket hole, also the drop radius around the pocket centre (m). */
  cornerHoleRadius: number;
  sideHoleRadius: number;
  /** How far the pocket centre sits behind the nose line (m), along the pocket axis. */
  cornerHoleOffset: number;
  sideHoleOffset: number;
}

export interface DiamondSpec {
  /** Number of equal divisions along a long rail (diamonds sit on the division points). */
  longDivisions: number;
  /** Number of equal divisions along a short rail. */
  shortDivisions: number;
  /** Distance from the cushion nose to the diamond centre, measured outwards (m). */
  offsetFromNose: number;
  /** Diamond marker radius for drawing (m). */
  radius: number;
}

export interface TableSpec {
  id: TableId;
  /** Display name (Korean UI). */
  name: string;
  /** Playing area, cushion nose to cushion nose (m). */
  length: number;
  width: number;
  /** Height of the cushion contact point above the cloth (m). */
  cushionNoseHeight: number;
  /** Visual width of the cushion rubber + wooden rail drawn around the playing area (m). */
  cushionWidth: number;
  railWidth: number;
  ball: BallSpec;
  pockets: PocketSpec | null;
  diamonds: DiamondSpec;
  /** Default colours (can be overridden in client settings). */
  colors: { felt: string; cushion: string; rail: string; diamond: string };
}

const POOL_BALL: BallSpec = {
  diameter: 0.05715, // WPA: 2 1/4 in (57.15 mm)
  mass: 0.17, // WPA: 5.5–6 oz (156–170 g)
};

const CAROM_BALL: BallSpec = {
  diameter: 0.0615, // UMB: 61–61.5 mm
  mass: 0.21, // UMB: 205–220 g
};

/** Carom tables share the 8 × 4 diamond grid used by 3-cushion systems. */
const CAROM_DIAMONDS: DiamondSpec = {
  longDivisions: 8,
  shortDivisions: 4,
  offsetFromNose: 0.0925, // TODO(확인 필요): depends on rail width; drawn at rail centre
  radius: 0.007,
};

export const TABLES: Record<TableId, TableSpec> = {
  pool9ft: {
    id: 'pool9ft',
    name: 'WPA 9피트',
    length: 2.54, // WPA: 100 in
    width: 1.27, // WPA: 50 in
    cushionNoseHeight: 0.0363, // WPA: 62.5–64.5 % of ball diameter → ~36.3 mm
    cushionWidth: 0.05, // TODO(확인 필요): visual only
    railWidth: 0.11, // TODO(확인 필요): visual only (WPA 4–7.5 in incl. cushion)
    ball: POOL_BALL,
    pockets: {
      cornerMouth: 0.115, // spec: ~115 mm (WPA 4.5–4.625 in)
      sideMouth: 0.125, // spec: ~125 mm (WPA 5–5.125 in)
      cornerJawAngleDeg: 142, // WPA: 142° ±1
      sideJawAngleDeg: 104, // WPA: 104° ±1
      jawLength: 0.05, // TODO(확인 필요): approximates cushion depth
      captureDepth: 0.03, // TODO(확인 필요): tuning value, ~1 ball radius
      cornerHoleRadius: 0.062, // TODO(확인 필요): visual + drop radius
      sideHoleRadius: 0.066, // TODO(확인 필요)
      cornerHoleOffset: 0.035, // TODO(확인 필요)
      sideHoleOffset: 0.04, // TODO(확인 필요)
    },
    diamonds: {
      longDivisions: 8,
      shortDivisions: 4,
      offsetFromNose: 0.08,
      radius: 0.006,
    },
    colors: { felt: '#1f7a4a', cushion: '#17643c', rail: '#5a3a22', diamond: '#f1e6c8' },
  },
  caromLarge: {
    id: 'caromLarge',
    name: '대대 (UMB 매치 테이블)',
    length: 2.84, // UMB: 2840 mm ±5
    width: 1.42, // UMB: 1420 mm ±5
    cushionNoseHeight: 0.037, // UMB: 37 mm ±1
    cushionWidth: 0.05, // visual only
    railWidth: 0.135, // TODO(확인 필요): visual only (UMB rail 120–135 mm incl. cushion)
    ball: CAROM_BALL,
    pockets: null,
    diamonds: CAROM_DIAMONDS,
    colors: { felt: '#2c6bc4', cushion: '#2560b3', rail: '#3a2a20', diamond: '#f4f1e8' },
  },
  caromMedium: {
    id: 'caromMedium',
    name: '중대',
    // TODO(확인 필요): Korean "중대" sizes vary by manufacturer. ~2448 × 1224 mm is a common figure.
    length: 2.448,
    width: 1.224,
    cushionNoseHeight: 0.037, // TODO(확인 필요): assumed same as 대대
    cushionWidth: 0.05,
    railWidth: 0.12,
    // TODO(확인 필요): spec says 61.5 mm; many Korean 4-ball halls use 65.5 mm balls on 중대.
    ball: CAROM_BALL,
    pockets: null,
    diamonds: { ...CAROM_DIAMONDS, offsetFromNose: 0.085 },
    colors: { felt: '#2c6bc4', cushion: '#2560b3', rail: '#3a2a20', diamond: '#f4f1e8' },
  },
};

export const ballRadius = (table: TableSpec): number => table.ball.diameter / 2;
