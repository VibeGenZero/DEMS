---
id: run-and-debug
title: How to run and debug DEMS locally
type: howto
tags: [howto, local, development, debug, mock, docker, troubleshooting]
sources: [package.json, dev/start.js, utils/debugLog.js, compose.dev.yaml, server.js]
depends_on: [configuration, dev-mock-mode]
see_also: [docker, testing, known-issues]
---
# How to run and debug DEMS locally

> TL;DR: Fastest path: `npm install && npm run dev:mock` → http://localhost:3000 → "Mit Discord anmelden" → pick a persona. Real Discord: fill `.env`, `npm run dev`. Add `DEBUG_MODE=true` for request/DB/bot traces and the `#debug` styling guide. `npm run dev:reset` restores the dummy data.

## Modes

| Command | Needs | What you get |
|---|---|---|
| `npm run dev:mock` | nothing (Node ≥ 22) | mock mode, seeded `data/dems.dev.sqlite`, personas, `[MOCK-DISCORD]` logs, nodemon reload |
| `npm run dev:reset` | — | wipe + reseed the dev database (works while running) |
| `npm run dev` | `.env` with Discord values + `SESSION_SECRET` | real Discord, SQLite (or PostgreSQL with `DATABASE_URL`), nodemon reload |
| `npm start` | `.env` | like production, no reload |
| `docker compose -f compose.dev.yaml up --build` | Docker | mock mode in a container (port bound to 127.0.0.1) |
| `npm test` | — | all node:test suites |
| `npm run test:e2e` | `npx playwright install chromium` once | browser smoke tour (Playwright) in mock mode on its own port and database, desktop + phone |

Nodemon ignores `data/`, `public/`, `docs/`, `landing/`, `test/` — frontend edits need only a browser reload.

`package.json` `overrides` lifts nodemon's `minimatch` to `^11.0.8` (Dependabot alert 1, GHSA-g3hv-75wg-m249: every 10.x is affected, nodemon 3.1.14 still asks for `^10.2.1`). nodemon only calls `minimatch(file, pattern, { dot, nocase, windowsPathsNoEscape })`, which 11 keeps. Drop the override once a nodemon release depends on minimatch 11.

## Useful data in mock mode

Personas `admin`, `raider`, `member`, `newbie` (`/auth/dev-login/<id>`); check-in code of the running event `DEMO42`; admin reset/panic password `dev`; event ids `dev-event-*` (see `EVENT_ID` in `dev/seedData.js`).

## Debugging

- `DEBUG_MODE=true`: colored request log (`[DEBUG hh:mm:ss] METHOD /path → status (ms)`), body with redacted secrets, `debugLog(...)` traces, `#debug` section + verbose frontend logging toggle in the profile.
- Frontend: browser devtools; set `window.VERBOSE_LOG = true` (only effective in debug mode).
- Bot: watch the console; without a token every helper returns `false`/`[]`.

## Common errors

| Message / symptom | Fix |
|---|---|
| `SESSION_SECRET ist nicht gesetzt` | set it in `.env` (or use `npm run dev:mock`) |
| `Keine PostgreSQL-Verbindung konfiguriert` | production needs PostgreSQL: start with `compose.yaml` or set `DATABASE_URL`/`PGHOST` |
| `PostgreSQL nicht erreichbar` / `Start abgebrochen` | database down or wrong credentials (DEMS retries 60 s); a failing migration step names itself |
| `Server konnte nicht auf Port 3000 starten` | port in use → change `PORT` |
| 429 "Zu viele Anfragen" while developing | rate limits (`/auth` 30 / 15 min); restart or use mock mode |
| stuck on "Initialisiere System..." | page opened via `http://<ip>` instead of localhost/HTTPS ([security](../concepts/security.md)) |
| `DEV_MOCK=true ist in Produktion ... nicht erlaubt` | `NODE_ENV=production` is set — mock mode is dev-only |
