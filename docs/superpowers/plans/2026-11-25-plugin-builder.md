# Plugin builder (foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect plugin permissions from code, pack plugins as `.dems` ZIP files, install them by CLI or by opt-in upload in System › Plugins, and warn when `plugin.json` does not match the code.

**Architecture:** Pure modules under `plugin-sdk/` (file allow-list, tokenizer + permission scanner, ZIP reader/writer, package build/check/install) are shared by a CLI (`scripts/plugin.js`), plugin discovery (server-side check) and new admin routes. The host learns to re-read one plugin, mark it „Neustart nötig“ and forget a removed folder.

**Tech Stack:** Node ≥ 22 built-ins only (`zlib`, `fs`, `crypto`, `readline/promises`, `child_process`), Express 5, `express-rate-limit` (already a dependency), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-25-plugin-builder-design.md`

## Global Constraints

- No new dependencies (ZIP on `zlib.deflateRawSync`/`inflateRawSync`, tokenizer hand-written).
- Everything users see (CLI output, API `{ error }`, UI) in German; code, comments, commits, wiki in English.
- Limits: `.dems` ≤ 5 MB packed, ≤ 20 MB unpacked, ≤ 300 entries, ≤ 2 MB per entry unpacked.
- Upload only with `PLUGINS_UPLOAD=true`; never while `PLUGINS_SAFE_MODE=true`; install and remove need `ADMIN_RESET_PASSWORD`; every mutation calls `addAuditLog`.
- The server never runs plugin code to check it; the scanner only reads.
- Detection is a developer help, never a security check (wiki wording: „guard rail, not a wall“).
- Frontend: actions via `data-click`/`data-change` + `registerActions`, `escapeHtml` for every interpolated value, no `style="…"`, tokens only, Bootstrap Icons only, `showToast`.
- Routes: own `try/catch` each, `res.status(x).json({ error: '<German>' })`, static paths above `/:id`.
- Dev mock (`plugin dev`) refused with `NODE_ENV=production`.
- Every wiki change → `npm run wiki`; `npm test` green after every task.

## Review Focus

1. **ZIPs made by ordinary tools** (Windows „Senden an › ZIP“, macOS Finder, `zip -r`): a wrapping folder (`badges/plugin.json`), `__MACOSX/` + `.DS_Store`, and data descriptors (general-purpose flag bit 3, sizes only in the central directory). Expected: data descriptors read fine; a single wrapping folder gives the German hint „plugin.json muss im Hauptverzeichnis der ZIP liegen (nicht in einem Unterordner).“; `__MACOSX/` and `.DS_Store` are skipped silently instead of refusing the whole file. → tests in Task 4 and Task 5.
2. **Code inside template literals** (`` `${ctx.events.list()}` ``) and regex literals containing `ctx.` (`/ctx\.discord/`): the first must be detected, the second ignored. → tests in Task 2/3.
3. **Windows files**: `plugin.json` with a UTF-8 BOM and CRLF line endings in `.js` files. Expected: BOM stripped before `JSON.parse`, line numbers in warnings still right. → tests in Task 3 and Task 5.
4. **`build` run twice**: the second run changes nothing and keeps unknown keys, key order and `settings` of `plugin.json`. → test in Task 5.
5. **Stale or foreign `uploadId`** (expired after 10 min, from another session, used twice): German 410 „Der Upload ist abgelaufen. Bitte lade die Datei erneut hoch.“, never an install. → test in Task 9.

---

### Task 1: Shared file allow-list (`plugin-sdk/files.js`)

**Files:**
- Create: `plugin-sdk/files.js`
- Modify: `routes/pluginStatic.js` (import `ASSET_NAME`, `CONTENT_TYPES` from `plugin-sdk/files.js`; behaviour unchanged)
- Test: `test/pluginFiles.test.js` (existing `pluginStatic`/`pluginServer` tests must stay green)

**Interfaces:**
- Produces:
  - `LIMITS = Object.freeze({ packedBytes: 5242880, unpackedBytes: 20971520, entries: 300, entryBytes: 2097152 })`
  - `ASSET_NAME` (moved regex), `CONTENT_TYPES` (moved map)
  - `IGNORED_ENTRY = /(^|\/)(__MACOSX\/|\.DS_Store$)/` — skipped, not refused
  - `packageEntryError(name: string) -> string|null` — German reason why a package path is not allowed, `null` when allowed
  - `isClientAsset(name: string) -> boolean` — `assets/<ASSET_NAME>` with `.js`
  - `readPluginSourcesSync(dir: string) -> { sources: Map<string,string>, tooBig: boolean }` — every allowed `.js` (relative POSIX path → UTF-8 text, BOM stripped), stops with `tooBig: true` past `LIMITS.unpackedBytes`; skips `node_modules` and dot entries; never follows symlinks inside the plugin

Allowed: `plugin.json`; `*.js|*.json|*.css|*.md|*.txt` at any depth outside `assets/`; `assets/<ASSET_NAME>` (one level). Refused with reasons:

| Input | Reason |
|---|---|
| contains `..` segment, starts with `/`, has `X:` drive, `\`, NUL, empty segment | „Unerlaubter Pfad: <name>“ |
| a segment starts with `.` | „Versteckte Datei: <name>“ |
| a segment is `node_modules` | „node_modules wird nicht unterstützt: <name>“ |
| any other extension / asset name | „Nicht erlaubte Datei: <name>“ |

- [ ] **Step 1: Write the failing tests** — `packageEntryError` table above row by row (`'../x.js'`, `'/x.js'`, `'C:/x.js'`, `'a\\b.js'`, `'a//b.js'`, `'.env'`, `'lib/.hidden.js'`, `'node_modules/x/index.js'`, `'index.html'`, `'assets/logo.svg'`, `'assets/sub/x.js'`) and allowed ones (`'plugin.json'`, `'server.js'`, `'lib/engine.js'`, `'README.md'`, `'assets/view.js'`, `'assets/font.woff2'`); `readPluginSourcesSync` on a temp folder returns `server.js`, `lib/a.js`, `assets/view.js`, not `node_modules/x.js`, strips a BOM, and sets `tooBig` for a 21 MB file.
- [ ] **Step 2: Run** `node --test test/pluginFiles.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `plugin-sdk/files.js`**, move the two constants out of `routes/pluginStatic.js` and import them there.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** „Share the plugin file allow-list between serving and packaging“.

