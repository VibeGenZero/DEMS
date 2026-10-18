# Event-Seite neu, mobil zuerst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The event page shows the facts first and has exactly one register button, fixed at the bottom on phones.

**Architecture:** `#event-detail-section` gets a CSS grid `.event-page` with areas head / side / status / main instead of Bootstrap's `row`/`col-lg-*`. The register and waitlist buttons live statically in `#sidebar-action-area` and submit their forms through the `form` attribute; `renderSidebarAction` only switches which one shows and whether the phone action bar is on.

**Tech Stack:** vanilla ES modules, Bootstrap 5.3.2, CSS custom properties, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-event-page-mobile-design.md`

## Global Constraints

- Tokens only in CSS; no `style="…"`, no inline handlers (CSP); actions via `data-click` + `registerActions`.
- UI text German, code/comments/commits English, no emojis in sources.
- Keep ids the other code and tests use: `detail-register-area`, `detail-registered`, `detail-waitlist`, `detail-no-access`, `detail-ended`, `register-btn`, `waitlist-btn`, `unregister-btn`, `sidebar-action-area`, `registration-form`, `waitlist-form`.
- Banner height stays 220 px (`events/card-flight.js` and its test).
- Breakpoint for the two-column layout and the phone bar: 992 px (Bootstrap `lg`, as today).
- Module ≤ 550 lines (`events/detail.js` is at 463).
- `npm test` and `npm run test:e2e` green (run e2e three times; the suite shares one database).

## Review Focus

1. Required form field empty, user presses the sticky button far below/above the form → toast and the field scrolls into view and gets focus. Test: Task 2 `a missing required field scrolls into view`.
2. Event without inputs (no form fields, no slots, guests off) → no empty "Anmeldung" card, the button still registers. Test: Task 2 `the form card only shows when there is something to enter`.
3. Switching from one event page to another (register → registered, or full → open) leaves no stale button or bar. Test: Task 2 `each state shows exactly one action and the bar only for register and waitlist`.
4. Phone bar covering the last comment or the comment send button → page has bottom room while the bar shows. Test: Task 3 e2e `the phone keeps the button at the bottom without covering the page end`.
5. Logged out visitor → no bar, no button. Test: Task 2 state test includes `none`.

---

### Task 0: Commit spec and plan
- [ ] `git add` both files, commit `Describe the mobile-first event page (D-05)`.

### Task 1: Page areas

**Files:** `public/index.html` (event detail section), `public/css/style.css` (EVENT DETAIL blocks), `public/js/events/comments.js:16`, `public/js/events/checkin.js:15`, `public/js/events/detail-motion.js:49`, tests `test/eventPage.test.js` (new), `test/detailMotion.test.js`.

**Interfaces — produces:**
- Markup inside `.container.section-container.event-page-container`: back button, then `<div class="event-page">` with children `#detail-head.event-page-head` (tags, `#detail-title`, `#detail-countdown-area`), `#detail-side.event-page-side` (the `.event-detail-sidebar` content), `#detail-status.event-page-status` (`#detail-registered`, `#detail-no-access`, `#detail-ended`; the check-in box is appended here), `#detail-main.event-page-main` (description card, `#detail-participants-section`, `#detail-series-section`, `#detail-register-area`, `#detail-waitlist`; comments appended here).
- CSS: `.event-page { display: grid; gap: var(--space-24); grid-template-areas: "head" "side" "status" "main"; }`, from 992 px `grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); grid-template-areas: "head side" "status side" "main side";` with `.event-page-side` `align-self: start` and the sticky sidebar. `.event-page-status:empty`-safe (no gap when all status cards are hidden: give the status area `display: contents` or hide it via the cards; builder picks, no visible empty gap). `.event-page-container { padding-top: var(--space-24); }` (beats `.section-container`). Below 992 px the detail rows of the sidebar form a two-column grid (`.sidebar-detail-rows`).
- `loadComments` appends to `#detail-main`; `renderCheckinSection` appends to `#detail-status`; `revealDetail` animates `#detail-main`.

- [ ] **Step 1: Failing tests** in `test/eventPage.test.js` (parse `public/index.html`):
  - `the event page areas come in phone order`: inside `#event-detail-section` the ids appear in the order `detail-head`, `detail-side`, `detail-status`, `detail-main`; no `col-lg-8`/`col-lg-4` left in the section.
  - `status cards sit in the status area and the content in main`: `detail-registered`, `detail-no-access`, `detail-ended` between `detail-status` and `detail-main`; `detail-description`, `detail-participants-section`, `detail-series-section`, `detail-register-area`, `detail-waitlist` after `detail-main`.
  - `comments and check-in attach to their areas` (harness: `showEventDetail` of a registered member; `element('detail-main').appendChild`/`element('detail-status').appendChild` received `comments-section` / `checkin-section` — record via the fake element `appendChild` which registers by id, so assert `element('comments-section')` exists and was appended through `detail-main`: wrap `appendChild` of those two fakes in the test to record calls).
  - In `test/detailMotion.test.js` replace `'.col-lg-8'` by `'#detail-main'` (three places).
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3:** implement markup, CSS, the three JS lines.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `Lay out the event page in areas, facts first on phones`.

### Task 2: One action button

**Files:** `public/index.html` (`#sidebar-action-area`, both forms), `public/js/events/detail.js` (`renderSidebarAction`, register/waitlist branches), `public/js/events/registration-form.js` (missing field scroll), tests `test/eventPage.test.js`.

