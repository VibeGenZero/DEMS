# Tasks

## 1. Reminder payload

- [x] 1.1 Tests first (RED) in `test/reminderScheduler.test.js`: `buildReminderMessage` (require `bot/scheduler.js`) keeps the text "⏰ **Erinnerung!** Das Event **<Titel>** startet am … Sei bereit!", has „Zum Event“ (link `buildEventUrl(eventId)`) and `my_leave:<eventId>` „Ich kann doch nicht“, no calendar button; with `unregisterDeadline` in the past only „Zum Event“. Implement `buildReminderMessage` (design 1); verify green and the 500-line cap in `test/botModules.test.js`.
- [x] 1.2 Tests first (RED): a due reminder pass sends that payload (with buttons) to the recipients; existing scheduler tests read the text of the payload instead of a string (adapt `/Erinnerung/` assertions). Switch `checkReminders` to `buildReminderMessage`; verify the whole `test/reminderScheduler.test.js` is green.

## 2. Click flow from a DM

- [x] 2.1 Tests (RED where the flow is not yet covered for DMs) in `test/reminderScheduler.test.js` or a new small test through `dispatchInteraction` with a fake DM interaction (no member, mock mode): `my_leave:<eventId>` answers privately „Wirklich von **<Titel>** abmelden?“ with `slot_leave` „Ja, abmelden“ and `my_leave_cancel` „Abbrechen“ and changes nothing; „Abbrechen“ → "Abmeldung abgebrochen."; „Ja, abmelden“ on a full event deletes the registration and the first waitlisted member moves up ("✅ Du wurdest von **<Titel>** abgemeldet."); after the unregister deadline → "❌ Abmelden ist nicht mehr möglich. Wende dich an einen Admin." and the registration stays. Fix anything that fails in a DM; verify green.

## 3. Wiki and verification

- [x] 3.1 Wiki: `docs/wiki/concepts/reminders-presence.md` (reminder DM buttons, hidden after the unregister deadline, no calendar), `docs/wiki/modules/bot.md` (scheduler row `buildReminderMessage`; custom ID table: `my_leave` also in reminders), `docs/wiki/concepts/discord-integration.md`; run `npm run wiki` and verify `node --test test/wiki.test.js`.
- [x] 3.2 Run `npm test` and verify it passes (no website change, so `npm run test:e2e` is not needed).

## Workflow follow-up

- PR from `91-b-08-erinnerungen-mit-buttons` into `feature/m4-discord-funktionen` (German: Problem / Ursache / Änderung / Verifikation); note that „Zum Kalender“ was dropped (W-02 closed) and that the buttons need a click-through on the test server.
- Archive the change with `/opsx:archive` after review.
