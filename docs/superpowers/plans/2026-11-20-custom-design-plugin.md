# Custom Design Plugin („Design anpassen“) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins change colours, corners, font and free CSS of DEMS through the official plugin „Design anpassen“; the SDK filters every stylesheet and serves it as `/theme.css` from the first paint.

**Architecture:** The SDK gains a permission `theme`, a core-owned store `pluginThemes` behind `ctx.theme`, a CSS allow-list filter that runs on save *and* on serve, the public `/theme.css` + admin `/theme-preview.css`, a route option `password: true`, and client `ui.theme` / `ui.api(…, { password: true })` with core-drawn preview bar and password dialog. The plugin keeps the editable source in `ctx.data`, compiles it to CSS (derived accent tones, contrast warnings) in a pure `rules.js`, and pushes the compiled CSS through `ctx.theme`.

**Tech Stack:** Node ≥ 22, Express 5, `node:test` + `node:assert/strict`, vanilla ES modules, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-20-custom-design-plugin-design.md` (builds on `docs/superpowers/specs/2026-11-19-plugin-sdk-design.md`).

## Global Constraints

- Run one suite: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/<name>.test.js`; all: `npm test`; browser: `npm run test:e2e`.
- Data only through `firebaseAdmin.js` (`db`, `collection`, `doc`, `getDoc`, `getDocs`, `setDoc`, `deleteDoc`); dates ISO strings.
- User-facing text German (quoted strings below are exact); code, comments, commits, wiki English.
- Plugin code (`plugins/custom-design/**`) imports nothing outside its folder; client only uses `ui`.
- No `style="…"`, no `<style>`, no inline handlers; actions via `data-click`/`data-change`/`data-input` + `registerActions` (plugins: `ui.actions.register`, markup uses `p:custom-design:<name>`); colours/sizes only as tokens in `components.css`/`style.css`/`client.css`; Bootstrap Icons only; escape with `escapeHtml`.
- Route handlers: own `try/catch`, `res.status(x).json({ error: '<German>' })`.
- Filter limit `MAX_THEME_CSS = 50000` characters; source `css` limit 50 000 characters.
- Reset password check: `safeEqual(password, process.env.ADMIN_RESET_PASSWORD)` from `middleware/auth.js`; message „Ungültiges Admin-Reset-Passwort.“ (401). Dev mock password is `dev`.
- Commits: English imperative subject + why in body, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After any wiki edit: `npm run wiki`.

## Review Focus

1. **A dark-only colour must not leak into light mode.** `tokens.css` can use `:root, [data-bs-theme="dark"]` because its light block comes later in the same file; in `/theme.css` (loaded after `tokens.css`) `:root` would beat the core light block. Deviation from the spec's "same selectors": the dark block uses `:root:not([data-bs-theme="light"]), [data-bs-theme="dark"]`. Pinned in Task 6 (selector test) and Task 9 (Playwright: dark-only accent, light mode shows the default).
2. **Hex typed by hand:** `#ABC`, `#AABBCC` from the hex text field must work (normalised to `#aabbcc`), not 400. Task 6.
3. **Escape hatch typed after the hash:** `/#admin?design=standard` is what people will type into an SPA URL; it must work like `/?design=standard#admin`. Task 3.
4. **Non-ASCII in free CSS** (`content: "→ Neu"`, umlauts in comments) passes the filter and is served as UTF-8 unchanged. Tasks 1 and 3.
5. **Publish while an autosave is pending** must publish the latest typed state, not the previous draft. Task 8 (`createDraftSaver().flush()`).

---

### Task 0: Preconditions and branch

- [ ] **Step 1:** `git status --short` on `feature/plugin-sdk` is clean and the SDK plan `docs/superpowers/plans/2026-11-19-plugin-sdk.md` is complete (its wiki nodes `docs/wiki/concepts/plugin-sdk.md` and `docs/wiki/howto/write-plugin.md` exist). If either is not true: stop and ask the owner.
- [ ] **Step 2:** `git switch -c feature/custom-design` and `npm test` → all pass (baseline).

---

### Task 1: CSS filter

**Files:**
- Create: `plugin-sdk/themeCss.js`
- Test: `test/themeCss.test.js`

**Interfaces:**
- Produces: `MAX_THEME_CSS: 50000`; `ALLOWED_FUNCTIONS: ReadonlySet<string>`; `ALLOWED_AT_RULES: ReadonlySet<string>` (`media`, `supports`, `container`, `layer`, `keyframes`); `checkThemeCss(css: unknown) → { ok: true } | { ok: false, line: number|null, message: string }` — `message` is the full German sentence including the „Zeile n: “ prefix when a line is known.

- [ ] **Step 1: Write the failing tests** (table-driven, one `test()` per row group):

