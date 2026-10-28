# Break Shot — production image: the game server also serves the built client.
#   docker build -t breakshot .
#   docker run -p 8787:8787 breakshot     → http://localhost:8787

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
# VITE_SERVER_URL is only needed when the client is hosted on a different origin than the server.
ARG VITE_SERVER_URL=""
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/public
# The server bundle includes @breakshot/shared and its dependencies (zod, ws).
COPY --from=build /app/packages/server/dist/index.js ./server.js
COPY --from=build /app/packages/client/dist ./public
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "server.js"]
