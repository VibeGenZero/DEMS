# Proposal

## Why

Ticket **B-08** (#91, milestone M4 · Discord-Funktionen, depends on F-08). The reminder DM is plain text. A member who reads it and cannot come has to open the website to unregister, so many simply stay away and their place is lost for the waitlist.

## What Changes

- The reminder DM („⏰ Erinnerung! …“) gets two buttons:
  - **„Zum Event“**: link to the event page.
  - **„Ich kann doch nicht“**: asks first („Wirklich von **<Titel>** abmelden?“ with „Ja, abmelden“ / „Abbrechen“), then unregisters the member. The waitlist moves up as on the website. This reuses the confirmation of `/my-events` (B-04), so rules and answers are the same.
- „Ich kann doch nicht“ is left out when unregistering is already closed (the event's unregister deadline has passed) when the reminder goes out; a click after the deadline answers with the existing German refusal.
- **„Zum Kalender“ is dropped:** it was meant to use the calendar export of W-02, which was closed without a calendar export. It can come back if W-02 is picked up again.

Out of scope: buttons on the start DM or the check-in DM, a calendar link.

## Capabilities

### New Capabilities
- `reminder-actions`: what the reminder DM offers — link to the event and unregistering with confirmation — and when the unregister button is offered.

### Modified Capabilities
_None._ How and when reminders are sent (F-08 flags, bot center switch, DM preferences) stays the same.

## Impact

- Code: `bot/scheduler.js` (reminder payload with an action row instead of plain text; `my_leave:<eventId>` routed as today to `handleMyLeaveButton` in `bot/myEvents.js`). No new Discord helper and no new export: the DM still goes through `sendDM`.
- Tests: `test/reminderScheduler.test.js` (payload, button hidden after the unregister deadline, existing assertions read the text of the payload), a click test through `dispatchInteraction` in a DM (no member).
- No new env variable, no new dependency, no data change.
- Wiki: `docs/wiki/concepts/reminders-presence.md`, `docs/wiki/modules/bot.md` (scheduler row, `my_leave` also used by reminders), `docs/wiki/concepts/discord-integration.md`.