```js
const ok = css => assert.deepEqual(checkThemeCss(css), { ok: true });
const bad = (css, line, message) => assert.deepEqual(checkThemeCss(css), { ok: false, line, message });

test('plain sheets with allowed functions and at-rules pass', () => {
    ok(':root { --accent: #123456; }\n.card:not(.x):nth-child(2n+1) { border-radius: calc(var(--radius) * 2); }');
    ok('@media (min-width: 600px) { .a { color: color-mix(in srgb, red 50%, blue); } }');
    ok('@keyframes spin { to { transform: rotate(1turn); } }');
    ok('.a::before { content: "url(nicht geladen) → Neu"; } /* Ümlaut */');
    ok('');
});
test('functions that can load something are refused with their line', () => {
    bad('.a {}\n.b { background: url(https://x.test/a.png); }', 2,
        'Zeile 2: url() ist nicht erlaubt – eigene Bilder und Schriften können nicht eingebunden werden.');
    bad('.b { background: URL(x); }', 1,
        'Zeile 1: url() ist nicht erlaubt – eigene Bilder und Schriften können nicht eingebunden werden.');
    bad('.b { background: image-set("a.png" 1x); }', 1, 'Zeile 1: image-set() ist nicht erlaubt.');
    for (const name of ['src', 'attr', 'env', 'image', 'cross-fade', 'element', 'paint', 'expression']) {
        assert.equal(checkThemeCss(`.b { x: ${name}(a); }`).ok, false, name);
    }
});
test('backslashes are refused anywhere', () => {
    bad('.b { background: \\75 rl(x); }', 1, 'Zeile 1: Backslashes (\\) sind nicht erlaubt.');
    bad('.b { content: "\\"" }', 1, 'Zeile 1: Backslashes (\\) sind nicht erlaubt.');
});
test('only the allowed at-rules pass', () => {
    bad('@import "x.css";', 1, 'Zeile 1: @import ist nicht erlaubt.');
    bad('\n@font-face { font-family: x; }', 2, 'Zeile 2: @font-face ist nicht erlaubt.');
    for (const rule of ['charset', 'namespace', 'page', '-webkit-keyframes']) assert.equal(checkThemeCss(`@${rule} x {}`).ok, false, rule);
});
test('comments and strings are handled before the checks', () => {
    ok('.a { color: u/**/rl(x); }');            // no function token: harmless
    bad('.a {}\n/* offen', 2, 'Zeile 2: Ein Kommentar (/* … */) wird nicht geschlossen.');
    bad('.a { content: "offen\n}', 1, 'Zeile 1: Ein Text in Anführungszeichen wird nicht geschlossen.');
});
test('braces and parentheses must balance', () => {
    bad('.a { color: red;', 1, 'Zeile 1: Die Klammern { } passen nicht zusammen.');
    bad('.a { color: red; } }', 1, 'Zeile 1: Die Klammern { } passen nicht zusammen.');
    bad('.a { width: calc(1px + 2px; }', 1, 'Zeile 1: Die Klammern ( ) passen nicht zusammen.');
});
test('size and type limits', () => {
    bad('a'.repeat(50001), null, 'Das CSS ist zu lang (höchstens 50 000 Zeichen).');
    bad(42, null, 'Das CSS muss Text sein.');
});
test('a 50 000 character sheet is checked in under 100 ms', () => {
    const sheet = '.a { color: var(--accent); }\n'.repeat(1700).slice(0, 50000);
    const start = performance.now();
    checkThemeCss(sheet);
    assert.ok(performance.now() - start < 100);
});
test('the allow-list is pinned', () => {
    assert.deepEqual([...ALLOWED_FUNCTIONS].sort(), [/* the spec's list, sorted */].sort());
    assert.deepEqual([...ALLOWED_AT_RULES].sort(), ['container', 'keyframes', 'layer', 'media', 'supports']);
});
```

Fill the pinned list with exactly the spec's allow-list (values, transforms, filters, selectors).

- [ ] **Step 2:** Run `test/themeCss.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `checkThemeCss` in `plugin-sdk/themeCss.js`** as one linear hand-written scanner (no regex over the whole text, no dependency). Order: type → length → single pass tracking line number, comment state, string state (`"`/`'`; a newline inside a string = unclosed), `{}`/`()` depth. Backslash anywhere (also inside strings and comments) → error. Outside strings/comments: an identifier (chars `[A-Za-z0-9_-]` or any code point ≥ U+0080, not starting with a digit) directly followed by `(` is a function — compare lower-cased with `ALLOWED_FUNCTIONS`, `url` gets its own message; `@` + identifier is an at-rule — compare lower-cased with `ALLOWED_AT_RULES`. Unbalanced closers report the line where they occur; unclosed openers report the line of the last character.
- [ ] **Step 4:** Run `test/themeCss.test.js` → PASS.
- [ ] **Step 5: Commit** `Add the CSS allow-list filter for plugin themes`.

---

### Task 2: Theme store, permission `theme`, `ctx.theme`, host wiring

**Files:**
- Create: `plugin-sdk/theme.js`, `plugins/custom-design/plugin.json`
- Modify: `plugin-sdk/manifest.js` (`PERMISSIONS`), `plugin-sdk/context.js` (`createContext` return), `plugin-sdk/host.js` (`deleteData`, `wipeAllData`, returned API)
- Test: `test/pluginTheme.test.js`; extend `test/pluginManifest.test.js`, `test/pluginHost.test.js`

