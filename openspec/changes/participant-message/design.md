# Design: Message to all participants (W-09)

## Context

See proposal.md for the motivation and specs/participant-message/spec.md (plus the `dm-preferences` delta) for the behaviour.

What exists:

- `bot.js#sendDM(userId, message)` returns `true` when delivered and `false` when the bot is not ready or the DM fails (closed DMs, unknown user); `dev/mockBot.js#sendDM` logs "DM an <name>" and returns `true`. No new Discord call is needed, so CLAUDE.md's "new bot helper + mock twin" rule is already met by the existing pair.
- `utils/eventChangeNotice.js` (W-04) is the model: `changeRecipients(registrations)` collects accepted registrants plus `registration.guests` in a `Set`, `notifyEventChange({ …, send = sendDM })` loops sequentially and counts deliveries; tests inject `send`. W-16's `filterByPreference` is deliberately **not** used here.
- `utils/eventUtils.js#loadEventRegistrations(eventId)`, `#addAuditLog(action, adminId, details, targetId)`; `utils/eventUrl.js#buildEventUrl(id)`. Existing 404 text for events: `Event nicht gefunden`.
- Admin UI: `admin/event-rows.js#adminEventActions` returns the menu groups, `admin/event-table.js` maps action keys to label, icon and `data-click` markup (literal action names, checked by `test/frontendCsp.test.js`); `admin/registrations.js#showRegistrations(eventId, eventTitle)` opens `#registrationsModal` via `bootstrap.Modal.getOrCreateInstance`; `admin/discord-preview.js` already renders Discord-looking messages (embed-based).
- `core/ui.js#showConfirmDialog` opens the shared `#confirmModal`; stacking it on top of another open Bootstrap modal is not used anywhere yet.

## Goals / Non-Goals

**Goals:**
- One helper owns recipients, message text and sending; the browser shows the same text through a pure twin kept equal by a shared-fixture test.
- No new Discord API surface; sending works in mock mode and degrades to "0 von n" when the bot is offline.

**Non-Goals:**
- Attachments, embeds, scheduling a message for later, per-person selection, message history beyond the audit log, replies.
- A new DM preference (decided: the message always goes out).
- Background queue / retry: sending is sequential inside the request, like the change DMs.

## Decisions

1. **Helper `utils/participantMessage.js`.**
   - `MESSAGE_GROUPS = { accepted: ['accepted'], all: ['accepted', 'pending', 'waitlisted'] }`, `MAX_MESSAGE_LENGTH = 1500`.
   - `messageRecipients(registrations, group)` → unique user ids: registrants whose status is in the group plus their `guests` (accepted guests); never `pendingGuests`, never rejected.
   - `recipientCounts(registrations)` → `{ accepted, all }` (numbers only).
   - `validateMessageText(text)` → `{ text }` trimmed or `{ error }` with the two German sentences.
   - `buildParticipantMessage({ title, text, sender, url })` → plain text: `📣 **Nachricht zum Event „<title>“**`, blank line, the text unchanged, blank line, `— <sender> · Alle Infos: <url>`. Plain text (not an embed) keeps line breaks and Discord markdown the admin typed; max length stays below Discord's 2000 (title ≤ 200, text ≤ 1500, sender + URL short).
   - `sendParticipantMessage({ eventId, title, text, group, sender, send = sendDM })` → loads registrations, builds the text once, loops sequentially, returns `{ recipients, delivered }`.
   *Alternative:* extend `eventChangeNotice.js` — rejected, it is about change DMs and filtered by preference; a separate module keeps both readable.

2. **Endpoints in `routes/admin.js`** (router-wide `requireAuth` + `requireAdmin`; POST is covered by the global CSRF middleware):
   - `GET /events/:id/message-recipients` → `{ accepted, all }`; 404 `Event nicht gefunden`.
   - `POST /events/:id/message` body `{ text, group }` → group unknown → 400 `Ungültige Empfängerauswahl.`; text invalid → 400 with the helper's sentence; event missing → 404; nobody addressed → 400 `Niemand in dieser Auswahl.`; else send, `addAuditLog('MESSAGE_PARTICIPANTS', adminId, '<group label>: <delivered>/<recipients> zugestellt – „<first 100 chars>“', eventId)` and answer `{ recipients, delivered }`. Sender = `req.session.user.displayName || username`. Placed with the other `/events/:id/...` POST routes (static paths above `/:id` are not affected).

