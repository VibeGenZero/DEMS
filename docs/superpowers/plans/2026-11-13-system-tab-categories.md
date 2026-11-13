# System View Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin view `#system` shows a category list on the left and one category panel at a time, addressable as `#system/<category>`.

**Architecture:** The existing section in `public/index.html` is regrouped into panels; a new module `public/js/admin/system-nav.js` owns the category list, the switch and the unsaved marks, `system.js` keeps loading and saving. The router hands the second hash part to `showSystemSection` and gains a generic leave guard that part 2 (event editor) reuses. No API change except a small `status` object on `GET /api/admin/system/settings`.

**Tech Stack:** Vanilla ES modules, Bootstrap 5 markup, tokens from `public/css/tokens.css`, `node:test` with the fake-DOM harness `loadFrontendApp` (`test/helpers.js`), Playwright (`e2e/`).

**Spec:** `docs/superpowers/specs/2026-11-13-system-tab-categories-design.md`

**Branch:** `feature/system-tab-categories` from `release/3.2.0`; PR (German, Problem / Ursache / Änderung / Verifikation) into `release/3.2.0`.

## Global Constraints

- Everything users see is German; code, comments, commits and the wiki are English.
- Actions only via `data-click` / `data-change` / `data-input` + `registerActions`; no inline handlers, no `style="…"`, no `<style>`.
- Colours, sizes, spacing, radii, layers only as tokens; new CSS goes into `public/css/components.css`; both schemes; AA contrast (`npm test` checks).
- Hidden start state = class `.is-hidden`; show with `showElement()` / `toggleElement()` from `core/ui.js`.
- Icons are Bootstrap Icons, never emojis. No new dependency.
- `public/js/admin/system.js` and every new module stay ≤ ~500 lines.
- Existing element ids used by tests stay: `system-section`, `system-update-body`, `system-discord-fields`, `system-server-fields`, `system-security-fields`, `system-privacy-text`, `system-privacy-preview`, `system-privacy-version`, `system-<KEY>`.
- Test first; `npm test` green before every commit. Commit subject English imperative, body says why, ends with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- The leave question uses `showConfirmDialog(message, confirmLabel, { danger })` from `core/ui.js` (async; in tests the harness option `confirm` of `loadFrontendApp` answers it and `dialogs` records it), never the native `confirm()`.

## Review Focus

- `#system/unknown` or `#system/` → the Übersicht panel, no error, no empty page.
- Switching the category with typed, unsaved values → values still there on return, dot on the category.
- Saving one category while another has unsaved values → only the saved category's keys are sent; the other category keeps its values and its dot after the reload of the settings.
- A category whose every key is locked by `.env` → no "Speichern" button confusion: the button is disabled with the existing "aus .env" chips visible.
- Leaving `#system` with unsaved changes and answering "Abbrechen" → address bar shows `#system/<category>` again and the navbar highlight is unchanged.

---

### Task 1: Router — category parameter and leave guard

**Files:**
- Modify: `public/js/core/router.js` (`handleRoute`, new export)
- Test: `test/systemNav.test.js` (create), `test/systemView.test.js` (router regex test)

**Interfaces:**
- Produces: `export function setLeaveGuard(guard)` in `core/router.js`. `guard` is `null` or `(next: { route: string, param: string|undefined }) => boolean | Promise<boolean>`; `false` cancels the navigation. `handleRoute` remembers the last shown hash. With a guard set and a hash that differs from it, `handleRoute` first puts the remembered hash back with `history.replaceState` and touches no section, then awaits the guard; on `true` it clears the guard and sets `location.hash` to the wanted target (which routes normally), on `false` nothing else happens. `handleRoute` returns that promise so tests can await it.
- Produces: the router calls `showSystemSection(param)`.

- [ ] **Step 1: Write the failing tests** in `test/systemNav.test.js` (use `loadFrontendApp` as `test/systemView.test.js` does; set `harness.state.currentUser = { id: 'a', isAdmin: true }`):