**Interfaces:**
- Consumes: `checkThemeCss` (Task 1); `PluginPermissionError`, `PluginHttpError` from `plugin-sdk/errors.js`.
- Produces:
  - `THEME_COLLECTION = 'pluginThemes'`; stored doc (id = plugin id) `{ css: string, publishedAt: string, draft: string, draftAt: string }` (`''` = none).
  - `createThemeApi(pluginId: string, { granted: Set<string> }) → Readonly<{ saveDraft(css): Promise<void>, discardDraft(): Promise<void>, publish(css): Promise<void>, clear(): Promise<void> }>` — each rejects with `PluginPermissionError('theme')` without the permission; invalid CSS rejects with `new PluginHttpError(400, result.message)`; `publish` stores `css` + `publishedAt` and clears the draft; `clear` deletes the document.
  - `readThemeSheets(pluginIds: string[], { preview?: boolean }) → Promise<string>` — in the given order; sheet = `preview && doc.draft ? doc.draft : doc.css`; empty skipped; **re-checked**, a failing sheet is skipped with `console.warn('[plugin:<id>] Stored theme refused: <message>')`; output `/* plugin: <id> */\n<sheet>\n` per sheet, `''` when none.
  - `deleteTheme(pluginId) → Promise<void>`.
  - `PERMISSIONS.theme = 'Aussehen der ganzen Seite ändern'`.
  - `ctx.theme` = `createThemeApi(id, { granted })`.
  - host: `themeSources(): string[]` — ids of enabled plugins whose manifest permissions include `theme`, sorted; `deleteData(id)` and `wipeAllData()` also call `deleteTheme(id)`.
  - `plugins/custom-design/plugin.json` exactly as in the spec **without** `server` and `client` (added in Tasks 7 and 8).

- [ ] **Step 1: Write the failing tests** (follow the SQLite temp-db pattern of `test/pluginData.test.js`):
  - `theme permission is known and labelled` → `PERMISSIONS.theme === 'Aussehen der ganzen Seite ändern'`; a manifest with `"permissions": ["theme"]` validates.
  - `ctx.theme without the permission rejects` → `await assert.rejects(ctx.theme.publish('.a{}'), PluginPermissionError)`.
  - `invalid css rejects with a German 400` → rejects with `{ name: 'PluginHttpError', status: 400, message: 'Zeile 1: @import ist nicht erlaubt.' }`, nothing stored.
  - `draft, publish and clear are stored per plugin` → two plugin ids, `readThemeSheets(['a','b'])` = `'/* plugin: a */\n.a{}\n/* plugin: b */\n.b{}\n'`; preview of `a` with draft `.d{}` uses the draft; `publish` clears the draft; `clear` → `''`.
  - `a stored sheet that fails the filter is never served` → write `{ css: '.a{background:url(x)}' }` straight with `setDoc` into `pluginThemes/a` → `readThemeSheets(['a'])` = `''`.
  - `ctx.data cannot reach pluginThemes` → `ctx.data.set('pluginThemes', …)` stores under `plugin:<id>:pluginThemes` (the namespacing) and `readThemeSheets` is unaffected.
  - host: `themeSources lists enabled theme plugins only, sorted` and `deleteData and wipeAllData remove the theme document`.
- [ ] **Step 2:** Run the three suites → FAIL.
- [ ] **Step 3:** Implement as in Interfaces; add the manifest file.
- [ ] **Step 4:** Run the suites → PASS; `npm test` → PASS (the new official plugin must not break discovery/guard tests).
- [ ] **Step 5: Commit** `Give plugins a filtered theme store behind the theme permission`.

---

### Task 3: Serve `/theme.css` and `/theme-preview.css`, link it first-paint safe

**Files:**
- Create: `routes/pluginTheme.js`, `public/design-boot.js`
- Modify: `server.js` (mount directly after `app.use('/plugins', createPluginStatic(...))`), `public/index.html` (`<head>`, after the `style.css` link)
- Test: `test/pluginThemeServer.test.js`, `test/designBoot.test.js`

**Interfaces:**
- Consumes: `readThemeSheets`, `host.themeSources()` (Task 2; safe mode makes every plugin not enabled, so the list is empty); `pluginHost()`.
- Produces:
  - `createThemeRouter(getHost) → express.Router` with `GET /theme.css` (public; host not ready → `''`) and `GET /theme-preview.css` (`req.session.user?.isAdmin` else `404` with empty body). Both `Content-Type: text/css; charset=utf-8`; theme `Cache-Control: no-cache` (Express default ETag gives 304), preview `Cache-Control: no-store`. Errors → log + `200` with empty body (a broken theme must never break the page).
  - Markup: `<link rel="stylesheet" href="/theme.css" id="custom-theme">` then `<script src="/design-boot.js"></script>` as the last two elements before `<link rel="icon" …>`.
  - `design-boot.js` (classic script, IIFE, `var` style like `theme-boot.js`): when `location.search` **or** `location.hash` has the parameter `design=standard` → `document.getElementById('custom-theme').disabled = true` and `document.documentElement.setAttribute('data-design', 'standard')`. This attribute is the single source for `isStandardDesign()` (Task 5).

