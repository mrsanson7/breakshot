import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NET, defaultSettings, parseClientMessage, type ClientMessage, type RoomSettings } from '@breakshot/shared';
import { RoomManager } from '../src/rooms/roomManager';
import { FakeConn, settings } from './helpers';

const msg = (m: object) => {
  const r = parseClientMessage(JSON.stringify(m));
  if (!r.ok) throw new Error(r.error);
  return r.msg as ClientMessage;
};
const create = (s: RoomSettings, nickname = 'Alice') => msg({ type: 'createRoom', protocol: NET.protocolVersion, nickname, settings: s });
const shot = (seq: number, power = 0.5, angle = 0.3) => msg({ type: 'shoot', seq, input: { angle, power, spinX: 0, spinY: 0 } });

/** Two players in a started room (random break decided by `random`). */
function startedRoom(s: RoomSettings = settings(), random = () => 0.1) {
  const mgr = new RoomManager({ maxRooms: 10, random, code: () => 'ABCDEF' });
  const a = new FakeConn();
  const b = new FakeConn();
  mgr.handle(a, create(s));
  mgr.handle(b, msg({ type: 'joinRoom', protocol: NET.protocolVersion, code: 'abcdef', nickname: 'Bob' }));
  mgr.handle(a, msg({ type: 'ready', ready: true }));
  mgr.handle(b, msg({ type: 'ready', ready: true }));
  return { mgr, a, b, room: mgr.rooms.get('ABCDEF')! };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('rooms and lobby', () => {
  it('creates a room with a 6-character code and seats the host', () => {
    const mgr = new RoomManager({ maxRooms: 10 });
    const a = new FakeConn();
    mgr.handle(a, create(settings()));
    const j = a.last('joined')!;
    expect(j.code).toMatch(new RegExp(`^[${NET.roomCodeAlphabet}]{6}$`));
    expect(j.seat).toBe(0);
    expect(j.token.length).toBeGreaterThanOrEqual(16);
  });

  it('joins by code (case-insensitive) and rejects a third player / unknown code', () => {
    const { mgr } = startedRoom();
    const c = new FakeConn();
    mgr.handle(c, msg({ type: 'joinRoom', protocol: NET.protocolVersion, code: 'ABCDEF', nickname: 'Eve' }));
    expect(c.last('error')!.code).toBe('roomFull');
    mgr.handle(c, msg({ type: 'joinRoom', protocol: NET.protocolVersion, code: 'ZZZZZZ', nickname: 'Eve' }));
    expect(c.last('error')!.code).toBe('roomNotFound');
  });

  it('starts the match when both are ready; both get the same initial state', () => {
    const { a, b, room } = startedRoom();
    expect(room.phase).toBe('playing');
    expect(a.last('match')!.state).toEqual(b.last('match')!.state);
    expect(a.last('match')!.state.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
  });

  it('honours a fixed first breaker (host / guest) regardless of the coin', () => {
    expect(startedRoom(settings({ breakDecision: 'host' }), () => 0.9).a.last('match')!.state.current).toBe(0);
    expect(startedRoom(settings({ breakDecision: 'guest' }), () => 0.1).a.last('match')!.state.current).toBe(1);
  });

  it('rejects invalid settings at the schema level', () => {
    const bad = { ...defaultSettings('threeCushion'), ruleSet: 'wpa8' };
    expect(parseClientMessage(JSON.stringify({ type: 'createRoom', protocol: NET.protocolVersion, nickname: 'A', settings: bad })).ok).toBe(false);
    const hugeTarget = settings({}, { targetPoints: 100000 });
    expect(parseClientMessage(JSON.stringify({ type: 'createRoom', protocol: NET.protocolVersion, nickname: 'A', settings: hugeTarget })).ok).toBe(false);
  });
});

describe('server-authoritative shots', () => {
  it('rejects a shot from the player whose turn it is not', () => {
    const { mgr, a, b, room } = startedRoom();
    const mover = room.match!.current;
    const [turn, idle] = mover === 0 ? [a, b] : [b, a];
    mgr.handle(idle, shot(0));
    expect(idle.last('error')!.code).toBe('notYourTurn');
    expect(turn.all('shot')).toHaveLength(0);
  });

  it('rejects out-of-range power before it reaches the game', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'shoot', seq: 0, input: { angle: 0, power: 1.5, spinX: 0, spinY: 0 } })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'shoot', seq: 0, input: { angle: 0, power: 0, spinX: 0, spinY: 0 } })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'shoot', seq: 0, input: { angle: 0, power: 0.5, spinX: 0.9, spinY: 0.9 } })).ok).toBe(false);
    expect(parseClientMessage('{"type":"shoot"').ok).toBe(false);
  });

  it('simulates once and sends both players the identical result', () => {
    const { mgr, a, b, room } = startedRoom();
    const mover = room.match!.current === 0 ? a : b;
    mgr.handle(mover, shot(0, 0.6, 0.2));
    const sa = a.last('shot')!;
    const sb = b.last('shot')!;
    expect(sa).toEqual(sb);
    expect(sa.final).toEqual(room.match!.balls);
    expect(room.match!.shots).toBe(1);
  });

  it('rejects a stale or duplicated shot (sequence number)', () => {
    const { mgr, a, b, room } = startedRoom(settings({}, { shotClock: 0 }));
    const first = room.match!.current;
    const mover = first === 0 ? a : b;
    mgr.handle(mover, shot(0));
    mgr.handle(mover, shot(0));
    expect(mover.all('shot').length).toBe(1);
    expect(['staleShot', 'notYourTurn']).toContain(mover.last('error')!.code);
  });

  it('relays the aim preview only to the opponent and only from the shooter', () => {
    const { mgr, a, b, room } = startedRoom();
    const [turn, idle] = room.match!.current === 0 ? [a, b] : [b, a];
    mgr.handle(turn, msg({ type: 'aim', aim: { angle: 1, power: 0.2, spinX: 0, spinY: 0 } }));
    mgr.handle(idle, msg({ type: 'aim', aim: { angle: 2, power: 0.2, spinX: 0, spinY: 0 } }));
    expect(idle.all('aim')).toHaveLength(1);
    expect(turn.all('aim')).toHaveLength(0);
  });
});

