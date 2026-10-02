---
id: maintenance-mode
title: Maintenance mode and panic mode
type: concept
tags: [maintenance, panic-mode, lockdown, banner, login, registration]
sources: [routes/admin.js, middleware/maintenance.js, server.js, public/js/app.js]
depends_on: [data-model]
see_also: [auth-session, registration-flow, middleware]
---
# Maintenance mode and panic mode

> TL;DR: One settings document, `maintenanceSettings/config`, drives four admin switches: warning banner, planned-maintenance banner, "login disabled" (non-admins) and "registrations disabled". Panic mode is an emergency lockdown that turns all of them on at once; it can be switched on without a password but only switched off with `ADMIN_RESET_PASSWORD`. Admins are never locked out.

## Effects

| Setting | Server effect | UI effect (`checkMaintenanceStatus` in app.js) |
|---|---|---|
| `warningEnabled` + `warningText` | — | top warning banner |
| `plannedMaintenance` + `plannedMaintenanceText` (+ start/end) | — | second banner with date range |
| `loginDisabled` | non-admin OAuth/persona login → `/?error=maintenance_login_disabled` | error message after redirect |
| `registrationDisabled` | web register → 503; Discord button → German error | — |
| `panicMode` | sets warning + loginDisabled + registrationDisabled; login → `/?error=panic_mode` | full-screen `#panic-lockdown-overlay` for non-admins |

## Endpoints

| Method | Path | Who |
|---|---|---|
| GET | `/api/maintenance/status` | public (subset of the settings) |
| GET / PUT | `/api/admin/maintenance` | admin; PUT keeps the current panic state |
| POST | `/api/admin/maintenance/panic` | admin, no password |
| POST | `/api/admin/maintenance/panic/deactivate` | admin + body `{ password: ADMIN_RESET_PASSWORD }` |

## Where in code

`getLoginBlockReason`, `isRegistrationBlocked`, `checkRegistrationAllowed` (middleware/maintenance.js); `MAINTENANCE MODE` block at the end of routes/admin.js; `checkMaintenanceStatus`, `showMaintenanceModal`, `activatePanicMode`, `deactivatePanicMode` (app.js).

## Gotchas

- Panic mode does not end existing sessions; non-admin users already logged in are only blocked by the frontend overlay, the API still answers them (except registrations).
- Without `ADMIN_RESET_PASSWORD` set, panic mode cannot be deactivated via UI (and the system reset is impossible). Dev mock mode defaults it to `dev`.
- Read errors of the settings document fail open (login and registration allowed).
