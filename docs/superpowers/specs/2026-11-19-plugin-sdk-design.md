# Plugin SDK: official and custom plugins, test plugin "Event einreichen" (3.4.0)

## Intent

DEMS keeps growing feature by feature in the core. The owner wants a **plugin SDK** so
new features — "viele coole Plugins" — can be added without touching the core: own
tabs, own API, own data, Discord messages. Later, **other people** should be able to
write plugins too.

**Security comes first.** The SDK must say honestly what a plugin can do, must not let a
plugin get in through the browser, and must be cut so that real isolation can be added
later without rewriting the plugins.

The first plugin, which proves the SDK, is **"Event einreichen"**: every member can
submit an event idea in a new tab, admins see the ideas, take one over straight into the
event editor or reject it, and the bot tells the member by DM: "Dein Event wurde
eingetragen" or "Dein Event-Vorschlag wurde abgelehnt".

GitHub issue: #155 (Plugin-SDK). Related idea: #156 (Custom-CSS-Editor, possibly a
later plugin).

## Decided by the owner

- **Trust model C:** plugins run **inside the DEMS process** for now (no sandbox), but
  reach DEMS **only through a `ctx` object** that checks their permissions — never by
  `require`-ing DEMS files. The API is cut so a later out-of-process isolation can sit
  behind the same `ctx` without changing plugins.
- **Two kinds of plugins:**
  - **Official plugins** live in the repo, ship with every image, are marked
    **„Offiziell“** and can always be switched on and off.
  - **Custom plugins** can be installed by the operator, but **with a warning first**.
- **Frontend approach A:** a plugin ships its own ES module (`client.js`) served from
  the DEMS origin; it gets a `ui` object (tabs, actions, API calls, helpers). Rule:
  plugins use only `ui` and never reach into the DOM of core pages, so `ui` can later be
  backed by a sandboxed iframe bridge.
