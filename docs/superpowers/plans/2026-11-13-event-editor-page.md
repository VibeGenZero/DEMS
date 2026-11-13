# Event Editor Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creating and editing an event happens on a full page (`#event-editor/new`, `#event-editor/<eventId>`) with a permanent live preview, instead of in the dialog `#eventModal`.

**Architecture:** The wizard markup moves out of the Bootstrap modal into a new app section; the wizard modules keep their job (steps, checks, collect, fill, save). A new module `admin/editor-page.js` owns opening, closing, the top bar, change tracking and the preview trigger; a small pure module `admin/editor-draft.js` owns the browser-stored draft. Leaving is guarded with `setLeaveGuard` from part 1.

**Tech Stack:** Vanilla ES modules, EasyMDE and flatpickr as today, tokens from `public/css/tokens.css`, `node:test` with `loadFrontendApp` (`test/helpers.js`), Playwright (`e2e/`).

**Spec:** `docs/superpowers/specs/2026-11-13-event-editor-page-design.md`

**Branch:** `feature/event-editor-page` from `release/3.2.0` after part 1 is merged (needs `setLeaveGuard`); PR (German) into `release/3.2.0`.

## Global Constraints

- Same fields, same checks (`checkWizardStep`), same requests (`POST /api/admin/events`, `PUT /api/admin/events/:id`, `POST /api/admin/events/preview`) as today. No backend change in this part.
- Every element id inside the wizard stays (`event-*`, `wizard-page-N`, `wstep-N`, `wizard-btn-*`, `wizard-step-counter`, `wizard-preview*`, `wizard-mode*`, …). Only `eventModal` and `eventModalTitle` disappear; the title element becomes `event-editor-title`.
- Everything users see is German; code, comments, commits, wiki English.
- Actions via `data-*` + `registerActions`; no inline handlers or styles; tokens only; both schemes; Bootstrap Icons; no new dependency.
- Modules ≤ ~500 lines. `admin/wizard.js` is at 549 today and must end below 500 (the open/reset/load code moves out).
- Confirm questions use `showConfirmDialog` from `core/ui.js`.
- `localStorage` access is wrapped in `try/catch`; the editor works without it.
- Test first; `npm test` green before every commit; commits end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

- `localStorage` throws or is full → no error toast, no broken editor; the autosave note is simply not shown.
- A stored draft of an event that was changed on the server since (other admin, Discord, series edit) → never silently restored over the newer data.
- `#event-editor/<id>` of a deleted or unknown event (old bookmark, reload after delete) → toast „Event nicht gefunden." and back to `#admin`, no half-empty form.
- Reload in the middle of step 4 with unsaved input → same step, same input, restore banner visible.
- Browser back with unsaved changes and "Abbrechen" in the question → still on the editor, input intact, address unchanged.

---

### Task 1: Stored draft module

**Files:**
- Create: `public/js/admin/editor-draft.js`
- Test: `test/editorDraft.test.js`

**Interfaces:**
- Produces:
  - `export function draftKey(editId)` → `'dems_event_draft_new'` for `''`/`null`, else `'dems_event_draft_' + editId`.
  - `export function storeDraft(editId, { draft, step, baseUpdatedAt })` → `boolean` (false when storage fails); stores JSON `{ draft, step, baseUpdatedAt, savedAt: <ISO now> }`.
  - `export function readDraft(editId)` → that object or `null` (missing, unparsable, wrong shape).
  - `export function clearDraft(editId)` → `void`.
  - `export function isDraftStale(stored, event)` → `true` when `event` is given and `stored.baseUpdatedAt !== (event.updatedAt || '')`.
  - `export function formatSavedAt(iso)` → `'Entwurf gesichert HH:MM'` (local time, two digits).

- [ ] **Step 1: Write the failing tests** (the harness gives `localStorage`; pass `storage` to `loadFrontendApp` to pre-fill it):

```js
test('a stored draft comes back with step and base time', async () => {});
test('new events and each event id have their own key', async () => {
    // draftKey('') === 'dems_event_draft_new'; draftKey('abc') === 'dems_event_draft_abc'
});
test('unparsable or foreign content reads as null', async () => {
    // storage: { dems_event_draft_new: '{oops' } and '"text"' and '{"draft":5}'
});
test('a storage that throws makes storeDraft answer false and readDraft null', async () => {});
test('a draft is stale when the event was saved since', () => {
    // isDraftStale({ baseUpdatedAt: 'A' }, { updatedAt: 'B' }) === true; equal -> false; no event -> false
});
test('clearDraft removes only its own key', async () => {});
```

