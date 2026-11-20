# Plugin SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DEMS loads official plugins (repo `plugins/`) and custom plugins (`data/plugins/`) through a permission-checking `ctx` (server) and `ui` (browser), and ships the official test plugin „Event einreichen“.

**Architecture:** A plugin host (`plugin-sdk/`) discovers and validates plugin folders, keeps their on/off state in the collection `pluginState`, requires only enabled plugins and hands each one a `ctx` whose inputs and outputs are plain JSON. Plugin API routes run behind one dispatcher at `/api/plugins/<id>/…` inside the normal `/api` chain; the core emits hooks after its own writes. In the browser `core/plugins.js` imports each enabled plugin's `client.js` and hands it a `ui` object (page + navbar tab at `#p/<id>`, prefixed actions, API calls with CSRF, helpers).

**Tech Stack:** Node ≥ 22, Express 5, discord.js, `firebaseAdmin.js` data API (PostgreSQL / SQLite), vanilla ES modules, `node:test` + `node:assert/strict`, Playwright smoke. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-19-plugin-sdk-design.md` — read it first; this plan only adds file names, signatures and tests.

## Global Constraints

- All user-visible text German (UI, `{ error }` answers, Discord messages, status texts); code, comments, commits, wiki English.
- Data only through `firebaseAdmin.js`; never import `pg`, `better-sqlite3` or `db/*Storage.js`. Dates ISO strings. Filter/sort in memory, no `limit`.
- Every route handler has its own `try/catch` and answers `res.status(x).json({ error: '<German>' })`. Admin mutations call `addAuditLog(...)`.
- Frontend: actions via `data-click`/`data-change`/`data-input` + `registerActions`; no inline handlers, no `style="…"`, no `<style>`; `escapeHtml` for every interpolated value; Markdown only via `renderMarkdownSafe`; tokens only in CSS; Bootstrap Icons, no emojis in UI; hidden start state `.is-hidden`.
- Discord: new Discord calls in a `bot/` helper guarded by `if (!state.isReady) return <neutral>` + `try/catch`, exported through `bot.js`, with a twin in `dev/mockBot.js`; event links only via `buildEventUrl`.
- `allowedMentions: { parse: [] }` on every plugin message, always.
- Manifest `id` matches `^[a-z][a-z0-9-]{2,31}$`; data collection names `^[a-z][a-zA-Z0-9]{0,31}$`; setting keys `^[a-zA-Z][a-zA-Z0-9]{0,31}$`; `SDK_VERSION = 1`.
- Timeouts: `register` 5 000 ms, `onDisable` 2 000 ms, slow hook warning 10 000 ms.
- Message limits per plugin, sliding 600 000 ms: 200 DMs, 30 channel posts.
- New env variables `PLUGINS_DIR` (default `data/plugins`), `PLUGINS_SAFE_MODE` (default `false`) documented in `.env.example` (German comments) and `docs/wiki/ops/configuration.md`.
- TDD: write the failing test first. Run one suite with `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/<name>.test.js`; `npm test` before every commit.
- When a task changes behaviour a wiki node describes, update that node in the same commit and run `npm run wiki`.
- Branch `feature/plugin-sdk` (exists). Commits: English imperative subject + why in the body, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Path tricks on plugin static files** (`/plugins/event-submissions/../../.env`, `%2e%2e%2f`, `assets/../server.js`, `assets/x.html`) must answer 404 and never a file outside the allow-list → test in Task 7.
2. **Double-click / parallel submits** of „Event einreichen“ must not get a member past 3 open submissions → test in Task 13 (five parallel POSTs, exactly three 200).
3. **Stale „Übernehmen“**: an event created with an `origin.ref` that is unknown, withdrawn or already rejected must not change any submission and must not DM → test in Task 13.
4. **Hostile text** in titles, descriptions, reasons and names (`<img src=x onerror=…>`, `@everyone`, `<@&123>`) must render escaped in the plugin UI and never ping in Discord → tests in Task 8 (payload) and Task 14 (view).
5. **Switching a plugin off while hooks are queued** must drop its pending handlers (they never run after `enabled` is false) → test in Task 4.

---

## File Structure

| Path | Responsibility |
|---|---|
| `plugin-sdk/manifest.js` | `SDK_VERSION`, `PERMISSIONS` (German labels), `SETTING_TYPES`, `validateManifest` |
| `plugin-sdk/discovery.js` | scan official + custom folders → plugin entries |
| `plugin-sdk/state.js` | `pluginState` and `pluginSettings` documents |
| `plugin-sdk/data.js` | namespaced data API, collection registry, purge by `userId`, wipe |
| `plugin-sdk/hooks.js` | hook names, per-plugin queues, `emitHook`, `emitEventStatusChange`, `toPluginEvent` |
| `plugin-sdk/discord.js` | `ctx.discord` with limits and URL check, `createMessageLimiter` |
| `plugin-sdk/context.js` | builds `ctx` for one plugin (permissions, routes, settings, events, members, audit, log) |
| `plugin-sdk/host.js` | lifecycle: start, enable/disable, confirmation rule, safe mode, list views, settings, data delete |
| `plugin-sdk/index.js` | `initPlugins(options)`, `pluginHost()` singleton |
| `routes/plugins.js` | `GET /api/plugins` + dispatcher `/api/plugins/:pluginId/…` |
| `routes/pluginStatic.js` | `/plugins/:pluginId/…` static allow-list |
| `routes/adminPlugins.js` | admin API under `/api/admin/plugins` |
| `bot/messages.js`, `bot.js`, `dev/mockBot.js` | `sendPluginChannelMessage` |
| `public/js/core/plugins.js` | load clients, build `ui`, plugin pages and tabs |
| `public/js/admin/system-plugins.js` | System › Plugins category |
| `plugins/event-submissions/` | `plugin.json`, `server.js`, `rules.js`, `client.js`, `client.css`, `assets/view.js` |
| `test/fixtures/plugins/hook-recorder/` | custom test plugin that records hooks |

Collection names: plugin data `plugin:<id>:<coll>`, state `pluginState/<id>`, settings `pluginSettings/<id>` (`{ values }`).

---

### Task 1: Manifest validation

**Files:**
- Create: `plugin-sdk/manifest.js`
- Test: `test/pluginManifest.test.js`

**Interfaces:**
- Produces:
  - `SDK_VERSION: 1`
  - `PERMISSIONS: { [key]: germanLabel }` with exactly `events:read` „Events lesen“, `events:draft` „Events für das Team vorbereiten“, `members:read` „Mitgliedernamen und Avatare lesen“, `discord:dm` „Direktnachrichten über den Bot senden“, `discord:channel` „Nachrichten in Discord-Kanäle posten“, `network` „Verbindungen ins Internet aufbauen“
  - `SETTING_TYPES: ['text','textarea','number','boolean','select','channel','role','secret']`
  - `validateManifest(raw: unknown, folderName: string, { fileExists: (relPath) => boolean }) → { ok: true, manifest } | { ok: false, status: 'invalid'|'incompatible', reason: string }`; `manifest` is a normalized copy `{ id, name, version, sdk, description, author, server, client, css, permissions: string[], settings: Setting[] }` where `css` is `'client.css'` when `fileExists('client.css')`, else `''`.

- [ ] **Step 1: Write the failing tests** — one `test()` per rule, each asserting `ok === false` and the exact `reason`:
  - `id` not matching the pattern → `'Ungültig: Die ID ist nicht erlaubt.'`; id ≠ folder → `'Ungültig: Die ID passt nicht zum Ordnernamen.'`
  - `sdk: 2` → `{ status: 'incompatible', reason: 'Inkompatibel (SDK 2)' }`; missing/non-integer `sdk` → `'Ungültig: SDK-Version fehlt.'`
  - `version` not `x.y.z` → `'Ungültig: Version muss x.y.z sein.'`
  - `name` empty or > 40, `description` > 200, `author` > 60 → `'Ungültig: <Feld> ist zu lang oder fehlt.'` with `Name`, `Beschreibung`, `Autor`
  - `server`/`client` containing `..`, `/` at the start, `\` or not existing → `'Ungültig: Datei <name> fehlt oder liegt außerhalb des Plugins.'`
  - unknown permission `'db:raw'` → `'Ungültig: Unbekannte Berechtigung db:raw.'`
  - setting with bad key, unknown type, `select` without `options` → `'Ungültig: Einstellung <key> ist fehlerhaft.'`
  - a valid manifest (the one in the spec) → `ok: true`, `manifest.permissions` deep-equals input, `manifest.css === ''` when `client.css` is absent.

- [ ] **Step 2: Run** `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/pluginManifest.test.js` — Expected: FAIL (`Cannot find module '../plugin-sdk/manifest'`).
- [ ] **Step 3: Implement `validateManifest`** in `plugin-sdk/manifest.js` (CommonJS, pure, no I/O besides the injected `fileExists`).
- [ ] **Step 4: Run the suite** — Expected: PASS.
- [ ] **Step 5: Commit** `Add plugin manifest validation`.

---

### Task 2: Discovery and plugin state store

**Files:**
- Create: `plugin-sdk/discovery.js`, `plugin-sdk/state.js`
- Test: `test/pluginDiscovery.test.js`, `test/pluginState.test.js`

**Interfaces:**
- Consumes: `validateManifest` (Task 1).
- Produces:
  - `discoverPlugins({ officialDir, customDir }) → PluginEntry[]`, `PluginEntry = { id, dir, official: boolean, manifest: Manifest|null, status: null|'invalid'|'incompatible', reason: string }`, sorted official first, then by `id`. A folder without `plugin.json` is skipped. Unreadable/unparsable JSON → `invalid`, reason `'Ungültig: plugin.json ist kein gültiges JSON.'`. A custom entry whose id equals an official one → `invalid`, reason `'Ungültig: Die ID gehört einem offiziellen Plugin.'`. A missing `customDir` is no error.
  - `state.js`: `readStates() → Promise<Map<string, PluginState>>`, `writeState(id, patch) → Promise<void>` (merge), `deleteState(id)`, `readSettings(id) → Promise<object>`, `writeSettings(id, values)`, `deleteSettings(id)`. `PluginState = { enabled: boolean, enabledAt, enabledBy, confirmedVersion, confirmedPermissions: string[], collections: string[], lastError, lastErrorAt }` (missing fields default to `false` / `''` / `[]`).

- [ ] **Step 1: Write failing discovery tests** using `createTempDir` to build folders: official + custom found with `official` flags; custom id collision → invalid with the reason above; folder without manifest skipped; broken JSON → invalid; missing custom dir → only official entries.
- [ ] **Step 2: Write failing state tests** with the SQLite store of a temp `SQLITE_PATH` via `runNode` (pattern of `test/systemConfig.test.js`): `writeState('a', { enabled: true })` then `writeState('a', { lastError: 'x' })` keeps `enabled`; `readStates()` fills defaults; `deleteState` removes; settings round-trip.
- [ ] **Step 3: Run both suites** — Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** `discoverPlugins` (sync `fs`, `validateManifest` with `fileExists` bound to the folder) and `state.js` (collections `pluginState`, `pluginSettings`).
- [ ] **Step 5: Run both suites** — Expected: PASS.
- [ ] **Step 6: Commit** `Discover plugin folders and store plugin state`.

---

### Task 3: Plugin data API

**Files:**
- Create: `plugin-sdk/data.js`
- Test: `test/pluginData.test.js`

**Interfaces:**
- Consumes: `writeState` / `readStates` (Task 2).
- Produces:
  - `collectionName(pluginId, coll) → 'plugin:<id>:<coll>'`
  - `createDataApi(pluginId, { recordCollection: (coll) => Promise<void> }) → { get(coll, id), list(coll), where(coll, field, op, value), add(coll, obj) → { id, ...obj }, set(coll, id, obj), update(coll, id, patch), delete(coll, id) }`. Every method validates `coll` (`PluginDataError('Ungültiger Sammlungsname: <coll>')`), calls `recordCollection` once per new `coll`, returns plain copies `{ id, ...data }` (`get` → `null` when missing). `op` limited to `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`.
  - `purgeUserData(userId, collectionsByPlugin: Map<id, string[]>) → Promise<number>` deletes docs with `userId === userId` (string compare) in every listed collection.
  - `wipePluginData(pluginId, collections: string[]) → Promise<number>`.

- [ ] **Step 1: Write failing tests**: two plugins writing `coll 'items'` never see each other's docs; invalid `coll` (`'../x'`, `'Items'`, 33 chars) throws; `recordCollection` called once for repeated writes; `purgeUserData('u1', …)` removes only docs with `userId: 'u1'` across two plugins and returns the count; `wipePluginData` empties only that plugin.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** on `collection`/`doc`/`getDocs`/`query`/`where`/`addDoc`/`setDoc`/`updateDoc`/`deleteDoc`/`writeBatch` of `firebaseAdmin.js` (batches of 500 for purge/wipe).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Give plugins a namespaced data API`.

---

### Task 4: Hooks with per-plugin queues

**Files:**
- Create: `plugin-sdk/hooks.js`
- Test: `test/pluginHooks.test.js`

**Interfaces:**
- Consumes: `toPublicEvent` (`utils/eventUtils.js`).
- Produces:
  - `HOOK_NAMES = ['event.created','event.published','event.updated','event.ended','event.cancelled','event.deleted','member.deleted']`
  - `EVENT_HOOKS` = the six `event.*` names (need `events:read`).
  - `onHook(pluginId, name, handler)` (unknown name → throws), `clearHooks(pluginId)`.
  - `setHookGate(fn: (pluginId) => boolean)` — consulted when a queued handler is about to run.
  - `emitHook(name, payload) → void` — never awaits handlers; queues per plugin on the next tick; each handler in `try/catch` (`console.error` with `[plugin:<id>]`, then `onHandlerError(pluginId, err)`), a handler > 10 000 ms logs `⚠️ [plugin:<id>] Hook <name> braucht länger als 10 s`.
  - `setHookErrorReporter(fn: (pluginId, message) => void)`.
  - `whenHooksIdle() → Promise<void>` (tests).
  - `toPluginEvent(id, data) → { ...toPublicEvent(id, data), origin: data.origin || null }`.
  - `emitEventStatusChange({ eventId, before, after })` — `after.status === 'active'` and `(before.status || 'draft') === 'draft'` → `event.published`; `after.status === 'archived'` and before not `archived` → `event.ended`; `after.status === 'cancelled'` and before not `cancelled` → `event.cancelled`. `before` is `null` for a new event (treated as draft).

- [ ] **Step 1: Write failing tests**: order within one plugin is emission order (`event.created` before `event.published` with a slow first handler); plugin B is not delayed by a 200 ms handler of plugin A; a throwing handler reports through the error reporter and the next handler still runs; gate false → queued handlers skipped (Review Focus 5: emit two, flip gate after the first starts, second never runs); `toPluginEvent` drops `checkinCode` and `aiNotes`, keeps `origin`; `emitEventStatusChange` table for draft→active, none→active, active→active (nothing), archived→active (nothing), active→archived, active→cancelled.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** (one promise chain per plugin id; module-level maps).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Add plugin hooks with ordered per-plugin queues`.

---

### Task 5: Plugin Discord access with limits

**Files:**
- Create: `plugin-sdk/discord.js`
- Modify: `bot/messages.js` (new `sendPluginChannelMessage`), `bot.js` (export), `dev/mockBot.js` (twin), `test/botModules.test.js` (export list), `test/botRealExports.test.js` (neutral value `false`)
- Test: `test/pluginDiscord.test.js`

**Interfaces:**
- Consumes: `sendAutomaticDM` (`utils/botSettings.js`), `buildSiteUrl` (`utils/eventUrl.js`), `require('../bot').sendPluginChannelMessage`.
- Produces:
  - `bot/messages.js`: `sendPluginChannelMessage(channelId: string, { content: string, components: object[] }) → Promise<boolean>` — `false` while not ready; posts a classic message with `allowedMentions: { parse: [] }`; logs and returns `false` on error. Mock twin logs `Plugin-Nachricht in <channel>` + content, returns `true`.
  - `createMessageLimiter({ dms = 200, posts = 30, windowMs = 600000, now = Date.now }) → { take(pluginId, 'dm'|'post') → boolean, warning(pluginId) → string|null }`; `warning` = `'Nachrichtengrenze erreicht (bis HH:MM)'` while blocked (time in `getTimezone()`), else `null`.
  - `createDiscordApi({ pluginId, permissions, readSettings: () => Promise<object>, settingsSchema, limiter, log }) → { sendDM(userId, { text, link }), sendChannelMessage(settingKey, { text, link }) }` — permission checks (`discord:dm` / `discord:channel`, else `PluginPermissionError`), text 1…2000 chars (else `false` + log), `link = { label ≤ 80, url }` with `url.startsWith(buildSiteUrl(''))` (else `false` + log), DM only when `users/<userId>` exists, channel only when `settingKey` names a `channel` setting of this plugin with a non-empty value. Payload `{ content, components: [ActionRow(Link button)], allowedMentions: { parse: [] } }`.
  - `PluginPermissionError` lives in `plugin-sdk/errors.js` (create it here: `PluginPermissionError`, `PluginHttpError(status, message)`, `PluginDataError`).

- [ ] **Step 1: Write failing tests**: limiter allows 200 DMs then refuses the 201st, frees after the window (fake `now`), posts limited at 30 independently; `warning` text; `sendDM` to an unknown user → `false` without calling the sender; text `'@everyone <@&123> hi'` → payload `allowedMentions` deep-equals `{ parse: [] }` (Review Focus 4); foreign link `https://evil.example/` → `false`; `sendChannelMessage('notifyChannel', …)` with empty setting → `false`, with a raw id `'1234'` as key → `false`; missing permission throws `PluginPermissionError`. Extend `test/botModules.test.js` export list and `test/botRealExports.test.js` (`sendPluginChannelMessage` → `false` while not ready).
- [ ] **Step 2: Run** `test/pluginDiscord.test.js`, `test/botModules.test.js`, `test/botRealExports.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the bot helper (+ export + mock twin) and `plugin-sdk/discord.js`, `plugin-sdk/errors.js`. Inject the senders (`sendDm`, `sendChannel`) as optional options so tests pass fakes.
- [ ] **Step 4: Run the three suites** — Expected: PASS.
- [ ] **Step 5: Update** `docs/wiki/modules/bot.md` (module table + export list), `npm run wiki`, **commit** `Let plugins send DMs and channel posts within limits`.

---

### Task 6: Context and plugin host lifecycle

**Files:**
- Create: `plugin-sdk/context.js`, `plugin-sdk/host.js`, `plugin-sdk/index.js`
- Test: `test/pluginHost.test.js`, fixtures under `test/fixtures/plugins/` (`good`, `throws`, `hangs`, `needs-dm`)

**Interfaces:**
- Consumes: Tasks 1–5; `addAuditLog`, `toPublicEvent`, `buildEventUrl`, `buildSiteUrl`, `getUserProfile`-style read of `users/<id>` for `ctx.members.get`.
- Produces:
  - `createContext({ entry, host }) → ctx` exactly as in the spec table: `ctx.plugin`, `ctx.log.{info,warn,error}`, `ctx.routes.{get,post,put,delete}(path, { access }, handler)`, `ctx.data` (Task 3), `ctx.settings.get()`, `ctx.events.{get,list,url}`, `ctx.members.get`, `ctx.discord` (Task 5), `ctx.siteUrl(hash)`, `ctx.audit(action, adminId, details, targetId)` (action stored as `plugin:<id>:<action>`), `ctx.hooks.on(name, handler)`, `ctx.onDisable(fn)`, `ctx.httpError(status, message)` → `PluginHttpError`. `access` other than `'member'`/`'admin'` → throws `'Route <METHOD> <path>: access muss member oder admin sein.'`; duplicate method+path → throws.
  - `createPluginHost({ officialDir, customDir, safeMode, mockMode, registerTimeoutMs = 5000, requireModule = require }) → host` with:
    - `start() → Promise<void>`
    - `list() → PluginView[]`, `PluginView = { id, name, version, author, description, official, permissions: [{ key, label }], status: 'off'|'on'|'error'|'confirm'|'invalid'|'incompatible'|'orphaned'|'safe', statusText, lastError, lastErrorAt, limitWarning, settings: Setting[], hasClient, collections }`; `statusText` German: Aus, An, `Fehler: <msg>`, Bestätigung nötig, the manifest reason, Verwaist, Abgesicherter Modus aktiv.
    - `isEnabled(id) → boolean`, `entryOf(id)`, `routesOf(id) → RouteDef[]` (`{ method, path, access, handler }`), `clients() → [{ id, name, version, official, permissions, hasCss }]` for enabled plugins with a `client`.
    - `setEnabled(id, enabled, { adminId }) → Promise<PluginView>` (refuses for `invalid|incompatible|orphaned|safe` by throwing `PluginHostError` — add it to `plugin-sdk/errors.js` — with German message `'Dieses Plugin kann nicht eingeschaltet werden.'` or `'Abgesicherter Modus aktiv – Plugins lassen sich nicht einschalten.'`). Enabling a custom plugin stores `confirmedVersion`, `confirmedPermissions`.
    - `readPublicSettings(id) → values` with secrets as `{ set: boolean }`; `saveSettings(id, values) → Promise<void>` (validated per schema: types, `select` options, `number` finite, `boolean`; unknown keys dropped; German `PluginHostError` per bad field).
    - `deleteData(id)`, `purgeUser(userId)`, `wipeAllData()`.
  - `index.js`: `initPlugins(options) → Promise<host>`, `pluginHost() → host` (throws before init).
  - Lifecycle rules (spec): only enabled + confirmed plugins are required; `register` throw or > 5 000 ms → status `error`, `lastError` stored, plugin off for this run (stays `enabled: true` in state); custom plugin whose `version` ≠ `confirmedVersion` or permissions ⊄ `confirmedPermissions` → `confirm`, not required; official plugin without state in mock mode → enabled; new official plugin outside mock → off; safe mode → nothing required; disable runs `onDisable` callbacks (2 000 ms each), keeps registrations; re-enable without re-require; runtime errors reported by routes/hooks set `lastError` and keep `on`; `limitWarning` from the limiter; `pluginState` entries or registered collections without folder → `orphaned` view.
  - Hook gate: `setHookGate(host.isEnabled)`; hook error reporter writes `lastError`.

- [ ] **Step 1: Write failing tests** (temp official/custom dirs with fixture plugins, SQLite via `runNode` or in-process with a temp `SQLITE_PATH`):
  - disabled custom plugin's `server.js` is never required (fixture writes a marker file at top level; assert absent);
  - `throws` fixture → view `status: 'error'`, `statusText: 'Fehler: kaputt'`; `hangs` fixture → `error` after the timeout (use `registerTimeoutMs: 50`), and `start()` resolves;
  - custom plugin enabled at v1.0.0, manifest bumped to 1.1.0 → `confirm`, not required; permissions grew → `confirm`; official plugin bump stays `on`;
  - safe mode → every view `safe`, `setEnabled` throws the safe-mode sentence;
  - mock mode turns an official plugin without state on; non-mock keeps it off;
  - disable → `isEnabled` false, `onDisable` ran; enable again → `register` called only once in total;
  - `ctx.events.get` without `events:read` throws `PluginPermissionError`; with it returns no `checkinCode`;
  - `ctx.routes.get('/x', {}, fn)` throws the access sentence; duplicate route throws;
  - state entry for a removed folder → `orphaned`; `deleteData` on it removes collections and state;
  - `saveSettings` rejects `select` value outside options and keeps secrets when the value is `undefined`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `context.js`, `host.js`, `index.js`. `require` of plugin code through the injected `requireModule(path.join(dir, manifest.server))`; `Promise.race` with a timer for the timeout.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Load plugins through a host with a permission-checking ctx`.

---

### Task 7: Server wiring — dispatcher, static files, config

**Files:**
- Create: `routes/plugins.js`, `routes/pluginStatic.js`, `test/fixtures/plugins/hook-recorder/{plugin.json,server.js,client.js}`
- Modify: `server.js` (init in `start()` after `loadAiSettings()`, before `listen`; mount static after `express.static(public)`; mount `/api/plugins` after `/api/user`), `.env.example`, `docs/wiki/ops/configuration.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/modules/server.md`
- Test: `test/pluginServer.test.js` (new dev server with `PLUGINS_DIR` = temp copy of `test/fixtures/plugins`)

**Interfaces:**
- Consumes: `pluginHost()` (Task 6), `requireAuth`.
- Produces:
  - `createPluginRouter(getHost) → express.Router`: `GET /` (`requireAuth`) → `[{ id, name, version, official, permissions, client: '/plugins/<id>/client.js?v=<version>', css: '/plugins/<id>/client.css?v=<version>' or '' }]` from `host.clients()`; `/:pluginId` + `/:pluginId/{*splat}` dispatch: unknown or off → 404 `{ error: 'Plugin nicht gefunden.' }`; route not found → 404 `{ error: 'Nicht gefunden.' }`; `access: 'member'` without session → 401 `{ error: 'Nicht eingeloggt. Bitte melde dich über Discord an.' }`; `access: 'admin'` non-admin → 403 `{ error: 'Keine Administrator-Berechtigung.' }`; handler gets `{ user: { id, name: displayName||username, avatar, isAdmin, roles }, params, query, body }`; plain return → 200 JSON (`undefined` → `{ success: true }`); `PluginHttpError` → its status + `{ error }`; other throw → 500 `{ error: 'Im Plugin ist ein Fehler aufgetreten.' }` + `host` records `lastError`.
  - `createPluginStatic(getHost) → middleware` at `/plugins`: serves only for enabled plugins `client.js`, `client.css`, `assets/<name>` with `name` matching `^[A-Za-z0-9_-]+\.(js|css|png|jpg|jpeg|webp|gif|json|woff2)$`; resolved path must stay inside the plugin folder; everything else 404 (plain, no listing).
  - Fixture `hook-recorder` (custom, permissions `events:read`, `events:draft`): records every hook into `ctx.data` coll `log`; routes `GET /log` (admin) → log docs sorted by `at`; `GET /me` (member) → `user`; `POST /boom` (member) throws `Error('kaputt')`; `POST /teapot` (member) throws `ctx.httpError(418, 'Ich bin eine Teekanne.')`.
  - Test helper in the suite: `enableCustom(adminClient, id)` → `PUT /api/admin/plugins/<id>/enabled` `{ enabled: true, trust: true, password: 'dev' }` (route lands in Task 9; until then the suite enables through a seeded `pluginState` written before start — write it with `runNode` into `DEV_SQLITE_PATH`).

- [ ] **Step 1: Write failing tests**: off plugin → `GET /api/plugins/hook-recorder/me` 404; on → member gets `user.id`; logged out → 401 German; `GET /log` as member → 403; `POST /boom` → 500 with the German sentence; `POST /teapot` → 418 `{ error: 'Ich bin eine Teekanne.' }`; `POST /me` without CSRF header → 403 `'Ungültiges CSRF-Token. Bitte Seite neu laden.'`; `GET /api/plugins` lists the client; static `client.js` 200 with JavaScript content type; Review Focus 1: `/plugins/hook-recorder/../../.env`, `/plugins/hook-recorder/%2e%2e/%2e%2e/package.json`, `/plugins/hook-recorder/server.js`, `/plugins/hook-recorder/plugin.json`, `/plugins/hook-recorder/assets/x.html` → 404; `PLUGINS_SAFE_MODE=true` (second server) → `GET /api/plugins` `[]`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** routers and wiring; document `PLUGINS_DIR` („Ordner für eigene Plugins (nicht offiziell)“) and `PLUGINS_SAFE_MODE` („true = DEMS startet ohne Plugin-Code, z. B. wenn ein Plugin den Start verhindert“) in `.env.example`; config + api-index + server wiki nodes.
- [ ] **Step 4: Run** the suite, then `npm test` — Expected: PASS.
- [ ] **Step 5:** `npm run wiki`, **commit** `Serve plugin routes and client files behind the normal API chain`.

---

### Task 8: Hooks in the core and the event origin

**Files:**
- Modify: `routes/admin.js` (`POST /events`, series PUT creating dates ~l.593, `PUT /events/:id`, `followStatusInDiscord`, `POST /events/:id/end`, `PUT /events/:id/cancel`, `POST /events/:id/duplicate`, `DELETE /events/:id`, `DELETE /events/series/:seriesId`), `utils/adminActions.js` (`buildNewEvent`, `publishDraft`), `bot/adminCommands.js` (event created ~l.379), `utils/eventArchive.js` (auto-archive), `utils/eventUtils.js` (`ADMIN_EVENT_FIELDS` += `origin`), `docs/wiki/concepts/data-model.md`, `docs/wiki/modules/routes-admin.md`
- Test: `test/pluginHookEmission.test.js` (dev server with `hook-recorder` on)

**Interfaces:**
- Consumes: `emitHook`, `emitEventStatusChange`, `toPluginEvent` (Task 4); `pluginHost().isEnabled`, `entryOf` (Task 6).
- Produces:
  - Event field `origin: { plugin, ref } | absent`. Accepted only in `POST /api/admin/events` from `req.body.pluginOrigin = { plugin, ref }` when the plugin is enabled and has `events:draft`, `ref` a string 1…100; otherwise 400 `{ error: 'Ungültige Plugin-Herkunft.' }`. Series: only the first date carries it. `PUT` ignores `origin`/`pluginOrigin`; duplicate and templates never copy it.
  - Emission (after the write, with `toPluginEvent`): `event.created` for every created event (each series date); then `emitEventStatusChange({ before: null, after })` for each; `event.updated` `{ event, changed }` in `PUT /events/:id` (changed = keys of `updates` whose JSON differs from `oldEvent`); `emitEventStatusChange` wherever `followStatusInDiscord` runs, in `publishDraft`, `/end`, `/cancel`, auto-archive; `event.deleted` `{ eventId, origin }` per deleted date.

- [ ] **Step 1: Write failing tests** (table-driven, one `test()` per row, each asserting the names and order of `GET /log` after `whenHooksIdle`-equivalent polling): create draft → `[event.created]`; create active → `[event.created, event.published]`; `PUT …/status` draft→active → `[event.published]`; `PUT /events/:id` title change → `event.updated` with `changed` containing `title`; `/end` → `event.ended`; `/cancel` → `event.cancelled`; duplicate → `event.created`; series create of 3 dates → 3× `event.created`, origin only on the first; series delete → 3× `event.deleted`; Discord `/event erstellen` via `dispatchInteraction` → `event.created`; draft publish button → `event.published`; origin from a disabled plugin → 400; origin on PUT ignored (stored event unchanged); a member's `GET /api/events/:id` has no `origin`, the admin answer has it; payload never contains `checkinCode`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the emissions and the origin whitelist (trap 3: `POST` only).
- [ ] **Step 4: Run** the suite, then `npm test` — Expected: PASS.
- [ ] **Step 5:** wiki nodes, `npm run wiki`, **commit** `Emit plugin hooks from event changes and store the plugin origin`.

---

### Task 9: Admin API, privacy purge, reset

**Files:**
- Create: `routes/adminPlugins.js`
- Modify: `routes/admin.js` (`router.use(require('./adminPlugins'))` next to `adminSystem`; `DELETE /reset` targets), `routes/user.js` (`DELETE /account`), `public/index.html` (reset dialog checkbox `#reset-plugins`, value `pluginData`, checked, label „Plugin-Daten“), `public/js/admin/dashboard.js` (`performSystemReset` pushes `pluginData`), `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/routes-user.md`, `docs/wiki/concepts/security.md`
- Test: `test/adminPlugins.test.js`, extend `test/pluginServer.test.js`

**Interfaces:**
- Consumes: host (Task 6), `safeEqual`, `addAuditLog`.
- Produces:
  - `GET /api/admin/plugins` → `{ safeMode, plugins: PluginView[] with settingsValues (public) }`.
  - `PUT /api/admin/plugins/:id/enabled` `{ enabled, trust?, password? }` → `{ plugin }`. Custom + `enabled: true`: `trust !== true` → 400 `'Bitte bestätige, dass du dem Code dieses Plugins vertraust.'`; wrong password → 401 `'Ungültiges Admin-Reset-Passwort.'`. Host refusals → 409 with the host sentence. Audit `PLUGIN_ENABLE` / `PLUGIN_DISABLE` with the plugin name.
  - `PUT /api/admin/plugins/:id/settings` `{ values, password? }` → `{ settings }`; changing a `secret` without the right password → 401 (same sentence); validation → 400 with the host sentence; audit `PLUGIN_SETTINGS` (never the values).
  - `DELETE /api/admin/plugins/:id/data` → `{ deleted }`; enabled → 409 `'Schalte das Plugin zuerst aus.'`; audit `PLUGIN_DELETE_DATA`.
  - Account deletion: after the poll votes, `await pluginHost().purgeUser(userId)` then `emitHook('member.deleted', { userId })`, both in their own `try/catch` (log, never fail the deletion).
  - Reset: when `targets` includes `pluginData` or `users` → `pluginHost().wipeAllData()`; no hooks.

- [ ] **Step 1: Write failing tests**: member → 403 on every admin plugin route; official toggle on/off with audit entries; custom enable without trust → 400, wrong password → 401, right → `on`; settings: bad select → 400, secret change without password → 401, `GET` never returns a secret value; delete data while on → 409, after off → collections empty; account deletion of persona `member` removes `hook-recorder` docs with `userId` = member id and the log shows `member.deleted`; reset with `['comments']` keeps plugin data, with `['pluginData']` and with `['users']` wipes it.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; switch `test/pluginServer.test.js` from seeded state to `enableCustom` through the API.
- [ ] **Step 4: Run** the suites, then `npm test` — Expected: PASS.
- [ ] **Step 5:** wiki nodes, `npm run wiki`, **commit** `Manage plugins in the admin API and purge member data`.

---

### Task 10: System › Plugins page

**Files:**
- Create: `public/js/admin/system-plugins.js`
- Modify: `public/index.html` (`#system-panel-plugins` with `#plugins-list`, `#plugins-privacy-hint`, dialog `#pluginTrustModal` with `#plugin-trust-name`, `#plugin-trust-permissions`, `#plugin-trust-check`, `#plugin-trust-password`, confirm button `data-click="confirmPluginTrust"`), `public/js/main.js` (import), `public/css/style.css` (block `/* ── System › Plugins ── */`, tokens only), `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`
- Test: `test/systemPluginsView.test.js`

**Interfaces:**
- Consumes: admin API (Task 9), `addSystemCategory`, `showConfirmDialog`, `showToast`, `escapeHtml`.
- Produces:
  - Category `{ id: 'plugins', label: 'Plugins', subtitle: 'Erweiterungen ein- und ausschalten', icon: 'bi-puzzle' }` added after `ai` at import.
  - `renderPluginCard(view) → string` (pure, exported): name, version, author, chip „Offiziell“ `bi-patch-check` or „Nicht offiziell“ `bi-exclamation-triangle` (warning), description, permissions as list of labels, status chip, `lastError`/`limitWarning` warning line, switch `data-change="togglePlugin"` `data-plugin-id`, settings fields (`data-group="plugin:<id>"`), „Daten löschen“ `data-click="deletePluginData"` only when off or orphaned.
  - `loadPluginsPanel()` (called by `showSystemSection` when the category is `plugins`), actions `togglePlugin`, `confirmPluginTrust`, `savePluginSettings`, `deletePluginData`.
  - Trust dialog text exactly as in the spec („Nicht offizielles Plugin einschalten?“ …); the confirm button stays disabled until the checkbox is ticked and a password is typed.
  - Privacy hint text exactly: „Plugins können Daten von Mitgliedern speichern. Erwähne eingeschaltete Plugins in deiner Datenschutzerklärung.“

- [ ] **Step 1: Write failing tests** with `loadFrontendApp({ '/api/admin/plugins': … })`: official card shows „Offiziell“ and no trust dialog on toggle (one `PUT` without password); custom toggle opens the dialog, confirm sends `{ enabled: true, trust: true, password }`; a hostile plugin name `<img src=x onerror=1>` appears escaped; error status shows `Fehler: …`; „Daten löschen“ asks through `showConfirmDialog` with the plugin name and is hidden while on; safe mode disables every switch and shows „Abgesicherter Modus aktiv“.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the module, markup and styles.
- [ ] **Step 4: Run** the suite, then `npm test` (CSP, tokens, icon and action guards) — Expected: PASS.
- [ ] **Step 5:** wiki nodes, `npm run wiki`, **commit** `Add the System › Plugins page with the trust dialog`.

---

### Task 11: Plugin clients in the browser (`ui`)

**Files:**
- Create: `public/js/core/plugins.js`
- Modify: `public/js/core/router.js` (route `p`), `public/js/core/auth.js` (after `showLoggedIn()` → `loadPlugins()`; `showLoggedOut` → `unloadPluginTabs()`), `public/js/main.js` (import), `public/index.html` (`<section id="plugin-section" class="app-section is-hidden"><div id="plugin-root"></div></section>`; navbar `<li>` placeholders `#nav-plugins-member` before `#nav-admin` and `#nav-plugins-admin` before `#nav-debug`), `public/js/admin/wizard.js` (`state.pendingPluginOrigin` like `pendingPollDecision`: set by `applyDraft` from `draft.pluginOrigin` — the editor's `prefill` reaches `applyDraft` like a poll decision does — reset at the same three places, sent as `pluginOrigin` by `collectEventDraft`), `public/js/core/state.js` (`pendingPluginOrigin: null`), `docs/wiki/modules/frontend-app.md`
- Test: `test/pluginClient.test.js`, `test/pluginClientGuards.test.js`

