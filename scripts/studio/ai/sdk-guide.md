# DEMS plugin SDK — guide

The type description after this guide is the exact list of `ctx` and `ui` members. Use nothing else: no DEMS files, no database, no Discord client, no `fetch` to DEMS APIs.

## Folder and files

```
<id>/plugin.json   required manifest
<id>/server.js     optional, CommonJS: module.exports = { register(ctx) { … } }
<id>/client.js     optional, ES module: export function register(ui) { … }
<id>/client.css    optional, loaded automatically
<id>/assets/<name> optional, flat: [A-Za-z0-9_-]+ with .js .css .png .jpg .jpeg .webp .gif .json .woff2
```

- Outside `assets/` only `.js`, `.json`, `.css`, `.md`, `.txt` (subfolders ok, e.g. `lib/rules.js`). Never `.html`, `.svg`, `.ts`, dot files or `node_modules`.
- The browser loads only `client.js`, `client.css` and `assets/<name>`: split client code into `assets/*.js` and import it relatively (`import { view } from './assets/view.js'`). Every `assets/*.js` is client code.
- Server code may `require` Node built-ins and its own files (`require('./rules')`); no npm packages.

## plugin.json

```json
{ "id": "my-plugin", "name": "Mein Plugin", "version": "1.0.0", "sdk": 1.1,
  "description": "Kurz, was es tut.", "author": "Name", "server": "server.js", "client": "client.js",
  "permissions": ["events:read"],
  "settings": [{ "key": "notifyChannel", "type": "channel", "label": "Kanal für Hinweise" }] }
```

