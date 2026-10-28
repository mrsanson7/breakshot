import {
  applyShot,
  applyTimeViolation,
  createMatch,
  NET,
  startMatch,
  startNextSet,
  useTimeout,
  validateShot,
  type MatchState,
  type RoomSettings,
  type Seat,
  type ShotRequest,
} from '@breakshot/shared';
import type { Session, SessionEvent } from './types';

export interface PracticeOptions {
  /** Free practice: the turn always comes back to seat 0. */
  freePlay: boolean;
  names: [string, string];
}

/** Offline practice: runs the shared match engine locally; both seats are local. */
export class PracticeSession implements Session {
  readonly kind = 'practice' as const;
  readonly mySeats: readonly Seat[] = [0, 1];
  state: MatchState;
  private listeners = new Set<(e: SessionEvent) => void>();
  private history: MatchState[] = [];
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private setTimer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;

  constructor(
    readonly settings: RoomSettings,
    private readonly opts: PracticeOptions,
  ) {
    this.state = this.fresh();
  }

  private fresh(): MatchState {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const m = createMatch({
      ruleSet: this.settings.ruleSet,
      table: this.settings.table,
      config: this.settings.config,
      names: this.opts.names,
      seed,
      firstBreaker: 0,
    });
    return startMatch(m);
  }

  subscribe(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    fn({ type: 'connection', status: 'local', opponentConnected: true, opponentDeadline: null });
    fn({ type: 'state', state: this.state });
    return () => this.listeners.delete(fn);
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }

  private stopClock(): void {
    if (this.clockTimer) clearTimeout(this.clockTimer);
    this.clockTimer = null;
    this.emit({ type: 'clock', clock: { deadline: null, total: 0, paused: false } });
  }

  /** Start (or restart with `seconds`) the shot clock for the player to move. */
  private startClock(seconds = this.state.config.shotClock): void {
    if (this.clockTimer) clearTimeout(this.clockTimer);
    this.clockTimer = null;
    this.deadline = null;
    if (this.state.config.shotClock <= 0 || (this.state.phase !== 'Aiming' && this.state.phase !== 'BallInHand')) return;
    this.deadline = Date.now() + seconds * 1000;
    this.clockTimer = setTimeout(() => this.timeUp(), seconds * 1000);
    this.emit({ type: 'clock', clock: { deadline: this.deadline, total: seconds, paused: false } });
  }

  private timeUp(): void {
    this.clockTimer = null;
    const { state, verdict } = applyTimeViolation(this.state);
    this.commit(state);
    this.emit({ type: 'verdict', verdict, state: this.state });
    this.afterResolve();
  }

  private commit(next: MatchState): void {
    this.history.push(this.state);
    if (this.opts.freePlay && next.phase !== 'GameOver' && next.phase !== 'SetOver' && next.current !== 0) {
      next = { ...next, current: 0 };
    }
    this.state = next;
  }

  shoot(req: ShotRequest): void {
    const seat = this.state.current;
    if (validateShot(this.state, seat, req)) return;
    this.stopClock();
    const out = applyShot(this.state, seat, req);
    this.commit(out.state);
    this.emit({
      type: 'shot',
      shot: { shooter: seat, start: out.start, cueBall: out.cueBall, input: req.input, final: out.log.final, verdict: out.verdict, state: this.state },
    });
  }

  animationDone(): void {
    this.afterResolve();
  }

  private afterResolve(): void {
    if (this.state.phase === 'SetOver') {
      if (this.setTimer) clearTimeout(this.setTimer);
      this.setTimer = setTimeout(() => {
        this.setTimer = null;
        this.state = startNextSet(this.state);
        this.emit({ type: 'state', state: this.state });
        this.startClock();
      }, NET.setOverDelayMs);
      return;
    }
    this.startClock();
  }

  sendAim(): void {
    // Nobody to show it to offline.
  }

  useTimeout(): void {
    const next = useTimeout(this.state, this.state.current);
    if (!next) return;
    this.state = next;
    this.emit({ type: 'state', state: this.state });
    const remaining = this.deadline ? Math.max(0, (this.deadline - Date.now()) / 1000) : 0;
    this.startClock(remaining + this.state.config.extensionSeconds);
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    if (this.setTimer) clearTimeout(this.setTimer);
    this.state = prev;
    this.emit({ type: 'state', state: this.state });
    this.startClock();
  }

  restart(): void {
    if (this.setTimer) clearTimeout(this.setTimer);
    this.history = [];
    this.state = this.fresh();
    this.emit({ type: 'state', state: this.state });
    this.startClock();
  }

  leave(): void {
    if (this.clockTimer) clearTimeout(this.clockTimer);
    if (this.setTimer) clearTimeout(this.setTimer);
    this.listeners.clear();
  }
}
