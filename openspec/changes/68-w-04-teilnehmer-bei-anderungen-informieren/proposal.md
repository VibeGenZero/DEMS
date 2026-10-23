# Proposal

Ticket: **W-04 – Teilnehmer bei Änderungen informieren**, GitLab issue 68, size M, release 3.0.0-beta.2.

## Why

When an admin moves an event to another date or time, or changes its location, nobody is told: the only participant DM tied to an event edit today is the one sent on a cancellation. Members show up at the old time or place, or miss the event.

## What Changes

- **Event wizard (edit mode):** once start, end or location differs from the saved event, a switch "Teilnehmer benachrichtigen" appears next to "Speichern", already switched on. The switch stays hidden when creating an event and when none of the three fields changed (user decision).
- **Server:** `PUT /api/admin/events/:id` takes an optional request flag `notifyParticipants`. When it is `true`, the saved event is `active` and start, end or location really changed, the server sends one DM per participant with every changed field as before → after, plus a link to the event (`buildEventUrl`).
- **Recipients:** members with an `accepted` registration and the accepted guests of those registrations, each user once (user decision). Pending and waitlisted members and invited (not yet accepted) guests get nothing.
- **Feedback for the admin:** the response carries `notifiedCount`; the toast says how many participants were notified. A notification is logged as `NOTIFY_EVENT_CHANGE` in the audit log with the number of recipients and the changed fields.
- The flag is not stored on the event. Without the flag, or with `false`, saving behaves as before.

## Capabilities

### New Capabilities
- `event-change-notifications`: which edits of an event count as a change participants must know about, who is told, what the DM says and how the admin decides it per save.

### Modified Capabilities
- (none — `registration-deadlines`, `waitlist-position`, `attendance-checkin` and `admin-manual-registration` are unaffected)

## Impact

- **Code:** new `utils/eventChangeNotice.js` (change detection, DM text, recipients, sending through the existing `sendDM`), `routes/admin.js` (`PUT /events/:id`), frontend `public/js/admin/wizard.js` (keep the loaded values, read the switch, toast) plus a small new module `public/js/admin/wizard-notify.js` for the switch (wizard.js is already above ~500 lines), `public/index.html` (switch in the wizard footer), `public/js/admin/dashboard.js` (audit chip for `NOTIFY_EVENT_CHANGE`).
- **Discord:** no new Discord API call; the DMs go through the existing `sendDM` helper (`bot.js`) and its mock twin (`dev/mockBot.js`).
- **API:** `PUT /api/admin/events/:id` gains the optional body flag `notifyParticipants` and the response field `notifiedCount`. Additive, no breaking change.
- **Data:** no new event field; new audit action `NOTIFY_EVENT_CHANGE`.
- **Wiki nodes:** `docs/wiki/concepts/event-lifecycle.md` (edit row), `docs/wiki/concepts/discord-integration.md` (status DMs), `docs/wiki/modules/routes-admin.md` (`PUT /events/:id`), `docs/wiki/concepts/data-model.md` (audit actions), `docs/wiki/modules/frontend-app.md` (wizard modules), `docs/wiki/modules/utils.md` (new util), `docs/wiki/ops/testing.md` (new tests).
- No new dependencies, no new environment variables.
