# Plugin studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run plugin -- studio` opens a local browser studio with the Monaco editor, a live DEMS preview of the plugin on its own origin, a debug panel (the plugin's DMs, posts, roles, route requests, hooks, logs, errors), hook buttons, check and a build download.

**Architecture:** A small Node process (`scripts/studio/`) serves the studio page and its token-guarded API on `127.0.0.1:3100`, forks DEMS in mock mode as a child on a random port, proxies it on `127.0.0.1:3101` (framing headers rewritten so only the studio may embed it) and restarts the child when the plugin folder changes. Inside DEMS, `dev/studioEvents.js` forwards debug events over the fork IPC channel, inert outside studio mode. The page is plain ES modules plus vendored Monaco.

**Tech Stack:** Node ≥ 22 built-ins (`http`, `child_process.fork`, `fs.watch`, `crypto`), Express 5 (DEMS side only), vendored Monaco Editor (pinned, MIT), DEMS CSS tokens/Bootstrap from `public/vendor/`, `node:test`, Playwright for one smoke test.

**Spec:** `docs/superpowers/specs/2026-11-26-plugin-studio-design.md` (builds on `docs/superpowers/specs/2026-11-25-plugin-builder-design.md`)

## Global Constraints

- No new npm dependency; Monaco is vendored as pinned static files under `scripts/studio/vendor/monaco/` with its LICENSE; nothing under `scripts/studio/` may reach the Docker image.
- The studio refuses `NODE_ENV=production`; both servers listen on `127.0.0.1` only.
- Studio requests: `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (else 403); API calls need header `X-Studio-Token: <token>` (32 random bytes, hex), mutating calls also `Origin` = studio origin; the token reaches the page once via the start URL fragment and lives only in page memory.
- The file API never touches anything outside the opened plugin folder, never follows links, accepts only names `packageEntryError` (part 1, `plugin-sdk/files.js`) allows and the build would not skip; sizes within `LIMITS`.
- DEMS gets no route that writes files; studio-only DEMS behaviour lives in `dev/` and is active only with `PLUGIN_STUDIO=1` + mock mode + `process.send`.
- The preview proxy changes only framing: CSP `frame-ancestors 'self' http://127.0.0.1:<studioPort>` and no `X-Frame-Options`.
- Studio page CSP: `default-src 'self'; frame-src http://127.0.0.1:<previewPort>; worker-src 'self' blob:; style-src 'self' 'nonce-<per load>'` (fallback `'unsafe-inline'` for style-src only, if Monaco can't use the nonce); no inline scripts/handlers; our own code no inline styles.
- Debug panel shows only the plugin's own Discord output (emitted in `plugin-sdk/discord.js`), including drops with their German reason; event strings truncated at 10 kB; the studio keeps the last 500 events.
- German UI text (studio page, CLI lines, debug texts), English code/comments/wiki/commits; escape every interpolated value in the page.
- Ports: studio default 3100 (`--port`), preview = studio port + 1, DEMS child on a random free port.
- Recent list: last 10, in `%APPDATA%/dems-studio/recent.json` (Windows) / `$XDG_CONFIG_HOME` or `~/.config/dems-studio/recent.json`.
- Every wiki change → `npm run wiki`; `npm test` green after every task.

## Review Focus

1. **A web page the author visits while the studio runs** (CSRF / DNS rebinding) and **the plugin's own client code in the preview frame** must not be able to read or write files: wrong Host → 403, missing/wrong token → 401, wrong Origin on POST → 403, and the preview origin (3101) cannot call studio API routes (no token, other origin). → tests in Task 3.
2. **Saving in quick succession / DEMS failing to start** (syntax error in `server.js`, port taken): restarts are debounced and serialised, the last saved state wins, the preview shows „DEMS startet neu …“ and the child's last stderr lines appear as an `error` event; the studio itself never crashes. → tests in Task 6.
3. **Windows paths** (backslashes, drive letters, a folder on another drive, a junction inside the plugin folder): opening `C:\Users\x\plugins\demo` works; a junction or `..` inside is refused. → tests in Task 4.
4. **Large or binary files in the plugin folder** (an image in `assets/`, a 3 MB JSON): listed, not opened as text in the editor (binary or > 2 MB → „Kann nicht im Editor geöffnet werden“), still packaged by „Bauen“. → tests in Task 4 and Task 10.
5. **Closing the browser tab or pressing Ctrl+C in the terminal**: Ctrl+C stops the DEMS child (process tree) and both servers; a closed tab leaves the studio running and reopening the printed URL with token works. → test in Task 8.

---

### Task 1: Studio event channel and Discord/log emitters

**Files:**
- Create: `dev/studioEvents.js`
- Modify: `plugin-sdk/discord.js` (`createDiscordApi`: emit `dm` / `channel` / `role` with result), `plugin-sdk/context.js` (`createLog`: emit `log`)
- Test: `test/studioEvents.test.js`, `test/pluginDiscord.test.js`

**Interfaces:**
- Produces:
  - `studioEvents.isActive() -> boolean` — `process.env.PLUGIN_STUDIO === '1' && mock mode && typeof process.send === 'function'` (mock mode = `process.env.DEV_MOCK === 'true'`, never with `NODE_ENV=production`)
  - `studioEvents.emit(type: string, pluginId: string, data: object) -> void` — no-op when inactive; sends `{ studio: true, type, pluginId, at: ISO string, data }` via `process.send`; every string in `data` truncated to 10 240 chars with suffix `…`; never throws (send errors swallowed)
  - `studioEvents.setSender(fn|null)` for tests (replaces `process.send` lookup)
  - event shapes: `dm` `{ userId, userName, text, link, result: 'sent'|'dropped', reason }`; `channel` `{ channel, text, link, result, reason }`; `role` `{ userId, roleId, give: boolean, result: 'ok'|'refused', reason }`; `log` `{ level: 'info'|'warn'|'error', text }`
- `plugin-sdk/` modules require `../dev/studioEvents` lazily inside the emit helper (keep `plugin-sdk` free of a hard dev dependency; if the file is missing, no-op).

- [ ] **Step 1: Write the failing tests** — inactive (no env) → sender never called; active → one message with the exact shape; a 20 000-char text arrives as 10 240 chars + `…`; a throwing sender doesn't throw out of `emit`; `createDiscordApi` with studio active: a sent DM emits `dm` with `result 'sent'`, a DM refused by the limiter emits `result 'dropped'` with the German limiter reason, a refused text (`checkText`) emits the refusal reason; channel post and role give/take likewise; `ctx.log.warn('x')` emits `log` `{ level: 'warn', text: 'x' }` (args joined with spaces, objects via `JSON.stringify`).
- [ ] **Step 2: Run** `node --test test/studioEvents.test.js test/pluginDiscord.test.js` → FAIL.
- [ ] **Step 3: Implement** the module and the emit calls (one helper per file; `log.*` still writes to the console as today).
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** „Forward plugin DMs, posts, roles and logs to the studio“.

---

### Task 2: Request, hook, error and lifecycle emitters

**Files:**
- Modify: `routes/plugins.js` (dispatch at `router.use('/:pluginId', …)`), `plugin-sdk/hooks.js` (`runHandler`), `plugin-sdk/host.js` (`reportError`, register failure, runtime changes)
- Modify: `docs/wiki/modules/dev-mock-mode.md` (studio events section), `docs/wiki/ops/configuration.md` (`PLUGIN_STUDIO`, internal, set by the studio)
- Test: `test/pluginRouter.test.js`, `test/pluginHooks.test.js`, `test/pluginHost.test.js`

**Interfaces:**
- Consumes: `studioEvents.emit`, `setSender` (Task 1)
- Produces event shapes: `request` `{ method, path, status, ms, requestBody, responseBody }` (path below `/api/plugins/<id>`; bodies JSON-stringified, truncated by `emit`); `hook` `{ name, summary, ok: boolean, error }` (`summary` = event `title`/`id` or registration `id`); `error` `{ message, where }` (`where` = `'register'|'route'|'hook:<name>'`); `lifecycle` `{ status }` (the new `runtime` value)

- [ ] **Step 1: Write the failing tests** — with an active sender: a plugin route answering 201 `{ ok: true }` to `POST /x` with body `{ a: 1 }` emits one `request` with method `POST`, path `/x`, status 201, both bodies; a 500 route emits `request` status 500 and `error` where `route`; a hook handler emits `hook` ok true, a throwing one ok false + error; a failing `register` emits `error` where `register` and `lifecycle` `error`; switching on emits `lifecycle` `on`. Without the sender nothing changes in existing tests.
- [ ] **Step 2: Run** the three test files → FAIL.
- [ ] **Step 3: Implement** (capture the response body by wrapping `res.json` for the dispatched request only; timing via `process.hrtime.bigint()`); wiki lines.
- [ ] **Step 4: Run** `npm run wiki && npm test` → PASS.
- [ ] **Step 5: Commit** „Report plugin requests, hooks and errors to the studio“.

---

### Task 3: Studio server core (security, static page, CSP)

**Files:**
- Create: `scripts/studio/server.js`, `scripts/studio/security.js`, `scripts/studio/public/index.html` (shell only: `<div id="app">`, script `app.js`), `scripts/studio/public/app.js` (placeholder export)
- Test: `test/studioServer.test.js`

**Interfaces:**
- Produces:
  - `createStudioServer({ port, previewPort, token, routes, publicDir, vendorDirs }) -> { listen(): Promise<void>, close(): Promise<void>, url: string }` — `routes` is a map `'METHOD /api/path' -> async (req, body, query) => { status, json? , headers?, body? }` (later tasks add routes); `vendorDirs` maps URL prefixes to read-only folders (`/vendor/` → `public/vendor`, `/monaco/` → `scripts/studio/vendor/monaco`, `/css/tokens.css` → `public/css/tokens.css`)
  - `security.checkHost(req, port) -> boolean`, `security.checkToken(req, token) -> boolean` (`X-Studio-Token` header, or `token` query param for `GET /api/events` only, compared with `crypto.timingSafeEqual`), `security.checkOrigin(req, port) -> boolean`, `security.pageCsp(nonce, previewPort) -> string`
  - `index.html` is served with a fresh nonce per load (in the CSP header and a `<meta name="csp-nonce" content="…">` tag); unknown paths 404; static files only from the listed folders, no `..`, no dotfiles; JSON bodies ≤ 3 MB.

- [ ] **Step 1: Write the failing tests** (start on port 0 / random): `GET /` with `Host: evil.example` → 403; with `Host: 127.0.0.1:<port>` → 200, `content-security-policy` contains `frame-src http://127.0.0.1:<previewPort>`, a `nonce-` that equals the meta tag and differs between two loads; `GET /api/ping` (a test route) without token → 401, wrong token → 401, right token → 200; `POST /api/ping` with right token and `Origin: http://127.0.0.1:<previewPort>` → 403, with studio origin → 200; `GET /vendor/../../package.json` → 404; `GET /monaco/.hidden` → 404; body of 4 MB → 413 „Die Anfrage ist zu groß.“; the server listens on `127.0.0.1` (check `address().address`).
- [ ] **Step 2: Run** `node --test test/studioServer.test.js` → FAIL.
- [ ] **Step 3: Implement** with `http.createServer` (no Express in the studio).
- [ ] **Step 4: Run** → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** „Add the studio server with host, token and origin checks“.

---

### Task 4: File API and recent list

**Files:**
- Create: `scripts/studio/files.js`, `scripts/studio/recent.js`
- Test: `test/studioFiles.test.js`

**Interfaces:**
- Consumes: `packageEntryError`, `LIMITS` (`plugin-sdk/files.js`); build skip rules (part 1: dot entries, `node_modules`, extension-less files)
- Produces:
  - `openPlugin(folder: string) -> { dir, manifest, id, version }` — absolute, resolved once (`fs.realpathSync`), must contain a valid `plugin.json` (`validateManifest` with folder name = id) else `StudioError` with the German reason
  - `listFiles(dir) -> Array<{ path, size, text: boolean }>` (POSIX paths, sorted, skipped entries not listed; `text` false for non-UTF-8 or > `LIMITS.entryBytes`)
  - `readFile(dir, rel) -> string`, `writeFile(dir, rel, content: string)`, `writeBinary(dir, rel, buffer)` (assets upload), `createFile(dir, rel)` (empty, refuses existing), `renameFile(dir, from, to)`, `deleteFile(dir, rel)` — each throws `StudioError` („Unerlaubter Pfad: …“, „Datei nicht gefunden: …“, „Die Datei gibt es schon: …“, „Kann nicht im Editor geöffnet werden: …“, „Datei zu groß: …“)
  - `StudioError extends Error` (German message, `status` 400/404/409)
  - `recent.load(configDir) -> Array<{ dir, id, name, openedAt, exists }>`, `recent.add(configDir, entry)`, `recent.remove(configDir, dir)`, `recent.configDir(env, platform) -> string`
  - routes (registered by Task 7): see Task 7

Confinement: `path.relative(dir, path.resolve(dir, rel))` must not start with `..` or be absolute; every existing segment checked with `lstat` (no link anywhere on the way); `rel` uses `/` only.

- [ ] **Step 1: Write the failing tests** — `openPlugin` on a scaffold (from part 1's `new`) returns id/version; a Windows-style path with backslashes works; a folder without `plugin.json` → German error; `listFiles` hides `.git`, `node_modules`, `LICENSE`; `readFile('../x')`, `readFile('C:/x')`, a path through a junction inside the folder → „Unerlaubter Pfad“; `writeFile('index.html', …)` → refused; a 3 MB `data.json` → `text: false`, `readFile` → „Kann nicht im Editor geöffnet werden“; `renameFile` to an existing name → 409; `recent`: keeps the newest 10, dedupes by `dir`, marks a deleted folder `exists: false`, `configDir` for `win32` uses `APPDATA`, for linux `XDG_CONFIG_HOME` then `~/.config`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** „Confine the studio file API to the opened plugin folder“.

---

### Task 5: Preview proxy

**Files:**
- Create: `scripts/studio/proxy.js`
- Test: `test/studioProxy.test.js`

**Interfaces:**
- Produces: `createPreviewProxy({ port, studioPort, target: () => ({ port }|null) }) -> { listen(), close(), url }` — forwards every request (method, headers, streamed body) to `127.0.0.1:<target().port>`; on the response removes `x-frame-options` and replaces the `frame-ancestors` directive of `content-security-policy` with `frame-ancestors 'self' http://127.0.0.1:<studioPort>` (other directives untouched; if there is no CSP header, none is added); `Location` headers pointing at the child's origin are rewritten to the preview origin; while `target()` is null or the child refuses the connection → 503 with a small German HTML page „DEMS startet neu …“ (auto-reload every 2 s via `<meta http-equiv="refresh" content="2">`, no script). `Host` must be `127.0.0.1:<port>`/`localhost:<port>` (else 403).

- [ ] **Step 1: Write the failing tests** (a tiny upstream http server as target): CSP `default-src 'self'; frame-ancestors 'self'` comes back as `default-src 'self'; frame-ancestors 'self' http://127.0.0.1:<studioPort>`; `X-Frame-Options` removed; `Set-Cookie` unchanged; a POST body of 1 MB arrives intact; `Location: http://127.0.0.1:<childPort>/x` → `http://127.0.0.1:<port>/x`; target null → 503 page containing „DEMS startet neu“; bad Host → 403.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with `http.request` piping.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** „Proxy the DEMS preview with studio-only framing“.

---

### Task 6: DEMS child supervisor and event stream

**Files:**
- Create: `scripts/studio/child.js`, `scripts/studio/events.js`
- Test: `test/studioChild.test.js`

**Interfaces:**
- Consumes: `prepareDev(folder, { repoRoot, env })` from `scripts/plugin.js` (part 1: mounts the plugin under `data/dev-plugins`, returns `{ linkDir, configPath, env }`)
- Produces:
  - `createChild({ repoRoot, folder, previewOrigin, onEvent, fork = child_process.fork }) -> { start(): Promise<void>, restart(): Promise<void>, stop(): Promise<void>, port(): number|null, status(): 'starting'|'running'|'stopped'|'failed' }` — forks `<repoRoot>/dev/start.js` with `env = { ...prepareDev(...).env, PORT: <free port>, PLUGIN_STUDIO: '1', BASE_URL: previewOrigin }`, `stdio: ['ignore','pipe','pipe','ipc']`; ready when `GET /healthz` on the port answers (poll ≤ 30 s); keeps the last 40 stderr lines; on exit before ready → status `failed` and `onEvent({ type: 'error', data: { message: <last stderr lines joined>, where: 'start' } })`; IPC messages with `studio: true` go to `onEvent`; `restart()` calls are serialised and coalesced (a restart requested during a restart runs once more afterwards); `stop()` kills the process tree (`taskkill /T /F /PID` on win32, `process.kill(-pid)`/`SIGTERM` then `SIGKILL` after 3 s elsewhere — fork with `detached: true` on POSIX for the group).
  - `watchPlugin(dir, onChange, { debounceMs = 300 }) -> { close() }` (`fs.watch` recursive; ignores dot entries and `node_modules`)
  - `createEventLog({ max = 500 }) -> { push(event), list(), clear(), subscribe(fn) -> unsubscribe }`
  - SSE handler `eventStream(log) -> (req, res)`: `text/event-stream`, replays `list()`, then streams; `event: studio`, `data: <JSON>`; heartbeat comment every 15 s.

- [ ] **Step 1: Write the failing tests** — with an injected fake `fork` (EventEmitter + fake stdout/stderr + a tiny http server for `/healthz`): env contains `PLUGIN_STUDIO=1`, `PLUGINS_DEV_ID`, `PORT`, `BASE_URL`; three `restart()` calls in a row cause exactly two real restarts; a child exiting before ready → status `failed` and an `error` event with its stderr; IPC `{ studio: true, type: 'dm', … }` reaches `onEvent`, other IPC messages don't; `stop()` uses `taskkill /T /F` on win32 (inject `platform` + `execFile`); event log keeps 500 and drops the oldest; SSE replays then streams one new event. One real-process test (skipped when it takes > 60 s) forks the real DEMS mock child on a temp `PLUGINS_DIR`, waits for `/healthz`, stops it and asserts the port is closed.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** „Run and restart DEMS for the studio and stream its events“.

---

### Task 7: Studio actions (open/new, files, check, build, triggers, VS Code)

**Files:**
- Create: `scripts/studio/actions.js`, `scripts/studio/triggers.js`
- Test: `test/studioActions.test.js`, `test/studioTriggers.test.js`

**Interfaces:**
- Consumes: Tasks 3–6; part 1 `analyzePlugin`, `writeManifest`, `packPlugin`, `formatWarning`, the CLI scaffold function used by `plugin new` (export it from `scripts/plugin.js` as `scaffoldPlugin(id, parentDir) -> dir` if it is not exported yet)
- Produces API routes (all need the token; JSON in/out; errors `{ error: '<German>' }` with the `StudioError` status):

| Route | Body / query | Answer |
|---|---|---|
| `GET /api/state` | — | `{ plugin: { id, name, version, dir } \| null, child: status, previewUrl, recent }` |
| `POST /api/open` | `{ dir }` | `{ plugin }` — opens, adds to recent, (re)starts the child |
| `POST /api/new` | `{ id, parentDir }` | `{ plugin }` — scaffold then open |
| `POST /api/recent/remove` | `{ dir }` | `{ recent }` |
| `GET /api/files` | — | `{ files }` |
| `GET /api/file` | `?path=` | `{ path, content }` |
| `PUT /api/file` | `{ path, content }` | `{ ok: true }` (the watcher restarts the child) |
| `POST /api/file` | `{ path }` create · `{ path, base64 }` upload asset | `{ ok: true }` |
| `POST /api/file/rename` | `{ from, to }` | `{ ok: true }` |
| `DELETE /api/file` | `{ path }` | `{ ok: true }` |
| `POST /api/check` | — | `{ lines: string[], errors: string[], changed: boolean }` — same German lines as the CLI `check` |
| `POST /api/build` | `{ apply: boolean }` | `apply:false` → `{ lines, nextManifest }` preview; `apply:true` → writes `plugin.json` if changed, packs, answers the bytes with `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<id>-<version>.dems"` |
| `POST /api/events/clear` | — | `{ ok: true }` |
| `GET /api/events` | `?token=` | SSE stream (Task 6) |
| `POST /api/trigger` | `{ action }` | `{ ok: true, eventId? , message }` — see below |
| `GET /api/vscode` | — | `{ url: 'vscode://file/<abs dir with forward slashes>' }` |

- Triggers (`createTriggers({ childPort, baseUrl })`): own cookie jars per persona; login via `GET /auth/dev-login/<persona>` on the child (follow the redirect manually, keep `connect.sid`), CSRF token from the endpoint the frontend uses (`grep csrfToken public/js/core/state.js` / `/api/session` or `/auth/me` — use the same), then existing routes only: `create` → `POST /api/admin/events` with fixed data (title „Studio-Test“, start in 1 h, end in 3 h, category from the first seeded category, status `draft`); `publish` → `PUT /api/admin/events/:id/status` `{ status: 'active' }`; `end` → `POST /api/admin/events/:id/end`; `cancel` → `PUT /api/admin/events/:id/cancel`; `delete` → `DELETE /api/admin/events/:id`; `checkin` → as persona `member` `POST /api/events/:id/register` (empty body or the minimal body the route needs), then as admin accept it if pending (`PUT /api/admin/registrations/:id/status` `{ status: 'accepted' }`) and `PUT /api/admin/registrations/:id/checkin` `{ checkedIn: true }`. Actions other than `create` work on the last created event; without one → 409 „Erstelle zuerst ein Test-Event.“. A failing DEMS answer → 502 with the DEMS `error` text. If an action is impossible with existing routes, add a route in `dev/` mounted only in mock mode (never in `routes/`) and say so in the report.

- [ ] **Step 1: Write the failing tests** — actions with temp folders and a fake child: `POST /api/new` creates and opens; `PUT /api/file` writes and the watcher fires; `POST /api/check` on a plugin with a missing permission returns the `+ discord:dm` line; `POST /api/build` `apply:false` doesn't touch `plugin.json`, `apply:true` returns a buffer `readZip` can read with `plugin.json` at the root and updates `plugin.json`; `GET /api/vscode` returns a `vscode://file/` URL with forward slashes. Triggers against a real DEMS mock child with a test plugin that records hooks (like `test/fixtures/plugins/hook-recorder`): create → publish → end produces `event.created`, `event.published`, `event.ended` in the recorder; `checkin` produces `registration.checkedIn`; `end` without an event → 409.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** „Add studio actions for files, check, build and hook triggers“.

---

### Task 8: CLI command `studio` and image guard

**Files:**
- Create: `scripts/studio/index.js` (`startStudio`)
- Modify: `scripts/plugin.js` (`studio` in `COMMANDS`, lazy `require('./studio')`, help line „studio [--port 3100]   Plugin-Studio im Browser öffnen“)
- Modify: `test/composeFiles.test.js` (guard: `scripts/studio/` excluded by `.dockerignore`)
- Test: `test/pluginCli.test.js`, `test/studioStart.test.js`

**Interfaces:**
- Consumes: Tasks 3–7
- Produces: `startStudio({ port = 3100, repoRoot, env, openBrowser = defaultOpen, out }) -> Promise<{ url, stop() }>` — refuses `NODE_ENV=production` with „plugin studio läuft nicht mit NODE_ENV=production.“; creates the token, starts studio server (port) and preview proxy (port + 1), prints „Plugin-Studio läuft auf <url>“ where `url = http://127.0.0.1:<port>/#token=<token>`, opens the browser (`start ""`/`open`/`xdg-open`; failures only print the URL); SIGINT/SIGTERM → `stop()` (child tree, servers) then exit 0; a port in use → „Port <port> ist belegt. Starte mit --port <anderer Port>.“ exit 1.

- [ ] **Step 1: Write the failing tests** — `main(['studio'], { env: { NODE_ENV: 'production' } })` → exit 1 with the message; `startStudio` on port 0 with a fake `openBrowser` prints the URL with `#token=` and the opener got it; `stop()` closes both ports; a taken port → the German message; `.dockerignore` guard: a built context listing (use the existing guard helper) excludes `scripts/studio/**`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** „Start the plugin studio from the CLI“.

---

### Task 9: Type description of the SDK for autocompletion

**Files:**
- Create: `plugin-sdk/types/dems-plugin.d.ts`
- Test: `test/pluginTypes.test.js`

**Interfaces:**
- Produces: `.d.ts` declaring `interface DemsServerContext` (every area/method of `createContext` in `plugin-sdk/context.js`: `id, settings, data, routes, hooks, events, members, registrations, discord, theme, profile, audit, log, siteUrl, onDisable, …` — exactly what the real object has) and `interface DemsClientUi` (every member of the client `ui` in `public/js/core/plugins.js`), German JSDoc per member, `@permission <name>` tag where a permission is needed (same mapping as part 1's scanner table).
- Drift test: build a real ctx (as `test/pluginContext.test.js` does) and the client `ui` (as `test/pluginClient.test.js` does), collect their member paths two levels deep (`events.get`, `discord.sendDM`, …), parse the `.d.ts` member names with a simple regex over `interface` blocks, assert both sets are equal; assert every `@permission` value is a key of `PERMISSIONS` and matches the scanner rule for that member.

- [ ] **Step 1: Write the failing drift test.**
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write the `.d.ts`.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** „Describe the plugin SDK for editor autocompletion“.

---

### Task 10: Studio page — start page, files, Monaco editor

**Files:**
- Create: `scripts/studio/vendor/monaco/` (pinned Monaco Editor `min/vs` build + `LICENSE` + `VERSION` file; only the JS/TS, CSS, JSON, HTML language workers and the `javascript`, `css`, `json`, `markdown` basic languages; stop and report if the folder exceeds 15 MB)
- Create: `scripts/studio/public/app.js`, `start.js`, `workspace.js`, `editor.js`, `api.js`, `studio.css`
- Test: `test/studioPage.test.js`

**Interfaces:**
- Consumes: Task 7 routes, Task 9 `.d.ts` (served at `/types/dems-plugin.d.ts`), Monaco at `/monaco/vs/…` (AMD `loader.js`, `MonacoEnvironment.getWorkerUrl` → same-origin worker URLs)
- Produces (pure, exported for tests): `renderStartPage({ recent }) -> string`, `renderFileList(files, { active, dirty: Set }) -> string`, `editorLanguage(path) -> 'javascript'|'css'|'json'|'markdown'|'plaintext'`, `typeLibFor(path, manifest) -> 'server'|'client'|null` (client = manifest client, `assets/*.js`; server = other `.js`)
- `api.js`: reads the token from `location.hash` once, then `history.replaceState` removes it; every call sends `X-Studio-Token`.
- Behaviour: start page („Neues Plugin“ form with id + Ordner, „Plugin öffnen“ with a path field, recent list with „Öffnen“/„Entfernen“, greyed missing ones); workspace three columns (files | editor tabs | preview area placeholder for Task 11); Ctrl+S / Cmd+S saves the active tab; `●` on dirty tabs; leaving or switching plugin with dirty tabs asks („Ungespeicherte Änderungen verwerfen?“, a dialog, not `confirm()`); non-text files show „Kann nicht im Editor geöffnet werden“; „+ Datei“ creates (name validated by the server), asset upload via file picker; Monaco theme follows the DEMS light/dark tokens; server files get the `DemsServerContext` type on the `register(ctx)` parameter, client files `DemsClientUi` (builder's call how: `addExtraLib` + a JSDoc hint model).

- [ ] **Step 1: Write the failing tests** for the pure functions — `renderStartPage` escapes a `<script>` plugin name and marks `exists:false` entries; `renderFileList` marks active and dirty; `editorLanguage('assets/view.js') === 'javascript'`, `('plugin.json') === 'json'`; `typeLibFor('client.js', { client: 'client.js' }) === 'client'`, `('lib/engine.js', …) === 'server'`, `('README.md') === null`; `api.js` token handling (fake `location`/`history`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Vendor Monaco, implement the modules.**
- [ ] **Step 4: Run** → PASS; `npm test` → PASS. Manual: `npm run plugin -- studio`, create a plugin, type `ctx.` in `server.js` → completion lists `events`, `discord`, `routes`.
- [ ] **Step 5: Commit** „Add the studio start page, file list and Monaco editor“.

---

### Task 11: Studio page — preview, debug panel, hook buttons, check and build

**Files:**
- Create: `scripts/studio/public/preview.js`, `debug.js`, `toolbar.js`
- Test: `test/studioPage.test.js`

**Interfaces:**
- Consumes: Tasks 6, 7, 10
- Produces (pure, exported for tests): `renderDebugEntry(event) -> string` (escaped; `dm` rendered like a Discord DM: avatar placeholder, bold user name, text, link button label; `channel` like a channel post with `#<channel>`; `role` „Rolle <id> an <user> vergeben/entzogen“ + result; `request` „POST /x 201 12 ms“ expandable bodies; `hook` „Hook event.ended · ok/Fehler“; `log` level-coloured; `error` red with `where`; dropped DMs show „nicht gesendet: <reason>“), `filterEvents(events, kind) -> events` (kinds: `alle`, `discord` (dm/channel/role), `anfragen`, `hooks`, `logs`, `fehler`), `renderCheckDialog({ lines, errors })`, `renderBuildPreview({ lines })`
- Behaviour:
  - preview iframe `src = previewUrl`; persona select (Admin = `admin`, Lena = `raider`, Tom = `member`, Neo = `newbie` — ids from `dev/mockGuild.js` `PERSONAS`) navigates the frame to `/auth/dev-login/<id>`; ⟳ reloads; on child status `starting` an overlay „DEMS startet neu …“, on `failed` „DEMS konnte nicht starten – siehe Debug“; the frame reloads after a successful restart.
  - debug panel: `EventSource('/api/events?token=…')`, newest at the bottom, auto-scroll unless the user scrolled up, filter select, „Leeren“.
  - hook buttons „Event erstellen“, „Veröffentlichen“, „Beenden“, „Absagen“, „Löschen“, „Check-in“ → `POST /api/trigger`; toast with the answer's `message`.
  - toolbar: „Prüfen“ → dialog with the lines; „Bauen“ → preview dialog → „Übernehmen und bauen“ → fetch the bytes, `URL.createObjectURL` + `<a download>` click (the browser's save dialog / download folder; dialog text: „Die Datei wird über den Download deines Browsers gespeichert.“); „In VS Code öffnen“ → `GET /api/vscode` then `location.href = url`.

- [ ] **Step 1: Write the failing tests** — `renderDebugEntry` escapes `<img onerror>` in DM text, user name, request bodies and log text; a dropped DM shows the reason; `filterEvents(events, 'discord')` keeps only dm/channel/role; check/build renderers show `+ discord:dm` and „übersprungen: .git“ lines escaped.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** „Add the studio preview, debug panel, hook buttons and build“.

---

### Task 12: Docs and end-to-end smoke test

**Files:**
- Create: `docs/wiki/howto/plugin-studio.md` (frontmatter like other nodes; start, layout, debug panel, hook buttons, build download, VS Code button, limits and security model of the studio in plain words: local only, token, own origin for the preview)
- Modify: `docs/wiki/howto/write-plugin.md` (link + one paragraph), `docs/wiki/index.md` (node list, task → node, file → node for `scripts/studio/`, `dev/studioEvents.js`, `plugin-sdk/types/`), `docs/wiki/modules/dev-mock-mode.md` (link)
- Create: `e2e/studio.spec.js` (or the folder the Playwright config uses)
- Test: wiki validation in `npm test`, the new e2e spec

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the e2e spec** — start `startStudio` on a free port with a temp parent folder; open the URL with token; „Neues Plugin“ `e2e-demo`; open `server.js`, type a line, Ctrl+S; the preview frame shows DEMS after restart; click „Event erstellen“ → toast; „Bauen“ → „Übernehmen und bauen“ → a download named `e2e-demo-0.1.0.dems` is received; stop the studio.
- [ ] **Step 2: Run** `npx playwright test e2e/studio.spec.js` → FAIL (before docs/wiring gaps are fixed) or PASS if all earlier tasks are complete — record the output either way.
- [ ] **Step 3: Write the wiki pages**, `npm run wiki`.
- [ ] **Step 4: Run** `npm test && npm run test:e2e` → all PASS.
- [ ] **Step 5: Commit** „Document the plugin studio and add a smoke test“.
