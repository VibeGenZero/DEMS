---
id: known-issues
title: Known issues and pitfalls
type: reference
tags: [bugs, pitfalls, technical-debt, gotchas]
sources: [public/js, plugin-sdk/host.js, routes/calendar.js, bot.js, routes/events.js, routes/admin.js, utils/eventUtils.js, server.js, public/css/style.css]
see_also: [security, frontend-app, bot, reminders-presence, plugin-sdk]
---
# Known issues and pitfalls

> TL;DR: Verified bugs and traps in the current code (2026-11-18), each with location and impact. Check this list before debugging "weird" behaviour; when you fix one, delete its row and update the linked node.

## Bugs

None known right now. Add a row `| # | Issue | Location | Impact |` when you find one.

## Pitfalls (by design, easy to trip over)

| # | Pitfall | Where to read |
|---|---|---|
| 12 | plain-HTTP access from a non-localhost host hangs the SPA (CSP `upgrade-insecure-requests`); the setup wizard of a fresh installation (#138) needs HTTPS in production even on localhost (Secure session cookie; the PIN step warns) | [security](../concepts/security.md) |
| 15 | `formAnswers` keyed by field label | [form-fields](../concepts/form-fields.md) |
| 16 | Express route order: static paths must come before `/:id` | [routes-events](../modules/routes-events.md) |
| 17 | `GET /api/events/:id` ignores `?status=` (frontend sends `?status=all`) | routes/events.js |
| 21 | dev mock mode: reminder DMs not simulated; sample dates go stale → `npm run dev:reset` | [dev-mock-mode](../modules/dev-mock-mode.md) |
| 22 | Windows with an antivirus that inspects HTTPS (Kaspersky, …): Node rejects its certificate, AI calls fail now and then with code `certificate` (admin: „Zertifikat … nicht anerkannt“, members: „nicht erreichbar“); start DEMS with `node --use-system-ca` | [ai-integration](../concepts/ai-integration.md) |
| 23 | Calendar subscription: „In Google Kalender öffnen“ only works for an installation on public HTTPS — Google fetches the feed from its own servers, so `localhost`, LAN addresses and test setups fail there; Apple Calendar, Outlook and the copied link work locally. Calendar apps poll on their own schedule (Google often only every 8–24 h), so a change reaches the calendar late | [routes-user](../modules/routes-user.md#calendar-subscription) |
| 24 | Plugins run in the DEMS process without isolation: every plugin call is wrapped in `try/catch` and timeouts (`register` 5 s, `onDisable` 2 s, slow-hook warning 10 s), but a **synchronous endless loop** (or a long blocking computation) in a plugin blocks the whole process — web, API and bot — until real isolation exists; restart with `PLUGINS_SAFE_MODE=true`, switch the broken plugin off in System › Plugins, remove the line, restart | [plugin-sdk](../concepts/plugin-sdk.md) |