- [ ] **Step 1: Write the failing tests.**
  `test/pluginThemeServer.test.js` (via `startPluginServer` from `test/pluginTestServer.js`; seed `pluginThemes/custom-design` with `runNode` + `plugin-sdk/theme.js` before start, `{ css: ':root{--accent:#123456}', draft: ':root{--accent:#654321}' }`):
  - `theme.css serves the published sheet to anyone` → logged-out `fetch` → 200, body contains `/* plugin: custom-design */` and `#123456`, not `#654321`; `content-type` = `text/css; charset=utf-8`; `cache-control` = `no-cache`; no `set-cookie`.
  - `a repeated request with the ETag answers 304`.
  - `theme.css is reachable while maintenance mode is on` (switch maintenance on the way `test/devServer.test.js` does).
  - `non-ASCII survives` → seed `content: "→ Neu"` → body contains `→ Neu`.
  - `switching the plugin off empties theme.css` → `PUT /api/admin/plugins/custom-design/enabled { enabled: false }` → body `''`; switch back on afterwards.
  - `preview is for admins only` → logged out 404, `member` 404, `admin` 200 with `#654321`, `cache-control: no-store`.
  - `safe mode empties theme.css` → second server with `PLUGINS_SAFE_MODE=true` → `''`.
  `test/designBoot.test.js` (vm like `runBootScript` in `test/theme.test.js`):
  - `design=standard disables the custom theme` for `search: '?design=standard'`, `hash: '#admin?design=standard'`, `search: '?x=1&design=standard'`; not for `'?design=standardx'` or no parameter.
  - `index.html links theme.css last and runs design-boot right after it` → in `<head>`, the `#custom-theme` link comes after `style.css`, no stylesheet after it, `design-boot.js` script directly follows.
- [ ] **Step 2:** Run both suites → FAIL.
- [ ] **Step 3:** Implement router, mount, markup, boot script.
- [ ] **Step 4:** Run both suites → PASS; `test/theme.test.js` still PASS.
- [ ] **Step 5: Commit** `Serve plugin themes as /theme.css before the first paint`.

---

### Task 4: Route option `password: true`

**Files:**
- Modify: `plugin-sdk/context.js` (`addRoute`, `RouteDef` typedef), `routes/plugins.js` (`buildPluginRouter`, `sameRoutes`)
- Test: extend `test/pluginContext.test.js`, `test/pluginRouter.test.js`

**Interfaces:**
- Produces: `RouteDef.password: boolean`. `options.password` must be `undefined` or a boolean, else register error; `password: true` with `access` ≠ `'admin'` → register error `` `${label}: password: true gibt es nur mit access admin.` ``. The router adds, after the access guards, a guard that checks `req.body.password` with `safeEqual(…, process.env.ADMIN_RESET_PASSWORD)` → wrong/missing: `401 { error: 'Ungültiges Admin-Reset-Passwort.' }`; right: `req.body` is replaced by a copy without `password` before `wrapHandler`.

- [ ] **Step 1: Write the failing tests:** `password route needs admin access` (register throws the message above); `wrong or missing password answers 401` (handler not called); `the handler never sees the password` (handler records `body`, gets `{ a: 1 }` for `{ a: 1, password: 'dev' }`); `routes without the option ignore a password field` (body passed unchanged).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `Let plugin routes require the admin reset password`.

---

### Task 5: Frontend core — `ui.theme`, preview bar, password dialog

**Files:**
- Create: `public/js/core/pluginTheme.js`, `public/js/core/passwordDialog.js`
- Modify: `public/js/core/plugins.js` (`createPluginUi`, `pluginRequest`, `unloadPluginTabs`), `public/index.html` (preview bar before `</body>` scripts; `#passwordModal` next to `#confirmModal`), `public/css/style.css` (block `.design-preview-bar`), `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/frontend-app.md`
- Test: `test/pluginThemeClient.test.js` (harness: `loadFrontendApp` as in `test/pluginClient.test.js`)

**Interfaces:**
- Consumes: `/theme-preview.css` (Task 3), `data-design="standard"` (Task 3), `password: true` routes (Task 4).
- Produces:
  - `pluginTheme.js`: `isStandardDesign(): boolean`; `showThemePreview(): void` (sets `#custom-theme` `href` to `/theme-preview.css?v=<n>`, `n` increments per call, shows `#design-preview-bar`); `hideThemePreview(): void` (`href = '/theme.css'`, hides bar); `reloadTheme(): void` (`href = '/theme.css?v=<n>'`); `createThemeUi(permissions: string[]) → Readonly<{ showPreview, hidePreview, reload, isStandardMode }>` — without `theme` every method throws `Error('ui.theme needs the permission theme')`; `showPreview` for a non-admin throws `Error('ui.theme is for admins only')`; in standard mode `showPreview` does nothing. Registers action `endDesignPreview` → `hideThemePreview()`.
  - `passwordDialog.js`: `showPasswordDialog(message: string) → Promise<string|null>` (Bootstrap modal like `showConfirmDialog`; Enter submits; `null` on dismiss; the input is cleared on every open).
  - `ui.theme = createThemeUi(permissions)`; `ui.api.<method>(path, body?, { password?: boolean })` — with `password`: `GET` throws `Error('password needs a mutating method')`; else `showPasswordDialog('Gib das Admin-Reset-Passwort ein, um fortzufahren.')`, `null` → rejects `Error('Abgebrochen.')`, value → sent as `body.password`. Plugin code never receives the value.
  - `unloadPluginTabs()` also calls `hideThemePreview()` (logout ends a preview).
  - Markup: `<div id="design-preview-bar" class="design-preview-bar is-hidden" role="status">` with `bi-eye` icon, text „Vorschau des Design-Entwurfs – nur du siehst ihn.“ and button `data-click="endDesignPreview"` „Vorschau beenden“. `#passwordModal` title „Reset-Passwort eingeben“, ids `password-modal-text`, `password-modal-input` (`type="password"`, `autocomplete="off"`), `password-modal-ok` („Bestätigen“), cancel „Abbrechen“.
  - CSS `.design-preview-bar`: fixed, bottom centre, `z-index: var(--z-banner)`, card surface, subtle border, pill radius, `--shadow-md`; tokens only.

