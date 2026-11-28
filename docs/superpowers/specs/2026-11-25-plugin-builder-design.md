# Plugin builder (part 1: foundation) — design

Issue #165 „Plugin builder IDE“. Branch `165-plugin-builder-ide` from `main` (3.5.0).
This is part 1 of 3: **foundation** (permission detection, `.dems` format, CLI,
upload in System › Plugins, server-side check). Part 2 is the local browser studio
with live preview, part 3 the AI inside the studio; both get their own design later
and build on the modules defined here.

## Intent

Everyone who wants to build their own DEMS plugin should be able to do it without
knowing the manifest by heart. Today a plugin is a hand-made folder; the author must
find the needed `permissions` themselves, a missing one only shows at runtime („Dem
Plugin fehlt die Berechtigung „…“.“), an SDK 1.1 permission in a `sdk: 1` manifest
makes the plugin „Ungültig“, and there is no package format to pass a plugin on.
Installing means copying a folder onto the server's disk and restarting.

The builder detects the permissions from the code and writes them into `plugin.json`,
packs the plugin into one `.dems` file (a plain ZIP), and DEMS accepts that file by
upload in System › Plugins (opt-in) or by a command on the server. DEMS checks the code
itself on every read-in and warns when the declared permissions do not match the code.

## Goals

- `npm run plugin -- new <id>`: scaffold a plugin (`plugin.json` with `sdk: 1.1`,
  `server.js`, `client.js`, `client.css`).
- `npm run plugin -- dev <folder>`: DEMS in mock mode with the plugin mounted,
  restart on every change of the plugin.
- `npm run plugin -- check <folder>`: detection + validation report, writes nothing.
- `npm run plugin -- build <folder>`: detect permissions, update `plugin.json`
  (after showing the changes), validate, write `<id>-<version>.dems`.
- `npm run plugin -- install <file.dems> [--force]` on the server: same checks as the
  upload, unpack into `PLUGINS_DIR/<id>/`.
- Upload of `.dems` in System › Plugins, off by default (`PLUGINS_UPLOAD=true`),
  two steps (check → install with reset password), audit log.
- „Entfernen“ for custom plugins that are switched off (reset password, audit log).
- Server-side detection at every discovery of a custom plugin; a mismatch with
  `plugin.json` shows a warning in the list and the trust dialog. It never blocks.
- Detection on the four official plugins yields exactly their current `permissions`
  and `sdk` (guard test).

## Non-goals

- No browser studio, preview or AI (parts 2 and 3).
- No sandbox, no signatures, no URL install, no plugin store.
- No `node_modules` in `.dems` (no npm dependencies of custom plugins through this
  path; a custom plugin with dependencies still goes the manual folder way).
- No hot reload of a plugin that is already loaded (Node cannot unload a module).

## Anti-goals

- The detection must never be sold as a security check. It is a help for honest
  authors; the permission list stays „guard rail, not a wall“ (security model rule 1).
- The server check must never run plugin code. Reading only.
- Upload must not become a silent default: without `PLUGINS_UPLOAD=true` nothing of it
  is reachable (no button, route answers 403).

## Approaches considered

**Where the studio runs** (decided with the owner, affects parts 2/3 but fixes the
foundation's shape): local studio (`npm run plugin -- studio`, DEMS mock mode with the
plugin really running) — **picked**, because only there the preview shows what the
plugin does, `server.js` included. Rejected: studio inside every DEMS instance (preview
could only fake server answers, since running uploaded `server.js` for a preview is
exactly „code from the browser onto the server“), and „local first, in-DEMS later“.

**How code reaches the production server** (decided with the owner): upload in
System › Plugins behind an env switch + reset password — **picked**, plus the CLI
`install`. Rejected: CLI only (admins with nothing but a browser could not install).

**How permissions are detected** (one sensible way): a small own tokenizer that skips
comments, strings and regex literals, then matches member chains like
`ctx.discord.sendDM` — **picked**. Rejected: running the plugin against a recording
`ctx` (executes foreign code, misses branches never taken), a real JS parser such as
acorn (new dependency).

