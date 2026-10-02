---
id: middleware
title: middleware/ — auth guards, maintenance gates, validators
type: module
tags: [middleware, auth, admin, maintenance, validation]
sources: [middleware/auth.js, middleware/maintenance.js, middleware/validators.js]
part_of: [architecture]
depends_on: [data-layer]
see_also: [maintenance-mode, auth-session]
---
# middleware/ — auth guards, maintenance gates, validators

> TL;DR: Three small modules. `auth.js` exports `requireAuth` / `requireAdmin` (session-based, 401/403 JSON). `maintenance.js` exports `isRegistrationBlocked`, `getLoginBlockReason` and the `checkRegistrationAllowed` middleware (503). `validators.js` exports `validateEvent`, `validateRegStatus`, `validateBotMessages` (400 with German messages).

## middleware/auth.js

| Export | Behaviour |
|---|---|
| `requireAuth` | 401 `{ error: 'Nicht eingeloggt. ...' }` without `req.session.user` |
| `requireAdmin` | 401 without user, 403 unless `req.session.user.isAdmin` |

`isAdmin` comes from the login (Discord admin role, see [auth-session](../concepts/auth-session.md)). `routes/admin.js` applies both via `router.use(requireAuth, requireAdmin)`.

## middleware/maintenance.js

| Export | Behaviour |
|---|---|
| `isRegistrationBlocked()` | `true` if `maintenanceSettings/config` has `registrationDisabled` or `panicMode`; read errors → `false` |
| `getLoginBlockReason(isAdmin)` | `'panic_mode'` / `'maintenance_login_disabled'` / `null`; admins never blocked; shared by OAuth callback and dev persona login |
| `checkRegistrationAllowed` | middleware → 503 `{ error }` when registrations are blocked (used on `POST /api/events/:id/register`) |

The Discord registration path calls `isRegistrationBlocked()` directly (`checkRegistrationConditions` in `bot.js`).

## middleware/validators.js

| Export | Rules |
|---|---|
| `validateEvent` | `title` required, ≤200 chars; `maxParticipants` integer ≥0; `accessMode` ∈ `open`, `role-required`; `approvalMode` ∈ `manual`, `instant`; `status` ∈ `draft`, `active`, `archived`, `cancelled`; `description` ≤5000 chars |
| `validateRegStatus` | `status` ∈ `accepted`, `rejected`, `waitlisted` |
| `validateBotMessages` | `registration`, `accepted`, `rejected` ≤2000 chars each |

Validation is hand-written (no library). Errors are joined into one German `error` string with status 400. `validateEvent` logs the full body on failure.

## Gotchas

- Validators do not check `bannerUrl`, `accentColor`, `formFields` or dates (audit M-08/M-09) — values are stored as sent.