**Interfaces:**
- Consumes: `GET /api/plugins` (Task 7), router, `registerActions`, helpers.
- Produces:
  - `loadPlugins({ importModule = (url) => import(url) } = {}) → Promise<void>` — fetches `/api/plugins`, adds `<link rel="stylesheet">` for `css`, imports each `client`, calls `mountPluginModule(entry, module)`; a failure logs and, for admins, toasts `'Plugin „<Name>“ konnte nicht geladen werden.'` (`warning`).
  - `mountPluginModule(entry, module) → void` — calls `module.register(createPluginUi(entry))` in `try/catch`.
  - `createPluginUi(entry) → ui` exactly as in the spec table: `ui.plugin`, `ui.user` (frozen), `ui.addPage({ access, title, render, leave, tab })` (one page per plugin; second call throws), `ui.setTabBadge(count)`, `ui.actions.register(map)` → `registerActions` with names `p:<id>:<name>`, `ui.api.{get,post,put,delete}(path, body)`, `ui.openEventEditor({ prefill, ref })` (throws for non-admins or without `events:draft`; calls `openEventEditor({ prefill: { ...prefill, pluginOrigin: { plugin: id, ref } }, fresh: true })`), `ui.navigate(param)`, `ui.helpers` (the eleven helpers of the spec).
  - `showPluginPage(pluginId, param) → void` (router): unknown plugin → `navigateTo('events')`; `access: 'admin'` for non-admin → `navigateTo('events')`; clears `#plugin-root`, creates a child container, calls `render(container, param)`; sets `onRouteLeave(leave)`; navbar link `data-section="p-<id>-section"` marked active (router: route `p` → `p-<parts[1]>`).
  - `unloadPluginTabs()` removes plugin navbar links.

