# Helles Farbschema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DEMS gets a light colour scheme (Discord light, violet accent) next to the dark one, chosen in the profile (Hell / Dunkel / System, default System), stored in the browser.

**Architecture:** One attribute `data-bs-theme="dark|light"` on `<html>` drives Bootstrap 5.3 and the DEMS tokens. `tokens.css` holds the dark colour tokens on `:root, [data-bs-theme="dark"]` and the light ones on `[data-bs-theme="light"]`. A tiny classic script `public/theme-boot.js` sets the attribute before the first paint; the ES module `public/js/core/theme.js` owns choice, storage, live system changes and the profile radios.

**Tech Stack:** vanilla ES modules, Bootstrap 5.3.2, CSS custom properties, node:test (`--experimental-vm-modules`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-light-theme-design.md`

## Global Constraints

- Colours, shadows, font sizes, spacing, radii, layers only as tokens in `public/css/tokens.css`; `components.css`/`style.css` get no raw values (`test/cssRules.test.js`).
- No `style="…"`, no `<style>`, no inline scripts or handlers (CSP `'self'`, `script-src-attr 'none'`, `style-src-attr 'none'`); actions via `data-change` + `registerActions` in the owning module.
- `!important` budget in `style.css` stays exactly 29 (`IMPORTANT_BUDGET`); `components.css` only in the colour helpers.
- Everything users see is German; code, comments, commits, wiki in English. No emojis in sources (also not in comments). Symbols are Bootstrap Icons.
- `localStorage` key `dems_theme`, values `light` | `dark` | `system`; missing/invalid → `system`; every read/write in `try/catch`.
- Both schemes pass every AA check: text ≥ 4.5:1, `--accent` ≥ 3:1 as non-text.
- `--discord-*` tokens exist only once (dark/`:root`), the wizard's Discord preview stays dark.
- Dark may shift slightly where a dark-only class is replaced by a token of the same meaning (spec decision 9); list those places in the MR.
- Module ≤ 550 lines, no code on import except `registerActions(...)` (main.js also `document.addEventListener`, `initActions`).
- No new dependency. `npm test` and `npm run test:e2e` green at the end.

## Review Focus

1. Storage blocked or throwing (private mode, `SecurityError`) → app starts in the system scheme, choosing still switches for the session, no console error. Test: Task 2 `theme falls back to system when storage throws`.
2. Stored garbage (`"blue"`, `""`, `"LIGHT"`) → treated as `system`, boot script and module agree. Test: Task 2 `boot script and module resolve the same scheme`.
3. Choice `light`/`dark` while the OS flips → nothing changes; choice `system` → follows live. Test: Task 2 `an explicit choice ignores a system change` + e2e in Task 6.
4. A `[data-bs-theme="dark"]` subtree inside a light page (profile preview tile) really renders dark tokens, and vice versa. Test: Task 1 `a nested scheme attribute overrides every colour token` (selector check) + Task 3 tile markup check.
5. Theme switch mid-transition (hovered card, open dropdown) → no slow cross-fade; durations are 0 while switching. Test: Task 2 `applying a scheme marks the switch and clears it on the next frames`.

---

### Task 0: Commit spec and plan

- [ ] **Step 1:** `git add docs/superpowers/specs/2026-10-18-light-theme-design.md docs/superpowers/plans/2026-10-18-light-theme.md`
- [ ] **Step 2:** Commit `Describe the light colour scheme (D-15)` with a body naming the spec decisions (Discord light, profile toggle, browser storage).

### Task 1: Tokens for two schemes

**Files:**
- Modify: `test/cssSource.js`, `test/designTokens.test.js`, `test/cssRules.test.js` (`COMPONENT_SELECTORS`)
- Modify: `public/css/tokens.css`, `public/css/components.css:12` (bridge)

**Interfaces:**
- Produces: `readSchemeTokens(css: string, scheme: 'dark'|'light') -> Map<string,string>` in `test/cssSource.js` (exported). Dark = declarations of top-level rules whose selector list contains `:root` or `[data-bs-theme="dark"]`; light = dark overlaid with top-level rules whose selector list contains `[data-bs-theme="light"]`. Rules inside `@media` and selectors like `:root.is-theme-switching` are ignored. `readTokens(css)` becomes `readSchemeTokens(css, 'dark')`.
- Produces: CSS class `is-theme-switching` on `<html>` sets `--duration-fast`, `--duration-base`, `--duration-slow` to `0s` (rule `:root.is-theme-switching` in `tokens.css`; `--transition` is defined from `--duration-base` on the same element, so it follows).
- Produces: light colour tokens on `[data-bs-theme="light"]`, usable on any element.

- [ ] **Step 1: Write the failing tests** in `test/designTokens.test.js`:
  - Wrap every existing contrast test in `for (const scheme of ['dark', 'light'])` so the names read e.g. `light: every text colour reaches AA contrast on every surface and on the light tint`; `loadPalette(scheme)` reads `readSchemeTokens(readCss('tokens.css'), scheme)`. `every required token is defined` and `every colour token is one plain colour…` also run per scheme. The Discord preview test and the spacing/layer test stay single.
  - New `the light scheme only overrides colour and shadow tokens`: every property in the light rule matches `COLOR_TOKEN` or `/^--shadow-/`; no `--discord-*`.
  - New `a nested scheme attribute overrides every colour token`: the set of colour/shadow names in the light rule equals the set of colour/shadow names (without `--discord-*`) in the rule whose selector list contains `[data-bs-theme="dark"]`, so a dark subtree inside a light page resets everything.
  - New `switching the scheme turns all durations off`: the rule `:root.is-theme-switching` sets exactly `--duration-fast`, `--duration-base`, `--duration-slow` to `0s`.
  - In `cssRules.test.js` replace `'[data-bs-theme="dark"]'` in `COMPONENT_SELECTORS` by `'[data-bs-theme]'`.
- [ ] **Step 2: Run** `npm test -- --test-name-pattern="scheme|AA|token|component selector"` (or `node --experimental-vm-modules --test test/designTokens.test.js test/cssRules.test.js`). Expected: FAIL (no light rule, no switching rule, bridge selector missing).
- [ ] **Step 3: Implement in `tokens.css`:**
  - `:root` keeps typography, spacing, radius, layers, motion and the `--discord-*` tokens.
  - A rule `:root, [data-bs-theme="dark"]` with today's colour and shadow values (unchanged).
  - A rule `[data-bs-theme="light"]` with the start palette from the spec table (Teil 1). Adjust single values only until all AA checks pass; keep the look "grey page, white cards, Discord dark-grey text, violet accent".
  - `:root.is-theme-switching { --duration-fast: 0s; --duration-base: 0s; --duration-slow: 0s; }`.
  - Header comment: "Design tokens (dark and light scheme)" and one line on how the two blocks work.
- [ ] **Step 4: Implement the bridge** in `components.css`: selector `[data-bs-theme]` instead of `[data-bs-theme="dark"]`; additionally set `--bs-emphasis-color: var(--text-primary)`, `--bs-secondary-bg: var(--bg-secondary)`, `--bs-tertiary-bg: var(--bg-tint-1)`, `--bs-heading-color: var(--text-primary)`.
- [ ] **Step 5: Run** `npm test`. Expected: PASS (all suites).
- [ ] **Step 6: Commit** `Add a light token set next to the dark one` (body: why the attribute selector works on any element; why durations are tokens).

### Task 2: Scheme logic and boot script

**Files:**
- Create: `public/theme-boot.js` (classic script, not under `public/js/`: the module rules there forbid top-level code), `public/js/core/theme.js`, `test/theme.test.js`
- Modify: `public/index.html` (head), `public/js/main.js`, `test/helpers.js` (`loadFrontendApp` fakes), `test/vendorAssets.test.js` or `test/cssRules.test.js` (head order)

**Interfaces:**
- Produces in `core/theme.js`:
  - `export const THEME_STORAGE_KEY = 'dems_theme'`
  - `export const THEME_CHOICES = ['light', 'dark', 'system']`
  - `export function normalizeThemeChoice(value: unknown) -> 'light'|'dark'|'system'` (exact match, else `'system'`)
  - `export function resolveTheme(choice: string, prefersLight: boolean) -> 'light'|'dark'`
  - `export function readThemeChoice() -> 'light'|'dark'|'system'` (try/catch → `'system'`)
  - `export function saveThemeChoice(choice: string) -> void` (try/catch, silent)
  - `export function applyTheme(scheme: 'light'|'dark') -> void`: adds `is-theme-switching` to `document.documentElement`, sets `data-bs-theme`, sets `disabled` of `#flatpickr-dark-css` to `scheme === 'light'`, removes the class after two `requestAnimationFrame`s, then calls every `onThemeChange` listener with `scheme`.
  - `export function setThemeChoice(choice: string) -> void`: normalise, save, apply `resolveTheme(choice, systemPrefersLight())`.
  - `export function onThemeChange(listener: (scheme) => void) -> void`
  - `export function initTheme() -> void`: applies the current choice once (also sets the flatpickr link), listens to `matchMedia('(prefers-color-scheme: light)')` `change` (guarded: `typeof mql.addEventListener === 'function'`) and re-applies only while the stored choice is `system`.
  - `export function syncThemeRadios() -> void`: checks the radio with id `theme-choice-<choice>` via `getElementById` (Task 3 markup; the fake DOM resolves ids only).
  - `registerActions({ setThemeChoice: (el) => setThemeChoice(el.value) })`
- Produces in `public/theme-boot.js`: an IIFE that reads `localStorage['dems_theme']` in try/catch, resolves like `resolveTheme`, sets `document.documentElement.setAttribute('data-bs-theme', …)`. It must not use any identifier that a module under `public/js/` exports (the missing-import check scans names), so use local names like `stored`, `prefersLight`.
- Consumes: Task 1 class `is-theme-switching`.

- [ ] **Step 1: Extend the harness** in `test/helpers.js` `loadFrontendApp`: `document.documentElement` = a fake element whose `setAttribute`/`getAttribute` store attributes (add a real attribute map to `createFakeElement`: `setAttribute(name, value)`, `getAttribute(name)` → stored or `null`); `requestAnimationFrame: noop` in the context; new option `prefersLight = false` so `matchMedia('(prefers-color-scheme: light)')` matches when true, and every `matchMedia` result has `addEventListener(type, fn)` that records `fn`; return a `setSystemLight(bool)` helper from `loadFrontendApp` that flips the answer and calls the recorded listeners; option `storage: 'throws'` gives a `localStorage` whose methods throw a `SecurityError`. Existing tests must stay green.
- [ ] **Step 2: Write the failing tests** in `test/theme.test.js`:
  - `normalizeThemeChoice keeps the three choices and turns anything else into system`: `'light'`, `'dark'`, `'system'` stay; `'blue'`, `''`, `'LIGHT'`, `null`, `undefined`, `1` → `'system'`.
  - `resolveTheme follows the choice and the system only for system`: 6 combinations (`light`/`dark`/`system` × `true`/`false`).
  - `theme falls back to system when storage throws`: app loaded with a `localStorage` whose `getItem`/`setItem` throw (add a `storage: 'throws'` option to the harness); `readThemeChoice()` → `'system'`; `setThemeChoice('light')` does not throw and sets `data-bs-theme` to `light`.
  - `initTheme applies the stored choice and disables the dark date picker in light`: storage `{ dems_theme: 'light' }` → `documentElement.getAttribute('data-bs-theme') === 'light'`, `element('flatpickr-dark-css').disabled === true`; with `'dark'` → `false`.
  - `system follows a live change`: no stored choice, `prefersLight: false` → `dark`; `setSystemLight(true)` → `light`.
  - `an explicit choice ignores a system change`: stored `dark`, `setSystemLight(true)` → stays `dark`.
  - `applying a scheme marks the switch and clears it on the next frames`: after `applyTheme('light')` the class `is-theme-switching` is on `documentElement` (harness rAF is a no-op); with a harness rAF that runs callbacks at once, the class is gone afterwards.
  - `onThemeChange listeners hear every applied scheme`.
  - `boot script and module resolve the same scheme`: run `public/theme-boot.js` with `vm.runInContext` in a context with fake `localStorage` (values `light`, `dark`, `system`, `blue`, missing, throwing) × `matchMedia` light true/false and a recording `document.documentElement`; the attribute equals `resolveTheme(normalizeThemeChoice(value), light)`.
  - `index.html loads the boot script before the first stylesheet`: in `public/index.html` the index of `<script src="/theme-boot.js"></script>` is inside `<head>` and before the first `<link rel="stylesheet"`/`<link href=…css` ; the flatpickr dark link has `id="flatpickr-dark-css"`.
- [ ] **Step 3: Run** `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/theme.test.js`. Expected: FAIL (module and script missing).
- [ ] **Step 4: Implement** `public/js/core/theme.js` and `public/theme-boot.js` per Interfaces; in `index.html` add `<script src="/theme-boot.js"></script>` as the first element after the meta tags in `<head>` and `id="flatpickr-dark-css"` on the `flatpickr/dark.css` link; keep `data-bs-theme="dark"` on `<html>` as fallback. In `main.js` import `initTheme` and call it first thing in the existing first `DOMContentLoaded` listener (or its own `document.addEventListener('DOMContentLoaded', …)` placed before the boot listener).
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `Choose, store and apply the colour scheme` (body: why a classic boot script outside public/js, why the logic exists twice and which test keeps both equal).

### Task 3: Profile row "Darstellung"

**Files:**
- Modify: `public/index.html` (`#account-settings-card`), `public/css/style.css` (profile block), `public/js/pages/profile.js` (call `syncThemeRadios()` in `showProfileSection` next to `loadAccountSettings()`)
- Test: `test/theme.test.js` (or `test/profileView.test.js` if that file owns profile markup checks)

**Interfaces:**
- Consumes: `setThemeChoice` action and `syncThemeRadios()` from Task 2; light/dark tokens on any element from Task 1.
- Produces markup (copy fixed by the spec):
  - Row at the top of `#account-settings-card`, after the heading, followed by `<hr class="border-secondary">`: `<div class="fw-semibold" id="theme-choice-label">Darstellung</div><small class="text-muted d-block">Gilt nur in diesem Browser.</small>`.
  - `<div class="theme-choice" role="radiogroup" aria-labelledby="theme-choice-label">` with three `<label class="theme-choice-option">` each holding `<input class="theme-choice-input" type="radio" name="theme-choice" id="theme-choice-light|dark|system" value="light|dark|system" data-change="setThemeChoice">`, a preview `<span class="theme-choice-preview" data-bs-theme="light|dark" aria-hidden="true">` (System: two halves `<span class="theme-choice-half" data-bs-theme="light">` + `…"dark"`), and the text `Hell` / `Dunkel` / `System`.
  - CSS classes `theme-choice`, `theme-choice-option`, `theme-choice-input` (visually hidden, focusable), `theme-choice-preview`, `theme-choice-half`, `theme-choice-bar` (header strip inside the preview), `theme-choice-surface` (card inside). Preview colours come from tokens inside the nested `data-bs-theme` (`--bg-primary`, `--bg-card`, `--bg-glass`, `--border-subtle`, `--accent`). Active option (`.theme-choice-input:checked + …` or `:has(:checked)`): `--border-accent`/`--accent` border and `--accent-tint-1` background; focus: `--shadow-ring` via `:focus-visible`.

- [ ] **Step 1: Write the failing tests**:
  - `the profile offers light, dark and system as one radio group`: parse `index.html`; inside `#account-settings-card` there is exactly one `role="radiogroup"` with three `name="theme-choice"` radios of values `light`, `dark`, `system`, each `data-change="setThemeChoice"`; the texts `Darstellung` and `Gilt nur in diesem Browser.` appear; the Darstellung row comes before `accept-invitations-toggle`.
  - `each preview tile carries its own scheme`: preview of `light` has `data-bs-theme="light"`, of `dark` `data-bs-theme="dark"`, system has one half of each.
  - `opening the profile marks the stored choice`: harness with storage `{ dems_theme: 'dark' }` and the profile routes used by `test/profileView.test.js`; after `showProfileSection()` `element('theme-choice-dark').checked === true` and the other two are false.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** markup, CSS (tokens only), `syncThemeRadios()` call.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (incl. `frontendCsp` action registration and `cssRules`).
- [ ] **Step 5: Commit** `Let members pick light, dark or system in the profile`.

### Task 4: Remove the dark-only Bootstrap classes

**Files:**
- Modify: `public/index.html`, `public/js/admin/dashboard.js`, `public/js/admin/discord-import.js`, `public/js/core/updates.js`, `public/js/events/guests.js`, `public/js/pages/info.js`, `public/css/style.css` (`.table-dark` rules at ~922-931)
- Test: `test/cssRules.test.js`

**Interfaces:**
- Replacement map (decided):
  - `navbar-dark` → removed (navbar colours come from tokens; check toggler icon in both schemes during Task 7).
  - `text-light`, `text-white` → removed (inherit `--text-primary`).
  - `text-white-50` → `text-secondary`.
  - `bg-dark` on `modal-content` → removed (the modal bridge already paints it); on `list-group-item` in `guests.js` → removed, and `style.css` gets a `.guest-search-results .list-group-item` (or the existing wrapper class) rule with `--bs-list-group-bg: var(--bg-card)`, `--bs-list-group-color: var(--text-primary)`, `--bs-list-group-border-color: var(--border-subtle)`, `--bs-list-group-action-hover-bg: var(--bg-tint-2)`.
  - `table-dark` → removed; in `style.css` the selectors `.table-dark` / `.table-dark th` become `.table` / `.table th`, plus `--bs-table-color: var(--text-primary)`.
  - `btn-close-white` → removed (Bootstrap 5.3 inverts `.btn-close` under `data-bs-theme="dark"` itself).

- [ ] **Step 1: Write the failing test** `no dark-only Bootstrap class is left in the markup or the modules`: for `index.html` and every `frontendSources()` entry, no match of `/(?<![-\w])(navbar-dark|text-light|text-white|text-white-50|bg-dark|table-dark|btn-close-white)(?![-\w])/`.
- [ ] **Step 2: Run** it. Expected: FAIL listing the 34 places.
- [ ] **Step 3: Replace** per the map; move the `.table-dark` rules.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (selector-duplicate and moved-selector tests included).
- [ ] **Step 5: Commit** `Replace the dark-only Bootstrap classes with tokens` (body: list of the small dark shifts, for the MR).

### Task 5: Styleguide shows the active scheme

**Files:**
- Modify: `public/js/pages/debug.js` (`readTokenNames`, new export), `public/js/main.js`
- Test: `test/styleguide.test.js`

**Interfaces:**
- Consumes: `onThemeChange` from Task 2.
- Produces: `export function refreshStyleguideTokens() -> void` in `debug.js`: re-renders `#sg-tokens` only if it already has content (the styleguide was opened).
- `readTokenNames()` collects custom-property names from every style rule of `tokens.css` (deduplicated, first-seen order), not only `:root`.
- `main.js` registers `onThemeChange(refreshStyleguideTokens)` inside its startup listener.

- [ ] **Step 1: Write the failing tests**: `the styleguide lists the tokens of every rule in tokens.css` (fake `document.styleSheets` with one sheet `href` `/css/tokens.css?v=3` and two rules `:root` + `[data-bs-theme="light"]`, names overlap → each name once); `the styleguide re-renders its tokens after a scheme change only once it was opened`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Show the tokens of the active scheme in the styleguide`.

### Task 6: Browser tests

**Files:**
- Modify: `playwright.config.js` (both projects `colorScheme: 'dark'`), `scripts/style-snapshot.js` (`browser.newContext({ viewport, colorScheme: 'dark' })`)
- Create: `e2e/theme.spec.js`

- [ ] **Step 1: Write the tests** in `e2e/theme.spec.js` (use `loginAs` from `e2e/helpers.js`, `test.use({ colorScheme: 'light' })` where needed):
  - `a light system shows the light scheme without a dark first paint`: `colorScheme: 'light'`, before login `page.goto('/')` → `html[data-bs-theme="light"]`; `page.evaluate` on `getComputedStyle(document.body).backgroundColor` → `rgb(242, 243, 245)` (or whatever `--bg-primary` ends up as in Task 1, read from the token).
  - `the profile choice switches at once and survives a reload`: login as `member`, `#profile`, click the label "Dunkel" → `data-bs-theme="dark"` immediately; reload → still `dark`; the `dark` radio is checked.
  - `system follows the operating system live`: choice System, `page.emulateMedia({ colorScheme: 'dark' })` → `dark`; `'light'` → `light`.
  - `the light scheme loads without console errors`: `watchErrors(page)` over events, an event page, profile, admin (persona `admin`) in light → `[]`.
- [ ] **Step 2: Run** `npm run test:e2e`. Expected: PASS for the whole suite (existing specs now pinned to dark).
- [ ] **Step 3: Commit** `Check the colour schemes in the browser`.

### Task 7: Walkthrough, fixes, wiki

**Files:**
- Modify as found: `public/css/tokens.css`, `public/css/style.css`, `public/css/components.css`
- Modify: `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/index.md` (file → node table: `public/theme-boot.js`, `public/js/core/theme.js`), then `npm run wiki`

- [ ] **Step 1: Walk through** the app in mock mode (scratch DB via `DEV_SQLITE_PATH`, start `node dev/start.js` directly, kill by PID afterwards), light and dark, 1440 px, personas `admin` and `member`: login page, overview, event page (incl. registration form, comments, guests search), polls, profile, admin (table, wizard with date picker + editor + Discord preview, maintenance and reset dialogs), bot control, info, styleguide, toasts, dropdowns, loading screen, maintenance/planned banners, panic overlay (styleguide or mock trigger). Take Playwright screenshots into `data/d15/`.
- [ ] **Step 2: Fix** every unreadable or dark-left place with tokens (a scheme-specific value becomes a token in both blocks; no `[data-bs-theme="light"] .x` rules in `style.css`). Add a RED test first where a guard can catch it (e.g. a new token pair in `designTokens.test.js`).
- [ ] **Step 3: Compare dark** with `scripts/style-snapshot.js` against `origin/main` (worktree method from the D-02 notes); every difference must be one of the replaced classes from Task 4 or the bridge additions. Note them for the MR.
- [ ] **Step 4: Update the wiki**: `frontend-markup.md` (two token blocks and their selectors, `is-theme-switching`, bridge on `[data-bs-theme]`, replaced classes, rule "scheme-specific values only as tokens", profile `.theme-choice` component); `frontend-app.md` (boot script, `core/theme.js` exports, `localStorage.dems_theme`, `onThemeChange` → styleguide). Run `npm run wiki`.
- [ ] **Step 5: Run** `npm test` and `npm run test:e2e`. Expected: both PASS.
- [ ] **Step 6: Commit** `Polish the light scheme after the walkthrough` (fixes) and `Describe the colour schemes in the wiki` (or one commit if small).
