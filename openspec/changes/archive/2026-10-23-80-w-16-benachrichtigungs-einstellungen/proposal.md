# Proposal

Ticket: **W-16 – Benachrichtigungs-Einstellungen**, GitLab issue 80, size M, release 3.0.0-beta.2.

## Why

Members can only switch off guest invitations. Everyone who registers gets every reminder, every change notice and every waitlist message by Discord DM, whether they want them or not; the only way out is to block the bot, which also drops the DMs they do care about.

## What Changes

- **Profile → Einstellungen:** a new block "Discord-Nachrichten" with three switches, all on by default:
  - **Erinnerungen** — the scheduled reminders before the start and the start notification.
  - **Änderungen** — the change DM of W-04 (start, end, location) and the cancellation DM (user decision).
  - **Warteliste** — the DM "you were put on the waitlist". The DM when a member moves up from the waitlist is always sent, because the member is then booked (user decision).
- **Server:** every place that sends one of these DMs skips members who switched that kind off. Status DMs (request received, accepted, rejected), the move-up DM, guest invitations and their answers, and date poll DMs stay as they are.
- **API:** `GET /api/user/settings` also returns `notifications: { reminders, changes, waitlist }`; `PUT /api/user/settings` accepts it. `PUT` now changes only the fields it receives, so saving one switch never resets another (today a body without `acceptInvitations` turns invitations back on).
- **Default:** a member without stored choices — every existing member and everyone who only registered through Discord — gets all DMs as before. No migration.
- **Admin feedback:** the change DM and the cancellation count only members who want them; members who opted out are named as a number in the audit entry.

## Capabilities

### New Capabilities
- `dm-preferences`: which DM kinds a member can switch off, the defaults, where the choice is made and stored, and which DMs it never affects.

### Modified Capabilities
- `event-change-notifications`: the change DM no longer reaches accepted participants or guests who switched "Änderungen" off.

## Impact

- **Code:** new `utils/notificationPrefs.js` (defaults, normalizing, filtering recipients); `routes/user.js` (`GET`/`PUT /settings`); `utils/eventChangeNotice.js` (recipients); `routes/admin.js` (`PUT /events/:id/cancel`); `bot.js` (`messageAcceptedParticipants` of the reminder scheduler); `utils/registrationService.js` (`notifyRegistration`, waitlisted case); frontend `public/js/pages/profile.js`, `public/index.html` (settings block); `dev/seedData.js` (members with switched-off kinds).
- **Discord:** no new Discord call; filtering happens before the existing `sendDM`.
- **API:** additive fields; `PUT /api/user/settings` keeps accepting `{ acceptInvitations }` alone.
- **Data:** new optional field `notifications` on `users/{id}`; missing = all on.
- **Wiki nodes:** `docs/wiki/modules/routes-user.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/concepts/discord-integration.md` (status DMs), `docs/wiki/concepts/reminders-presence.md`, `docs/wiki/concepts/event-lifecycle.md` (change DMs, cancel), `docs/wiki/concepts/registration-flow.md` (waitlist DM), `docs/wiki/modules/utils.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/dev-mock-mode.md` (seed), `docs/wiki/ops/testing.md`.
- No new dependencies, no new environment variables.
