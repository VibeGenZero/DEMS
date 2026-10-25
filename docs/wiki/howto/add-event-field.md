---
id: add-event-field
title: How to add a field to events
type: howto
tags: [howto, events, wizard, schema, admin-ui]
sources: [routes/admin.js, public/index.html, public/js/admin/wizard.js, public/js/events/detail.js, public/js/events/list.js, dev/seedData.js, middleware/validators.js, utils/eventTemplates.js]
depends_on: [data-model, routes-admin, frontend-app]
see_also: [event-lifecycle, add-api-endpoint]
---
# How to add a field to events

> TL;DR: Event fields are whitelisted twice in `routes/admin.js` (create `baseEvent` and update `updates`) — add the field in both, add an input to the event wizard in `public/index.html`, read/write it in `fillWizard()` and `collectEventDraft()` in `public/js/admin/wizard.js`, display it where needed, give it a default in `dev/seedData.js#buildEvent`, and document it in the data-model node.

## Checklist

| # | File | Change |
|---|---|---|
| 1 | `routes/admin.js` | `POST /events`: destructure from `req.body`, add to `baseEvent` with a default (`x \|\| ''`, `!!x`, `parseInt(x) \|\| 0`) |
| 2 | `routes/admin.js` | `PUT /events/:id`: same field in `updates` — otherwise edits silently drop it |
| 3 | `middleware/validators.js` | add a rule to `checkEventFields` (behind `validateEvent`) if the value needs checking (URLs, colours, enums) |
| 3a | `utils/eventTemplates.js` | if the field is a setting an event type repeats (not a date, status or Discord id): add it to `TEMPLATE_FIELDS` with a default in `pickTemplateSettings`, and to the frontend copy in `public/js/admin/wizard-templates.js` — a test keeps both lists equal (event templates, W-10) |
| 4 | `public/index.html` | input in the right wizard step of `#eventModal` (Grundlagen, Datum & Zeit, Teilnehmer & Zugang, Anmeldeformular, Erweitert) |
| 5 | `public/js/admin/wizard.js` | `fillWizard()`: fill the input from the event (also used for templates, W-10; dates and status are set in `editEvent()`); `collectEventDraft()`: put it into the draft (saved and previewed); `showCreateEventModal()`: reset it; a rule in `checkWizardStep` (`admin/wizard-checks.js`) if it can be wrong; `buildPreviewEvent` (`utils/eventPreview.js`) if the card or the announcement show it |
| 6 | `public/js/events/detail.js`, `public/js/events/list.js`, `public/js/admin/event-table.js` | render it (`showEventDetail` / `renderSidebarDetails` / event cards in `showEventsSection` / the admin table in `admin/event-table.js`, only when admins need the field in the list) with `escapeHtml` |
| 7 | `dev/seedData.js` | default in `buildEvent()` (+ example values where useful); counts in `test/seed.test.js` stay unchanged |
| 8 | wiki | row in [data-model](../concepts/data-model.md); `npm run wiki` |

## Notes

- Series instances copy `baseEvent`, duplicates copy the whole document — new fields propagate automatically.
- Every event field is visible to the public through `GET /api/events` (whole documents are spread) — keep secrets out of event documents or strip them in the routes.
- Dates: ISO strings; booleans: store real booleans (`!!value`).
