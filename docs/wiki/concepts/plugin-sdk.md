---
id: plugin-sdk
title: Plugin SDK — architecture, lifecycle, security model
type: concept
tags: [plugins, plugin-sdk, extensions, ctx, ui, hooks, permissions, trust, privacy, safe-mode, sdk-1]
sources: [plugin-sdk, plugins/event-submissions, plugins/custom-design, routes/plugins.js, routes/pluginStatic.js, routes/pluginTheme.js, routes/adminPlugins.js, public/design-boot.js, public/js/core/plugins.js, public/js/core/pluginTheme.js, public/js/core/passwordDialog.js, public/js/admin/system-plugins.js, routes/user.js, server.js, test/pluginClientGuards.test.js, docs/superpowers/specs/2026-11-19-plugin-sdk-design.md, docs/superpowers/specs/2026-11-20-custom-design-plugin-design.md]
depends_on: [server, data-layer]
see_also: [write-plugin, security, frontend-app, bot, data-model, api-index, event-lifecycle]
---
# Plugin SDK — architecture, lifecycle, security model

> TL;DR: A plugin is one folder with a `plugin.json` (+ optional `server.js`, `client.js`, `client.css`, `assets/`). Official plugins come from `<app>/plugins` (shipped in the image, chip „Offiziell“), custom ones from `PLUGINS_DIR` (default `data/plugins`, on the volume). Plugins run **in the DEMS process without a sandbox**, but reach DEMS only through a permission-checking `ctx` (server) and `ui` (browser) with plain-data in/out, so isolation can be added later. `plugin-sdk/host.js` discovers, validates and loads them at startup (`register(ctx)` with 5 s timeout), admins switch them in System › Plugins (custom: trust dialog + reset password + audit log), `PLUGINS_SAFE_MODE=true` runs no plugin code (plugins can then only be switched off). SDK 1.0 = routes, own data (reserved `userId` → purged on account deletion), settings, seven hooks, rate-limited DMs/channel posts, a tab page, the event editor prefilled with an origin. Writing one: [write-plugin](../howto/write-plugin.md).

