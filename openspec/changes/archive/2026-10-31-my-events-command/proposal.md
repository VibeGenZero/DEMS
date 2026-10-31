# Proposal

## Why

Ticket **B-04** (milestone M4 · Discord-Funktionen). In Discord a member cannot see which events they are registered for: status, slot and waitlist place exist only on the profile page of the website. Leaving an event or changing the role from Discord is only possible by finding the announcement again and clicking the slot button.

## What Changes

- New slash command `/my-events` (German clients: `/meine-events`, like `/anmelden` from B-03): a private overview of the member's upcoming registrations — the same "upcoming" list as the profile page (not over, not cancelled or archived; next event first).
- Per event: title, start, status (angemeldet, Anfrage ausstehend, Warteliste with place "Platz 2 von 3", abgelehnt) and the slot (or the wished main role while waiting); buttons:
  - **„Abmelden“** — asks first („Wirklich von **…** abmelden?“ with „Ja, abmelden“ / „Abbrechen“); confirming runs the existing unregister flow (role removal, waitlist moves up). Hidden once the unregister deadline has passed and for rejected registrations.
  - **„Slot wechseln“** — only for slot events with a slot taken: a private answer with one button per other free slot („Zu Heiler wechseln“) that uses the existing slot-switch flow. Hidden once registration is closed.
  - **„Zum Event“** — link to the event page.
- At most five events are listed; with more, a closing line points to the profile page for the rest. No registrations → a short German notice with the link to the event overview.
- The dummy data of the mock mode already covers the overview (Mori holds a raid slot with a free other slot, Tom has pending, waitlisted and rejected registrations), so everything can be tried with `npm run dev:mock`; a seed test pins it.

Out of scope: guest entries of other members' registrations, check-in from Discord (B-07), changing the existing slot-answer "Abmelden" (stays without confirmation).

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `discord-slash-commands`: adds `/my-events` (`/meine-events`) with its overview and buttons. The capability is created by the change `register-command-in-discord` (B-03, implemented, not yet archived); this change must be archived after it.

## Impact

- Code: new area module `bot/myEvents.js` (overview, confirmation, slot choice), `bot/commands.js` (command definition + routing), `bot/interactions.js` (new button prefixes), `bot/constants.js` (prefixes), reuse of `utils/profileEvents.js` (`buildProfileEvents`), `utils/capacity.js` (`waitlistPositions`), `handleSlotLeaveButton` / `handleSlotSwitchButton`.
- Mock data: unchanged (the seed already covers every case, see design 8); test `test/seed.test.js`.
- Tests: new `test/myEventsCommand.test.js`.
- No new exports through `bot.js`, no API change, no new env variables, no new dependencies.
- Wiki: `docs/wiki/modules/bot.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/reference/glossary.md` if a German term is added; the profile-page node only if `utils/profileEvents.js` changes.
