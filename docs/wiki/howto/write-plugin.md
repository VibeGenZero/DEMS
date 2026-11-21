---
id: write-plugin
title: How to write a plugin
type: howto
tags: [howto, plugins, plugin-sdk, manifest, ctx, ui, hooks, settings, discord, privacy]
sources: [plugins/event-submissions, plugins/custom-design, plugin-sdk/manifest.js, plugin-sdk/context.js, plugin-sdk/data.js, plugin-sdk/discord.js, plugin-sdk/theme.js, plugin-sdk/themeCss.js, public/js/core/plugins.js, public/js/core/pluginTheme.js, public/js/core/passwordDialog.js, test/pluginClientGuards.test.js]
depends_on: [plugin-sdk]
see_also: [security, frontend-app, bot, data-model, api-index, docker]
---
# How to write a plugin

> TL;DR: Make a folder `<id>/` with `plugin.json` (id = folder name, `sdk: 1`, version `x.y.z`, permissions, settings), a CommonJS `server.js` exporting `register(ctx)` (routes with a mandatory `access`, `ctx.data`, `ctx.settings`, `ctx.hooks`, `ctx.discord`) and an ES module `client.js` exporting `register(ui)` (`ui.addPage` with a tab, `ui.actions.register`, `ui.api`, `ui.helpers`). Touch DEMS only through `ctx`/`ui`, store the member's Discord id in `userId`, write German texts, no inline styles/handlers, tokens and Bootstrap Icons only. Put the folder into `PLUGINS_DIR` (`/app/data/plugins` in Docker), restart, switch it on in System › Plugins. The reference is `plugins/event-submissions/` („Event einreichen“).

Background (lifecycle, hooks, security model): [plugin-sdk](../concepts/plugin-sdk.md).

## 1. Folder

```
my-plugin/              # folder name = manifest id
  plugin.json           # required
  server.js             # optional: server side, CommonJS, exports register(ctx)
  client.js             # optional: browser side, ES module, exports register(ui)
  client.css            # optional: loaded automatically when it exists
  assets/               # optional: flat files only, assets/<name>.{js,css,png,jpg,jpeg,webp,gif,json,woff2}
```

The browser can load only `client.js`, `client.css` and `assets/<name>` (one level, name `[A-Za-z0-9_-]+`), and only while the plugin is on. Split client code into `assets/*.js` and import it relatively (`import { view } from './assets/view.js'`). Server code may `require` its own files (`require('./rules')`).

## 2. Manifest `plugin.json`

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

