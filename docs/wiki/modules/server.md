---
id: server
title: server.js — Express app, misc endpoints, startup
type: module
tags: [express, server, startup, shutdown, endpoints, helmet, session]
sources: [server.js, updates.json, routes/calendar.js, routes/plugins.js, routes/pluginStatic.js, middleware/rateLimits.js, utils/serverName.js, utils/trustProxy.js]
part_of: [architecture]
depends_on: [middleware, data-layer, bot]
see_also: [request-lifecycle, security, configuration]
---
# server.js — Express app, misc endpoints, startup

> TL;DR: `server.js` builds the Express 5 app (security headers, rate limits, session, CSRF, static files), mounts the routers (auth, the event assistant `routes/eventAsk.js` before events, events, polls, admin, user, plugins, setup) and the plugin client files, defines five small endpoints itself (`/healthz`, `/api/csrf-token`, `/api/maintenance/status`, `/api/server-info`, `/api/updates`) plus the SPA fallback, then starts the HTTP server, the Discord bot and the reminder, poll and archive schedulers and the update check.

## Responsibilities

1. Load `.env` (`require('dotenv').config({ quiet: true })`) and `dev/mockMode` **before** anything that reads the environment.
2. Refuse to start with the placeholder `SESSION_SECRET=your_random_session_secret_here` → exit 1. A missing `SESSION_SECRET` is generated on the first start and kept in `systemSettings/config` (#138, [configuration](../ops/configuration.md)).
3. Register the middleware chain → see [request-lifecycle](../overview/request-lifecycle.md).
4. Mount routers: `/auth` (+ `dev/devAuth` first in mock mode), `/api/events`, `/api/polls`, `/api/admin`, `/api/user`, then `/api/plugins` (`createPluginRouter(() => pluginHost())`, `routes/plugins.js`: client list + dispatcher for plugin routes, behind session, CSRF, setup mode and privacy gate). Right after `express.static(public)` (after session and CSRF, before the role refresh; a file request creates no session, `saveUninitialized: false`): `/plugins` (`createPluginStatic(() => pluginHost())`, `routes/pluginStatic.js`: client files of switched-on plugins). Both read the host per request and answer as if no plugin existed (404, `[]`) while it is not started yet.
5. Start: `store.ready()` → `runMigrations()` → `loadSystemConfig()` (`utils/systemConfig.js`: stored configuration fills the keys `.env` leaves empty; log line `⚙️ Konfiguration: …`) → `loadAiSettings()` → `initPlugins({ officialDir: <app>/plugins, customDir: PLUGINS_DIR, safeMode: PLUGINS_SAFE_MODE === 'true', mockMode })` (`plugin-sdk/index.js`; a failure is logged and DEMS starts without plugins) → build the session middleware (its secret may come from the database, so a delegating wrapper holds its place in the chain; the CORS origin reads `BASE_URL` per request) → `app.listen(PORT)`, `startBot(DISCORD_BOT_TOKEN)`, `startReminderScheduler()`, `startPollScheduler()` (date poll deadlines), `startArchiveScheduler({ waitFor: whenBotSettled() })` (archives active events 24 h after their end; the first run waits until the bot is ready or will not start, see [event-lifecycle](../concepts/event-lifecycle.md)), `startUpdateCheck({ mockMode })` (newest GitHub release every 12 h for the admin "System" view, `utils/updateCheck.js`; off in mock mode); `sweepOrphanBanners()` once (deletes uploaded banners no event uses that are older than 24 h, W-12); both stopped in `gracefulShutdown`.
6. Graceful shutdown on `SIGINT`/`SIGTERM` (close server → `stopBot()` → exit; forced exit after 10 s).

## Endpoints defined in server.js

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/uploads/banners/<name>` | none | uploaded banners (W-12): `BANNER_FILE` guard + `express.static(bannerDir())`, 7-day immutable cache; other names 404 |
| GET | `/calendar/<token>.ics` | none (the secret in the path) | member's calendar subscription, `createCalendarRouter` from `routes/calendar.js`; mounted right after the banners, before `express.json`, the session middleware, CSRF, setup mode and the privacy gate, so a fetch reads and writes no session; own limiters `createCalendarLimiters` (`middleware/rateLimits.js`): 600 / 15 min per address (off in dev mock mode) and 30 / 15 min per link, 429 as plain text; unknown or malformed names 404 „Kalender nicht gefunden.“ as plain text; answer `text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`, `X-Robots-Tag: noindex`, Express ETag → 304; calendar name `<resolveServerName()> · Meine Events` — see [routes-user](routes-user.md#calendar-subscription) |
| GET / HEAD | `/plugins/<pluginId>/…` | none | client files of switched-on plugins, `createPluginStatic` from `routes/pluginStatic.js`; mounted right after `express.static(public)`, after session and CSRF, before the role refresh (no session is created, `saveUninitialized: false`). `sendFile` gets the plugin folder as `root`, so dot-named parent folders (worktrees, `~/.local`) do not trip `dotfiles: 'deny'`. Allow-list only: `client.js` (the manifest's client file), `client.css`, `assets/<name>` with `^[A-Za-z0-9_-]+\.(js\|css\|png\|jpg\|jpeg\|webp\|gif\|json\|woff2)$`; a path with `..`, `\`, NUL or an encoded slash is refused before any disk access, the resolved file (symlinks too) must stay inside the plugin folder; `Cache-Control: no-cache`, content type from the extension (`.js` → `text/javascript; charset=utf-8`), helmet's `nosniff` applies; everything else (other methods too) a plain 404 |
| GET | `/healthz` | none | `{ status: 'ok' }` — registered before session/CSRF (Docker healthcheck) |
| GET | `/api/csrf-token` | none | `{ token }` = `req.session.csrfToken`; the CSRF middleware mints it (and thereby the session) here when missing — the only place besides the login |
| GET | `/api/maintenance/status` | none | public subset of `maintenanceSettings/config` (`active`, `warningEnabled`, `warningText`, `loginDisabled`, `registrationDisabled`, `plannedMaintenance*`, `panicMode`); `{ active: false }` when unset/error |
| GET | `/api/server-info` | none | `{ serverName, iconUrl, guildId, debugMode, ai: { memberAssistant, assistantName, teaserText, adminAssistant } }` (`ai` from `publicAiInfo()` + `isFeatureOn('adminAssistant')`, all off on an error; never a key or model, [ai-integration](../concepts/ai-integration.md)); name from `SERVER_NAME`, else `getGuildName()`, else `'DEMS'`; `iconUrl` from `getGuildIconUrl()` (also with `SERVER_NAME`), `null` without an icon or bot |
| GET | `/api/updates` | none | sends `updates.json`: `{ version, releases: [{ version, date, news: [{ title, content, highlight? }] }] }`, newest release first, `version` = newest (D-13; `test/updatesData.test.js` guards order, dates and at most 3 highlights per release) |
| GET | `/{*splat}` | none | `public/index.html` (SPA fallback, Express 5 wildcard syntax) |

## Where in code

| What | grep anchor |
|---|---|
| CSP directives | `contentSecurityPolicy: {` |
| rate limiters | `createApiLimiter(` (after the session middleware; `middleware/rateLimits.js`), `const authLimiter` |
| Express 5 body shim | `req.body === undefined` |
| session options | `app.use(session({` |
| CSRF middleware | `CSRF Protection (Double-Submit Cookie)` |
| debug request logger | `if (IS_DEBUG)` |
| listen error handling | `app.listen(PORT, (err)` |
| shutdown | `function gracefulShutdown` |

## Gotchas

- `trust proxy` comes from `TRUST_PROXY` (`utils/trustProxy.js`): by default exactly ONE reverse proxy, trusted only when the socket peer is on a loopback, link-local or private address (Traefik/Caddy/nginx on the host or in the Docker network). More hops, or a platform proxy on a public address → set `TRUST_PROXY` (a hop count or a proxy address list), else `req.ip` in the rate limits is wrong.
- Session store is `PersistentSessionStore` (`utils/sessionStore.js`, collection `sessions`): logins survive restarts; it assumes it is the only DEMS process (write-through cache).
- Express 5 path syntax: wildcards must be named (`/{*splat}`), `*` alone throws at startup.
- Express 5 hands listen errors (e.g. `EADDRINUSE`) to the `listen` callback; the code exits with 1 so Docker restarts it.
- Adding middleware: place it relative to session/CSRF consciously — see [add-api-endpoint](../howto/add-api-endpoint.md).