- [ ] **Step 1: Write failing tests** (`loadFrontendApp`): `mountPluginModule` with a fake module registering a page with `tab: { label: 'Test', icon: 'bi-star' }` creates a navbar link to `#p/test`; routing `#p/test/abc` calls `render` with `'abc'`; an admin-only page redirects a member to `#events`; `ui.actions.register({ go })` makes `p:test:go` run on click; `ui.api.post('/x', { a: 1 })` sends to `/api/plugins/test/x` with `X-CSRF-TOKEN`; error answer rejects with the German `error`; `ui.openEventEditor` as member throws; as admin opens `#event-editor/new` and the saved draft sends `pluginOrigin: { plugin: 'test', ref: 'r1' }`; a module whose `register` throws leaves the app working and toasts the warning for admins only; `setTabBadge(3)` shows 3, `0` hides; logout removes the tab.
- [ ] **Step 2: Write guard tests** `test/pluginClientGuards.test.js` over every official `plugins/*/` folder (each file only when it exists):
  - `client.js` and `assets/*.js` import only relative paths inside the plugin (no `'/js/…'`, no path leaving the folder); no inline handlers, no `style=`, no `<style`;
  - every `data-click|change|input="p:<id>:<name>"` uses the folder's id and `<name>` is a key passed to `ui.actions.register`;
  - `client.css` passes the raw-value rule of `test/cssRules.test.js` (reuse `parseRules`/`readTokens` from `test/cssSource.js`); no emoji in UI strings (reuse the check of the icon test);
  - `server.js` and its local requires `require` only Node built-ins and relative files inside the folder (no `../` out of it, no DEMS module); no `node_modules` folder inside an official plugin.
