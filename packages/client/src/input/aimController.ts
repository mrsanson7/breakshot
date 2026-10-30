import { clampPlacement, isValidPlacement, type BallPosition, type PlacementRegion, type TableGeometry, type Vec2 } from '@breakshot/shared';
import { CONTROLS } from '../config';
import type { ScreenMapper } from '../render3d/types';

export interface AimState {
  angle: number;
  /** 0..1 while the player is pulling back, else 0. */
  power: number;
  spinX: number;
  spinY: number;
  /** Cue elevation (deg), 0 = level. */
  elevation: number;
  /** Ball-in-hand position being dragged (null when not placing). */
  placing: Vec2 | null;
  placementValid: boolean;
  /** Where a touch pull started (client px), for drawing its cancel zone; null otherwise. */
  touchPull: { x: number; y: number } | null;
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

/** Touch pull distance (CSS px) to power: nothing inside the cancel zone, full power at `full`. */
const touchPower = (moved: number, full: number): number => Math.max(0, Math.min(1, (moved - CONTROLS.touchCancelPixels) / (full - CONTROLS.touchCancelPixels)));

/**
 * Mouse / pointer and keyboard aiming:
 *  - move: aim at the pointer
 *  - press and pull back, release: shoot (power ∝ pull distance)
 *  - rotate mode (camera behind the cue): drag sideways to turn, or down to pull the cue back and release to shoot
 *  - touch in the top view: drag to aim, or press on the cue to pull it back and release to shoot
 *  - touch pulls cancel when released near where they started, or when another finger taps the screen
 *  - the power bar is a second way to shoot in every mode
 *  - ball in hand: press on the cue ball and drag to place it
 *  - arrow keys: fine aim (0.1°, Shift = 1°); W/A/S/D: spin; Q/E: raise/lower the cue; Esc / right click: cancel
 */
export class AimController {
  state: AimState = { angle: 0, power: 0, spinX: 0, spinY: 0, elevation: 0, placing: null, placementValid: true, touchPull: null };
  /** Steepest elevation allowed (deg). */
  maxElevation = 0;
  private enabled = false;
  private ctx: AimContext | null = null;
  private pull: { start: Vec2; pointer: number; touchFrom: { x: number; y: number } | null } | null = null;
  private dragPointer: number | null = null;
  /** Touch / pen: the pointer currently aiming (power comes from the on-screen slider). */
  private touchAim: number | null = null;
  /** Rotate mode: the dragging pointer, where it pressed, its last x (CSS px), what the drag turned out to be, and the pull that gives full power. */
  private stroke: { pointer: number; startX: number; startY: number; x: number; axis: 'turn' | 'pull' | null; touch: boolean; fullPull: number } | null = null;
  /** Drag sideways to turn instead of pointing at the target (behind-the-cue camera). */
  rotateMode = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: ScreenMapper,
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
    window.addEventListener('pointerdown', this.onOtherFinger, true);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerdown', this.onOtherFinger, true);
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
    this.stroke = null;
    this.state.power = 0;
    this.canvas.style.cursor = 'default';
    if (this.state.touchPull) {
      this.state.touchPull = null;
      this.emit();
    }
  }

