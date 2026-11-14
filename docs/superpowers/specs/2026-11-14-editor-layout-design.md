# Event editor: room for the form, sections as cards (3.2.0)

## Intent

Creating an event feels cramped: the editor runs edge to edge, the form shares the
width with a large preview, and with the AI assistant open three columns squeeze the
form to about 560 px. Inside the steps, fields sit three in a row with no grouping.
The owner compared four states on real screenshots
(https://claude.ai/artifact/JgT5Hs96iSi5Y8sdcfDj1J) and chose the column layout of
variant B with the section cards of variant C. Small changes are enough.

## Goals

- From 1200 px the form gets most of the width: preview column narrow (about 360 px)
  and scaled down; opening the AI assistant hides the preview, leaving two columns
  (form | assistant, about 400 px).
- The editor page has a side gutter and a maximum width from 768 px; the step bar is
  compact and centered.
- Every group of fields in a step is its own quiet card (background, subtle border,
  large radius, padding), including the step-5 boxes and the footer bar; the form
  itself has no outer box any more.
- At most two fields per row (the three-in-a-row of step 3 becomes two-and-one).
- More breathing room: spacing between fields and under help texts.

## Non-goals

- No change to fields, steps, validation, saving, preview content or the assistant.
- No new components, no new dependency.

## Anti-goals

- Phones must not get narrower: below 768 px gutters and card padding stay small,
  names like „Schaden" in the slot rows stay readable.
- No double spacing at the top of cards that hold a Bootstrap row.
- Below 1200 px the assistant keeps floating bottom right as today; the preview
  stays behind its tab.

## Constraints

- Tokens only (`public/css/tokens.css`), no `style=""`, CSP unchanged; `npm test`
  (tokens, contrast) green; Bootstrap Icons only.
- Layout CSS lives in the EVENT EDITOR PAGE block of `style.css`.

## Approaches

- **A „Mehr Luft"**: gutters, spacing, two per row — smallest change, but the three
  columns with the assistant stay.
- **B „Fokus aufs Formular"**: A + narrow preview that gives way to the assistant —
  fixes the crowding with AI.
- **C „Abschnitte als Karten"**: A + field groups as cards — more structure, a little
  more scrolling.
- **Chosen: B + C** (owner's pick): B's columns, C's cards.

## Decided

- The assistant panel tells the layout that it is open with a class on
  `.editor-body` (`is-assist-open`, set in `editor-assist.js` when the panel opens or
  closes), not with `:has()`: testable in the view harness, no reliance on `:has()`.
- The three-in-a-row in step 3 changes in the markup (`col-md-4` → `col-md-6`), not
  by overriding Bootstrap.
- The preview is scaled with `zoom` (supported by current Chrome, Edge, Safari,
  Firefox ≥ 126).

## Left to the builder

- Exact widths and the scale factor within the look of the screenshots.
- How the card padding meets the Bootstrap gutters of rows inside a card.
- Tests: a view test for `is-assist-open`, a markup check for no `col-md-4` in the
  editor, a browser test at 1440 px that the preview hides while the assistant is
  open and nothing scrolls sideways at 390 px; the wiki's frontend-markup node.
