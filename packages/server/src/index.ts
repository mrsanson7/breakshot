import { createServer } from 'node:http';
import { loadConfig } from './config';
import { RoomManager } from './rooms/roomManager';
import { staticHandler } from './static';
import { attachWebSocket } from './transport';

const config = loadConfig();
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const manager = new RoomManager({ maxRooms: config.maxRooms, log });
const serveStatic = staticHandler(config.staticDir);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size }));
    return;
  }
  if (serveStatic(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Break Shot game server. WebSocket endpoint: /ws');
});

attachWebSocket(server, manager, { allowedOrigins: config.allowedOrigins, log });
const sweep = setInterval(() => manager.sweep(), config.sweepIntervalMs);

server.listen(config.port, config.host, () => {
  log(`Break Shot server listening on http://${config.host}:${config.port} (ws: /ws)${config.staticDir ? `, serving ${config.staticDir}` : ''}`);
});

const shutdown = () => {
  clearInterval(sweep);
  manager.dispose();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