---

### Task 2: Tokenizer (`plugin-sdk/tokenize.js`)

**Files:**
- Create: `plugin-sdk/tokenize.js`
- Test: `test/pluginTokenize.test.js`

**Interfaces:**
- Produces: `tokenize(code: string) -> Token[]`, `Token = { type: 'name'|'punct'|'string'|'number', value: string, line: number }`. Comments, regex literals and the static parts of template literals produce no tokens; a template literal without `${` yields one `string` token (its cooked text is not needed — value = raw text); `${ … }` content is tokenized as code (nesting allowed). `string` value is the unquoted raw text. `line` is 1-based, `\r\n` counts once. No Node-only API (runs in the browser in part 2).

Regex vs. division: a `/` starts a regex when the previous significant token is absent, a `punct` other than `)` `]` `}`, or one of the names `return typeof instanceof in of new delete void throw case do else yield await`.

- [ ] **Step 1: Write the failing tests**
  - `tokenize('ctx.events.list()')` values `['ctx','.','events','.','list','(',')']`
  - `// ctx.discord.sendDM` and `/* ctx.x */` → `[]`
  - `'ctx.discord.sendDM'` → one `string` token
  - `` `a ${ctx.events.list()} b` `` contains the names `ctx`, `events`, `list`
  - `` `${`${ctx.theme.x}`}` `` contains `theme`
  - `x = /ctx\.discord/g; y = a / b / c` → no name `discord`, names `a b c` present
  - `"a\nb"` line counting: `'a\r\nb\nc'` lines `1,2,3`
- [ ] **Step 2: Run** `node --test test/pluginTokenize.test.js` → FAIL.
- [ ] **Step 3: Implement `tokenize`** as a single pass state machine over the string.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** „Add a small JavaScript tokenizer for the permission scan“.

---

### Task 3: Permission scanner (`plugin-sdk/permissionScan.js`)

**Files:**
- Create: `plugin-sdk/permissionScan.js`
- Test: `test/pluginPermissionScan.test.js`

**Interfaces:**
- Consumes: `tokenize` (Task 2); `PERMISSIONS`, `SDK_1_1_PERMISSIONS` from `plugin-sdk/manifest.js`; `HOOK_NAMES` from `plugin-sdk/hooks.js` (if requiring `hooks.js` pulls Node-only code, copy the list into `permissionScan.js` and add a test asserting both lists are equal).
- Produces:
  - `scanSource(code: string, { file: string, kind: 'server'|'client' }) -> { permissions: Set<string>, warnings: Warning[], imports: string[] }` — `imports` = literal relative specifiers of `require(…)`, `import … from '…'`, `import('…')`
  - `Warning = { file: string, line: number, message: string }`
  - `scanPlugin(sources: Map<string,string>, manifest: { server: string, client: string }) -> { permissions: string[], warnings: Warning[] }` — permissions sorted in `PERMISSIONS` key order
  - `comparePermissions(declared: string[], found: string[]) -> { missing: string[], unused: string[] }`
  - `requiredSdk(permissions: string[], current: number) -> number` — `1.1` if any of `SDK_1_1_PERMISSIONS`, else `current` (never lowers)
  - `formatWarning(w: Warning) -> string` — `"<file>:<line>: <message>"`

Rules (receiver = name token `ctx` or `ui` not preceded by `.`):

