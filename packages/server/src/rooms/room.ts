import {
  applyShot,
  applyTimeViolation,
  createMatch,
  DISCIPLINES,
  forfeit,
  geometryOf,
  lagStart,
  lagWinner,
  NET,
  other,
  PHYSICS,
  simulateLag,
  startMatch,
  startNextSet,
  useTimeout,
  validateShot,
  type AimMessage,
  type ClientMessage,
  type ClockView,
  type ErrorCode,
  type LagResult,
  type MatchState,
  type RoomPhase,
  type RoomSettings,
  type RoomView,
  type Seat,
  type ServerMessage,
  type ShotInput,
  type ShotRequest,
} from '@breakshot/shared';

/** A connected client, abstracted so rooms can be tested without sockets. */
export interface Conn {
  readonly id: string;
  send(msg: ServerMessage): void;
}

export interface RoomDeps {
  now(): number;
  random(): number;
  token(): string;
  log(msg: string): void;
}

interface Slot {
  token: string;
  nickname: string;
  ready: boolean;
  conn: Conn | null;
  /** Epoch ms after which the opponent may claim a forfeit (set while disconnected). */
  graceDeadline: number | null;
  wantsRematch: boolean;
  lastAimAt: number;
}

interface Clock {
  seat: Seat;
  total: number;
  /** Epoch ms when time runs out (null while paused). */
  deadline: number | null;
  /** Remaining ms while paused. */
  pausedRemaining: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const isLive = (s: MatchState | null): s is MatchState => !!s && (s.phase === 'Aiming' || s.phase === 'BallInHand');

/**
 * One game room: lobby, lag, authoritative match, shot clock, disconnect handling.
 * All game rules come from @breakshot/shared; the room only sequences them and talks to sockets.
 */
export class Room {
  phase: RoomPhase = 'lobby';
  readonly slots: [Slot | null, Slot | null] = [null, null];
  match: MatchState | null = null;
  firstBreaker: Seat | null = null;
  lag: [LagResult | null, LagResult | null] = [null, null];
  /** Epoch ms since the room had nobody connected (null while someone is connected). */
  emptySince: number | null = null;
  finishedAt: number | null = null;

  private clock: Clock | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    readonly code: string,
    readonly settings: RoomSettings,
    private readonly deps: RoomDeps,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Membership

  /** Seat a new player. Returns null if the room is full. */
  join(conn: Conn, nickname: string): { seat: Seat; token: string } | null {
    const seat: Seat | null = this.slots[0] === null ? 0 : this.slots[1] === null ? 1 : null;
    if (seat === null || this.phase !== 'lobby') return null;
    const token = this.deps.token();
    this.slots[seat] = { token, nickname, ready: false, conn, graceDeadline: null, wantsRematch: false, lastAimAt: 0 };
    this.emptySince = null;
    this.welcome(seat);
    this.broadcastRoom();
    return { seat, token };
  }

  /** Re-attach a returning player (refresh, network drop). */
  resume(conn: Conn, token: string): Seat | null {
    const seat = ([0, 1] as Seat[]).find((s) => this.slots[s]?.token === token);
    if (seat === undefined) return null;
    const slot = this.slots[seat]!;
    slot.conn = conn;
    slot.graceDeadline = null;
    this.emptySince = null;
    this.welcome(seat);
    if (this.clock && this.clock.seat === seat && this.clock.pausedRemaining !== null) this.resumeClock();
    this.broadcastRoom();
    return seat;
  }

  private welcome(seat: Seat): void {
    const slot = this.slots[seat]!;
    this.send(seat, { type: 'joined', code: this.code, seat, token: slot.token, room: this.view() });
    if (this.match) this.send(seat, { type: 'match', state: this.match, clock: this.clockView() });
  }

  /** Socket closed without "leave": keep the seat for the grace period. */
  disconnect(seat: Seat): void {
    const slot = this.slots[seat];
    if (!slot) return;
    slot.conn = null;
    if (this.phase === 'lobby') slot.ready = false;
    slot.graceDeadline = this.deps.now() + NET.reconnectGraceSeconds * 1000;
    if (this.clock && this.clock.seat === seat) this.pauseClock();
    if (!this.anyConnected()) this.emptySince = this.deps.now();
    this.broadcastRoom();
  }