| Field | Rule (a break → „Ungültig: <Grund>“, never loaded) |
|---|---|
| `id` | `^[a-z][a-z0-9-]{2,31}$`, equal to the folder name; an official plugin's id is refused for a custom plugin |
| `sdk` | integer; DEMS 3.4 supports `1`, another → „Inkompatibel (SDK <n>)“ |
| `version` | `x.y.z`. Changing it on a custom plugin makes the admin confirm again |
| `name` / `description` / `author` | required ≤ 40 / optional ≤ 200 / optional ≤ 60 characters, German |
| `server` / `client` | optional relative file names inside the folder (no `..`, `\`, `:`, leading `/`); must exist |
| `permissions` | list of known names: `events:read`, `events:draft`, `members:read`, `discord:dm`, `discord:channel`, `theme`, `network`. Ask only for what you use; a new one on a custom plugin makes the admin confirm again |
| `settings` | list of `{ key, type, label, help?, required?, options? }`; `key` `^[a-zA-Z][a-zA-Z0-9]{0,31}$`, unique; `type` one of `text`, `textarea`, `number`, `boolean`, `select` (needs `options`: strings or `{ value, label }`), `channel`, `role`, `secret` |

DEMS draws the settings form in System › Plugins and validates it: numbers finite, `select` only its options, `channel`/`role` Discord ids picked from the bot's lists, text ≤ 4000, `required` must be filled; `null`/`''` clears. A `secret` shows only „gesetzt“/„nicht gesetzt“ and needs the reset password to change.

## 3. Server side: `register(ctx)`

```js
// server.js — CommonJS, only Node built-ins and own files
module.exports = {
    async register(ctx) {
        ctx.routes.get('/mine', { access: 'member' }, async ({ user }) => {
            return ctx.data.where('items', 'userId', '==', user.id);
        });
        ctx.routes.post('/', { access: 'member' }, async ({ user, body }) => {
            if (typeof body.title !== 'string' || !body.title.trim()) throw ctx.httpError(400, 'Titel fehlt.');
            return ctx.data.add('items', { userId: user.id, title: body.title.trim(), createdAt: new Date().toISOString() });
        });
        ctx.hooks.on('member.deleted', async ({ userId }) => ctx.log.info('Mitglied gelöscht', userId));
    }
};
```

`register` may be async and must settle within **5 s**; a throw or timeout → status „Fehler: …“. Routes and hooks can be added **only while `register` runs**. Everything in and out of `ctx` is plain JSON-able data.

| API | Use |
|---|---|
| `ctx.plugin` | `{ id, version, official }` |
| `ctx.log.info/warn/error(...)` | console with prefix `[plugin:<id>]` |
| `ctx.routes.get/post/put/delete(path, { access, password? }, handler)` | mounted at `/api/plugins/<id><path>`; `access` `'member'` or `'admin'` is **required**; `password: true` (only with `access: 'admin'`) checks `req.body.password` against `ADMIN_RESET_PASSWORD` with `safeEqual` before calling `handler` (401 „Ungültiges Admin-Reset-Passwort.“ on failure) and strips `password` from `body`; path Express syntax starting with `/`, no `*`/`?`/`#`; static paths before `/:id`; handler gets `{ user: { id, name, avatar, isAdmin, roles }, params, query, body }` and returns JSON (→ 200; `undefined` → `{ success: true }`) |
| `ctx.httpError(status, '<German>')` | `throw` it for a 4xx/5xx answer `{ error }`; any other throw → 500 „Im Plugin ist ein Fehler aufgetreten.“ + `lastError` |
| `ctx.data.get(coll, id)`, `list(coll)`, `where(coll, field, op, value)`, `add(coll, obj)`, `set(coll, id, obj)`, `update(coll, id, patch)`, `delete(coll, id)` | own documents, returned as `{ id, ...data }` copies; `coll` `^[a-z][a-zA-Z0-9]{0,31}$`; ids 1–128 characters without `/`; ops `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`; `update` of a missing document throws; no `limit`/`orderBy` — sort in memory; dates as ISO strings |
| `ctx.settings.get()` | `{ key: value }` of the manifest's settings (secrets included; never return them) |
| `ctx.theme.saveDraft(css)`, `discardDraft()`, `publish(css)`, `clear()` | `theme`; checks `css` with `checkThemeCss` (≤ 50 000 chars, no backslashes, allow-listed functions and at-rules only; throws 400 `PluginHttpError` with German reason + line number on failure) and stores it in `pluginThemes/<id>`, served at `/theme.css` (`publish`) and `/theme-preview.css` (`saveDraft`). The SDK guarantees the CSS filter; your routes own `access: 'admin'`, `password: true` and `ctx.audit` |
| `ctx.events.get(id)`, `ctx.events.list({ upcoming })`, `ctx.events.url(id)` | `events:read`; public event shape + `origin`, **every status** (drafts too — do not show drafts to members); `list` sorted by start |
| `ctx.members.get(userId)` | `members:read`; `{ id, name, avatar }` or `null` |
| `ctx.discord.sendDM(userId, { text, link? })` | `discord:dm`; → `true`/`false` |
| `ctx.discord.sendChannelMessage(settingKey, { text, link? })` | `discord:channel`; names one of **your own `channel` settings**, never a channel id |
| `ctx.siteUrl(hash)` | `<BASE_URL>/#<hash>`, e.g. your page `ctx.siteUrl('p/<id>')` |
| `ctx.audit(action, actorId, details, targetId?)` | audit log action `plugin:<id>:<action>` (`^[a-zA-Z0-9_.-]{1,64}$`); call it for admin actions |
| `ctx.hooks.on(name, handler)` | see below |
| `ctx.onDisable(fn)` | runs when an admin switches the plugin off (2 s) |

### Member data: the reserved `userId`

Every document that belongs to a member stores that member's Discord id as a string in `userId`. When the member deletes the account, DEMS deletes every document with that `userId` in all your collections — on, off or orphaned — and then emits `member.deleted`. Data elsewhere in a document (e.g. a second member's id) is yours to clean up in `member.deleted`. „Daten löschen“ in System › Plugins and the system reset target „Plugin-Daten“ delete everything.

