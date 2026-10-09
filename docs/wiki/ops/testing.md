---
id: testing
title: Testing — node:test suites and helpers
type: ops
tags: [testing, node-test, integration-tests, helpers, tdd]
sources: [test/helpers.js, test/devServer.test.js, test/noMock.test.js, test/mockMode.test.js, test/mockBot.test.js, test/seed.test.js, test/sqliteAdapter.test.js, test/eventUrl.test.js, test/wiki.test.js, test/branding.test.js, test/vendorAssets.test.js, test/eventDetailReset.test.js, test/profileRegistrations.test.js, test/login.test.js, test/authFrontend.test.js, test/fixtures/fakeDiscordServer.js, test/sessionStore.test.js, test/sessionRestart.test.js, test/reminders.test.js, test/reminderScheduler.test.js, test/eventForm.test.js, test/startup.test.js, test/avatar.test.js, test/eventCards.test.js, test/botPermissions.test.js, test/hardening.test.js]
see_also: [dev-mock-mode, conventions]
---
# Testing — node:test suites and helpers

> TL;DR: `npm test` runs `node --test "test/**/*.test.js"` (built-in runner, no dependencies). Server behaviour is tested end-to-end by spawning `server.js` / `dev/start.js` in a child process with a temp SQLite file and driving it with a cookie-aware fetch client that handles CSRF. There are no browser tests; single frontend functions run in `node:vm` against a fake DOM (`loadFrontendApp`).

## Suites

