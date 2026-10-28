import {
  NET,
  other,
  type ClientMessage,
  type ErrorCode,
  type LagResult,
  type MatchState,
  type RoomSettings,
  type RoomView,
  type Seat,
  type ServerMessage,
  type ShotInput,
  type ShotRequest,
} from '@breakshot/shared';
import type { RemoteAim } from '../game/scene';
import { GameSocket, type SocketStatus } from '../net/socket';
import type { ClockView, ConnectionStatus, Session, SessionEvent } from './types';

const STORAGE_KEY = 'breakshot.seat';

interface StoredSeat {
  code: string;
  token: string;
}

/** Per-tab seat token (sessionStorage survives a refresh but not a new tab). */
export function storedSeat(): StoredSeat | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSeat) : null;
  } catch {
    return null;
  }
}

function storeSeat(s: StoredSeat | null): void {
  try {
    if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export type OnlineIntent =
  | { kind: 'create'; settings: RoomSettings; nickname: string }
  | { kind: 'join'; code: string; nickname: string }
  | { kind: 'resume'; code: string; token: string };

export interface RoomListener {
  room(room: RoomView, mySeat: Seat): void;
  lag(result: LagResult): void;
  error(code: ErrorCode, message: string): void;
  status(status: SocketStatus): void;
}

/** Server-authoritative session. Spans lobby → lag → game → rematch for one room. */
export class OnlineSession implements Session {
  readonly kind = 'online' as const;
  private socket: GameSocket;
  private listeners = new Set<(e: SessionEvent) => void>();
  private roomListeners = new Set<RoomListener>();
  private intent: OnlineIntent;
  private lastAimSent = 0;
  private pendingAim: RemoteAim | null = null;
  private aimTimer = 0;

  seat: Seat | null = null;
  code: string | null = null;
  room: RoomView | null = null;
  state!: MatchState;
  private clock: ClockView = { deadline: null, total: 0, paused: false };
  private conn: ConnectionStatus = 'reconnecting';
  private left = false;

  constructor(intent: OnlineIntent) {
    this.intent = intent;
    this.socket = new GameSocket({
      onOpen: () => this.hello(),
      onMessage: (m) => this.onMessage(m),
      onStatus: (s) => {
        this.conn = s === 'open' ? 'connected' : 'reconnecting';
        for (const l of this.roomListeners) l.status(s);
        this.emitConnection();
      },
    });
  }

  get settings(): RoomSettings {
    return this.room!.settings;
  }

  get mySeats(): readonly Seat[] {
    return this.seat === null ? [] : [this.seat];
  }

  get hasMatch(): boolean {
    return this.state !== undefined;
  }

  private hello(): void {
    const p = NET.protocolVersion;
    // After the first join, every reconnect is a resume with our token.
    const stored = storedSeat();
    if (this.code && stored && stored.code === this.code) {
      this.socket.send({ type: 'resume', protocol: p, code: stored.code, token: stored.token });
      return;
    }
    const i = this.intent;
    if (i.kind === 'create') {
      // RoomSettings is the hand-written type; the wire schema is its zod-validated equivalent.
      const settings = i.settings as Extract<ClientMessage, { type: 'createRoom' }>['settings'];
      this.socket.send({ type: 'createRoom', protocol: p, nickname: i.nickname, settings });
    }
    else if (i.kind === 'join') this.socket.send({ type: 'joinRoom', protocol: p, code: i.code, nickname: i.nickname });
    else this.socket.send({ type: 'resume', protocol: p, code: i.code, token: i.token });
  }

  onRoom(l: RoomListener): () => void {
    this.roomListeners.add(l);
    if (this.room && this.seat !== null) l.room(this.room, this.seat);
    return () => this.roomListeners.delete(l);
  }

  subscribe(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    if (this.state) fn({ type: 'state', state: this.state });
    fn({ type: 'clock', clock: this.clock });
    this.emitConnection(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }

  private emitConnection(fn?: (e: SessionEvent) => void): void {
    const opp = this.seat !== null ? this.room?.seats[other(this.seat)] : null;
    const e: SessionEvent = {
      type: 'connection',
      status: this.conn,
      opponentConnected: !opp || opp.connected,
      opponentDeadline: opp && !opp.connected && opp.graceRemainingMs !== null ? Date.now() + opp.graceRemainingMs : null,
    };
    if (fn) fn(e);
    else this.emit(e);
  }

  private setClock(c: { seat: Seat; remainingMs: number; totalSeconds: number; paused: boolean } | null): void {
    this.clock = c
      ? { deadline: Date.now() + c.remainingMs, total: c.totalSeconds, paused: c.paused, pausedRemaining: c.paused ? c.remainingMs : undefined }
      : { deadline: null, total: 0, paused: false };
    this.emit({ type: 'clock', clock: this.clock });
  }

  private onMessage(m: ServerMessage): void {
    switch (m.type) {
      case 'joined':
        this.seat = m.seat;
        this.code = m.code;
        storeSeat({ code: m.code, token: m.token });
        this.setRoom(m.room);
        return;
      case 'room':
        this.setRoom(m.room);
        return;
      case 'match':
        this.state = m.state;
        this.emit({ type: 'state', state: m.state });
        this.setClock(m.clock);
        if (this.room) this.setRoom(this.room);
        return;
      case 'shot':
        this.state = m.state;
        this.setClock(null);
        this.emit({
          type: 'shot',
          shot: { shooter: m.shooter, start: m.start, cueBall: m.cueBall, input: m.input, final: m.final, verdict: m.verdict, state: m.state },
        });
        return;
      case 'verdict':
        this.state = m.state;
        this.setClock(null);
        this.emit({ type: 'verdict', verdict: m.verdict, state: m.state });
        return;
      case 'clock':
        this.setClock(m.clock);
        return;
      case 'aim':
        this.emit({ type: 'aim', aim: m.aim });
        return;
      case 'lag':
        for (const l of this.roomListeners) l.lag(m.result);
        return;
      case 'error':
        if (m.code === 'badToken' || m.code === 'roomNotFound') {
          storeSeat(null);
          if (this.code) {
            this.left = true;
            this.socket.close();
          }
        }
        for (const l of this.roomListeners) l.error(m.code, m.message);
        if (this.state) this.emit({ type: 'notice', text: m.message });
        return;
      case 'left':
        storeSeat(null);
        return;
      case 'pong':
        return;
    }
  }

  private setRoom(room: RoomView): void {
    this.room = room;
    if (this.seat !== null) for (const l of this.roomListeners) l.room(room, this.seat);
    this.emitConnection();
  }

  // --- Commands --------------------------------------------------------------------------------

  setReady(ready: boolean): void {
    this.socket.send({ type: 'ready', ready });
  }

  lagShot(input: ShotInput): void {
    this.socket.send({ type: 'lagShot', input });
  }

  shoot(req: ShotRequest): void {
    if (!this.state) return;
    this.socket.send({ type: 'shoot', seq: this.state.shots, input: req.input, cueBallPos: req.cueBallPos });
  }

  /** Aim preview, throttled to NET.aimPreviewHz with a trailing send so the last aim arrives. */
  sendAim(aim: RemoteAim): void {
    this.pendingAim = aim;
    const gap = 1000 / NET.aimPreviewHz;
    const wait = this.lastAimSent + gap - performance.now();
    if (wait <= 0) this.flushAim();
    else if (!this.aimTimer) this.aimTimer = window.setTimeout(() => this.flushAim(), wait);
  }

  private flushAim(): void {
    window.clearTimeout(this.aimTimer);
    this.aimTimer = 0;
    if (!this.pendingAim) return;
    const a = this.pendingAim;
    this.pendingAim = null;
    this.lastAimSent = performance.now();
    this.socket.send({ type: 'aim', aim: { angle: a.angle, power: a.power, spinX: a.spinX, spinY: a.spinY, cueBallPos: a.cueBallPos } });
  }

  useTimeout(): void {
    this.socket.send({ type: 'timeout' });
  }

  animationDone(): void {
    // The server owns the clock.
  }

  claimForfeit(): void {
    this.socket.send({ type: 'claimForfeit' });
  }

  keepWaiting(): void {
    this.socket.send({ type: 'keepWaiting' });
  }

  requestRematch(): void {
    this.socket.send({ type: 'rematch' });
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    this.socket.send({ type: 'leave' });
    storeSeat(null);
    window.setTimeout(() => this.socket.close(), 100);
  }

  /** Close without forfeiting (e.g. navigating away from a finished game). */
  close(): void {
    this.left = true;
    storeSeat(null);
    this.socket.close();
  }
}
