---
id: directory-map
title: Directory map and reading strategy
type: overview
tags: [files, navigation, tokens, structure]
sources: [server.js, bot.js, public/js, public/index.html, public/css/style.css, routes, dev, test]
see_also: [architecture]
---
# Directory map and reading strategy

> TL;DR: Where every file lives, how big it is and how to read it cheaply. Two files hold most of the tokens (`public/css/style.css`, `public/index.html`) — never read them whole; jump via the function/section maps in their wiki nodes and `grep -n`.

Line counts as of 2026-10-02 (approximate; they drift).

## Backend

| Path | Lines | Purpose | Read strategy | Node |
|---|---|---|---|---|
| `server.js` | ~280 | Express setup, middleware chain, misc endpoints, startup/shutdown | read whole | [server](../modules/server.md) |
| `bot.js` | ~80 | entry point of the discord.js bot: wires the client, exports every Discord helper used by routes, mock overlay | read whole | [bot](../modules/bot.md) |
| `bot/*.js` | ~30–480 each | the bot's 14 area modules (commands, interactions, messages, polls, registration, guild, channels, scheduler, settings, …) | read the one module from the table in [bot](../modules/bot.md) whole | [bot](../modules/bot.md) |
| `firebaseAdmin.js` | ~60 | picks Firestore or SQLite, re-exports the data API | read whole | [data-layer](../modules/data-layer.md) |
| `db/sqliteAdapter.js` | ~250 | Firestore-compatible SQLite document store | read whole when touching queries | [data-layer](../modules/data-layer.md) |
| `routes/auth.js` | ~170 | Discord OAuth2 login, `/auth/me`, logout | read whole | [routes-auth](../modules/routes-auth.md) |
| `routes/events.js` | ~600 | public/user event endpoints, registration, check-in, comments | grep `router.(get\|post\|put\|delete)` | [routes-events](../modules/routes-events.md) |
| `routes/admin.js` | ~1180 | admin CRUD, registrations, Discord sync, bot control, maintenance | grep `router.` then read one handler | [routes-admin](../modules/routes-admin.md) |
| `routes/user.js` | ~390 | profile, badges, settings, guest search, account deletion | read handler you need | [routes-user](../modules/routes-user.md) |
| `middleware/*.js` | ~30–90 each | `auth`, `maintenance`, `validators` | read whole | [middleware](../modules/middleware.md) |
| `utils/*.js` | ~25–320 each | registration service, form fields, waitlist + audit, profiles, avatar URLs, bot permissions, CSV cells, message templates, session store, reminder rules, debug log | read whole | [utils](../modules/utils.md) |
| `dev/*.js` | ~15–460 | dev mock mode (switch, mock guild/bot, persona login, seed) | read whole, `seedData.js` only when changing seed data | [dev-mock-mode](../modules/dev-mock-mode.md) |
| `test/*.test.js` + `test/helpers.js` | ~30–200 | `node:test` suites | read `helpers.js` first | [testing](../ops/testing.md) |
| `e2e/*.spec.js` + `e2e/helpers.js`, `playwright.config.js` | ~60–100 | Playwright browser smoke tests (`npm run test:e2e`) | read whole | [testing](../ops/testing.md) |
| `scripts/wiki-graph.js` | ~250 | builds/validates this wiki's `graph.json` | read whole | [index](../index.md) |

## Frontend (`public/`, served statically)

| Path | Lines | Purpose | Read strategy | Node |
|---|---|---|---|---|
| `public/js/main.js` + `public/js/{core,events,polls,admin,pages}/*.js` | ~20–520 each | the SPA as ES modules, one per area | open the module from the map in [frontend-app](../modules/frontend-app.md) | [frontend-app](../modules/frontend-app.md) |
| `public/index.html` | ~1760 | all sections and modals as static markup | **grep** element id | [frontend-markup](../modules/frontend-markup.md) |
| `public/css/style.css` | ~3270 | dark theme, CSS variables, per-feature blocks | **grep** section header | [frontend-markup](../modules/frontend-markup.md) |
| `public/vendor/` | — | pinned third-party libraries and fonts: Bootstrap, Bootstrap Icons, Font Awesome, GSAP, marked, DOMPurify, EasyMDE, Flatpickr, Inter, UnifrakturCook (do not edit) | never read | [frontend-markup](../modules/frontend-markup.md) |
| `public/logo.svg` | — | favicon/logo | — | — |

## Ops, docs and other

| Path | Purpose | Node |
|---|---|---|
| `Dockerfile`, `compose.yaml`, `compose.dev.yaml`, `.dockerignore` | container build and run | [docker](../ops/docker.md) |
| `.env.example` | every supported environment variable | [configuration](../ops/configuration.md) |
| `.gitlab-ci.yml`, `ci/runner/` | GitLab CI pipeline and the self-hosted runner setup | [ci](../ops/ci.md) |
| `updates.json` | release notes of every version since 1.1.0 (newest first, entries may be marked `highlight`), served at `/api/updates`; popup via `core/updates.js`, page `#news` via `pages/news.js` | [server](../modules/server.md) |
| `landing/` | standalone marketing page (not served by the app) | [landing-page](../modules/landing-page.md) |
| `docs/superpowers/specs`, `docs/superpowers/plans` | design specs and implementation plans | [decisions](../reference/decisions.md) |
| `docs/security/` | security audit (2026-04-22) + PoC | [security](../concepts/security.md) |
| `ISSUE.md` | older security audit notes (2026-02-15) | [decisions](../reference/decisions.md) |
| `data/` | local SQLite files (git-ignored) | [data-layer](../modules/data-layer.md) |