| Token pattern | Result |
|---|---|
| `ctx.events.get` / `ctx.events.list` | `events:read` |
| `ctx.hooks.on('event.<x>'` with `event.<x>` in `HOOK_NAMES` | `events:read` |
| `ctx.hooks.on('registration.checkedIn'` | `registrations:read` |
| `ctx.hooks.on('member.deleted'` | nothing |
| `ui.openEventEditor` | `events:draft` |
| `ctx.members.get` / `ctx.members.search` | `members:read` |
| `ctx.registrations.list` | `registrations:read` |
| `ctx.discord.sendDM` | `discord:dm` |
| `ctx.discord.sendChannelMessage` | `discord:channel` |
| `ctx.discord.listRoles` / `addRole` / `removeRole` | `discord:roles` |
| `ctx.theme` / `ui.theme` followed by anything | `theme` |
| kind `server`: name `fetch` + `(` not after `.`; name `WebSocket` not after `.`; literal `require`/`import` of `/^(node:)?(http|https|http2|net|dgram|tls)$/` | `network` |

Warnings (German messages, exact):

| Pattern | Message |
|---|---|
| `ctx[` / `ui[` / `ctx.<area>[` | „Dynamischer Zugriff auf <ctx\|ui\|ctx.area> – Berechtigung nicht erkennbar.“ |
| `ctx.<area>` (area ∈ events, members, registrations, discord, hooks) not followed by `.` or `[` | „<ctx.area> wird weitergegeben – Berechtigung nicht erkennbar.“ |
| `=` directly before `ctx`/`ui` (alias or destructuring) | „<ctx\|ui> wird umbenannt oder zerlegt – Berechtigung nicht erkennbar.“ |
| `ctx.hooks.on(` with a first argument that is not a single `string` token | „Hook-Name ist kein fester Text – Berechtigung nicht erkennbar.“ |
| literal hook name not in `HOOK_NAMES` | „Unbekannter Hook „<name>“.“ |
| `require(`/`import(` with a non-literal argument | „require/import mit berechnetem Pfad – nicht prüfbar.“ |

Passing `ctx`/`ui` as an argument (`createEngine(ctx)`) yields nothing.

`scanPlugin` file kinds: client = `manifest.client`, every `isClientAsset` file, and every file reached from them through `imports` (resolved relative, `.js` appended when missing, transitively); every other `.js` = server.

- [ ] **Step 1: Write the failing tests**
  - one test per rule row and per warning row (each asserting permissions and the exact message + line)
  - `'fetch(url)'` kind `client` → no `network`; kind `server` → `network`; `'this.fetch(x)'` → none; `"require('node:https')"` server → `network`
  - `'createEngine(ctx)'` → no permission, no warning; `'this.ctx.discord.sendDM()'` → none
  - CRLF source with the warning on line 3 reports `line: 3`
  - `requiredSdk(['discord:roles'], 1) === 1.1`, `requiredSdk(['events:read'], 1.1) === 1.1`, `requiredSdk([], 1) === 1`
  - `comparePermissions(['a','b'], ['b','c'])` → `{ missing: ['c'], unused: ['a'] }`
  - **guard:** for each folder in `plugins/` (`badges`, `custom-design`, `event-feedback`, `event-submissions`): `scanPlugin(readPluginSourcesSync(dir).sources, manifest).permissions` deep-equals the manifest `permissions` sorted in `PERMISSIONS` order, `warnings` is `[]`, and `requiredSdk(found, 1)` equals the manifest `sdk`
- [ ] **Step 2: Run** `node --test test/pluginPermissionScan.test.js` → FAIL.
- [ ] **Step 3: Implement** the module (token-window matching over the `tokenize` output).
- [ ] **Step 4: Run** → PASS (fix rules, never the official plugins, if the guard fails).
- [ ] **Step 5: Commit** „Detect plugin permissions from the code“.

---

### Task 4: ZIP reader and writer (`plugin-sdk/zip.js`)

**Files:**
- Create: `plugin-sdk/zip.js`
- Modify: `plugin-sdk/errors.js` (add `PackageError extends Error`, German message, `name = 'PackageError'`)
- Test: `test/pluginZip.test.js`

**Interfaces:**
- Consumes: `LIMITS`, `IGNORED_ENTRY` (Task 1)
- Produces:
  - `writeZip(entries: Array<{ name: string, data: Buffer }>) -> Buffer` — deflate (stored when deflate is not smaller), CRC-32, fixed DOS time `1980-01-01 00:00`, UTF-8 flag (bit 11), entries in given order
  - `readZip(buffer: Buffer, limits = LIMITS) -> Array<{ name: string, data: Buffer, symlink: boolean }>` — throws `PackageError`. Reads the end-of-central-directory record and the central directory (never trusts local headers for sizes, so data descriptors work); skips directory entries and `IGNORED_ENTRY`; `symlink` = `(externalAttributes >>> 16) & 0o170000) === 0o120000`

`readZip` errors (exact): „Die Datei ist keine gültige ZIP-Datei.“ (no EOCD, bad offsets, CRC mismatch), „Verschlüsselte oder geteilte ZIP-Dateien werden nicht unterstützt.“, „Nicht unterstütztes Packverfahren: <name>“ (method ≠ 0/8), „Zu viele Dateien (höchstens 300).“, „Die Datei ist größer als 5 MB.“, „Entpackt zu groß (höchstens 20 MB).“, „Datei zu groß: <name>“ (entry > 2 MB), „Doppelte Datei: <name>“ (also case-insensitive). Inflate with `maxOutputLength: min(entryBytes, declared size) + 1` so an actual size beyond the declared one is caught.

