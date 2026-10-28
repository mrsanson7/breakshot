import { clampPlacement, isValidPlacement, type BallPosition, type PlacementRegion, type TableGeometry, type Vec2 } from '@breakshot/shared';
import { CONTROLS } from '../config';
import type { View } from '../render/view';

export interface AimState {
  angle: number;
  /** 0..1 while the player is pulling back, else 0. */
  power: number;
  spinX: number;
  spinY: number;
  /** Ball-in-hand position being dragged (null when not placing). */
  placing: Vec2 | null;
  placementValid: boolean;
}

export interface AimContext {
  geom: TableGeometry;
  balls: readonly BallPosition[];
  cueBall: string;
  /** Present when the player has ball in hand. */
  ballInHand: PlacementRegion | null;
}

export interface AimCallbacks {
  /** Aim, power, spin or placement changed (used for drawing and online preview). */
  onChange(state: AimState): void;
  /** The player released the cue. */
  onShoot(state: AimState): void;
}

const DEG = Math.PI / 180;

/**
 * Mouse / pointer and keyboard aiming:
 *  - move: aim at the pointer
 *  - press and pull back, release: shoot (power ∝ pull distance)
 *  - ball in hand: press on the cue ball and drag to place it
 *  - arrow keys: fine aim (0.1°, Shift = 1°); W/A/S/D: spin; Esc / right click: cancel
 */
