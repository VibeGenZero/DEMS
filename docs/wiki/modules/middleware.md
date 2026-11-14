---
id: middleware
title: middleware/ — auth guards, maintenance gates, validators
type: module
tags: [middleware, auth, admin, maintenance, validation]
sources: [middleware/auth.js, middleware/maintenance.js, middleware/validators.js, middleware/rateLimits.js]
part_of: [architecture]
depends_on: [data-layer]
see_also: [maintenance-mode, auth-session]
---
# middleware/ — auth guards, maintenance gates, validators

> TL;DR: Three small modules. `auth.js` exports `requireAuth` / `requireAdmin` (session-based, 401/403 JSON) plus `safeEqual` (constant-time secret compare) and the login helpers `createCsrfToken` and `startUserSession`. `maintenance.js` exports `isRegistrationBlocked`, `getLoginBlockReason` and the `checkRegistrationAllowed` middleware (503). `validators.js` exports `validateEvent`, `validateRegStatus`, `validateBotMessages` (400 with German messages).

## middleware/auth.js

| Export | Behaviour |
|---|---|
| `requireAuth` | 401 `{ error: 'Nicht eingeloggt. ...' }` without `req.session.user` |
| `requireAdmin` | 401 without user, 403 unless `req.session.user.isAdmin` |
| `createRoleRefresh({ fetchMemberRoleIds, getAdminRoleId?, now? })` | middleware (used in `server.js` after the static files): if `session.user.rolesCheckedAt` is older than 5 min, reads `{ isMember, roleIds, isAdministrator }` and updates `roles` / `isAdmin` (`isDemsAdmin`: `DISCORD_ADMIN_ROLE_ID` or Discord „Administrator“); `null` or an error → values kept, retry after 1 min; one shared lookup per user |
| `safeEqual(submitted, expected)` | SHA-256 of both + `crypto.timingSafeEqual`; false for non-strings and an empty expected secret; used for `ADMIN_RESET_PASSWORD` |
| `createCsrfToken()` | 32 random bytes hex; used by the CSRF middleware in `server.js` and by `startUserSession` |
| `startUserSession(req, user)` | `req.session.regenerate` (new id), then `user` + a fresh CSRF token, saved; used by `routes/auth.js` and `dev/devAuth.js` |

`isAdmin` comes from the login (admin role or Discord „Administrator“, see [auth-session](../concepts/auth-session.md)). `routes/admin.js` applies both via `router.use(requireAuth, requireAdmin)`.

## middleware/maintenance.js

| Export | Behaviour |
|---|---|
| `isRegistrationBlocked()` | `true` if `maintenanceSettings/config` has `registrationDisabled` or `panicMode`; read errors → `false` |
| `getLoginBlockReason(isAdmin)` | `'panic_mode'` / `'maintenance_login_disabled'` / `null`; admins never blocked; shared by OAuth callback and dev persona login |
| `checkRegistrationAllowed` | middleware → 503 `{ error }` when registrations are blocked (used on `POST /api/events/:id/register`) |

The Discord registration path calls `isRegistrationBlocked()` directly (`checkRegistrationConditions` in `bot/registration.js`).

## middleware/validators.js

| Export | Rules |
|---|---|
| `validateEvent` | `title` required, ≤200 chars; `maxParticipants` integer ≥0; `accessMode` ∈ `open`, `role-required`; `approvalMode` ∈ `manual`, `instant`; `status` ∈ `draft`, `active`, `archived`, `cancelled`; `description` ≤5000 chars; `bannerUrl` empty, an http(s) URL ≤2000 chars or an uploaded banner path whose file exists (`isStoredBanner`, W-12; else 400 "Banner muss eine http(s)-URL oder ein hochgeladenes Bild sein."); `validateEvent` is async for that check; `accentColor` empty or `#rgb`/`#rrggbb`. The rules live in `checkEventFields(body, { template })` → list of German sentences; `validateEvent` only answers 400 with them |
| `checkEventFields` | the rules above for any body; with `{ template: true }` (event templates, W-10) the title may be empty and status, start date, end and deadline rules are skipped — templates store none of them |
| `validateRegStatus` | `status` ∈ `accepted`, `rejected`, `waitlisted` |
| `validateBotMessages` | `registration`, `accepted`, `rejected` ≤2000 chars each |

Validation is hand-written (no library). Errors are joined into one German `error` string with status 400. `validateEvent` logs the full body on failure.

## middleware/rateLimits.js

`createApiLimiter({ env, skip })` → the limiter of `/api/*` (`express-rate-limit`, window 15 min): `apiLimitKey(req)` counts a logged-in user as `user:<id>`, everybody else as `ip:<address>` (`ipKeyGenerator`); `apiLimitFor(req, env)` = `RATE_LIMIT_MAX_USER` (default 1000) or `RATE_LIMIT_MAX` (default 200), read on every request, nonsense → default; the 429 answers `tooManyRequestsMessage(msLeft)` („Zu viele Anfragen. Bitte warte etwa N Minuten …“). Mounted after the session middleware, so the session is known; `skip` = dev mock mode.

## Gotchas

- Validators do not check `formFields` or dates — those are stored as sent.
