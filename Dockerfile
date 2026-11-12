# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

# ── Build base: Node + build tools ──────────────────────────────────────
# better-sqlite3 ships prebuilt binaries for linux x64/arm64. The build tools
# are only a fallback for platforms without a prebuild and never reach the
# production image.
FROM node:${NODE_VERSION}-bookworm-slim AS build-base
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# ── Stage: production dependencies ──────────────────────────────────────
FROM build-base AS deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ── Stage: dev mock mode (compose.dev.yaml) ─────────────────────────────
# All dependencies incl. nodemon. compose.dev.yaml mounts the source over
# /app; the copy below only makes the image usable on its own.
FROM build-base AS dev
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY . .
ENV NODE_ENV=development \
    PORT=3000
EXPOSE 3000
# Polling watcher: changes on Windows/macOS bind mounts send no inotify events
CMD ["npx", "nodemon", "--legacy-watch", "dev/start.js"]

# ── Stage: production runtime (default target, keep it last) ────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Set by the publish job (.github/workflows/ci.yml): edge | beta | latest and the
# commit sha. On edge the update check is off (utils/updateCheck.js).
ARG DEMS_CHANNEL=
ARG DEMS_COMMIT=
ENV DEMS_CHANNEL=$DEMS_CHANNEL \
    DEMS_COMMIT=$DEMS_COMMIT

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# Uploaded banners live on a volume so they survive container rebuilds.
# The data itself is in PostgreSQL (compose.yaml) or, for a single container
# without PostgreSQL, in the SQLite file /app/data/dems.sqlite on this volume.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Run node directly (not via npm) so SIGTERM reaches the graceful shutdown handler
CMD ["node", "server.js"]
