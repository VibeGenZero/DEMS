# Proposal: Evaluations for admins (W-14)

## Why

The admin dashboard only counts: events, registrations, pending, accepted, waitlisted. Admins cannot see how many accepted members actually show up, how full events get, who the most active members are or which kinds of events draw people. Since W-07 (admin check-in) attendance is recorded, and W-15 defined the attendance rules, so the data for these evaluations now exists. Ticket W-14 (GitLab issue 78, prioplan `docs/superpowers/plans/2026-10-07-dems-3.0-prioplan.md`): "Teilnahmequote, No-Show-Quote (angenommen vs. eingecheckt), aktivste Mitglieder, beliebte Kategorien".

## What Changes

- New admin page `#insights` ("Auswertungen"), opened from a button in the admin dashboard header (no new navbar link; the navbar marks "Admin").
- Time range picker: 30 Tage, 90 Tage (default), 12 Monate, Alles. Only events that are over and started in the range count; cancelled events never count.
- Key figures: Teilnahmequote (checked in ÷ accepted) and No-Show-Quote (the rest), both only over events with tracked attendance; number of evaluated events; Auslastung (taken places ÷ places, events with a limit only).
- Top 10 most active members by Teilnahmen in the range, linking to their W-15 member page.
- Categories: per category the number of events, registrations, average participants and Teilnahmequote, shown as bars, most events first.
- Table of the evaluated events: date, title, category, accepted, checked in, no-shows, quote, occupancy; sortable, newest first.
- One new read-only endpoint `GET /api/admin/insights?range=30|90|365|all`.

## Capabilities

### New Capabilities
- `admin-insights`: admin-only evaluation of past events over a chosen time range: attendance and no-show rates, occupancy, most active members, categories and a per-event table.

### Modified Capabilities
- none. The attendance rules ("over", "tracked", "no-show") are taken from `member-overview` unchanged; that spec gets no new requirement.

## Impact

- Server: `routes/admin.js` (one GET route), new pure helper `utils/insights.js` reusing `utils/memberOverview.js` (exports `isOver` and `trackedEventIds`) and `placesOf` from `utils/capacity.js`.
- Frontend: new modules `public/js/admin/insights.js` (loader, range, sort) and `public/js/admin/insights-view.js` (pure markup), section `#insights-section` and dashboard button in `public/index.html`, route in `public/js/core/router.js`, import in `public/js/main.js`, token-based styles in `public/css/style.css`. Bars use the existing `<progress class="capacity-meter">` component.
- No bot, Discord, config or data-model change; no new dependency; no new env variable.
- Wiki nodes: `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/utils.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/index.md` (file → node row for `utils/insights.js`).
