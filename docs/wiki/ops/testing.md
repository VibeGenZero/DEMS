---
id: testing
title: Testing — node:test suites and helpers
type: ops
tags: [testing, node-test, integration-tests, helpers, tdd]
sources: [playwright.config.js, e2e/helpers.js, e2e/tour.spec.js, test/helpers.js, test/devServer.test.js, test/noMock.test.js, test/mockMode.test.js, test/mockBot.test.js, test/seed.test.js, test/sqliteAdapter.test.js, test/eventUrl.test.js, test/wiki.test.js, test/branding.test.js, test/vendorAssets.test.js, test/eventDetailReset.test.js, test/profileRegistrations.test.js, test/login.test.js, test/authFrontend.test.js, test/fixtures/fakeDiscordServer.js, test/sessionStore.test.js, test/sessionRestart.test.js, test/reminders.test.js, test/reminderScheduler.test.js, test/eventForm.test.js, test/startup.test.js, test/avatar.test.js, test/eventCards.test.js, test/botPermissions.test.js, test/hardening.test.js, test/roleRefresh.test.js, test/roleRefreshServer.test.js, e2e/styleguide.spec.js, scripts/style-snapshot.js, test/cssSource.js, test/cssRules.test.js, test/designTokens.test.js, test/components.test.js, test/styleguide.test.js, test/contrast.test.js, test/styleSnapshot.test.js, test/navLinks.test.js]
see_also: [dev-mock-mode, conventions]
---
# Testing — node:test suites and helpers

> TL;DR: `npm test` runs `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test "test/**/*.test.js"` (built-in runner, no dependencies; the flag lets `loadFrontendModules` load the frontend ES modules with `vm.SourceTextModule`). Server behaviour is tested end-to-end by spawning `server.js` / `dev/start.js` in a child process with a temp SQLite file and driving it with a cookie-aware fetch client that handles CSRF. Single frontend functions run in `node:vm` against a fake DOM (`loadFrontendApp`). Browser smoke tests (Playwright, Chromium only) run separately with `npm run test:e2e`.

## Suites

