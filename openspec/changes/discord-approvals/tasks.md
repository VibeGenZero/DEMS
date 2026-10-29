# Tasks

## 1. Shared status change

- [x] 1.1 Move the body of `PUT /api/admin/registrations/:id/status` into `changeRegistrationStatus({ registrationId, status, actor })` in the new `utils/registrationStatus.js` (design 1, without `expectStatus` and closing yet); the route calls it and answers as before. Verify every existing status-route test in `test/devServer.test.js` (15 calls) and the full `npm test` stay green.
- [x] 1.2 Tests first (RED) in the new `test/discordApprovals.test.js` (mock mode, own SQLite): `changeRegistrationStatus` with `expectStatus: 'pending'` on an accepted registration returns `{ ok: false, code: 'already_decided' }` and changes nothing; with a pending one it accepts and writes the audit log with `actor.id`; unknown id → `{ ok: false, code: 'not_found' }`. Implement; verify green.
- [x] 1.3 Wiki: `utils/registrationStatus.js` section in `docs/wiki/modules/utils.md`, status route note in `docs/wiki/modules/routes-admin.md`, file → node row in `docs/wiki/index.md`; run `npm run wiki`.

## 2. Setting and bot center

- [x] 2.1 Tests first (RED): `normalizeBotSettings({})` has `approvalChannel: ''` (`test/botSettings.test.js`); devServer: `PUT /api/admin/bot/settings` stores a known text channel as `approvalChannel`, answers 400 "Freigabe-Kanal nicht gefunden." for an unknown id and saves nothing, keeps an unchanged id while the channel list is empty. Implement design 4 (backend); verify green.
- [x] 2.2 Frontend test first (RED) in `test/botSwitchesView.test.js`: the bot center fills `#bot-approval-channel` with "Keiner – Freigaben nur auf der Website" plus the text channels, selects the stored value and sends `approvalChannel` on save. Add markup (`public/index.html`, components/tokens only) and `approvalChannelOptions` in `public/js/admin/bot-control.js`; verify green plus `test/cssRules.test.js`, `test/frontendCsp.test.js`, `test/actionAttributes.test.js`.
- [x] 2.3 Wiki: settings table in `docs/wiki/concepts/reminders-presence.md`, bot center element in `docs/wiki/modules/frontend-markup.md`; run `npm run wiki`.

## 3. Request messages

- [x] 3.1 Tests first (RED) for `buildApprovalMessage` (require `bot/approvals.js`): V2 container with title, start, `<@userId>`, "Wunsch: 🛡️ Tank", guest names, "**Charakter:** Thrall"; buttons `approval_accept:<id>` „Annehmen“, `approval_reject:<id>` „Ablehnen“, `approval_waitlist:<id>` „Warteliste“, link `buildEventUrl`; a 3000-character answer ends with "…" and the text stays ≤ 4000; closed with `{ status: 'accepted', actorName: 'Mori' }` → no action buttons, line "✅ Angenommen von Mori", link kept; each outcome line of design 2. Implement `buildApprovalMessage` and the prefixes in `bot/constants.js`; verify green and `test/botModules.test.js` (500-line cap).
- [x] 3.2 Tests first (RED): with `approvalChannel` set, registering a member for a manual event (devServer persona or `registerUserForEvent`) calls the mock `sendApprovalRequest` and stores `approvalMessage` on the registration; a promotion to `pending` does the same; instant events and an empty `approvalChannel` post nothing. Implement `sendApprovalRequest` (real + mock twin), `editChannelMessage` in `bot/messages.js`, export through `bot.js` (extend `EXPORTS` in `test/botModules.test.js` and `test/botRealExports.test.js`), and the calls in `utils/registrationService.js` / `utils/eventUtils.js` (design 3); verify green.

## 4. Buttons and closing

- [x] 4.1 Tests first (RED) through `dispatchInteraction`: a member without `DISCORD_ADMIN_ROLE_ID` among the interaction roles gets "⛔ Nur Admins können Anmeldungen freigeben." and the registration stays pending; an admin's „Annehmen“ accepts (DM in the mock log, audit log with the admin id) and answers privately; „Ablehnen“ rejects and promotes the waitlist; „Warteliste“ waitlists; a click on an already accepted request answers "ℹ️ Bereits entschieden: Angenommen." and changes nothing. Implement `handleApprovalButton`, the routing in `bot/interactions.js` and `expectStatus` in the service; verify green.
- [x] 4.2 Tests first (RED) with the mock twin of `closeApprovalRequest` recording its calls: website status change → "accepted" with the admin's name; bulk accept of two pending → two closes; member unregisters a pending request → "withdrawn"; cancelling the event → "cancelled" for its pending requests; deleting an event and a series → "deleted"; registrations without `approvalMessage` cause no call; a gone message (real helper with a stub client or `isGoneDiscordError` path) returns `false` without throwing. Implement `closeApprovalRequest` (real + mock) and the calls of design 3; verify green.
- [x] 4.3 Mock data: give one manual-approval seed event a pending registration with `approvalMessage` only if the mock bot needs it to show the flow; otherwise document in `docs/wiki/modules/dev-mock-mode.md` how to try it (choose a channel in the bot center, register Tom for the manual event). Verify `node --test test/seed.test.js`.
- [x] 4.4 Wiki: `docs/wiki/modules/bot.md` (module row `bot/approvals.js`, custom IDs, exports list, `editChannelMessage`), `docs/wiki/concepts/discord-integration.md` (approvals section), `docs/wiki/concepts/registration-flow.md` (approval paths), `docs/wiki/concepts/data-model.md` (`approvalMessage`), `docs/wiki/modules/dev-mock-mode.md` (mock twins); run `npm run wiki` and verify `node --test test/wiki.test.js`.

## 5. Verification

- [x] 5.1 Run `npm test` and `npm run test:e2e` (the bot center UI changes) and verify both pass.
- [x] 5.2 Start `npm run dev:mock`, choose an approval channel in the bot center, register a persona for a manual event and check the mock log shows the posted request; accept it on the website and check the log shows the closing edit. Note in the PR that the buttons must be clicked through on a test server (admin and non-admin).

## Workflow follow-up

- Archive the change with `/opsx:archive` after review and the test-server check.
