# Proposal: Member overview for admins (W-15)

## Why

Admins can see who registered for one event, but not who their members are across events: there is no list of the `users` collection, no search and no way to see one member's participation history (how often they register, attend, check in or stay away). Ticket W-15 (GitLab issue 79, prioplan `docs/superpowers/plans/2026-10-07-dems-3.0-prioplan.md`) asks for exactly that: "Liste aus `users` mit Suche und Teilnahmeverlauf".

## What Changes

- New admin page `#members` ("Mitglieder"), reachable from a new admin-only navbar link (between "Admin" and "Bot-Zentrale") and a button in the admin dashboard header.
- The page lists every document of the `users` collection with avatar, display name, username, and per member the numbers Anmeldungen, Teilnahmen, Check-ins, No-Shows and "Letzte Aktivität". The list can be searched (display name, username, Discord id) and sorted by name, each number and last activity.
- Clicking a member opens `#member/<id>`: profile card with account info ("Dabei seit", last activity, guest invitations on/off, the three DM choices of W-16), the same numbers, and the member's complete participation history (every registration, upcoming and past: event with link, date, status, check-in, no-show mark, source Web/Discord/Admin, slot; deleted events as "Gelöschtes Event").
- Two new read-only admin endpoints: `GET /api/admin/members` and `GET /api/admin/members/:id`.
- Read-only: no edit, delete or export actions; form answers are not shown.

## Capabilities

### New Capabilities
- `member-overview`: admin-only list of the community's members (from `users`) with search, sorting and participation numbers, and one member's account info and full participation history.

### Modified Capabilities
- none (the existing `attendance-checkin` rule "admin check-ins count like code check-ins" already covers that both kinds count here; it gets no new requirement).

## Impact

- Server: `routes/admin.js` (two GET routes, static paths before any `/:id`-style routes of the same prefix), new pure helper `utils/memberOverview.js` (numbers and history, reusing `toProfileEntry` from `utils/profileEvents.js`, `isEventOver` from `utils/eventListing.js`, `normalizeNotificationPrefs` from `utils/notificationPrefs.js`).
- Frontend: new modules `public/js/admin/members.js` (loader, search, sort, actions) and `public/js/admin/member-view.js` (pure markup), two sections in `public/index.html`, nav link in `public/index.html` + `public/js/core/auth.js`, routes in `public/js/core/router.js`, imports in `public/js/main.js`; styles from existing components plus a few token-based rules in `public/css/style.css`.
- No bot, Discord, config or data-model change; no new dependency; no new env variable.
- Wiki nodes: `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/concepts/data-model.md` (the `users` section names the new reader), `docs/wiki/index.md` (file → node table for the new files).
