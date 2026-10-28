import type { BallPosition, MatchState, RoomSettings, Seat, ShotInput, ShotRequest, Verdict } from '@breakshot/shared';
import type { RemoteAim } from '../game/scene';

/** A shot to animate, with its authoritative result. */
export interface ShotPlayback {
  shooter: Seat;
  start: BallPosition[];
  cueBall: string;
  input: ShotInput;
  final: BallPosition[];
  verdict: Verdict;
  /** Match state after the shot. */
  state: MatchState;
}

export interface ClockView {
  /** Local epoch ms when the shot clock runs out; null = no clock running. */
  deadline: number | null;
  /** Seconds the clock started from (for the gauge). */
  total: number;
  paused: boolean;
}

export type ConnectionStatus = 'local' | 'connected' | 'reconnecting' | 'offline';

export type SessionEvent =
  | { type: 'state'; state: MatchState }
  | { type: 'shot'; shot: ShotPlayback }
  | { type: 'verdict'; verdict: Verdict; state: MatchState }
  | { type: 'aim'; aim: RemoteAim | null }
  | { type: 'clock'; clock: ClockView }
  | { type: 'connection'; status: ConnectionStatus; opponentConnected: boolean; opponentDeadline: number | null }
  | { type: 'notice'; text: string };

export interface Session {
  readonly kind: 'practice' | 'online';
  readonly settings: RoomSettings;
  /** Seats controlled from this browser. */
  readonly mySeats: readonly Seat[];
  readonly state: MatchState;
  subscribe(fn: (e: SessionEvent) => void): () => void;
  shoot(req: ShotRequest): void;
  sendAim(aim: RemoteAim): void;
  useTimeout(): void;
  /** The scene finished animating the last shot (starts local clocks). */
  animationDone(): void;
  leave(): void;
  /** Practice-only helpers. */
  undo?(): void;
  restart?(): void;
  canUndo?(): boolean;
  /** Online-only: answer the "opponent disconnected" prompt. */
  claimForfeit?(): void;
  keepWaiting?(): void;
  requestRematch?(): void;
}
