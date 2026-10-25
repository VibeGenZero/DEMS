---
id: maintenance-mode
title: Maintenance mode and panic mode
type: concept
tags: [maintenance, panic-mode, lockdown, banner, login, registration]
sources: [routes/admin.js, middleware/maintenance.js, server.js, utils/sessionStore.js, public/js/admin/maintenance.js]
depends_on: [data-model]
see_also: [auth-session, registration-flow, middleware]
---
# Maintenance mode and panic mode

> TL;DR: One settings document, `maintenanceSettings/config`, drives four admin switches: warning banner, planned-maintenance banner, "login disabled" (non-admins) and "registrations disabled". Panic mode is an emergency lockdown that turns all of them on at once; it can be switched on without a password but only switched off with `ADMIN_RESET_PASSWORD`. Admins are never locked out.

## Effects

| Setting | Server effect | UI effect (`checkMaintenanceStatus` in `public/js/admin/maintenance.js`) |
|---|---|---|
| `warningEnabled` + `warningText` | — | top warning banner |
| `plannedMaintenance` + `plannedMaintenanceText` (+ start/end) | — | second banner with date range |
| `loginDisabled` | non-admin OAuth/persona login → `/?error=maintenance_login_disabled` | error message after redirect |
| `registrationDisabled` | web register → 503; Discord button → German error | — |
| `panicMode` | sets warning + loginDisabled + registrationDisabled; login → `/?error=panic_mode`; ends every non-admin session at activation (admins keep theirs so they can deactivate the mode; logins during the lockdown are blocked anyway) | full-screen `#panic-lockdown-overlay` for non-admins |

## Endpoints

| Method | Path | Who |
|---|---|---|
| GET | `/api/maintenance/status` | public (subset of the settings) |
| GET / PUT | `/api/admin/maintenance` | admin; PUT keeps the current panic state |
| POST | `/api/admin/maintenance/panic` | admin, no password |
| POST | `/api/admin/maintenance/panic/deactivate` | admin + body `{ password: ADMIN_RESET_PASSWORD }` |

## Where in code

`getLoginBlockReason`, `isRegistrationBlocked`, `checkRegistrationAllowed` (middleware/maintenance.js); `MAINTENANCE MODE` block at the end of routes/admin.js; `destroyAll`/`sharedSessionStore` (`utils/sessionStore.js`); `checkMaintenanceStatus`, `showMaintenanceModal`, `activatePanicMode`, `deactivatePanicMode` (`public/js/admin/maintenance.js`).

## Gotchas

- Sessions are stored in the database, so restarting the server does not log anyone out. Panic mode ends every existing non-admin session at activation (regression test `test/panicSessionInvalidation.test.js`); admin sessions stay, so an admin can deactivate the mode; an unreadable session record is deleted as well instead of failing the activation.
- Without `ADMIN_RESET_PASSWORD` set, panic mode cannot be deactivated via UI (and the system reset is impossible). Dev mock mode defaults it to `dev`.
- Read errors of the settings document fail open (login and registration allowed).
