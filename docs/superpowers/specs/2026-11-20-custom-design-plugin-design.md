# Official plugin „Design anpassen“ (custom CSS) and the SDK theme extension

## Intent

Admins want DEMS to look like **their** community: their colours, rounder or squarer
corners, and — for those who know CSS — single components. GitHub issue #156
(„Idee: Custom-CSS-Editor“) asks for an editor in the admin area with a preview, the
CSS delivered as its own file (never a `<style>` element, the CSP refuses it), a reset
to the default and an audit log entry. It names the open points: AA contrast,
CSS injection (`url()` to outside targets), light/dark mode, and „evtl. Teil der
Plugin-SDK (#155)“.

The owner decided to build it **as the second official plugin**, on top of the plugin
SDK of `docs/superpowers/specs/2026-11-19-plugin-sdk-design.md` (3.4.0). That spec
listed „No theming / custom CSS for the whole app (#156 stays an idea)“ as a non-goal
and said plugins never touch core pages; this design is the deliberate, permissioned
exception to that rule and supersedes that non-goal line.

## Decided by the owner

- **Scope C:** a **token form** (colours, corners, font, per light/dark scheme, with an
  AA contrast warning) as the normal way, **plus a free-CSS field** for experts.
- **Approach 1:** a plugin **plus a small SDK extension**. The plugin owns the form,
  the editor and the preview flow. The **SDK** owns the dangerous part: it checks every
  stylesheet against an allow-list, stores it, and serves it as a file linked in the
  `<head>`, so even the login screen and the loading screen show the custom design.
- The owner did not object to these proposals (Claude's, made in the conversation):
  - the filter rejects `url()`, `@import`, `@font-face` and backslash escapes, enforced
    by the SDK so no plugin can bypass it;
  - an escape hatch `?design=standard` in the address loads DEMS without the custom
    design; `PLUGINS_SAFE_MODE` also turns it off;
  - **publishing changed free CSS needs the admin reset password** (like secret
    settings today); token changes do not; every publish is audit-logged.

## Goals

1. An admin changes the accent, surfaces, text colours, corners and font for the dark
   and the light scheme in a form and sees a warning when a pair misses AA contrast.
2. An admin who knows CSS adds free CSS; anything that could load outside resources or
   smuggle such a load past the filter is refused with a German message and a line
   number.
3. The admin previews a draft across the whole app (only in their own tab) before
   publishing it; other viewers see only the published design.
4. The published design applies from the first paint for everyone, logged in or not,
   in both schemes.
5. Switching the plugin off, „Auf Standard zurücksetzen“, `?design=standard` or
   `PLUGINS_SAFE_MODE=true` each bring the default design back.
6. The SDK part is generic: any plugin with the permission `theme` can use it, and the
   **filter guarantee** holds for all of them (see [Who guarantees what](#who-guarantees-what)).

## Non-goals

- No own fonts or images (no `url()`, no `@font-face`); the font choice is between the
  fonts DEMS already ships.
- No spacing („Abstände“) controls in the form (Claude's call): the spacing tokens are
  named in pixels and drive the layout; changing them globally breaks more than it
  helps. Free CSS can still change spacing of single components.
- No status colours (success/warning/danger/info) and no Discord preview colours in the
  form (Claude's call): they are contrast-tuned and carry meaning. Free CSS can change
  them.
- No live push of a newly published design to open tabs: other viewers get it on their
  next page load.
- No per-member themes, no design marketplace, no import/export of designs.
- No guarantee that free CSS survives DEMS updates (class names may change); the page
  says so.

## Anti-goals (a failure even if it technically works)

- The custom CSS can make the browser contact any server other than DEMS.
- A stolen admin session alone can publish free CSS through „Design anpassen“.
- A broken design locks the admins out of the switch that removes it.
- A plugin with `theme` can serve something other than filtered CSS from the DEMS
  origin.
- The design shows a flash of the default colours on every page load.
- Changing the design can break registrations, events or the bot.

## Constraints from the project

- Everything in the SDK spec's constraints applies (data only via `firebaseAdmin.js`,
  CSP `'self'`, no inline styles/scripts, actions via `registerActions`, tokens only in
  plugin CSS, Bootstrap Icons, German UI text, English code/wiki, CSRF on mutations,
  explicit access, audit log for admin mutations, no new dependencies).
- CSP today: `style-src 'self'`, `font-src 'self'`, **`img-src 'self' data: https:
  blob:`** — so a `url(https://…)` in CSS would load. The filter, not the CSP, stops it.
  The CSP stays unchanged (avatars and event images need `https:`).
- `public/index.html` is the only page that loads `tokens.css`; its stylesheets are in
  the `<head>`, `tokens.css` and `components.css` near the end, `public/theme-boot.js`
  is a classic script in the `<head>` that sets `data-bs-theme` before the first paint.
- Token schemes in `public/css/tokens.css`: `:root, [data-bs-theme="dark"] { … }` and
  `[data-bs-theme="light"] { … }`; scheme-free tokens (radii, fonts) in `:root`.
- `test/designTokens.test.js` defines the AA rules of DEMS (text colours on base
  surfaces ≥ 4.5, `--on-*` on their fills ≥ 4.5); `public/js/core/contrast.js` has the
  colour maths (`parseColor`, `composite`, `contrastRatio`).
- The reset password check is `isResetPassword` in `routes/adminPlugins.js`
  (`safeEqual` against `ADMIN_RESET_PASSWORD`, unset → always wrong) with the message
  „Ungültiges Admin-Reset-Passwort.“
- Plugin clients load only after login and the privacy consent (`core/plugins.js`),
  which is why the stylesheet must come from the core, not from the plugin client.
- Plugin rules: no DEMS imports in plugin code; shared pure logic lives in the plugin
  folder (pattern of `plugins/event-submissions/rules.js` for the server and
  `assets/view.js` for the client; a list copied from the core is pinned by a test).

## Approaches

| | How | Trade-off |
|---|---|---|
| **1 (chosen)** | Plugin + SDK extension: permission `theme`, `ctx.theme` stores filtered CSS, core serves `/theme.css` in the `<head>` | design applies before login and without a flash; filter is a core guarantee for every plugin; needs core changes (SDK, `index.html`, `theme-boot.js`) |
| 2 | Plugin only: `client.js` sets custom properties via CSSOM after loading | no core change; but only after login + consent (visible colour jump), free CSS impossible (no way to serve a file), filter would live in the plugin |
| 3 | Core feature „System › Design“ | same safety as 1; no on/off switch for free, does not grow the SDK |

## Design — SDK extension (core)

### Permission `theme`

New entry in the permission table of `plugin-sdk/manifest.js`:

| Permission | Allows | Shown as (German) |
|---|---|---|
| `theme` | `ctx.theme.*`, `ui.theme.*` | „Aussehen der ganzen Seite ändern“ |

It stays SDK 1 (additive; an older DEMS refuses the unknown permission as invalid).
For a custom plugin the permission appears in the trust dialog like the others.

### `ctx.theme` (server, permission `theme`)

| API | Does |
|---|---|
| `ctx.theme.saveDraft(css)` | checks `css` (filter below); valid → stored as this plugin's draft; invalid → throws `ctx.httpError(400, '<German reason>')` |
| `ctx.theme.discardDraft()` | removes the draft |
| `ctx.theme.publish(css)` | checks `css`; valid → stored as this plugin's published sheet, draft removed; invalid → 400 as above |
| `ctx.theme.clear()` | removes published sheet and draft (back to default) |

Inputs and outputs are plain strings / `undefined` (serialisable, like all of `ctx`).
Storage: core-owned collection **`pluginThemes`**, document id = plugin id:
`{ css, publishedAt, draft, draftAt }` (`draft` `''` = none). The plugin cannot reach
this collection through `ctx.data`, so nothing unfiltered can get in.

`pluginThemes` is wiped by „Daten löschen“ of that plugin, by the system reset target
`pluginData`, and listed for orphaned plugins like the other plugin data. It holds no
member data (no `userId`).

### The filter (`plugin-sdk/themeCss.js`, pure)

`checkThemeCss(css)` → `{ ok: true }` or `{ ok: false, line, message }` (German). Rules:

1. At most **50 000 characters** („Das CSS ist zu lang (höchstens 50 000 Zeichen).“).
2. **No backslash anywhere** — CSS escapes are the classic way to spell `url` so that a
   filter misses it („Zeile n: Backslashes (\\) sind nicht erlaubt.“).
3. Comments are removed before the checks; an unclosed comment or string is an error.
4. Strings are skipped by the checks (a string cannot load anything).
5. Every **function** (an identifier directly followed by `(`, outside strings,
   compared lower-case) must be on the allow-list; anything else, `url` included, is
   refused („Zeile n: url() ist nicht erlaubt – eigene Bilder und Schriften können
   nicht eingebunden werden.“ / „Zeile n: <name>() ist nicht erlaubt.“). Allow-list:
   - values: `var`, `calc`, `min`, `max`, `clamp`, `rgb`, `rgba`, `hsl`, `hsla`, `hwb`,
     `lab`, `lch`, `oklab`, `oklch`, `color`, `color-mix`, `linear-gradient`,
     `radial-gradient`, `conic-gradient`, `repeating-linear-gradient`,
     `repeating-radial-gradient`, `repeating-conic-gradient`, `cubic-bezier`, `steps`,
     `counter`, `counters`, `minmax`, `repeat`, `fit-content`;
   - transforms: `translate`, `translatex`, `translatey`, `translate3d`, `rotate`,
     `scale`, `scalex`, `scaley`, `skew`, `skewx`, `skewy`, `matrix`, `perspective`;
   - filters: `blur`, `brightness`, `contrast`, `drop-shadow`, `grayscale`,
     `hue-rotate`, `invert`, `opacity`, `saturate`, `sepia`;
   - selectors: `not`, `is`, `where`, `has`, `nth-child`, `nth-last-child`,
     `nth-of-type`, `nth-last-of-type`, `lang`, `dir`.
   Deliberately missing: `url`, `image-set`, `image`, `cross-fade`, `element`, `src`,
   `paint`, `attr`, `env`, `expression`.
6. **At-rules** only `@media`, `@supports`, `@container`, `@layer`, `@keyframes`;
   anything else (`@import`, `@font-face`, `@namespace`, `@charset`, `@page`, …) is
   refused („Zeile n: @import ist nicht erlaubt.“).
7. `{ }` and `( )` must balance outside strings and comments, so one sheet cannot
   swallow the next one in the combined file.

The builder may add harmless functions to the allow-list; a function that can name a
resource never goes on it. A test pins the list.

### Serving

- **`GET /theme.css`** (public, no login, no session created, also during maintenance,
  setup and the privacy gate): the published sheets of all **enabled** plugins with
  `theme`, in plugin id order, each preceded by a comment `/* plugin: <id> */`. No
  plugin, all off, or `PLUGINS_SAFE_MODE=true` → empty body. Each sheet is **checked
  again** when served; one that fails (e.g. after a stricter filter in an update) is
  left out and logged. Headers: `text/css; charset=utf-8`, `nosniff`,
  `Cache-Control: no-cache` + `ETag` (cheap 304 on every load).
- **`GET /theme-preview.css`** (admin only; anyone else → 404): like `/theme.css`, but
  a plugin's draft replaces its published sheet where a draft exists.
  `Cache-Control: no-store`.
- `public/index.html` gets `<link rel="stylesheet" href="/theme.css" id="custom-theme">`
  as the **last** stylesheet in the `<head>` (after `style.css`), so it wins over the
  core. Plugin `client.css` files are appended later and only use tokens, so they pick
  the custom values up.
- **Escape hatch:** `public/theme-boot.js` (runs before the first paint) disables the
  `#custom-theme` link when the address has `?design=standard`. The query survives
  hash navigation and reloads. The builder picks the exact way (e.g. the script after
  the link sets `link.disabled = true`) as long as the default design shows from the
  first paint with the parameter and the custom design shows from the first paint
  without it.

### Route option `password` (SDK router)

`ctx.routes.post(path, { access: 'admin', password: true }, handler)`: the SDK router
checks `body.password` with the same check as `isResetPassword` (moved to a shared
helper the builder picks) **before** calling the handler; wrong or missing → 401
„Ungültiges Admin-Reset-Passwort.“. The handler gets `body` without `password`, so a
plugin never sees the password. `password: true` with `access: 'member'` → refused at
register. Generic: any plugin may use it.

**Client side:** `ui.api.post/put/delete(path, body, { password: true })` opens a
**core** dialog „Reset-Passwort eingeben“ (same look as the reset password fields of
System), adds the typed password to the request body and sends it; cancelled → the
call rejects with „Abgebrochen.“, wrong password → rejects with the server's message
and the dialog can be retried. The plugin's client code never sees the password
(Claude's call, after the builder check).

### Who guarantees what

(Claude's call after the builder check; it follows trust model C of the SDK spec:
in-process plugins are trusted code, the SDK draws guard rails.)

- **The SDK guarantees the filter** for every plugin with `theme`: nothing reaches
  `/theme.css` or `/theme-preview.css` that fails `checkThemeCss`, because the core
  checks again **when serving** — this holds even if code wrote `pluginThemes` directly.
- **Password and audit are the plugin's job.** `ctx.theme` is not tied to a request
  (`ctx` is built once per plugin and knows no user), so the SDK cannot know who
  publishes. The SDK offers the tools (`password: true`, `ctx.audit`); „Design
  anpassen“ uses both. The how-to says plainly: a plugin with `theme` decides itself
  who may change the design and whether that needs the password.

### `ui.theme` (client, permission `theme`, admins only)

| API | Does |
|---|---|
| `ui.theme.showPreview()` | switches this tab's `#custom-theme` link to `/theme-preview.css?v=<n>` (a new `n` each call, so it reloads) and shows the core **preview bar** |
| `ui.theme.hidePreview()` | back to `/theme.css`, bar gone |
| `ui.theme.reload()` | reloads `/theme.css` (after publish or reset) |
| `ui.theme.isStandardMode()` | `true` with `?design=standard`; `showPreview()` then does nothing |

The **preview bar** is core markup (not plugin markup, so the DOM rule holds): a small
fixed bar at the bottom „Vorschau des Design-Entwurfs – nur du siehst ihn.“ with the
button „Vorschau beenden“, visible on every page of the tab while the preview is on. A
reload ends the preview (Claude's call: a preview is a short look, not a mode).

## Design — the plugin „Design anpassen“

Folder `plugins/custom-design/` (official). Manifest:

```json
{
  "id": "custom-design",
  "name": "Design anpassen",
  "version": "1.0.0",
  "sdk": 1,
  "description": "Farben, Ecken, Schrift und eigenes CSS für eure Community.",
  "author": "DEMS",
  "server": "server.js",
  "client": "client.js",
  "permissions": ["theme"],
  "settings": []
}
```

### What the form can change

Every colour has a **Dunkel** and a **Hell** value; empty = DEMS default for that
scheme. The defaults are a copy in the plugin (a test pins them to `tokens.css`).

| Field (German) | Token(s) | Derived by the plugin |
|---|---|---|
| Akzentfarbe | `--accent` | `--accent-light`, `--accent-dark`, `--accent-text`, `--accent-fill`, `--accent-fill-hover`, `--on-accent`, `--accent-tint-1`, `--accent-tint-2`, `--accent-glow`, `--border-accent`, `--shadow-glow` |
| Seitenhintergrund | `--bg-primary` | `--bg-scrim` |
| Zweiter Hintergrund | `--bg-secondary` | — |
| Karten | `--bg-card` | `--bg-glass`, `--bg-glass-hover` |
| Text | `--text-primary` | — |
| Text (zweitrangig) | `--text-secondary` | — |
| Text (gedämpft) | `--text-muted` | — |
| Ecken (both schemes) | `--radius-sm`, `--radius`, `--radius-lg` | presets „Eckig“ 4/6/8 px, „Standard“ 8/12/16 px, „Rund“ 12/18/24 px |
| Schrift (both schemes) | `--font-body` | „Inter“ (default) or „Systemschrift“ (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`) |

**Derived values are concrete colours** (`#rrggbb` / `rgba(…)`), computed by the plugin,
not `color-mix()` — so the contrast check can read them. Rules: tints, glow and border
reuse the alpha values `tokens.css` uses for the scheme; `--on-accent` is `#ffffff` or
`#0a0a0f`, whichever contrasts more with `--accent-fill`; `--accent-text` and
`--accent-light` are lightened (dark scheme) or darkened (light scheme) step by step
until they reach 4.5 on that scheme's `--bg-card`, `--bg-primary` and `--bg-secondary`,
or stay at the closest value when 4.5 is unreachable. Glass and scrim take the card /
page colour with the scheme's alpha. The exact mixing ratios are left to the builder;
deriving from the DEMS default accent should land close to the shipped values.

**Generated CSS** (input of `ctx.theme`), in this order so free CSS can override it:

```css
:root, [data-bs-theme="dark"] { --accent: #…; /* + derived, only changed tokens */ }
[data-bs-theme="light"] { --accent: #…; /* … */ }
:root { --radius-sm: …; --radius: …; --radius-lg: …; --font-body: …; }  /* only if not default */
/* Eigenes CSS */
…free CSS…
```

Same selectors as `tokens.css`, loaded later → the custom values win; the light block
comes after the dark block, as in `tokens.css`.

### Contrast warning (client, live)

For each scheme the plugin checks, with the final values (custom or default, glass
composited on the page colour as the design token test does):

- `--text-primary`, `--text-secondary`, `--text-muted`, `--accent-text`, `--accent-light`
  on `--bg-primary`, `--bg-secondary`, `--bg-card`, `--bg-glass`, `--bg-glass-hover`
  ≥ 4.5;
- `--on-accent` on `--accent-fill` and `--accent-fill-hover` ≥ 4.5.

Each miss is a warning line under the form, e.g. „Hell: Text (gedämpft) auf Karten hat
3,1 : 1 – für gute Lesbarkeit sind mindestens 4,5 : 1 nötig.“ Warnings **do not block**
publishing (the issue asks for a warning). Free CSS is not checked.

### Data (`ctx.data`, collection `designs`)

Two documents, ids `draft` and `published`:

```
{ tokens: { dark: { accent, bgPrimary, bgSecondary, bgCard, textPrimary,
                    textSecondary, textMuted },          // '#rrggbb' or ''
            light: { …same keys… } },
  corners,      // 'square' | 'standard' | 'round'
  font,         // 'inter' | 'system'
  css,          // free CSS, ≤ 50 000 chars together with the generated part
  error,        // draft only: '' or the German filter message with line of the last save
  updatedAt, updatedBy }   // updatedBy = admin id (no userId: admin metadata, not member data)
```

**The form always works on the draft** (Claude's call after the builder check): every
change saves the draft after a short pause (~800 ms). The source is stored **even when
the free CSS fails the filter** — then `error` is set and `ctx.theme` keeps the last
valid compiled draft — so nothing typed is lost when the admin leaves the page, and no
leave confirm is needed. Coming back fills the form from the draft.

The plugin keeps the **source** (form values + free CSS) so the form can be filled
again; `ctx.theme` keeps the **compiled, filtered CSS**.

### API (`/api/plugins/custom-design`, every route `access: 'admin'`)

| Route | Does |
|---|---|
| `GET /` | `{ published, draft }` (sources, `null` when missing) |
| `PUT /draft` | body = source; validates the structure (colours `#rrggbb` or `''`, known keys only, `corners`/`font` from the lists, `css` a string ≤ 50 000 → else 400), compiles, tries `ctx.theme.saveDraft(css)`; stores the source either way, with `error` = the filter message or `''` → `{ draft }` (200 also with a filter error; the client shows `draft.error`) |
| `DELETE /draft` | `ctx.theme.discardDraft()`, deletes the draft source |
| `POST /publish` | publishes the stored draft. No draft → 409 „Es gibt keinen Entwurf.“ Draft with `error` → 409 „Das eigene CSS hat einen Fehler: <error>“. Free CSS of the draft differs from the published free CSS → 403 „Eigenes CSS wurde geändert – zum Veröffentlichen ist das Reset-Passwort nötig.“ Else `ctx.theme.publish(css)`, source → `published`, draft deleted, audit |
| `POST /publish-css` | `password: true`; same as `/publish` without the free-CSS refusal |
| `POST /reset` | `ctx.theme.clear()`, deletes both sources, audit. No password (going back to default is always safe — Claude's call) |

Audit (`ctx.audit`): `publish` with details = German labels of the changed fields plus
„Eigenes CSS geändert“ when it changed; `reset`. Draft saves are not audited (only
admins see drafts — Claude's call).

The client knows both sources, so it calls `/publish-css` (with the password dialog)
directly when the free CSS changed; the server enforces the rule anyway.

### UI (admin tab „Design“, icon `bi-palette`, access admin)

```
┌ Design anpassen ───────────────────────────────────────────────────┐
│ [Farben & Formen] [Eigenes CSS]                                    │
│                                                                    │
│                      Dunkel            Hell                        │
│ Akzentfarbe          [■ #8b5cf6] ↺     [■ Standard] ↺              │
│ Seitenhintergrund    [■ Standard] ↺    [■ Standard] ↺              │
│ Karten               …                                             │
│ Text / zweitrangig / gedämpft …                                    │
│ Ecken   (○ Eckig  ● Standard  ○ Rund)    Schrift [Inter ▾]          │
│                                                                    │
│ ⚠ Hell: Text (gedämpft) auf Karten hat 3,1 : 1 – mindestens 4,5 : 1 │
│                                                                    │
│ [Vorschau] [Veröffentlichen] [Entwurf verwerfen]                   │
│ Auf Standard zurücksetzen                                          │
│ Notausgang: Mit ?design=standard in der Adresse lädt DEMS ohne     │
│ eigenes Design.                                                    │
└────────────────────────────────────────────────────────────────────┘
```

- Colour fields: `<input type="color">` plus a hex text field; ↺ clears the value back
  to „Standard“ (the picker then shows the default colour).
- „Eigenes CSS“ tab: monospace `textarea`, a short hint what is allowed (no `url()`,
  no `@import`/`@font-face`, no backslashes; tokens are the stable way; class names may
  change with DEMS updates), the filter error with its line under the field.
- A small status line shows „Entwurf gespeichert“ / „Speichert …“ / the filter error.
- **Vorschau:** `ui.theme.showPreview()`. While the preview is on, each saved draft
  reloads it. The admin can navigate the whole app and still sees the draft — leaving
  the „Design“ page does **not** end the preview; only the core bar or a reload does.
- **Veröffentlichen:** waits for a pending save, then `/publish` — or, when the free
  CSS changed, `ui.api.post('/publish-css', {}, { password: true })` (core password
  dialog) — then `ui.theme.hidePreview()` + `ui.theme.reload()`, toast „Design
  veröffentlicht.“ Disabled while the draft has a filter error.
- **Entwurf verwerfen:** `DELETE /draft`, form back to the published values, preview off.
- **Auf Standard zurücksetzen:** confirm dialog „Eigenes Design entfernen? Alle sehen
  wieder das DEMS-Standarddesign.“ → `/reset`, reload, toast.
- With `?design=standard` the page shows an info line „Eigenes Design ist in diesem Tab
  ausgeschaltet.“ and the preview button is disabled.
- No leave confirm: the draft is saved continuously (see Data). `leave()` only flushes
  a pending save.

### Dev mock mode

Official plugins are on in mock mode; no seeded design (the dev server keeps the DEMS
look). Tests seed their own.

## Tests (TDD, `node:test`)

- **Filter** (table-driven): allowed sheet passes; `url(`, `URL(`, `image-set(`,
  `src(`, `attr(`, `@import`, `@font-face`,
  `@charset`, `\75 rl(`, `u\rl(`, comment tricks (`u/**/rl(` is no function → passes;
  `/*` unclosed → error), strings containing `url(` → pass, unbalanced braces → error,
  > 50 000 chars → error; line numbers right; the allow-list is pinned.
- **`ctx.theme`**: missing permission → `PluginPermissionError`; invalid CSS → 400
  German; draft/publish/clear stored per plugin in `pluginThemes`; `ctx.data` cannot
  reach `pluginThemes`.
- **Serving**: `/theme.css` empty without plugins, with the plugin off, in safe mode;
  combined in id order with markers; failing stored sheet left out; content type,
  `nosniff`, ETag/304, no session cookie; reachable logged out and in maintenance.
  `/theme-preview.css` 404 for member and logged out, draft for admin.
- **Route option `password`**: wrong/missing → 401 with the existing message; handler
  never sees `password`; `password` with `access: 'member'` refused at register.
  Client: `ui.api` with `{ password: true }` opens the core dialog, cancel rejects,
  the plugin's code gets no password value.
- **Serve-time check**: a sheet written straight into `pluginThemes` that fails the
  filter never reaches `/theme.css` or `/theme-preview.css`.
- **Data lifecycle**: „Daten löschen“ and the reset target `pluginData` remove
  `pluginThemes`; orphaned plugin lists it.
- **Plugin** via `test/devServer.test.js` personas: member/raider → 403/404 on every
  route; admin draft → publish (tokens only, no password) → `/theme.css` contains the
  tokens; free CSS changed → `/publish` 403, `/publish-css` wrong password 401, right
  password 200; reset → empty sheet; audit entries; source validation 400s; a draft
  with a filter error is stored with `error`, keeps the last valid preview sheet and
  `/publish` answers 409.
- **Plugin rules**: defaults pinned to `tokens.css` (both schemes, radii, font);
  derived colours: `--on-accent` choice, accent text reaches 4.5 when reachable,
  derived from the default accent close to the shipped values; contrast warnings for a
  known bad pair; generated CSS order and selectors.
- **Frontend guards** (existing tests over `plugins/*/client.js|css`): action names,
  no inline styles/handlers, tokens only, icons, no DEMS imports. Core preview bar
  markup follows the component rules.
- **Playwright**: a published accent shows on the login screen (computed `--accent`);
  `?design=standard` shows the default; preview shows the draft only in the admin's tab.

## Wiki and docs

The SDK wiki nodes (`concepts/plugin-sdk.md`, `howto/write-plugin.md`) come with the
SDK's own delivery step; this change adds to them: permission `theme`, `ctx.theme`,
`ui.theme`, route option `password`, `/theme.css` and the filter. Updates:
`reference/api-index.md` (`/theme.css`, `/theme-preview.css`, plugin routes),
`concepts/security.md` (CSS filter, why `img-src https:` makes it necessary, escape
hatch), `modules/frontend-markup.md` (stylesheet order, `#custom-theme`, preview bar),
`modules/frontend-app.md` (`theme-boot.js` escape hatch), `concepts/data-model.md`
(`pluginThemes`). Then `npm run wiki`. Issue #156 closes with the PR.

## Delivery

Own branch `feature/custom-design`, started from `feature/plugin-sdk` once its open
work (the „Event einreichen“ client) is committed; PR after the SDK PR (Claude's call,
keeps the SDK PR reviewable). Release entry with the SDK in 3.4.0 if that is not out
yet, else its own minor version. Order, each step green on `npm test`:

1. Filter `plugin-sdk/themeCss.js`.
2. Permission `theme`, `ctx.theme`, `pluginThemes`, data lifecycle.
3. `/theme.css`, `/theme-preview.css`, `index.html` link, `theme-boot.js` escape hatch.
4. Route option `password` (shared reset password helper) + `ui.api` `{ password: true }`
   with the core dialog.
5. `ui.theme` + core preview bar.
6. Plugin rules (defaults, derivation, contrast, compile) and server routes.
7. Plugin client (form, CSS tab, preview flow, dialogs).
8. Playwright, wiki, release entry.

## Left to the builder

- File names inside `plugin-sdk/` and `routes/`, and where `/theme.css` is mounted, as
  long as it is reachable logged out and during the gates.
- The exact escape-hatch mechanism in `theme-boot.js` (see Serving).
- The scanner of the filter (a small hand-written tokenizer is enough; no dependency).
- Exact colour mixing ratios for derived tokens (rules above).
- Markup of the plugin page and the preview bar within the component library.
- German wording of everything not quoted above.
