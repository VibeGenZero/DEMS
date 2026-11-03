# Proposal

## Why

Ticket **B-11** (#94, milestone M4 · Discord-Funktionen, depends on B-02). Every event announcement goes to one channel — the bot center's „Ankündigungskanal“, else `DISCORD_ANNOUNCE_CHANNEL_ID`. Communities with separate channels per game or group (e.g. `#raid-termine`, `#community`) cannot route an event to its audience.

## What Changes

- **Channel per event:** the wizard step „Erweitert“ gets the dropdown „Ankündigungskanal“ with „Standard aus der Bot-Zentrale (#…)“ first, then the server's text channels (and a stored channel the bot cannot list, as in the bot center). The choice is stored as `announceChannelId` (`''` = default).
- **Announcing** („Ankündigen“ on the website, „Veröffentlichen & ankündigen“ in Discord, B-13) posts to the event's channel, else to the default as today. When the event's own channel cannot take the post (deleted, no rights) the answer says so: „Der Ankündigungskanal des Events ist nicht erreichbar – wähle im Assistenten einen anderen.“
- **The announce dialog** names the target channel („Wird in #raid-termine gepostet.“) so the admin sees it before sending.
- **Series and templates:** the channel is a shared setting of a series (`SERIES_FIELDS`, „Dieser und alle folgenden Termine“) and a template setting (`TEMPLATE_FIELDS`, W-10), so `/event erstellen vorlage:…` uses it too. Duplicates keep it.
- Validation: `announceChannelId` is `''` or a Discord id (17–20 digits); anything else → 400 „Ankündigungskanal ist ungültig.“
- Polls stay on the default channel (out of scope); live updates of posted announcements are unchanged (each record keeps its channel).

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `discord-announcements`: new requirements for the per-event channel (choice, fallback, unreachable channel, dialog hint); existing requirements unchanged.

## Impact

- Code: `utils/adminActions.js` (`buildNewEvent` field, `announceEvent` target + error), `routes/admin.js` (`buildEventUpdates` field — POST and PUT whitelist, known trap 3), `middleware/validators.js` (`checkEventFields`), `utils/eventSeries.js` (`SERIES_FIELDS`), `utils/eventTemplates.js` (`TEMPLATE_FIELDS`, `pickTemplateSettings`), `utils/eventPreview.js` if it copies fields; frontend `public/index.html` (select in step 5, hint in the announce dialog), `public/js/admin/wizard.js` (fill/collect), `public/js/admin/wizard-templates.js` (mirror list), `public/js/admin/event-actions.js` (dialog hint), a small shared options helper from `public/js/admin/bot-control.js`.
- Data: events (and template settings) get `announceChannelId` (`''` default). No migration: missing = default.
- No new bot helper, env variable, permission or dependency.
- Tests: `test/adminActions.test.js`, `test/devServer.test.js` (POST/PUT keep the field, validation, announce target, series following dates, duplicate), `test/eventTemplates.test.js` / `test/wizardTemplates.test.js` (field lists), wizard frontend test for fill/collect, `test/seed.test.js` if the seed gets an event with its own channel.
- Wiki: `docs/wiki/concepts/data-model.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/concepts/event-lifecycle.md` (series fields), `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md` (new ids), `docs/wiki/modules/utils.md`.
