import { NET, type ClientMessage, type ServerMessage } from '@breakshot/shared';

export type SocketStatus = 'connecting' | 'open' | 'closed';

/** Game server URL: same origin by default (Vite proxies /ws in dev); VITE_SERVER_URL overrides. */
export function serverUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/**
 * WebSocket with automatic reconnection (exponential backoff). `onOpen` runs on every
 * (re)connection so the session can resume its seat.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer = 0;
  private closedByUser = false;
  status: SocketStatus = 'connecting';

  constructor(
    private readonly handlers: {
      onOpen(): void;
      onMessage(msg: ServerMessage): void;
      onStatus(status: SocketStatus): void;
    },
    private readonly url = serverUrl(),
  ) {
    this.connect();
    window.addEventListener('online', this.retryNow);
  }

  private retryNow = (): void => {
    if (this.status === 'closed' && !this.closedByUser) {
      window.clearTimeout(this.timer);
      this.connect();
    }
  };

  private connect(): void {
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
      this.handlers.onOpen();
    };
    ws.onmessage = (ev) => {
      try {
        this.handlers.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
      } catch (e) {
        console.error('bad server message', e);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('closed');
      if (this.closedByUser) return;
      const delays = NET.reconnectBackoffMs;
      const delay = delays[Math.min(this.attempt++, delays.length - 1)];
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private setStatus(s: SocketStatus): void {
    this.status = s;
    this.handlers.onStatus(s);
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.closedByUser = true;
    window.clearTimeout(this.timer);
    window.removeEventListener('online', this.retryNow);
    this.ws?.close();
    this.ws = null;
  }
}