- [ ] **Step 1: Write the failing tests:** `showPreview swaps the theme link and shows the bar`; `each showPreview reloads with a new v`; `hidePreview restores theme.css and hides the bar`; `standard mode keeps theme.css`; `members cannot preview`; `without the theme permission ui.theme throws`; `ui.api with password sends the typed password` (fake dialog answers `'dev'`, request body `{ x: 1, password: 'dev' }`); `a cancelled password dialog rejects with Abgebrochen.`; `logout ends the preview`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; update the two wiki nodes (stylesheet order + `#custom-theme`, `design-boot.js`, preview bar, password dialog, `ui.theme`). **Step 4:** Run the suite + `npm test` (CSP/markup/token guards) → PASS.
- [ ] **Step 5: Commit** `Add ui.theme, the design preview bar and the core password dialog`.

---

### Task 6: Plugin rules (pure)

**Files:**
- Create: `plugins/custom-design/rules.js` (CommonJS, no I/O, no imports outside the folder)
- Test: `test/customDesignRules.test.js`

**Interfaces:**
- Produces (all exported):
  - `TOKEN_KEYS = ['accent','bgPrimary','bgSecondary','bgCard','textPrimary','textSecondary','textMuted']`; `TOKEN_CSS` (`accent → '--accent'`, `bgPrimary → '--bg-primary'`, …); `FIELD_LABELS` (`Akzentfarbe`, `Seitenhintergrund`, `Zweiter Hintergrund`, `Karten`, `Text`, `Text (zweitrangig)`, `Text (gedämpft)`); `SCHEME_LABELS = { dark: 'Dunkel', light: 'Hell' }`.
  - `DEFAULTS = { dark: {…}, light: {…} }` — the seven base values per scheme, copied from `tokens.css`.
  - `DEFAULT_TOKENS = { dark: {…}, light: {…} }` — every token the contrast check reads (`--text-primary`, `--text-secondary`, `--text-muted`, `--accent-text`, `--accent-light`, `--on-accent`, `--accent-fill`, `--accent-fill-hover`, `--bg-primary`, `--bg-secondary`, `--bg-card`, `--bg-glass`, `--bg-glass-hover`), copied from `tokens.css`.
  - `CORNERS = { square: ['4px','6px','8px'], standard: ['8px','12px','16px'], round: ['12px','18px','24px'] }` (sm, default, lg); `FONTS = { inter: null, system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }`.
  - `EMPTY_SOURCE` = every token `''` in both schemes, `corners: 'standard'`, `font: 'inter'`, `css: ''`.
  - `validateSource(body) → { ok: true, source } | { ok: false, message }` — normalises colours (`#abc`/`#ABC`/`#AABBCC` → lower-case `#aabbcc`, `''` stays); messages: „Unbekanntes Feld: <key>.“, „Ungültige Farbe für <Feldlabel> (<Schema>): erlaubt ist #rrggbb.“, „Unbekannte Ecken-Einstellung.“, „Unbekannte Schrift.“, „Das eigene CSS muss Text sein.“, „Das eigene CSS ist zu lang (höchstens 50 000 Zeichen).“ Missing keys fall back to `EMPTY_SOURCE`.
  - `resolveTokens(source, scheme) → Record<string, string>` — final values of `DEFAULT_TOKENS[scheme]` keys with custom + derived values applied.
  - `compileCss(source) → string`; `contrastWarnings(source) → { scheme, text, surface, ratio, message }[]`; `changedLabels(before: Source|null, after: Source) → string[]`; `cssChanged(published: Source|null, draft: Source) → boolean` (`(published?.css ?? '') !== draft.css`).

**Derivation (decided here; the spec left ratios open).** `mix(a, b, t)` = per channel `round(a·(1−t) + b·t)`; `A@α` = `rgba(r, g, b, α)`.

| Token | Dark (accent A) | Light (accent A) |
|---|---|---|
| `--accent-light` | `mix(A, #ffffff, 0.3)` | `mix(A, #000000, 0.12)` |
| `--accent-dark` | `mix(A, #000000, 0.22)` | `mix(A, #000000, 0.27)` |
| `--accent-fill` | `mix(A, #000000, 0.1)` | `A` |
| `--accent-fill-hover` | `--accent-dark` | `--accent-light` |
| `--accent-text` | `--accent-light`, then +10 % toward `#ffffff` per step until ≥ 4.5 on card, page and secondary (max 20 steps) | same, toward `#000000` |
| `--on-accent` | `#ffffff` or `#0a0a0f`, the higher minimum contrast on fill and fill-hover | same |
| tints | `--accent-tint-1` A@0.08, `--accent-tint-2` A@0.15, `--accent-glow` A@0.4, `--border-accent` A@0.3, `--shadow-glow` `0 0 30px A@0.15` | A@0.06, A@0.12, A@0.3, A@0.35, `0 0 24px A@0.12` |
| `--bg-glass` / `--bg-glass-hover` (card C) | C@0.85 / `mix(C, #ffffff, 0.05)`@0.9 | C@0.85 / C@0.95 |
| `--bg-scrim` (page P) | P@0.9 | P@0.9 |