- [ ] **Step 1: Write the failing tests** — round trip of 3 entries (text, binary, empty); a stored entry; a ZIP with data-descriptor flag (build it with a test helper that writes local sizes 0 + descriptor) reads correctly; `__MACOSX/._x` and `.DS_Store` are skipped; symlink attribute → `symlink: true`; 301 entries, 6 MB buffer, an entry whose actual inflated size exceeds its declared size (bomb), a duplicate `A.js`/`a.js`, a method-12 entry, a flipped CRC byte, an encrypted flag → each the exact error above.
- [ ] **Step 2: Run** `node --test test/pluginZip.test.js` → FAIL.
- [ ] **Step 3: Implement** `writeZip`/`readZip`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** „Read and write .dems packages without a ZIP dependency“.

---

### Task 5: Package build, check, install, remove (`plugin-sdk/package.js`)

**Files:**
- Create: `plugin-sdk/package.js`
- Test: `test/pluginPackage.test.js`

**Interfaces:**
- Consumes: Tasks 1–4, `validateManifest`, `PERMISSIONS`, `PackageError`
- Produces:
  - `analyzePlugin(dir: string) -> { raw: object, manifest: Manifest|null, errors: string[], found: string[], warnings: Warning[], missing: string[], unused: string[], sdk: number, nextRaw: object, changed: boolean }` — `nextRaw` = `raw` with `missing` appended to `permissions` (existing order kept, new ones in `PERMISSIONS` order) and `sdk` raised; unknown keys and key order kept; `changed` false when nothing would change
  - `writeManifest(dir: string, nextRaw: object) -> void` — `JSON.stringify(nextRaw, null, 2) + '\n'`, keeps the file's line ending style (CRLF stays CRLF)
  - `packPlugin(dir: string) -> { buffer: Buffer, fileName: string }` — `fileName = '<id>-<version>.dems'`; throws `PackageError` with all `packageEntryError` reasons joined by „ · “, on a symlink (`lstat`) „Symlinks werden nicht unterstützt: <name>“, on an invalid manifest its reason
  - `checkPackage(buffer: Buffer, { officialIds: Set<string>, customDir: string }) -> Report`
    `Report = { ok: boolean, errors: string[], manifest: { id, name, version, sdk, author, description }|null, fileCount: number, packedBytes: number, unpackedBytes: number, permissions: string[], missing: string[], unused: string[], warnings: string[], exists: boolean, installedVersion: string }`
  - `installPackage(buffer: Buffer, { officialIds, customDir, replace: boolean }) -> Promise<{ id: string, replaced: boolean }>` — re-runs `checkPackage`; throws `PackageError` with the first error, or „Das Plugin ist schon installiert.“ when `exists && !replace`
  - `removePluginFolder(customDir: string, id: string) -> Promise<void>`

`checkPackage` errors (besides Task 1/4 reasons): „plugin.json fehlt.“, „plugin.json muss im Hauptverzeichnis der ZIP liegen (nicht in einem Unterordner).“ (no root `plugin.json` but exactly one `<dir>/plugin.json`), „plugin.json ist kein gültiges JSON.“, any `validateManifest` reason (with `folderName = raw.id`, `fileExists` over the entry names), „Die ID gehört einem offiziellen Plugin.“, „Symlinks werden nicht unterstützt: <name>“. `permissions/missing/unused` come from scanning the package's `.js` entries in memory.

`installPackage` writes into `<customDir>/.incoming-<8 random hex>/<id>/`, then: if `<customDir>/<id>` exists rename it to `<customDir>/.old-<random>`, rename incoming into place, delete `.old-*` and the incoming parent; on any failure before the swap delete incoming and leave the old folder untouched.

- [ ] **Step 1: Write the failing tests**
  - `analyzePlugin` on a fixture using `ctx.discord.addRole` with `sdk: 1`, `permissions: ['theme']` → `missing ['discord:roles']`, `unused ['theme']`, `nextRaw.sdk 1.1`, `nextRaw.permissions ['theme','discord:roles']`, unknown key `homepage` kept in place
  - second `analyzePlugin` after `writeManifest` → `changed: false`; CRLF `plugin.json` stays CRLF; BOM `plugin.json` parses
  - `packPlugin` → `fileName 'demo-1.0.0.dems'`; `readZip` of it has `plugin.json` at root; a folder with `index.html` / a symlink / `node_modules` → `PackageError` naming the file
  - `checkPackage`: wrapped folder → the „Hauptverzeichnis“ error; official id → error; `missing` reported but `ok: true`; existing install → `exists: true, installedVersion '1.0.0'`
  - `installPackage` new → folder exists with all files; second call without `replace` → „Das Plugin ist schon installiert.“; with `replace` → `replaced: true`, new content, no `.incoming-*`/`.old-*` left; a stubbed `fs.promises.rename` failing on the swap leaves the old folder intact
