# Tasks

## 1. Settings module and DM gate

- [x] 1.1 Write `test/botSettings.test.js` first (RED; own SQLite via `SQLITE_PATH` in a temp dir, `DEV_MOCK` like `test/reminderScheduler.test.js`): `normalizeBotSettings({})` gives every default; a stored document without `eventStartNotifications` reads it as `true`; `loadBotSettings()` reads once and returns the cached value until `rememberBotSettings()`; a read error returns the defaults; `sendAutomaticDM` calls the bot's `sendDM` with the switch on and returns `false` without calling it with the switch off; `announceChannelId` prefers the stored channel over `DISCORD_ANNOUNCE_CHANNEL_ID` and returns `''` with neither. Verify the file fails for the missing module.
- [x] 1.2 Create `utils/botSettings.js` (`DEFAULT_BOT_SETTINGS`, `normalizeBotSettings`, `loadBotSettings`, `rememberBotSettings`, `sendAutomaticDM`, `announceChannelId`) per design D1; make `bot.js#getBotSettings` return `loadBotSettings()` and `saveBotSettings` call `rememberBotSettings` after the write; verify 1.1 is green and `npm test` stays green.
- [x] 1.3 Wiki: `utils/botSettings.js` section in `docs/wiki/modules/utils.md` (cache, single-process note) and the file → node row in `docs/wiki/index.md`; run `npm run wiki` and verify `node --test test/wiki.test.js`.

## 2. Automatic DMs follow the switch

- [x] 2.1 Write tests first (RED) in `test/devServer.test.js` with personas, switching via `PUT /api/admin/bot/settings` and reading the mock DM log/`dmsSent` (or a `send` override where the unit already takes one): with `dmNotifications` off, a `member` registering for an instant event gets no DM but is accepted; an admin acceptance of a pending registration sends no DM and still gives the event role; a waitlist promotion sends no DM; with the switch on again the "accepted" DM is sent. Unit test: `notifyEventChange` uses the gate by default (on: sent, off: nothing). The `pollStore` result DMs are internal functions; they are covered by the guard test of 2.3 instead of a unit test. Reset the switch at the end of each test. Verify they fail.
- [x] 2.2 Route the automatic DMs through `sendAutomaticDM` (design D2): `utils/registrationService.js` (`notifyRegistration`, `notifyStatusChange`), `utils/eventUtils.js#announcePromotions`, `utils/pollStore.js`, `utils/eventChangeNotice.js` default `send`, the three guest DMs in `bot.js`; verify 2.1 is green.
- [x] 2.3 Add a guard test (e.g. in `test/botSettings.test.js`) that the only direct `sendDM(` calls outside `bot.js` and `dev/` are the cancellation in `routes/admin.js` and the participant message (`send: sendDM`), with a failure message naming the rule; plus a devServer test that cancelling an event and "Nachricht an Teilnehmer" still deliver with the switch off. Verify green.
- [x] 2.4 Wiki: `docs/wiki/concepts/discord-integration.md` (which DMs the switch covers, which not) and `docs/wiki/concepts/reminders-presence.md` settings table; run `npm run wiki`.

## 3. Reminders, start DM and scheduler

- [x] 3.1 Extend `test/reminderScheduler.test.js` first (RED) with a `settings` override: reminders off → a due reminder is marked `sent` and no DM goes out, and switching on later sends nothing for it; start notifications off → `eventStartNotificationSent` is set, no DM, nothing later; both on → behaviour as before; the deadline refresh runs with reminders off. Add a source check that `applyBotSettings` no longer starts or stops the scheduler (it returns early without a Discord login, so mock mode cannot observe it at runtime). Verify they fail.
- [x] 3.2 Implement design D3 in `bot.js` (`checkReminders` with `settings = await loadBotSettings()` default, `applyBotSettings` without the interval toggle); verify 3.1 and the existing reminder tests are green.
- [x] 3.3 Wiki: scheduler behaviour in `docs/wiki/concepts/reminders-presence.md` (always running, switches drop due DMs); run `npm run wiki`.

## 4. Channel lock

- [x] 4.1 Write devServer tests first (RED): with `autoChannelCreation` off, creating an active event with `autoCreateChannels: true`, activating a draft with the option and updating such an event create no channels (mock log / `discordChannelId` stays empty) and keep `autoCreateChannels: true`; after switching on and saving again the channels exist; deleting an event that already has channels still deletes them. Verify they fail.
- [x] 4.2 Add `createEventChannelsAllowed` in `routes/admin.js` and use it at the four call sites (design D4); verify 4.1 is green.
- [x] 4.3 Frontend test first (RED) in `test/wizardFlow.test.js` or a new `test/botSwitchesView.test.js`: with `GET /api/admin/bot/settings` answering `autoChannelCreation: false`, the wizard disables `#event-auto-create-channels` and shows `#event-channels-locked` with "In der Bot-Zentrale ausgeschaltet."; with the route missing (404) the option stays enabled. Then add the markup (`.is-hidden` start state) and the read in `admin/wizard.js` (`state.botSettings`); verify green, plus `test/cssRules.test.js`, `test/frontendCsp.test.js`, `test/actionAttributes.test.js`.
- [x] 4.4 Wiki: lock in `docs/wiki/modules/routes-admin.md` and `docs/wiki/concepts/discord-integration.md`, wizard element in `docs/wiki/modules/frontend-markup.md`; run `npm run wiki`.