| File | Covers |
|---|---|
| `sqliteAdapter.test.js` | `doc(collectionRef, id)` support of the SQLite adapter |
| `mockMode.test.js` | production guard, forced environment, `dev/start.js` refusing production |
| `mockBot.test.js` | mock Discord helpers (roles, channels, DMs, event channels, "Zum Event" button link) via `bot.js` |
| `eventUrl.test.js` | `buildEventUrl` builds `#event/<id>`; no server file builds `#events/<id>` links |
| `seed.test.js` | seed counts, idempotence, reset, refusal outside mock mode / with Firebase |
| `devServer.test.js` | CSP (scripts/styles/fonts only `'self'`, no `unsafe-eval`), persona login (new session, parallel first changes pass CSRF), no session for cookie-less requests until `/api/csrf-token`, reminder `sent` kept on save / reset on duplicate, several reminders as "24, 1", deleting an event or series deletes its Discord channels (mock log), a comment carries its author's avatar URL, wrong check-in codes limited per member (429 after 10), six-digit check-in code, CSV formulas defused, unsafe banner URL / colour refused, admin/member access, event API only with login, draft/archived only for admins, guests see only status and id of the inviting registration, no `checkinCode` in member answers, mock data in routes, announce, start event, check-in, rate limits, maintenance + panic lockout |
| `noMock.test.js` | without `DEV_MOCK` the OAuth redirect stays and the persona login does not exist |
| `wiki.test.js` | wiki frontmatter/link/graph validation and that `docs/wiki/graph.json` is current |
| `branding.test.js` | the old product name ("Discord" + "Event Management") appears in no git-tracked file outside `public/vendor` (untracked files such as CI's npm logs are ignored) |
| `vendorAssets.test.js` | `index.html` loads no script/stylesheet from another host, every local reference and every `url()` in `public/vendor/**/*.css` exists, `fonts.css` bundles Inter + UnifrakturCook |
| `eventDetailReset.test.js` | the event page drops participants, comments and the check-in box of the previously opened event (role-locked event, late answers, slow event fetch) |
| `login.test.js` | real OAuth2 routes against `test/fixtures/fakeDiscordServer.js` (fake Discord API, user `oauth-tester`): one-time `state`, new session after login, logout only via POST with CSRF token, `Secure` cookies with `NODE_ENV=production` (second server, `X-Forwarded-Proto: https`) |
| `sessionStore.test.js` | `PersistentSessionStore` on its own SQLite file: survives a new store instance (restart), session id not in the database, expiry, destroy, `pruneExpired`, memory cache |
| `sessionRestart.test.js` | `dev/start.js` started three times on one database: a login survives a restart, the logout (CSRF token from the stored session) too |
| `reminders.test.js` | `utils/reminders.js`: normalizing, keeping `sent` on save, due reminders |
| `reminderScheduler.test.js` | `checkReminders({ now, send })` in mock mode on its own database: stored `sent` blocks a resend after a restart, flags written before the DMs, one DM for several due reminders, legacy numbers stored as a list, start notification once |
| `eventForm.test.js` | event wizard: `editEvent` fills `#event-reminder` with every stored reminder ("24, 1", legacy number, none), the field is not a number input, `loadAdminEvents` shows the "24h · 1h" badge |
| `startup.test.js` | `fire('DOMContentLoaded')`: the startup asks `/auth/me` once; a late `/auth/me` answer does not log the user out; `showUserData` exists once |
| `avatar.test.js` | `utils/avatar.js`: session avatar used as is, wrapped comment avatars unwrapped, intact values unchanged |
| `eventCards.test.js` | `markdownPreview` (plain one-liner, keeps `snake_case` and `5 * 3`, cut on a word); overview, admin and Discord import cards show no raw Markdown; a cut preview never splits `&amp;` |
| `botPermissions.test.js` | the bot invite URL asks for CreateEvents, for every right granted to participants (ViewChannel, Connect, SendMessages) and uses scopes `bot applications.commands` |
| `hardening.test.js` | `safeEqual`, `csvCell` (formula starts defused, quoting), `parseTemplate` (values literal, no wildcard keys) |
| `authFrontend.test.js` | frontend `logout()` posts the CSRF token, failure toast, no `/auth/logout` navigation left, `invalid_state` message |
| `profileRegistrations.test.js` | profile cards link to events the user can open; archived events stay listed without a link for members |

## Helpers (`test/helpers.js`)

| Helper | Use |
|---|---|
| `createTempDir(prefix)` | fresh temp directory (SQLite files, cwd for child processes) |
| `cleanEnv(env)` | copy of `process.env` without `DISCORD_*`, `FIREBASE_*`, `DEV_*`, `NODE_ENV`, `SQLITE_PATH`, ... merged with `env` |
| `runNode(code, env)` | run a JS snippet in a fresh process (empty cwd → no `.env` leaks in) |
| `repoPath(rel)` | absolute path as JS string literal for `runNode` snippets |
| `startServer(entry, env)` | spawn `server.js` / `dev/start.js` on a free port, wait for `/healthz`; returns `{ baseUrl, output(), waitForOutput(text), stop() }` |
| `createClient(baseUrl)` | cookie jar; `request(path, opts)` (redirect: manual), `send(method, path, body)` with CSRF token, `cookie(name)` reads the jar (e.g. `connect.sid`) |
| `loadFrontendApp(routes)` | runs `public/js/app.js` in `node:vm`; fake elements for every `id` in `index.html` and in assigned `innerHTML`; `fetch` answers from `routes` (URL → body or `() => body`/promise, else 404); records every `fetch` as `{ url, method, headers }`; returns `{ app, element(id), toasts, requests, location }` — stubs EasyMDE, flatpickr and `bootstrap.Modal` for the event wizard; `localStorage`/`sessionStorage` stubs (`{ storage }` option for initial entries); document listeners are recorded and `fire(type)` runs them; `app` exposes `showEventDetail`, `showProfileSection`, `logout`, `getErrorMessage`, `editEvent`, `loadAdminEvents`, `showEventsSection`, `fetchDiscordEvents`, `markdownPreview`, `getCurrentUser`, `setCurrentUser` and `setCsrfToken`; extend the export line at the end of the helper for more functions |

## Writing a test

- Endpoint behaviour → extend `devServer.test.js` (mock mode, seeded data: ids in `dev/seedData.js` `EVENT_ID`) and log in with `loginAs('<persona>')`.
- In-process module tests: set `process.env` (e.g. `DEV_MOCK`, `DEV_SQLITE_PATH`) and `process.chdir(createTempDir(...))` BEFORE requiring app modules — `firebaseAdmin.js` and the adapter read the environment at require time.
- Frontend function → `loadFrontendApp` (see `eventDetailReset.test.js`); assert `toasts` is empty, because most `app.js` handlers swallow errors in a `catch` that only shows a toast.
- Each test file runs in its own process (node:test default), so module state does not leak between files.
- Test order inside a file is sequential; some `devServer` tests depend on earlier ones (e.g. draft visibility before "start event").

## Commands

```bash
npm test                                    # all suites
node --test test/devServer.test.js          # one file
npm run wiki:check                          # wiki only
```

GitLab CI runs the same `npm test` in every pipeline (job `test`); see [ci](ci.md).
