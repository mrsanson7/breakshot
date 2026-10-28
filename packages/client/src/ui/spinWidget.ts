import { h } from './dom';

/** Cue-tip widget: click or drag on the ball to set the tip offset; double-click to centre. */
export class SpinWidget {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private x = 0;
  private y = 0;
  private dragging = false;
  enabled = true;

  constructor(private readonly onChange: (x: number, y: number) => void) {
    this.canvas = h('canvas.spin-canvas', { width: 200, height: 200, title: '타점 (W/A/S/D, 더블클릭: 중앙)' });
    this.el = h('div.spin', {}, this.canvas, h('span.spin-label', {}, '타점'));
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.fromPointer(e);
    });
    this.canvas.addEventListener('pointermove', (e) => this.dragging && this.fromPointer(e));
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
    this.canvas.addEventListener('dblclick', () => {
      if (!this.enabled) return;
      this.onChange(0, 0);
    });
    this.draw();
  }

  set(x: number, y: number): void {
    if (x === this.x && y === this.y) return;
    this.x = x;
    this.y = y;
    this.draw();
  }

  private fromPointer(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const rad = r.width * 0.4;
    let x = (e.clientX - cx) / rad;
    let y = -(e.clientY - cy) / rad;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    this.onChange(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  }

  private draw(): void {
    const c = this.canvas.getContext('2d')!;
    const s = this.canvas.width;
    const r = s * 0.4;
    c.clearRect(0, 0, s, s);
    const g = c.createRadialGradient(s * 0.4, s * 0.38, r * 0.1, s / 2, s / 2, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#bdb8aa');
    c.fillStyle = g;
    c.beginPath();
    c.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(s / 2 - r, s / 2);
    c.lineTo(s / 2 + r, s / 2);
    c.moveTo(s / 2, s / 2 - r);
    c.lineTo(s / 2, s / 2 + r);
    c.stroke();
    c.beginPath();
    c.arc(s / 2, s / 2, r * 0.5, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#e8343f';
    c.beginPath();
    c.arc(s / 2 + this.x * r, s / 2 - this.y * r, s * 0.07, 0, Math.PI * 2);
    c.fill();
  }
}