### Hooks

| Hook | Payload | Permission |
|---|---|---|
| `event.created`, `event.published`, `event.ended`, `event.cancelled` | `{ event }` | `events:read` |
| `event.updated` | `{ event, changed: [field names] }` | `events:read` |
| `event.deleted` | `{ eventId, origin }` | `events:read` |
| `member.deleted` | `{ userId }` | none |

Handlers run after the core saved the change, one after another per plugin, on a copy of the payload; they cannot change or stop anything. A throw is logged and shown as „Letzter Fehler“; > 10 s logs a warning, after 30 s the handler counts as failed (also „Letzter Fehler“) and your next queued handler runs. At most 20 handlers per hook. Ignore events that are not yours (check `event.origin.plugin === ctx.plugin.id` if you created them). Saving a new event as active emits `event.created`, then `event.published`.

### Discord messages and their limits

- `text` 1–2000 characters, plain; nobody is ever pinged (`@everyone`, roles and users stay text).
- `link` = `{ label (1–80), url }` → one link button; `url` must be a DEMS URL (`ctx.events.url(id)`, `ctx.siteUrl(...)`).
- DMs reach only members DEMS knows (a `users` document) and respect the bot center's DM switch.
- Channel posts go only to the channel an admin picked in your `channel` setting; empty setting → `false`.
- At most **200 DMs and 30 channel posts per plugin per 10 minutes**; beyond that `false`, one log line, and the card shows „Nachrichtengrenze erreicht (bis HH:MM)“.
- A refusal returns `false` (only a missing permission throws). Send fire-and-forget so a message never delays a route: `ctx.discord.sendDM(...).catch(err => ctx.log.error(err.message))`.

## 4. Browser side: `register(ui)`

```js
// client.js — ES module; import only your own files (./assets/*.js)
export function register(ui) {
    const { escapeHtml, showToast, emptyState } = ui.helpers;

    async function save() {
        const input = document.getElementById('mp-title');
        try {
            await ui.api.post('/', { title: input.value });
            showToast('Gespeichert.', 'success');
        } catch (err) {
            showToast(err.message, 'danger');
        }
    }
    ui.actions.register({ save });

    ui.addPage({
        access: 'member',
        title: 'Meine Liste',
        tab: { label: 'Meine Liste', icon: 'bi-list-check' },
        async render(container) {
            const items = await ui.api.get('/mine');
            container.innerHTML = `
                <input id="mp-title" class="form-control" maxlength="100">
                <button class="btn btn-primary" data-click="p:${escapeHtml(ui.plugin.id)}:save">Speichern</button>
                ${items.length ? items.map(item => `<p>${escapeHtml(item.title)}</p>`).join('') : emptyState({ icon: 'inbox', title: 'Noch nichts da' })}`;
        }
    });
}
```

Official plugins write the action name literally (`data-click="p:event-submissions:submit"`); the guard test checks it.

