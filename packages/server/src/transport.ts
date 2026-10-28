import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { NET, parseClientMessage, type ServerMessage } from '@breakshot/shared';
import type { Conn } from './rooms/room';
import type { RoomManager } from './rooms/roomManager';

/** Attach the game WebSocket endpoint (/ws) to an HTTP server. */
export function attachWebSocket(server: Server, manager: RoomManager, opts: { allowedOrigins: string[]; log: (m: string) => void }): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: NET.maxMessageBytes });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    const origin = req.headers.origin ?? '';
    if (opts.allowedOrigins.length > 0 && !opts.allowedOrigins.includes(origin)) {
      opts.log(`rejected origin ${origin}`);
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const conn: Conn = {
      id: randomUUID(),
      send(msg: ServerMessage) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    let alive = true;
    // Simple per-second message budget.
    let windowStart = Date.now();
    let count = 0;

    ws.on('pong', () => (alive = true));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > NET.maxMessagesPerSecond) {
        if (count === NET.maxMessagesPerSecond + 1) conn.send({ type: 'error', code: 'rateLimited', message: '메시지가 너무 많습니다.' });
        return;
      }
      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) {
        conn.send({ type: 'error', code: 'badMessage', message: parsed.error });
        return;
      }
      try {
        manager.handle(conn, parsed.msg);
      } catch (e) {
        opts.log(`handler error: ${(e as Error).stack ?? e}`);
        conn.send({ type: 'error', code: 'badMessage', message: 'server error' });
      }
    });
    ws.on('close', () => manager.onClose(conn));
    ws.on('error', () => ws.terminate());

    const hb = setInterval(() => {
      if (!alive) {
        clearInterval(hb);
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, NET.heartbeatMs);
    ws.on('close', () => clearInterval(hb));
  });

  return wss;
}
