import { h } from './dom';

/**
 * Power gauge. Shows the pull-back power while aiming with the mouse; on touch screens it is
 * also the shooting control: drag down along the bar to set power, release to shoot.
 */
export class PowerBar {
  readonly el: HTMLDivElement;
  private fill: HTMLDivElement;
  private label: HTMLSpanElement;
  private dragging = false;
  private value = 0;
  enabled = true;

  constructor(private readonly handlers: { onDrag(power: number): void; onRelease(power: number): void }) {
    this.fill = h('div.power-fill');
    this.label = h('span.power-label', {}, '0%');
    const track = h('div.power-track', { title: '마우스: 테이블을 누른 채 뒤로 당겼다 놓기 · 터치: 이 막대를 아래로 끌었다 놓기' }, this.fill);
    this.el = h('div.power', {}, h('span.power-title', {}, '파워'), track, this.label);
    track.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.dragging = true;
      track.setPointerCapture(e.pointerId);
      this.fromPointer(track, e);
    });
    track.addEventListener('pointermove', (e) => this.dragging && this.fromPointer(track, e));
    track.addEventListener('pointerup', () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.handlers.onRelease(this.value);
    });
    track.addEventListener('pointercancel', () => {
      this.dragging = false;
      this.handlers.onDrag(0);
    });
  }

  set(power: number): void {
    this.value = power;
    this.fill.style.height = `${Math.round(power * 100)}%`;
    this.label.textContent = `${Math.round(power * 100)}%`;
  }

  private fromPointer(track: HTMLElement, e: PointerEvent): void {
    const r = track.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    this.set(p);
    this.handlers.onDrag(p);
  }
}