**ZIP** (owner's call confirmed): own small ZIP reader/writer on `zlib`
(`deflateRawSync`/`inflateRawSync`), stored + deflate entries only, no new dependency.

**Where the tool lives**: in the DEMS repo (`scripts/plugin.js`, logic under
`plugin-sdk/`), not a separate npm package — the local studio needs a DEMS checkout
anyway.

## Design

### Module layout

| Module | Role |
|---|---|
| `plugin-sdk/permissionScan.js` | pure: `scanSource(code)` → `{ found: Map<permission, locations[]>, warnings[] }`; `scanPlugin(files)` merges all `.js` files; `comparePermissions(declared, found)` → `{ missing, unused }`; `requiredSdk(permissions)` |
| `plugin-sdk/files.js` | the one file allow-list shared by build, install and `routes/pluginStatic.js` (moves `ASSET_NAME` and the content types there) |
| `plugin-sdk/zip.js` | pure-ish: `writeZip(entries)` → Buffer, `readZip(buffer, limits)` → entries or a German error; no file system |
| `plugin-sdk/package.js` | `buildPackage(dir)` (detect, validate, list files, zip) and `checkPackage(buffer, { officialIds, installed })` → report; `installPackage(report, customDir, { force })` writes atomically |
| `scripts/plugin.js` | CLI (`new`, `dev`, `check`, `build`, `install`, `help`), German output, exit code ≠ 0 on error |
| `routes/adminPlugins.js` | upload/check/install/remove routes |
| `public/js/admin/system-plugins.js` | upload dialog, warning line, remove button |

`permissionScan.js` and `zip.js` stay free of Node-only APIs where it costs nothing
(the scanner is plain string work) so part 2 can reuse the scanner in the browser.

### Detection rules

Input: every `.js` file of the plugin folder (root and sub-folders, not `assets/`
only — `badges` passes `ctx` to `engine.js`, which alone calls `sendDM` and
`sendChannelMessage`).

Receivers: the identifiers `ctx` and `ui` anywhere (parameter, variable, property
name `this.ctx` is not a receiver). That is the SDK's documented naming; a plugin
that names them otherwise gets a warning, not a guess.

| Found | Permission |
|---|---|
| `ctx.events.get` / `ctx.events.list` | `events:read` |
| `ctx.hooks.on('<event.*>', …)` with a literal name | `events:read` |
| `ui.openEventEditor` | `events:draft` |
| `ctx.members.get` / `ctx.members.search` | `members:read` |
| `ctx.registrations.list`, `ctx.hooks.on('registration.checkedIn', …)` | `registrations:read` |
| `ctx.discord.sendDM` | `discord:dm` |
| `ctx.discord.sendChannelMessage` | `discord:channel` |
| `ctx.discord.listRoles` / `addRole` / `removeRole` | `discord:roles` |
| `ctx.theme.<anything>`, `ui.theme.<anything>` | `theme` |
| in **server** files: global `fetch(`, `require('http'|'https'|'net'|'dgram'|'tls'|'node:…')`, `WebSocket` | `network` |

Server vs. client files *(builder-check call)*: client files are the manifest's
`client` file, every `.js` under `assets/` and every file reached from them by a
literal `import`; all other `.js` files are server files. `fetch` in client code never
means `network` — the browser CSP (`connectSrc`) only allows DEMS and Discord anyway.
The split is plain string work, so the scanner still runs in the browser (part 2).

No permission: `ctx.events.url`, `ctx.routes`, `ctx.data`, `ctx.settings`, `ctx.audit`,
`ctx.log`, `ctx.siteUrl`, `ctx.profile`, `member.deleted` hook, `ui` page helpers.

Warnings (never a guessed permission), each with file + line:
- computed access on a receiver or an area: `ctx[x]`, `ctx.discord[x]`
- the receiver or an area used as a value: `const d = ctx.discord`, `{ discord } = ctx`,
  `helper(ctx.discord)`, `ctx.hooks.on(name, …)` with a non-literal name
- `require()` / `import` with a non-literal argument
- a hook name that is not in `HOOK_NAMES`

Passing the whole `ctx` / `ui` to a function is fine — the callee's file is scanned
and its parameter is again called `ctx`.

`sdk`: if any of `SDK_1_1_PERMISSIONS` is in the result, the build sets `sdk: 1.1`.
It never lowers `sdk`.

### `build` behaviour

1. Scan, compare with `plugin.json`.
2. Print a German change list: „hinzugefügt“ (found, not declared), „nicht mehr
   gefunden“ (declared, not found — warning only, never removed), the `sdk` change and
   every scanner warning.
3. Ask „plugin.json aktualisieren? (j/n)“; `--yes` skips the question, non-TTY without
   `--yes` aborts with a hint. Writes `plugin.json` keeping key order and 2-space
   indent.
4. Validate with `validateManifest` (folder name = id) and the file allow-list.
5. Write `<id>-<version>.dems` next to the folder (or `--out <path>`).

### `.dems` format and file allow-list

A ZIP with `plugin.json` at the root (no wrapping folder). Allowed entries:
- `plugin.json`
- `*.js`, `*.json`, `*.css`, `*.md`, `*.txt` at any depth outside `assets/`
  (server modules, data, readme, licence)
- `assets/<name>` matching today's `ASSET_NAME` (`js css png jpg jpeg webp gif json woff2`)

Refused (build stops, install rejects): `..`, absolute or drive paths, backslashes,
NUL and other control characters, Windows device names (`con`, `nul`, `com1` … in any
segment and case), empty segments, any segment starting with `.`, `node_modules`, symlinks (ZIP
external attributes with the symlink mode, and no following symlinks while building),
directory entries are ignored, every other extension (HTML, SVG, executables …),
duplicate names (also case-insensitively, for Windows checkouts), encrypted or
multi-disk ZIPs, compression other than stored/deflate.
Building from a folder is more forgiving (controller ruling after the final review):
`build` skips dot entries at any depth (`.git/`, `.gitignore`, `.vscode/`), `node_modules`
and files without an extension (`LICENSE`) and prints „übersprungen: <name>“ for each
(`check` too); install and upload still refuse them.

Limits (constants in `plugin-sdk/files.js`): 5 MB file, 20 MB unpacked total, 300
entries, 2 MB per single entry unpacked; the inflater stops at the declared size plus
one byte (actual size wins over the header).

### Checking a package (shared by CLI install and upload)

`checkPackage(buffer)` returns a report without touching the disk:
`{ ok, errors[], manifest, files[], sizes, detected: { permissions, warnings },
mismatch: { missing, unused }, replaces: null | { version, loaded } }`.
Errors are German (e.g. „Die Datei enthält nicht erlaubte Dateien: index.html“,
„Die ID gehört einem offiziellen Plugin.“, „plugin.json fehlt.“). `ok` is false on any
error; a permission mismatch is a warning, not an error.

### Installing

`installPackage` unpacks into `PLUGINS_DIR/.incoming-<random>/<id>/`, then renames
into place (an existing folder is renamed to `.old-<random>` first and deleted after
the swap), so a crash never leaves a half plugin. Discovery already ignores dot folders
because they hold no `plugin.json` at their root — the builder verifies this and makes
discovery skip dot folders explicitly.

After install the host is told to re-read that one plugin:
- **new id, or a plugin never loaded since start** → new/updated record, list shows it
  at once with the usual state rules (custom → off until switched on with trust +
  reset password).
- **plugin already loaded** → replacing is only allowed while the plugin is
  switched off (upload dialog and CLI say „Schalte das Plugin zuerst aus.“). Reason:
  `routes/pluginStatic.js` serves `client.js`/`assets` from disk on every request, so
  a replace while on would hand browsers new client code next to old server code,
  under the old confirmed permissions. After the replace the record gets runtime
  `restart` → chip „Neustart nötig“, and switching it on is refused until DEMS was
  restarted; then the usual „Bestätigung nötig“ applies if version or permissions
  changed. *(builder-check call)*

CLI `install` on a running server cannot reach the process; it prints
„DEMS neu starten, damit das Plugin erscheint.“. Without `--force` an existing plugin
is not replaced (asks in a TTY).

### Upload in System › Plugins

Env `PLUGINS_UPLOAD` (`true` to enable, default off; documented in `.env.example`
and `ops/configuration.md`). Also refused while `PLUGINS_SAFE_MODE=true`.

Routes in `routes/adminPlugins.js` (admin, CSRF, audit log on every mutation):

| Route | Body | Does |
|---|---|---|
| `GET /api/admin/plugins` | — | gains `uploadEnabled` and per plugin `permissionCheck: { missing, unused, warnings }` and runtime `restart` |
| `POST /api/admin/plugins/upload/check` | raw `application/octet-stream`, ≤ 5 MB (`express.raw` on this route only) | returns the report, writes nothing, keeps the buffer server-side for 10 min under a random `uploadId` (memory, max 3 per session) |
| `POST /api/admin/plugins/upload/install` | `{ uploadId, password, replace }` | reset password, re-checks, installs, audit „Plugin hochgeladen: <id> <version>“ |
| `DELETE /api/admin/plugins/:id` | `{ password }` | only custom + switched off; deletes the folder only. The plugin state stays (it holds the list of data collections that „Daten löschen“ and `purgeUser` need), so the plugin shows as „Verwaist“ with the existing „Daten löschen“ until the admin clears it; audit „Plugin entfernt“ *(builder-check call)* |

Static paths go above `/:id`. Rate limit: the existing admin limiter, plus at most 10
checks per 10 minutes per session.

UI (German, components from `components.css`, no inline styles): a button
„Plugin hochladen“ in the System › Plugins header when `uploadEnabled`, a dialog with
file picker → report (name, version, SDK, author, file count/size, errors in red,
permission mismatch as warning, „Ersetzt die installierte Version x (Neustart
nötig)“) → reset password → „Installieren“. Mockup:

```
Plugin hochladen                                    [x]
  feedback-plus-1.2.0.dems   · 14 Dateien · 38 KB
  Feedback Plus 1.2.0 · SDK 1.1 · von Beispiel-Autor
  [!] Berechtigungen passen nicht zum Code
      im Code, aber nicht angegeben:  discord:dm
  Ersetzt die installierte Version 1.1.0 (Neustart nötig)
  Admin-Reset-Passwort [__________]
                          [Abbrechen]  [Installieren]
```

### Server-side check at discovery

`discoverPlugins` runs `scanPlugin` for every valid custom plugin (read only, files
under the size limits; a bigger plugin gets the warning „Code zu groß für die
Prüfung“). The entry gets `permissionCheck`. System › Plugins shows a warning line
„Berechtigungen passen nicht zum Code“ with the two lists; the trust dialog shows the
same block above the permission list. Official plugins are not scanned at runtime;
the guard test covers them.

### Security model changes (wiki `concepts/plugin-sdk.md`)

Rule 2 becomes: „Code only via the server's file system — unless the operator sets
`PLUGINS_UPLOAD=true`. Then an admin can upload a `.dems` with the reset password;
a hijacked admin session alone is not enough, a hijacked session plus the reset
password is.“ The trust dialog and the upload dialog say that uploaded code gets full
process access. Rule 3 (official comes from the location) is unchanged: upload only
writes into `PLUGINS_DIR`, never into `<app>/plugins`, and refuses official ids.

### `dev` command

`plugin dev <folder>` checks that the folder name equals the manifest id and that the
id is not an official one, then mounts **only that plugin** *(builder-check call)*: it
creates `data/dev-plugins/` with a directory link `<id>` → the folder (`fs.symlinkSync`
type `'junction'`, which works on Windows without admin rights) and starts
`dev/start.js` (mock mode) with `PLUGINS_DIR=data/dev-plugins` and nodemon watching the
source folder (`--watch <folder> --ext js,json,css`), so the plugin is reloaded on
change. Sibling plugins of the folder are not mounted; `plugin dev plugins/badges`
is refused (official ids are developed in place with `npm run dev:mock`). Refused with `NODE_ENV=production` (mock rule). The mock auto-enable rule
for official plugins does not apply to custom ones; `dev` additionally marks the
plugin under development as enabled and confirmed in the mock database so the author
does not click through the trust dialog on every restart.

### Tests (TDD, `node:test`)

- `permissionScan`: each table row, comments/strings/template literals/regex ignored,
  each warning case, `sdk` raise, the four official plugins match exactly.
- `zip`: round trip, stored + deflate, refused paths/symlinks/duplicates/extensions,
  size and count limits, a crafted bomb (small file, huge declared or actual size).
- `package`: build of a fixture, check report, official id, replace rules, atomic
  install (failure in the middle leaves the old folder).
- routes: upload off → 403 and no button data; on → check/install/remove with
  password, audit log, safe mode refusal; dev server test that an uploaded plugin
  appears as „Nicht offiziell“ and off.
- CLI: `new` + `build` on a temp folder, `--yes`, non-TTY abort.

### Docs

Update `howto/write-plugin.md` (sections 6 „Try it“ and 7 „Install“), 
`concepts/plugin-sdk.md` (security model, upload, permission check), `ops/configuration.md`,
`.env.example`, `reference/api-index.md`, then `npm run wiki`.

## Left to the builder

- Exact tokenizer implementation and how much JS syntax it handles beyond the rules
  above (template literal nesting, regex vs. division heuristics).
- Wording of CLI output and German error texts beyond the ones quoted here.
- How the upload buffer store is implemented (in-memory map with expiry is fine).
- Scaffold content of `plugin new` (a minimal page + one route is enough).
- Splitting into commits/PRs.