- [ ] **Step 2: Run** `node --experimental-vm-modules --test test/editorDraft.test.js` — expected: FAIL (module missing).
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** the file, then `npm test` — expected: PASS.
- [ ] **Step 5: Commit** — "Add the browser store for unsaved event drafts".

### Task 2: Move the wizard from the dialog to a page

**Files:**
- Create: `public/js/admin/editor-page.js`
- Modify: `public/index.html` (the block `<div class="modal fade" id="eventModal" …>` near line 1312 becomes `<section id="event-editor-section" class="app-section is-hidden">` next to the other admin sections; the create button near line 899), `public/js/admin/wizard.js`, `public/js/core/router.js` (`case 'event-editor'`, `NAV_ROUTE['event-editor'] = 'admin'`), `public/js/admin/discord-import.js`, `public/js/polls/admin.js`, `public/js/admin/event-table.js` only if action names change, `public/js/main.js` if modules are listed there
- Test: `test/eventEditorPage.test.js` (create); adjust `test/wizardFlow.test.js`, `test/wizardSeries.test.js`, `test/wizardTemplates.test.js`, `test/wizardBanner.test.js`, `test/wizardAnnounceChannel.test.js`, `test/botSwitchesView.test.js`, `test/adminDashboardLayout.test.js`

**Interfaces:**
- Produces in `wizard.js` (extracted from today's `showCreateEventModal` / `editEvent`, without any modal call):
  - `export async function resetWizard()` — empties every field, loads roles, template choice and bot switches, clears marks, goes to step 1.
  - `export async function loadEventIntoWizard(eventId)` → the loaded event object, or `null` when the server answers not-ok (no toast inside).
  - `saveEvent()` no longer hides a modal; on success it calls `closeEventEditor({ saved: true })` (below) before its existing follow-ups (toasts, poll decision navigation).
- Produces in `editor-page.js`:
  - `export async function openEventEditor({ eventId = '', prefill = null, returnTo = '' } = {})` — remembers `prefill` and `returnTo`, sets the hash to `event-editor/<eventId or 'new'>` and resolves when the editor is ready (it awaits `showEventEditor` itself; the router's own call for the same hash reuses that run instead of resetting the form).
  - `export async function showEventEditor(param)` — called by the router. Shows the section; `new` → `resetWizard()`, then `fillWizard(prefill)` when a prefill is pending; an id → `loadEventIntoWizard(id)`, on `null` toast „Event nicht gefunden." (`danger`) and `navigateTo('admin')`. Title: „Neues Event" or „Event bearbeiten: <Titel>" (set with `textContent`).
  - `export function closeEventEditor({ saved = false } = {})` — forgets the open run and navigates to `returnTo` or `admin`.
  - Actions: `showCreateEvent` (replaces `showCreateEventModal` everywhere, also in tests and in `index.html`), `editEvent` (same name, now `openEventEditor({ eventId })`), `closeEventEditor` for the „Zurück" button.
- Markup contract of the section: `div.editor-topbar` (button „Zurück" `data-click="closeEventEditor"`, `h2#event-editor-title`, `span#event-editor-saved.is-hidden`, `button#event-editor-save` „Speichern" `data-click="saveEventFromTopbar"`, empty `div#event-editor-topbar-extra` for part 3) · the existing step indicator and mode tabs (`.wizard-head`) · `div.editor-body` with `div.editor-form` (the five `wizard-page-N` and the existing footer as `.editor-footer`), `aside.editor-preview` (the existing `#wizard-preview` content) and an empty `aside#event-editor-assist.editor-assist.is-hidden` (part 3).
- `saveEventFromTopbar`: a new event → `saveEvent()`; an existing event → if the current step is not 5, `wizardGoTo(5)` and an info toast „Bitte prüfe die Optionen für das Speichern.", else `saveEvent()` (the notify switch and the series scope live on step 5 and must be seen).
- Callers: `discord-import.js` and `polls/admin.js#startEventFromPoll` call `await openEventEditor({ prefill, returnTo })` instead of `showCreateEventModal()` + manual filling where they fill fields afterwards (keep their extra steps such as `state.pendingPollDecision` and `wizardGoTo`); the event page's edit entry, if one exists, passes `returnTo: 'event/<id>'`.

- [ ] **Step 1: Write the failing tests** in `test/eventEditorPage.test.js`:

```js
test('the editor is a section, the dialog is gone', () => {
    // index.html: /<section id="event-editor-section" class="app-section is-hidden">/; no id="eventModal"
});
test('the router shows the editor only to admins', async () => {
    // member: hash #event-editor/new -> events section; admin -> event-editor-section display 'block'
});
test('#event-editor/new opens an empty wizard on step 1', async () => {
    // title 'Neues Event', wizard-step-counter 'Schritt 1 von 5', event-title value ''
});
test('#event-editor/<id> loads the event', async () => {
    // route '/api/events/e1?status=all': { id: 'e1', title: 'Raid', updatedAt: 'T1', ... } -> title 'Event bearbeiten: Raid'
});
test('an unknown event leads back to the dashboard with a message', async () => {
    // route answers httpAnswer(404, { error: 'x' }); toasts include 'Event nicht gefunden.'; location.hash === '#admin'
});
test('openEventEditor with a prefill fills the wizard once, not twice', async () => {
    // prefill { title: 'Aus Vorlage' }; the router call for the same hash must not reset it
});
test('a saved new event returns to the dashboard, one from the event page returns there', async () => {});
test('the top-bar save of an existing event first shows step 5', async () => {});
```

In the existing wizard tests replace `showCreateEventModal` by `showCreateEvent` and drop modal assertions.

- [ ] **Step 2: Run** `npm test` — expected: the new file FAILS, renamed calls FAIL.
- [ ] **Step 3: Move the markup** and implement `editor-page.js`, the extractions in `wizard.js` and the router case. Remove every `bootstrap.Modal…('eventModal')` call (`grep -rn "eventModal" public` must return nothing).
- [ ] **Step 4: Run** `npm test` — expected: PASS. Check `wc -l public/js/admin/wizard.js` < 500.
- [ ] **Step 5: Commit** — "Open the event wizard as a page instead of a dialog".

### Task 3: Page layout and permanent preview

**Files:**
- Modify: `public/css/style.css` (new block "Event editor page"; remove modal-only wizard rules that no longer match), `public/js/admin/editor-page.js`, `public/js/admin/wizard.js` (`setWizardMode`, `wizardGoTo`), `public/js/admin/wizard-preview.js` (quiet failure note)
- Test: `test/eventEditorPage.test.js`, `test/cssRules.test.js` expectations only if they name removed selectors

**Interfaces:**
- Produces: `export const EDITOR_WIDE_QUERY = '(min-width: 1200px)'` and `export function isPreviewVisible()` in `editor-page.js` — `true` on a wide screen, else `true` only while the mode tab „Vorschau" is active.
- Produces: `export function editorChanged()` in `editor-page.js` — the single entry point for "the form changed". Wired once to `input` and `change` on the editor form, to the EasyMDE `change` event and to the `onChange` of every flatpickr of the wizard. In this task it only schedules the preview: after 600 ms without a further change, and only if `isPreviewVisible()`, call `renderWizardPreview(collectEventDraft(), editId)`.
- Layout: `.editor-topbar` sticky below the navbar; `.editor-body` is a grid — wide: form `minmax(0, 1.25fr)`, preview `minmax(0, 1fr)`, assist column `auto` (0 while hidden; when shown the preview narrows first); the preview column is sticky and scrolls on its own; the mode tabs are hidden on wide screens. Narrow (< 1200 px): one column, the mode tabs switch between form and preview as today. Phone: the step indicator scrolls sideways, top-bar buttons show icons only (labels stay as `aria-label`). No horizontal page scroll at 390 px.
- On a wide screen opening the editor renders the preview once right away; `wizardGoTo` no longer hides the preview there.
- A failed preview request writes „Vorschau gerade nicht verfügbar." into the Discord part of the preview (class `text-muted`), no toast.

- [ ] **Step 1: Write the failing tests** (the harness fakes `matchMedia`; extend `loadFrontendApp` with an option `wide: boolean` answering `EDITOR_WIDE_QUERY`, default `false`, documented in its JSDoc):

```js
test('on a wide screen the preview is visible on every step and drawn on open', async () => {
    // wide: true; requests include POST /api/admin/events/preview after opening; wizard-preview not hidden on step 3
});
test('typing redraws the preview once after the pause, not per key', async () => {
    // three editorChanged() calls, advance fake timers by 600 ms -> exactly one more preview request
});
test('on a narrow screen nothing is requested until the preview tab is chosen', async () => {});
test('a failed preview shows a quiet note and no toast', async () => {});
```

- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement** the CSS block (tokens only) and the behaviour.
- [ ] **Step 4: Run** `npm test` — expected: PASS (token, contrast, style-attribute checks included).
- [ ] **Step 5: Commit** — "Give the event editor the full page with a permanent preview".

### Task 4: Autosave, restore, leave question

**Files:**
- Modify: `public/js/admin/editor-page.js`, `public/index.html` (restore banner `div#event-editor-restored.is-hidden` with text and button „Verwerfen" `data-click="discardEditorDraft"`, at the top of `.editor-form`)
- Test: `test/eventEditorPage.test.js`

**Interfaces:**
- Consumes: `storeDraft`, `readDraft`, `clearDraft`, `isDraftStale`, `formatSavedAt` (Task 1); `setLeaveGuard` (part 1); `editorChanged` (Task 3); `fillWizard`, `collectEventDraft`, `wizardGoTo`, `currentWizardStep`.
- Behaviour of `editorChanged()` in addition to the preview: sets the editor dirty and, 800 ms after the last change, `storeDraft(editId, { draft: collectEventDraft(), step: currentWizardStep, baseUpdatedAt })` where `baseUpdatedAt` is the loaded event's `updatedAt` (`''` for a new event); on `true` shows `#event-editor-saved` with `formatSavedAt`.
- On open, after the form is filled: no pending prefill and `readDraft(editId)` exists → if `isDraftStale(stored, loadedEvent)` then `clearDraft` and an info toast „Der gespeicherte Entwurf war veraltet und wurde verworfen.", else `fillWizard(stored.draft)`, `wizardGoTo(stored.step)`, dirty, banner visible with „Ungespeicherter Entwurf wiederhergestellt". A pending prefill wins: the stored draft of `new` is cleared without a message.
- `discardEditorDraft` → `clearDraft`, reload the form from scratch (`showEventEditor` for the same key), banner hidden.
- A successful save and a confirmed leave call `clearDraft(editId)`.
- Leave guard while the editor is open: `(next) => (next.route === 'event-editor' && next.param === currentKey) || !dirty || showConfirmDialog('Ungespeicherte Änderungen verwerfen?', 'Verwerfen')`. `beforeunload` is registered while dirty (sets `event.returnValue`), removed on close.
- `fillWizard(collectEventDraft())` must reproduce the form: the round-trip test below pins it; fix `fillWizard` where a field does not survive (typical suspects: deadlines, `reminderHours`, `customBotMessages`, `channelConfig`, slots, `location`).

- [ ] **Step 1: Write the failing tests**

```js
test('a filled wizard survives collect -> fill -> collect unchanged', async () => {
    // fill every field kind (dates, deadlines, slots, form fields, reminders, custom messages, channels, location, role gate)
    // const a = collectEventDraft(); await resetWizard(); await fillWizard(a); assert.deepEqual(collectEventDraft(), a)
});
test('a change is stored after the pause and the note shows the time', async () => {
    // localStorage has dems_event_draft_new; event-editor-saved text matches /^Entwurf gesichert \d\d:\d\d$/
});
test('reopening restores draft and step and shows the banner', async () => {});
test('a draft of an event changed on the server is dropped with a note', async () => {
    // stored baseUpdatedAt 'T1', event answers updatedAt 'T2' -> form shows the server title, toast text as above, key removed
});
test('"Verwerfen" removes the draft and shows the server state', async () => {});
test('a prefill wins over a stored draft of a new event', async () => {});
test('saving clears the stored draft', async () => {});
test('leaving a changed editor asks; "Abbrechen" keeps page and input', async () => {
    // { confirm: false }: dialogs.length === 1, section still shown, event-title value kept
});
test('leaving an untouched editor does not ask', async () => {});
test('a storage that throws leaves the editor usable and shows no note', async () => {});
```

- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — expected: PASS.
- [ ] **Step 5: Commit** — "Keep unsaved event input across reloads and ask before leaving".

### Task 5: Browser tests and wiki

**Files:**
- Modify: `e2e/wizard.spec.js`, `e2e/admin.spec.js`, `e2e/csp.spec.js`, `e2e/motion.spec.js`, `e2e/tour.spec.js` (every `#eventModal` selector), `docs/wiki/modules/frontend-app.md` (rows of `admin/wizard.js`, new `admin/editor-page.js`, `admin/editor-draft.js`, router), `docs/wiki/modules/frontend-markup.md`, any node found by `grep -rn "eventModal\|wizard modal\|showCreateEventModal" docs/wiki openspec/specs`; then `npm run wiki`

- [ ] **Step 1: Rewrite the Playwright flow** "create an event": click „Neues Event" on the dashboard → URL ends with `#event-editor/new`, `#event-editor-section` visible; fill the title, reload → title still there and the restore banner visible; walk the steps, save → back on `#admin`, the event is listed. Add: edit from the table → `#event-editor/<id>`; at 1280 px the preview column is visible next to the form; at 390 px no horizontal scroll. Replace `#eventModal` in the other spec files by the section.
- [ ] **Step 2: Run** `npm run test:e2e` — expected: PASS.
- [ ] **Step 3: Update the wiki**, `npm run wiki`, `npm test` — expected: PASS.
- [ ] **Step 4: Commit** — "Cover the event editor page in the browser tests and the wiki".
