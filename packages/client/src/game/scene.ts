import {
  AIM_ASSIST,
  buildTableGeometry,
  DISCIPLINES,
  PHYSICS,
  predictAim,
  Simulation,
  TABLES,
  type AimAssistLevel,
  type AimPrediction,
  type BallPosition,
  type DisciplineId,
  type PlacementRegion,
  type ShotEvent,
  type ShotInput,
  type ShotRequest,
  type TableGeometry,
  type TableId,
  type Vec2,
} from '@breakshot/shared';
import { AimController, type AimState } from '../input/aimController';
import { TableRenderer, type FloatingText, type RenderFrame } from '../render/renderer';
import { h } from '../ui/dom';
import { PowerBar } from '../ui/powerBar';
import { SpinWidget } from '../ui/spinWidget';
import { FixedLoop } from './loop';

/** Aim shown for the other player (online) — what the opponent is doing right now. */
export interface RemoteAim {
  angle: number;
  power: number;
  spinX: number;
  spinY: number;
  cueBallPos?: Vec2;
}

export interface TurnOptions {
  interactive: boolean;
  cueBall: string;
  ballInHand: PlacementRegion | null;
  assist: AimAssistLevel;
}

export interface PlayOptions {
  /** Called for every physics event while animating (sounds, effects). */
  onEvent?: (e: ShotEvent, sim: Simulation) => void;
  /** Animation speed multiplier (replays). */
  speed?: number;
}

export interface SceneCallbacks {
  onShoot(req: ShotRequest): void;
  onAim?(aim: RemoteAim): void;
}

/**
 * The table on screen: renderer, fixed-step loop, aiming input and shot animation.
 * It knows nothing about rules or networking; sessions drive it.
 */
export class GameScene {
  readonly el: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly spin: SpinWidget;
  readonly power: PowerBar;
  private renderer: TableRenderer;
  private loop: FixedLoop;
  private aim: AimController;
  private geom: TableGeometry;
  private discipline: DisciplineId;

  private balls: BallPosition[] = [];
  private turn: TurnOptions | null = null;
  private aimState: AimState | null = null;
  private prediction: AimPrediction | undefined;
  private remote: RemoteAim | null = null;

  private sim: Simulation | null = null;
  private prev: { x: number; y: number }[] = [];
  private playing: { resolve: () => void; final: BallPosition[]; opts: PlayOptions; seen: number; speed: number; carry: number } | null = null;

  private texts: (FloatingText & { life: number })[] = [];
  private rings: { at: Vec2; age: number; color: string; life: number }[] = [];
  private resizeObserver: ResizeObserver;

  constructor(tableId: TableId, discipline: DisciplineId, private readonly cb: SceneCallbacks) {
    this.discipline = discipline;
    this.geom = buildTableGeometry(TABLES[tableId]);
    this.canvas = h('canvas.table-canvas');
    this.renderer = new TableRenderer(this.canvas, this.geom, DISCIPLINES[discipline].balls);
    this.spin = new SpinWidget((x, y) => this.aim.setSpin(x, y));
    this.power = new PowerBar({
      onDrag: (p) => this.aim.setPower(p),
      onRelease: (p) => this.aim.shootWithPower(p),
    });
    this.el = h('div.scene', {}, h('div.stage', {}, this.canvas), h('div.scene-controls', {}, this.spin.el, this.power.el));
    this.aim = new AimController(this.canvas, this.renderer.view, {
      onChange: (s) => this.onAimChange(s),
      onShoot: (s) => this.onShoot(s),
    });
    const phys = PHYSICS[DISCIPLINES[discipline].physics];
    this.loop = new FixedLoop(phys.timeStep, () => this.update(), (alpha, dt) => this.render(alpha, dt));
    this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
    this.resizeObserver.observe(this.canvas);
  }

  get geometry(): TableGeometry {
    return this.geom;
  }

  get fps(): number {
    return this.loop.fps;
  }

  start(): void {
    this.renderer.resize();
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.aim.dispose();
    this.resizeObserver.disconnect();
  }

