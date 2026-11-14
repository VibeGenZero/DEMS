---
id: known-issues
title: Known issues and pitfalls
type: reference
tags: [bugs, pitfalls, technical-debt, gotchas]
sources: [public/js, bot.js, routes/events.js, routes/admin.js, utils/eventUtils.js, server.js, public/css/style.css, README.md, e2e/motion.spec.js]
see_also: [security, frontend-app, bot, reminders-presence]
---
# Known issues and pitfalls

> TL;DR: Verified bugs and traps in the current code (2026-10-02), each with location and impact. Check this list before debugging "weird" behaviour; when you fix one, delete its row and update the linked node.

## Bugs

| # | Issue | Location | Impact |
|---|---|---|---|
| 22 | e2e "a ctrl click opens the event in a new tab" clicks with `Control`; on macOS that opens the context menu instead of a new tab, so the test times out there | `e2e/motion.spec.js` | `npm run test:e2e` is red on a Mac although the app works; fix: `ControlOrMeta` |

## Pitfalls (by design, easy to trip over)

| # | Pitfall | Where to read |
|---|---|---|
| 12 | plain-HTTP access from a non-localhost host hangs the SPA (CSP `upgrade-insecure-requests`); the setup wizard of a fresh installation (#138) needs HTTPS in production even on localhost (Secure session cookie; the PIN step warns) | [security](../concepts/security.md) |
| 15 | `formAnswers` keyed by field label | [form-fields](../concepts/form-fields.md) |
| 16 | Express route order: static paths must come before `/:id` | [routes-events](../modules/routes-events.md) |
| 17 | `GET /api/events/:id` ignores `?status=` (frontend sends `?status=all`) | routes/events.js |
| 20 | README is partly outdated: mentions `DISCORD_REDIRECT_URI` (unused) and "EJS Templating" (there is no EJS) | `README.md` |
| 21 | dev mock mode: reminder DMs not simulated; sample dates go stale → `npm run dev:reset` | [dev-mock-mode](../modules/dev-mock-mode.md) |
| 22 | Windows with an antivirus that inspects HTTPS (Kaspersky, …): Node rejects its certificate, AI calls fail now and then with code `certificate` (admin: „Zertifikat … nicht anerkannt“, members: „nicht erreichbar“); start DEMS with `node --use-system-ca` | [ai-integration](../concepts/ai-integration.md) |
