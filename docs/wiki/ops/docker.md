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

> TL;DR: Multi-stage `Dockerfile` on `node:24-bookworm-slim`: `runtime` (default, production: non-root `node` user, `NODE_ENV=production`, uploaded banners (`/app/data/uploads`, W-12) on volume `/app/data`, healthcheck `GET /healthz`) and `dev` (all deps, nodemon polling, used by `compose.dev.yaml`). `compose.yaml` runs production from `.env` together with PostgreSQL and a generated database password; `compose.dev.yaml` runs the dev mock mode with the source bind-mounted.

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
| `compose.yaml` | production build + run | three services: `db-secret` (one-shot `postgres:18-alpine`: writes a random password to `db_password` in volume `dems-secrets` if missing, `chmod 0444`), `postgres` (`postgres:18-alpine`, db/user `dems`, `POSTGRES_PASSWORD_FILE`, data in volume `dems-pg` at `/var/lib/postgresql`, healthcheck `pg_isready`, **no ports**), `dems` (`env_file` `.env` with `required: false` (#138: without `.env` DEMS starts its setup wizard); a value in `.env` wins over the stored configuration; pinned `NODE_ENV=production`, `PORT=3000`, `PGHOST=postgres`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD_FILE=/run/dems-secrets/db_password`; port `${DEMS_PORT:-3000}:3000`; volumes `dems-data` + `dems-secrets` read-only; `depends_on` postgres healthy; `init: true`; `restart: unless-stopped`) |
| `compose.dev.yaml` | dev mock mode | target `dev`; optional `.env`; `127.0.0.1:${DEMS_DEV_PORT:-3000}:3000`; bind mount `.:/app` + anonymous `/app/node_modules` + volume `dems-dev-data` |

## First start without .env (#138)

`docker compose up -d --build` with no `.env` brings up PostgreSQL (password generated) and DEMS in setup mode. The setup PIN is in the log: `docker compose logs dems | grep Setup-PIN` (a new PIN on every start until the setup is done). Open DEMS via HTTPS (behind the TLS proxy; the production image keeps the session only over HTTPS, so plain `http://localhost:<DEMS_PORT>` shows a warning instead), enter the PIN and complete the wizard; its values live in PostgreSQL (volume `dems-pg`), so a restart or an image update keeps them. A `.env` can still set any value; it then shows as locked („aus .env“). See [security](../concepts/security.md#first-run-setup-138).

## Commands

```bash
docker compose up -d --build                          # production
docker compose -f compose.dev.yaml up --build         # dev mock mode
docker compose -f compose.dev.yaml up --build -V      # after dependency changes (fresh node_modules volume)
docker compose -f compose.dev.yaml exec dems-dev npm run dev:reset
docker build -t <user>/dems:latest . && docker push <user>/dems:latest
```

Published image: private Docker Hub repository `moritakahashi/dems` (tags `latest` + commit sha); see [deployment](deployment.md).

CI builds both targets, starts `compose.yaml` with a dummy `.env` and waits for the HEALTHCHECK of `dems` in the `docker-build` job, without pushing; see [ci](ci.md). The runtime image alone does not start (production needs PostgreSQL).

## .dockerignore

Excludes `node_modules/`, `.env*` (except `.env.example`), `data/`, `*.sqlite*`, `.git/`, IDE folders, `docs/`, `scripts/`, `test/`, `landing/`, `ci/`, `.github/`, `.gitlab-ci.yml`, `*.md`, Docker files. The image therefore contains no secrets, docs, tests or CI files.

## Gotchas

- SIGTERM reaches `gracefulShutdown` because the CMD runs `node` directly (not `npm`) and compose uses `init: true`.
- The dev container runs as root (bind-mount convenience); never deploy the `dev` target.
- File watching in the dev container needs polling (`--legacy-watch`) on Windows/macOS hosts.
