---
id: api-index
title: API index — every HTTP endpoint
type: reference
tags: [api, endpoints, rest, index, routes]
sources: [server.js, routes/setup.js, routes/auth.js, routes/events.js, routes/user.js, routes/admin.js, dev/devAuth.js]
depends_on: [routes-auth, routes-events, routes-admin, routes-user, server]
see_also: [request-lifecycle, add-api-endpoint]
---
# API index — every HTTP endpoint

> TL;DR: One line per endpoint with its guard and the node that documents it. Guards: `—` public, `U` logged-in user (`requireAuth`), `A` admin (`requireAuth` + `requireAdmin`). All mutating `/api/*` calls also need the `X-CSRF-TOKEN` header. While a privacy policy waits for the member's consent, `U` and `A` endpoints answer 403 `privacyRequired` ([auth-session](../concepts/auth-session.md#privacy-consent-138)).

## server.js — [server](../modules/server.md)

| Method | Path | Guard |
|---|---|---|
| GET | `/healthz` | — |
| GET | `/uploads/banners/<uuid>.<png\|jpg\|gif\|webp>` (W-12, uploaded banners, read-only, no session; other names 404) | — |
| GET | `/api/csrf-token` | — |
| GET | `/api/maintenance/status` | — |
| GET | `/api/privacy` (#138: current privacy policy `{ markdown, version, updatedAt }`, 404 without one) | — |
| GET | `/api/server-info` (`{ serverName, iconUrl, guildId, debugMode, ai: { memberAssistant, assistantName, teaserText, adminAssistant } }`; `ai` also in the error fallback, all off) | —
| GET | `/api/updates` | — |
| GET | `/{*splat}` (SPA fallback) | — |

## /api/setup — setup wizard (#138, `routes/setup.js`, [security](../concepts/security.md#first-run-setup-138))

Only in setup mode (afterwards 409 `Die Einrichtung ist bereits abgeschlossen.`); `P` = session that entered the setup PIN (else 403). In setup mode every other `/api/*` and `/auth/*` path except `/api/csrf-token`, `/api/server-info`, `/api/maintenance/status`, `/api/privacy` and `/api/updates` answers 503 `{ error: 'DEMS ist noch nicht eingerichtet.', setupRequired: true }`.

| Method | Path | Guard |
|---|---|---|
| GET | `/api/setup/status` → `{ required, unlocked, locked, httpsRequired (production over plain HTTP), defaults: { BASE_URL, TIMEZONE } }`, with `P` also `discordDone`, `values` (non-secret), `secretsSet` | — |
| POST | `/api/setup/unlock` `{ pin }` (5 attempts / 15 min / IP → 429; new session) | — |
| GET | `/api/setup/invite-url?clientId=` → `{ url }` | P |
| POST | `/api/setup/discord` `{ clientId, clientSecret, botToken, guildId }` → `{ guildName, roles, channels, categories }`; 400 names the guide step, `inviteUrl` when the bot is not on the guild | P |
| GET | `/api/setup/guild` → roles, channels, categories again | P |
| POST | `/api/setup/complete` `{ baseUrl, serverName, timezone, adminRoleId, announceChannelId, eventCategoryId, threadSync, adminResetPassword, privacyMarkdown? }` → `{ success, restartRequired }`; ends setup mode and the session | P |

## /auth — [routes-auth](../modules/routes-auth.md)

| Method | Path | Guard |
|---|---|---|
| GET | `/auth/discord` | — |
| GET | `/auth/discord/callback` | — |
| GET | `/auth/me` | — |
| POST | `/auth/logout` | — (CSRF token) |
| GET | `/auth/dev-login`, `/auth/dev-login/:personaId` | — (only with `DEV_MOCK=true`) |

## /api/events — [routes-events](../modules/routes-events.md)

| Method | Path | Guard |
|---|---|---|
| GET | `/api/events` | U (non-active `?status=` → A) |
| GET | `/api/events/series/:seriesId` | U (draft/archived only for A) |
| GET | `/api/events/form-options` | U |
| GET | `/api/events/:id` | U (draft/archived → 404 unless A; same for every `/:id` route) |
| POST | `/api/events/:id/ask` (`routes/eventAsk.js`, mounted before `routes/events.js`; body `{ question, history }`; JSON errors 400/404/429/500 before the stream, otherwise `text/event-stream` with `token` / `done` / `error` events; feature off → 404) | U + CSRF |
| POST / DELETE | `/api/events/:id/register` | U (POST also maintenance gate) |
| PUT | `/api/events/:id/register/slot` | U (+ maintenance gate) |
| POST | `/api/events/:id/register/confirm` | U (+ maintenance gate) |
| GET | `/api/events/:id/my-registration` | U |
| GET | `/api/events/:id/participants` | U |
| POST | `/api/events/:id/checkin` | U |
| GET / POST | `/api/events/:id/comments` | U |
| DELETE | `/api/events/:id/comments/:commentId` | U (owner or admin) |

## /api/polls — [routes-polls](../modules/routes-polls.md)

| Method | Path | Guard |
|---|---|---|
| GET | `/api/polls` | U |
| GET | `/api/polls/:id` | U |
| PUT | `/api/polls/:id/vote` | U (+ maintenance gate) |

## /api/user — [routes-user](../modules/routes-user.md)

| Method | Path | Guard |
|---|---|---|
| POST | `/api/user/privacy/accept` (#138) | U |
| GET | `/api/user/registrations` | U |
| GET | `/api/user/profile` | U |
| GET | `/api/user/search?q=` | U |
| GET / PUT | `/api/user/settings` | U |
| DELETE | `/api/user/account` | U |

## /api/admin — [routes-admin](../modules/routes-admin.md) (all A)

| Method | Path |
|---|---|
| GET | `/api/admin/roles`, `/channels`, `/stats`, `/all-events`, `/import/discord-events` |
| GET | `/api/admin/ai/settings`, `/api/admin/ai/usage` (AI integration), `/api/admin/system/settings`, `/system/invite-url` (#138), `/system/update-status` (newest GitHub release vs. running version) |
| PUT | `/api/admin/ai/settings` (behaviour settings, no password), `/api/admin/system/settings` (#138, needs `password` = admin reset password), `/api/admin/privacy` (#138, `{ markdown }`) |
| POST | `/api/admin/ai/test`, `/api/admin/ai/models` (typed, unsaved connection values; test always answers 200) |
| POST | `/api/admin/ai/event-draft` (`{ message, draft, history }` → `{ patch, reply, questions }`), `/api/admin/ai/text` (`{ kind, draft }` → `{ text }`) — editor assistant, 404 while `adminAssistant` is off, nothing saved |
| POST | `/api/admin/events`, `/events/preview` |
| POST | `/api/admin/uploads/banner` (W-12, raw image body ≤ 5 MB) |
| PUT | `/api/admin/events/:id` (series dates: optional `applyTo: 'following'`, a later `recurringUntil` extends the series, answer adds `updatedDates` and `createdDates`, W-11), `/events/:id/status`, `/events/:id/cancel` |
| POST | `/api/admin/events/:id/start`, `/events/:id/end`, `/events/:id/duplicate`, `/events/:id/generate-checkin`, `/events/:id/announce`, `/events/:id/sync-discord` |
| DELETE | `/api/admin/events/:id`, `/events/series/:seriesId` |
| GET | `/api/admin/events/:id/checkin-stats`, `/events/:id/registrations`, `/events/:id/registrations/export`, `/events/:id/member-search`, `/events/:id/message-recipients` (W-09) |
| GET | `/api/admin/members`, `/members/:id` (W-15, read-only) |
| GET | `/api/admin/insights?range=30\|90\|365\|all` (W-14, read-only) |
| POST | `/api/admin/events/:id/registrations` (W-06), `/events/:id/registrations/bulk` (W-08), `/events/:id/message` (W-09) |
| PUT | `/api/admin/registrations/:id/status`, `/registrations/:id/slot`, `/registrations/:id/checkin` |
| POST | `/api/admin/polls`, `/polls/:id/close`, `/polls/:id/announce` |
| PUT | `/api/admin/polls/:id` |
| DELETE | `/api/admin/polls/:id` |
| GET / POST | `/api/admin/event-templates` (W-10, shared event templates; POST `{ name, settings }`) |
| PUT / DELETE | `/api/admin/event-templates/:id` (W-10) |
| GET / PUT | `/api/admin/bot-messages` |
| GET | `/api/admin/audit-log` |
| DELETE | `/api/admin/reset` |
| GET | `/api/admin/bot/status`, `/bot/running-events` |
| GET / PUT | `/api/admin/bot/settings` |
| GET / PUT | `/api/admin/maintenance` |
| POST | `/api/admin/maintenance/panic`, `/maintenance/panic/deactivate` |