- [ ] **Step 3: Run both** — Expected: `pluginClient` FAILS (module missing); the guard suite is green now (no plugin folder yet) and starts checking „Event einreichen“ from Task 12 on.
- [ ] **Step 4: Implement** `core/plugins.js`, router, auth, editor/wizard changes, markup.
- [ ] **Step 5: Run** both suites, then `npm test` — Expected: PASS.
- [ ] **Step 6:** wiki node, `npm run wiki`, **commit** `Load plugin clients and give them pages, tabs and actions`.

---

### Task 12: Test plugin rules (pure)

**Files:**
- Create: `plugins/event-submissions/plugin.json`, `plugins/event-submissions/rules.js`
- Test: `test/eventSubmissionsRules.test.js`

**Interfaces:**
- Produces (`rules.js`, CommonJS, no DEMS imports):
  - `CATEGORIES = ['Tournament','Community','Workshop','Gamenight','Meeting','Sonstiges']`
  - `MAX_OPEN = 3`, `OPEN_STATUSES = ['open','planning']`
  - `validateSubmission(body, today: 'YYYY-MM-DD') → { ok: true, value: { title, description, wishedDate, category } } | { ok: false, error }` — body not a plain object → `'Ungültige Eingabe.'`; title trimmed 3…100 → `'Der Titel braucht 3 bis 100 Zeichen.'`; description ≤ 2000 → `'Die Beschreibung darf höchstens 2000 Zeichen haben.'`; wishedDate `''` or valid `YYYY-MM-DD` ≥ today → `'Der Wunschtermin muss heute oder später sein.'`; category `''` or in `CATEGORIES` → `'Unbekannte Kategorie.'`.
  - `validateReason(value) → { ok, value | error }` — ≤ 500 → `'Die Begründung darf höchstens 500 Zeichen haben.'`.
  - `acceptedDm(title) → 'Dein Event „<title>“ wurde eingetragen.'`; `rejectedDm(title, reason) → 'Dein Event-Vorschlag „<title>“ wurde abgelehnt.'` + (`reason` ? `'\nBegründung: <reason>'` : `''`); `newSubmissionPost(name, title) → 'Neuer Event-Vorschlag von **<name>**: „<title>“'` (name and title with Discord Markdown characters `*_~\`|>` escaped by a backslash).
  - `statusFilter(list, 'open'|'planning'|'done') → filtered, newest first`.
  - `plugin.json` exactly as in the spec (id `event-submissions`, name „Event einreichen“, version `1.0.0`, sdk 1, permissions `events:read`, `events:draft`, `discord:dm`, `discord:channel`, setting `notifyChannel`).

