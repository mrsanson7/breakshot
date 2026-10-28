import type { TableGeometry, Vec2 } from '@breakshot/shared';

/**
 * Maps table coordinates (metres, y up) to canvas pixels. The table is scaled to fit the canvas
 * and turned upright (long side vertical) when the canvas is taller than it is wide.
 */
export class View {
  /** CSS pixels per metre. */
  scale = 1;
  portrait = false;
  /** Screen position (CSS px) of the world origin. */
  ox = 0;
  oy = 0;
  cssWidth = 0;
  cssHeight = 0;

  constructor(private geom: TableGeometry) {}

  setGeometry(geom: TableGeometry): void {
    this.geom = geom;
  }

  /** Total drawn extent including rails (m). */
  get frame(): number {
    const s = this.geom.spec;
    return s.railWidth;
  }

  fit(cssWidth: number, cssHeight: number, margin = 8): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    const fullL = this.geom.length + 2 * this.frame;
    const fullW = this.geom.width + 2 * this.frame;
    const landscapeScale = Math.min((cssWidth - 2 * margin) / fullL, (cssHeight - 2 * margin) / fullW);
    const portraitScale = Math.min((cssWidth - 2 * margin) / fullW, (cssHeight - 2 * margin) / fullL);
    this.portrait = portraitScale > landscapeScale * 1.15;
    this.scale = Math.max(1, this.portrait ? portraitScale : landscapeScale);
    if (!this.portrait) {
      this.ox = cssWidth / 2 - (this.geom.length / 2) * this.scale;
      this.oy = cssHeight / 2 + (this.geom.width / 2) * this.scale;
    } else {
      this.ox = cssWidth / 2 - (this.geom.width / 2) * this.scale;
      this.oy = cssHeight / 2 - (this.geom.length / 2) * this.scale;
    }
  }

  /** Canvas transform (before devicePixelRatio) that lets drawing code work in metres. */
  matrix(): [number, number, number, number, number, number] {
    const s = this.scale;
    // Landscape: x → right, y → up. Portrait: x → down, y → right (a 90° clockwise turn).
    return this.portrait ? [0, s, s, 0, this.ox, this.oy] : [s, 0, 0, -s, this.ox, this.oy];
  }

  toScreen(p: Vec2): Vec2 {
    const s = this.scale;
    return this.portrait ? { x: this.ox + p.y * s, y: this.oy + p.x * s } : { x: this.ox + p.x * s, y: this.oy - p.y * s };
  }

  toWorld(p: Vec2): Vec2 {
    const s = this.scale;
    return this.portrait
      ? { x: (p.y - this.oy) / s, y: (p.x - this.ox) / s }
      : { x: (p.x - this.ox) / s, y: (this.oy - p.y) / s };
  }

  /** Convert a screen-space angle delta direction to a world angle (for keyboard / drag aim). */
  worldAngleOfScreenVector(dx: number, dy: number): number {
    return this.portrait ? Math.atan2(dx, dy) : Math.atan2(-dy, dx);
  }
}
