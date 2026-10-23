# Proposal: Message to all participants (W-09)

## Why

Admins cannot reach the people registered for an event from DEMS. Today the bot only sends fixed DMs (status, reminders, changes, cancellation); for anything else ("Treffpunkt hat sich geändert", "bitte Headset mitbringen", "danke fürs Kommen") admins have to collect names and write each member by hand. Ticket W-09 (GitLab issue 73, prioplan `docs/superpowers/plans/2026-10-07-dems-3.0-prioplan.md`): "DM an alle (oder nur angenommene) Teilnehmer eines Events, mit Audit-Log".

## What Changes

- New dialog "Nachricht an Teilnehmer" for one event, opened from a button in the registrations dialog and from a new entry in the ⋯ menu of the admin event table (every state except drafts).
- The admin writes a text (1–1500 characters) and picks the recipients: "Nur Angenommene" (default) or "Alle Anmeldungen" (accepted, pending and waitlisted; never rejected). Accepted guests of the chosen registrations are included; everybody gets at most one DM.
- A live counter ("an 12 Personen") and a Discord-style preview of the DM; sending asks for confirmation with the number of recipients.
- The bot sends one DM per recipient with the event title, the text, the sender's name and the event link. The DM choices of W-16 do not apply: like accept/reject DMs, a direct message of the team about one's own event always goes out.
- Result as toast ("11 von 12 zugestellt"), audit log entry `MESSAGE_PARTICIPANTS` with group, recipient and delivered counts and the beginning of the text.
- Two admin endpoints: `GET /api/admin/events/:id/message-recipients` (counts per group) and `POST /api/admin/events/:id/message`.

## Capabilities

### New Capabilities
- `participant-message`: admins send a free-text DM to the participants of one event, choosing accepted only or all open registrations, with preview, confirmation, delivery count and audit log.

### Modified Capabilities
- `dm-preferences`: the requirement "Other DMs are not affected" lists every DM the choices do not touch; the message of the team to participants joins that list (the three kinds stay reminders, changes, waitlist).

## Impact

- Server: `routes/admin.js` (two routes), new helper `utils/participantMessage.js` (recipients, message text, sending loop with an injectable `send`), reusing `sendDM` from `bot.js` (no new Discord call, so no new bot helper; `dev/mockBot.js` already logs `sendDM`) and `buildEventUrl`.
- Frontend: new module `public/js/admin/participant-message.js` (dialog, counter, preview, send) with a pure twin of the message text, a dialog `#participantMessageModal` in `public/index.html`, a button in `#registrationsModal`, the `message` action in `admin/event-rows.js` / `admin/event-table.js`.
- No data-model change besides the new audit action; no new dependency or env variable.
- Wiki nodes: `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/utils.md`, `docs/wiki/concepts/discord-integration.md` (DM list), `docs/wiki/concepts/data-model.md` (audit action), `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/index.md`.