  setFelt(color: string | null): void {
    this.renderer.palette.felt = color ?? this.geom.spec.colors.felt;
  }

  setBalls(balls: readonly BallPosition[]): void {
    this.balls = balls.map((b) => ({ ...b }));
    this.refreshAimContext();
  }

  getBalls(): BallPosition[] {
    return this.balls.map((b) => ({ ...b }));
  }

  get isAnimating(): boolean {
    return this.playing !== null;
  }

  /** Configure whose turn it is. Interactive turns enable the local controls. */
  setTurn(turn: TurnOptions | null): void {
    this.turn = turn;
    this.remote = null;
    if (turn?.interactive && !this.playing) {
      this.aim.enable({ geom: this.geom, balls: this.balls, cueBall: turn.cueBall, ballInHand: turn.ballInHand });
      this.aimAtNearestBall(turn.cueBall);
    } else {
      this.aim.disable();
      this.aimState = null;
      this.prediction = undefined;
    }
    this.spin.enabled = !!turn?.interactive;
    this.power.enabled = !!turn?.interactive;
  }

  showRemoteAim(aim: RemoteAim | null): void {
    this.remote = aim;
  }

  /**
   * Animate a shot from `start` with `input`, then snap to `final` (the authoritative result).
   * Resolves when the balls have stopped.
   */
  playShot(start: readonly BallPosition[], cueBall: string, input: ShotInput, final: readonly BallPosition[] | null, opts: PlayOptions = {}): Promise<void> {
    this.finishPlaying();
    this.aim.disable();
    this.aimState = null;
    this.prediction = undefined;
    this.remote = null;
    const phys = PHYSICS[DISCIPLINES[this.discipline].physics];
    this.sim = new Simulation(this.geom, phys, start);
    this.sim.strike(cueBall, input);
    this.prev = this.sim.balls.map((b) => ({ x: b.x, y: b.y }));
    return new Promise((resolve) => {
      this.playing = { resolve, final: final ? final.map((b) => ({ ...b })) : [], opts, seen: 0, speed: opts.speed ?? 1, carry: 0 };
      if (!final) this.playing.final = [];
    });
  }

  /** Skip the rest of the current animation. */
  skipAnimation(): void {
    if (!this.sim || !this.playing) return;
    while (this.sim.step()) this.flushEvents();
    this.flushEvents();
    this.finishPlaying();
  }

  floatText(at: Vec2, text: string, color: string, life = 1.4, size?: number): void {
    this.texts.push({ at, text, color, age: 0, life, size });
  }

  ring(at: Vec2, color: string, life = 0.6): void {
    this.rings.push({ at, age: 0, color, life });
  }

  // -------------------------------------------------------------------------------------------

