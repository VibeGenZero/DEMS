---
id: configuration
title: Configuration — environment variables
type: ops
tags: [config, env, dotenv, secrets, discord, postgresql, sqlite]
sources: [.env.example, server.js, firebaseAdmin.js, db/config.js, dev/mockMode.js, compose.yaml, compose.dev.yaml]
see_also: [docker, deployment, dev-mock-mode]
---
# Configuration — environment variables

> TL;DR: All configuration comes from environment variables (loaded from `.env` by dotenv; in Docker passed via `env_file`). Only `SESSION_SECRET` is strictly required to start; real use also needs the Discord app values, `DISCORD_GUILD_ID` and `BASE_URL`. `.env.example` lists everything.

| Variable | Required | Default | Used for |
|---|---|---|---|
| `SESSION_SECRET` | **yes** | — | session signing; missing or `your_random_session_secret_here` → exit 1; changing it invalidates all stored sessions (everyone logged out) |
| `BASE_URL` | yes (prod) | `http://localhost:3000` fallback | OAuth redirect (`${BASE_URL}/auth/discord/callback`), links in Discord messages, CORS origin |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | yes (login) | — | OAuth2; client id also in the bot invite URL |
| `DISCORD_BOT_TOKEN` | no | — | bot login; empty → bot off, Discord helpers no-op |
| `DISCORD_GUILD_ID` | yes (login) | — | membership check at login, all guild helpers, slash command registration |
| `DISCORD_ADMIN_ROLE_ID` | practically yes | — | members with this role are admins; empty → nobody is admin |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | fallback | — | announcement channel of events and date polls while the bot center has no "Ankündigungskanal" chosen (B-02); with neither, announcing answers 400 |
| `DISCORD_EVENT_CATEGORY_ID` | no | — | parent category for auto-created event channels |
| `DISCORD_THREAD_SYNC` | no | off (`true` in dev mock mode) | `true` → comments of the event page and the event's Discord discussion thread are mirrored (B-16, [discord-integration](../concepts/discord-integration.md)); the bot then requests the privileged *Message Content* intent and needs „Webhooks verwalten“ + „Nachrichten verwalten“. Switch the intent on in the Developer Portal first, otherwise the login fails with "Used disallowed intents" and the bot stays offline |
| `SERVER_NAME` | no | Discord guild name / `DEMS` | name shown in the UI (`/api/server-info`) |
| `DATABASE_URL` | production: this or `PGHOST` | — | PostgreSQL connection URL (`postgres://user:pass@host:5432/db`); wins over `PG*`. Not needed with `compose.yaml` |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` | production: `PGHOST` or `DATABASE_URL` | —, `5432`, `dems`, `dems` | PostgreSQL as single values; `compose.yaml` sets them to its `postgres` service |
| `PGPASSWORD` / `PGPASSWORD_FILE` | with `PGHOST` | — | password, or a file holding only the password (trimmed; wins over `PGPASSWORD`). Compose: `/run/dems-secrets/db_password`, generated on the first start |
| `SQLITE_PATH` | no | `./data/dems.sqlite` | SQLite file for dev and tests; used only without PostgreSQL values and outside production |
| `TEST_DATABASE_URL` | no | — | tests only: PostgreSQL for the contract tests and the production cookie test ([testing](testing.md)) |
| `UPLOAD_DIR` | no | `./data/uploads` | folder of uploaded banners (`banners/` below it, W-12); in Docker `/app/data/uploads` on the data volume. The files always live on the local disk, not in the database, so a host without a persistent disk loses them on redeploy |
| `PORT` | no | `3000` | HTTP port (fixed to 3000 inside containers) |
| `TIMEZONE` | no | `Europe/Berlin` | date formatting in bot messages |
| `DEBUG_MODE` | no | `false` | verbose request/database/bot logging + `#debug` UI section; never in production |
| `ADMIN_RESET_PASSWORD` | no | — | system reset and panic-mode deactivation; empty → both impossible |
| `NODE_ENV` | no | `production` in the Docker image | blocks `DEV_MOCK`; makes session and `XSRF-TOKEN` cookies `Secure` → DEMS must be reached via HTTPS (TLS proxy sending `X-Forwarded-Proto: https`), otherwise the login does not stick |
| `DEMS_PORT` | no | `3000` | host port in `compose.yaml` |
| `DEV_MOCK` | no | — | dev mock mode (set automatically by `npm run dev:mock`) |
| `DEV_SQLITE_PATH` | no | `data/dems.dev.sqlite` | database of the dev mock mode |
| `DEV_UPLOAD_DIR` | no | `data/dev-uploads` | banner folder of the dev mock mode (becomes `UPLOAD_DIR`) |
| `DEMS_DEV_PORT` | no | `3000` | host port in `compose.dev.yaml` |

## Rules

- Read new variables with `process.env.X` where they are used; document them in `.env.example` (German comments, like the existing ones) and in this table.
- Never commit `.env`; it is git- and docker-ignored.
- In dev mock mode `dev/mockMode.js` overrides Discord/PostgreSQL/SQLite/BASE_URL values from `.env` — see [dev-mock-mode](../modules/dev-mock-mode.md).

## Gotchas

- `⚠️ Kommentar-Sync: Dem Bot fehlt das Recht „Webhooks verwalten“ …` (or „Nachrichten verwalten“) in the log: the bot was invited before B-16 and kept its old rights — a new invite URL in the start log changes nothing until it is opened. Open it again for the same server (Discord moves the rights onto the bot role) or grant the right to the bot role; a channel overwrite that denies it in the announcement channel blocks it too.
- `DISCORD_THREAD_SYNC=true` without the *Message Content* intent in the Developer Portal → `❌ Bot login fehlgeschlagen: Used disallowed intents`; the web app keeps running without bot. Remove the variable or switch the intent on, then restart.
- `README.md` still shows a `DISCORD_REDIRECT_URI` variable — it is not read anywhere; the redirect is derived from `BASE_URL`.
- Compose: variables in a project `.env` reach the container only via `env_file:` (or explicit `environment:`); see [deployment](deployment.md).
- Secrets containing `$` are mangled by Compose interpolation; prefer hex secrets (`openssl rand -hex 32`).
