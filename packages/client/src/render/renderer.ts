import type { AimPrediction, BallDef, BallPosition, TableGeometry, Vec2 } from '@breakshot/shared';
import { View } from './view';

export interface CueOverlay {
  /** Cue ball centre. */
  at: Vec2;
  /** Shot direction (world radians). */
  angle: number;
  /** 0..1 — how far the cue is drawn back (power). */
  pull: number;
  /** Opponent's cue: drawn translucent. */
  ghost?: boolean;
}

export interface PlacementOverlay {
  at: Vec2;
  valid: boolean;
}

export interface FloatingText {
  at: Vec2;
  text: string;
  color: string;
  /** 0..1, fades out towards 1. */
  age: number;
  size?: number;
}

export interface RenderFrame {
  balls: readonly BallPosition[];
  cue?: CueOverlay;
  aim?: AimPrediction;
  placement?: PlacementOverlay;
  /** Ball to outline (the active player's cue ball). */
  highlight?: string;
  texts?: FloatingText[];
  /** Short-lived rings (pocket drop, collisions). */
  rings?: { at: Vec2; age: number; color: string }[];
}

export interface Palette {
  felt: string;
  cushion: string;
  rail: string;
  diamond: string;
}

const CUE_LENGTH = 1.45; // m, drawn length of the cue stick
const CUE_GAP = 0.015; // m, distance between tip and ball at zero power
const CUE_MAX_PULL = 0.3; // m, drawn back-swing at full power

