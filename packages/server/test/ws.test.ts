import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { NET, type ServerMessage } from '@breakshot/shared';
import { RoomManager } from '../src/rooms/roomManager';
import { attachWebSocket } from '../src/transport';
import { settings } from './helpers';

/** End-to-end over real sockets: two clients play a shot and see the same result. */
let server: Server;
let url: string;
const manager = new RoomManager({ maxRooms: 10 });

beforeAll(async () => {
  server = createServer();
  attachWebSocket(server, manager, { allowedOrigins: [], log: () => {} });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});
afterAll(async () => {
  manager.dispose();
  await new Promise((r) => server.close(r));
});

class Client {
  ws: WebSocket;
  inbox: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  constructor() {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.inbox.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
  }
  open() {
    return new Promise<void>((r) => this.ws.once('open', () => r()));
  }
  send(m: object) {
    this.ws.send(JSON.stringify(m));
  }
  raw(s: string) {
    this.ws.send(s);
  }
  wait<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) {
    const found = this.inbox.find((m) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>));
    if (found) return Promise.resolve(found as Extract<ServerMessage, { type: T }>);
    return new Promise<Extract<ServerMessage, { type: T }>>((resolve) =>
      this.waiters.push({ pred: (m) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>), resolve: resolve as (m: ServerMessage) => void }),
    );
  }
}

describe('websocket end-to-end', () => {
  it('create → join → ready → shot: both clients receive the same authoritative result', async () => {
    const a = new Client();
    const b = new Client();
    await Promise.all([a.open(), b.open()]);
    a.send({ type: 'createRoom', protocol: NET.protocolVersion, nickname: 'A', settings: settings({}, { shotClock: 0 }) });
    const joined = await a.wait('joined');
    b.send({ type: 'joinRoom', protocol: NET.protocolVersion, code: joined.code, nickname: 'B' });
    await b.wait('joined');
    a.send({ type: 'ready', ready: true });
    b.send({ type: 'ready', ready: true });
    const start = await a.wait('match');
    const mover = start.state.current === 0 ? a : b;
    const idle = mover === a ? b : a;

    idle.send({ type: 'shoot', seq: 0, input: { angle: 0, power: 0.5, spinX: 0, spinY: 0 } });
    expect((await idle.wait('error')).code).toBe('notYourTurn');

    mover.send({ type: 'shoot', seq: 0, input: { angle: 0.25, power: 0.7, spinX: 0.2, spinY: 0.1 } });
    const [ra, rb] = await Promise.all([a.wait('shot'), b.wait('shot')]);
    expect(ra).toEqual(rb);
    expect(ra.state.shots).toBe(1);

    a.raw('not json');
    expect((await a.wait('error', (e) => e.code === 'badMessage')).code).toBe('badMessage');
    a.ws.close();
    b.ws.close();
  });

  it('refresh: a new socket resumes with the token and receives the whole game state', async () => {
    const a = new Client();
    const b = new Client();
    await Promise.all([a.open(), b.open()]);
    a.send({ type: 'createRoom', protocol: NET.protocolVersion, nickname: 'A', settings: settings() });
    const joined = await a.wait('joined');
    b.send({ type: 'joinRoom', protocol: NET.protocolVersion, code: joined.code, nickname: 'B' });
    await b.wait('joined');
    a.send({ type: 'ready', ready: true });
    b.send({ type: 'ready', ready: true });
    const m = await b.wait('match');
    a.ws.close();
    await b.wait('room', (r) => !r.room.seats[0]!.connected);
    const a2 = new Client();
    await a2.open();
    a2.send({ type: 'resume', protocol: NET.protocolVersion, code: joined.code, token: joined.token });
    const back = await a2.wait('match');
    expect(back.state).toEqual(m.state);
    expect((await a2.wait('joined')).seat).toBe(0);
    a2.ws.close();
    b.ws.close();
  });
});
