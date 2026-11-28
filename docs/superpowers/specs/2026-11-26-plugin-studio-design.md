# Plugin builder (part 2: local studio) — design

Issue #165 „Plugin builder IDE“, part 2 of 3. Builds on part 1
(`docs/superpowers/specs/2026-11-25-plugin-builder-design.md`: permission scan,
`.dems` format, `npm run plugin` CLI, `plugin dev`). Part 3 (AI inside the studio)
gets its own design and plugs into the studio defined here. Branch
`165-plugin-builder-ide`.

## Intent

Everyone who wants to build a DEMS plugin should be able to do it in one place: write
the code, see the plugin really running in DEMS next to the editor, see what it does
behind the page (DMs, channel posts, requests, hooks, errors), and press „Bauen“ to get
the `.dems` file. Today this needs a separate editor, `plugin dev` in a terminal, the
mock bot's console log and `plugin build`. The studio puts it together for authors,
including beginners, and gives the AI of part 3 a home.

## Goals

- `npm run plugin -- studio` starts the studio and opens the browser on its start page.
- Start page: „Neues Plugin“ (id + parent folder → scaffold of part 1), „Plugin
  öffnen“ (path of a plugin folder), list of the last 10 opened plugins.
- Workspace for one plugin:
  - file list of the plugin folder (create, rename, delete files, only names the
    part-1 allow-list accepts; dot entries and `node_modules` not shown);
  - Monaco editor (the editor of VS Code) with autocompletion for `ctx` (server files)
    and `ui` (client files) from a type description of the SDK;
  - Ctrl+S saves; DEMS (mock mode, only this plugin mounted, auto-enabled as in
    `plugin dev`) restarts and the preview reloads;
  - preview: DEMS in a frame next to the editor, persona switch (Admin, Mitglied,
    Neuling … — the dev mock personas);
  - debug panel under the preview: DMs and channel posts of the plugin rendered like
    Discord, requests to the plugin's routes (method, path, status, request and
    response body), hooks fired, `ctx.log` lines, errors with file and line;
  - hook buttons: „Event erstellen / veröffentlichen / beenden / absagen /
    löschen“ and „Check-in“ on a mock event, so `event.*` and
    `registration.checkedIn` can be tested without clicking through DEMS;
  - toolbar: „Prüfen“ (part-1 check: permissions + warnings), „Bauen“ (shows the
    `plugin.json` changes, after confirmation writes them and downloads
    `<id>-<version>.dems` through the browser's save dialog), „In VS Code öffnen“
    (`vscode://file/<abs folder>` link).

## Non-goals

- No full VS Code (code-server / openvscode-server): extensions, Git view, terminal.
- No hosted studio, no studio inside a production DEMS, no multi-user editing.
- No AI (part 3), no plugin store, no signing.
- No editing outside the opened plugin folder; no binary editing (assets are listed,
  uploaded/replaced by file picker, not edited).

## Anti-goals

- The studio must never run with `NODE_ENV=production`, never be reachable from
  another machine, and never let a web page the author happens to visit (or the plugin
  under development itself) write files through it.
- DEMS itself gets no route that writes files — not even in mock mode.
- The studio's code and Monaco must not end up in the production image.

## Constraints

- Node ≥ 22, no build step, no TypeScript toolchain. No new npm dependency. Monaco is
  vendored as pinned static files (MIT licence, licence file kept) under the studio
  folder; it is the one new third-party file set, justified by the owner's choice.
- DEMS CSP stays unchanged for DEMS itself; the studio page has its own CSP.
- German UI text, English code/comments/wiki; DEMS style tokens and components where
  the studio reuses DEMS CSS (the studio may have its own small stylesheet; no inline
  styles, no inline handlers — the studio's own CSP enforces the same rules).

## Approaches

**Where the studio runs** (decided with the owner in part 1): locally, with DEMS in
mock mode and the plugin really running — picked. Hosted studio rejected (no real
`server.js` preview).

**Where the files live** (decided): a normal folder on disk, opened by path, plus a list
of recently opened plugins — picked. Rejected: a studio-managed workspace under
`data/studio/` (hidden from VS Code/Git).

**Editor** (decided): Monaco plus a „In VS Code öffnen“ button — picked. Rejected:
full VS Code in the browser (huge separate server program, not embeddable next to the
preview); VS Code button only (no editor in the studio).

**Process layout** (decided): the studio is its own small Node process (the CLI) that
serves the studio page and the file API, runs DEMS mock as a child process and proxies
the preview — picked. Rejected: studio as a page inside DEMS (the server that serves
the editor restarts on every save; DEMS would get file-writing routes); studio on its
own port with DEMS in a second window (no preview next to the editor).

## Design

### Processes and ports

```
browser ── http://127.0.0.1:3100  studio page + /api (files, check, build, triggers, events)
   │                                 (studio process, never restarts)
   └─ <iframe> http://127.0.0.1:3101  preview proxy → DEMS child on 127.0.0.1:<random>
                                        (child restarts on save)
```

- `scripts/plugin.js studio [--port 3100]` refuses `NODE_ENV=production` and lazily
  requires `scripts/studio/` (absent in the image → the refusal comes first).
- Studio and preview are **two origins on purpose**: the plugin's client code runs in
  the preview frame and must not reach the studio's file API or the studio page's
  JavaScript. The preview proxy rewrites only the framing headers of proxied
  responses: CSP `frame-ancestors 'self' http://127.0.0.1:<studioPort>` and no
  `X-Frame-Options`; everything else passes unchanged (cookies, CSRF, redirects to
  the preview origin).
- DEMS child: `child_process.fork(dev/start.js)` with env `PLUGINS_DIR`/`PLUGINS_DEV_ID`
  exactly as `prepareDev` of part 1 builds them, plus `PORT=<random free port>`,
  `PLUGIN_STUDIO=1` and the site URL set to the preview origin. The studio watches the
  plugin folder itself (`fs.watch`, debounced ~300 ms) instead of nodemon and
  restarts the child; it reuses `prepareDev` for the mount.
- Opening another plugin stops the child, remounts and starts it again.

### Studio security

- Both servers listen on `127.0.0.1` only.
- Every studio request must carry a `Host` of `127.0.0.1:<port>` or
  `localhost:<port>` (DNS rebinding) — else 403.
- Studio API calls need the header `X-Studio-Token: <token>`: a random 32-byte token
  created at start, handed to the page once (start URL fragment → kept in memory by
  the page, not in a cookie, not in storage). Mutating calls also check `Origin` equals
  the studio origin.
- The file API resolves every path inside the opened plugin folder (`path.relative`
  must not start with `..`, no absolute paths, no links followed, names checked with
  `packageEntryError` of part 1 plus the skip rules of the build), size limits from
  `LIMITS`.
- The studio page CSP: `default-src 'self'; frame-src http://127.0.0.1:<previewPort>;
  worker-src 'self' blob:` (Monaco workers), no inline scripts or handlers. *(Builder
  check, my call:)* Monaco writes its theme and decorations into `<style>` elements at
  runtime, so the studio page gets `style-src 'self' 'nonce-<per page load>'` (nonce
  also handed to Monaco via its `csp-nonce` meta tag); if Monaco cannot use the nonce,
  `style-src 'self' 'unsafe-inline'` on the studio page only. This page shows no
  untrusted HTML (debug entries are escaped text), and DEMS's own CSP is untouched.
  Our own studio code still uses no inline styles.

### Debug events (DEMS child → studio)

Only when `PLUGIN_STUDIO=1` and mock mode and `process.send` exists, a small module
`dev/studioEvents.js` forwards events over the fork IPC channel; otherwise it is a
no-op. Events (plain JSON, bounded size, strings truncated at 10 kB):

| Type | Source | Payload |
|---|---|---|
| `dm` | `plugin-sdk/discord.js` `sendDM` (plugin id known there) | user (name, id), message (text, link, embeds as built for Discord), result: sent / dropped + German reason (bot settings, limit, opt-out) |
| `channel` | `plugin-sdk/discord.js` `sendChannelMessage` | channel key/name, message, result |
| `role` | `plugin-sdk/discord.js` role helpers | user, role, give/take, result |

*(Builder check, my call:)* the panel shows only the plugin's own Discord output. The
core sends DMs and announcements through the same mock bot (e.g. when a hook button
publishes an event), so emitting in the mock bot would flood the panel with output the
plugin did not send; and a plugin DM dropped by the bot settings would vanish without a
reason. Emitting in the SDK layer knows the plugin id and the drop reason.
| `request` | plugin router (`routes/` plugin API) | method, path, status, duration, request body, response body (JSON or truncated text) |
| `hook` | hook emitter (`plugin-sdk/hooks.js`) | hook name, plugin event summary, handler result/error |
| `log` | `ctx.log` | level, text |
| `error` | host `reportError` / register failure | message, file:line when known |
| `lifecycle` | host | plugin status changes (on, error, restart) |

The studio keeps the last 500 events in memory (cleared on „Leeren“ and on opening
another plugin) and streams them to the page with Server-Sent Events
(`GET /api/events`, token as query parameter for `EventSource`, which cannot send
headers — this one GET is read-only).

### Hook buttons

The studio process acts as the admin persona against the DEMS child (its own cookie
jar: dev login `/auth/dev-login/<admin persona>`, then CSRF token) and calls the
existing admin API: create an event (fixed mock data, title „Studio-Test“), set its
status (draft → active → archived / cancelled), delete it, add a registration for a
mock member and check it in. If an action has no existing API, it gets a route in
`dev/` mounted only in mock mode — never in `routes/`. The buttons work on the last
event the studio created; „Event erstellen“ creates a new one.

### Type description for autocompletion

`plugin-sdk/types/dems-plugin.d.ts` describes `ctx` (server) and `ui` (client) with
German JSDoc for each method, permission noted per method. The studio loads it into
Monaco as an extra lib: server files get `declare const ctx`-style context through
the `register(ctx)` parameter type (`/** @param {import('dems-plugin').Ctx} ctx */`
injected as an extra model, or Monaco's `addExtraLib` with a global hint — builder's
call). A test checks that every area and method the real `createContext` / client
`ui` exposes appears in the `.d.ts` and vice versa, so the description cannot drift.

### Studio page

Plain ES modules under `scripts/studio/public/` (no framework), reusing DEMS tokens
and Bootstrap from `public/vendor/` through the studio server (read-only static
mount) so it looks like DEMS. Layout:

```
┌ Plugin-Studio ─ mein-plugin 0.1.0   [Prüfen] [Bauen] [In VS Code öffnen] ┐
│ Dateien      │ server.js ×  client.js ×  │ Vorschau  Ansicht: [Admin ▾] ⟳  │
│  plugin.json │ 1 function register(ctx) {│ ┌─────────────────────────────┐ │
│  server.js ● │ 2   ctx.routes.get('/…',  │ │ DEMS                        │ │
│  client.js   │ …                         │ └─────────────────────────────┘ │
│  client.css  │                           │ Debug  [Alle▾] [Leeren]        │
│  assets/     │                           │ 12:01 DM → Mira  „Danke für…“  │
│  [+ Datei]   │                           │ 12:01 POST /feedback 201 12 ms │
│              │                           │ Hooks: [Erstellen][Veröff.]    │
│              │                           │  [Beenden][Absagen][Check-in]  │
└──────────────┴───────────────────────────┴────────────────────────────────┘
```

- Tabs for open files, `●` for unsaved; leaving with unsaved changes asks.
- „Prüfen“/„Bauen“ results in a dialog using the same German lines as the CLI
  (`+`, `?`, warnings, „übersprungen: …“).
- „Bauen“: preview of the `plugin.json` change → „Übernehmen und bauen“ → the studio
  writes `plugin.json`, packs, and answers the `.dems` as a download
  (`Content-Disposition: attachment; filename="<id>-<version>.dems"`); the browser's
  save dialog picks the place (with „Immer fragen, wo gespeichert wird“ off, it lands
  in the download folder — the dialog text says so).
- Recent list: stored by the studio process in the user's config folder
  (`%APPDATA%/dems-studio/recent.json`, `~/.config/dems-studio/recent.json`), last 10,
  missing folders shown greyed with „Entfernen“.
- While DEMS restarts, the preview shows „DEMS startet neu …“; a failed start shows
  the child's last error lines in the debug panel.

### Files and image

- `scripts/studio/` (server, proxy, file API, events, triggers) and
  `scripts/studio/public/` (page) and `scripts/studio/vendor/monaco/` (pinned).
  `.dockerignore` already excludes `scripts/` except `scripts/plugin.js`; a guard
  test checks the studio folder and Monaco stay out of the image.
- `dev/studioEvents.js` (in the image like all of `dev/`, inert without
  `PLUGIN_STUDIO=1` + mock mode + IPC).
- Hooks into `dev/mockBot.js`, the plugin router, `plugin-sdk/hooks.js`, `ctx.log` and
  the host are one-line calls to `studioEvents.emit(...)`.

### Tests

- Studio server: Host check, token check, Origin check, file API path confinement
  (`..`, absolute, link, refused names), size limits, recent list.
- Proxy: framing header rewrite only, cookies and redirects preserved, 502 page while
  the child restarts.
- Events: each emitter sends the documented shape only in studio mode; no-op otherwise;
  truncation.
- Triggers: against a real DEMS child in mock mode (like `test/devServer.test.js`):
  create → publish → end fires `event.ended` for a test plugin; check-in fires
  `registration.checkedIn`.
- `.d.ts` ↔ real API drift test.
- Studio page: pure render functions (debug entry rendering escapes everything,
  Discord-like DM rendering, check/build dialog lines) with the existing frontend test
  harness or plain DOM-free functions.
- E2E (Playwright, optional in CI): open studio, new plugin, edit, save, preview shows
  the page, build downloads a `.dems`.

### Docs

New wiki node `howto/plugin-studio.md` (start, layout, debug panel, hook buttons,
build, VS Code button, limits/security), links from `howto/write-plugin.md`,
`modules/dev-mock-mode.md` (studio events), `ops/configuration.md` (`PLUGIN_STUDIO`
internal), `index.md` tables; `npm run wiki`.

## Left to the builder

- Monaco version (current stable, pinned), which language workers to ship (JS, CSS,
  JSON at least), how the `.d.ts` is attached to `register(ctx)` / `register(ui)`.
- The proxy implementation (plain `http` module; streaming bodies), SSE details,
  debounce timing, restart backoff.
- Exact Discord-like rendering of DMs/posts (reuse the mock bot's payload shape).
- Mock data of the trigger event; how the admin cookie jar is kept.
- Splitting into tasks/commits.
