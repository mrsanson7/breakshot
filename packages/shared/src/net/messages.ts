import { z } from 'zod';
import { NET } from '../config/net';
import type { MatchState, Seat, Verdict } from '../game/state';
import type { BallPosition, ShotInput } from '../physics/types';
import { roomSettingsSchema, type RoomSettings } from './settings';

/**
 * WebSocket protocol. Every client → server message is validated with these zod schemas on the
 * server; server → client messages are typed only (the client trusts its server).
 */

const finite = z.number().finite();
const vec2 = z.object({ x: finite, y: finite });
const nickname = z
  .string()
  .trim()
  .min(1)
  .max(NET.nicknameMaxLength)
  .regex(/^[^\u0000-\u001f<>]+$/, 'invalid characters');
const roomCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(NET.roomCodeLength)
  .refine((s) => [...s].every((c) => NET.roomCodeAlphabet.includes(c)), 'invalid room code');

/** Range checks live here (|spin| ≤ 1, 0 < power ≤ 1) so bad input never reaches the engine. */
export const shotInputSchema = z
  .object({
    angle: finite.min(-100).max(100),
    power: finite.gt(0).max(1),
    spinX: finite.min(-1).max(1),
    spinY: finite.min(-1).max(1),
  })
  .refine((s) => Math.hypot(s.spinX, s.spinY) <= 1 + 1e-9, 'spin outside the ball');

export const aimSchema = z.object({
  angle: finite.min(-100).max(100),
  power: finite.min(0).max(1),
  spinX: finite.min(-1).max(1),
  spinY: finite.min(-1).max(1),
  cueBallPos: vec2.optional(),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('createRoom'), protocol: z.literal(NET.protocolVersion), nickname, settings: roomSettingsSchema }),
  z.object({ type: z.literal('joinRoom'), protocol: z.literal(NET.protocolVersion), code: roomCode, nickname }),
  z.object({ type: z.literal('resume'), protocol: z.literal(NET.protocolVersion), code: roomCode, token: z.string().min(16).max(64) }),
  z.object({ type: z.literal('ready'), ready: z.boolean() }),
  z.object({ type: z.literal('aim'), aim: aimSchema }),
  z.object({ type: z.literal('shoot'), seq: z.number().int().min(0), input: shotInputSchema, cueBallPos: vec2.optional() }),
  z.object({ type: z.literal('lagShot'), input: shotInputSchema }),
  z.object({ type: z.literal('timeout') }),
  z.object({ type: z.literal('claimForfeit') }),
  z.object({ type: z.literal('keepWaiting') }),
  z.object({ type: z.literal('rematch') }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('ping'), t: finite }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type AimMessage = z.infer<typeof aimSchema>;

// ------------------------------------------------------------------------------------------------
// Server → client

export type RoomPhase = 'lobby' | 'lag' | 'playing' | 'finished';

export interface PlayerSlotView {
  nickname: string;
  ready: boolean;
  connected: boolean;
  /** Milliseconds left before the opponent may claim a forfeit (only while disconnected). */
  graceRemainingMs: number | null;
  wantsRematch: boolean;
}

export interface RoomView {
  code: string;
  settings: RoomSettings;
  phase: RoomPhase;
  seats: [PlayerSlotView | null, PlayerSlotView | null];
  /** Lag results (뱅킹) when breakDecision = 'lag'. */
  lag: [LagResult | null, LagResult | null];
  /** Seat that broke first, once decided. */
  firstBreaker: Seat | null;
}

export interface ClockView {
  seat: Seat;
  /** Milliseconds remaining when the message was sent (clients add it to their own clock). */
  remainingMs: number;
  /** Clock length this period started from (s), for the gauge. */
  totalSeconds: number;
  paused: boolean;
}

export interface LagResult {
  seat: Seat;
  ballId: string;
  start: BallPosition;
  input: ShotInput;
  final: BallPosition;
  /** Distance from the head cushion (m); null if the lag was invalid (no foot rail, pocketed). */
  distance: number | null;
}

export type ErrorCode =
  | 'badMessage'
  | 'roomNotFound'
  | 'roomFull'
  | 'badToken'
  | 'notInRoom'
  | 'notYourTurn'
  | 'wrongPhase'
  | 'badInput'
  | 'placementRequired'
  | 'badPlacement'
  | 'staleShot'
  | 'noTimeouts'
  | 'tooEarly'
  | 'rateLimited'
  | 'serverFull';

export type ServerMessage =
  | { type: 'joined'; code: string; seat: Seat; token: string; room: RoomView }
  | { type: 'room'; room: RoomView }
  | { type: 'match'; state: MatchState; clock: ClockView | null }
  | {
      type: 'shot';
      seq: number;
      shooter: Seat;
      cueBall: string;
      input: ShotInput;
      start: BallPosition[];
      final: BallPosition[];
      verdict: Verdict;
      state: MatchState;
      /** Simulated duration (s): when the shot clock of the next turn starts. */
      duration: number;
    }
  | { type: 'verdict'; verdict: Verdict; state: MatchState }
  | { type: 'clock'; clock: ClockView | null }
  | { type: 'aim'; seat: Seat; aim: AimMessage }
  | { type: 'lag'; result: LagResult }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'left'; reason: 'left' | 'closed' }
  | { type: 'pong'; t: number; serverTime: number };

/** Parse and validate one raw client frame. */
export function parseClientMessage(raw: string): { ok: true; msg: ClientMessage } | { ok: false; error: string } {
  if (raw.length > NET.maxMessageBytes) return { ok: false, error: 'message too large' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  const r = clientMessageSchema.safeParse(data);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, msg: r.data };
}