  private finishPlaying(): void {
    const p = this.playing;
    if (!p) return;
    const sim = this.sim!;
    // Authoritative final positions win over the local replay (float drift across engines).
    this.balls = p.final.length > 0 ? p.final : sim.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: b.pocketed }));
    this.sim = null;
    this.playing = null;
    p.resolve();
  }

  private flushEvents(): void {
    const p = this.playing;
    const sim = this.sim;
    if (!p || !sim) return;
    while (p.seen < sim.events.length) {
      const e = sim.events[p.seen++];
      if (e.type === 'pocket') {
        const pk = this.geom.pockets.find((x) => x.id === e.pocket);
        if (pk) this.ring(pk.center, 'rgba(255,255,255,0.9)');
      }
      p.opts.onEvent?.(e, sim);
    }
  }

  private update(): void {
    const p = this.playing;
    const sim = this.sim;
    if (!p || !sim) return;
    // Replays can run faster or slower than real time: accumulate fractional steps.
    p.carry += p.speed;
    while (p.carry >= 1) {
      p.carry -= 1;
      this.prev = sim.balls.map((b) => ({ x: b.x, y: b.y }));
      const moving = sim.step();
      this.flushEvents();
      if (!moving) {
        this.finishPlaying();
        return;
      }
    }
  }

  private render(alpha: number, dt: number): void {
    for (const t of this.texts) t.age += dt / t.life;
    this.texts = this.texts.filter((t) => t.age < 1);
    for (const r of this.rings) r.age += dt / r.life;
    this.rings = this.rings.filter((r) => r.age < 1);

    let balls: BallPosition[];
    if (this.sim) {
      const a = this.playing && this.playing.speed !== 1 ? 1 : alpha;
      balls = this.sim.balls.map((b, i) => ({
        id: b.id,
        pocketed: b.pocketed,
        x: this.prev[i].x + (b.x - this.prev[i].x) * a,
        y: this.prev[i].y + (b.y - this.prev[i].y) * a,
      }));
    } else {
      balls = this.balls;
    }

    const frame: RenderFrame = { balls, texts: this.texts, rings: this.rings };
    if (this.turn) frame.highlight = this.turn.cueBall;
    if (!this.sim && this.turn) {
      if (this.turn.interactive && this.aimState) {
        const cuePos = this.aim.cuePosition();
        if (this.aimState.placing) {
          frame.balls = balls.map((b) => (b.id === this.turn!.cueBall ? { ...b, x: this.aimState!.placing!.x, y: this.aimState!.placing!.y, pocketed: false } : b));
          frame.placement = { at: this.aimState.placing, valid: this.aimState.placementValid };
        }
        if (cuePos) {
          frame.cue = { at: cuePos, angle: this.aimState.angle, pull: this.aimState.power };
          frame.aim = this.prediction;
        }
      } else if (!this.turn.interactive && this.remote) {
        const cue = this.remote.cueBallPos ?? balls.find((b) => b.id === this.turn!.cueBall);
        if (cue) {
          if (this.remote.cueBallPos) {
            frame.balls = balls.map((b) => (b.id === this.turn!.cueBall ? { ...b, x: cue.x, y: cue.y, pocketed: false } : b));
          }
          frame.cue = { at: { x: cue.x, y: cue.y }, angle: this.remote.angle, pull: this.remote.power, ghost: true };
        }
      }
    }
    this.renderer.draw(frame);
  }

  private refreshAimContext(): void {
    if (this.turn?.interactive && !this.playing) {
      this.aim.enable({ geom: this.geom, balls: this.balls, cueBall: this.turn.cueBall, ballInHand: this.turn.ballInHand });
    }
  }

  /** Start each turn pointing at the closest object ball. */
  private aimAtNearestBall(cueBall: string): void {
    const cue = this.aim.cuePosition();
    if (!cue) return;
    let best: BallPosition | null = null;
    let bd = Infinity;
    for (const b of this.balls) {
      if (b.pocketed || b.id === cueBall) continue;
      const d = Math.hypot(b.x - cue.x, b.y - cue.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) this.aim.state.angle = Math.atan2(best.y - cue.y, best.x - cue.x);
    this.onAimChange({ ...this.aim.state });
  }

  private onAimChange(s: AimState): void {
    this.aimState = s;
    this.spin.set(s.spinX, s.spinY);
    this.power.set(s.power);
    const assist = this.turn ? AIM_ASSIST[this.turn.assist] : null;
    if (assist && this.turn) {
      const balls = s.placing
        ? this.balls.map((b) => (b.id === this.turn!.cueBall ? { ...b, x: s.placing!.x, y: s.placing!.y, pocketed: false } : b))
        : this.balls;
      this.prediction = predictAim(this.geom, balls, this.turn.cueBall, s.angle, assist);
    } else {
      this.prediction = undefined;
    }
    this.cb.onAim?.({ angle: s.angle, power: s.power, spinX: s.spinX, spinY: s.spinY, cueBallPos: s.placing ?? undefined });
  }

  private onShoot(s: AimState): void {
    this.spin.enabled = false;
    this.power.enabled = false;
    this.cb.onShoot({
      input: { angle: s.angle, power: s.power, spinX: s.spinX, spinY: s.spinY },
      cueBallPos: s.placing ?? undefined,
    });
  }
}
