---
id: known-issues
title: Known issues and pitfalls
type: reference
tags: [bugs, pitfalls, technical-debt, gotchas]
sources: [public/js/app.js, bot.js, routes/events.js, routes/admin.js, utils/eventUtils.js, server.js, public/css/style.css, README.md]
see_also: [security, frontend-app, bot, reminders-presence]
---
# Known issues and pitfalls

> TL;DR: Verified bugs and traps in the current code (2026-10-02), each with location and impact. Check this list before debugging "weird" behaviour; when you fix one, delete its row and update the linked node.

## Bugs

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | second `DOMContentLoaded` handler calls undefined `setupEventListeners()` | `public/js/app.js` "Initialization" | `.catch` runs `showLoggedOut()`; can race with `checkAuth()` and hide the logged-in UI |
| 2 | `showUserData` declared twice | `public/js/app.js` | the later `async` version silently wins |
| 3 | comment avatar built as `cdn.discordapp.com/avatars/<id>/<session.avatar>.png` although `session.avatar` is already a URL | `routes/events.js` `POST /:id/comments` | broken avatars on new comments |
| 4 | `DELETE /api/admin/events/:id` deletes the event before `deleteEventChannels(id)` reads it | `routes/admin.js` | auto-created Discord channels are never removed |
| 5 | reminders ignore the stored `sent` flag | `bot.js` `checkReminders` | reminder DMs repeat after a restart inside the window |
| 7 | bot settings `dmNotifications`, `eventStartNotifications`, `autoChannelCreation`, `announceChannel`, `welcomeMessage` are stored but never read | `bot.js`, `routes/admin.js` | toggles in the bot control center have no effect |
| 8 | `parseTemplate` passes values to `String.replace` as replacement strings | `bot.js` | `$&`, `$1` in names/titles are interpreted |

## Data exposure (see [security](../concepts/security.md))

| # | Issue | Location |
|---|---|---|
| 9 | `checkinCode` included in `GET /api/events`, `/series/:id` and events embedded in `/api/user/registrations` and `/profile` | routes/events.js, routes/user.js |
| 10 | non-active events readable by id | `GET /api/events/:id` |
| 11 | guest `my-registration` returns the registrant's full document | `GET /api/events/:id/my-registration` |

## Pitfalls (by design, easy to trip over)

| # | Pitfall | Where to read |
|---|---|---|
| 12 | plain-HTTP access from a non-localhost host hangs the SPA (CSP `upgrade-insecure-requests`) | [security](../concepts/security.md) |
| 13 | sessions in MemoryStore: logout on every restart, cookie `secure: false` | [auth-session](../concepts/auth-session.md) |
| 14 | panic mode does not end existing sessions (frontend overlay only) | [maintenance-mode](../concepts/maintenance-mode.md) |
| 15 | `formAnswers` keyed by field label | [form-fields](../concepts/form-fields.md) |
| 16 | Express route order: static paths must come before `/:id` | [routes-events](../modules/routes-events.md) |
| 17 | `GET /api/events/:id` ignores `?status=` (frontend sends `?status=all`) | routes/events.js |
| 18 | "PROFILE SECTION" defined twice in `style.css` | [frontend-markup](../modules/frontend-markup.md) |
| 19 | `marked` loaded from CDN without a version pin | `public/index.html` |
| 20 | README is partly outdated: mentions `DISCORD_REDIRECT_URI` (unused) and "EJS Templating" (there is no EJS) | `README.md` |
| 21 | dev mock mode: reminder DMs not simulated; sample dates go stale → `npm run dev:reset` | [dev-mock-mode](../modules/dev-mock-mode.md) |