Emit: a base token when custom; the accent family when the accent **or** any surface of that scheme is custom (with the default accent if only surfaces changed, so accent text stays readable); glass when `bgCard` is custom; scrim when `bgPrimary` is custom.

**`compileCss` output** (blocks omitted when empty; `EMPTY_SOURCE` → `''`):

```css
/* Design anpassen: Farben (Dunkel) */
:root:not([data-bs-theme="light"]), [data-bs-theme="dark"] {
  --accent: #123456;
}
/* Design anpassen: Farben (Hell) */
[data-bs-theme="light"] {
  --accent: #654321;
}
/* Design anpassen: Ecken und Schrift */
:root {
  --radius-sm: 4px;
  --radius: 6px;
  --radius-lg: 8px;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
/* Eigenes CSS */
<css>
```

**Contrast pairs:** `--text-primary`, `--text-secondary`, `--text-muted`, `--accent-text`, `--accent-light` on `--bg-primary`, `--bg-secondary`, `--bg-card`, `--bg-glass`, `--bg-glass-hover` (glass composited on `--bg-primary`); `--on-accent` on `--accent-fill`, `--accent-fill-hover`; threshold 4.5. Message: `` `${SCHEME_LABELS[s]}: ${label(text)} auf ${label(surface)} hat ${ratio} : 1 – für gute Lesbarkeit sind mindestens 4,5 : 1 nötig.` `` with the ratio **floored** to one decimal and a German comma (4.46 → `4,4`). Labels: text tokens `Text`, `Text (zweitrangig)`, `Text (gedämpft)`, `Akzent-Text`, `Akzent hell`, `Text auf Akzent-Buttons`; surfaces `Seitenhintergrund`, `Zweiter Hintergrund`, `Karten`, `Glasflächen`, `Glasflächen (Hover)`, `Akzent-Buttons`, `Akzent-Buttons (Hover)`. Colour maths is the plugin's own copy of `public/js/core/contrast.js` (`parseColor`, `composite`, `contrastRatio`). The spec put the warning in the client; it is computed here and returned by the server with every save (one source of truth, still shown within a second of typing).

**`changedLabels`:** per changed colour `` `${FIELD_LABELS[key]} (${SCHEME_LABELS[s]})` ``, then `Ecken`, `Schrift`, `Eigenes CSS geändert` (in this order).

- [ ] **Step 1: Write the failing tests:**
  - `defaults match tokens.css` → parse the dark and light blocks of `public/css/tokens.css`; `DEFAULTS` and `DEFAULT_TOKENS` equal them; `CORNERS.standard` equals `--radius-sm/--radius/--radius-lg`; `--font-body` starts with `'Inter'`.
  - `hex input is normalised` → `#ABC` → `#aabbcc`, `#AABBCC` → `#aabbcc`; `red`, `#12345`, `#1234567` → the colour message with label and scheme.
  - `unknown keys, corners and fonts are refused` (exact messages).
  - `an empty source compiles to nothing` → `compileCss(EMPTY_SOURCE) === ''`.
  - `a dark-only accent never matches light mode` → output contains exactly the dark selector line above and no `[data-bs-theme="light"]` block.
  - `the generated CSS passes the SDK filter` → `checkThemeCss(compileCss(fullSource)).ok` (test may import `plugin-sdk/themeCss.js`; the plugin may not).
  - `free CSS comes last` → `compileCss({ …, css: '.x{}' }).endsWith('/* Eigenes CSS */\n.x{}\n')`.
  - `on-accent picks the readable text colour` → accent `#ffff00` → `#0a0a0f`; `#1e1b4b` → `#ffffff`.
  - `accent text reaches 4.5 when reachable` → dark accent `#3b0764` → `--accent-text` ≥ 4.5 on all three surfaces.
  - `derived from the default accent lands close to the shipped tones` → per channel |Δ| ≤ 40 against `DEFAULT_TOKENS` for `--accent-light`, `--accent-fill`, `--accent-fill-hover` in both schemes.
  - `defaults raise no warnings`; `a known bad pair warns once with the exact message` → light `textMuted: '#bbbbbb'` → contains „Hell: Text (gedämpft) auf Karten hat 1,9 : 1 – für gute Lesbarkeit sind mindestens 4,5 : 1 nötig.“ (compute the expected ratio in the test with the core `contrast.js`, floored).
  - `changedLabels lists what changed` and `cssChanged compares free CSS only`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `Add the rules of the Design anpassen plugin`.

---

### Task 7: Plugin server routes

**Files:**
- Create: `plugins/custom-design/server.js`
- Modify: `plugins/custom-design/plugin.json` (add `"server": "server.js"`)
- Test: `test/customDesignServer.test.js`

