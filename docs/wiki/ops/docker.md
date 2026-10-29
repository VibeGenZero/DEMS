---
id: docker
title: Docker — image, stages, compose files
type: ops
tags: [docker, compose, container, image, healthcheck, volume]
sources: [Dockerfile, compose.yaml, compose.dev.yaml, .dockerignore]
depends_on: [configuration]
see_also: [deployment, dev-mock-mode]
---
# Docker — image, stages, compose files

> TL;DR: Multi-stage `Dockerfile` on `node:24-bookworm-slim`: `runtime` (default, production: non-root `node` user, `NODE_ENV=production`, SQLite and uploaded banners (`/app/data/uploads`, W-12) on volume `/app/data`, healthcheck `GET /healthz`) and `dev` (all deps, nodemon polling, used by `compose.dev.yaml`). `compose.yaml` runs production from `.env`; `compose.dev.yaml` runs the dev mock mode with the source bind-mounted.

## Dockerfile stages

| Stage | Base | Content |
|---|---|---|
| `build-base` | node:24-bookworm-slim | python3/make/g++ (fallback build of better-sqlite3), `package*.json` |
| `deps` | build-base | `npm ci --omit=dev` |
| `dev` | build-base | `npm ci` (incl. nodemon), `COPY . .`, `NODE_ENV=development`, `CMD npx nodemon --legacy-watch dev/start.js` |
| `runtime` (last = default) | node:24-bookworm-slim | prod `node_modules` from `deps`, app files, `USER node`, `VOLUME /app/data`, `HEALTHCHECK` on `/healthz`, `CMD node server.js` |

`runtime` must stay the LAST stage (default target); `compose.yaml` additionally pins `target: runtime`.

## Compose files

| File | Use | Key settings |
|---|---|---|
| `compose.yaml` | production build + run | `env_file: .env`; pinned `NODE_ENV=production`, `PORT=3000`, `SQLITE_PATH=/app/data/dems.sqlite`; port `${DEMS_PORT:-3000}:3000`; volume `dems-data`; `init: true`; `restart: unless-stopped` |
| `compose.dev.yaml` | dev mock mode | target `dev`; optional `.env`; `127.0.0.1:${DEMS_DEV_PORT:-3000}:3000`; bind mount `.:/app` + anonymous `/app/node_modules` + volume `dems-dev-data` |

## Commands

```bash
docker compose up -d --build                          # production
docker compose -f compose.dev.yaml up --build         # dev mock mode
docker compose -f compose.dev.yaml up --build -V      # after dependency changes (fresh node_modules volume)
docker compose -f compose.dev.yaml exec dems-dev npm run dev:reset
docker build -t <user>/dems:latest . && docker push <user>/dems:latest
```

Published image: private Docker Hub repository `moritakahashi/dems` (tags `latest` + commit sha); see [deployment](deployment.md).

GitLab CI builds both targets and waits for the runtime HEALTHCHECK in the `docker-build` job, without pushing; see [ci](ci.md).

## .dockerignore

Excludes `node_modules/`, `.env*` (except `.env.example`), `data/`, `*.sqlite*`, `.git/`, IDE folders, `docs/`, `scripts/`, `test/`, `landing/`, `ci/`, `.github/`, `.gitlab-ci.yml`, `*.md`, Docker files. The image therefore contains no secrets, docs, tests or CI files.

## Gotchas

- SIGTERM reaches `gracefulShutdown` because the CMD runs `node` directly (not `npm`) and compose uses `init: true`.
- The dev container runs as root (bind-mount convenience); never deploy the `dev` target.
- File watching in the dev container needs polling (`--legacy-watch`) on Windows/macOS hosts.