  /** Explicit leave: forfeits a running match, frees the seat in the lobby. */
  leave(seat: Seat): void {
    const slot = this.slots[seat];
    if (!slot) return;
    slot.conn?.send({ type: 'left', reason: 'left' });
    if (this.phase === 'playing' && this.match) {
      this.finish(forfeit(this.match, seat));
      slot.conn = null;
      slot.graceDeadline = null;
      slot.token = `left-${slot.token}`; // cannot resume
    } else {
      this.slots[seat] = null;
      if (this.phase === 'lag') this.phase = 'lobby';
      for (const s of this.slots) if (s) s.ready = false;
    }
    if (!this.anyConnected()) this.emptySince = this.deps.now();
    this.broadcastRoom();
  }

  anyConnected(): boolean {
    return this.slots.some((s) => s?.conn);
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.clock?.timer) clearTimeout(this.clock.timer);
    this.clock = null;
  }

  // ---------------------------------------------------------------------------------------------
  // Messages

  handle(seat: Seat, msg: ClientMessage): void {
    switch (msg.type) {
      case 'ready':
        return this.onReady(seat, msg.ready);
      case 'aim':
        return this.onAim(seat, msg.aim);
      case 'shoot':
        return this.onShoot(seat, msg.seq, { input: msg.input, cueBallPos: msg.cueBallPos });
      case 'lagShot':
        return this.onLag(seat, msg.input);
      case 'timeout':
        return this.onTimeout(seat);
      case 'claimForfeit':
        return this.onClaimForfeit(seat);
      case 'keepWaiting':
        return this.onKeepWaiting(seat);
      case 'rematch':
        return this.onRematch(seat);
      case 'leave':
        return this.leave(seat);
      case 'ping':
        return this.send(seat, { type: 'pong', t: msg.t, serverTime: this.deps.now() });
      default:
        return this.error(seat, 'badMessage', `unexpected ${msg.type}`);
    }
  }

  private onReady(seat: Seat, ready: boolean): void {
    if (this.phase !== 'lobby') return this.error(seat, 'wrongPhase', 'not in the lobby');
    this.slots[seat]!.ready = ready;
    this.broadcastRoom();
    if (this.slots[0]?.ready && this.slots[1]?.ready) {
      if (this.settings.breakDecision === 'lag') {
        this.phase = 'lag';
        this.lag = [null, null];
        this.broadcastRoom();
      } else if (this.settings.breakDecision === 'host') {
        this.begin(0);
      } else if (this.settings.breakDecision === 'guest') {
        this.begin(1);
      } else {
        this.begin(this.deps.random() < 0.5 ? 0 : 1);
      }
    }
  }

  private onLag(seat: Seat, input: ShotInput): void {
    if (this.phase !== 'lag') return this.error(seat, 'wrongPhase', 'no lag in progress');
    if (this.lag[seat]) return this.error(seat, 'wrongPhase', 'already lagged');
    const carom = DISCIPLINES[this.settings.discipline].physics === 'carom';
    const geom = geometryOf(this.settings.table);
    const start = lagStart(geom, seat, carom);
    const { final, distance } = simulateLag(geom, PHYSICS[DISCIPLINES[this.settings.discipline].physics], start, input);
    const result: LagResult = { seat, ballId: start.id, start, input, final, distance };
    this.lag[seat] = result;
    this.broadcast({ type: 'lag', result });
    const [a, b] = this.lag;
    if (a && b) {
      const w = lagWinner(a.distance, b.distance);
      // Let both clients finish the lag animation before moving on.
      this.later(NET.setOverDelayMs + 4000, () => {
        if (this.phase !== 'lag') return;
        if (w === null) {
          this.lag = [null, null];
          this.broadcastRoom();
        } else this.begin(w);
      });
    }
  }