  /** The player is dragging the cue ball (ball in hand). */
  get isPlacing(): boolean {
    return this.dragPointer !== null;
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

  setElevation(deg: number): void {
    this.state.elevation = Math.max(0, Math.min(this.maxElevation, deg));
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
      if (this.pull.touchFrom) {
        // A finger stops at the screen edge, and near a corner "back" points off the screen: any direction counts.
        const moved = Math.hypot(e.clientX - this.pull.touchFrom.x, e.clientY - this.pull.touchFrom.y);
        this.state.power = touchPower(moved, CONTROLS.pullPixelsForFullPower);
        this.emit();
        return;
      }
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
    if (this.stroke && this.stroke.pointer === e.pointerId) {
      this.onStroke(this.stroke, e);
      return;
    }
    if (this.rotateMode) return;
    if (e.pointerType === 'mouse' || this.touchAim === e.pointerId) this.aimAt(w);
  };

  /** Rotate mode: the first few pixels pick turning or pulling, so a straight pull never swings the aim. */
  private onStroke(stroke: NonNullable<AimController['stroke']>, e: PointerEvent): void {
    const dx = e.clientX - stroke.startX;
    const dy = e.clientY - stroke.startY;
    if (!stroke.axis) {
      if (Math.hypot(dx, dy) < CONTROLS.strokeLockPixels) return;
      stroke.axis = Math.abs(dy) > Math.abs(dx) ? 'pull' : 'turn';
    }
    if (stroke.axis === 'turn') {
      this.state.angle -= (e.clientX - stroke.x) * CONTROLS.dragAimDegPerPx * DEG;
      stroke.x = e.clientX;
    } else {
      const blocked = this.state.placing && !this.state.placementValid;
      // A finger may run out of screen below the press, so it can pull upwards as well.
      const power = stroke.touch ? touchPower(Math.abs(dy), stroke.fullPull) : Math.max(0, Math.min(1, dy / stroke.fullPull));
      this.state.power = blocked ? 0 : power;
      if (stroke.touch) this.state.touchPull = { x: stroke.startX, y: stroke.startY };
    }
    this.emit();
  }

  /** Top view + touch: is the finger on the cue ball or on the cue behind it? */
  private touchesCue(e: PointerEvent, cue: Vec2): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const a = this.view.toScreen(cue);
    const len = CONTROLS.touchCueGrabLength;
    const b = this.view.toScreen({ x: cue.x - Math.cos(this.state.angle) * len, y: cue.y - Math.sin(this.state.angle) * len });
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < CONTROLS.touchCueGrabPixels;
  }

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
    if (this.rotateMode) {
      const touch = e.pointerType !== 'mouse';
      // Short screens (a phone on its side): full power must stay within the longer way up or down.
      const room = Math.max(e.clientY, window.innerHeight - e.clientY) * CONTROLS.touchPullRoomShare;
      const fullPull = touch ? Math.min(CONTROLS.pullPixelsForFullPower, room) : CONTROLS.pullPixelsForFullPower;
      this.stroke = { pointer: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, axis: null, touch, fullPull };
      this.state.power = 0;
      this.emit();
      return;
    }
    if (e.pointerType !== 'mouse' && !(cue && this.touchesCue(e, cue))) {
      // Touch away from the cue: a tap/drag on the table aims at the finger.
      this.aimAt(w);
      this.dragPointer = null;
      this.touchAim = e.pointerId;
      return;
    }
    if (this.state.placing && !this.state.placementValid) return;
    const touchFrom = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY };
    this.pull = { start: w, pointer: e.pointerId, touchFrom };
    this.state.touchPull = touchFrom;
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
    if (this.stroke?.pointer === e.pointerId) {
      this.stroke = null;
    } else if (this.pull?.pointer === e.pointerId) {
      this.pull = null;
    } else {
      return;
    }
    if (this.state.touchPull) {
      this.state.touchPull = null;
      this.emit();
    }
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
    this.stroke = null;
    if (this.state.power !== 0 || this.state.touchPull) {
      this.state.power = 0;
      this.state.touchPull = null;
      this.emit();
    }
  };

  /** A second finger anywhere on the screen calls off a pull that is under way. */
  private onOtherFinger = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    const active = this.pull?.pointer ?? (this.stroke?.axis === 'pull' ? this.stroke.pointer : null);
    if (active === null || active === e.pointerId) return;
    this.cancel();
    e.stopPropagation();
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
      case 'q':
      case 'Q':
        this.setElevation(this.state.elevation + CONTROLS.elevationKeyStepDeg);
        return;
      case 'e':
      case 'E':
        this.setElevation(this.state.elevation - CONTROLS.elevationKeyStepDeg);
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