- [ ] **Step 2: Run** `node --test test/pluginPackage.test.js` → FAIL.
- [ ] **Step 3: Implement** `plugin-sdk/package.js`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** „Build, check and install .dems plugin packages“.

---

### Task 6: Discovery check and host re-read/remove

**Files:**
- Modify: `plugin-sdk/discovery.js` (skip dot folders; accept a symlinked/junction folder; `permissionCheck` on valid custom entries; export `readCustomPlugin`)
- Modify: `plugin-sdk/views.js` (`STATUS_TEXT.restart = 'Neustart nötig'`; view field `permissionCheck`)
- Modify: `plugin-sdk/host.js` (`reloadPlugin`, `forgetPlugin`, `wasLoaded`, `customDir`, `devPluginId`, refuse enabling while `restart`)
- New host message in `host.js`: `MESSAGES.restartFirst = 'Starte DEMS neu, bevor du das Plugin wieder einschaltest.'` (thrown as `PluginHostError`)
- Test: `test/pluginDiscovery.test.js`, `test/pluginHost.test.js`, `test/systemPluginsView.test.js` (view shape only)

**Interfaces:**
- Consumes: `readPluginSourcesSync` (Task 1), `scanPlugin`, `comparePermissions`, `formatWarning` (Task 3)
- Produces:
  - `PluginEntry.permissionCheck: null | { missing: string[], unused: string[], warnings: string[], tooBig: boolean }` (custom + valid only; official → `null`)
  - `readCustomPlugin(customDir: string, id: string, officialIds: Set<string>) -> PluginEntry`
  - `PluginView.permissionCheck: null | { missing: {key,label}[], unused: {key,label}[], warnings: string[], tooBig: boolean }`; `status` may be `'restart'`
  - host: `customDir` (getter), `officialIds()` → `Set<string>`, `wasLoaded(id) -> boolean` (`record.registered || record.ctx !== null`), `reloadPlugin(id) -> PluginView` (re-reads the folder; a `wasLoaded` record gets the new entry and `runtime 'restart'`, else new/updated record with `runtime 'off'`; updates `entries` keeping order: official, then custom by id), `forgetPlugin(id) -> void` (drops the entry; a record with `state` stays as orphan, without `state` it is deleted)
  - `createPluginHost({ …, devPluginId = '' })` — only with `mockMode`: in `startPlugin`, a custom record with that id and no state or `needsConfirmation` is persisted `enabled: true` with `confirmedVersion`/`confirmedPermissions`
  - `server.js` passes `devPluginId: IS_MOCK_MODE ? (process.env.PLUGINS_DEV_ID || '') : ''`

A large plugin gets `permissionCheck.tooBig: true` and the view warning „Code zu groß für die Prüfung“.

- [ ] **Step 1: Write the failing tests**
  - discovery: `.incoming-x/demo/plugin.json` not listed; a symlinked folder (`fs.symlinkSync(target, link, 'junction')`) is listed; custom plugin calling `ctx.discord.sendDM` without the permission → `permissionCheck.missing ['discord:dm']`; official entry → `permissionCheck null`
  - host: `reloadPlugin` of a never-loaded id → status `off`, new version visible; after `setEnabled(true)` + `setEnabled(false)` + `reloadPlugin` → status `restart`, `statusText 'Neustart nötig'`, and `setEnabled(id, true)` rejects with `restartFirst`; `forgetPlugin` of a plugin with stored state → status `orphaned`, without state → gone from `list()`
  - host mock: `devPluginId: 'demo'`, `mockMode: true` → `demo` is `on` after `start()`; same with `mockMode: false` → `off`
- [ ] **Step 2: Run** `node --test test/pluginDiscovery.test.js test/pluginHost.test.js` → FAIL.
- [ ] **Step 3: Implement** the changes listed above.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** „Check custom plugin permissions at discovery and re-read single plugins“.

---

### Task 7: CLI `new`, `check`, `build`, `install`, `help`

**Files:**
- Create: `scripts/plugin.js`
- Modify: `package.json` (`"plugin": "node scripts/plugin.js"`)
- Modify: `docs/wiki/howto/write-plugin.md` (sections 1, 6, 7: scaffold, `check`/`build`, `install`, what the warning means; the detection is a help, not a security check)
- Test: `test/pluginCli.test.js`

**Interfaces:**
- Consumes: Task 5 (`analyzePlugin`, `writeManifest`, `packPlugin`, `installPackage`), `validateManifest` ID rule
- Produces: `main(argv: string[], { cwd, stdin, stdout, stderr, env, isTTY }) -> Promise<number>` exported for tests; the file runs `main(process.argv.slice(2), …)` and `process.exitCode = code` when it is the entry module