  private begin(firstBreaker: Seat): void {
    this.firstBreaker = firstBreaker;
    const created = createMatch({
      ruleSet: this.settings.ruleSet,
      table: this.settings.table,
      config: this.settings.config,
      names: [this.slots[0]!.nickname, this.slots[1]!.nickname],
      seed: Math.floor(this.deps.random() * 2 ** 32),
      firstBreaker,
    });
    this.match = startMatch(created);
    this.phase = 'playing';
    this.finishedAt = null;
    for (const s of this.slots) if (s) s.wantsRematch = false;
    this.broadcastRoom();
    this.broadcast({ type: 'match', state: this.match, clock: null });
    this.scheduleClock(0);
  }

  private onAim(seat: Seat, aim: AimMessage): void {
    if (!isLive(this.match) || this.match.current !== seat) return;
    const slot = this.slots[seat]!;
    const now = this.deps.now();
    // Throttle relayed previews (clients already limit to ~15 Hz).
    if (now - slot.lastAimAt < 1000 / (NET.aimPreviewHz * 1.5)) return;
    slot.lastAimAt = now;
    this.send(other(seat), { type: 'aim', seat, aim });
  }

  private onShoot(seat: Seat, seq: number, req: ShotRequest): void {
    const m = this.match;
    if (this.phase !== 'playing' || !m) return this.error(seat, 'wrongPhase', 'no match in progress');
    if (seq !== m.shots) return this.error(seat, 'staleShot', `expected shot ${m.shots}`);
    const err = validateShot(m, seat, req);
    if (err) return this.error(seat, err, `shot rejected: ${err}`);
    this.stopClock();
    const out = applyShot(m, seat, req);
    this.match = out.state;
    this.broadcast({
      type: 'shot',
      seq,
      shooter: seat,
      cueBall: out.cueBall,
      input: req.input,
      start: out.start,
      final: out.log.final,
      verdict: out.verdict,
      state: out.state,
      duration: out.log.duration,
    });
    this.afterResolve(out.log.duration * 1000);
  }

  /** Follow-ups once a shot / time violation has been resolved. */
  private afterResolve(animationMs: number): void {
    const m = this.match!;
    if (m.phase === 'GameOver') return this.finish(m);
    if (m.phase === 'SetOver') {
      this.later(animationMs + NET.setOverDelayMs, () => {
        if (this.match?.phase !== 'SetOver') return;
        this.match = startNextSet(this.match);
        this.broadcast({ type: 'match', state: this.match, clock: null });
        this.scheduleClock(0);
      });
      return;
    }
    this.scheduleClock(animationMs + NET.clockStartSlackMs);
  }

  private finish(state: MatchState): void {
    this.stopClock();
    this.match = state;
    this.phase = 'finished';
    this.finishedAt = this.deps.now();
    this.broadcast({ type: 'match', state, clock: null });
    this.broadcastRoom();
  }

  private onTimeout(seat: Seat): void {
    if (!this.match || !this.clock) return this.error(seat, 'wrongPhase', 'no shot clock running');
    const next = useTimeout(this.match, seat);
    if (!next) return this.error(seat, 'noTimeouts', 'no extension available');
    this.match = next;
    const ext = this.match.config.extensionSeconds * 1000;
    const c = this.clock;
    if (c.deadline !== null) {
      c.deadline += ext;
      c.total = Math.round((c.deadline - this.deps.now()) / 1000);
      this.armClock();
    } else if (c.pausedRemaining !== null) c.pausedRemaining += ext;
    this.broadcast({ type: 'match', state: this.match, clock: this.clockView() });
  }

  private onClaimForfeit(seat: Seat): void {
    const opp = this.slots[other(seat)];
    if (this.phase !== 'playing' || !this.match || !opp || opp.conn) return this.error(seat, 'wrongPhase', 'opponent is connected');
    if (opp.graceDeadline === null || this.deps.now() < opp.graceDeadline) return this.error(seat, 'tooEarly', 'grace period not over');
    this.finish(forfeit(this.match, other(seat)));
  }

  private onKeepWaiting(seat: Seat): void {
    const opp = this.slots[other(seat)];
    if (!opp || opp.conn || opp.graceDeadline === null) return;
    opp.graceDeadline = Math.max(opp.graceDeadline, this.deps.now()) + NET.reconnectExtendSeconds * 1000;
    this.broadcastRoom();
  }

