import { NET, type ClientMessage, type Seat } from '@breakshot/shared';
import { roomCode, sessionToken } from './codes';
import { Room, type Conn, type RoomDeps } from './room';

export interface ManagerOptions {
  maxRooms: number;
  now?: () => number;
  random?: () => number;
  log?: (msg: string) => void;
  code?: () => string;
}

/** Routes connections to rooms; creates, resumes and garbage-collects rooms (memory only). */
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private seats = new Map<Conn, { room: Room; seat: Seat }>();
  private deps: RoomDeps;
  private newCode: () => string;

  constructor(private readonly opts: ManagerOptions) {
    this.deps = {
      now: opts.now ?? Date.now,
      random: opts.random ?? Math.random,
      token: sessionToken,
      log: opts.log ?? (() => {}),
    };
    this.newCode = opts.code ?? roomCode;
  }

  handle(conn: Conn, msg: ClientMessage): void {
    switch (msg.type) {
      case 'createRoom': {
        this.detach(conn);
        if (this.rooms.size >= this.opts.maxRooms) {
          conn.send({ type: 'error', code: 'serverFull', message: '서버에 방이 너무 많습니다.' });
          return;
        }
        let code = this.newCode();
        for (let i = 0; this.rooms.has(code) && i < 20; i++) code = this.newCode();
        const room = new Room(code, msg.settings, this.deps);
        this.rooms.set(code, room);
        const r = room.join(conn, msg.nickname)!;
        this.seats.set(conn, { room, seat: r.seat });
        this.deps.log(`room ${code} created (${msg.settings.ruleSet})`);
        return;
      }
      case 'joinRoom': {
        this.detach(conn);
        const room = this.rooms.get(msg.code);
        if (!room) return conn.send({ type: 'error', code: 'roomNotFound', message: '방을 찾을 수 없습니다.' });
        const r = room.join(conn, msg.nickname);
        if (!r) return conn.send({ type: 'error', code: 'roomFull', message: '방이 가득 찼거나 이미 시작했습니다.' });
        this.seats.set(conn, { room, seat: r.seat });
        return;
      }
      case 'resume': {
        this.detach(conn);
        const room = this.rooms.get(msg.code);
        if (!room) return conn.send({ type: 'error', code: 'roomNotFound', message: '방이 종료되었습니다.' });
        // A stale socket for the same seat (e.g. refresh before close) is superseded.
        for (const [c, at] of this.seats) {
          if (at.room === room && room.slots[at.seat]?.token === msg.token && c !== conn) this.seats.delete(c);
        }
        const seat = room.resume(conn, msg.token);
        if (seat === null) return conn.send({ type: 'error', code: 'badToken', message: '재접속 정보가 맞지 않습니다.' });
        this.seats.set(conn, { room, seat });
        return;
      }
      default: {
        const at = this.seats.get(conn);
        if (!at) return conn.send({ type: 'error', code: 'notInRoom', message: '방에 들어가 있지 않습니다.' });
        at.room.handle(at.seat, msg);
        if (msg.type === 'leave') this.seats.delete(conn);
      }
    }
  }

  /** Socket closed. */
  onClose(conn: Conn): void {
    const at = this.seats.get(conn);
    if (!at) return;
    this.seats.delete(conn);
    // Only the socket currently bound to the seat counts (a resumed seat has a newer one).
    if (at.room.slots[at.seat]?.conn === conn) at.room.disconnect(at.seat);
  }

  private detach(conn: Conn): void {
    const at = this.seats.get(conn);
    if (at) {
      at.room.leave(at.seat);
      this.seats.delete(conn);
    }
  }

  /** Remove abandoned and long-finished rooms. Call periodically. */
  sweep(): void {
    const now = this.deps.now();
    for (const [code, room] of this.rooms) {
      const empty = room.slots.every((s) => s === null);
      const abandoned = room.emptySince !== null && now - room.emptySince > NET.emptyRoomTtlMs;
      const stale = room.finishedAt !== null && now - room.finishedAt > NET.finishedRoomTtlMs;
      if (empty || abandoned || stale) {
        room.dispose();
        this.rooms.delete(code);
        for (const [c, at] of this.seats) if (at.room === room) this.seats.delete(c);
        this.deps.log(`room ${code} removed`);
      }
    }
  }

  dispose(): void {
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
  }
}