- `id` `^[a-z][a-z0-9-]{2,31}$` = folder name. `version` `x.y.z`. `sdk` is the number `1` or `1.1`; use `1.1` (required for `registrations:read`, `discord:roles`).
- `name` required ≤ 40 chars, `description` ≤ 200, `author` ≤ 60, German. `server`/`client` must name existing files (no `..`, `\`, `:`, leading `/`); omit the field when there is no such file.
- `permissions`: names from the table below; every one the code uses, nothing more.
- `settings[]`: `{ key, type, label, help?, required?, options? }`; `key` `^[a-zA-Z][a-zA-Z0-9]{0,31}$`, unique; `type` `text`, `textarea`, `number`, `boolean`, `select` (needs `options`: strings or `{ value, label }`), `channel`, `role` or `secret`. Admins fill them in System › Plugins; DEMS draws and validates the form.

## Permissions

| Permission | Needed for |
|---|---|
| `events:read` | `ctx.events.get`, `ctx.events.list`, every `event.*` hook |
| `events:draft` | `ui.openEventEditor` |
| `members:read` | `ctx.members.get`, `ctx.members.search` |
| `registrations:read` | `ctx.registrations.list`, hook `registration.checkedIn` (sdk 1.1) |
| `discord:dm` | `ctx.discord.sendDM` |
| `discord:channel` | `ctx.discord.sendChannelMessage` |
| `discord:roles` | `ctx.discord.listRoles`, `addRole`, `removeRole` (sdk 1.1) |
| `theme` | `ctx.theme.*`, `ui.theme.*` |
| `network` | server code using `fetch`, `WebSocket` or `http`/`https`/`http2`/`net`/`dgram`/`tls` |

Free: `ctx.data`, `ctx.settings`, `ctx.routes`, `ctx.log`, `ctx.audit`, `ctx.siteUrl`, `ctx.events.url`, `ctx.profile.badges`, hook `member.deleted`, the rest of `ui`. A missing permission throws; `network` does not throw (check, build and install find it). The permission check reads the code and follows only the names `ctx` and `ui`: write `register(ctx)` / `register(ui)` and call `ctx.events.list()` directly (no destructuring of `ctx`, no `ctx[name]`).

## Server: register(ctx)

`register` may be async and must finish within 5 s. Routes, hooks and profile badges can be added only while it runs.

### Routes

```js
ctx.routes.get('/items', { access: 'member' }, async ({ user, params, query, body }) => {
    return ctx.data.where('items', 'userId', '==', user.id);
});
```

- `get`/`post`/`put`/`delete(path, options, handler)` at `/api/plugins/<id><path>`. `path` starts with `/`, Express syntax (`/items/:id`), no `*`, `?`, `#`; one handler per method + path; static paths before `/:id`.
- `options.access` required: `'member'` (every logged-in member: check ownership such as `doc.userId === user.id` yourself) or `'admin'`. `password: true` (only with `'admin'`) makes DEMS check the admin reset password; the client then calls `ui.api.post(path, body, { password: true })`.
- The handler gets `{ user: { id, name, avatar, isAdmin, roles }, params, query, body }` and returns JSON-able data (200; `undefined` gives `{ success: true }`) within 30 s.
- Refuse with `throw ctx.httpError(400, 'Titel fehlt.')` (400–599, German text becomes `{ error }`). Any other throw answers 500.
- Admin actions: `await ctx.audit('item.deleted', user.id, 'Eintrag „…“ gelöscht', itemId)`; action `^[a-zA-Z0-9_.-]{1,64}$`.

### Data (`ctx.data`)

- `get(coll, id)` (doc or `null`), `list(coll)`, `where(coll, field, op, value)` with op `==` `!=` `<` `<=` `>` `>=` `in` (array), `add(coll, obj)` (new id), `set(coll, id, obj)` (replace), `update(coll, id, patch)` (throws when missing), `delete(coll, id)`.
- Docs come back as copies `{ id, ...fields }`. `coll` `^[a-z][a-zA-Z0-9]{0,31}$` (no `-`/`_`), ids 1–128 chars without `/`. Plain objects only, dates as ISO strings.
- No `orderBy`, `limit` or multi-field queries: filter and sort in memory.
- A doc that belongs to a member stores the member's Discord id as string field `userId`: on account deletion DEMS deletes those docs, then emits `member.deleted`.

### Settings

`const { notifyChannel } = await ctx.settings.get();` gives the stored values of the manifest keys (unset keys are missing). Read them when needed; admins change them at runtime. Never send a `secret` to the client.

### Hooks

`ctx.hooks.on(name, handler)` runs after the core saved the change, on a copy; it cannot change or stop anything. At most 20 handlers per hook, 30 s each; a throw is logged.

| Hook | Payload | Permission |
|---|---|---|
| `event.created` | `{ event }` | `events:read` |
| `event.published` | `{ event }` (draft to active; a new active event emits `event.created`, then `event.published`) | `events:read` |
| `event.updated` | `{ event, changed: string[] }` (field names) | `events:read` |
| `event.ended` | `{ event }` (status became archived) | `events:read` |
| `event.cancelled` | `{ event }` | `events:read` |
| `event.deleted` | `{ eventId, origin }` | `events:read` |
| `member.deleted` | `{ userId }` | none |
| `registration.checkedIn` | `{ registration, eventId }` (first check-in) | `registrations:read` |

`event`: `id, title, description, status ('draft'|'active'|'archived'|'cancelled'), startDate, endDate, maxParticipants, category, location, slots, origin` and more. `origin` is `{ plugin, ref }` for events made through `ui.openEventEditor`, else `null`.

### Events, registrations, members

- `ctx.events.get(id)` (event or `null`), `ctx.events.list({ upcoming })` sorted by start. Every status, drafts too: keep `status === 'active'` before showing events to members. `ctx.events.url(id)` links to the event.
- `ctx.registrations.list({ eventId?, userId? })` sorted by `createdAt`; no form answers or guests.
- `ctx.members.get(userId)`: `{ id, name, avatar }` or `null`; `ctx.members.search(text)`: up to 20 members whose name contains `text` (2–50 chars).

### Discord (`ctx.discord`)

- `sendDM(userId, { text, link? })`, `sendChannelMessage(settingKey, { text, link? })` resolve `true`/`false` (`false`: unknown member for a DM, invalid text/link, limit, not delivered) and never throw (except a missing permission). `settingKey` is the key of one of the plugin's own `channel` settings, never a channel id.
- `text` 1–2000 chars, plain, German; nobody is pinged. `link` `{ label (1–80), url }` adds a button; `url` must point into DEMS: `ctx.events.url(id)` or `ctx.siteUrl('p/<id>/<param>')`.
- Per plugin and 10 min: 200 DMs, 30 channel posts, 500 role changes; beyond that `false` (roles: `{ ok: false, reason }`).
- Do not await messages in a route: `ctx.discord.sendDM(id, msg).catch(err => ctx.log.error(err.message))`.
- `listRoles()`: `{ id, name, color }[]` the plugin may give; `addRole(userId, roleId)` / `removeRole(…)`: `{ ok: true, changed }` or `{ ok: false, reason }`; a forbidden role throws. Admins pick a role through a `role` setting.

### Other

- `ctx.profile.badges(({ userId }) => [...])` once in `register`: `ProfileBadge[]` for the member's own profile (`icon: 'bi-*'`, `color: '#rrggbb'`, `progress` 0..1), within 2 s, at most 50.
- `ctx.theme.saveDraft(css)`, `discardDraft()`, `publish(css)`, `clear()`: site-wide stylesheet (≤ 50000 chars, no backslash, no `url()`/`@import`); only from `access: 'admin'` routes (DEMS does not check the caller).
- `ctx.log.info/warn/error(...)`, `ctx.siteUrl(hash)` (`<BASE_URL>/#<hash>`), `ctx.onDisable(fn)` (2 s), `ctx.plugin` `{ id, version, official }`.

## Client: register(ui)

```js
export function register(ui) {
    const { escapeHtml, showToast, emptyState } = ui.helpers;
    async function save() {
        try {
            await ui.api.post('/items', { title: document.getElementById('mp-title').value });
            showToast('Gespeichert.', 'success');
        } catch (err) { showToast(err.message, 'danger'); }
    }
    ui.actions.register({ save });
    ui.addPage({
        access: 'member', title: 'Meine Liste', tab: { label: 'Meine Liste', icon: 'bi-list-check' },
        async render(container, param) {
            const items = await ui.api.get('/items');
            container.innerHTML = `<div class="mp-page"><input id="mp-title" class="form-control" maxlength="100">
                <button type="button" class="btn btn-primary" data-click="p:my-plugin:save"><i class="bi bi-save"></i> Speichern</button>
                ${items.length ? items.map(i => `<p>${escapeHtml(i.title)}</p>`).join('') : emptyState({ icon: 'inbox', title: 'Noch nichts da' })}</div>`;
        }
    });
}
```

- `ui.addPage({ access, title, render, leave?, tab? })` once: page `#p/<id>` (`#p/<id>/<param>` passes `param`). Render only into `container`. `tab` `{ label ≤ 30, icon 'bi-*' }`. `ui.navigate(param?)` goes there; `ui.setTabBadge(n)` shows a count.
- Markup events: `data-click`, `data-change` or `data-input` = `"p:<plugin-id>:<name>"`; handlers via `ui.actions.register({ name: (element, event) => … })` (name `^[A-Za-z][A-Za-z0-9]{0,39}$`, each once). Pass values in escaped `data-*` attributes (`element.dataset.id`).
- `ui.api.get/post/put/delete(path, body?, options?)` calls the own routes (`path` starts with `/`, no `..`, `//`); resolves the JSON, rejects with an `Error` carrying the German `error`.
- `ui.user` `{ id, name, avatar, isAdmin }`, `ui.plugin` `{ id, name, version, official }`.
- `ui.openEventEditor({ prefill: { title, description, … }, ref })`: admins only, `events:draft`; `ref` (1–100 chars) comes back as `event.origin.ref` in the hooks.
- `ui.helpers` (signatures in the types): `emptyState({ icon, title, text?, action? })` takes the icon without `bi-` (`'inbox'`) and `action` as HTML; `avatar` and `emptyState` return HTML strings.

### Markup and CSS (the CSP blocks inline code)

- No `style="…"`, `<style>`, `setAttribute('style')`, `onclick=`/other inline handlers or `<script>`. Hide with class `is-hidden`, show with `showElement`/`toggleElement`. Runtime colour or width: `data-style-color`, `data-style-background`, `data-style-border-color` (hex), `data-style-width` (percent), then `ui.helpers.applyStyleData(container)` after setting `innerHTML`.
- Escape every interpolated value with `escapeHtml`; Markdown only through `renderMarkdownSafe`.
- DEMS classes: `glass-card`, `btn btn-primary|btn-outline-secondary|btn-danger|btn-sm`, `chip`, `form-control`, `form-label`, `form-select`, `text-secondary`. Icons only `<i class="bi bi-…"></i>`, never emojis.
- `client.css`: prefix every class (`.mp-…`); values only as tokens, e.g. `gap: var(--space-12)`: `--space-4|8|12|16|24|32|48`, `--font-size-xs|sm|md|lg|xl`, `--radius-sm|--radius|--radius-lg|--radius-pill`, `--text-primary|secondary|muted`, `--bg-card|glass|inset`, `--border-subtle|strong`, `--accent|--success|--warning|--danger|--info`.

## Common mistakes

- Members the type description does not list (`ctx.db`, `ctx.discord.sendMessage`, `ctx.events.create`, `ui.render` …).
- `"server": "server.js"` without writing that file; a client import outside `assets/`.
- Showing drafts or other members' data to members; returning secrets; unchecked `body` fields.