3. **Frontend module `public/js/admin/participant-message.js`.**
   - Pure: `PARTICIPANT_GROUPS` (labels "Nur Angenommene", "Alle Anmeldungen"), `buildParticipantMessagePreview({ title, text, sender, url })` (same string as the server; `test/fixtures/participantMessageCases.js` feeds both tests), `participantCountText(n)` ("an 1 Person" / "an 12 Personen"), `renderParticipantPreview(message)` (a `.discord-message` with the bot name and the text through `renderMarkdownSafe`, so it looks like the DM).
   - DOM: `showParticipantMessage(eventId, eventTitle)` (resets text and group, loads counts, opens `#participantMessageModal`; when `#registrationsModal` is open it is hidden first, so two dialogs never stack), `updateParticipantMessage()` (counter, char count "123 / 1500", preview, send button disabled for empty text or 0 recipients with the note "Niemand in dieser Auswahl"), `askSendParticipantMessage()` → **inline confirmation step** inside the dialog footer ("Nachricht an 12 Personen senden?" with "Ja, senden" / "Zurück") instead of `#confirmModal`, avoiding a modal on top of a modal; `sendParticipantMessage()` posts with `X-CSRF-TOKEN`, closes the dialog and toasts success/warning per the spec; on an error keeps the dialog and text and toasts the server's `error`.
   - Actions: `showParticipantMessage` (from the table menu and the registrations dialog, `data-event-id`, `data-event-title`), `updateParticipantMessage` (`data-input` on the textarea, `data-change` on the group radios), `askSendParticipantMessage`, `cancelSendParticipantMessage`, `sendParticipantMessage`.
   - Event link of the preview: `location.origin + '/#event/' + id` mirrors `buildEventUrl` (which uses `PUBLIC_URL`); the preview test pins the format, not the host.

4. **Menu and dialog markup.** `adminEventActions` adds `'message'` to `general` after `'announce'` for every state except `draft`; `ACTIONS.message = { icon: 'chat-text', label: 'Nachricht an Teilnehmer …', attributes: data-click="showParticipantMessage" data-event-id data-event-title }`. `#registrationsModal` header gets a `btn btn-sm btn-outline-light` "Nachricht an Teilnehmer" (`bi-chat-text`) whose `data-event-id/-title` are set by `showRegistrations`. New `#participantMessageModal` (modal-lg): group radios (`btn-check` pills), textarea `#participant-message-text` (`maxlength="1500"`), counter `#participant-message-count`, chars `#participant-message-chars`, preview `#participant-message-preview`, footer with `#participant-message-actions` and the hidden confirmation `#participant-message-confirm` (`.is-hidden` start state, shown with `toggleElement`).

5. **Styles.** Reuse `.discord-message` from DISCORD PREVIEW for the preview and existing button/form classes; a small block PARTICIPANT MESSAGE in `style.css` only for the counter row and the confirmation bar, tokens only.

## Risks / Trade-offs

- [Sequential DMs inside the request take time for big events (Discord rate limits ~ a few DMs per second)] → the dialog shows a spinner on "Ja, senden" and keeps the buttons disabled; for DEMS-sized events (tens of people) this is seconds. A queue is out of scope.
- [Admin sends twice by double click] → the send button is disabled while the request runs.
- [Text with `@everyone` or role mentions] → DMs do not ping; Discord shows them as text. No filtering needed.
- [Preview text drifting from the server text] → shared fixture cases run against both builders.
- [Members who closed DMs] → `sendDM` returns false; they show up as "nicht zugestellt" in the count only (no names, by spec).

## Migration Plan

No data migration; the new audit action appears in the audit log list as a plain chip. Rollback = revert the commit.
