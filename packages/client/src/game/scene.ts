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
import { Renderer3D } from '../render3d/renderer3d';
import type { CameraMode, FloatingText, GuideOverlay, RenderFrame, ShotView } from '../render3d/types';
import { cueTrajectory, fiveAndHalf } from './systems';
import { h } from '../ui/dom';
import { PowerBar } from '../ui/powerBar';
import { SpinWidget } from '../ui/spinWidget';
import { ElevationWidget } from '../ui/elevationWidget';
import { FixedLoop } from './loop';
import { CONTROLS, GUIDE } from '../config';

/** Aim shown for the other player (online) — what the opponent is doing right now. */
export interface RemoteAim {
  angle: number;
  power: number;
  spinX: number;
  spinY: number;
  elevation?: number;
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
  /** Balls drawn at rest next to the simulated ones (lag: the other player's ball). */
  extraBalls?: BallPosition[];
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
  readonly elevation: ElevationWidget;
  readonly power: PowerBar;
  private renderer: Renderer3D;
  private cameraBtn: HTMLButtonElement;
  private shotViewBtn: HTMLButtonElement;
  private pathBtn: HTMLButtonElement;
  private systemBtn: HTMLButtonElement;
  private systemPanel: HTMLDivElement;
  /** Practice guide switches (off in online games). */
  private guideAllowed = false;
  private showPath = false;
  private showSystem = false;
  private guide: GuideOverlay | undefined;
  private guideQueued = false;
  private lastPower: number = GUIDE.previewPower;
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
    const phys = PHYSICS[DISCIPLINES[discipline].physics];
    this.renderer = new Renderer3D(this.canvas, this.geom, DISCIPLINES[discipline].balls, phys.maxTipOffset);
    this.spin = new SpinWidget((x, y) => this.aim.setSpin(x, y));
    this.elevation = new ElevationWidget(phys.maxCueElevationDeg, (d) => this.aim.setElevation(d));
    this.power = new PowerBar({
      onDrag: (p) => this.aim.setPower(p),
      onRelease: (p) => this.aim.shootWithPower(p),
    });
    const fine = h('div.fine-aim', {}, this.repeatButton('⟲', () => this.aim.nudge(CONTROLS.fineAimStepDeg)), this.repeatButton('⟳', () => this.aim.nudge(-CONTROLS.fineAimStepDeg)));
    this.cameraBtn = h('button.btn.fine.camera', { title: '시점 바꾸기 (위 / 큐 뒤)', onclick: () => this.setCameraMode(this.renderer.cameraMode === 'cue' ? 'top' : 'cue') });
    this.shotViewBtn = h('button.btn.fine.camera', { title: '공이 굴러갈 때 시점 (위 / 비스듬히)', onclick: () => this.setShotView(this.renderer.shotView === 'top' ? 'angled' : 'top') });
    this.pathBtn = h('button.btn.fine.camera', { hidden: true, title: '실제로 굴러갈 길 보기 (연습 모드)', onclick: () => this.toggleGuide('path') }, '〰️ 궤적');
    this.systemBtn = h('button.btn.fine.camera', { hidden: true, title: '파이브앤하프 시스템 보기 (연습 모드)', onclick: () => this.toggleGuide('system') }, '📐 시스템');
    this.systemPanel = h('div.system-panel', { hidden: true });
    this.el = h('div.scene', {}, h('div.stage', {}, this.canvas, this.renderer.overlay, h('div.view-buttons', {}, this.cameraBtn, this.shotViewBtn, this.pathBtn, this.systemBtn), this.systemPanel), h('div.scene-controls', {}, this.spin.el, this.elevation.el, fine, this.power.el));
    this.aim = new AimController(this.canvas, this.renderer, {
      onChange: (s) => this.onAimChange(s),
      onShoot: (s) => this.onShoot(s),
    });
    this.aim.maxElevation = phys.maxCueElevationDeg;
    this.setCameraMode(loadCameraMode());
    this.setShotView(loadShotView());
    this.loop = new FixedLoop(phys.timeStep, () => this.update(), (alpha, dt) => this.render(alpha, dt));
    this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
    this.resizeObserver.observe(this.canvas);
  }

  /** Button that repeats while held (touch-friendly fine aim, 0.1° per tick). */
  private repeatButton(label: string, fn: () => void): HTMLButtonElement {
    const b = h('button.btn.fine', { title: '미세 조준 0.1°' }, label);
    let timer = 0;
    let delay = 0;
    const stop = () => window.clearTimeout(timer);
    const tick = () => {
      fn();
      delay = Math.max(30, delay * 0.85);
      timer = window.setTimeout(tick, delay);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      fn();
      delay = 300;
      timer = window.setTimeout(tick, delay);
    });
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointercancel', stop);
    return b;
  }

  /** 위 시점(top) or 큐 뒤 시점(cue). In cue view the aim turns by dragging sideways. */
  setCameraMode(mode: CameraMode): void {
    this.renderer.cameraMode = mode;
    this.aim.rotateMode = mode === 'cue';
    this.cameraBtn.textContent = mode === 'cue' ? '🎥 큐' : '🗺️ 위';
    try {
      localStorage.setItem(CAMERA_KEY, mode);
    } catch {
      // storage unavailable
    }
  }

  /** 샷 시점: straight down from above (항공) or tilted behind the shot. */
  setShotView(v: ShotView): void {
    this.renderer.shotView = v;
    this.shotViewBtn.textContent = v === 'top' ? '🛩️ 샷: 위' : '🎬 샷: 비스듬히';
    try {
      localStorage.setItem(SHOT_VIEW_KEY, v);
    } catch {
      // storage unavailable
    }
  }

  /** Practice mode: offer the real-path preview and (carom tables) the 파이브앤하프 overlay. */
  enableGuide(on: boolean): void {
    this.guideAllowed = on;
    this.pathBtn.hidden = !on;
    this.systemBtn.hidden = !on || !this.isCarom;
    if (!on) {
      this.showPath = this.showSystem = false;
      this.updateGuideButtons();
    }
    this.queueGuide();
  }

  private get isCarom(): boolean {
    return PHYSICS[DISCIPLINES[this.discipline].physics] === PHYSICS.carom;
  }

  private toggleGuide(which: 'path' | 'system'): void {
    if (which === 'path') this.showPath = !this.showPath;
    else this.showSystem = !this.showSystem;
    this.updateGuideButtons();
    this.queueGuide();
  }

  private updateGuideButtons(): void {
    this.pathBtn.classList.toggle('on', this.showPath);
    this.systemBtn.classList.toggle('on', this.showSystem);
  }

  /** Recompute the guide at most once per frame (aim changes arrive per pointer event). */
  private queueGuide(): void {
    if (this.guideQueued) return;
    this.guideQueued = true;
    requestAnimationFrame(() => {
      this.guideQueued = false;
      this.computeGuide();
    });
  }

  private computeGuide(): void {
    const s = this.aimState;
    const cue = this.aim.cuePosition();
    const active = this.guideAllowed && !!this.turn?.interactive && !this.playing && !!s && !!cue;
    this.systemPanel.hidden = !(active && this.showSystem);
    if (!active || (!this.showPath && !this.showSystem)) {
      this.guide = undefined;
      return;
    }
    const g: GuideOverlay = {};
    if (this.showPath) {
      const balls = s.placing ? this.balls.map((b) => (b.id === this.turn!.cueBall ? { ...b, x: s.placing!.x, y: s.placing!.y, pocketed: false } : b)) : this.balls;
      const power = s.power > 0 ? s.power : this.lastPower;
      const t = cueTrajectory(this.geom, PHYSICS[DISCIPLINES[this.discipline].physics], balls, this.turn!.cueBall, { angle: s.angle, power, spinX: s.spinX, spinY: s.spinY, elevation: s.elevation });
      g.trajectory = t.path;
      g.cushions = t.cushions;
    }
    if (this.showSystem && this.isCarom) {
      const r = fiveAndHalf(this.geom, cue!, s.angle);
      g.systemLine = r.line;
      g.arrival = r.arrival;
      g.labels = r.labels;
      const n = (v: number | null) => (v === null ? '–' : String(Math.round(v * 10) / 10));
      this.systemPanel.textContent = '';
      this.systemPanel.append(
        h('b', {}, '파이브앤하프'),
        h('div', {}, `출발 ${n(r.start)} − 1쿠션 ${n(r.first)} = 3쿠션 ${n(r.third)}`),
        r.note ? h('div.muted', {}, r.note) : h('div.muted', {}, this.showPath ? '분홍 선: 실제로 굴러갈 길' : '〰️ 궤적을 켜면 실제 길과 비교할 수 있어요'),
      );
    }
    this.guide = g;
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
    this.renderer.dispose();
  }

  setFelt(color: string | null): void {
    this.renderer.setFelt(color);
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
    this.elevation.enabled = !!turn?.interactive;
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
      this.renderer.spinBalls(sim.balls, sim.phys.timeStep);
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
      if (this.playing?.opts.extraBalls) balls.push(...this.playing.opts.extraBalls);
    } else {
      balls = this.balls;
    }

    const frame: RenderFrame = { balls, texts: this.texts, rings: this.rings, animating: !!this.sim, holdCamera: this.aim.isPlacing };
    if (this.guide && this.turn?.interactive && !this.sim) frame.guide = this.guide;
    if (this.turn) frame.highlight = this.turn.cueBall;
    if (!this.sim && this.turn) {
      if (this.turn.interactive && this.aimState) {
        const cuePos = this.aim.cuePosition();
        if (this.aimState.placing) {
          frame.balls = balls.map((b) => (b.id === this.turn!.cueBall ? { ...b, x: this.aimState!.placing!.x, y: this.aimState!.placing!.y, pocketed: false } : b));
          frame.placement = { at: this.aimState.placing, valid: this.aimState.placementValid };
        }
        if (cuePos) {
          frame.cue = { at: cuePos, angle: this.aimState.angle, pull: this.aimState.power, spinX: this.aimState.spinX, spinY: this.aimState.spinY, elevation: this.aimState.elevation };
          frame.aim = this.prediction;
        }
      } else if (!this.turn.interactive && this.remote) {
        const cue = this.remote.cueBallPos ?? balls.find((b) => b.id === this.turn!.cueBall);
        if (cue) {
          if (this.remote.cueBallPos) {
            frame.balls = balls.map((b) => (b.id === this.turn!.cueBall ? { ...b, x: cue.x, y: cue.y, pocketed: false } : b));
          }
          frame.cue = { at: { x: cue.x, y: cue.y }, angle: this.remote.angle, pull: this.remote.power, spinX: this.remote.spinX, spinY: this.remote.spinY, elevation: this.remote.elevation, ghost: true };
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
    this.elevation.set(s.elevation);
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
    this.queueGuide();
    this.cb.onAim?.({ angle: s.angle, power: s.power, spinX: s.spinX, spinY: s.spinY, elevation: s.elevation, cueBallPos: s.placing ?? undefined });
  }

  private onShoot(s: AimState): void {
    this.spin.enabled = false;
    this.elevation.enabled = false;
    this.power.enabled = false;
    this.lastPower = s.power;
    this.guide = undefined;
    this.systemPanel.hidden = true;
    this.cb.onShoot({
      input: { angle: s.angle, power: s.power, spinX: s.spinX, spinY: s.spinY, elevation: s.elevation },
      cueBallPos: s.placing ?? undefined,
    });
  }
}

const CAMERA_KEY = 'breakshot.camera';

function loadCameraMode(): CameraMode {
  try {
    return localStorage.getItem(CAMERA_KEY) === 'top' ? 'top' : 'cue';
  } catch {
    return 'cue';
  }
}

const SHOT_VIEW_KEY = 'breakshot.shotView';

function loadShotView(): ShotView {
  try {
    return localStorage.getItem(SHOT_VIEW_KEY) === 'angled' ? 'angled' : 'top';
  } catch {
    return 'top';
  }
}