  private onRematch(seat: Seat): void {
    if (this.phase !== 'finished') return this.error(seat, 'wrongPhase', 'game not finished');
    this.slots[seat]!.wantsRematch = true;
    this.broadcastRoom();
    if (this.slots[0]?.wantsRematch && this.slots[1]?.wantsRematch && this.slots[0].conn && this.slots[1].conn) {
      this.begin(other(this.firstBreaker ?? 1));
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Shot clock (server-authoritative)

  /** Start the shot clock for the player to move after `delayMs` (the shot animation). */
  private scheduleClock(delayMs: number): void {
    this.stopClock();
    const m = this.match;
    if (!isLive(m) || m.config.shotClock <= 0) {
      this.broadcast({ type: 'clock', clock: null });
      return;
    }
    const seat = m.current;
    const shots = m.shots;
    this.later(delayMs, () => {
      if (!isLive(this.match) || this.match.shots !== shots || this.match.current !== seat) return;
      const total = this.match.config.shotClock;
      this.clock = { seat, total, deadline: this.deps.now() + total * 1000, pausedRemaining: null, timer: null };
      if (!this.slots[seat]?.conn) this.pauseClock();
      else this.armClock();
      this.broadcast({ type: 'clock', clock: this.clockView() });
    });
  }

  private armClock(): void {
    const c = this.clock;
    if (!c || c.deadline === null) return;
    if (c.timer) clearTimeout(c.timer);
    c.timer = setTimeout(() => this.timeUp(), Math.max(0, c.deadline - this.deps.now()));
  }

  private pauseClock(): void {
    const c = this.clock;
    if (!c || c.deadline === null) return;
    if (c.timer) clearTimeout(c.timer);
    c.timer = null;
    c.pausedRemaining = Math.max(0, c.deadline - this.deps.now());
    c.deadline = null;
    this.broadcast({ type: 'clock', clock: this.clockView() });
  }

  private resumeClock(): void {
    const c = this.clock;
    if (!c || c.pausedRemaining === null) return;
    c.deadline = this.deps.now() + c.pausedRemaining;
    c.pausedRemaining = null;
    this.armClock();
    this.broadcast({ type: 'clock', clock: this.clockView() });
  }

  private stopClock(): void {
    if (this.clock?.timer) clearTimeout(this.clock.timer);
    this.clock = null;
  }

  private timeUp(): void {
    const c = this.clock;
    if (!c || !isLive(this.match)) return;
    this.clock = null;
    const { state, verdict } = applyTimeViolation(this.match);
    this.match = state;
    this.broadcast({ type: 'verdict', verdict, state });
    this.afterResolve(0);
  }

  private clockView(): ClockView | null {
    const c = this.clock;
    if (!c) return null;
    const remaining = c.deadline !== null ? Math.max(0, c.deadline - this.deps.now()) : (c.pausedRemaining ?? 0);
    return { seat: c.seat, remainingMs: remaining, totalSeconds: c.total, paused: c.deadline === null };
  }

  // ---------------------------------------------------------------------------------------------
  // Output

  view(): RoomView {
    const now = this.deps.now();
    const slotView = (s: Slot | null) =>
      s && {
        nickname: s.nickname,
        ready: s.ready,
        connected: !!s.conn,
        graceRemainingMs: !s.conn && s.graceDeadline !== null ? Math.max(0, s.graceDeadline - now) : null,
        wantsRematch: s.wantsRematch,
      };
    return {
      code: this.code,
      settings: this.settings,
      phase: this.phase,
      seats: [slotView(this.slots[0]), slotView(this.slots[1])],
      lag: this.lag,
      firstBreaker: this.firstBreaker,
    };
  }

  private send(seat: Seat, msg: ServerMessage): void {
    this.slots[seat]?.conn?.send(msg);
  }

  private broadcast(msg: ServerMessage): void {
    for (const s of this.slots) s?.conn?.send(msg);
  }

  private broadcastRoom(): void {
    this.broadcast({ type: 'room', room: this.view() });
  }

  error(seat: Seat, code: ErrorCode, message: string): void {
    this.send(seat, { type: 'error', code, message });
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
}