Commands and exact behaviour:
- `new <id> [--dir <parent>]` — refuses an id not matching `^[a-z][a-z0-9-]{2,31}$` („Die ID ist nicht erlaubt: …“) or an existing folder; writes `plugin.json` (`version '0.1.0'`, `sdk: 1.1`, `server`, `client`, `permissions: []`, `settings: []`), `server.js`, `client.js`, `client.css`; scaffold content is the builder's call but must pass `analyzePlugin` with no errors and no missing permissions.
- `check <folder>` — prints errors, `+ <perm>` (missing), `? <perm> (nicht mehr gefunden)` (unused), the `sdk` change and `formatWarning` lines; writes nothing; exit 1 on errors, else 0.
- `build <folder> [--yes] [--out <file>]` — `check` output; when `changed`: asks „plugin.json aktualisieren? (j/n) “ (TTY), `--yes` skips, non-TTY without `--yes` exits 1 with „Nicht interaktiv: mit --yes bestätigen.“; then `packPlugin` → prints „Gebaut: <path> (<n> Dateien, <KB> KB)“. Answer `n` still builds with the old manifest and prints the mismatch as warning.
- `install <file.dems> [--force] [--plugins-dir <dir>]` — dir default `env.PLUGINS_DIR || <repo>/data/plugins`; official ids from `<repo>/plugins`; existing plugin without `--force`: TTY asks „<id> <alt> ersetzen durch <neu>? (j/n) “, non-TTY exits 1; on success prints „Installiert: <id> <version>. DEMS neu starten, damit das Plugin erscheint.“
- `help` / no command — German usage text, exit 0.

- [ ] **Step 1: Write the failing tests** (call `main` with fake streams and a temp `cwd`): `new demo-plugin` then `build demo-plugin --yes` → exit 0 and `demo-plugin-0.1.0.dems` exists; `new Bad` → exit 1 with the ID message; `build` with a missing permission, non-TTY, no `--yes` → exit 1 and `plugin.json` unchanged; with `--yes` → `plugin.json` contains the permission; `check` writes nothing; `install` into a temp plugins dir → exit 0 and folder present, second `install` non-TTY without `--force` → exit 1, with `--force` → 0.
- [ ] **Step 2: Run** `node --test test/pluginCli.test.js` → FAIL.
- [ ] **Step 3: Implement** `scripts/plugin.js` (argument parsing by hand, `readline/promises` for questions) and the wiki section.
- [ ] **Step 4: Run** `npm run wiki && npm test` → PASS.
- [ ] **Step 5: Commit** „Add the plugin CLI to scaffold, check, build and install plugins“.

---

### Task 8: CLI `dev`

**Files:**
- Modify: `scripts/plugin.js` (command `dev <folder>`)
- Modify: `docs/wiki/howto/write-plugin.md` (section 6 „Try it“), `docs/wiki/modules/dev-mock-mode.md`, `docs/wiki/ops/configuration.md` + `.env.example` (`PLUGINS_DEV_ID`, internal, set by `plugin dev`, only honoured in mock mode)
- Test: `test/pluginCli.test.js`

**Interfaces:**
- Consumes: `main` (Task 7), host `devPluginId` (Task 6)
- Produces: `prepareDev(folder: string, { repoRoot, env }) -> { linkDir: string, configPath: string, env: object }` exported for tests; `dev` then spawns `process.execPath <repo>/node_modules/nodemon/bin/nodemon.js --config <configPath> <repo>/dev/start.js` with that env and pipes its output

`prepareDev`: exits with German errors when `env.NODE_ENV === 'production'` („plugin dev läuft nicht mit NODE_ENV=production.“), the folder has no valid `plugin.json`, the folder name ≠ id („Der Ordnername muss der Plugin-ID entsprechen.“), or the id is official („Offizielle Plugins entwickelst du direkt mit npm run dev:mock.“). It recreates `<repo>/data/dev-plugins/` containing only the link `<id>` → absolute folder (`fs.symlinkSync(abs, link, 'junction')`), writes `<repo>/data/dev-plugins/nodemon.json` = `{ "watch": [<abs folder>], "ext": "js,json,css", "ignore": [] }`, and returns env `{ …env, PLUGINS_DIR: <repo>/data/dev-plugins, PLUGINS_DEV_ID: <id> }`.

- [ ] **Step 1: Write the failing tests** for `prepareDev`: each refusal message; on success `data/dev-plugins/<id>` resolves (`fs.realpathSync`) to the folder, nothing else is in `data/dev-plugins` besides the link and `nodemon.json`, returned env has both variables. (Use a temp `repoRoot` with an empty `plugins/` folder.)
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `prepareDev` and the spawn; docs.
- [ ] **Step 4: Run** `npm run wiki && npm test` → PASS. Manual check: `npm run plugin -- new demo-plugin --dir ../tmp && npm run plugin -- dev ../tmp/demo-plugin`, open `http://localhost:3000`, System › Plugins shows `demo-plugin` „An“; editing `server.js` restarts.
- [ ] **Step 5: Commit** „Run a plugin under development in mock mode with plugin dev“.

---

### Task 9: Admin API for upload, install and remove

