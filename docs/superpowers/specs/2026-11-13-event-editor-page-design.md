# Event editor as a full page (3.2.0, part 2 of 3)

## Intent

Creating and editing an event happens in a modal dialog (`#eventModal`, the five-step
wizard). The wizard has grown — slots, form builder, series, banner, bot switches,
preview — and the dialog is too small for it. The editor becomes a page of its own that
uses the whole browser tab, with the preview always visible. It also makes room for the
AI assistant panel of part 3 (`2026-11-13-ai-integration-design.md`).

## Decided by the owner

- Creating and editing an event is "full screen": the whole browser tab, not a dialog.
- The five steps stay (Grundlagen, Datum & Zeit, Teilnehmer, Formular, Erweitert) and
  get the full width.
- The live preview (event card + Discord message) is permanently visible on the right
  instead of only at the end.
- The page has its own address, so reload and the back button do not lose the draft.
- A place for the AI chat as a side panel that can be shown and hidden (built in part 3).
- The mockup `event-editor-fullpage.html` (in `.superpowers/brainstorm/…/content/`,
  local only) was approved as shown.

## Goals

- Every way that opens the wizard today lands on the editor page: new event, edit,
  duplicate, from a template, from a date poll (`startEventFromPoll`), from the Discord
  import.
- Same fields, same checks (`checkWizardStep`), same save requests as today.
- Work in progress survives a reload.

## Non-goals

- No new event fields and no change to `POST/PUT /api/admin/events*` in this part.
- No change to what saving does (status handling, series, announcements, change
  notices). The top bar shows the save actions the wizard has today; the two buttons in
  the mockup ("Als Entwurf speichern", "Veröffentlichen") are illustrative.
- The other dialogs (registrations, announce, poll editor, …) stay dialogs.
- No AI panel yet; only the layout slot for it.

## Anti-goals

- An admin loses a half-written event through reload, back button or a mis-click.
- The page is unusable on a laptop-sized screen because three columns squeeze the form.

## Behaviour

### Address

- `#event-editor/new` and `#event-editor/<eventId>`; admin only (non-admins are routed
  away like on other admin pages). Prefill sources (template, poll, duplicate, import)
  are handed over in module state as today, not in the address.
- "Zurück" and a successful save return to where the admin came from (admin dashboard
  by default, the event page when the edit started there).

### Layout (desktop)

- **Top bar** (sticky): "Zurück", title ("Neues Event" / "Event bearbeiten: <Titel>"),
  autosave note, the save actions. Part 3 adds the "KI-Assistent" toggle here.
- **Step bar** below it: the five steps, clickable as today, with done and error marks.
- **Two columns:** form of the current step on the left (wider), preview on the right
  (sticky): event card on top, Discord message below. Part 3 adds the AI panel as a
  third column on the far right; when it is open the preview column narrows first.
- **Footer of the form column:** "Zurück" / "Weiter: <next step>".

### Layout (smaller screens)

- Medium width: the preview moves behind a "Vorschau" toggle (a drawer or a tab above
  the form) instead of a column.
- Phone: one column, the step bar scrolls sideways, top-bar actions collapse into the
  primary action plus a menu. No horizontal page scroll.

### Preview

- Updates while typing, debounced (~600 ms). The card renders at once through
  `renderEventCard`; the Discord message still comes from
  `POST /api/admin/events/preview`, an older answer is dropped (existing behaviour of
  `wizard-preview.js`).
- A failed preview request shows a quiet note in the preview column, never a toast per
  keystroke.

### Not losing work

- The form state is written to `localStorage` on change (debounced), keyed per editor
  (`new` or the event id). The top bar shows "Entwurf gesichert HH:MM".
- Opening the editor with a stored state restores it and shows a banner
  "Ungespeicherter Entwurf wiederhergestellt" with "Verwerfen". For an existing event
  the stored state is only offered when the event has not been changed on the server
  since (compare `updatedAt`); otherwise it is dropped with a note.
- A successful save and "Verwerfen" delete the stored state. It never holds secrets
  (no check-in code; an uploaded banner is stored as its path only).
- Leaving with unsaved changes (route change, "Zurück") asks once through the dialog
  component; closing the tab uses `beforeunload`.

## Constraints

- The wizard modules under `public/js/admin/wizard*.js` are reused, not rewritten; the
  markup moves from the modal into a new app section. Module size limit ~500 lines.
- `CLAUDE.md` rules: German UI text, tokens only, no inline styles/handlers, existing
  components, Bootstrap Icons, no new dependency.
- Works in the dark and the light scheme; AA contrast (checked by `npm test`).
- Tests first: router/admin-guard test for the new address, unit tests for the stored
  draft (store, restore, stale check, clear), Playwright smoke test "create an event on
  the editor page" replacing the modal one.
- Wiki: `frontend-app.md`, `frontend-markup.md`, the routes table and any node that
  says "wizard modal"; then `npm run wiki`.

## Left to the builder

- Exact address spelling if the router conventions suggest another one.
- Breakpoints, drawer vs. tab for the preview on medium screens.
- How the existing Bootstrap-modal lifecycle hooks of the wizard (open/close events)
  map onto page enter/leave.

## Calls made by Claude (not by the owner)

- Address `#event-editor/…`; prefill sources stay in module state.
- Save semantics unchanged; mockup buttons are illustrative.
- Draft storage in `localStorage` with the stale check, restore banner and leave
  question.
- Preview debounce and behaviour on smaller screens.

## Branch

`feature/event-editor-page` from `release/3.2.0` (after part 1 is merged), PR into
`release/3.2.0`.
