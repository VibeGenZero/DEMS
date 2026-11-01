# Design

## Context

- `announceEvent` (`utils/adminActions.js`, B-13) resolves the target through `announceTarget(loadBotSettings())`: bot center `announceChannel`, else `DISCORD_ANNOUNCE_CHANNEL_ID`, else the German error. It is used by `POST /api/admin/events/:id/announce` and the Discord draft button.
- Event fields must be whitelisted in `POST` (`buildNewEvent`) and `PUT` (`buildEventUpdates`) — known trap 3. Series share `SERIES_FIELDS` (`utils/eventSeries.js`), templates `TEMPLATE_FIELDS` + `pickTemplateSettings` (mirrored in `public/js/admin/wizard-templates.js`, pinned by a test).
- The bot center already renders a text-channel dropdown (`announceChannelOptions` / `textChannelOptions` in `public/js/admin/bot-control.js`, data from `GET /api/admin/channels`).

## Goals / Non-Goals

**Goals:**
- One more event field that flows through every path that copies event settings.

**Non-Goals:**
- No channel per poll; no change of how posted announcements are refreshed (records keep their own `channelId`).

## Decisions

### 1. Field and validation

`announceChannelId: string`, `''` = default. `checkEventFields` (also used for templates and the Discord modal): when present it must be `''` or `/^\d{17,20}$/`, else „Ankündigungskanal ist ungültig.“. `buildNewEvent` and `buildEventUpdates` set `announceChannelId: input.announceChannelId || ''`.

### 2. Target resolution

In `announceEvent`: `channelId = event.announceChannelId || announceTarget(settings).channelId`; the "no channel" error only when both are empty. A failed `sendChannelMessage` with the event's own channel keeps status 500 but answers the new German text, so the admin knows to change the channel; with the default channel the old „Konnte nicht in den Channel posten.“ stays.

### 3. Copies

- `SERIES_FIELDS` and `TEMPLATE_FIELDS` (+ the frontend mirror) get `announceChannelId`; `pickTemplateSettings` normalizes it to a string. Following dates and extensions then copy it through the existing code.
- `duplicate` copies the original's fields already (spread of the stored event) — verified by a test.

### 4. Wizard

- `public/index.html`, step 5 „Erweitert“: a new `glass-card is-tinted` block „Ankündigungskanal“ (icon `bi-megaphone`) with `<select id="event-announce-channel">` and a hint („Wohin „Ankündigen“ dieses Event postet.“).
- `bot-control.js` exports `textChannelOptions` (today private); `wizard.js` fills the select when the wizard opens (`GET /api/admin/channels` — the location field already loads the list in `wizard-location.js`, reuse its cache through a small exported getter if present, else fetch) with the empty option „Standard aus der Bot-Zentrale“ plus „ (#name)“ when `state.botSettings.announceChannel` is known; `fillWizard` sets the value (an unknown stored id becomes the „Gespeicherter Kanal“ option); the collect step sends `announceChannelId`.
- `loadWizardBotSettings` (B-02) already reads `GET /api/admin/bot/settings`; it keeps `announceChannel` in `state.botSettings` for the label.

### 5. Announce dialog

`showAnnounceDialog` (event-actions.js) reads the event from the admin list (has `announceChannelId`) and the bot settings, and writes the target line into a new `#announce-target` (`text-muted small`): own channel name, else default name + „(Standard)“, else „Kein Ankündigungskanal festgelegt“. Channel names from `GET /api/admin/channels`.

## Risks / Trade-offs

- [Channel deleted later] → the announce answer names the problem; the wizard shows the id as „Gespeicherter Kanal“ so it can be changed.
- [Bot lacks rights in the chosen channel] → same message; the invite permissions already include sending in text channels.