**Interfaces:**
- Consumes: `rules.js` (Task 6), `ctx.theme` (Task 2), `password: true` (Task 4), `ctx.data`, `ctx.audit`, `ctx.httpError`.
- Produces (`/api/plugins/custom-design`, every route `access: 'admin'`; data collection `designs`, ids `draft` / `published`):
  - `GET /` → `{ published: Source|null, draft: Draft|null, defaults: DEFAULTS, warnings }` (warnings of `draft ?? published ?? EMPTY_SOURCE`).
  - `PUT /draft` → `validateSource` fail → 400 message; compile; `ctx.theme.saveDraft(css)` — a `status === 400` rejection sets `error` to its message, any other rejection rethrows; stores `{ ...source, error, updatedAt, updatedBy: user.id }` → `{ draft, warnings }`.
  - `DELETE /draft` → `discardDraft()` + delete the draft doc → `{ success: true }`.
  - `POST /publish`, `POST /publish-css` (`password: true`) → shared `publishDraft({ allowCssChange })`: no draft → 409 „Es gibt keinen Entwurf.“; `draft.error` → 409 `` `Das eigene CSS hat einen Fehler: ${draft.error}` ``; `!allowCssChange && cssChanged(published, draft)` → 403 „Eigenes CSS wurde geändert – zum Veröffentlichen ist das Reset-Passwort nötig.“; else `ctx.theme.publish(compileCss(draft))`, store `published` (source + `updatedAt`, `updatedBy`), delete draft, `ctx.audit('publish', user.id, `Design veröffentlicht: ${labels.join(', ') || 'keine Änderungen'}`)` → `{ published }`.
  - `POST /reset` → `ctx.theme.clear()`, delete both docs, `ctx.audit('reset', user.id, 'Design auf Standard zurückgesetzt')` → `{ success: true }`.

- [ ] **Step 1: Write the failing tests** (`startPluginServer`, `loginAt(baseUrl, 'admin'|'member'|'raider')`, `beforeEach` → admin `POST /reset`):
  - `members and raiders get 403 on every route` (all six).
  - `a token draft publishes without the password` → `PUT /draft { tokens: { dark: { accent: '#123456' } } }` → `POST /publish` 200 → logged-out `/theme.css` contains `--accent: #123456;`.
  - `the draft shows only in the preview` → after `PUT /draft`, `/theme.css` unchanged, admin `/theme-preview.css` has the draft.
  - `changed free CSS needs the password` → draft with `css: '.x{}'` → `/publish` 403 (message); `/publish-css` `{ password: 'falsch' }` 401; `{ password: 'dev' }` 200 and `/theme.css` contains `.x{}`.
  - `a filter error is kept with the draft` → `css: '@import "x";'` → 200, `draft.error` = „Zeile 1: @import ist nicht erlaubt.“, preview still the last valid sheet, `/publish-css` with password 409 with the error message.
  - `invalid source answers 400` (colour message).
  - `reset brings the default back` → `/theme.css` `''`, `GET /` `{ published: null, draft: null }`.
  - `publish and reset are audit-logged` → entries `plugin:custom-design:publish` (details list „Akzentfarbe (Dunkel)“) and `plugin:custom-design:reset` (read via the admin audit log API).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `Add the server side of the Design anpassen plugin`.

---

### Task 8: Plugin client

**Files:**
- Create: `plugins/custom-design/client.js`, `plugins/custom-design/assets/view.js`, `plugins/custom-design/assets/saver.js`, `plugins/custom-design/client.css`
- Modify: `plugins/custom-design/plugin.json` (add `"client": "client.js"`)
- Test: `test/customDesignView.test.js` (pure modules via `loadFrontendModules` like `test/eventSubmissionsView.test.js`); existing `test/pluginClientGuards.test.js` covers the folder automatically

**Interfaces:**
- Consumes: the API of Task 7; `ui.theme`, `ui.api(…, { password: true })` (Task 5); `ui.addPage`, `ui.actions.register`, `ui.helpers` (`escapeHtml`, `showToast`, `showConfirmDialog`).
- Produces:
  - `assets/saver.js`: `createDraftSaver({ save: (source) => Promise<object>, delay = 800, setTimer = setTimeout, clearTimer = clearTimeout }) → { schedule(source): void, flush(): Promise<object|null>, pending(): boolean }` — `schedule` debounces; `flush` cancels the timer and saves the latest scheduled source now (resolves `null` when nothing is pending), awaiting a save already running first.
  - `assets/view.js`: `renderDesignPage(model, helpers) → string` with `model = { tab: 'tokens'|'css', source, defaults, warnings, draftError, saveState: 'idle'|'saving'|'saved'|'failed', previewOn, standardMode }`.
  - `client.js`: `register(ui)` → returns without page for non-admins; `ui.addPage({ access: 'admin', title: 'Design anpassen', tab: { label: 'Design', icon: 'bi-palette' }, render, leave })`; `leave` calls `saver.flush()`.
  - Actions (`p:custom-design:` + name): `showTab` (`data-tab`), `setColor` / `setHex` (`data-input`, `data-scheme`, `data-key`; hex field applies only valid values), `clearColor`, `setCorners`, `setFont` (`data-change`), `editCss` (`data-input`), `preview`, `publish`, `discard`, `reset`.

