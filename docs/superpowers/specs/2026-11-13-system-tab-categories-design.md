# System view with categories on the left (3.2.0, part 1 of 3)

## Intent

The admin view `#system` is one long page: the cards Version, Discord, Server, Sicherheit
and Datenschutzerklärung sit below each other. The owner finds it hard to oversee, and
3.2.0 adds a whole new block of AI settings on top. The view gets a category list on the
left (like Discord's own settings) and shows one category at a time.

This is part 1 of the 3.2.0 release. It ships first, because the AI settings
(`2026-11-13-ai-integration-design.md`) become a category of this view.

## Decided by the owner

- Categories instead of one long page; layout **"categories on the left"** (mockup B),
  each entry with a one-line explanation.
- The six areas: Übersicht, Discord, Server, Sicherheit, KI, Datenschutz.

## Goals

- `#system` shows a category list on the left and the chosen category on the right.
- Every existing setting is still there, with the same rules as today.
- Adding a category later is one list entry plus one panel (the AI branch does that).

## Non-goals

- No new settings in this part (the category "KI" arrives with the AI branch; this
  branch ships five categories).
- No change to the API (`GET/PUT /api/admin/system/*`), to which keys are locked by
  `.env`, or to the password confirmation.
- No redesign of the bot center, the maintenance dialog or the setup wizard.

## Anti-goals

- A setting that silently moved somewhere an admin does not find it.
- Typed but unsaved values that vanish when the admin switches the category.

## Behaviour

### Categories

| Category | Subtitle (German, shown in the list) | Content |
|---|---|---|
| Übersicht | „Version, Status" | the existing version/update card; below it a small status list: bot online/offline (+ server name), database kind (PostgreSQL/SQLite), and — once the AI branch is in — AI on/off with provider |
| Discord | „Bot, Rollen, Kanäle" | the existing Discord fields, incl. the guide button |
| Server | „Adresse, Zeitzone" | the existing server fields |
| Sicherheit | „Reset-Passwort" | the existing security fields |
| KI | „Anbieter, Assistenten" | added by the AI branch |
| Datenschutz | „Datenschutzerklärung" | the existing privacy policy editor with preview |

Subtitles are the builder's to adjust to what the category really holds.

### Navigation

- The category is part of the address: `#system/<category>` (`#system` = Übersicht).
  Reload and browser back/forward keep the category. Unknown category → Übersicht.
- All panels are in the DOM; only the active one is visible (`.is-hidden` +
  `showElement()`), so typed values survive a category switch.
- A category with unsaved changes carries a small dot in the list. Leaving `#system`
  with unsaved changes asks once ("Ungespeicherte Änderungen verwerfen?") through the
  existing dialog component.
- Saving stays per category: the "Speichern" button of a category sends only the
  changed keys of that category through the existing `PUT /api/admin/system/settings`
  (with the existing password dialog). The privacy policy keeps its own save.
- Keyboard: the list is a `nav` with buttons/links, the active one has
  `aria-current="page"`; focus moves to the panel heading after a switch.

### Layout

- Desktop: list ~220 px wide on the left, sticky while the panel scrolls; panel takes
  the rest, with a comfortable maximum line width for form fields.
- Below the tablet breakpoint the list becomes a horizontally scrollable row of chips
  above the panel (subtitle hidden). No horizontal page scroll.
- Built from tokens and existing components only. A new reusable block for the list
  (working name `.settings-nav`) goes into `public/css/components.css` and gets an
  entry in the styleguide (`#debug`). Works in the dark and the light scheme.

## Constraints

- Project rules of `CLAUDE.md`: German UI text, actions via `data-click` +
  `registerActions`, no inline styles, tokens only, Bootstrap Icons, no new dependency.
- `public/js/admin/system.js` must stay ≤ ~500 lines; split the navigation into its own
  module if needed.
- Tests first: router test for `#system/<category>`, a test for the unsaved-changes
  mark, and the Playwright smoke test of the system view adjusted.
- Wiki: update `docs/wiki/modules/frontend-app.md`, `frontend-markup.md` and the
  routes table, then `npm run wiki`.

## Left to the builder

- Exact markup and class names, breakpoint, icon per category.
- Whether the status list of "Übersicht" needs a small new read endpoint or can use
  data the view already loads (prefer the latter).

## Calls made by Claude (not by the owner)

- Address form `#system/<category>`.
- All panels stay in the DOM; unsaved mark and leave question.
- Saving stays per category with the existing endpoints.
- Status list in "Übersicht".
- Chips row on small screens.

## Branch

`feature/system-tab-categories` from `release/3.2.0`, PR into `release/3.2.0`.