- [ ] **Step 1: Write failing tests**: each validation sentence; array body → `'Ungültige Eingabe.'`; yesterday → refused, today → ok; DM texts exact; Markdown in `newSubmissionPost` escaped; `CATEGORIES` deep-equals the `<option>` values of `#event-category` in `public/index.html` (read the file, regex the options, drop the empty one); manifest passes `validateManifest(raw, 'event-submissions', { fileExists: () => true })` (`server.js` and `client.js` arrive in Tasks 13 and 14; until then discovery shows the plugin as „Ungültig“, which no test depends on).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Add the rules of the Event einreichen plugin`.

---

### Task 13: Test plugin server side

**Files:**
- Create: `plugins/event-submissions/server.js`
- Modify: `dev/seedData.js` / `dev/seed.js` (seed submissions into `plugin:event-submissions:submissions`), `test/seed.test.js` if it pins collection counts
- Test: `test/eventSubmissionsServer.test.js` (dev server, official plugin on by mock default)

**Interfaces:**
- Consumes: `ctx` (Task 6), `rules.js` (Task 12), hooks (Task 8).
- Produces: routes and hooks exactly as in the spec (`GET /mine`, `POST /`, `DELETE /:id`, `GET /`, `POST /:id/reject`, `GET /counts`), collection `submissions`, document shape of the spec with `userId`. Per-member serialisation of `POST /` (an in-module promise chain keyed by `user.id`) so the limit holds under parallel requests. Reject only from `open`/`planning` → else 409 `'Dieser Vorschlag wurde schon bearbeitet.'`; unknown id → 404 `'Vorschlag nicht gefunden.'`; withdraw only own + `open` → else 409 `'Nur offene Vorschläge lassen sich zurückziehen.'`. Hooks: `event.created`/`event.published`/`event.deleted` with `origin.plugin === 'event-submissions'` and a known `ref` in the right status only (`created`: from `open`; `published`: from `open` or `planning`; `deleted`: from `planning`) — anything else is ignored. Audit `reject` via `ctx.audit`. DMs and channel post via `ctx.discord` with `link`.
- Seed: two open submissions (personas `member`, `newbie`), one rejected with reason (`raider`).

- [ ] **Step 1: Write failing tests** (personas): member submits → 200 and `GET /mine` lists it as `open`; fourth open → 409 limit sentence; Review Focus 2: five parallel `POST /` for a fresh persona → exactly three 200, two 409; invalid category → 400; array body → 400 `'Ungültige Eingabe.'`; withdraw own open → 200, foreign → 409; member `GET /` → 403; admin `GET /?status=open` lists seeded ones; reject with reason → DM line in `server.output()` containing `wurde abgelehnt.` and `Begründung:`; admin creates an event with `pluginOrigin: { plugin: 'event-submissions', ref }` as draft → submission `planning` with `eventId`; publishes → `accepted` and DM `wurde eingetragen.` with the event link `#event/<id>`; draft deleted while planning → back to `open`; Review Focus 3: origin with unknown ref, with a withdrawn ref and with a rejected ref → no status change, no DM; account deletion of the submitter removes their submissions; with `notifyChannel` set via the admin settings API a new submission logs `Plugin-Nachricht in` with the escaped title.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `server.js` and the seed.
- [ ] **Step 4: Run** the suite, then `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `Add the server side of the Event einreichen plugin`.

---

### Task 14: Test plugin client

**Files:**
- Create: `plugins/event-submissions/client.js`, `plugins/event-submissions/assets/view.js`, `plugins/event-submissions/client.css`
- Modify: `e2e/` (new `e2e/plugins.spec.js`)
- Test: `test/eventSubmissionsView.test.js`

**Interfaces:**
- Consumes: `ui` (Task 11), plugin API (Task 13).
- Produces:
  - `assets/view.js` (pure ESM, gets helpers as an argument): `renderSubmitForm(categories, helpers)`, `renderOwnList(items, helpers, now)`, `renderAdminList(items, { filter }, helpers, now)`, `renderRejectForm(item, helpers)`, `statusChip(status)` → chip classes: `open` neutral „Offen“, `planning` `chip-info` „In Planung“, `accepted` `chip-success` „Eingetragen“, `rejected` `chip-danger` „Abgelehnt“. Empty states via `helpers.emptyState` („Noch keine Vorschläge“).
  - `client.js`: `register(ui)` → `ui.addPage({ access: 'member', title: 'Event einreichen', tab: { label: 'Event einreichen', icon: 'bi-lightbulb' }, render, leave })`; admins see pill tabs „Alle Vorschläge“ / „Selbst einreichen“ and filter chips Offen / In Planung / Erledigt; actions `p:event-submissions:submit`, `withdraw`, `filter`, `showTab`, `takeOver`, `askReject`, `reject`, `cancelReject`; `takeOver` → `ui.openEventEditor({ prefill: { title, description, category, startDate: wishedDate ? wishedDate + 'T19:00' : '' }, ref: id })`; admins get `ui.setTabBadge(open count)` from `GET /counts`; every server error → `showToast(message, 'danger')`; success toasts „Danke! Dein Vorschlag ist eingereicht.“, „Vorschlag zurückgezogen.“, „Vorschlag abgelehnt.“.
  - Layout as the ASCII sketch in the spec, built from `.glass-card`, `.chip`, `.btn`, `.nav-pills` (+ `glideTabs` is core-only, so the plugin uses plain pills without glider), styles only in `client.css` with tokens.

- [ ] **Step 1: Write failing view tests** (`loadFrontendModules` on `assets/view.js` with real helpers from `loadFrontendApp`): Review Focus 4 — a title `<img src=x onerror=alert(1)>` and reason `<b>x</b>` render escaped in own and admin lists; description preview uses `markdownPreview`; status chips per status; admin list shows „Übernehmen“/„Ablehnen“ only for `open`/`planning`; accepted rows link `#event/<eventId>`.
- [ ] **Step 2: Write the e2e smoke** `e2e/plugins.spec.js`: member persona sees the navbar link „Event einreichen“, submits a title, sees it under „Deine Vorschläge“; admin sees it in „Alle Vorschläge“.
- [ ] **Step 3: Run** the unit suite — Expected: FAIL.
- [ ] **Step 4: Implement** `view.js`, `client.js`, `client.css`.
- [ ] **Step 5: Run** the unit suite, `npm test` (the guard suite of Task 11 now checks this plugin) and `npm run test:e2e` — Expected: PASS.
- [ ] **Step 6: Commit** `Add the Event einreichen tab`.

