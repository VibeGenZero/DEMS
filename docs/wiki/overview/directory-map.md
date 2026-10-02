---
id: directory-map
title: Directory map and reading strategy
type: overview
tags: [files, navigation, tokens, structure]
sources: [server.js, bot.js, public/js/app.js, public/index.html, public/css/style.css, routes, dev, test]
see_also: [architecture]
---
# Directory map and reading strategy

> TL;DR: Where every file lives, how big it is and how to read it cheaply. Four files hold most of the tokens (`public/js/app.js`, `public/css/style.css`, `bot.js`, `public/index.html`) — never read them whole; jump via the function/section maps in their wiki nodes and `grep -n`.

Line counts as of 2026-10-02 (approximate; they drift).

## Backend

| Path | Lines | Purpose | Read strategy | Node |
|---|---|---|---|---|
| `server.js` | ~280 | Express setup, middleware chain, misc endpoints, startup/shutdown | read whole | [server](../modules/server.md) |
| `bot.js` | ~2200 | discord.js bot + all Discord helpers used by routes | **grep** function names from [bot](../modules/bot.md) | [bot](../modules/bot.md) |
| `firebaseAdmin.js` | ~60 | picks Firestore or SQLite, re-exports the data API | read whole | [data-layer](../modules/data-layer.md) |
| `db/sqliteAdapter.js` | ~250 | Firestore-compatible SQLite document store | read whole when touching queries | [data-layer](../modules/data-layer.md) |
| `routes/auth.js` | ~170 | Discord OAuth2 login, `/auth/me`, logout | read whole | [routes-auth](../modules/routes-auth.md) |
| `routes/events.js` | ~600 | public/user event endpoints, registration, check-in, comments | grep `router.(get\|post\|put\|delete)` | [routes-events](../modules/routes-events.md) |
| `routes/admin.js` | ~1180 | admin CRUD, registrations, Discord sync, bot control, maintenance | grep `router.` then read one handler | [routes-admin](../modules/routes-admin.md) |
| `routes/user.js` | ~390 | profile, badges, settings, guest search, account deletion | read handler you need | [routes-user](../modules/routes-user.md) |
| `middleware/*.js` | ~30–90 each | `auth`, `maintenance`, `validators` | read whole | [middleware](../modules/middleware.md) |
| `utils/*.js` | ~25–320 each | registration service, form fields, waitlist + audit, profiles, debug log | read whole | [utils](../modules/utils.md) |
| `dev/*.js` | ~15–460 | dev mock mode (switch, mock guild/bot, persona login, seed) | read whole, `seedData.js` only when changing seed data | [dev-mock-mode](../modules/dev-mock-mode.md) |
| `test/*.test.js` + `test/helpers.js` | ~30–200 | `node:test` suites | read `helpers.js` first | [testing](../ops/testing.md) |
| `scripts/wiki-graph.js` | ~250 | builds/validates this wiki's `graph.json` | read whole | [index](../index.md) |

## Frontend (`public/`, served statically)

| Path | Lines | Purpose | Read strategy | Node |
|---|---|---|---|---|
| `public/js/app.js` | ~4550 | the whole SPA: boot, router, sections, admin, forms | **grep** function from the map in [frontend-app](../modules/frontend-app.md) | [frontend-app](../modules/frontend-app.md) |
| `public/index.html` | ~1760 | all sections and modals as static markup | **grep** element id | [frontend-markup](../modules/frontend-markup.md) |
| `public/css/style.css` | ~3270 | dark theme, CSS variables, per-feature blocks | **grep** section header | [frontend-markup](../modules/frontend-markup.md) |
| `public/vendor/` | — | vendored EasyMDE + Flatpickr (do not edit) | never read | [frontend-markup](../modules/frontend-markup.md) |
| `public/logo.svg` | — | favicon/logo | — | — |

## Ops, docs and other

| Path | Purpose | Node |
|---|---|---|
| `Dockerfile`, `compose.yaml`, `compose.dev.yaml`, `.dockerignore` | container build and run | [docker](../ops/docker.md) |
| `.env.example` | every supported environment variable | [configuration](../ops/configuration.md) |
| `updates.json` | "what's new" notes served at `/api/updates`, shown by `checkUpdates()` | [server](../modules/server.md) |
| `landing/` | standalone marketing page (not served by the app) | [landing-page](../modules/landing-page.md) |
| `docs/superpowers/specs`, `docs/superpowers/plans` | design specs and implementation plans | [decisions](../reference/decisions.md) |
| `docs/security/` | security audit (2026-04-22) + PoC | [security](../concepts/security.md) |
| `ISSUE.md` | older security audit notes (2026-02-15) | [decisions](../reference/decisions.md) |
| `data/` | local SQLite files (git-ignored) | [data-layer](../modules/data-layer.md) |
