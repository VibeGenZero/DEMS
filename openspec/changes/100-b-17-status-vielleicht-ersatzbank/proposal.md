## Why

Raid and team leads need to know who could step in, not only who is in. Today a member can only register bindingly (taking a place) or stay away; "maybe" answers end up in chat and get lost. Ticket #100 (B-17, Prio-Plan 3.0, M4) asks for a non-binding answer that does not count against the places.

## What Changes

- New registration status `tentative`, shown as „Vielleicht“ and, as a group, „Ersatzbank“. It never occupies a place, never moves up by itself and gets no event role, no event channel access, no reminder and no status DM.
- New event setting `allowTentative` (boolean, default off). Only when it is on can members answer „Vielleicht“. Admins switch it in the event wizard; templates carry it. Turning it off keeps existing tentative registrations.
- Members answer „Vielleicht“ with the same checks and form as a registration (event status, end, registration deadline, role requirement, required form fields). On slot events they pick a wanted role (and optional fallbacks). Guests are not allowed.
- A tentative member can **„Fest zusagen“**: the registration goes through the normal place decision (accepted, pending or waitlisted; slot events pick a free role). This counts as a new registration for the waitlist order and is refused once the event is over or the registration deadline has passed.
- A tentative member can withdraw at any time before the event is over, even after the unregister deadline.
- Admins can accept, waitlist or reject a tentative registration (single action and bulk actions); accepting may overbook like the single ✓ does today.
- Website: „Vielleicht“ button next to „Anmelden“, own status „Vielleicht (Ersatzbank)“ with „Fest zusagen“ and „Abmelden“, places area shows „N auf der Ersatzbank“ plus the bench names (and wanted roles on slot events), status labels in profile, cards, admin dialog, member details and CSV.
- Discord: the announcement gets a „Vielleicht“ button in its last row while the event can be joined from Discord and allows it, and the fact line „🤔 Ersatzbank: N“ when N > 0. The button opens the registration modal (form fields; on slot events a role select). `/meine-events` shows „Vielleicht“.
- „Alle Anmeldungen“ in the participant message also reaches tentative registrations.
- Mock mode: the raid event allows „Vielleicht“ and has one tentative registration.

No breaking change: existing events have `allowTentative` unset (= off) and no registration has the new status.

Out of scope: switching an accepted registration down to „Vielleicht“ (members unregister and answer again), automatic promotion from the bench, bench limits, guests for tentative registrations.

## Capabilities

### New Capabilities
- `tentative-registration`: the „Vielleicht“/Ersatzbank status — the event switch, answering, confirming, withdrawing, admin decisions, what it does not grant, and how places and the bench are shown on the website.

### Modified Capabilities
- `discord-announcements`: the facts gain the bench count; the last row gains „Vielleicht“.
- `event-templates`: templates also store `allowTentative`.
- `registration-bulk-actions`: accept, waitlist and reject also apply to tentative registrations.
- `participant-message`: „Alle Anmeldungen“ also reaches tentative registrations.

## Impact

- **Data:** `registrations.status` gains `tentative`; optional `tentativeAt` (time of the „Vielleicht“ answer, kept after confirming). `events.allowTentative` (boolean).
- **Server:** `utils/registrationService.js` (answer, confirm, withdraw), `utils/capacity.js` (bench count and sentence), `utils/slotService.js` (roster bench), `utils/registrationStatus.js`, `utils/bulkRegistrations.js`, `utils/participantMessage.js`, `utils/eventListing.js`, `utils/profileEvents.js`, `utils/eventTemplates.js`, `routes/events.js` (new `POST /api/events/:id/register/confirm`, `tentative` flag on `POST /api/events/:id/register`), `routes/admin.js` (whitelist `allowTentative` in POST and PUT, status target, stats, CSV), `routes/user.js` (stats).
- **Bot:** `bot/messages.js` (button, fact), `bot/constants.js` (`event_maybe` prefix), `bot/interactions.js`, `bot/registration.js` + `bot/registrationModal.js` (tentative path), `bot/myEvents.js`, `bot/settings.js` (stats). No new Discord API call, so no new `bot.js` helper or `dev/mockBot.js` twin.
- **Frontend:** `public/js/events/registration-form.js`, `detail.js`, `slots.js`, `cards.js`, `public/js/pages/profile-view.js`, `public/js/admin/registrations.js`, `registration-bulk.js`, `member-view.js`, the event wizard; markup in `public/index.html`.
- **Mock:** `dev/seedData.js`.
- **No** new env variables, no new dependencies.
- **Wiki nodes:** `docs/wiki/concepts/registration-flow.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/modules/bot.md`, `docs/wiki/modules/routes-events.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/utils.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/dev-mock-mode.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/reference/glossary.md`.
- Ticket: #100 (B-17).