| File | Covers |
|---|---|
| `sqliteAdapter.test.js` | `doc(collectionRef, id)` support of the SQLite adapter |
| `mockMode.test.js` | production guard, forced environment, `dev/start.js` refusing production |
| `mockBot.test.js` | mock Discord helpers (roles incl. `fetchMemberRoleIds`, channels, DMs, event channels, "Zum Event" button link) via `bot.js` |
| `eventUrl.test.js` | `buildEventUrl` builds `#event/<id>`; no server file builds `#events/<id>` links |
| `eventListing.test.js` | `utils/eventListing.js`: end of an event (with/without `endDate`, space instead of `T`, no or invalid start), `isEventOver`, `myRegistrationStatus` for every status, guests of accepted/pending/waitlisted/rejected registrations and strangers |
| `seed.test.js` | seed counts, idempotence, reset, refusal outside mock mode / with Firebase |
| `devServer.test.js` | CSP (scripts/styles/fonts only `'self'`, no `unsafe-eval`, `script-src-attr 'none'`), persona login (new session, parallel first changes pass CSRF), no session for cookie-less requests until `/api/csrf-token`, reminder `sent` kept on save / reset on duplicate, several reminders as "24, 1", deleting an event or series deletes its Discord channels (mock log), a comment carries its author's avatar URL, wrong check-in codes limited per member (429 after 10), six-digit check-in code, CSV formulas defused, unsafe banner URL / colour refused, admin/member access, event API only with login, draft/archived only for admins, guests see only status and id of the inviting registration, no `checkinCode` in member answers, mock data in routes, announce, start event, check-in, rate limits, maintenance + panic lockout |
| `noMock.test.js` | without `DEV_MOCK` the OAuth redirect stays and the persona login does not exist |
| `wiki.test.js` | wiki frontmatter/link/graph validation and that `docs/wiki/graph.json` is current |
| `branding.test.js` | the old product name ("Discord" + "Event Management") appears in no git-tracked file outside `public/vendor` (untracked files such as CI's npm logs are ignored) |
| `vendorAssets.test.js` | `index.html` loads no script/stylesheet from another host, every local reference and every `url()` in `public/vendor/**/*.css` exists, `fonts.css` bundles Inter + UnifrakturCook |
| `designTokens.test.js` | every required token exists in `public/css/tokens.css`; WCAG AA contrast of every text colour on every surface, on the tints and on the solid fills (maths: `public/js/core/contrast.js`, tested in `contrast.test.js`) |
| `cssRules.test.js` | guards for `components.css` and `style.css` (reader: `test/cssSource.js`): load order in `index.html`, no raw colour, px/rem font size, z-index ≥ 10 or px radius, no selector list twice, no undefined `var(--x)`, logo font only on the logo, component selectors present and not restyled in `style.css`, budgets for `style` attributes and for `!important` in `style.css` |
| `components.test.js` | `showToast` (type class, icon, unknown type, missing icon element), `renderSkeletonEvents`, `initialsOf`, `avatar`, `emptyState` (escaping) |
| `styleguide.test.js` | the styleguide renders the nine component blocks, has its three parts in `index.html`, sets no `style` attributes; `contrastLabel`, `contrastNote` |
| `styleSnapshot.test.js` | comparison logic of `scripts/style-snapshot.js` |
| `navLinks.test.js` | a route change marks only the links of `#main-navbar` as active; a `.nav-link` of the tabs component keeps its state |
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
| `roleRefresh.test.js` | `createRoleRefresh` with a fake clock and fake Discord: revoked/new admin role within 5 min, left server, sessions without check time, Discord unreachable (values kept, retry after 1 min), shared lookup |
| `roleRefreshServer.test.js` | plants a session with a stale `isAdmin: true` for the member persona in the shared SQLite file, signs the cookie with the mock secret → `/api/admin/stats` answers 403, `/auth/me` shows the real roles |
| `authFrontend.test.js` | frontend `logout()` posts the CSRF token, failure toast, no `/auth/logout` navigation left, `invalid_state` message |
| `jsSource.test.js` | `test/jsSource.js` scanner: strings, comments, template text and regex bodies blanked with positions kept, nesting depth per line, code identifiers (spread operands count, properties and object keys do not), `findMissingImports` (exports used without import; same-named own declarations are skipped) |
| `frontendLoader.test.js` | `loadFrontendModules`: new module instances per load, a missing export fails, a clear message without `--experimental-vm-modules` |
| `frontendModules.test.js` | `app.js` is gone and `index.html` loads `/js/main.js` as a module; modules ≤ 550 lines and run no code on import (only `registerActions` and the startup listeners in `main.js`); shared values only through `state`; no local binding named `state` in modules that import it |
| `frontendActions.test.js` | `core/actions.js` alone: innermost action wins, `preventDefault` only for links, change/input attributes, unknown/failing actions logged, duplicate names refused, built-in `toggleVisible`/`hide`/`scrollTo`, image fallbacks incl. images that failed before start |
| `actionAttributes.test.js` | rendered markup carries values as data attributes (display names with quotes and entities arrive unchanged) and the actions do the right thing: overview, calendar, event page, replies (one reply POST), guests, polls (vote sends the answer), admin cards and registrations, wizard steps and location, Discord import, welcome dialog booleans |
| `frontendCsp.test.js` | guards: no inline handler in `index.html` or `public/js/**`, every `data-click`/`data-change`/`data-input` name is registered and literal, no `window` bridge, every use of another module's export (call, reference or constant) is imported (`findMissingImports`) |
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
| `await loadFrontendApp(routes)` | links the ES modules from `public/js/main.js` with `loadFrontendModules` in a fresh `node:vm` context per call (needs `--experimental-vm-modules`, set by `npm test`); returns `{ app, state, … }` — `app` holds every export of every module, `state` is `core/state.js` (`state.currentUser = persona` logs a user in); fake elements for every `id` in `index.html` and in assigned `innerHTML`; `fetch` answers from `routes` (URL → body or `() => body`/promise, else 404); records every `fetch` as `{ url, method, headers, body }`; also returns `element(id)`, `toasts`, `requests`, `location` and `fire(type)` (runs the recorded document listeners) — stubs EasyMDE, flatpickr and `bootstrap.Modal` for the event wizard; `localStorage`/`sessionStorage` stubs (`{ storage }` option for initial entries). Run an action like a click with `app.runAction(name, element)` |

## Writing a test

- Endpoint behaviour → extend `devServer.test.js` (mock mode, seeded data: ids in `dev/seedData.js` `EVENT_ID`) and log in with `loginAs('<persona>')`.
- In-process module tests: set `process.env` (e.g. `DEV_MOCK`, `DEV_SQLITE_PATH`) and `process.chdir(createTempDir(...))` BEFORE requiring app modules — `firebaseAdmin.js` and the adapter read the environment at require time.
- Frontend function → `loadFrontendApp` (see `eventDetailReset.test.js`); assert `toasts` is empty, because most frontend handlers swallow errors in a `catch` that only shows a toast.
- Each test file runs in its own process (node:test default), so module state does not leak between files.
- Test order inside a file is sequential; some `devServer` tests depend on earlier ones (e.g. draft visibility before "start event").

## Browser smoke tests (`npm run test:e2e`)

- Playwright `@playwright/test` (devDependency, pinned exactly; no install script, so `npm ci` and `npm test` download no browser). Once per machine: `npx playwright install chromium`.
- `playwright.config.js` starts `node dev/start.js` on port 3123 with a fresh temp database (`DEV_SQLITE_PATH` in the OS temp dir) — `data/dems.dev.sqlite` and a running dev server on 3000 stay untouched. Projects: `desktop` 1440×900 and `mobile` 390×844 (touch, folded navigation).
- `e2e/tour.spec.js`: every persona (`admin`, `raider`, `member`, `newbie`) logs in through `/auth/dev-login/<id>` and walks overview → event page → polls → profile → info, admin also admin area and bot control; non-admins do not see the admin nav and are sent back from `#admin`. Plus: raid role picker for the raider vs. "Zugriff eingeschränkt" for the member, logout back to the login page.
- `e2e/styleguide.spec.js`: opens `#debug` as admin (the test server runs with `DEBUG_MODE=true`) and checks that the tokens and all nine components render, buttons are 32/40/48 px tall, nothing reaches beyond the page width, many tabs scroll sideways on the phone, toast types differ and the confirm dialog opens.
- `e2e/helpers.js`: `loginAs` (skips boot animation and "Neuigkeiten" dialog via `localStorage`, closes the welcome dialog of `newbie`), `navigate` (opens the folded menu on the phone and folds it again afterwards, waiting for the Bootstrap animation — the open menu covers the page and Bootstrap ignores toggles while it animates), `watchErrors` — every test fails on an uncaught page error or a `console.error` (failed resource loads ignored). Chromium reports an inline handler blocked by the CSP (`script-src-attr 'none'`) as such an error, so a forgotten `onclick=` fails every tour step that reaches it; the test "the error watch reports a blocked inline handler" pins that; `waitForDialog(page, selector)` waits until Bootstrap has finished fading a dialog in — use it before clicking a close button, Bootstrap ignores `hide()` while the fade-in runs.
- Not part of `npm test` and not in CI; run it before frontend changes, especially the 3.0 redesign. Output (`test-results/`, `playwright-report/`) is git-ignored.

## Comparing the look before and after (`scripts/style-snapshot.js`)

For CSS refactorings that should not change the look: `node scripts/style-snapshot.js --out data/before.json` starts its own mock server on port 3124, logs in as admin, visits the core pages on 1440 px and 390 px and writes the computed styles of every element (hidden dialogs included, `#debug-section` excluded; running CSS animations are cancelled first). After the change write a second file and run `node scripts/style-snapshot.js --compare data/before.json data/after.json`: one line per property and value pair with the number of elements and sample labels. It records the resting state only (no hover, no focus) and no layout, so also look at the page. Not part of `npm test`; needs `npx playwright install chromium`.

## Commands

```bash
npm test                                    # all suites
npm run test:e2e                            # browser smoke tests (Playwright, needs Chromium once)
node --test test/devServer.test.js          # one file
node --experimental-vm-modules --test test/eventCards.test.js   # one frontend file (needs the flag)
npm run wiki:check                          # wiki only
```

GitLab CI runs the same `npm test` in every pipeline (job `test`); see [ci](ci.md).