export class TableRenderer {
  readonly view: View;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private ballDefs = new Map<string, BallDef>();
  palette: Palette;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private geom: TableGeometry,
    balls: BallDef[],
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.view = new View(geom);
    this.palette = { ...geom.spec.colors };
    this.setBalls(balls);
  }

  setTable(geom: TableGeometry, balls: BallDef[]): void {
    this.geom = geom;
    this.view.setGeometry(geom);
    this.palette = { ...geom.spec.colors };
    this.setBalls(balls);
    this.resize();
  }

  private setBalls(balls: BallDef[]): void {
    this.ballDefs = new Map(balls.map((b) => [b.id, b]));
  }

  /** Match the canvas backing store to its CSS size. Call on container resize. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.view.fit(rect.width, rect.height);
  }

  private world(): void {
    const [a, b, c, d, e, f] = this.view.matrix();
    const r = this.dpr;
    this.ctx.setTransform(a * r, b * r, c * r, d * r, e * r, f * r);
  }

  private screen(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Pixel size in metres, for hairlines. */
  private get px(): number {
    return 1 / this.view.scale;
  }

  draw(frame: RenderFrame): void {
    const ctx = this.ctx;
    this.screen();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.world();
    this.drawTable();
    if (frame.aim) this.drawAim(frame.aim);
    this.drawBalls(frame.balls, frame.highlight);
    if (frame.placement) this.drawPlacement(frame.placement);
    if (frame.rings) for (const r of frame.rings) this.drawRing(r.at, r.age, r.color);
    if (frame.cue) this.drawCue(frame.cue);
    this.screen();
    this.drawBallNumbers(frame.balls);
    if (frame.texts) for (const t of frame.texts) this.drawFloatingText(t);
  }

  // -------------------------------------------------------------------------------------------
  // Table

  private drawTable(): void {
    const ctx = this.ctx;
    const g = this.geom;
    const s = g.spec;
    const L = g.length;
    const W = g.width;
    const rail = s.railWidth;
    const cw = s.cushionWidth;
    const p = this.palette;

    // Wooden rail.
    ctx.fillStyle = p.rail;
    roundRect(ctx, -rail, -rail, L + 2 * rail, W + 2 * rail, rail * 0.35);
    ctx.fill();
    // Rail inner shading line.
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2 * this.px;
    ctx.strokeRect(-cw, -cw, L + 2 * cw, W + 2 * cw);

    // Cushion band + felt.
    ctx.fillStyle = p.cushion;
    ctx.fillRect(-cw, -cw, L + 2 * cw, W + 2 * cw);
    ctx.fillStyle = p.felt;
    ctx.fillRect(0, 0, L, W);

    // Pocket cut-outs: felt through the mouth, then the hole.
    for (const pk of g.pockets) {
      ctx.fillStyle = p.felt;
      ctx.beginPath();
      ctx.moveTo(pk.tips[0].x, pk.tips[0].y);
      ctx.lineTo(pk.throat[0].x, pk.throat[0].y);
      ctx.lineTo(pk.center.x, pk.center.y);
      ctx.lineTo(pk.throat[1].x, pk.throat[1].y);
      ctx.lineTo(pk.tips[1].x, pk.tips[1].y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#07090b';
      ctx.beginPath();
      ctx.arc(pk.center.x, pk.center.y, pk.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    // Cushion nose line.
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5 * this.px;
    for (const seg of g.segments) {
      ctx.beginPath();
      ctx.moveTo(seg.a.x, seg.a.y);
      ctx.lineTo(seg.b.x, seg.b.y);
      ctx.stroke();
    }

    // Spots and head string (subtle).
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (const fx of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.arc(L * fx, W / 2, 0.004, 0, Math.PI * 2);
      ctx.fill();
    }

    // Diamonds.
    ctx.fillStyle = p.diamond;
    const r = s.diamonds.radius;
    for (const d of g.diamonds) {
      ctx.beginPath();
      ctx.moveTo(d.x, d.y + r * 1.4);
      ctx.lineTo(d.x + r, d.y);
      ctx.lineTo(d.x, d.y - r * 1.4);
      ctx.lineTo(d.x - r, d.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Balls

  private drawBalls(balls: readonly BallPosition[], highlight?: string): void {
    const ctx = this.ctx;
    const R = this.geom.spec.ball.diameter / 2;
    // Light comes from the top-left of the screen whatever the table orientation.
    const lightOffset = (b: Vec2, k: number): Vec2 => {
      const sp = this.view.toScreen(b);
      const d = R * this.view.scale * k;
      return this.view.toWorld({ x: sp.x + d, y: sp.y + d });
    };
    // Shadows first.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (const b of balls) {
      if (b.pocketed) continue;
      const s = lightOffset(b, 0.22);
      ctx.beginPath();
      ctx.arc(s.x, s.y, R * 1.02, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of balls) {
      if (b.pocketed) continue;
      const def = this.ballDefs.get(b.id);
      const color = def?.color ?? '#ccc';
      ctx.save();
      ctx.beginPath();
      ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
      ctx.clip();
      if (def?.stripe) {
        ctx.fillStyle = '#f6f3ea';
        ctx.fillRect(b.x - R, b.y - R, 2 * R, 2 * R);
        ctx.fillStyle = color;
        ctx.fillRect(b.x - R, b.y - R * 0.55, 2 * R, R * 1.1);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(b.x - R, b.y - R, 2 * R, 2 * R);
      }
      // Shading (light from top-left on screen).
      const hl = lightOffset(b, -0.35);
      const g = ctx.createRadialGradient(hl.x, hl.y, R * 0.05, b.x, b.y, R * 1.05);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x - R, b.y - R, 2 * R, 2 * R);
      ctx.restore();
      if (b.id === highlight) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2 * this.px;
        ctx.beginPath();
        ctx.arc(b.x, b.y, R + 3 * this.px, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawBallNumbers(balls: readonly BallPosition[]): void {
    const ctx = this.ctx;
    const R = (this.geom.spec.ball.diameter / 2) * this.view.scale;
    if (R < 6) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(R * 0.85)}px "IBM Plex Sans KR", system-ui, sans-serif`;
    for (const b of balls) {
      if (b.pocketed) continue;
      const n = this.ballDefs.get(b.id)?.number;
      if (n === undefined) continue;
      const p = this.view.toScreen(b);
      ctx.fillStyle = '#f6f3ea';
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.fillText(String(n), p.x, p.y + R * 0.04);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Overlays

  private drawAim(aim: AimPrediction): void {
    const ctx = this.ctx;
    const R = this.geom.spec.ball.diameter / 2;
    ctx.lineCap = 'round';
    // Cue ball path.
    if (aim.cuePath.length > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5 * this.px;
      ctx.setLineDash([6 * this.px, 5 * this.px]);
      ctx.beginPath();
      ctx.moveTo(aim.cuePath[0].x, aim.cuePath[0].y);
      for (const p of aim.cuePath.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (aim.ghost) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5 * this.px;
      ctx.beginPath();
      ctx.arc(aim.ghost.x, aim.ghost.y, R, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Object ball direction.
    if (aim.objectPath) {
      ctx.strokeStyle = 'rgba(255,214,102,0.9)';
      ctx.lineWidth = 2 * this.px;
      ctx.beginPath();
      ctx.moveTo(aim.objectPath[0].x, aim.objectPath[0].y);
      ctx.lineTo(aim.objectPath[1].x, aim.objectPath[1].y);
      ctx.stroke();
    }
    // Cue ball deflection after impact (or after the first cushion).
    if (aim.deflectPath) {
      ctx.strokeStyle = 'rgba(140,200,255,0.9)';
      ctx.lineWidth = 2 * this.px;
      ctx.beginPath();
      ctx.moveTo(aim.deflectPath[0].x, aim.deflectPath[0].y);
      ctx.lineTo(aim.deflectPath[1].x, aim.deflectPath[1].y);
      ctx.stroke();
    }
  }

  private drawCue(cue: CueOverlay): void {
    const ctx = this.ctx;
    const R = this.geom.spec.ball.diameter / 2;
    const dx = Math.cos(cue.angle);
    const dy = Math.sin(cue.angle);
    const back = R + CUE_GAP + cue.pull * CUE_MAX_PULL;
    const tip = { x: cue.at.x - dx * back, y: cue.at.y - dy * back };
    const butt = { x: tip.x - dx * CUE_LENGTH, y: tip.y - dy * CUE_LENGTH };
    ctx.save();
    ctx.globalAlpha = cue.ghost ? 0.45 : 1;
    ctx.lineCap = 'round';
    // Shaft taper approximated by two strokes.
    const grad = ctx.createLinearGradient(tip.x, tip.y, butt.x, butt.y);
    grad.addColorStop(0, '#f3e9d2');
    grad.addColorStop(0.02, '#e9d8b0');
    grad.addColorStop(0.65, '#c99a5b');
    grad.addColorStop(0.66, '#2b1a10');
    grad.addColorStop(1, '#1a0f08');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 0.011;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(butt.x, butt.y);
    ctx.stroke();
    ctx.strokeStyle = '#4fa3ff';
    ctx.lineWidth = 0.011;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - dx * 0.006, tip.y - dy * 0.006);
    ctx.stroke();
    ctx.restore();
  }

  private drawPlacement(p: PlacementOverlay): void {
    const ctx = this.ctx;
    const R = this.geom.spec.ball.diameter / 2;
    ctx.strokeStyle = p.valid ? 'rgba(120,255,160,0.9)' : 'rgba(255,90,100,0.95)';
    ctx.lineWidth = 2 * this.px;
    ctx.setLineDash([4 * this.px, 3 * this.px]);
    ctx.beginPath();
    ctx.arc(p.at.x, p.at.y, R + 4 * this.px, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!p.valid) {
      ctx.beginPath();
      ctx.moveTo(p.at.x - R * 0.6, p.at.y - R * 0.6);
      ctx.lineTo(p.at.x + R * 0.6, p.at.y + R * 0.6);
      ctx.moveTo(p.at.x - R * 0.6, p.at.y + R * 0.6);
      ctx.lineTo(p.at.x + R * 0.6, p.at.y - R * 0.6);
      ctx.stroke();
    }
  }

  private drawRing(at: Vec2, age: number, color: string): void {
    const ctx = this.ctx;
    const R = this.geom.spec.ball.diameter / 2;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * this.px;
    ctx.beginPath();
    ctx.arc(at.x, at.y, R * (1 + age * 2.2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawFloatingText(t: FloatingText): void {
    const ctx = this.ctx;
    const p = this.view.toScreen(t.at);
    const size = t.size ?? 28;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t.age * t.age);
    ctx.font = `${size}px "Black Han Sans", "IBM Plex Sans KR", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    const y = p.y - 30 - t.age * 24;
    ctx.strokeText(t.text, p.x, y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, p.x, y);
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
