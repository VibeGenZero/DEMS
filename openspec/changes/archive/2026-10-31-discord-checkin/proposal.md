# Proposal

## Why

Ticket **B-07** (#90, milestone M4 · Discord-Funktionen, depends on W-07). Members can check in only by typing the event's six-digit code on the website. During an event they are in Discord, not on the website, so many never check in and the no-show numbers (W-14) and the `perfect-attendance` badge come out wrong.

## What Changes

- When an event with check-in switched on (the admin generated a code, `checkinEnabled` + `checkinCode`) starts, every accepted participant who is not checked in yet gets a DM with an **„Einchecken“** button.
- This DM is sent even when the bot center switch „Start-Benachrichtigungen“ is off and when the member switched off „Erinnerungen“ in the profile: check-in is part of taking part, not a reminder. A member who gets the start DM anyway gets **one** message: the start DM with the button.
- The invitation is sent once per registration (flag on the registration). Members who are accepted while the event runs, and events whose admin generates the code only after the start, get their DM in the next scheduler pass; generating the code during the event also sends the DMs at once.
- A click checks the member in when they still hold an accepted registration and the event is active, has check-in switched on and runs (from start until it is over: end, else start + 2 h). The DM then shows that the member is checked in, without the button, plus the event's check-in message. Other cases answer with a short German reason.
- A Discord check-in counts everywhere a code check-in counts (profile, badge, event page, admin stats, export, no-show rate).
- The code on the website stays available unchanged; admins can still tick members off (W-07).

Out of scope: a check-in button on the channel announcement, check-in before the start, taking a check-in back in Discord, a separate per-event switch for the Discord check-in.

## Capabilities

### New Capabilities
- `discord-checkin`: check-in invitations by DM at the start of an event and the „Einchecken“ button — who gets one, when, how often, and what a click does.

### Modified Capabilities
_None._ The requirements of `attendance-checkin` (code check-in stays available, admin check-in) are unchanged; the Discord check-in sets the same fields.

## Impact

- Code: new bot area module `bot/checkin.js` (invitation payload, sending, button handler), `bot/scheduler.js` (invitations in each pass, merged with the start DM), `bot/constants.js` + `bot/interactions.js` (prefix `event_checkin`), `bot.js` export `sendCheckinInvitations` with a twin in `dev/mockBot.js`, new `utils/checkin.js` (shared rules: is check-in open, check a member in; used by the button and the code route), `routes/events.js` (code route uses the shared helper, same answers), `routes/admin.js` (`generate-checkin` sends the invitations at once while the event runs).
- Data: registrations get the optional field `checkinInvitedAt` (ISO string).
- Tests: new `test/discordCheckin.test.js`, `test/reminderScheduler.test.js`, `test/devServer.test.js` (code route unchanged, generate during the event), `test/botModules.test.js` + `test/botRealExports.test.js` (export list).
- No new env variable, no new dependency, no UI change on the website.
- Wiki: `docs/wiki/modules/bot.md`, `docs/wiki/concepts/reminders-presence.md`, `docs/wiki/concepts/event-lifecycle.md` (check-in), `docs/wiki/concepts/discord-integration.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/modules/utils.md`, `docs/wiki/modules/routes-events.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/dev-mock-mode.md`.
