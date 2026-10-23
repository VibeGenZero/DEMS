# Tasks

## 1. Recipients, text and sending (helper)

- [x] 1.1 Write `test/participantMessage.test.js` first (RED) and the shared cases `test/fixtures/participantMessageCases.js`: `messageRecipients` for the spec scenarios (accepted only → 4, all → 7, rejected never, `pendingGuests` never, member who is also a guest counted once), `recipientCounts` returns numbers only, `validateMessageText` (empty/space-only → "Bitte gib eine Nachricht ein.", 1501 chars after trimming → "Die Nachricht darf höchstens 1500 Zeichen lang sein.", 1500 ok, trimmed), `buildParticipantMessage` against the fixture cases (title, unchanged text with line breaks, sender, URL; length below 2000 for a 200-char title and 1500-char text), `sendParticipantMessage` with an injected `send` (one call per recipient, `delivered` counts only `true`, no preference filter: a recipient with every DM kind off still gets a call); verify `node --test test/participantMessage.test.js` fails on the missing module
- [x] 1.2 Create `utils/participantMessage.js` per design decision 1; verify `node --test test/participantMessage.test.js` passes

## 2. Endpoints

- [x] 2.1 Add RED cases to `test/devServer.test.js` (personas, seeded events): `GET /api/admin/events/<open event>/message-recipients` → 403 for `member`, `{ accepted, all }` numbers for `admin` with `all >= accepted` and no ids in the body; unknown event → 404; `POST …/message` without CSRF → 403; with `group: 'x'` → 400 "Ungültige Empfängerauswahl."; with blank text → 400 "Bitte gib eine Nachricht ein."; for an event without accepted registrations and `group: 'accepted'` → 400 "Niemand in dieser Auswahl." and no new audit entry; a valid send answers `{ recipients, delivered }` equal to the counts, the server output shows "DM an <name>" with the text for each recipient (including a seeded member with DM choices off), and the audit log has `MESSAGE_PARTICIPANTS` with the counts and the text start; verify the new cases fail
- [x] 2.2 Implement both routes in `routes/admin.js` per design decision 2; verify `node --experimental-vm-modules --test test/devServer.test.js test/participantMessage.test.js` passes
- [x] 2.3 Update `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md` (rows, audit action), `docs/wiki/modules/utils.md` (section `utils/participantMessage.js`), `docs/wiki/concepts/discord-integration.md` (DM list: team message, not affected by DM choices), `docs/wiki/concepts/data-model.md` (`MESSAGE_PARTICIPANTS` in the audit actions), `docs/wiki/index.md` (file → node row); run `npm run wiki` and verify `node --test test/wiki.test.js` passes

## 3. Frontend

- [x] 3.1 RED tests: `test/participantMessageView.test.js` (via `loadFrontendApp`) — `buildParticipantMessagePreview` against the same fixture cases as the server (equal strings for the same input and URL), `participantCountText` ("an 1 Person", "an 12 Personen", "an 0 Personen"), `renderParticipantPreview` (`.discord-message`, text escaped and rendered via `renderMarkdownSafe`); DOM flow — `showParticipantMessage('ev', 'Raid')` loads `/api/admin/events/ev/message-recipients`, shows "an 3 Personen" for accepted and the other count after switching the group, disables send for empty text and for 0 recipients with "Niemand in dieser Auswahl", `askSendParticipantMessage` shows "Nachricht an 3 Personen senden?" without posting, `cancelSendParticipantMessage` keeps the text and posts nothing, `sendParticipantMessage` posts `{ text, group }` with the CSRF header and toasts "Nachricht an 3 von 3 Personen zugestellt." (success) or "… 0 von 3 …" (warning); a server error keeps the text and toasts the error. Extend `test/adminEventRows.test.js` (`message` in `general` for every state but `draft`) and `test/adminEventTable.test.js` (menu entry markup); verify they fail
- [x] 3.2 Implement `public/js/admin/participant-message.js` per design decision 3, import it in `public/js/main.js`, add `message` to `adminEventActions` and `ACTIONS` in `admin/event-table.js`, add `#participantMessageModal` and the button in `#registrationsModal` to `public/index.html`, set the button's data attributes in `showRegistrations`; verify 3.1 passes and `test/frontendModules.test.js`, `test/actionAttributes.test.js`, `test/frontendCsp.test.js`, `test/frontendActions.test.js`, `test/adminRegistrations.test.js` stay green
- [x] 3.3 Styles (block PARTICIPANT MESSAGE in `public/css/style.css`, tokens only, reuse DISCORD PREVIEW); verify `test/cssRules.test.js`, `test/designTokens.test.js`, `test/contrast.test.js` pass
- [x] 3.4 Update `docs/wiki/modules/frontend-app.md` (module row, `adminEventActions`/`ACTIONS` key `message`, registrations dialog button) and `docs/wiki/modules/frontend-markup.md` (`#participantMessageModal`, button in `#registrationsModal`, style block); run `npm run wiki` and verify `node --test test/wiki.test.js` passes

## 4. Integration

- [x] 4.1 Add e2e cases to `e2e/admin.spec.js`: admin opens "Nachricht an Teilnehmer …" from the menu of a seeded active event, sees the counter, switches the group, types a text, sees it in the preview, confirms and gets the success toast; opening it from the registrations dialog closes that dialog first; verify `npm run test:e2e` passes three times in a row
- [x] 4.2 Browser check in mock mode (own PORT, scratch `DEV_SQLITE_PATH`) at 1440 px and 390 px with Playwright screenshots of the dialog (both groups, long text, confirmation step) and the "DM an …" lines in the server log; no console/CSP errors
- [x] 4.3 Run `npm test` and verify it passes completely (including wiki validation and the stale `graph.json` check)

## Workflow follow-up

- Commit planning and code separately, push `73-w-09-nachricht-an-alle-teilnehmer`, MR "W-09: Nachricht an alle Teilnehmer" with German description and `Closes #73`.
- After the merge: `/opsx:archive` on a `chore/openspec-archive-…` branch from `origin/main`.
