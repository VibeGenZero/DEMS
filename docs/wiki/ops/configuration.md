---
id: configuration
title: Configuration — environment variables
type: ops
tags: [config, env, dotenv, secrets, discord, postgresql, sqlite]
sources: [.env.example, server.js, utils/systemConfig.js, utils/systemValues.js, utils/timezone.js, firebaseAdmin.js, db/config.js, dev/mockMode.js, compose.yaml, compose.dev.yaml]
see_also: [docker, deployment, dev-mock-mode]
---
# Configuration — environment variables

> TL;DR: Code reads all configuration from `process.env`. It comes from `.env` (dotenv; in Docker via `env_file`) and, for the keys `.env` leaves empty, from the database document `systemSettings/config` that the setup wizard and the admin "System" view write (#138). A non-empty `.env` value always wins. Nothing is strictly required to start: a missing `SESSION_SECRET` is generated and stored. Real use needs the Discord app values, `DISCORD_GUILD_ID` and `BASE_URL` (from `.env` or the wizard). `.env.example` lists everything.

| Variable | Required | Default | Used for |
|---|---|---|---|
| `SESSION_SECRET` | no | generated | session signing; missing → a random 64-hex secret is generated on the first start and kept in `systemSettings/config` (never shown, never editable); the placeholder `your_random_session_secret_here` → exit 1; changing it invalidates all stored sessions (everyone logged out) |
| `BASE_URL` | yes (prod) | `http://localhost:3000` fallback | OAuth redirect (`${BASE_URL}/auth/discord/callback`), links in Discord messages, CORS origin |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | yes (login) | — | OAuth2; client id also in the bot invite URL |
| `DISCORD_BOT_TOKEN` | no | — | bot login; empty → bot off, Discord helpers no-op |
| `DISCORD_GUILD_ID` | yes (login) | — | membership check at login, all guild helpers, slash command registration |
| `DISCORD_ADMIN_ROLE_ID` | no | — | members with this role are admins; members with the Discord permission „Administrator“ (and the owner) are admins anyway; empty → only those |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | fallback | — | announcement channel of events and date polls while the bot center has no "Ankündigungskanal" chosen (B-02); with neither, announcing answers 400 |
| `DISCORD_EVENT_CATEGORY_ID` | no | — | parent category for auto-created event channels |
| `DISCORD_THREAD_SYNC` | no | off (`true` in dev mock mode) | `true` → comments of the event page and the event's Discord discussion thread are mirrored (B-16, [discord-integration](../concepts/discord-integration.md)); the bot then requests the privileged *Message Content* intent and needs „Webhooks verwalten“ + „Nachrichten verwalten“. Switch the intent on in the Developer Portal first, otherwise the login fails with "Used disallowed intents" and the bot stays offline. A value from the setup wizard or the "System" view counts like one in `.env` from the next start on (#146: the intents are set at login, after the database values are loaded) |
| `SERVER_NAME` | no | Discord guild name / `DEMS` | name shown in the UI (`/api/server-info`) |
| `AI_PROVIDER` | no | — (`mock` in dev mock mode) | AI provider: `ollama`, `openrouter`, `openai`, `gemini`, `anthropic`; empty → AI off (no bubble, button or `/ask`, no outgoing request). `mock` is accepted only with `DEV_MOCK=true`. Managed key, group `ai`, applies live (`ai/client.js`) |
| `AI_BASE_URL` | no | provider default | API address (http/https; trailing slashes are stripped); defaults: ollama `http://localhost:11434/v1`, openrouter `https://openrouter.ai/api/v1`, openai `https://api.openai.com/v1`, gemini `https://generativelanguage.googleapis.com/v1beta/openai`, anthropic `https://api.anthropic.com/v1` |
| `AI_API_KEY` | for all providers but ollama | — | provider key; secret (never listed, logged or audited) |
| `AI_MODEL` | with `AI_PROVIDER` | — (`mock-1` in dev mock mode) | model for member answers; AI counts as configured only with provider, model and (except ollama) key |
| `AI_MODEL_ADMIN` | no | `AI_MODEL` | model for admin features |
| `RATE_LIMIT_MAX_USER` | no | `1000` | `/api/*` requests per 15 minutes per logged-in user (`middleware/rateLimits.js`, read on every request) |
| `RATE_LIMIT_MAX` | no | `200` | `/api/*` requests per 15 minutes per IP for everybody not logged in; both limits are off in dev mock mode |
| `DATABASE_URL` | production: this or `PGHOST` | — | PostgreSQL connection URL (`postgres://user:pass@host:5432/db`); wins over `PG*`. Not needed with `compose.yaml` |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` | production: `PGHOST` or `DATABASE_URL` | —, `5432`, `dems`, `dems` | PostgreSQL as single values; `compose.yaml` sets them to its `postgres` service |
| `PGPASSWORD` / `PGPASSWORD_FILE` | with `PGHOST` | — | password, or a file holding only the password (trimmed; wins over `PGPASSWORD`). Compose: `/run/dems-secrets/db_password`, generated on the first start |
| `SQLITE_PATH` | no | `./data/dems.sqlite` | SQLite file, used whenever no PostgreSQL value is set: dev, tests and a single production container without PostgreSQL (`docker run`; in the image `/app/data/dems.sqlite`) |
| `TEST_DATABASE_URL` | no | — | tests only: PostgreSQL for the contract tests and the production cookie test ([testing](testing.md)) |
| `UPLOAD_DIR` | no | `./data/uploads` | folder of uploaded banners (`banners/` below it, W-12); in Docker `/app/data/uploads` on the data volume. The files always live on the local disk, not in the database, so a host without a persistent disk loses them on redeploy |
| `SETUP_PIN` | no | generated per start | PIN that unlocks the setup wizard while DEMS is not set up (#138); empty → a random 8-digit PIN is printed in the log at every start (`🔑 … Setup-PIN: …`); ignored once the setup is done ([first-run setup](../concepts/security.md#first-run-setup-138)) |
| `PORT` | no | `3000` | HTTP port (fixed to 3000 inside containers) |
| `TIMEZONE` | no | `Europe/Berlin` | date formatting in bot messages |
| `DEBUG_MODE` | no | `false` | verbose request/database/bot logging + `#debug` UI section; never in production |
| `ADMIN_RESET_PASSWORD` | no | — | system reset and panic-mode deactivation; empty → both impossible |
| `NODE_ENV` | no | `production` in the Docker image | blocks `DEV_MOCK`; makes session and `XSRF-TOKEN` cookies `Secure` → DEMS must be reached via HTTPS (TLS proxy sending `X-Forwarded-Proto: https`), otherwise the login does not stick |
| `DEMS_PORT` | no | `3000` | host port in `compose.yaml` |
| `DEMS_TAG` | no | `latest` | image tag `compose.yaml` pulls (`moritakahashi/dems:${DEMS_TAG}`): `latest` = releases, `beta` = pre-releases; read by Compose, not by DEMS |
| `DEMS_CHANNEL`, `DEMS_COMMIT` | no (image) | empty | baked into published images by the publish job (`edge`/`beta`/`latest`, commit sha); shown in the admin "System" view, `edge` switches the update check off; not meant for `.env` |
| `UPDATE_CHECK` | no | on | `false` → no update check; otherwise DEMS asks `GET https://api.github.com/repos/<UPDATE_CHECK_REPO>/releases` 30 s after start and every 12 h (anonymous, generic `User-Agent`, nothing about the installation) and shows a newer version in the admin "System" view (`utils/updateCheck.js`); always off in dev mock mode, in the test helpers and on `edge` images |
| `UPDATE_CHECK_REPO` | no | `VibeGenZero/DEMS` | `owner/repo` whose GitHub releases the update check reads (forks); anything else turns the check off |
| `DEV_MOCK` | no | — | dev mock mode (set automatically by `npm run dev:mock`) |
| `DEV_SQLITE_PATH` | no | `data/dems.dev.sqlite` | database of the dev mock mode |
| `DEV_UPLOAD_DIR` | no | `data/dev-uploads` | banner folder of the dev mock mode (becomes `UPLOAD_DIR`) |
| `DEMS_DEV_PORT` | no | `3000` | host port in `compose.dev.yaml` |

## Database-backed values (#138)

`utils/systemConfig.js#MANAGED_KEYS` lists the keys that may live in `systemSettings/config`: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_ADMIN_ROLE_ID`, `DISCORD_ANNOUNCE_CHANNEL_ID`, `DISCORD_EVENT_CATEGORY_ID`, `DISCORD_THREAD_SYNC`, `SERVER_NAME`, `BASE_URL`, `TIMEZONE`, `ADMIN_RESET_PASSWORD`, `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_MODEL_ADMIN` (plus the internal `SESSION_SECRET`). Database, port, `NODE_ENV`, `UPLOAD_DIR`, `DEBUG_MODE`, `SQLITE_PATH` and `DEV_*` stay environment-only: they are needed before the database is reachable or are developer switches.

- `loadSystemConfig()` runs in `server.js#start()` after the migrations: keys with a non-empty environment value are **locked** (source `env`); the others are copied from the database into `process.env`. An installation whose environment holds `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_GUILD_ID` is marked as set up (`setupSource: env`).
- `saveSystemValues()` refuses unknown and locked keys (nothing changes), stores the rest and updates `process.env` at once (empty value → key deleted). Each key has an `applies` class: `live` (read at call time), `bot` (`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`: the bot logs in again), `restart` (`DISCORD_THREAD_SYNC`: the client intents are fixed at start).
- Admins change unlocked values on the admin page `#system` (`PUT /api/admin/system/settings`, [routes-admin](../modules/routes-admin.md)); saving needs the admin reset password, a key set by `.env` can only be changed there.
- Code must read these keys at call time, never into a module constant. The time zone goes through `getTimezone()` of `utils/timezone.js`; `test/timezone.test.js` fails on a module-level `TIMEZONE` constant.
- Secrets (`DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `ADMIN_RESET_PASSWORD`, `SESSION_SECRET`) are stored in plain text; the API only ever reports whether they are set. Database backups therefore contain them.

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
