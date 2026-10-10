---
id: known-issues
title: Known issues and pitfalls
type: reference
tags: [bugs, pitfalls, technical-debt, gotchas]
sources: [public/js, bot.js, routes/events.js, routes/admin.js, utils/eventUtils.js, server.js, public/css/style.css, README.md]
see_also: [security, frontend-app, bot, reminders-presence]
---
# Known issues and pitfalls

> TL;DR: Verified bugs and traps in the current code (2026-10-02), each with location and impact. Check this list before debugging "weird" behaviour; when you fix one, delete its row and update the linked node.

## Bugs

| # | Issue | Location | Impact |
|---|---|---|---|
| 7 | bot settings `dmNotifications`, `eventStartNotifications`, `autoChannelCreation`, `announceChannel`, `welcomeMessage` are stored but never read | `bot.js`, `routes/admin.js` | toggles in the bot control center have no effect |

## Pitfalls (by design, easy to trip over)

| # | Pitfall | Where to read |
|---|---|---|
| 12 | plain-HTTP access from a non-localhost host hangs the SPA (CSP `upgrade-insecure-requests`) | [security](../concepts/security.md) |
| 14 | panic mode does not end existing sessions (frontend overlay only); sessions are stored in the database, so a restart does not end them either | [maintenance-mode](../concepts/maintenance-mode.md) |
| 15 | `formAnswers` keyed by field label | [form-fields](../concepts/form-fields.md) |
| 16 | Express route order: static paths must come before `/:id` | [routes-events](../modules/routes-events.md) |
| 17 | `GET /api/events/:id` ignores `?status=` (frontend sends `?status=all`) | routes/events.js |
| 20 | README is partly outdated: mentions `DISCORD_REDIRECT_URI` (unused) and "EJS Templating" (there is no EJS) | `README.md` |
| 21 | dev mock mode: reminder DMs not simulated; sample dates go stale → `npm run dev:reset` | [dev-mock-mode](../modules/dev-mock-mode.md) |