```js
test('a leave guard that answers false keeps the page and restores the address', async () => {
    // show #system, setLeaveGuard(() => false), change the hash to #events, call handleRoute()
    // assert: system-section still display 'block', events section not shown, location.hash === '#system'
});
test('a leave guard that answers true lets the navigation through and is asked with the next route', async () => {
    // guard records its argument; hash -> #event/abc; assert argument deepEqual { route: 'event', param: 'abc' }
});
test('setLeaveGuard(null) removes the guard', async () => {});
```

and change the router regex test in `test/systemView.test.js` to expect `showSystemSection(param);`.

- [ ] **Step 2: Run** `node --experimental-vm-modules --test test/systemNav.test.js test/systemView.test.js` — expected: FAIL (`setLeaveGuard` is not exported).
- [ ] **Step 3: Implement** `setLeaveGuard` and the guard check at the top of `handleRoute` (before timers are cleared), and pass `param` to `showSystemSection`.
- [ ] **Step 4: Run** the two test files — expected: PASS. Then `npm test` — expected: PASS.
- [ ] **Step 5: Commit** — "Let a page veto leaving it and pass the system category to the view".

### Task 2: Category list, panels and the `.settings-nav` component

**Files:**
- Create: `public/js/admin/system-nav.js`
- Modify: `public/index.html` (the block `<section id="system-section" …>`), `public/css/components.css`, `public/js/pages/debug-components.js`, `public/js/admin/system.js` (`showSystemSection(param)`), `public/js/main.js` if modules are listed there
- Test: `test/systemNav.test.js`, `test/styleguide.test.js` (`BLOCKS` gains `'settings-nav'` at the position where the block is rendered), `test/systemView.test.js`

**Interfaces:**
- Produces in `system-nav.js`:
  - `export const SYSTEM_CATEGORIES` — ordered array of `{ id, label, subtitle, icon }`:

    | id | label | subtitle | icon |
    |---|---|---|---|
    | `overview` | Übersicht | Version, Status | `bi-speedometer2` |
    | `discord` | Discord | Bot, Rollen, Kanäle | `bi-discord` |
    | `server` | Server | Adresse, Zeitzone | `bi-hdd-network` |
    | `security` | Sicherheit | Reset-Passwort | `bi-shield-lock` |
    | `privacy` | Datenschutz | Datenschutzerklärung | `bi-file-earmark-lock` |

  - `export function categoryOf(param)` → a known id, else `'overview'`.
  - `export function renderSystemNav(activeId)` — fills `#system-nav`.
  - `export function showSystemCategory(id)` — shows `#system-panel-<id>`, hides the others, sets `aria-current="page"`, moves focus to the panel heading.
  - `export function markCategoryDirty(id, dirty)` / `export function dirtyCategories()` → `string[]`.
  - `export function addSystemCategory(category, afterId)` — inserts into `SYSTEM_CATEGORIES` (part 3 adds `ai` after `security`).
