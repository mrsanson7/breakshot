/** Server settings from environment variables (see README → 배포). */
export interface ServerConfig {
  port: number;
  host: string;
  /** Built client to serve (production). Empty = API/WebSocket only. */
  staticDir: string;
  /** Comma-separated allowed Origin headers for WebSocket upgrades; empty = allow all. */
  allowedOrigins: string[];
  maxRooms: number;
  /** Room sweep interval (ms). */
  sweepIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv.slice(2)): ServerConfig {
  // `--static <dir>` lets `pnpm serve` serve the built client without setting env vars (works on Windows too).
  const staticArg = argv.indexOf('--static');
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    port: num(env.PORT ?? env.SERVER_PORT, 8787),
    host: env.HOST ?? '0.0.0.0',
    staticDir: env.STATIC_DIR ?? (staticArg >= 0 ? (argv[staticArg + 1] ?? '') : ''),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxRooms: num(env.MAX_ROOMS, 500),
    sweepIntervalMs: num(env.SWEEP_INTERVAL_MS, 30_000),
  };
}