Spec: [2026-11-19-plugin-sdk-design](../../superpowers/specs/2026-11-19-plugin-sdk-design.md) (#155). Where this page and the spec differ, this page follows the code.

## Architecture

| Part | File | Does |
|---|---|---|
| entry | `plugin-sdk/index.js` | `initPlugins(options)` (once, in `server.js` after migrations, system config and AI settings, before `listen`; a failure never blocks the start), `pluginHost()` for routes |
| manifest | `plugin-sdk/manifest.js` | `validateManifest(raw, folder, { fileExists })`, `PERMISSIONS` (with German labels), `SETTING_TYPES`, `SDK_VERSION = 1` |
| discovery | `plugin-sdk/discovery.js` | `discoverPlugins({ officialDir, customDir })`: every sub-folder with `plugin.json`; official first; a custom folder with an official id → „Ungültig: Die ID gehört einem offiziellen Plugin.“ |
| host | `plugin-sdk/host.js` | lifecycle, on/off, admin views (`views.js`), settings validation, data delete, `purgeUser`, `wipeAllData`, `reportError`; one write chain per plugin (state writes are read-merge-write) |
| state | `plugin-sdk/state.js` | `pluginState/<id>` and `pluginSettings/<id>` (see [data-model](data-model.md)) |
| ctx | `plugin-sdk/context.js`, `data.js`, `discord.js`, `theme.js`, `themeCss.js` | the server API, built once per plugin (a fresh one only for a retry after a failed `register`); `theme.js` + `themeCss.js` store allow-list-filtered CSS in `pluginThemes` |
| hooks | `plugin-sdk/hooks.js`, `plugin-sdk/coreHooks.js` | per-plugin queues; the core's emit helpers (`safeEmit`, `emitEventCreated`, …) and the `pluginOrigin` check |
| errors | `plugin-sdk/errors.js` | `PluginPermissionError`, `PluginDataError`, `PluginHttpError` (`ctx.httpError`), `PluginHostError` (German messages) |
| API | `routes/plugins.js` | `GET /api/plugins` (client list) + dispatcher `/api/plugins/<id>/…` (on/off checked per request; optional `password: true` admin reset password guard; a handler that has not answered after 30 s → 504 „Das Plugin hat nicht rechtzeitig geantwortet.“ + `lastError`, its late result is dropped) |
| theme CSS | `routes/pluginTheme.js`, `public/design-boot.js`, `public/js/core/pluginTheme.js` | `GET /theme.css` (public, ETag + `no-cache`) and `GET /theme-preview.css` (admin only, `no-store`) linked as `#custom-theme` in `<head>`, escape hatch `?design=standard` in `design-boot.js`, `ui.theme` + `#design-preview-bar` |
| files | `routes/pluginStatic.js` | `/plugins/<id>/client.js`, `client.css`, `assets/<name>` of switched-on plugins only |
| admin API | `routes/adminPlugins.js` | `GET /api/admin/plugins`, `PUT …/:id/enabled`, `PUT …/:id/settings`, `DELETE …/:id/data` — see [routes-admin](../modules/routes-admin.md) |
| browser | `public/js/core/plugins.js`, `public/js/core/passwordDialog.js` | `loadPlugins()` (after the privacy consent), the `ui` object, pages at `#p/<id>`, navbar tabs, core reset password dialog `#passwordModal` — see [frontend-app](../modules/frontend-app.md) |
| admin UI | `public/js/admin/system-plugins.js` | System › Plugins (cards, switch, trust dialog `#pluginTrustModal`, settings, „Daten löschen“) |
| reference plugins | `plugins/event-submissions/`, `plugins/custom-design/` | „Event einreichen“ and „Design anpassen“ (official) |

```mermaid
flowchart LR
  Disk[["plugins/ + PLUGINS_DIR"]] --> Discovery --> Host
  State[("pluginState, pluginSettings")] --> Host
  Host -->|"register(ctx)"| Server["plugin server.js"]
  Server -->|"ctx.routes"| Dispatcher["/api/plugins/<id>/…"]
  Server -->|"ctx.hooks"| Hooks
  Core["routes/admin.js, routes/user.js, bot/"] -->|"after the write"| Hooks
  Server -->|"ctx.data"| Data[("plugin:<id>:<coll>")]
  Server -->|"ctx.discord"| Bot["sendAutomaticDM, bot.sendPluginChannelMessage"]
  SPA["core/plugins.js"] -->|"import /plugins/<id>/client.js"| Client["plugin client.js"]
  Client -->|"ui.api"| Dispatcher
```

## Lifecycle

| Situation | What happens |
|---|---|
| start | discover both folders, read `pluginState`; only plugins that are **on and confirmed** get their `server.js` required; `register(ctx)` must settle within 5 s — a throw/timeout → status „Fehler: …“, `lastError` stored, plugin off, DEMS continues |
| switch on (admin) | official: at once; custom: needs `trust: true` + reset password and stores `confirmedVersion`/`confirmedPermissions`. First use requires + registers; switching on again reuses the first registration (Node cannot unload a module); after a failed `register` it retries with a fresh `ctx` and clears the old error |
| switch off | routes answer 404 `Plugin nicht gefunden.`, hooks are skipped (gate checked right before each handler), client no longer listed or served, `ctx.onDisable` callbacks run (2 s each); data and settings stay |
| custom plugin changed on disk | `version` ≠ `confirmedVersion` or a permission not in `confirmedPermissions` → starts off with „Bestätigung nötig“ until switched on again. Official plugins skip this check |
| new folder / new code | discovery and `require` happen only at start: restart DEMS after adding or changing a plugin |
| image update brings a new official plugin | starts off (no state) |
| dev mock mode | an official plugin without state is switched on and stored at start |
| `PLUGINS_SAFE_MODE=true` | no plugin code runs; every card shows „Abgesicherter Modus aktiv“, `/api/plugins` `[]`, routes and files 404; switching **on** is refused (409 „Abgesicherter Modus aktiv – Plugins lassen sich nicht einschalten.“), switching **off** works (stores `enabled: false`, audit `PLUGIN_DISABLE`, runs no plugin code) — only the switch of a plugin stored on is enabled (the view's `enabled`). Recovery from a plugin that breaks the start: restart with `PLUGINS_SAFE_MODE=true`, switch the broken plugin off in System › Plugins, remove the line, restart |
| folder gone | the state entry (or its collections) stays as card „Verwaist“: no switch, no settings, „Daten löschen“ also removes the state entry |

Status chips (`plugin-sdk/views.js`): `off` Aus, `on` An, `error` Fehler: …, `confirm` Bestätigung nötig, `invalid` Ungültig: <Grund>, `incompatible` Inkompatibel (SDK <n>), `orphaned` Verwaist, `safe` Abgesicherter Modus aktiv. A runtime error (route 500, hook throw) keeps the plugin on and shows `lastError` + time as a warning line; the message limit shows „Nachrichtengrenze erreicht (bis HH:MM)“.

## Permissions (SDK 1)

A missing permission throws `PluginPermissionError` („Dem Plugin fehlt die Berechtigung „…“.“). In-process this is a guard rail, not a wall.

| Permission | Allows | Shown as |
|---|---|---|
| `events:read` | `ctx.events.get/list`, the six `event.*` hooks | „Events lesen“ |
| `events:draft` | `ui.openEventEditor` with an origin; `pluginOrigin` accepted on create | „Events für das Team vorbereiten“ |
| `members:read` | `ctx.members.get` | „Mitgliedernamen und Avatare lesen“ |
| `discord:dm` | `ctx.discord.sendDM` | „Direktnachrichten über den Bot senden“ |
| `discord:channel` | `ctx.discord.sendChannelMessage` | „Nachrichten in Discord-Kanäle posten“ |
| `theme` | `ctx.theme.saveDraft/discardDraft/publish/clear`, `ui.theme.showPreview/hidePreview/reload/isStandardMode` | „Aussehen der ganzen Seite ändern“ |
| `network` | nothing in `ctx`; declares internet access | „Verbindungen ins Internet aufbauen“ |

Routes, own data, own settings, `member.deleted`, the page/tab, `ctx.audit` and `ctx.log` need no permission. Not in SDK 1.0 (planned 1.1): Discord commands/buttons/modals, `ctx.schedule`, event page panel, registration and check-in hooks.

## Hooks

Emitted by the core **after** the write is committed, never awaited by the request; each plugin has its own promise chain (handlers run in emission order, one slow plugin never delays another), each handler gets its own `structuredClone` of the payload, runs in `try/catch` (error → log + `lastError`), > 10 s logs a warning, after 30 s it counts as failed („Hook <name> hat nicht innerhalb von 30 s geantwortet.“ → log + `lastError`) and the plugin's queue goes on — the handler cannot be stopped and keeps running in the background. A plugin registers at most 20 handlers per hook (`MAX_HANDLERS_PER_HOOK`; the 21st makes `register` fail), which bounds the synchronous copies one emission makes. Event payloads: public event shape (`toPublicEvent`, no `checkinCode`) + `origin`.

| Hook | Payload | Emitted by (pinned by `test/pluginHookEmission.test.js`) |
|---|---|---|
| `event.created` | `{ event }` | create (each series date, also `fromPoll`), duplicate, series extension, Discord `/event erstellen` |
| `event.published` | `{ event }` | status becomes `active` from `draft` or new (create as active, `PUT …/status`, `PUT …/:id`, `POST …/start`, Discord draft buttons) |
| `event.updated` | `{ event, changed }` | `PUT …/:id` when a field (other than `updatedAt`) changed |
| `event.ended` | `{ event }` | status becomes `archived` (`POST …/end`, `PUT …/status`, `PUT …/:id`, auto-archive) |
| `event.cancelled` | `{ event }` | status becomes `cancelled` (`PUT …/cancel`, `PUT …/status`, `PUT …/:id`) |
| `event.deleted` | `{ eventId, origin }` | `DELETE …/:id`, series delete (per date) |
| `member.deleted` | `{ userId }` | `DELETE /api/user/account`, after the core purge; reaches every switched-on plugin |

A new event counts as coming from `draft`, a stored one without status as `active` (ruling R6). The admin system reset emits no hooks. Details per code path: [event-lifecycle](event-lifecycle.md#plugin-hooks).

## Security model

1. **Two trust levels.** Official = reviewed in the repo, shipped with the image. Custom = full process access (files, database, bot token, `require` of anything, including `plugin-sdk/state` — so an enabled custom plugin can also mark other plugins as confirmed) and its `client.js`/`client.css` run unsandboxed in every logged-in member's page (CSRF token and session included, an admin's page with admin rights); the trust dialog says both. The permission list is a declaration for official plugins and a guard rail for honest custom ones, never a wall.
2. **Code only via the server's file system.** No upload, no URL install, no route writes into `PLUGINS_DIR` — a hijacked admin session cannot bring code onto the host.
3. **„Offiziell“ comes from the location** (`<app>/plugins`), never from the manifest.
4. **Custom: trust + reset password + audit** (`PLUGIN_ENABLE`); re-confirmation when version or permissions change; an unset `ADMIN_RESET_PASSWORD` makes switching on impossible.
5. **Disabled code never runs** — no `require` of a plugin that is off or unconfirmed.
6. **Plain-data boundary.** `ctx` and `ui` pass only JSON-able copies (no `req`, `res`, Discord objects, DB handles); official plugins import nothing from DEMS (guard test) → a later out-of-process / iframe isolation can sit behind the same API.
7. **API.** Every route declares `access` (`member`/`admin`, no default); session, CSRF, rate limits, setup/privacy/maintenance gates apply as for core routes; the user comes from the session only.
8. **Data.** Own namespace `plugin:<id>:<coll>` per plugin; events only in the public shape; no raw DB.
9. **Discord.** `allowedMentions: { parse: [] }` always; DMs only to members with a `users` document and through the bot center's DM switch (`sendAutomaticDM`); channel posts only into the channel of one of the plugin's own `channel` settings; ≤ 200 DMs and ≤ 30 posts per plugin per sliding 10 minutes (in memory); link buttons only to `<BASE_URL>/#…`.
10. **Member data.** Reserved field `userId` → account deletion purges it in every plugin (on, off, orphaned) without relying on the author; system reset target `pluginData` (and `users`) wipes all plugin data and settings, `pluginState` stays.
11. **Failure isolation.** Every plugin call is wrapped and gets a timeout: `register` 5 s, `onDisable` 2 s, each hook handler 30 s, each route handler 30 s. Known limit: a synchronous endless loop blocks the whole process ([known-issues](../reference/known-issues.md)).
12. **Static files.** Allow-list (`client.js`, `client.css`, `assets/<name>.{js,css,png,jpg,jpeg,webp,gif,json,woff2}`), no HTML/SVG, no listing, traversal and symlink escapes refused, `nosniff`.
13. **Dependencies.** Official plugins use only Node built-ins and their own files (no `node_modules`, guard test). Custom plugins may bring their own — the operator's risk.
14. **Themes (`theme` permission) — who guarantees what.** `ctx.theme` stores filtered stylesheets in the core-owned collection `pluginThemes/<id>` (unreachable via `ctx.data`). Every stylesheet is checked by `checkThemeCss` (`plugin-sdk/themeCss.js`: ≤ 50 000 characters, no backslashes, balanced `{}`/`()`, only allow-listed functions and at-rules — `url()`, `@import`, `@font-face` refused; a comment does not exempt the name after it, since `center/**/image-set(` is a real `image-set()` for the browser) both when saved and **again when served** by `GET /theme.css` and `GET /theme-preview.css`, so the SDK guarantees no plugin theme can make the browser load external resources even though the CSP has `img-src https:`. Because `ctx.theme` is not request-bound, **password checks and audit logging are the plugin's responsibility**, using the SDK's `password: true` route option (checked by `routes/plugins.js` against `ADMIN_RESET_PASSWORD` with `safeEqual` and stripped from `req.body` before the handler runs; prompted in the browser by `#passwordModal` via `ui.api.<method>(path, body, { password: true })`) and `ctx.audit`. `?design=standard` in the query or hash disables `#custom-theme` before the first paint (`public/design-boot.js`), and `PLUGINS_SAFE_MODE=true` serves an empty `/theme.css`.

Admin-side rules (reset password for secrets, audit actions, secrets only as `{ set }`): [security](security.md).

## Data and privacy

- Documents: `ctx.data` → collection `plugin:<id>:<coll>`; the host records each used `coll` in `pluginState/<id>.collections` before the first write, so purge and „Daten löschen“ find it.
- Settings: `pluginSettings/<id>` `{ values }`; secrets are readable only through `ctx.settings.get()` on the server.
- System › Plugins shows above the list: „Plugins können Daten von Mitgliedern speichern. Erwähne eingeschaltete Plugins in deiner Datenschutzerklärung.“ DEMS writes no privacy text for plugins; the operator must.

## Limits (SDK 1)

| What | Limit |
|---|---|
| `register(ctx)` / each `onDisable` | 5 s / 2 s |
| slow hook warning / hook timeout | 10 s / 30 s (then the queue goes on; the handler keeps running) |
| route handler | 30 s, then 504 |
| handlers per hook | 20 per plugin |
| DMs / channel posts | 200 / 30 per plugin per 10 min; text 1–2000, link label 1–80, link URL ≤ 512 |
| route path | starts with `/`, ≤ 200 characters, no `*`, `?`, `#` or whitespace; same method + path twice → `register` fails |
| collection name / doc id | `^[a-z][a-zA-Z0-9]{0,31}$` / 1–128 characters without `/` |
| setting value (text types) | ≤ 4000 characters |
| origin `ref` | 1–100 characters |
| client page / tab | one page per plugin, tab label ≤ 30 |

## Where the code differs from the spec

- Files live in `plugin-sdk/` (not `plugins/loader.js` / `utils/pluginHooks.js`); `plugins/` holds only plugins.
- `ctx.events.get/list` return events of **every** status (drafts included) in the public shape + `origin` — server code the admin enabled.
- `ctx.routes.*` and `ctx.hooks.on` work only while `register()` runs; later calls throw.
- A grown permission list of an official plugin is not marked in the list (it just keeps running).
- The prefill of `ui.openEventEditor` uses the editor's draft fields (`startDate`, not `start`).
- „Event einreichen“ rejects with an inline form (ruling R10), not a dialog.
- A route handler returning `undefined` answers `{ success: true }`.
