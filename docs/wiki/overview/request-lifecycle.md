---
id: request-lifecycle
title: Request lifecycle (middleware order)
type: overview
tags: [express, middleware, csrf, session, rate-limit, routing]
sources: [server.js]
depends_on: [server]
see_also: [auth-session, security]
---
# Request lifecycle (middleware order)

> TL;DR: Every HTTP request passes `server.js` middleware in this exact order: healthz → helmet → cors → rate limits → body parsers → session → CSRF → static files → (debug log) → routers → misc endpoints → SPA fallback. Mutating `/api/*` calls need the `X-CSRF-TOKEN` header; everything unknown returns `index.html`.

## Order (as registered in `server.js`)

| # | Middleware / route | Applies to | Notes |
|---|---|---|---|
| 1 | `GET /healthz` | all | before session on purpose: probes must not create sessions |
| 2 | `helmet({ contentSecurityPolicy })` | all | custom directives merged with helmet defaults (incl. `upgrade-insecure-requests`, see [known-issues](../reference/known-issues.md)) |
| 3 | `cors({ origin: BASE_URL, credentials: true })` | all | only sets headers, does not block same-origin calls |
| 4 | `apiLimiter` 200 req / 15 min | `/api/` | skipped in dev mock mode |
| 5 | `authLimiter` 30 req / 15 min | `/auth/` | counts `/auth/me` too; skipped in mock mode |
| 6 | `express.json()`, `express.urlencoded({ extended: true })` | all | default 100 KB limit |
| 7 | `req.body ??= {}` shim | all | Express 5 leaves `req.body` undefined without body |
| 8 | `express-session` (`PersistentSessionStore`, collection `sessions`) | all | cookie `httpOnly`, `sameSite: lax`, `secure` only with `NODE_ENV=production`, 24 h |
| 9 | CSRF (double submit) | all | mints `req.session.csrfToken` only on `GET /api/csrf-token`, sets cookie `XSRF-TOKEN` when the session has one, rejects POST/PUT/DELETE/PATCH on `/api/*` and `/auth/*` without matching `X-CSRF-TOKEN` / `X-XSRF-TOKEN` header → 403 |
| 10 | `express.static('public')` | files | served before routers |
| 11 | debug request logger | all | only with `DEBUG_MODE=true`; registered after static, so static files are not logged |
| 12 | `dev/devAuth` router | `/auth` | only when `DEV_MOCK=true` |
| 13 | routers | `/auth`, `/api/events`, `/api/admin`, `/api/user` | see [api-index](../reference/api-index.md) |
| 14 | `GET /api/csrf-token`, `/api/maintenance/status`, `/api/server-info`, `/api/updates` | — | defined in `server.js` |
| 15 | `GET /{*splat}` | everything else | SPA fallback → `public/index.html` (also for unknown `/api/...` GETs) |

## Response conventions

- Errors: `res.status(code).json({ error: '<German message>' })`. The frontend shows `error` in a toast.
- Handlers wrap their body in `try/catch` and answer 500 themselves; Express 5 would also forward rejected promises to its default handler (HTML 500).
- Auth failures: 401 `{ error }` (not logged in), 403 `{ error }` (not admin / CSRF).
- `/auth/discord/callback` never returns JSON; it redirects to `/#events` or `/?error=<code>`.

## Frontend side

`public/js/app.js` calls `fetchCSRFToken()` once at startup (`GET /api/csrf-token`, stored in the global `csrfToken`) and sends `headers: { 'X-CSRF-TOKEN': csrfToken }` on every mutating call. Session cookie travels automatically (same origin).
