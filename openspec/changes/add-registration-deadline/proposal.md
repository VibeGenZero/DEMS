# Proposal

Ticket: **W-03 – Anmeldeschluss (optional Abmeldeschluss)**, GitLab issue 67, milestone M3 (3.0.0-beta.2), size M.

## Why

Today members can register on the website and in Discord until the event ends, and they can unregister at any time, even after the event. Organisers need a fixed line-up some time before the start (raid set-up, food orders, travel), so they need a point after which registrations stop and, optionally, a point after which members can no longer drop out on their own.

## What Changes

- Two new optional event fields: **Anmeldeschluss** (registration deadline) and **Abmeldeschluss** (unregister deadline), each a fixed date and time. Empty means today's behaviour.
- The event wizard (step "Datum & Zeit") gets two date-and-time inputs; a deadline after the event's end is refused in the wizard and by the API.
- After the registration deadline, new registrations are refused on every channel (website, Discord button, Discord modal, slot buttons) with one German message; members also can no longer switch their slot. Existing registrations, guest invitations and waitlist promotion keep working.
- After the unregister deadline, members can no longer unregister themselves (website, `/unregister`, Discord "Abmelden" button); they are told to contact an admin. Admin actions on registrations are unaffected.
- Members see "Anmeldung bis …" / "Abmeldung bis …" on the event page and in the Discord announcement; once the registration deadline has passed, the event page shows that registration is closed and the overview card says "Anmeldung geschlossen".
- When the registration deadline passes, the stored Discord announcements are refreshed once so the "Anmelden" and slot buttons disappear.
- Recurring events: each date of a series gets the same distance between deadline and start as the first date.

## Capabilities

### New Capabilities
- `registration-deadlines`: optional per-event registration and unregister deadlines, how they are set and validated, how they gate member actions on web and Discord, and how members see them.

### Modified Capabilities
- (none — `openspec/specs/` has no capabilities yet)

## Impact

- **Code:** `utils/registrationService.js` (register, slot switch, unregister checks), `utils/eventListing.js` (deadline helpers), `routes/admin.js` (`POST /events` and `PUT /events/:id` whitelist, series offset), `middleware/validators.js`, `routes/events.js` (unregister error mapping), `bot.js` (`canRegisterViaDiscord`, `checkRegistrationConditions`, modal handlers, `/unregister`, "Abmelden" button, `buildEventEmbed`, deadline refresh in the scheduler) and `dev/mockBot.js`, `utils/eventPreview.js`, frontend `public/index.html`, `public/js/admin/wizard.js`, `public/js/admin/wizard-checks.js`, `public/js/events/detail.js`, `public/js/events/registration-form.js`, `public/js/events/cards.js`/`list.js`, `dev/seedData.js`.
- **API:** two new event fields in `POST/PUT /api/admin/events`; new failure codes `registration_closed` and `unregister_closed` inside the registration service, answered as HTTP 400 with a German `{ error }` on the member endpoints. No breaking change: events without the fields behave as before.
- **Data:** two optional ISO-string fields on `events` plus one internal flag; no migration needed (missing = no deadline). Ticket R-01 lists the field for its migration check.
- **Wiki nodes:** `docs/wiki/concepts/registration-flow.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/concepts/event-lifecycle.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/reference/glossary.md`, `docs/wiki/reference/api-index.md` (error codes), `docs/wiki/howto/add-event-field.md` only if the checklist changes.
- No new dependencies, no new environment variables.