| API | Use |
|---|---|
| `ui.plugin` | `{ id, name, version, official }` |
| `ui.user` | frozen `{ id, name, avatar, isAdmin }` |
| `ui.addPage({ access, title, render, leave?, tab? })` | one page per plugin at `#p/<id>` and `#p/<id>/<param>`; `access` `'member'`/`'admin'` (admins only → other members are sent to the events); `render(container, param)` fills a fresh element inside `#plugin-section` (may be async); `leave()` when the page is left; `tab: { label ≤ 30, icon: 'bi-*' }` adds a navbar link (member tabs after the member links, admin tabs after the admin links) |
| `ui.setTabBadge(count)` | number on the tab, 0 hides, > 99 shows „99+“ |
| `ui.actions.register({ name: fn })` | names `^[A-Za-z][A-Za-z0-9]{0,39}$`, registered as `p:<id>:<name>`; use with `data-click`/`data-change`/`data-input`; the handler gets the element (read values from `element.dataset`) |
| `ui.api.get/post/put/delete(path, body?, { password? })` | `fetch` to `/api/plugins/<id><path>` with the CSRF header; with `{ password: true }` on `post`/`put`/`delete` it opens the core `#passwordModal` (`showPasswordDialog`), sends the typed password as `body.password` without exposing it to the plugin, and rejects with `Error('Abgebrochen.')` on cancel; resolves the JSON, rejects with an `Error` carrying the German `error`; paths start with `/`, no `..`/`//`/`\` |
| `ui.theme.showPreview()`, `hidePreview()`, `reload()`, `isStandardMode()` | `theme`, admins only: switches `#custom-theme` in this tab to `/theme-preview.css?v=<n>` and shows `#design-preview-bar` (`showPreview`), restores `/theme.css` (`hidePreview`), reloads `/theme.css?v=<n>` after publish/reset (`reload`), or reports whether `?design=standard` disabled custom themes (`isStandardMode`) |
| `ui.openEventEditor({ prefill, ref })` | admins + `events:draft` only: opens a new event in the editor, prefilled with the editor's draft fields (`title`, `description`, `category`, `startDate`, …); `ref` (1–100 characters, e.g. your document id) comes back as `event.origin = { plugin: <id>, ref }` in the event hooks of that event (first series date only) |
| `ui.navigate(param?)` | go to `#p/<id>` or `#p/<id>/<param>` |
| `ui.helpers` | `escapeHtml`, `renderMarkdownSafe`, `markdownPreview`, `showToast(msg, 'success'\|'danger'\|'warning'\|'info')`, `showConfirmDialog`, `avatar`, `emptyState`, `relativeDay`, `applyStyleData`, `showElement`, `toggleElement` |

The client loads after login and privacy consent, once per page load. A throw in `register(ui)` or a failed import skips the plugin; admins see „Plugin „<Name>“ konnte nicht geladen werden.“

## 5. Rules for plugin clients and servers

Checked by `test/pluginClientGuards.test.js` for official plugins; for custom plugins nothing checks them — follow them anyway, a later sandbox will enforce them.

- Reach DEMS only through `ctx` and `ui`: no `require`/`import` of DEMS files, no raw database, no Discord client, no `fetch` to core APIs.
- Render only into the container `render` hands you; never touch the DOM of core pages.
- No inline event handlers (`onclick=`) and no inline styles (`style="…"`, `<style>`, `setAttribute('style')`) — the CSP blocks them. A runtime value goes into `data-style-*` + `ui.helpers.applyStyleData`.
- Escape every interpolated value with `escapeHtml`; Markdown only via `renderMarkdownSafe` (previews: `escapeHtml(markdownPreview(text))`).
- `client.css`: only tokens of `public/css/tokens.css` (`var(--space-16)`, `var(--text-primary)`, …), no raw colours, sizes or spacing; prefix your classes (e.g. `.es-` for event-submissions); build on the components (`btn`, `glass-card`, `chip`, `empty-state`, …, see [frontend-markup](../modules/frontend-markup.md)).
- Icons: Bootstrap Icons (`bi-*`) only, no emojis.
- Every text a user sees (UI, `{ error }`, DMs, settings labels) in German; code and comments in English.
- Official plugins: Node built-ins and own files only, no `node_modules`.

## 6. Try it

1. Put the folder into `data/plugins/<id>/` of a checkout (or point `PLUGINS_DIR` elsewhere) and run `npm run dev:mock`.
2. Log in as `admin`, open System › Plugins: the card shows „Nicht offiziell“, your permissions and the status. Switch it on: tick „Ich vertraue dem Code dieses Plugins“ and enter the reset password (mock mode: `dev`).
3. Your tab appears after a reload; errors show on the card („Letzter Fehler …“) and in the log with `[plugin:<id>]`. DMs and channel posts show as `dev/mockBot.js` log lines.
4. After changing `server.js` or `plugin.json`, restart the server (nodemon ignores `data/**`: type `rs` or stop and start); a changed `version` asks for confirmation again. If your plugin breaks the start: restart with `PLUGINS_SAFE_MODE=true`, switch the broken plugin off in System › Plugins, remove the line, restart (in safe mode plugins can only be switched off).