---

### Task 15: Wiki, how-to, release 3.4.0

**Files:**
- Create: `docs/wiki/concepts/plugin-sdk.md` (architecture, lifecycle, permission table, hook table, security model, data/privacy, limits), `docs/wiki/howto/write-plugin.md` (folder, manifest, `ctx`, `ui`, rules, „Event einreichen“ as example, warning for custom plugins and their dependencies, privacy hint for operators)
- Modify: `docs/wiki/index.md` (node list, task → node, file → node for `plugin-sdk/`, `plugins/`, `routes/plugins.js`, `routes/pluginStatic.js`, `routes/adminPlugins.js`, `public/js/core/plugins.js`, `public/js/admin/system-plugins.js`), `docs/wiki/ops/docker.md` (custom plugins in `/app/data/plugins`), `docs/wiki/reference/known-issues.md` (known limit: a synchronous endless loop in a plugin blocks the process until isolation exists), `CLAUDE.md` task table row „plugins, SDK“, `package.json` + `package-lock.json` via `npm version 3.4.0 --no-git-tag-version`, `updates.json` (3.4.0 entry, German, highlight: „Plugins: Event-Ideen einreichen“ explaining the tab and that admins switch plugins under System › Plugins)
- Test: `npm test` (wiki validation, `updatesData`, `releaseScript`)

- [ ] **Step 1:** Write both wiki nodes with frontmatter (`sources` only existing paths; edges to `security`, `frontend-app`, `bot`, `data-model`, `api-index`).
- [ ] **Step 2:** Update index, docker, known-issues, CLAUDE.md; run `npm run wiki`.
- [ ] **Step 3:** Bump the version and add the `updates.json` entry.
- [ ] **Step 4: Run** `npm test` and `npm run test:e2e` — Expected: PASS.
- [ ] **Step 5: Commit** `Document the plugin SDK and release 3.4.0`.
- [ ] **Step 6:** Close #155 in the PR description (German: Problem / Ursache / Änderung / Verifikation); do not push a tag (the merge releases).