Behaviour (texts exact from the spec): every change → `saver.schedule(source)`; save result updates warnings/`draftError`/`saveState` and, while `previewOn`, calls `ui.theme.showPreview()`. Status line „Speichert …“ / „Entwurf gespeichert“ / the draft error. „Vorschau“ → flush, then `ui.theme.showPreview()` (disabled with standard mode; info line „Eigenes Design ist in diesem Tab ausgeschaltet.“). „Veröffentlichen“ → `await saver.flush()`; disabled while `draftError`; `cssChanged` → `ui.api.post('/publish-css', {}, { password: true })` else `ui.api.post('/publish')`; then `hidePreview()`, `reload()`, toast „Design veröffentlicht.“ (`success`); a rejection → `showToast(err.message, 'danger')` except „Abgebrochen.“. „Entwurf verwerfen“ → `DELETE /draft`, form = published, preview off, toast „Entwurf verworfen.“. „Auf Standard zurücksetzen“ → `showConfirmDialog('Eigenes Design entfernen? Alle sehen wieder das DEMS-Standarddesign.', 'Zurücksetzen')` → `POST /reset`, `hidePreview()`, `reload()`, toast „Design auf Standard zurückgesetzt.“. Escape-hatch hint „Notausgang: Mit ?design=standard in der Adresse lädt DEMS ohne eigenes Design.“ always shown. CSS tab hint per spec. Colour picker shows the default when the value is `''`.

- [ ] **Step 1: Write the failing tests:**
  - saver: `schedule debounces to one save with the latest source` (fake timers); **`flush saves the latest source at once`** → `schedule(a); schedule(b); await flush()` → `save` called once with `b`; `flush waits for a running save, then saves what came after`; `flush with nothing pending resolves null`.
  - view: `both schemes per colour field with the default shown for empty values`; `warnings are listed as escaped text`; `draft error disables publish`; `standard mode disables preview and shows the info line`; `every action name in the markup is a registered p:custom-design: name` (the guard test checks literal registration); `values are escaped` (`css: '</textarea><b>'`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run the suite + `test/pluginClientGuards.test.js` → PASS.
- [ ] **Step 5: Commit** `Add the Design anpassen page with preview and publish flow`.

---

### Task 9: Playwright, wiki, release, final check

**Files:**
- Create: `e2e/customDesign.spec.js`
- Modify: `docs/wiki/concepts/plugin-sdk.md`, `docs/wiki/howto/write-plugin.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/concepts/security.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/graph.json` (via `npm run wiki`), `updates.json`, `package.json` (only if no 3.4.0 entry exists)

- [ ] **Step 1: Write the Playwright spec** (`test.describe.configure({ mode: 'serial' })`; every test resets the design in `finally` through the page's „Auf Standard zurücksetzen“ so parallel specs are unaffected; only corners and accent are published, no other spec asserts them):
  - `a published dark accent shows on the login screen and not in light mode` → admin sets Dunkel accent `#123456`, publishes; new logged-out page: `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#123456'`; with light scheme (`localStorage.dems_theme = 'light'`) it equals the light default `#7c3aed`.
  - `design=standard shows the default` → `/?design=standard` and `/#admin?design=standard` → `--accent` is `#8b5cf6`.
  - `the preview shows the draft only in the admin's tab` → admin changes corners to „Rund“, clicks „Vorschau“, navigates to `#events` → `--radius` `18px`, bar visible; a second browser context → `12px`; „Vorschau beenden“ → `12px`.
- [ ] **Step 2:** `npm run test:e2e -- e2e/customDesign.spec.js` → PASS (fix until green).
- [ ] **Step 3: Wiki:** `concepts/plugin-sdk.md` + `howto/write-plugin.md` — permission `theme`, `ctx.theme`, `ui.theme`, route option `password`, `ui.api` `{ password: true }`, „Who guarantees what“ (filter = SDK, password/audit = plugin), the official plugin as example; `api-index.md` — `/theme.css`, `/theme-preview.css`, the six plugin routes; `security.md` — the filter, why `img-src https:` makes it necessary, serve-time re-check, escape hatch; `data-model.md` — `pluginThemes`, `plugin:custom-design:designs`. Add `plugins/custom-design/*`, `plugin-sdk/theme*.js`, `routes/pluginTheme.js`, `public/design-boot.js` to the nodes' sources and the file → node table in `docs/wiki/index.md`. `npm run wiki`.
- [ ] **Step 4: Release entry:** if `updates.json` has a `3.4.0` release (the SDK's), add a news item to it; else `npm version 3.4.0 --no-git-tag-version` and a new `3.4.0` entry (if `main` already released 3.4.0, use `3.5.0`). Title and text in German in the style of the existing entries (they start the title with one emoji). Content: Admins passen unter „Design“ Farben, Ecken und Schrift für Hell und Dunkel an, mit Kontrast-Warnung, Vorschau und optional eigenem CSS; `?design=standard` als Notausgang.
- [ ] **Step 5: Final verification:** `npm test` → all PASS; `npm run test:e2e` → all PASS; `npm run dev:mock`, log in as `admin`, open „Design“, change accent + publish, reload logged out, reset — no console errors (`read_console_messages` or the browser devtools).
- [ ] **Step 6: Commit** `Document the theme SDK and the Design anpassen plugin`, then hand over for the PR (German title/description: Problem / Ursache / Änderung / Verifikation, „Closes #156“).
