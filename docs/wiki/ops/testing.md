---
id: testing
title: Testing — node:test suites and helpers
type: ops
tags: [testing, node-test, integration-tests, helpers, tdd]
sources: [test/helpers.js, test/devServer.test.js, test/noMock.test.js, test/mockMode.test.js, test/mockBot.test.js, test/seed.test.js, test/sqliteAdapter.test.js, test/eventUrl.test.js, test/wiki.test.js, test/branding.test.js]
see_also: [dev-mock-mode, conventions]
---
# Testing — node:test suites and helpers

> TL;DR: `npm test` runs `node --test "test/**/*.test.js"` (built-in runner, no dependencies). Server behaviour is tested end-to-end by spawning `server.js` / `dev/start.js` in a child process with a temp SQLite file and driving it with a cookie-aware fetch client that handles CSRF. There are no frontend (browser) tests.

## Suites

| File | Covers |
|---|---|
| `sqliteAdapter.test.js` | `doc(collectionRef, id)` support of the SQLite adapter |
| `mockMode.test.js` | production guard, forced environment, `dev/start.js` refusing production |
| `mockBot.test.js` | mock Discord helpers (roles, channels, DMs, event channels, "Zum Event" button link) via `bot.js` |
| `eventUrl.test.js` | `buildEventUrl` builds `#event/<id>`; no server file builds `#events/<id>` links |
| `seed.test.js` | seed counts, idempotence, reset, refusal outside mock mode / with Firebase |
| `devServer.test.js` | persona login, admin/member access, mock data in routes, announce, start event, check-in, rate limits, maintenance + panic lockout |
| `noMock.test.js` | without `DEV_MOCK` the OAuth redirect stays and the persona login does not exist |
| `wiki.test.js` | wiki frontmatter/link/graph validation and that `docs/wiki/graph.json` is current |
| `branding.test.js` | the old product name ("Discord" + "Event Management") appears in no git-tracked file outside `public/vendor` (untracked files such as CI's npm logs are ignored) |

## Helpers (`test/helpers.js`)

| Helper | Use |
|---|---|
| `createTempDir(prefix)` | fresh temp directory (SQLite files, cwd for child processes) |
| `cleanEnv(env)` | copy of `process.env` without `DISCORD_*`, `FIREBASE_*`, `DEV_*`, `NODE_ENV`, `SQLITE_PATH`, ... merged with `env` |
| `runNode(code, env)` | run a JS snippet in a fresh process (empty cwd → no `.env` leaks in) |
| `repoPath(rel)` | absolute path as JS string literal for `runNode` snippets |
| `startServer(entry, env)` | spawn `server.js` / `dev/start.js` on a free port, wait for `/healthz`; returns `{ baseUrl, output(), waitForOutput(text), stop() }` |
| `createClient(baseUrl)` | cookie jar; `request(path, opts)` (redirect: manual) and `send(method, path, body)` with CSRF token |

## Writing a test

- Endpoint behaviour → extend `devServer.test.js` (mock mode, seeded data: ids in `dev/seedData.js` `EVENT_ID`) and log in with `loginAs('<persona>')`.
- In-process module tests: set `process.env` (e.g. `DEV_MOCK`, `DEV_SQLITE_PATH`) and `process.chdir(createTempDir(...))` BEFORE requiring app modules — `firebaseAdmin.js` and the adapter read the environment at require time.
- Each test file runs in its own process (node:test default), so module state does not leak between files.
- Test order inside a file is sequential; some `devServer` tests depend on earlier ones (e.g. draft visibility before "start event").

## Commands

```bash
npm test                                    # all suites
node --test test/devServer.test.js          # one file
npm run wiki:check                          # wiki only
```

GitLab CI runs the same `npm test` in every pipeline (job `test`); see [ci](ci.md).