**Files:**
- Create: `routes/pluginUploadStore.js`
- Modify: `routes/adminPlugins.js`
- Modify: `docs/wiki/concepts/plugin-sdk.md` (security model rule 2 as worded in the spec, lifecycle rows for upload/replace/remove, chip `restart`, permission check), `docs/wiki/reference/api-index.md`, `docs/wiki/ops/configuration.md` + `.env.example` (`PLUGINS_UPLOAD`, German comment: off by default, upload needs the reset password)
- Test: `test/adminPluginsRouter.test.js`, `test/pluginUploadStore.test.js`

**Interfaces:**
- Consumes: `checkPackage`, `installPackage`, `removePluginFolder` (Task 5); host `customDir`, `officialIds`, `reloadPlugin`, `forgetPlugin`, `wasLoaded`, `isEnabled` (Task 6); `LIMITS`
- Produces:
  - `createUploadStore({ ttlMs = 600000, maxPerSession = 3, now = Date.now }) -> { put(sessionId, buffer) -> uploadId, take(sessionId, uploadId) -> Buffer|null }` — `uploadId` = 16 random bytes hex; `take` removes the entry (single use); a 4th `put` drops the oldest of that session
  - `createAdminPluginsRouter(getHost, { uploadEnabled = () => process.env.PLUGINS_UPLOAD === 'true', store = createUploadStore() } = {})`

Routes (all below the existing `/api/admin` guard; order: the two `upload/*` routes before any `/plugins/:id` route):

| Route | Answers |
|---|---|
| `GET /plugins` | adds `uploadEnabled: boolean` |
| `POST /plugins/upload/check` (`express.raw({ type: 'application/octet-stream', limit: LIMITS.packedBytes })` on this route; its `entity.too.large` error → 413 „Die Datei ist größer als 5 MB.“) | 403 „Das Hochladen von Plugins ist ausgeschaltet (PLUGINS_UPLOAD).“ · 409 „Im abgesicherten Modus können keine Plugins hochgeladen werden.“ · 400 „Keine Datei empfangen.“ (empty / not a Buffer) · 429 after 10 checks per 10 min per `req.sessionID` „Zu viele Prüfungen. Bitte warte ein paar Minuten.“ · 200 `{ uploadId: string|null, report }` where `report` = `Report` with `permissions/missing/unused` mapped to `{ key, label }`, plus `replaces: null | { version, restart: host.wasLoaded(id), enabled: host.isEnabled(id) }`; `uploadId` only when `report.ok` |
| `POST /plugins/upload/install` `{ uploadId, password, replace }` | 403/409 as above · 400 `badInput` (`uploadId` not a string, `replace` not boolean) · 401 `password` · 410 „Der Upload ist abgelaufen. Bitte lade die Datei erneut hoch.“ (`store.take` null) · 409 `switchOffFirst` when the installed plugin is on · 409 „Das Plugin ist schon installiert.“ · 400 first `PackageError` message · 200 `{ plugin: view }` after `host.reloadPlugin(id)`; audit `PLUGIN_UPLOAD` „Plugin „<name>“ <version> hochgeladen“ (or „… ersetzt“) |
| `DELETE /plugins/:id` `{ password }` | 403 when upload is off (remove writes into `PLUGINS_DIR`, so it shares the switch) · 404 `notFound` · 409 „Offizielle Plugins können nicht entfernt werden.“ · 409 `switchOffFirst` · 401 `password` · 200 `{ removed: true }` after `removePluginFolder` + `host.forgetPlugin(id)`; audit `PLUGIN_REMOVE` „Plugin „<name>“ entfernt“ |

The password check happens before `store.take`, so a wrong password does not burn the upload.

- [ ] **Step 1: Write the failing tests**
  - store: `take` twice → second `null`; other session → `null`; after `ttlMs` (fake `now`) → `null`; 4th `put` evicts the first
  - router: upload off → check/install/remove 403 and `GET` `uploadEnabled: false`; safe-mode host → 409; check of a valid package → 200 with `uploadId`, `report.missing` labels; check of a `../` / symlink / `.html` package → `ok: false`, `uploadId: null`, error names the file; 6 MB body → 413; install wrong password → 401 and a later correct install with the same `uploadId` works; install twice with the same `uploadId` → 410; install replacing an enabled plugin → 409; after replacing a loaded-then-switched-off plugin `plugin.status === 'restart'`; install writes one `PLUGIN_UPLOAD` audit entry; remove official → 409, remove custom off → folder gone, view `orphaned` (state existed), audit `PLUGIN_REMOVE`
  - dev server (`test/devServer.test.js`, persona `admin`, `PLUGINS_UPLOAD=true`, temp `PLUGINS_DIR`): upload + install of a packed fixture → `GET /api/admin/plugins` lists it with `official: false`, `status 'off'`
