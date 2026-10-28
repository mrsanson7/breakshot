import { defineConfig } from 'vite';

// The game server (packages/server) listens on SERVER_PORT; in dev Vite proxies /ws to it so the
// client always connects to its own origin.
const serverPort = Number(process.env.SERVER_PORT ?? 8787);

export default defineConfig({
  server: {
    port: Number(process.env.CLIENT_PORT ?? 5173),
    host: true,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
