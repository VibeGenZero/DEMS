---
id: plugin-studio
title: How to use the plugin studio
type: howto
tags: [howto, plugins, plugin-sdk, studio, editor, debug, local, development]
sources: [scripts/studio/, scripts/plugin.js, dev/studioEvents.js, dev/studioHost.js, plugin-sdk/studio.js, plugin-sdk/types/dems-plugin.d.ts, plugin-sdk/discord.js, test/studioActions.test.js, e2e/studio.spec.js]
depends_on: [write-plugin, plugin-sdk, dev-mock-mode]
see_also: [security, docker, run-and-debug]
---
# How to use the plugin studio

> TL;DR: `npm run plugin -- studio [--port 3100]` starts a local web tool (Monaco editor, live DEMS preview, debug panel, hook buttons, build download) for one plugin folder. It opens your browser on the start link `http://127.0.0.1:<port>/#token=<hex>`; the token is the only key, so a reload needs that link again. Local only, never in production or in the Docker image.

Background: [write-plugin](write-plugin.md) (the plugin itself), [plugin-sdk](../concepts/plugin-sdk.md) (lifecycle, hooks), [dev-mock-mode](../modules/dev-mock-mode.md) (the DEMS the preview runs).

## Start

`npm run plugin:studio` (short for `npm run plugin -- studio`; a port goes as `npm run plugin:studio -- --port <n>`, default 3100). The CLI prints the start link and opens the default browser. The start page offers „Neues Plugin“ (id and parent folder, same scaffold as `plugin new`; the parent folder must exist), „Plugin öffnen“ (full folder path; official plugins are refused with „Offizielle Plugins entwickelst du direkt mit npm run dev:mock.“) and the last 10 opened plugins (stored in `%APPDATA%/dems-studio/recent.json`, else `$XDG_CONFIG_HOME` or `~/.config/dems-studio/recent.json`; folders that are gone are greyed with „Entfernen“). Ctrl+C stops the studio and the DEMS child.

Opening a plugin starts a DEMS child in mock mode on a random free port with exactly this plugin mounted (like `plugin dev`: a link under `data/dev-plugins/`). Any change in the plugin folder restarts the child — a save in the studio, an upload, „Bauen“ writing `plugin.json`, an edit in another editor (dot entries and `node_modules` aside); the preview shows „DEMS startet neu …“ meanwhile.

The child uses the shared dev database (`data/dems.dev.sqlite`, or `DEV_SQLITE_PATH`) like `npm run dev:mock`, so data from earlier sessions stays, e.g. the „Studio-Test“ events of the hook buttons pile up; `npm run dev:reset` clears them.

## Layout

- Top bar: plugin name and version, „Prüfen“, „Bauen“, „In VS Code öffnen“, „Plugin wechseln“.
- Left: file list (new file, upload, rename, delete). Middle: Monaco with a tab per open file (`●` = unsaved, Ctrl+S saves; leaving with unsaved changes asks). Autocompletion and hover for `ctx` and `ui` come from `plugin-sdk/types/dems-plugin.d.ts`.
- Right: the preview (DEMS in a frame, logged in as the persona „Ansicht als“ shows — Admin at the start, then Lena / Tom / Neo —, reload), the hook buttons and the debug panel.

Open tabs follow the disk: after a change in the folder the file list refreshes, a tab without unsaved edits reloads the new content, a tab with unsaved edits gets a warning sign („Auf der Platte geändert“). Saving sends the state the tab was loaded from (`baseHash`, sha256); when the file changed on disk since, the studio does not write it and asks: „Neu laden“ (drop the edits, load the disk), „Überschreiben“ (save over it) or „Abbrechen“.

The file API stays inside the plugin folder: no links, only names the package accepts, sizes within the package limits.

## Debug panel

Shows what only your plugin did, newest last (last 500 entries, texts cut at 10 kB), filterable, with „Leeren“:

- Discord output of the plugin (`ctx.discord`): DMs, channel posts, role changes, and messages that were dropped with the German reason (nothing is really sent in mock mode).
- `ctx.log` lines, requests to the plugin's routes (method, path, status, time, bodies), hook runs, errors with `file:line` inside the plugin (register failures incl. syntax errors, route errors, failed hooks) and plugin status changes as „Plugin-Status: An / Aus / Fehler / Bestätigung nötig / Neustart nötig“. The DEMS child's own start/stop only drives the preview overlay.

Other DEMS output is not shown. The events come from `dev/studioEvents.js` over the fork channel and exist only with `PLUGIN_STUDIO=1` in mock mode.

## Hook buttons

„Event erstellen“, „Veröffentlichen“, „Beenden“, „Absagen“, „Löschen“ and „Check-in“ trigger the matching core hook in the running child, so a plugin that listens to `event.created` and so on can be tried without clicking through the admin area. The hook runs and their result appear in the debug panel; a toast reports success or failure.

## Build download

„Prüfen“ shows the same lines as `plugin check`. „Bauen“ first shows what the package would contain and the `plugin.json` change (permissions, `sdk`). It packs the folder on disk: with unsaved tabs the dialog says „<n> ungespeicherte Datei(en) – gebaut wird der Stand auf der Platte.“ and offers „Alle speichern und bauen“. „Übernehmen und bauen“ writes `plugin.json` (an open clean `plugin.json` tab reloads), packs and downloads `<id>-<version>.dems` through the browser. Where it lands is the browser's choice (download folder or save dialog). Install it as described in [write-plugin](write-plugin.md).

## VS Code button

„In VS Code öffnen“ opens the plugin folder through a `vscode://file/<folder>` link; the studio only follows links of that form. Without VS Code nothing happens besides a possible browser prompt.

## Limits and security model

- Local only: both servers listen on `127.0.0.1`; requests need `Host` `127.0.0.1:<port>` or `localhost:<port>`. The DEMS child also listens on `127.0.0.1` only and answers only its preview origin and its own port (`dev/studioHost.js`).
- The start link carries a random token (32 bytes) in the URL fragment; the page keeps it in memory and sends it as `X-Studio-Token`, mutating calls also check `Origin`. After a reload the fragment is gone, so open the start link again (the CLI printed it).
- The preview is served by a proxy on its own port (studio port + 1), so the preview and the studio are different origins. The proxy rewrites only framing headers and redirects: it drops `X-Frame-Options`, sets `frame-ancestors 'self'` plus both studio origins (`http://127.0.0.1:<port>`, `http://localhost:<port>`; appended to a CSP without it) and points a `Location` at the child to the preview origin. The frame is sandboxed without `allow-top-navigation`, so plugin code cannot navigate the studio page away. The DEMS child gets a random port.
- Refused with `NODE_ENV=production`. `scripts/studio/` is not part of the Docker image; the studio is a development tool, not something to run on a server.
- DEMS itself has no route that writes files for the studio.

Tests: `test/studio*.test.js` (units), `e2e/studio.spec.js` (browser smoke test with a real DEMS child: create a plugin, grant `events:read`, change the open `server.js` on disk and see the editor reload it, check the SDK type file has no language-service problems, register an `event.created` hook in the editor and save, see the preview restart and the real app come back, fire „Event erstellen" and find „Hook event.created · ok“ in the debug panel, download `e2e-demo-0.1.0.dems`; it uses temp folders and `prepareDev`'s `devPluginsDir`, so it never touches `data/dev-plugins`).
