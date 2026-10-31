# Design

## Context

- `bot/scheduler.js` `checkReminders` sends due reminders through `messageAcceptedParticipants(eventId, message, send)` (accepted members who want reminders, W-16). The message is a plain string: "⏰ **Erinnerung!** Das Event **<Titel>** startet am <Zeit>. Sei bereit!". `sendDM(userId, message)` passes strings and `{ content, components }` payloads to `user.send`.
- `/my-events` (B-04, `bot/myEvents.js`) already has the unregister confirmation: `my_leave:<eventId>` → `handleMyLeaveButton` answers privately „Wirklich von **<Titel>** abmelden?“ with `slot_leave:<eventId>` „Ja, abmelden“ and `my_leave_cancel:<eventId>` „Abbrechen“. `handleSlotLeaveButton` (`bot/registration.js`) runs `unregisterUserFromEvent` (deadline check, role removal, waitlist promotion, announcement refresh) and works with `interaction.user`, so it also works in a DM.
- `isUnregisterClosed(event, now)` (`utils/eventListing.js`) is true once `unregisterDeadline` has passed.

## Goals / Non-Goals

**Goals:** reuse the B-04 confirmation unchanged, so reminder and `/my-events` behave the same.

**Non-Goals:** no change to when reminders go out, to the start DM or to the check-in DM; no calendar button (W-02 closed).

## Decisions

1. **Payload builder `buildReminderMessage(event, eventId, now)`** in `bot/scheduler.js` → `{ content, components: [ActionRow] }`. Content: the current text unchanged. Row: Link „Zum Event“ (`buildEventUrl(eventId)`), then — unless `isUnregisterClosed(event, now)` — `my_leave:<eventId>` „Ich kann doch nicht“ (`ButtonStyle.Danger`). Exported from the module for tests (not through `bot.js`: no new Discord call).
   *Alternative:* a new custom ID with its own handler — rejected, it would duplicate the confirmation and the unregister rules.
2. **Routing unchanged.** `my_leave`, `slot_leave`, `my_leave_cancel` are already routed in `bot/interactions.js`; the reminder only emits `my_leave:<eventId>`.
3. **One payload for all recipients.** The buttons do not depend on the member (the unregister rules are checked on click), so `messageAcceptedParticipants` keeps sending one message to everybody.

## Risks / Trade-offs

- [Member left the event between reminder and click] → `unregisterUserFromEvent` answers its usual "not registered" error; nothing changes.
- [Deadline passes after the reminder was sent] → the button is still there; the click is refused by `unregisterUserFromEvent` with the existing message (spec scenario).
- [Mock mode] → reminder DMs are not simulated (internal `sendDM`, bot not ready), as today; covered by `test/reminderScheduler.test.js` and a `dispatchInteraction` click test.
