# Tasks

## 1. Links and data

- [x] 1.1 Test first (RED) for `buildSiteUrl('profile')` / `buildSiteUrl('events')` in the existing event-URL test (or `test/myEventsCommand.test.js`): `${BASE_URL}/#profile`, default base `http://localhost:3000`. Add `buildSiteUrl` to `utils/eventUrl.js` (design 7); verify green.
- [x] 1.2 Create `test/myEventsCommand.test.js` (mock mode with its own SQLite, like `test/slotInteractions.test.js`) and write tests first (RED) for `loadUpcomingRegistrations(userId)` from the new `bot/myEvents.js`: past, cancelled and archived events and other members' registrations are left out; next event first; a waitlisted entry carries `{ position, total }`; each entry has the raw registration (`slotId`) and the event data. Implement it per design 2; verify green.

## 2. Overview message

- [x] 2.1 Tests first (RED) for `buildMyEventsMessage(entries)`: V2 + ephemeral flags; heading "Deine Events"; entry text with title, German start and status "✅ Angemeldet" / "📋 Anfrage ausstehend" / "🕒 Warteliste – Platz 2 von 3" / "❌ Abgelehnt"; slot "💚 Heiler", wish "Wunsch: 🛡️ Tank"; buttons per entry (`my_leave:<id>`, `my_switch:<id>` only for a slot event with a held slot and open registration, „Zum Event“ link = `buildEventUrl(id)`); no „Abmelden“ after the unregister deadline or when rejected; no „Slot wechseln“ after the registration deadline; seven entries → five listed, closing line "2 weitere" with `buildSiteUrl('profile')`, component count ≤ 40; empty list → classic text with `buildSiteUrl('events')`. Implement per design 3–4 (constants in `bot/constants.js`); verify green and `test/botModules.test.js` (500-line cap) passes.

## 3. Command and buttons

- [x] 3.1 Tests first (RED) through `dispatchInteraction` in `test/myEventsCommand.test.js`: command `my-events` answers with the overview for the user's registrations; `buildSlashCommands()` contains `my-events` with `name_localizations.de === 'meine-events'` and a German description (extend the B-03 test in `test/slotInteractions.test.js` for the command list). Add the command to `buildSlashCommands` and route it in `handleChatCommand` to `handleMyEventsCommand` (errors → `replyWithFailure` with "❌ Fehler beim Laden deiner Events."); verify green.
- [x] 3.2 Tests first (RED): `my_leave:<id>` → classic ephemeral reply "Wirklich von **<Titel>** abmelden?" with `slot_leave:<id>` „Ja, abmelden“ and `my_leave_cancel:<id>` „Abbrechen“, registration untouched; `my_leave_cancel` → `update` with "Abmeldung abgebrochen." and no components, registration untouched; `slot_leave:<id>` afterwards deletes the registration (existing handler). Implement `handleMyLeaveButton`, `handleMyLeaveCancelButton` and the routing in `bot/interactions.js`; verify green.
- [x] 3.3 Tests first (RED): `my_switch:<id>` for a member holding "Tank" with "Heiler" free and "Schaden" full → buttons only `slot_switch:<id>:heal` „Zu Heiler wechseln“; all other slots full → "Gerade ist kein anderer Slot frei."; clicking `slot_switch:<id>:heal` moves the registration to `heal` (existing handler). Implement `handleMySwitchButton` and its routing; verify green.

## 4. Mock data

- [x] 4.1 Test first in `test/seed.test.js` that the seed covers the overview without changes (design 8): `loadUpcomingRegistrations` for persona `admin` returns the raid (`EVENT_ID.ROLE`) with slot `dps`, and the raid has a free "Heiler" place while "Tank" is full; for persona `member` it returns `pending`, `waitlisted` (with a place) and `rejected` entries. Verify `node --test test/seed.test.js` passes.

## 5. Wiki

- [x] 5.1 Update `docs/wiki/modules/bot.md` (new `bot/myEvents.js` row, custom-ID table rows `my_leave`, `my_leave_cancel`, `my_switch`, slash-command paragraph `/my-events` = `/meine-events`, `sources`), `docs/wiki/concepts/discord-integration.md` (TL;DR and slash-command row), the `utils/eventUrl.js` mention of `buildSiteUrl` in `docs/wiki/modules/utils.md`, and the file → node table in `docs/wiki/index.md` for `bot/myEvents.js`; run `npm run wiki` and verify `node --test test/wiki.test.js`.

## 6. Verification

- [x] 6.1 Run `npm test` and verify all suites pass (no UI change, so no `npm run test:e2e`).
- [x] 6.2 Start `npm run dev:mock` and verify the bot starts without errors; note in the PR that `/meine-events` must be clicked through on a test server (overview, „Abmelden“ with confirmation, „Slot wechseln“).

## Workflow follow-up

- Archive `register-command-in-discord` before this change (shared capability `discord-slash-commands`), then archive this one with `/opsx:archive`.
