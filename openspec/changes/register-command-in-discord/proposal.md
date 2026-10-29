# Proposal

## Why

Ticket **B-03** (milestone M4 · Discord-Funktionen). `/register` only answers "Registrierung über Website erforderlich" with a link, although registering from Discord has worked for a while through the "Anmelden" button, the slot buttons and their modals. Members who type the command are sent away for nothing, and the commands only have English names in a German community.

## What Changes

- `/register event:<autocomplete>` registers directly in Discord with the same flow as the announcement buttons:
  - event without slots → same checks as the "Anmelden" button (maintenance, status, over, deadline, already registered, required role), then the registration modal when the event has a form, otherwise the registration right away;
  - event with slots → after the same checks a private answer listing the slots as buttons (`event_slot:<eventId>:<slotId>`, full slots marked "(voll)"); a click continues in the existing slot flow;
  - form too big for a Discord modal → private answer with the link to the event page (same text as the button).
- The website-link embed of `/register` is removed. **BREAKING** for nobody outside the bot: the answer changes, the command name and option stay.
- German command names through Discord localization: `/register` shows as `/anmelden`, `/unregister` as `/abmelden` for German clients; descriptions are localized too. The internal command names stay `register` / `unregister`, so routing and autocomplete do not change.

Out of scope: `/meine-events` (B-04), filtering the autocomplete to joinable events, changing `/unregister` behaviour.

## Capabilities

### New Capabilities
- `discord-slash-commands`: the bot's slash commands (`/events`, `/register`, `/unregister`), their German names and what each answers.

### Modified Capabilities
- none (`discord-announcements` describes the buttons on announcements; their behaviour is reused, not changed)

## Impact

- Code: `bot/commands.js` (command definitions with localizations, `/register` handler), `bot/registration.js` (reuse `handleEventRegisterButton` / shared checks; new private slot choice), possibly `bot/messages.js` (`buildSlotButton`, `buildRoster` reuse).
- Tests: `test/slotInteractions.test.js` (replace the pinned website-link test), `test/helpers.js` (`createFakeInteraction` needs `showModal`).
- No new exports through `bot.js`, no new env variables, no API change, no new dependencies.
- Wiki: `docs/wiki/modules/bot.md`, `docs/wiki/concepts/discord-integration.md`; glossary entry "Abmeldung" (`/abmelden`).