**Interfaces — produces:**
- Static markup in `#sidebar-action-area`: `<button type="submit" form="registration-form" class="btn btn-accent w-100 is-hidden" id="register-btn">…Teilnehmen</button>`, `<button type="submit" form="waitlist-form" class="btn btn-outline-secondary w-100 is-hidden" id="waitlist-btn">…Auf Warteliste setzen</button>`, `<button class="btn w-100 is-hidden" id="sidebar-status-btn" disabled></button>`. No submit button inside `#registration-form` / `#waitlist-form`.
- `renderSidebarAction(mode, event?)`: modes `register`, `waitlist`, `registered`, `noaccess`, `none`. Shows exactly the matching element (status button with "Angemeldet" / "Kein Zugang" as today), hides the others, toggles class `has-action-bar` on `#event-detail-section` (on only for `register` / `waitlist`). `sidebar-register-btn` and the scroll-to-form variant are removed.
- `hasRegistrationInputs(event) -> boolean` (exported from `detail.js`): form fields present, or slots, or guests allowed (`allowGuests !== false`). The register card (`#detail-register-area`) shows only when true; the button shows regardless. Waitlist: `#waitlist-form-fields` area shows only with form fields (the "Event ist voll" text always).
- `submitRegistration`: on missing required fields, after the toast, `scrollIntoView({ behavior: 'smooth', block: 'center' })` and `focus()` on the first missing field element.

- [ ] **Step 1: Failing tests** (`test/eventPage.test.js`):
  - `the register buttons submit their form from the action area`: in `index.html` `register-btn` and `waitlist-btn` are inside `sidebar-action-area` with `form="registration-form"` / `form="waitlist-form"`; `#registration-form` and `#waitlist-form` contain no `type="submit"`.
  - `each state shows exactly one action and the bar only for register and waitlist`: for each mode, call `app.renderSidebarAction(mode, event)` in sequence register → registered → waitlist → noaccess → none → register; after each, count visible among `register-btn`, `waitlist-btn`, `sidebar-status-btn` (none: 0, else 1) and check `element('event-detail-section').classList.contains('has-action-bar')`.
  - `the form card only shows when there is something to enter`: `showEventDetail` with `{ formFields: [], allowGuests: false }` → `detail-register-area` hidden, `register-btn` visible; with `allowGuests: true` → card visible.
  - `a missing required field scrolls into view`: event with one required text field, `showEventDetail`, then `app.submitRegistration('ev', event, 'register-btn', 'dynamic-form-fields')`; the fake `form-field-0` recorded `scrollIntoView` and `focus` (give `createFakeElement` recording `scrollIntoView`/`focus` if needed — a `calls` array).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm test` → PASS (existing `eventEndViews`, `detailMotion`, `registrationService` etc. included).
- [ ] **Step 5:** commit `Keep one register button on the event page`.

### Task 3: Phone action bar and browser checks

**Files:** `public/css/style.css` (EVENT DETAIL — SIDEBAR), `e2e/eventPage.spec.js` (new), existing e2e as needed.

**Interfaces — produces:** below 992 px `#event-detail-section.has-action-bar #sidebar-action-area` is `position: fixed; inset: auto 0 0 0; z-index: var(--z-sticky);` with `--bg-glass`, `backdrop-filter`, top border `--border-subtle`, padding `--space-12 --space-16` plus `env(safe-area-inset-bottom)`; `#event-detail-section.has-action-bar` gets `padding-bottom` so the end of the page stays reachable. From 992 px the area stays in the sticky sidebar.

- [ ] **Step 1: Write e2e** `e2e/eventPage.spec.js`:
  - `the phone shows the facts before the description, in the first screen` (mobile only, member, `#event/dev-event-open`): `#sidebar-date-row` top < `#detail-description` top and bottom < viewport height; page not wider than the viewport.
  - `the phone keeps the button at the bottom without covering the page end` (mobile, member, open event): `#register-btn` visible, its bottom within 1 px of viewport height (after scrolling to the middle too); scroll to the end → the comment send button is fully above the bar.
  - `the desktop shows one register button and no gap under the banner` (desktop): visible buttons in `#event-detail-section` matching `/Teilnehmen|Jetzt anmelden/` = 1; back button top − banner bottom ≤ 40.
  - `a raider without a role gets sent to the role picker` (mobile, raider, `#event/dev-event-role`): click `#register-btn` → toast "Bitte wähle eine Rolle aus." and `#slot-picker-area` in the viewport.
- [ ] **Step 2:** run → the CSS-dependent ones FAIL.
- [ ] **Step 3:** implement CSS.
- [ ] **Step 4:** `npm run test:e2e` three times → PASS.
- [ ] **Step 5:** commit `Pin the register button to the bottom on phones`.

### Task 4: Walkthrough and wiki
- [ ] Screenshots desktop and phone, dark and light, personas member, raider, newbie, admin (registered, role event, form event, full event, ended event, logged out); fix what looks off (tokens only).
- [ ] Wiki: `frontend-markup.md` (event page row of the index.html table: areas and ids; `style.css` block note), `frontend-app.md` (`renderSidebarAction`, `hasRegistrationInputs`, comments/check-in placement, motion target); `npm run wiki`.
- [ ] `npm test`, `npm run test:e2e` → PASS; commit `Describe the new event page in the wiki` (+ fixes commit if any).
