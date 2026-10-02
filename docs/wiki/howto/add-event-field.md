---
id: add-event-field
title: How to add a field to events
type: howto
tags: [howto, events, wizard, schema, admin-ui]
sources: [routes/admin.js, public/index.html, public/js/app.js, dev/seedData.js, middleware/validators.js]
depends_on: [data-model, routes-admin, frontend-app]
see_also: [event-lifecycle, add-api-endpoint]
---
# How to add a field to events

> TL;DR: Event fields are whitelisted twice in `routes/admin.js` (create `baseEvent` and update `updates`) — add the field in both, add an input to the event wizard in `public/index.html`, read/write it in `editEvent()` and `saveEvent()` in `public/js/app.js`, display it where needed, give it a default in `dev/seedData.js#buildEvent`, and document it in the data-model node.

## Checklist

| # | File | Change |
|---|---|---|
| 1 | `routes/admin.js` | `POST /events`: destructure from `req.body`, add to `baseEvent` with a default (`x \|\| ''`, `!!x`, `parseInt(x) \|\| 0`) |
| 2 | `routes/admin.js` | `PUT /events/:id`: same field in `updates` — otherwise edits silently drop it |
| 3 | `middleware/validators.js` | add a rule to `validateEvent` if the value needs checking (URLs, colours, enums) |
| 4 | `public/index.html` | input in the right wizard step of `#eventModal` (Grundlagen, Datum & Zeit, Teilnehmer & Zugang, Anmeldeformular, Erweitert) |
| 5 | `public/js/app.js` | `editEvent()`: fill the input from the event; `saveEvent()`: put it into the payload; `showCreateEventModal()`: reset it |
| 6 | `public/js/app.js` | render it (`showEventDetail` / `renderSidebarDetails` / event cards in `showEventsSection` / admin cards in `loadAdminEvents`) with `escapeHtml` |
| 7 | `dev/seedData.js` | default in `buildEvent()` (+ example values where useful); counts in `test/seed.test.js` stay unchanged |
| 8 | wiki | row in [data-model](../concepts/data-model.md); `npm run wiki` |

## Notes

- Series instances copy `baseEvent`, duplicates copy the whole document — new fields propagate automatically.
- Every event field is visible to the public through `GET /api/events` (whole documents are spread) — keep secrets out of event documents or strip them in the routes.
- Dates: ISO strings; booleans: store real booleans (`!!value`).