export class AimController {
  state: AimState = { angle: 0, power: 0, spinX: 0, spinY: 0, placing: null, placementValid: true };
  private enabled = false;
  private ctx: AimContext | null = null;
  private pull: { start: Vec2; pointer: number } | null = null;
  private dragPointer: number | null = null;
  /** Touch / pen: the pointer currently aiming (power comes from the on-screen slider). */
  private touchAim: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: View,
    private readonly cb: AimCallbacks,
  ) {
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.cancel();
    });
    window.addEventListener('keydown', this.onKey);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    window.removeEventListener('keydown', this.onKey);
  }

  /** Enable input for a turn. Keeps the previous aim angle and spin for convenience. */
  enable(ctx: AimContext): void {
    this.ctx = ctx;
    this.enabled = true;
    this.pull = null;
    this.state.power = 0;
    if (ctx.ballInHand) {
      const cue = ctx.balls.find((b) => b.id === ctx.cueBall);
      const start = cue && !cue.pocketed ? { x: cue.x, y: cue.y } : clampPlacement(ctx.geom, { x: ctx.geom.length * 0.25, y: ctx.geom.width / 2 }, ctx.ballInHand);
      this.state.placing = start;
      this.state.placementValid = isValidPlacement(ctx.geom, ctx.balls, ctx.cueBall, start, ctx.ballInHand);
    } else {
      this.state.placing = null;
      this.state.placementValid = true;
    }
    this.canvas.style.cursor = 'crosshair';
    this.emit();
  }

  disable(): void {
    this.enabled = false;
    this.pull = null;
    this.state.power = 0;
    this.canvas.style.cursor = 'default';
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setSpin(x: number, y: number): void {
    const l = Math.hypot(x, y);
    this.state.spinX = l > 1 ? x / l : x;
    this.state.spinY = l > 1 ? y / l : y;
    this.emit();
  }

  setPower(power: number): void {
    this.state.power = Math.max(0, Math.min(1, power));
    this.emit();
  }

  /** Rotate the aim by `deg` (on-screen fine-aim buttons). */
  nudge(deg: number): void {
    if (!this.enabled) return;
    this.state.angle += deg * DEG;
    this.emit();
  }

  /** Shoot with the current aim at the given power (used by the touch power slider). */
  shootWithPower(power: number): void {
    if (!this.enabled || (this.state.placing && !this.state.placementValid)) return;
    if (power < CONTROLS.minShotPower) {
      this.setPower(0);
      return;
    }
    this.state.power = power;
    this.fire();
  }

  /** Cue ball position used for aiming (placement position during ball in hand). */
  cuePosition(): Vec2 | null {
    if (!this.ctx) return null;
    if (this.state.placing) return this.state.placing;
    const cue = this.ctx.balls.find((b) => b.id === this.ctx!.cueBall);
    return cue && !cue.pocketed ? { x: cue.x, y: cue.y } : null;
  }

  private emit(): void {
    this.cb.onChange({ ...this.state, placing: this.state.placing ? { ...this.state.placing } : null });
  }

  private pointerWorld(e: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return this.view.toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  private onMove = (e: PointerEvent): void => {
    if (!this.enabled || !this.ctx) return;
    const w = this.pointerWorld(e);
    if (this.dragPointer === e.pointerId && this.state.placing && this.ctx.ballInHand) {
      const p = clampPlacement(this.ctx.geom, w, this.ctx.ballInHand);
      this.state.placing = p;
      this.state.placementValid = isValidPlacement(this.ctx.geom, this.ctx.balls, this.ctx.cueBall, p, this.ctx.ballInHand);
      this.emit();
      return;
    }
    if (this.pull && this.pull.pointer === e.pointerId) {
      // Power = how far the pointer moved backwards along the aim line (in screen pixels).
      const a = this.view.toScreen(this.pull.start);
      const b = this.view.toScreen(w);
      const dir = this.view.toScreen({ x: Math.cos(this.state.angle), y: Math.sin(this.state.angle) });
      const o = this.view.toScreen({ x: 0, y: 0 });
      const dx = dir.x - o.x;
      const dy = dir.y - o.y;
      const dl = Math.hypot(dx, dy) || 1;
      const back = -((b.x - a.x) * dx + (b.y - a.y) * dy) / dl;
      this.state.power = Math.max(0, Math.min(1, back / CONTROLS.pullPixelsForFullPower));
      this.emit();
      return;
    }
    if (e.pointerType === 'mouse' || this.touchAim === e.pointerId) this.aimAt(w);
  };

  private aimAt(w: Vec2): void {
    const cue = this.cuePosition();
    if (!cue) return;
    const dx = w.x - cue.x;
    const dy = w.y - cue.y;
    if (Math.hypot(dx, dy) < 1e-4) return;
    this.state.angle = Math.atan2(dy, dx);
    this.emit();
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled || !this.ctx || e.button > 0) return;
    const w = this.pointerWorld(e);
    const R = this.ctx.geom.spec.ball.diameter / 2;
    const cue = this.cuePosition();
    this.canvas.setPointerCapture(e.pointerId);
    if (this.state.placing && cue && Math.hypot(w.x - cue.x, w.y - cue.y) < R * CONTROLS.pickRadiusFactor) {
      this.dragPointer = e.pointerId;
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.pointerType !== 'mouse') {
      // Touch: a tap/drag on the table aims at the finger; power comes from the power slider.
      this.aimAt(w);
      this.dragPointer = null;
      this.touchAim = e.pointerId;
      return;
    }
    if (this.state.placing && !this.state.placementValid) return;
    this.pull = { start: w, pointer: e.pointerId };
    this.state.power = 0;
    this.emit();
  };

  private onUp = (e: PointerEvent): void => {
    if (this.dragPointer === e.pointerId) {
      this.dragPointer = null;
      this.canvas.style.cursor = 'crosshair';
      return;
    }
    if (this.touchAim === e.pointerId) {
      this.touchAim = null;
      return;
    }
    if (!this.pull || this.pull.pointer !== e.pointerId) return;
    this.pull = null;
    if (!this.enabled) return;
    if (this.state.power < CONTROLS.minShotPower) {
      this.state.power = 0;
      this.emit();
      return;
    }
    this.fire();
  };

  private fire(): void {
    const snapshot = { ...this.state, placing: this.state.placing ? { ...this.state.placing } : null };
    this.disable();
    this.cb.onShoot(snapshot);
  }

  private cancel = (): void => {
    this.pull = null;
    this.dragPointer = null;
    this.touchAim = null;
    if (this.state.power !== 0) {
      this.state.power = 0;
      this.emit();
    }
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    const step = (e.shiftKey ? CONTROLS.coarseAimStepDeg : CONTROLS.fineAimStepDeg) * DEG;
    const s = CONTROLS.spinKeyStep;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        this.state.angle += step;
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        this.state.angle -= step;
        break;
      case 'w':
      case 'W':
        this.setSpin(this.state.spinX, this.state.spinY + s);
        return;
      case 's':
      case 'S':
        this.setSpin(this.state.spinX, this.state.spinY - s);
        return;
      case 'a':
      case 'A':
        this.setSpin(this.state.spinX - s, this.state.spinY);
        return;
      case 'd':
      case 'D':
        this.setSpin(this.state.spinX + s, this.state.spinY);
        return;
      case 'Escape':
        this.cancel();
        return;
      default:
        return;
    }
    e.preventDefault();
    this.emit();
  };
}