describe('shot clock', () => {
  it('runs on the server; on expiry the turn passes', () => {
    const { a, b, room } = startedRoom(settings({}, { shotClock: 40 }));
    vi.advanceTimersByTime(10);
    const first = room.match!.current;
    expect(a.last('clock')!.clock!.seat).toBe(first);
    vi.advanceTimersByTime(40_000);
    expect(b.last('verdict')!.verdict.foul).toBe('timeViolation');
    expect(room.match!.current).toBe(1 - first);
  });

  it('an extension adds time', () => {
    const { mgr, a, b, room } = startedRoom(settings({}, { shotClock: 40, timeouts: 1, extensionSeconds: 40 }));
    vi.advanceTimersByTime(10);
    const first = room.match!.current;
    const mover = first === 0 ? a : b;
    vi.advanceTimersByTime(30_000);
    mgr.handle(mover, msg({ type: 'timeout' }));
    vi.advanceTimersByTime(30_000);
    expect(room.match!.current).toBe(first); // would have expired without the extension
    vi.advanceTimersByTime(25_000);
    expect(room.match!.current).toBe(1 - first);
    mgr.handle(mover, msg({ type: 'timeout' }));
  });
});

describe('disconnects', () => {
  it('a reconnecting player gets the full state back with the same seat', () => {
    const { mgr, a, b, room } = startedRoom();
    const token = a.last('joined')!.token;
    mgr.onClose(a);
    expect(b.last('room')!.room.seats[0]!.connected).toBe(false);
    const a2 = new FakeConn();
    mgr.handle(a2, msg({ type: 'resume', protocol: NET.protocolVersion, code: 'ABCDEF', token }));
    expect(a2.last('joined')!.seat).toBe(0);
    expect(a2.last('match')!.state).toEqual(room.match);
    expect(b.last('room')!.room.seats[0]!.connected).toBe(true);
  });

  it('pauses the shot clock while the shooter is away', () => {
    const { mgr, a, b, room } = startedRoom(settings({}, { shotClock: 40 }));
    vi.advanceTimersByTime(10);
    const first = room.match!.current;
    const [mover, other] = first === 0 ? [a, b] : [b, a];
    const token = mover.last('joined')!.token;
    vi.advanceTimersByTime(10_000);
    mgr.onClose(mover);
    expect(other.last('clock')!.clock!.paused).toBe(true);
    vi.advanceTimersByTime(50_000);
    expect(room.match!.current).toBe(first);
    const back = new FakeConn();
    mgr.handle(back, msg({ type: 'resume', protocol: NET.protocolVersion, code: 'ABCDEF', token }));
    expect(Math.round(back.last('clock')!.clock!.remainingMs / 1000)).toBe(30);
  });

  it('forfeit can be claimed only after the grace period; waiting extends it', () => {
    const { mgr, a, b, room } = startedRoom();
    mgr.onClose(b);
    mgr.handle(a, msg({ type: 'claimForfeit' }));
    expect(a.last('error')!.code).toBe('tooEarly');
    vi.advanceTimersByTime(NET.reconnectGraceSeconds * 1000);
    mgr.handle(a, msg({ type: 'keepWaiting' }));
    mgr.handle(a, msg({ type: 'claimForfeit' }));
    expect(room.phase).toBe('playing');
    vi.advanceTimersByTime(NET.reconnectExtendSeconds * 1000);
    mgr.handle(a, msg({ type: 'claimForfeit' }));
    expect(room.phase).toBe('finished');
    expect(room.match!.winner).toBe(0);
  });

  it('leaving a running match forfeits it', () => {
    const { mgr, a, room } = startedRoom();
    mgr.handle(a, msg({ type: 'leave' }));
    expect(room.match!.winner).toBe(1);
    expect(room.phase).toBe('finished');
  });

  it('empty rooms are swept', () => {
    const { mgr, a, b } = startedRoom();
    mgr.onClose(a);
    mgr.onClose(b);
    vi.advanceTimersByTime(NET.emptyRoomTtlMs + 1);
    mgr.sweep();
    expect(mgr.rooms.size).toBe(0);
  });
});

