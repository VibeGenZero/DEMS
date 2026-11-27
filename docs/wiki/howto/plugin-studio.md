---
id: plugin-studio
title: How to use the plugin studio
type: howto
tags: [howto, plugins, plugin-sdk, studio, editor, debug, local, development, ai]
sources: [scripts/studio/, scripts/plugin.js, dev/studioEvents.js, dev/studioHost.js, plugin-sdk/studio.js, plugin-sdk/types/dems-plugin.d.ts, plugin-sdk/discord.js, test/studioActions.test.js, e2e/studio.spec.js, ai/providers/callSignal.js, scripts/studio/ai/, scripts/studio/public/ai.js, scripts/studio/public/ai-diff.js, scripts/studio/public/ai-settings.js]
depends_on: [write-plugin, plugin-sdk, dev-mock-mode]
see_also: [security, docker, run-and-debug, ai-integration]
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

## KI-Assistent

The „KI“ column (toggle „KI“ in the top bar; a tab next to the preview on narrow windows) chats with an AI about the open plugin and proposes file changes. It reuses `ai/` (see [ai-integration](../concepts/ai-integration.md)) with its own settings.

**Setup:** „KI-Einstellungen“ (gear in the top bar, or „KI einrichten“ in the empty column): provider (`openrouter`, `ollama`, `anthropic`, `openai`, `gemini`), model („Modelle laden“ lists them), „Verbindung testen“ works with the typed values. The base URL is prefilled per provider. Ollama has two presets: „Lokal“ `http://localhost:11434/v1` (no key) and „Cloud“ `https://ollama.com/v1` (key needed). „Maximale Antwortlänge“ (`maxTokens`, 1024–64000, default 8192) and „Kontextlänge“ (`contextTokens`, 8192–1000000, default 32768 for Ollama, else 128000) bound a request. Ollama's OpenAI endpoint cannot set the context per request, so set the context length in Ollama itself (`OLLAMA_CONTEXT_LENGTH`) to at least the „Kontextlänge“ value, otherwise Ollama cuts off the SDK knowledge.

**Where the settings live:** `ai.json` in the studio config folder next to `recent.json` (file mode `0600` where the OS supports it). The key stays there: it is never sent to the page (only `apiKeySet`), a save that changes provider or base URL without a new key drops it, and the studio never reads `AI_*` from the environment.

**What goes to the provider:** the system prompt (rules, `scripts/studio/ai/sdk-guide.md`, `plugin-sdk/types/dems-plugin.d.ts`), the plugin's text files (at most 200 kB in total, larger files by name only; unsaved editor tabs win over the disk copy, `node_modules`, dot entries and binaries are skipped), the last 10 turns of the chat and, on „Fehler an KI schicken“, up to 20 recent errors. The input budget is `contextTokens − maxTokens`; what does not fit is cut (old turns, then large closed files, then errors) and the chat says so. The page sends nothing before you press „Senden“ (Enter; Umschalt+Enter is a new line).

**Proposal, diff, apply, undo:** the AI answers with explanation text and complete file blocks; the chat shows „<n> Datei(en) geändert“. Nothing is written until „Übernehmen“. „Ansehen“ opens a diff per file (new files against empty). „Übernehmen“ writes through the file API, reloads open tabs and offers „Rückgängig“ (last apply only: replaced files come back, created files are removed). Unsaved tabs the AI worked on can be saved with it („mit speichern“); a file that changed since the proposal (on disk or typed in its tab) is not overwritten: you skip it or cancel. Opening another plugin clears proposal, undo and chat.

**Repair round:** the studio checks a proposal in memory (paths and sizes, `plugin.json`, JS syntax, permissions and `sdk` via the permission scan). Problems new with the proposal trigger exactly one repair request to the AI; what still fails is shown with the diff, and problems that existed before are marked „bestand schon vorher“.

**Limits:** one chat request at a time (a second one gets „Die KI arbeitet noch.“), messages up to 4000 characters, a request that stays silent for 120 s is aborted (`idleTimeoutMs`), „Stopp“ aborts it. The address guard of `ai/` stays on. The studio only proposes files inside the plugin folder; the AI never runs code.

## Limits and security model

- Local only: both servers listen on `127.0.0.1`; requests need `Host` `127.0.0.1:<port>` or `localhost:<port>`. The DEMS child also listens on `127.0.0.1` only and answers only its preview origin and its own port (`dev/studioHost.js`).
- The start link carries a random token (32 bytes) in the URL fragment; the page keeps it in memory and sends it as `X-Studio-Token`, mutating calls also check `Origin`. After a reload the fragment is gone, so open the start link again (the CLI printed it).
- The preview is served by a proxy on its own port (studio port + 1), so the preview and the studio are different origins. The proxy rewrites only framing headers and redirects: it drops `X-Frame-Options`, sets `frame-ancestors 'self'` plus both studio origins (`http://127.0.0.1:<port>`, `http://localhost:<port>`; appended to a CSP without it) and points a `Location` at the child to the preview origin. The frame is sandboxed without `allow-top-navigation`, so plugin code cannot navigate the studio page away. The DEMS child gets a random port.
- Refused with `NODE_ENV=production`. `scripts/studio/` is not part of the Docker image; the studio is a development tool, not something to run on a server.
- DEMS itself has no route that writes files for the studio.

Tests: `test/studio*.test.js` (units), `e2e/studio.spec.js` (browser smoke test with a real DEMS child: create a plugin, grant `events:read`, change the open `server.js` on disk and see the editor reload it, check the SDK type file has no language-service problems, register an `event.created` hook in the editor and save, see the preview restart and the real app come back, fire „Event erstellen" and find „Hook event.created · ok“ in the debug panel, download `e2e-demo-0.1.0.dems`; a second test starts a fake provider on `127.0.0.1` with its own `ai.json`, chats, views the diff, applies and undoes a one-file proposal and expects no CSP violation; both use temp folders and `prepareDev`'s `devPluginsDir`, so it never touches `data/dev-plugins`).