- Markup contract: `div.settings-layout` > `nav.settings-nav#system-nav[aria-label="System-Kategorien"]` + `div.settings-panels` with one `section.settings-panel#system-panel-<id>` per category, each starting with `h3.settings-panel-title[tabindex="-1"]`. Nav entries are `a.settings-nav-item[href="#system/<id>"]` containing icon, `span.settings-nav-label`, `span.settings-nav-sub`, and `span.settings-nav-dot.is-hidden` (unsaved mark, with visually hidden text „ungespeicherte Änderungen").
- Panel content: `overview` = the Version card (+ `#system-status-list`, filled in Task 4); `discord` = guide button + `#system-discord-fields`; `server` = `#system-server-fields`; `security` = `#system-security-fields`; `privacy` = the privacy editor and its save button. The section header text becomes „Einstellungen der Installation. Werte aus .env sind gesperrt und nur dort änderbar."

- [ ] **Step 1: Write the failing tests**

```js
test('categoryOf falls back to the overview', () => {
    // 'discord' -> 'discord'; undefined, '', 'nope', '__proto__' -> 'overview'
});
test('#system/server shows only the server panel and marks its entry', async () => {
    // showSystemSection('server'): system-panel-server visible, the four others isHidden;
    // nav html has href="#system/server" with aria-current="page" exactly once
});
test('#system shows the overview; an unknown category too', async () => {});
test('every category has a panel in index.html', () => {
    // for each id: /<section class="settings-panel[^"]*" id="system-panel-<id>"/
});
```

Keep every existing test of `test/systemView.test.js` green (they call `showSystemSection()` without a parameter).

- [ ] **Step 2: Run** the test files — expected: FAIL (module missing).
- [ ] **Step 3: Regroup the markup** in `public/index.html` to the contract above; remove the shared save bar for now only if Task 3 is done in the same sitting — otherwise leave it below the panels.
- [ ] **Step 4: Implement** `system-nav.js` and call `renderSystemNav` + `showSystemCategory(categoryOf(param))` from `showSystemSection(param)`.
- [ ] **Step 5: Add the component CSS** in `components.css`: `.settings-layout` (two columns: `minmax(0, 220px)` list and the rest; list `position: sticky`), `.settings-nav`, `.settings-nav-item` (+ `:hover`, `[aria-current="page"]` with `--accent-tint-2` / `--accent-text`), `.settings-nav-sub` (`--text-muted`, `--font-size-xs`), `.settings-nav-dot` (`--warning-fill`), `.settings-panel` (form fields capped to a readable width). Below the tablet breakpoint the layout is one column, the nav is a horizontally scrollable row and `.settings-nav-sub` is hidden. Tokens only.
- [ ] **Step 6: Add the styleguide block** `sg-settings-nav` in `debug-components.js` (three sample entries, one active, one with a dot) and the entry in `BLOCKS` of `test/styleguide.test.js`.
- [ ] **Step 7: Run** `npm test` — expected: PASS (includes CSS token, contrast and action-attribute checks).
- [ ] **Step 8: Commit** — "Group the system view into categories with a list on the left".

### Task 3: Save per category, unsaved marks, leave question

**Files:**
- Modify: `public/js/admin/system.js`, `public/index.html` (a save button inside the panels `discord`, `server`, `security`), `public/js/admin/system-nav.js`
- Test: `test/systemView.test.js`, `test/systemNav.test.js`

**Interfaces:**
- Consumes: `markCategoryDirty`, `dirtyCategories`, `setLeaveGuard` (Task 1, 2).
- Produces: `collectChanges(group)` in `system.js` returns only the changed, unlocked keys of that group (`'discord' | 'server' | 'security'`); with no argument all groups (used by the dirty check). Save buttons are `button[data-click="saveSystemSettings"][data-group="<group>"]`; the action reads `el.dataset.group`. A group whose every entry is locked renders its button `disabled`.
- Produces: `fieldHtml` adds `data-input="systemFieldChanged"` (text/password) or `data-change="systemFieldChanged"` (checkbox); the privacy textarea keeps `previewSystemPrivacy`, which additionally updates the mark of `privacy` (dirty = text differs from the loaded one). `systemFieldChanged` recomputes the mark of the field's group from `collectChanges(group)`.
- While `#system` is shown the leave guard is `(next) => next.route === 'system' || dirtyCategories().length === 0 || showConfirmDialog('Ungespeicherte Änderungen verwerfen?', 'Verwerfen')`. Because the router clears a guard that answered `true`, `showSystemSection` sets it again on every call; leaving clears the marks.
- After a successful save only the saved group's fields are re-rendered from the new settings (values typed into other groups stay), its mark is cleared.

- [ ] **Step 1: Write the failing tests**

```js
test('saving the server category sends only server keys', async () => {
    // type into system-SERVER_NAME and system-DISCORD_CLIENT_ID, click save with data-group="server",
    // confirm the password dialog; the PUT body values deepEqual { SERVER_NAME: 'Neu' }
});
test('after saving one category the typed value of another is still there and still marked', async () => {});
test('typing marks the category, restoring the loaded value clears the mark', async () => {
    // dirtyCategories() deepEqual ['server'] then []
});
test('a secret counts as changed only when something was typed', async () => {});
test('a category locked by .env has a disabled save button', async () => {
    // SETTINGS of the test file: the security group has only a locked key
});
test('leaving with unsaved changes asks once; "Abbrechen" stays', async () => {
    // loadFrontendApp(routes, { confirm: false }); hash -> #events; await handleRoute();
    // system-section still shown, dialogs.length === 1, dialogs[0].text === 'Ungespeicherte Änderungen verwerfen?'
});
test('switching the category never asks', async () => {});
```

- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement** the interface above; the shared save bar below the panels is removed.
- [ ] **Step 4: Run** `npm test` — expected: PASS.
- [ ] **Step 5: Commit** — "Save each system category on its own and keep unsaved input visible".

### Task 4: Status list of the overview

**Files:**
- Modify: `routes/adminSystem.js` (`GET /system/settings`), `public/js/admin/system.js`
- Test: `test/systemSettings.test.js` (server), `test/systemView.test.js`

**Interfaces:**
- Produces: `GET /api/admin/system/settings` answers `{ settings, status: { database: 'postgresql' | 'sqlite', bot: { online: boolean, guildName: string } } }`. `database` comes from `selectStoreKind` of `db/config.js` (map its result to the two strings), the bot part from `getBotStatus` / `getGuildName` of `require('../bot')`. No secrets, no ids.
- Produces: `#system-status-list` renders one row per fact with a chip: „Bot" → `chip-success` „online · <Servername>" or `chip-danger` „offline"; „Datenbank" → „PostgreSQL" / „SQLite (eingebaut)". Values escaped with `escapeHtml`. A missing `status` (older answer in tests) renders nothing.
- Part 3 adds a third row „KI"; export `export function renderStatusRows(rows)` taking `[{ label, text, tone }]` so it can append.

- [ ] **Step 1: Write the failing tests** — server: the answer of an admin persona has `status.database === 'sqlite'` and `typeof status.bot.online === 'boolean'`; a member gets 403 as before. View: with `status: { database: 'postgresql', bot: { online: true, guildName: 'Gilde<b>' } }` the list contains `PostgreSQL` and `Gilde&lt;b&gt;`; without `status` the list is empty.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — expected: PASS.
- [ ] **Step 5: Commit** — "Show bot and database status in the system overview".

### Task 5: Browser test and wiki

**Files:**
- Modify: `e2e/admin.spec.js` (the system block near line 499), `e2e/privacy.spec.js` (opens `#system` → use `#system/privacy`), `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/routes-admin.md` (`status`), `docs/wiki/reference/api-index.md` if it lists the answer shape; then `npm run wiki`

- [ ] **Step 1: Extend the Playwright test:** open `#system`, expect `#system-panel-overview` visible and `#system-panel-discord` hidden; click the „Discord" entry, expect the URL to end with `#system/discord`, the existing assertions on `#system-DISCORD_GUILD_ID` to hold; reload, expect the Discord panel still visible; at a 390 px wide viewport expect no horizontal page scroll (`document.documentElement.scrollWidth <= clientWidth`).
- [ ] **Step 2: Run** `npm run test:e2e -- admin privacy` — expected: PASS.
- [ ] **Step 3: Update the wiki nodes** (new module `admin/system-nav.js` with its exports, `setLeaveGuard` in the router row, the `.settings-nav` block, route `#system/<category>`), run `npm run wiki`, then `npm test` — expected: PASS (wiki validation included).
- [ ] **Step 4: Commit** — "Cover the system categories in the browser test and the wiki".