## 5. Change notices and the wizard switch

- [x] 5.1 Tests first (RED): devServer — with `dmNotifications` off, `PUT /api/admin/events/:id` with `notifyParticipants: true` and a changed start answers `notifiedCount: 0` and sends no DM; frontend — with DMs off in `state.botSettings`, `updateNotifySwitch` keeps `#wizard-notify` hidden after a start change (existing W-04 tests stay green). Verify they fail.
- [x] 5.2 Implement design D6 in `routes/admin.js` and `public/js/admin/wizard-notify.js`; verify 5.1 green.
- [x] 5.3 Wiki: `docs/wiki/concepts/event-lifecycle.md` change-notice paragraph and the `wizard-notify.js` row in `docs/wiki/modules/frontend-app.md`; run `npm run wiki`.

## 6. Welcome message

- [x] 6.1 Tests first (RED) in `test/botSettings.test.js` with own members (so no persona has to be a first-time member): with the text "Willkommen, {user.name}! … {user.mention}", the first acceptance (instant registration) sends that DM once with name and mention filled in and sets `users.welcomeSentAt`; a second acceptance sends none; a member with an earlier accepted registration and no `welcomeSentAt` gets none; an empty text or DMs off send none and set nothing; admin acceptance (`notifyStatusChange`, also used by bulk actions) and moving up (`announcePromotions` with the real promotion shape `registrationId`) each trigger it; no profile document → nothing. Verify they fail.
- [x] 6.2 Implement `sendWelcomeOnce` in `utils/botSettings.js` and call it after the accepted DM in `notifyRegistration`, `notifyStatusChange`, `announcePromotions` (design D1/D2); verify 6.1 green.
- [x] 6.3 Wiki: `welcomeSentAt` in the users section of `docs/wiki/concepts/data-model.md`, welcome DM in `docs/wiki/concepts/discord-integration.md`; run `npm run wiki`.

## 7. Announcement channel

- [x] 7.1 Tests first (RED) in `test/devServer.test.js`: saving `announceChannel` with a mock text channel id succeeds and `POST /api/admin/events/:id/announce` posts there (mock log shows the channel); an unknown id → 400 "Ankündigungskanal nicht gefunden." and the settings stay; `''` falls back to `DISCORD_ANNOUNCE_CHANNEL_ID`; the poll announcement uses the chosen channel too; with both empty (mock mode always sets the env variable, so this is a unit test of `announceTarget` in `utils/botSettings.js`, which both announce routes use) the answer is "Kein Ankündigungskanal festgelegt – bitte in der Bot-Zentrale wählen.". Verify they fail.
- [x] 7.2 Implement design D5 server side (settings route check, both announce routes); verify 7.1 green.
- [x] 7.3 Frontend test first (RED) for `admin/bot-control.js`: the dropdown `#bot-announce-channel` lists only text channels after "Standard aus .env", selects the stored value, and `saveBotSettingsForm` sends `announceChannel`. Then add the markup, the loading and the texts of design D7 (switch hints, welcome hint); verify green plus the CSS/CSP/action tests.
- [x] 7.4 Wiki: `docs/wiki/modules/routes-admin.md` (settings check, announce fallback and message), `docs/wiki/ops/configuration.md` (`DISCORD_ANNOUNCE_CHANNEL_ID` is now the fallback), `docs/wiki/modules/frontend-app.md` (bot-control row), `docs/wiki/modules/frontend-markup.md`, remove known issue 7 from `docs/wiki/reference/known-issues.md` and the "stored but not evaluated" notes in `reminders-presence.md` / `discord-integration.md`; run `npm run wiki`.

## 8. Integration check

- [x] 8.1 Add an e2e case to `e2e/admin.spec.js`: admin opens the bot center, picks a text channel as "Ankündigungskanal", saves, reloads and sees it selected; switches "Auto Channel-Erstellung" off and sees the locked channel option in the wizard; restores both settings at the end. Verify with `npm run test:e2e -- e2e/admin.spec.js`.
- [x] 8.2 Run `npm test` and `npm run test:e2e` three times (shared-DB races); all green.
- [x] 8.3 Browser check in mock mode with a scratch `DEV_SQLITE_PATH` and own `PORT`: bot center (dark, light, phone width) with the new dropdown and hints; switch DMs off and register as `member` → no `[MOCK-DISCORD]` DM line in the server log; switch on → DM line appears.

## Workflow follow-up

- "mach die MR" = two commits (planning, then code), push `85-b-02-bot-zentrale-schalter-wirksam-machen`, MR "B-02: Bot-Zentrale: Schalter wirksam machen" with German text only, `Closes #85`.
- After the merge: `/opsx:archive` on `chore/openspec-archive-b02` from `origin/main` (new main spec `bot-center-settings`, MODIFIED `event-change-notifications` blocks replaced whole).