- **Test plugin "Event einreichen"** as described in [Test plugin](#test-plugin-event-einreichen),
  incl. the two DMs.
- The owner accepted these proposals in the conversation (they were Claude's proposals,
  confirmed with "passt so"):
  - custom plugins only via the server's file system (volume), **no upload in the
    browser**; the admin area only switches them on and off;
  - switching a custom plugin on needs the **reset password** and lands in the audit
    log; the warning says plainly that the plugin has full access;
  - "off" means completely off (routes 404, hooks silent, tab gone, Discord commands
    gone); data stays until an admin deletes it;
  - no plugin may push another one aside (same id, routes or commands → refused);
  - the list of extension points below, derived from four example plugins
    (Event einreichen, Raid-Punkte, Event-Feedback, Stream-Ankündigung).
- After the builder check the owner decided ("beide so nehmen"):
  - **Member data is purged automatically.** Plugin documents carry the member in the
    reserved field `userId`; deleting an account deletes every plugin document with
    that `userId`, and the hook `member.deleted` lets a plugin clean up the rest. The
    admin system reset deletes all plugin data. A plugin whose folder disappeared
    stays in the list as „Verwaist“ so its data can still be deleted.
  - **Plugin messages are limited:** DMs only to members DEMS knows (`users`),
    channel posts only to channels an admin picked in that plugin's own `channel`
    settings, and at most **200 DMs and 30 channel posts per plugin per 10 minutes**
    (beyond: nothing sent, `false`, log line, warning in the plugin list).

## Goals

1. A plugin is one folder with a manifest; DEMS finds, validates and loads it.
2. Admins see every plugin in **System › Plugins** with its origin (official / not
   official), version, description, requested permissions, status and a switch.
3. Plugins can add: API routes, own data, settings (rendered by DEMS), hooks on core
   events, DMs and channel messages, a tab with its own page, and can open the event
   editor prefilled.
4. A crashing or misbehaving plugin never takes the core down: errors are caught,
   logged and shown as the plugin's status.
5. "Event einreichen" works end to end on the website, in dev mock mode and with the
   real bot, and is the reference for plugin authors.
6. A plugin author can write a plugin from the wiki how-to alone.

## Non-goals (3.4.0)

- No marketplace, no download from a URL, no upload in the browser.
- No real sandbox (no separate process, no iframe origin) — prepared, not built.
- Plugins cannot replace or change core pages, core API answers or core behaviour
  (no "before" hooks, no veto).
- No theming / custom CSS for the whole app (#156 stays an idea).
- SDK 1.1 (see [Delivery](#delivery)): Discord slash commands, buttons and modals,
  scheduled jobs, a panel on the event page, registration and check-in hooks. The
  `ctx`/`ui` shapes for them are named here so 1.0 does not block them.

## Anti-goals (a failure even if it technically works)

- An operator believes a custom plugin is sandboxed when it is not.
- The „Offiziell“ badge can be faked by a plugin.
- A plugin silently gets more rights after an update.
- A stolen admin session (or someone who was given the Discord admin role) can bring
  new code onto the server.
- A plugin can break or noticeably slow down registrations, events or the bot.
- Members get pinged or spammed through a plugin (`@everyone`, role pings, DM floods).
- A plugin leaks secrets that the core keeps private (`checkinCode`, session, tokens
  in answers).

## Constraints from the project

- Data only through `firebaseAdmin.js` (Firestore-style API); dates ISO strings; filter
  and sort in memory; no `limit`.
- CSP: scripts, styles and fonts only from `'self'`; no inline scripts, handlers or
  styles; actions via `data-click`/`data-change`/`data-input` + `registerActions`;
  colours etc. only as tokens; Bootstrap Icons, no emojis in UI.
- CSRF header on every mutating `/api/*` request; `requireAuth` / `requireAdmin`
  explicit; admin mutations call `addAuditLog`.
- All user-facing text German; code, comments, wiki English.
- Discord calls through helpers exported by `bot.js` with a mock twin in
  `dev/mockBot.js`; links to events only via `buildEventUrl`.
- Event fields must be whitelisted in `POST /events` (and `PUT /events/:id` where they
  may change) — trap 3.
- No new dependencies without a clear reason (the SDK needs none).
- The image already copies the whole repo (`COPY . .`) and mounts the volume
  `/app/data`; the process runs as user `node`.

## Approaches

### Trust model

| | How | Trade-off |
|---|---|---|
| A | Only trusted plugins in the repo, plain in-process code with a nice API | fastest; no path to third-party plugins |
| B | Third-party plugins with real isolation: own process per plugin, frontend in a sandboxed iframe on a second origin, signatures | the right end state for untrusted code; many times the work, every operator needs a second domain |
| **C (chosen)** | In-process like A, but everything goes through a permission-checking `ctx` with serialisable inputs and outputs | fast now; isolation can be added behind `ctx` later; honest warning needed meanwhile |

### Plugin frontend

| | How | Trade-off |
|---|---|---|
| **A (chosen)** | Plugin ships `client.js`, served from the DEMS origin, gets a `ui` object | full power for rich UIs; plugin code in the browser has the viewer's rights |
| B | Declarative UI only (plugin describes forms/lists as JSON, DEMS draws them) | very safe; too narrow ("Übernehmen" → editor, leaderboards, star ratings would all need special cases) |
| C | Sandboxed iframe on a second origin, postMessage bridge | real isolation; second domain + TLS per operator, bridge code, worse UX (height, focus, dialogs) |

A is chosen with the rule that plugins only touch what `ui` hands them, so C can later
replace A's implementation of `ui`.

## Design

### Terms

- **Plugin:** a folder with `plugin.json`, an optional `server.js`, an optional
  `client.js` (+ optional `client.css`, optional `assets/`).
- **Official plugin:** found in `<app>/plugins/` (the repo folder, part of the image).
  Official is decided **only by the location**, never by the manifest.
- **Custom plugin:** found in the custom plugin folder, default `data/plugins/`
  (= `/app/data/plugins` on the existing volume), configurable with `PLUGINS_DIR`.
- **Plugin state:** stored per plugin in the collection `pluginState`, document id =
  plugin id: `{ enabled, enabledAt, enabledBy, confirmedVersion, confirmedPermissions,
  lastError, lastErrorAt }`.

### Manifest (`plugin.json`)

```json
{
  "id": "event-submissions",
  "name": "Event einreichen",
  "version": "1.0.0",
  "sdk": 1,
  "description": "Mitglieder reichen Event-Ideen ein, das Team übernimmt oder lehnt ab.",
  "author": "DEMS",
  "server": "server.js",
  "client": "client.js",
  "permissions": ["events:read", "events:draft", "discord:dm", "discord:channel"],
  "settings": [
    { "key": "notifyChannel", "type": "channel", "label": "Kanal für neue Vorschläge",
      "help": "Leer lassen, wenn das Team nicht benachrichtigt werden soll." }
  ]
}
```

Validation (a broken manifest → status „Ungültig: <Grund>“, plugin never loaded):

- `id`: `^[a-z][a-z0-9-]{2,31}$`, equal to the folder name, unique across both folders.
  A custom plugin with the id of an official one is refused.
- `sdk`: integer; DEMS 3.4.0 supports `1`. Another value → „Inkompatibel (SDK <n>)“.
  (An integer instead of a semver range: no dependency, and SDK breaks are rare.)
- `version`: `x.y.z`.
- `name` ≤ 40, `description` ≤ 200, `author` ≤ 60 characters; German texts by convention.
- `server` / `client`: relative file names inside the folder, no `..`, must exist.
- `permissions`: only known names (table below); unknown → invalid.
- `settings`: each `{ key (^[a-zA-Z][a-zA-Z0-9]{0,31}$), type, label, help?, required?,
  options? }`; types `text`, `textarea`, `number`, `boolean`, `select` (with `options`),
  `channel` (text channel picker from the bot's channels), `role`, `secret`.

### Permissions (SDK 1)

Every `ctx` method checks the manifest permission and throws
`PluginPermissionError` when it is missing. **In-process this is a guard rail, not a
wall** — the warning says so.

| Permission | Allows | Shown as (German) |
|---|---|---|
| `events:read` | `ctx.events.get/list`, event hooks | „Events lesen“ |
| `events:draft` | `ui.openEventEditor` with an origin; origin hooks | „Events für das Team vorbereiten“ |
| `members:read` | `ctx.members.get` (id, name, avatar) | „Mitgliedernamen und Avatare lesen“ |
| `discord:dm` | `ctx.discord.sendDM` | „Direktnachrichten über den Bot senden“ |
| `discord:channel` | `ctx.discord.sendChannelMessage` | „Nachrichten in Discord-Kanäle posten“ |
| `network` | nothing in `ctx`; declares that the plugin talks to the internet | „Verbindungen ins Internet aufbauen“ |
| SDK 1.1: `discord:commands`, `registrations:read`, `checkins:read`, `schedule` | | |

Routes, own data, own settings, a tab and the audit log need no permission: every
plugin has them, scoped to itself.

### Discovery, loading and lifecycle

1. At startup (after migrations, before `listen`) `plugins/loader.js` scans
   `<app>/plugins/*/plugin.json` and `PLUGINS_DIR/*/plugin.json`, validates the
   manifests and reads `pluginState`.
2. Only **enabled and confirmed** plugins get their `server.js` required — a disabled
   custom plugin's code never runs. `module.exports.register(ctx)` is called once with
   a timeout of 5 s; a throw or timeout → status „Fehler“, `lastError` stored, plugin
   treated as off, DEMS continues.
3. **Switching on at runtime:** require + `register(ctx)` then. **Switching off:** the
   plugin's routes answer 404, its hooks are skipped, its client is no longer listed,
   its `ctx.onDisable` callbacks run (2 s timeout). Node cannot unload a module, so
   switching on again reuses the registrations of the first `register` — no second
   require until a restart.
4. **Custom plugin changed on disk:** when `version` differs from `confirmedVersion`
   or the permissions are more than `confirmedPermissions`, the plugin starts
   **disabled** with status „Bestätigung nötig“ (it was switched on for other code).
   Official plugins skip this: their code is reviewed in the repo and comes with an
   image update; a grown permission list of an official plugin is shown in the list
   but does not switch it off.
5. **Safe mode:** `PLUGINS_SAFE_MODE=true` loads no plugin code at all (list still
   shown, every switch disabled with the note „Abgesicherter Modus aktiv“). Recovery
   when a plugin breaks the start.
6. New official plugins that arrive with an image update start **off**.
7. In dev mock mode the official plugins are **on** by default (so the dev server
   shows them); tests switch them explicitly.

### Server side: `ctx`

`server.js` exports `{ register(ctx) }`. Everything passed in or out of `ctx` is plain,
JSON-serialisable data (no `req`, `res`, Discord objects, DB handles) — the condition
for running a plugin in its own process later.

```js
module.exports = {
  async register(ctx) {
    ctx.routes.post('/', { access: 'member' }, async ({ user, body }) => { /* … */ return { id }; });
    ctx.hooks.on('event.published', async ({ event }) => { /* … */ });
  }
};
```

| Area | API | Notes |
|---|---|---|
| identity | `ctx.plugin` `{ id, version, official }` | read-only |
| log | `ctx.log.info/warn/error(...)` | prefixed `[plugin:<id>]` |
| routes | `ctx.routes.get/post/put/delete(path, { access }, handler)` | mounted at `/api/plugins/<id><path>`. `access` is **required**: `'member'` (login) or `'admin'`; no default. Handler gets `{ user, params, query, body }` (`user` = `{ id, name, avatar, isAdmin, roles }` from the session) and returns a JSON-able value (→ 200) or throws `ctx.httpError(status, '<German message>')`. Any other throw → 500 `{ error: 'Im Plugin ist ein Fehler aufgetreten.' }` + log + `lastError`. Paths: Express syntax without wildcards; same method + path twice → refused at register |
| data | `ctx.data.get(coll, id)`, `list(coll)`, `where(coll, field, op, value)`, `add(coll, obj)`, `set(coll, id, obj)`, `update(coll, id, patch)`, `delete(coll, id)` | stored through `firebaseAdmin.js` in a collection named from plugin id + `coll` (scheme left to the builder, must be collision-free with core collections and between plugins); `coll` `^[a-z][a-zA-Z0-9]{0,31}$`; returns `{ id, ...data }` copies. **Reserved field `userId`:** a document that belongs to a member stores that member's Discord id in `userId` (a string); the core deletes such documents when the member deletes the account (see [Member data](#member-data-and-privacy)). The SDK registers every collection a plugin writes to, so the purge and „Daten löschen“ know them |
| settings | `ctx.settings.get()` → values per manifest | secrets readable here only; never in any answer |
| events | `ctx.events.get(id)`, `ctx.events.list({ upcoming })`, `ctx.events.url(id)` | `events:read`; shape of `toPublicEvent` (never `checkinCode`, no admin fields); `url` = `buildEventUrl` |
| members | `ctx.members.get(userId)` → `{ id, name, avatar }` or `null` | `members:read` |
| Discord | `ctx.discord.sendDM(userId, { text, link? })`, `ctx.discord.sendChannelMessage(settingKey, { text, link? })` → `true/false` | through new `bot.js` helpers (guarded by `state.isReady`, mock twins); `allowedMentions: { parse: [] }` always; DMs go through the bot center's DM switch like `sendAutomaticDM`; `link` = `{ label, url }` link button (url must be a DEMS URL from `ctx.events.url` or `ctx.siteUrl`); text ≤ 2000. **Limits:** a DM only to a user with a `users` document (else `false`); a channel post names the **key of one of the plugin's own `channel` settings**, never a raw channel id — empty setting → `false`; per plugin at most **200 DMs and 30 channel posts in a sliding 10 minutes** (in memory, reset by a restart); beyond → `false`, one log line per window, plugin status shows the warning „Nachrichtengrenze erreicht (<Zeit>)“ until the window is over |
| URLs | `ctx.siteUrl(hash)` | `buildSiteUrl`; for the plugin page `ctx.siteUrl('p/<id>')` |
| audit | `ctx.audit(action, adminId, details, targetId)` | `addAuditLog` with action `plugin:<id>:<action>` |
| hooks | `ctx.hooks.on(name, handler)` | see below |
| lifecycle | `ctx.onDisable(fn)` | cleanup when switched off |
| SDK 1.1 | `ctx.discord.command(...)`, `ctx.discord.onButton(...)`, `ctx.discord.onModal(...)`, `ctx.schedule.every(minutes, fn)` | named here, built later; custom ids prefixed `p:<id>:` |

Plugin routes are mounted inside the normal `/api` chain (session, CSRF, rate limits,
setup gate, privacy gate, maintenance gate apply unchanged) at `app.use('/api/plugins',
pluginRouter)` next to the other routers.

### Hooks (SDK 1.0)

`utils/pluginHooks.js` exports `emitHook(name, payload)`. The core calls it **after**
the change is committed; it never awaits plugin handlers in the request path
(fire-and-forget on the next tick), every handler is wrapped in `try/catch`, a handler
running longer than 10 s is logged. Payloads are plain copies in the public event shape.

**Order:** each plugin has its own queue; its handlers run one after another in the
order the core emitted (saving a new event as active emits `event.created`, then
`event.published` — the plugin sees them in that order). One plugin's slow handler
never delays another plugin.

| Hook | Payload | Fired when |
|---|---|---|
| `event.created` | `{ event }` | an event (any status) was created: `POST /api/admin/events` (also `fromPoll`), duplicate, Discord `/event erstellen` |
| `event.published` | `{ event }` | an event's status became `active` from no status or `draft`: create as active, `PUT …/status`, `PUT …/:id`, the Discord draft buttons |
| `event.updated` | `{ event, changed: [field names] }` | `PUT /api/admin/events/:id` |
| `event.ended` | `{ event }` | `POST …/end`, the auto-archive |
| `event.cancelled` | `{ event }` | `PUT …/cancel` |
| `event.deleted` | `{ eventId, origin }` | `DELETE …/:id`, series delete (once per date). The admin system reset emits **no** hooks: handlers run after the wipe and could write stale data back |
| `member.deleted` | `{ userId }` | `DELETE /api/user/account`, after the core purge of `userId` documents |

The builder finds every code path that changes these (web and Discord) — a test lists
the paths and checks each emits. A series counts per date. Hooks need no permission
except the event hooks (`events:read`); `member.deleted` reaches every enabled plugin.

### Member data and privacy

- **Account deletion** (`DELETE /api/user/account`, `routes/user.js`): after the core
  data, the SDK deletes in every plugin collection (enabled, disabled or orphaned) the
  documents whose `userId` equals the member's id, then emits `member.deleted`. A
  failure is logged and does not fail the account deletion.
- **Admin system reset** (`DELETE /api/admin/reset`): the reset dialog gets the target
  „Plugin-Daten“ (`pluginData`, checked by default); it deletes all plugin collections
  and plugin settings, `pluginState` (on/off) stays. The target `users` deletes the
  plugin data too, because it belongs to the deleted members (Claude's call: a reset
  of only comments or audit logs must not wipe plugin data).
- **Orphaned plugins:** a `pluginState` entry or registered collections without a
  plugin folder → card „Verwaist“ in System › Plugins (no switch, no settings) with
  „Daten löschen“, which also removes the `pluginState` entry.
- DEMS has no default privacy text (the operator writes it), so System › Plugins shows
  a hint above the list: „Plugins können Daten von Mitgliedern speichern. Erwähne
  eingeschaltete Plugins in deiner Datenschutzerklärung.“ The how-to says the same
  for plugin authors and operators.

### Event origin (for "Übernehmen")

- New event field `origin: { plugin: '<id>', ref: '<string ≤ 100>' }`.
- Set **only on create** (`POST /api/admin/events`, whitelisted there; ignored by
  `PUT`, not copied by duplicate or templates). The server accepts it only when the
  plugin exists, is enabled and has `events:draft`.
- **Series:** when the created event is a series, only the **first date** carries
  the origin (Claude's call: the idea became one event; later dates are repeats), so
  the hooks fire once for the submission.
- In admin event answers (`ADMIN_EVENT_FIELDS`), not in member answers; in every hook
  payload of that event (hooks run server-side, so the plugin sees it).
- Frontend: `ui.openEventEditor({ prefill, ref })` → `openEventEditor({ prefill,
  fresh: true, origin })` (the plugin id is filled in by the core, not by the plugin)
  → the wizard keeps it like `state.pendingPollDecision` → `saveEvent` sends
  `pluginOrigin` on the create.

### Frontend: `client.js` and `ui`

**Loading.** `GET /api/plugins` (member) answers the enabled plugins with a client:
`[{ id, name, official, client: '/plugins/<id>/client.js?v=<version>', css: … }]`.
After `checkAuth()` succeeded, the new `core/plugins.js` imports each client with
`import()` (allowed by `script-src 'self'`) and calls `module.register(ui)`, each in
its own `try/catch` (a failure: console error, plugin skipped, admins get a warning
toast „Plugin „X“ konnte nicht geladen werden.“). `client.css` is added as a
`<link rel="stylesheet">`.

**Static files.** `/plugins/<id>/…` serves only the files of **enabled** plugins and
only `client.js`, `client.css` and `assets/*.{js,css,png,jpg,jpeg,webp,gif,json,woff2}`
— no HTML, no SVG, no directory listing, `nosniff`.

**`ui` object** (one per plugin; every name below is created for that plugin):

| API | Does |
|---|---|
| `ui.plugin` | `{ id, name, version, official }` |
| `ui.user` | frozen copy `{ id, name, avatar, isAdmin }` |
| `ui.addPage({ access, title, render, leave?, tab? })` | registers the page at `#p/<id>` and `#p/<id>/<param>`; `access` `'member'` / `'admin'` (router guard like the core routes); `render(container, param)` gets an empty element inside the shared `#plugin-section`; `leave()` = the router's leave callback; `tab: { label, icon }` (`bi-*` only) adds a navbar link after the core member links (one tab per plugin; admin-only tabs go next to the admin links) |
| `ui.setTabBadge(count)` | number badge on the plugin's tab (0 hides) |
| `ui.actions.register({ name: fn })` | registered as `p:<id>:<name>`; markup uses the full literal name, e.g. `data-click="p:event-submissions:submit"` |
| `ui.api.get/post/put/delete(path, body?)` | fetch to `/api/plugins/<id><path>` with JSON + `X-CSRF-TOKEN`; resolves the JSON; rejects with an `Error` whose message is the German `error` of the answer |
| `ui.openEventEditor({ prefill, ref })` | admin + `events:draft` only; see Event origin |
| `ui.navigate(param?)` | `navigateTo('p/<id>' + …)` |
| `ui.helpers` | `escapeHtml`, `renderMarkdownSafe`, `markdownPreview`, `showToast`, `showConfirmDialog`, `avatar`, `emptyState`, `relativeDay`, `applyStyleData`, `showElement`, `toggleElement` |
| SDK 1.1 | `ui.addEventPanel(...)` |

**Rules for plugin clients** (checked by tests for official plugins, stated in the
how-to for custom ones): no `import` of DEMS modules (everything comes through `ui`);
render only into the container handed over; no inline handlers or styles (the CSP
blocks them anyway); escape every value; tokens only in `client.css`; Bootstrap Icons
only; German texts.

### Admin area: System › Plugins

A new category „Plugins“ (icon `bi-puzzle`) through the existing `addSystemCategory`.

- One card per plugin: name, version, author, chip **„Offiziell“** (`bi-patch-check`)
  or **„Nicht offiziell“** (`bi-exclamation-triangle`, warning tone), description,
  the requested permissions as German sentences, status chip (Aus, An, Fehler: …,
  Bestätigung nötig, Ungültig: …, Inkompatibel, Verwaist), switch; a warning line
  „Nachrichtengrenze erreicht“ while the message limit is hit.
- **Status rules (Claude's call):** a `register` throw/timeout → „Fehler“ and the plugin
  is off until switched on again (which retries `register`; after a restart it is
  retried at startup because `enabled` stays true). An error at runtime (route, hook)
  → the plugin **stays on**; `lastError` + time show as a warning line on the card.
- **Official plugin:** the switch acts at once (toast, audit log).
- **Custom plugin:** switching on opens a dialog:
  > **Nicht offizielles Plugin einschalten?**
  > „<Name>“ stammt nicht aus dem DEMS-Projekt. Es läuft mit vollem Zugriff auf DEMS,
  > den Discord-Bot und die Datenbank — die Berechtigungen unten zeigen, was es nutzen
  > möchte, verhindern aber nichts. Schalte es nur ein, wenn du dem Code vertraust.
  plus the permission list, a checkbox „Ich vertraue dem Code dieses Plugins“ and the
  reset password field. Stores `confirmedVersion` and `confirmedPermissions`.
- Settings of an enabled plugin render from its manifest below the card (same field
  look as the other System categories; `secret` shows „gesetzt“/„nicht gesetzt“ and
  needs the reset password to change, like the managed keys).
- „Daten löschen“ (danger, only while off, confirm dialog with the plugin name):
  deletes the plugin's collections and settings, keeps `pluginState`.
- Admin API (`routes/admin.js` or a new `routes/adminPlugins.js` mounted under the
  admin guard; audit-logged): `GET /api/admin/plugins`,
  `PUT /api/admin/plugins/:id/enabled` `{ enabled, password?, trust? }`,
  `PUT /api/admin/plugins/:id/settings` `{ values, password? }`,
  `DELETE /api/admin/plugins/:id/data`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PLUGINS_DIR` | `data/plugins` | folder of custom plugins |
| `PLUGINS_SAFE_MODE` | `false` | `true` loads no plugin code |

Both go into `.env.example` (German comments) and `docs/wiki/ops/configuration.md`.
No route of DEMS writes into `PLUGINS_DIR`.

### Security model (summary for the wiki and the warning)

1. **Two trust levels, said honestly.** Official = reviewed in the repo, shipped with
   the image. Custom = full process access, the operator's decision.
2. **Code only comes through the server's file system.** No upload, no URL install —
   a hijacked admin session cannot bring code onto the host.
3. **„Offiziell“ comes from the location**, never from the manifest.
4. **Custom plugins: warning + reset password + audit log; re-confirmation** when the
   version changes or the permissions grow; `PLUGINS_SAFE_MODE` as emergency stop.
5. **Disabled code never runs** (no require of disabled plugins).
6. **Serialisable `ctx`/`ui` boundary**, no DEMS imports in official plugins (test) →
   isolation can come later.
7. **API:** access level per route is mandatory, CSRF and rate limits inherited, the
   user comes from the session only; plugin routes live under their own prefix.
8. **Data:** own namespace per plugin; events only in the public shape; no raw DB.
9. **Discord:** no mentions ever (`allowedMentions: { parse: [] }`), DMs respect the bot
   center switch and reach only known members, channel posts only into channels an
   admin picked for that plugin, 200 DMs / 30 posts per plugin per 10 minutes, link
   buttons only to DEMS URLs.
10. **Member data:** the reserved `userId` field makes account deletion purge plugin
    data without relying on the plugin author; the system reset wipes all plugin data.
11. **Failure isolation:** every plugin call wrapped; startup never waits more than 5 s
    per plugin. Known limit until isolation: a synchronous endless loop in a plugin
    still blocks the process.
12. **Static files:** allow-list of types, no HTML/SVG.
13. **Dependencies:** official plugins use only Node built-ins and `ctx` (no
    `node_modules` of their own). Custom plugins may bring their own; that is the
    operator's risk, said in the how-to.

## Test plugin "Event einreichen"

Folder `plugins/event-submissions/` (official). Permissions `events:read`,
`events:draft`, `discord:dm`, `discord:channel`. Setting `notifyChannel` (channel,
optional).

### Data

Collection `submissions`, one document per idea:

```
{ userId, userName, userAvatar,          // from ctx user at submit time
  title,          // 3–100 chars, required
  description,    // ≤ 2000 chars, Markdown, optional
  wishedDate,     // 'YYYY-MM-DD' or '' (not in the past)
  category,       // '' or one of the editor's list: Tournament, Community, Workshop,
                  // Gamenight, Meeting, Sonstiges (#event-category) — anything else → 400
  status,         // 'open' | 'planning' | 'accepted' | 'rejected'
  reason,         // ≤ 500 chars, only with 'rejected'
  eventId,        // set from 'planning' on
  createdAt, updatedAt, decidedBy, decidedAt }
```

### API (`/api/plugins/event-submissions`)

| Route | Access | Does |
|---|---|---|
| `GET /mine` | member | own submissions, newest first |
| `POST /` | member | creates one; at most **3** with status `open`/`planning` per member → 409 „Du hast schon 3 offene Vorschläge. Warte, bis das Team sie bearbeitet hat.“; validation errors 400 in German; posts to `notifyChannel` when set: „Neuer Event-Vorschlag von **<Name>**: „<Titel>““ + link button „Vorschläge ansehen“ (`ctx.siteUrl('p/event-submissions')`) |
| `DELETE /:id` | member | own submission, only while `open` → withdrawn (deleted) |
| `GET /` | admin | all submissions, filter `?status=open\|planning\|done` in memory (`done` = accepted + rejected) |
| `POST /:id/reject` | admin | `{ reason? }`; only from `open`/`planning`; status `rejected`, audit, DM |
| `GET /counts` | admin | `{ open }` for the tab badge |

### Hooks

- `event.created` with `origin.plugin === 'event-submissions'` → submission `planning`,
  `eventId` set.
- `event.published` with that origin → submission `accepted`, DM.
- `event.deleted` with that origin while the submission is `planning` → back to `open`,
  `eventId` cleared. (After `accepted` it stays accepted.)
- `member.deleted` needs nothing extra: every submission carries `userId`, so the core
  purge removes them.
- The category select offers the same fixed list as the editor (a free text would be
  lost when „Übernehmen“ prefills the editor's select — Claude's call). The list is
  kept in one place on the plugin side and a test pins it to `#event-category`.

### DMs (exact texts)

- Accepted: „Dein Event „<Titel>“ wurde eingetragen.“ + link button „Zum Event“
  (`ctx.events.url(eventId)`).
- Rejected: „Dein Event-Vorschlag „<Titel>“ wurde abgelehnt.“ + with a reason a second
  line „Begründung: <Grund>“.
- Sent through `ctx.discord.sendDM` (bot center DM switch applies; no member DM
  preference of its own — the DM answers the member's own submission).

### UI (tab „Event einreichen“, icon `bi-lightbulb`, access member)

```
┌ Event einreichen ─────────────────────────────────────────────┐
│ [Alle Vorschläge (3)] [Selbst einreichen]   ← admins only      │
│                                                               │
│ Neue Idee                                                     │
│  Titel*        [______________________________]               │
│  Beschreibung  [______________________________] Markdown      │
│  Wunschtermin  [__.__.____]   Kategorie [Keine Kategorie ▾]   │
│                                   [Vorschlag einreichen]      │
│                                                               │
│ Deine Vorschläge                                              │
│  Raid-Abend Molten Core   · vor 2 Tagen   (In Planung)        │
│  Quiz-Nacht               · vor 5 Tagen   (Eingetragen) →     │
│  Mount-Farmen             · vor 1 Woche   (Abgelehnt)         │
│      Begründung: Machen wir schon jeden Donnerstag.           │
└───────────────────────────────────────────────────────────────┘
```

- **Members:** form + „Deine Vorschläge“ with status chips Offen (neutral), In Planung
  (info), Eingetragen (success, links to the event), Abgelehnt (danger, reason below);
  „Zurückziehen“ while open; empty state „Noch keine Vorschläge“ via `emptyState`.
- **Admins:** pill tabs „Alle Vorschläge“ (default, count of open) and „Selbst
  einreichen“; filter chips Offen / In Planung / Erledigt; each row: avatar, name,
  title, `markdownPreview` of the description, wish date, category, age; actions
  **„Übernehmen“** (primary) and **„Ablehnen“** (danger → dialog with optional reason
  ≤ 500, button „Ablehnen“). Tab badge = number of open submissions (admins only).
- **„Übernehmen“** → `ui.openEventEditor({ prefill: { title, description, category,
  start: wishedDate ? '<wishedDate>T19:00' : undefined }, ref: submissionId })`; the
  admin edits and saves as usual. (19:00 as the start time of a wished date is
  Claude's call — the admin always reviews the start.)

### Dev mock mode

Seed: two open submissions by `member` and `newbie`, one rejected with reason by
`raider`. DMs and channel posts show as log lines of `dev/mockBot.js`.

## Tests (TDD, `node:test`)

- Loader: manifest validation (each rule), id collision official/custom, official by
  location only, disabled code not required, `register` throw/timeout → status Fehler,
  re-confirmation on version/permission change, safe mode, `sdk` mismatch.
- `ctx`: permission checks per method, data namespacing (two plugins, same `coll`),
  route access required / member / admin, 404 when off, CSRF on mutations, plugin
  error → German 500, Discord payloads carry `allowedMentions: { parse: [] }`.
- Hooks: every listed core path emits (table-driven), handler errors do not change the
  core answer, per-plugin order is kept, a slow plugin does not delay another.
- Privacy: account deletion removes `userId` documents of enabled, disabled and
  orphaned plugins and emits `member.deleted`; the reset wipes plugin data; orphaned
  plugins are listed and deletable.
- Message limits: DM to an unknown user → `false`; channel post only via a filled own
  `channel` setting; the 201st DM / 31st post in 10 minutes → `false` + status warning.
- Event origin: accepted only on create, only for an enabled plugin with
  `events:draft`, ignored by PUT, not duplicated, admin-only in answers.
- Admin API: official toggle, custom toggle needs password + trust, audit entries,
  data delete only while off.
- Test plugin via `test/devServer.test.js` personas: submit, limit 3, validation,
  withdraw, admin list/filter, reject → DM (mock), create with origin → planning,
  publish → accepted + DM, delete while planning → open, member cannot call admin
  routes.
- Frontend guards extended to `plugins/*/client.js|css`: action names literal and
  registered (with prefix), no inline styles/handlers, tokens only, icon/emoji rule,
  no DEMS imports.
- Playwright smoke: the tab shows for a member when the plugin is on, not when off.

## Wiki and docs

New nodes: `concepts/plugin-sdk.md` (architecture, lifecycle, security model),
`howto/write-plugin.md` (for plugin authors: folder, manifest, `ctx`, `ui`, rules,
the test plugin as example). Updates: `index.md`, `reference/api-index.md`,
`ops/configuration.md`, `concepts/security.md`, `modules/frontend-app.md` (router
`#p/…`, `core/plugins.js`), `modules/bot.md` (new helpers), `ops/docker.md` (custom
plugins on the volume), `concepts/data-model.md` (`pluginState`, `origin`). Then
`npm run wiki`. Release entry in `updates.json` for 3.4.0.

## Delivery

One branch `feature/plugin-sdk`, in this order (each step green on `npm test`):

1. **SDK core server:** loader, manifest, `pluginState`, `ctx` (routes, data,
   settings, events, members, Discord DM/channel, audit, log, hooks), hooks in the
   core, event origin, safe mode, config.
2. **Admin:** System › Plugins, admin API, warning dialog.
3. **SDK core frontend:** `core/plugins.js`, `ui`, router `#p/…`, navbar tabs,
   static serving.
4. **Test plugin** „Event einreichen“ + seed.
5. **Wiki, how-to, release entry.**

SDK 1.1 (own spec later): Discord commands/buttons/modals, `ctx.schedule`, event page
panel, registration and check-in hooks — enough for Raid-Punkte, Event-Feedback and
Stream-Ankündigung.

## Left to the builder

- File layout of the SDK (`plugins/loader.js` vs `utils/plugins/*`), module splits
  (≤ ~500 lines each).
- The collection naming scheme for plugin data, as long as it cannot collide.
- How runtime on/off gates routes (one dispatcher router is fine).
- The exact list of code paths that emit each hook (the test pins it).
- Markup of System › Plugins and of the test plugin within the component library.
- German wording of everything not quoted above.
- Whether `GET /api/plugins` and the static files sit in `server.js` or a router file.
