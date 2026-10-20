# Proposal

Ticket: **W-06 – Mitglieder manuell eintragen**, GitLab issue 70, size M.

## Why

Admins cannot register anyone themselves. A member who signed up by voice chat, asked in a DM or forgot to click "Anmelden" can only be told to register on their own, and someone who never logged in to the website cannot be found at all. Organisers need to put members on the list directly, also afterwards, so the list and the attendance (W-07, later W-14) are complete.

## What Changes

- The admin registrations dialog gets a "Mitglied eintragen" area: a search over the members of the Discord server (name or username, at least 2 characters), results with avatar and name; members who are already on the list are marked and cannot be added again. Slot events also show a slot choice.
- A new admin endpoint creates the registration with source **`admin`** and status **accepted** right away, also for events with manual approval.
- The admin overrides the role requirement, required form fields (answers stay empty) and the registration deadline; entries are also possible after the end and for archived events. Drafts and cancelled events refuse them.
- A full event (or a full slot) does not stop the entry: the member is added and the admin gets a warning that the event or slot is now overbooked.
- Before the end the member gets the normal "accepted" DM (event template or global template) plus event role and event channel access, like an accepted self-registration; after the end only the entry is written.
- Every entry is written to the audit log (`ADD_REGISTRATION`).
- The source shows as "Admin" in the dialog and in the CSV export.
- New Discord helpers in `bot.js` (member search, member lookup) with twins in `dev/mockBot.js`.

## Capabilities

### New Capabilities
- `admin-manual-registration`: how admins find server members and register them for an event (search, rules that are overridden, status, capacity warning, notification, audit, source).

### Modified Capabilities
- (none — `registration-deadlines` and `attendance-checkin` keep their requirements: the deadline only gates members, and an admin entry is a normal accepted registration that can be checked in)

## Impact

- **Code:** `bot.js` (`searchGuildMembers`, `fetchGuildMember`) and `dev/mockBot.js`; `utils/registrationService.js` (`REGISTRATION_SOURCE.ADMIN`, new `addRegistrationByAdmin`); `routes/admin.js` (search route, add route, `eventStatus` in the registrations list, CSV source label); `public/index.html` (`#registrationsModal`), `public/js/admin/registrations.js`, `public/js/admin/dashboard.js` (audit chip).
- **API:** `GET /api/admin/events/:id/member-search?q=`, `POST /api/admin/events/:id/registrations`; `GET /api/admin/events/:id/registrations` additionally returns `eventStatus`. No breaking change.
- **Data:** `registrations.source` gains the value `admin`; no new fields, no migration.
- **Discord:** member search over the REST search endpoint (bot already has the `GuildMembers` intent); DMs, role and channel access reuse existing helpers.
- **Wiki nodes:** `docs/wiki/concepts/registration-flow.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/modules/bot.md`, `docs/wiki/concepts/discord-integration.md` (if it lists helpers), `docs/wiki/concepts/data-model.md` (`source`), `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/ops/testing.md`, `docs/wiki/reference/glossary.md` if "Quelle" is listed.
- No new dependencies, no new environment variables.