- [ ] **Step 2: Run** `node --test test/pluginUploadStore.test.js test/adminPluginsRouter.test.js` → FAIL.
- [ ] **Step 3: Implement** store, routes, docs.
- [ ] **Step 4: Run** `npm run wiki && npm test` → PASS.
- [ ] **Step 5: Commit** „Let admins upload .dems plugins when PLUGINS_UPLOAD is on“.

---

### Task 10: System › Plugins UI (upload dialog, remove, permission warning)

**Files:**
- Create: `public/js/admin/plugin-upload.js` (upload dialog + remove; `system-plugins.js` is at 458 lines)
- Modify: `public/js/admin/system-plugins.js` (import the new module; `warningLines` adds the permission-check lines; `openTrustDialog` fills the mismatch block; `loadPluginsPanel` passes `uploadEnabled`; card gets „Entfernen“ for `!official && !enabled && uploadEnabled`)
- Modify: `public/index.html` (button „Plugin hochladen“ with `bi-upload` in the panel header, hidden by `.is-hidden`; modal `#pluginUploadModal` built like `#pluginTrustModal`: file input `accept=".dems"`, report area, reset-password input, „Abbrechen“/„Installieren“; a mismatch block `#plugin-trust-check-result` in the trust modal; a remove modal `#pluginRemoveModal` with password)
- Modify: `public/css/components.css` or `style.css` only if an existing component does not fit (tokens only)
- Modify: `docs/wiki/modules/frontend-app.md` (module map row), `docs/wiki/howto/write-plugin.md` section 7 (browser upload)
- Test: `test/systemPluginsView.test.js`, `test/pluginUploadView.test.js`

**Interfaces:**
- Consumes: Task 9 routes and shapes; `escapeHtml`, `showToast`, `registerActions`, `state.csrfToken`, `showElement`/`toggleElement`
- Produces (pure, exported for tests):
  - `renderUploadReport(report, replaces) -> string` (HTML) — header „<name> <version> · SDK <sdk> · von <author>“, „<n> Dateien · <KB> KB“; each error as a danger line; mismatch block „Berechtigungen passen nicht zum Code“ with „im Code, aber nicht angegeben:“ / „angegeben, aber nicht im Code:“ and labels; warnings list; replace line „Ersetzt die installierte Version <v>“ + „ (Neustart nötig)“ when `replaces.restart`; „Schalte das Plugin zuerst aus.“ when `replaces.enabled`
  - `permissionCheckLines(permissionCheck) -> string[]` (texts for `warningLine`) — „Berechtigungen passen nicht zum Code: im Code, aber nicht angegeben: <labels>“, „… angegeben, aber nicht im Code: <labels>“, „Code zu groß für die Prüfung“, one line per scanner warning (max 5, then „und <n> weitere Hinweise“)
- Actions: `openPluginUpload`, `pluginUploadFile` (`data-change`: reads `file.arrayBuffer()`, POSTs with `Content-Type: application/octet-stream` + `X-CSRF-TOKEN`), `installPluginUpload`, `openPluginRemove`, `confirmPluginRemove`

The „Installieren“ button is disabled until a report with `ok` arrived, no `replaces.enabled`, and a password is typed. `replace` is sent as `Boolean(replaces)`. After install/remove the list reloads (`loadPluginsPanel`) and a success toast names the plugin.

- [ ] **Step 1: Write the failing tests** — `renderUploadReport` escapes a `<script>` plugin name, shows both mismatch lists with labels, the restart hint, the switch-off hint; `permissionCheckLines(null)` → `[]`, truncation after 5 warnings; `renderPluginCard` of a custom, off plugin with `uploadEnabled` contains `data-click="openPluginRemove"`, an official or enabled one does not; a card with `permissionCheck.missing` contains „Berechtigungen passen nicht zum Code“.
- [ ] **Step 2: Run** `node --test test/systemPluginsView.test.js test/pluginUploadView.test.js` → FAIL.
- [ ] **Step 3: Implement** module, markup, wiring, docs.
- [ ] **Step 4: Run** `npm run wiki && npm test` → PASS (CSP/style/icon guards included). Manual check in `npm run dev:mock` with `PLUGINS_UPLOAD=true`: upload a built `.dems`, see the report, install, switch on via trust dialog, upload the same id again → „Schalte das Plugin zuerst aus.“; switch off, replace → „Neustart nötig“; remove.
- [ ] **Step 5: Commit** „Add plugin upload and removal to System › Plugins“.

---

### Task 11: Finish

**Files:**
- Modify: `docs/wiki/reference/known-issues.md` only if a limit surfaced (e.g. scanner blind spots stay documented in `concepts/plugin-sdk.md` instead)
- Modify: `openspec/specs/` if a spec there describes plugin security rule 2 (grep `Code only via` / `No upload`), else nothing

- [ ] **Step 1:** `grep -rn "No upload\|kein Upload" docs/wiki openspec/specs` and align every remaining statement with the new rule 2 (older specs and archived changes stay as history).
- [ ] **Step 2: Run** `npm run wiki && npm test && npm run test:e2e` → all PASS.
- [ ] **Step 3: Commit** „Align the docs with plugin upload“ (skip when nothing changed).
