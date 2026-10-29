import { h } from './dom';

/**
 * Cue elevation widget: a side view of the ball with the cue. Drag the cue up or down to raise or
 * lower it; double-click (double-tap) to lay it level again.
 */
export class ElevationWidget {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private label: HTMLSpanElement;
  private deg = 0;
  private dragging = false;
  enabled = true;

  constructor(
    private readonly maxDeg: number,
    private readonly onChange: (deg: number) => void,
  ) {
    this.canvas = h('canvas.elev-canvas', { width: 200, height: 200, title: '큐 각도: 큐를 위아래로 끌기 (Q/E, 더블클릭: 수평)' });
    this.label = h('span.elev-label', {}, '큐 0°');
    this.el = h('div.elev', {}, this.canvas, this.label);
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.fromPointer(e);
    });
    this.canvas.addEventListener('pointermove', (e) => this.dragging && this.fromPointer(e));
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
    this.canvas.addEventListener('dblclick', () => this.enabled && this.onChange(0));
    this.draw();
  }

  set(deg: number): void {
    if (deg === this.deg) return;
    this.deg = deg;
    this.label.textContent = `큐 ${Math.round(deg)}°`;
    this.draw();
  }

  /** Ball centre in canvas pixels (bottom right, the cue comes in from the left). */
  private get ball(): { x: number; y: number; r: number } {
    const s = this.canvas.width;
    return { x: s * 0.72, y: s * 0.74, r: s * 0.17 };
  }

  private fromPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / rect.width;
    const b = this.ball;
    const px = (e.clientX - rect.left) * k;
    const py = (e.clientY - rect.top) * k;
    const a = (Math.atan2(b.y - py, b.x - px) * 180) / Math.PI;
    this.onChange(Math.round(Math.min(this.maxDeg, Math.max(0, a))));
  }

  private draw(): void {
    const c = this.canvas.getContext('2d')!;
    const s = this.canvas.width;
    const b = this.ball;
    c.clearRect(0, 0, s, s);
    // Bed line.
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(s * 0.04, b.y + b.r);
    c.lineTo(s * 0.96, b.y + b.r);
    c.stroke();
    // Maximum angle guide.
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.setLineDash([8, 8]);
    const m = (this.maxDeg * Math.PI) / 180;
    c.beginPath();
    c.moveTo(b.x, b.y);
    c.lineTo(b.x - Math.cos(m) * s, b.y - Math.sin(m) * s);
    c.stroke();
    c.setLineDash([]);
    // Ball.
    const g = c.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#bdb8aa');
    c.fillStyle = g;
    c.beginPath();
    c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    c.fill();
    // Cue.
    const a = (this.deg * Math.PI) / 180;
    const ux = -Math.cos(a);
    const uy = -Math.sin(a);
    const t0 = b.r * 1.25;
    c.lineCap = 'round';
    c.strokeStyle = '#e2c99a';
    c.lineWidth = s * 0.06;
    c.beginPath();
    c.moveTo(b.x + ux * t0, b.y + uy * t0);
    c.lineTo(b.x + ux * s, b.y + uy * s);
    c.stroke();
    c.strokeStyle = '#3f8fe0';
    c.beginPath();
    c.moveTo(b.x + ux * t0, b.y + uy * t0);
    c.lineTo(b.x + ux * (t0 + s * 0.03), b.y + uy * (t0 + s * 0.03));
    c.stroke();
  }
}