## 7. Install (operators)

- Copy the folder onto the server into the custom plugin folder: in Docker `/app/data/plugins/<id>/` on the `dems-data` volume (see [docker](../ops/docker.md)), readable by the user `node`; then restart DEMS and switch it on in System › Plugins. There is no upload in the browser on purpose.
- **Warning: a custom plugin is not sandboxed.** It runs inside the DEMS process with full access to DEMS, the database, the Discord bot and its token, the files and the network. The listed permissions show what it wants to use; they prevent nothing. Install only code you have read or whose author you trust. Updating the code means trusting it again (DEMS asks when the version or the permissions change).
- **Dependencies:** a custom plugin may bring its own `node_modules`; their code runs with the same full access, so they are part of what you trust. Official plugins have none.
- **Privacy:** plugins can store data of members. Mention every switched-on plugin and what it stores in your privacy policy (System › Datenschutz); DEMS writes no text for it. Account deletion removes the documents a plugin marks with `userId`.

## Example: „Event einreichen“ (`plugins/event-submissions/`)

| File | Shows how to |
|---|---|
| `plugin.json` | four permissions, one optional `channel` setting |
| `rules.js` | keep validation and message texts pure and testable (German errors, DM and post texts) |
| `server.js` | member routes (`/mine`, `POST /`, `DELETE /:id`) and admin routes (`/counts`, `/`, `/:id/reject`) with static paths first; a per-member queue so parallel submits cannot pass the limit of 3 open; `ctx.audit` on reject; fire-and-forget DM and channel post; hooks `event.created` → `planning`, `event.published` → `accepted` + DM with „Zum Event“, `event.deleted` of the planned draft → back to `open` |
| `client.js` | one page with tab `bi-lightbulb`, action names `p:event-submissions:*`, admin badge via `/counts`, „Übernehmen“ → `ui.openEventEditor({ prefill, ref: submission.id })` |
| `assets/view.js` | markup as pure functions with `ui.helpers` passed in, imported relatively |
| `client.css` | `.es-*` classes on tokens only |

Tests to copy from: `test/eventSubmissionsRules.test.js` (pure rules), `test/eventSubmissionsQueue.test.js` (`register(fakeCtx)` with an async fake `ctx`), `test/eventSubmissionsServer.test.js` (routes and hooks on the dev server with personas), `test/eventSubmissionsView.test.js` (client and view in the fake DOM) and `e2e/plugins.spec.js` (browser smoke test).

## Example 2: „Design anpassen“ (`plugins/custom-design/`)

| File | Shows how to |
|---|---|
| `plugin.json` | permission `theme`, admin-only page |
| `rules.js` | validate colour/corner/font/CSS sources, derive accent/glass/scrim tokens, compile dark (`:root:not([data-bs-theme="light"]), [data-bs-theme="dark"]`) and light (`[data-bs-theme="light"]`) rules, compute WCAG AA contrast warnings (`contrastWarnings`) |
| `server.js` | store the editable source in `ctx.data` (`designs/draft` and `designs/published`) while `ctx.theme` stores the compiled, filtered stylesheet; keep filter errors on `draft.error` so typing is never lost; require `{ access: 'admin', password: true }` on `POST /publish-css` when free CSS changed; `ctx.audit` on publish and reset |
| `assets/saver.js`, `assets/view.js`, `client.js`, `client.css` | debounced draft auto-save with `flush()` before preview/publish and on `leave()`, tab-local preview via `ui.theme.showPreview()`, password-gated publish via `ui.api.post('/publish-css', {}, { password: true })`, `.cd-*` classes using tokens only |

Tests: `test/customDesignRules.test.js`, `test/customDesignServer.test.js`, `test/customDesignView.test.js`, `e2e/customDesign.spec.js`.