describe('lag and rematch', () => {
  it('lag: both shoot, the ball closer to the head cushion breaks', () => {
    const { mgr, a, b, room } = startedRoom(settings({ breakDecision: 'lag' }));
    expect(room.phase).toBe('lag');
    // Seat 0 soft (comes back less), seat 1 harder — whichever ends nearer the head rail wins.
    mgr.handle(a, msg({ type: 'lagShot', input: { angle: 0, power: 0.32, spinX: 0, spinY: 0 } }));
    mgr.handle(b, msg({ type: 'lagShot', input: { angle: 0, power: 0.45, spinX: 0, spinY: 0 } }));
    const [la, lb] = room.lag;
    expect(a.all('lag')).toHaveLength(2);
    vi.advanceTimersByTime(NET.setOverDelayMs + 5000);
    expect(room.phase).toBe('playing');
    const expected = la!.distance === null ? 1 : lb!.distance === null ? 0 : la!.distance < lb!.distance ? 0 : 1;
    expect(room.match!.breaker).toBe(expected);
  });

  it('rematch starts a new game once both ask, with the other player breaking', () => {
    const { mgr, a, b, room } = startedRoom();
    const firstBreaker = room.firstBreaker!;
    // End the game: b drops, the grace period passes, a claims the win, b comes back.
    const tokenB = b.last('joined')!.token;
    mgr.onClose(b);
    vi.advanceTimersByTime(NET.reconnectGraceSeconds * 1000);
    mgr.handle(a, msg({ type: 'claimForfeit' }));
    expect(room.phase).toBe('finished');
    const b2 = new FakeConn();
    mgr.handle(b2, msg({ type: 'resume', protocol: NET.protocolVersion, code: 'ABCDEF', token: tokenB }));
    mgr.handle(a, msg({ type: 'rematch' }));
    expect(room.phase).toBe('finished');
    mgr.handle(b2, msg({ type: 'rematch' }));
    expect(room.phase).toBe('playing');
    expect(room.firstBreaker).toBe(1 - firstBreaker);
    expect(room.match!.shots).toBe(0);
  });
});
