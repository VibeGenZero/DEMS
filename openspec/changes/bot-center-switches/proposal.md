# Proposal

Ticket: **B-02 Bot-Zentrale: Schalter wirksam machen** (GitLab work item 85, branch `85-b-02-bot-zentrale-schalter-wirksam-machen`, P0). Fixes known issue 7.

## Why

The bot control center offers switches and fields that are saved but never read: "DM-Benachrichtigungen", "Event-Start Benachrichtigungen", "Auto Channel-Erstellung", the welcome message and the announcement channel (which has no field at all). Admins switch into the void and believe the bot behaves differently than it does. B-11 (announcement channel per event) needs a working default channel from the bot center.

## What Changes

- **"DM-Benachrichtigungen"** becomes the switch for every DM the bot sends on its own: request received, accepted, rejected, waitlist, moved up, answers to guest invitations, event change notices, date poll results, the welcome message. It does not cover what an admin triggers on purpose (cancellation DM, "Nachricht an Teilnehmer" of W-09) nor the guest invitation itself (guests can only answer through its buttons); reminders and the start DM keep their own switches. With the switch off, the wizard no longer offers "Teilnehmer benachrichtigen".
- **"Event-Start Benachrichtigungen"** controls the DM at an event's start.
- **"Erinnerungen"** controls only the reminder DMs. The 5-minute scheduler keeps running, so the deadline refresh of announcements (W-03) and start handling still work; reminders that come due while the switch is off are dropped, not sent in a burst later.
- **"Auto Channel-Erstellung"** becomes a global lock: when off, the bot creates no event channels, and the wizard shows the event option disabled with a German hint. Existing channels stay and are still cleaned up.
- **Welcome message**: sent once per member by DM when they are accepted for an event for the first time; remembered on the member's profile. Follows the DM switch.
- **Announcement channel**: new dropdown "Ankündigungskanal" in the bot center with the server's text channels; event and date poll announcements go there. Empty = `DISCORD_ANNOUNCE_CHANNEL_ID` from `.env` as before.
- Settings saved before this change keep working: missing keys get the defaults.
- My own addition beyond the ticket text: the reminder switch no longer stops the scheduler (see above), because stopping it silently broke the W-03 deadline refresh.
- Out of scope: announcement channel per event (B-11), per-member DM choices (W-16 stays as it is), new presence features.

## Capabilities

### New Capabilities
- `bot-center-settings`: what each switch and field of the bot control center does, the announcement channel choice and the welcome message.

### Modified Capabilities
- `event-change-notifications`: "Switch in the event wizard" and "Notification only on request" — no change DMs and no switch while DM notifications are off in the bot center.

## Impact

- Code: new `utils/botSettings.js` (defaults, cached settings, DM gate, announcement channel, welcome DM); `bot.js` (`getBotSettings`/`saveBotSettings` use it, `checkReminders` gates reminders and start DM, `applyBotSettings` stops toggling the scheduler, `createEventChannels` checks the lock, guest DMs use the gate); `utils/registrationService.js`, `utils/eventUtils.js`, `utils/pollStore.js`, `utils/eventChangeNotice.js` (DMs through the gate, welcome hook); `routes/admin.js` (settings route with channel check, announce routes, change notice); `public/index.html`, `public/js/admin/bot-control.js`, `public/js/admin/wizard.js`/`wizard-notify.js` (dropdown, locked channel option, hidden notify switch); `dev/seedData.js` unchanged shape.
- API: `PUT /api/admin/bot/settings` checks `announceChannel`; the announce routes' 400 message changes to "Kein Ankündigungskanal festgelegt – bitte in der Bot-Zentrale wählen.".
- Data: `users.welcomeSentAt` (ISO) new optional field.
- No new env variables, no new dependencies. `dev/mockBot.js` needs no new twin (the gate wraps the existing `sendDM`; `createEventChannels` already has a twin, the lock is checked by the caller).
- Wiki nodes: `docs/wiki/concepts/reminders-presence.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/utils.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/ops/configuration.md`, `docs/wiki/reference/known-issues.md` (remove issue 7).
