---
id: api-index
title: API index — every HTTP endpoint
type: reference
tags: [api, endpoints, rest, index, routes]
sources: [server.js, routes/plugins.js, routes/pluginStatic.js, routes/pluginTheme.js, routes/adminPlugins.js, plugins/custom-design/server.js, routes/setup.js, routes/auth.js, routes/events.js, routes/user.js, routes/admin.js, dev/devAuth.js]
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
| GET | `/calendar/<token>.ics` (calendar subscription of one member, iCalendar; no session, the secret in the path is the key; own rate limits; unknown links 404) | — |
| GET | `/api/csrf-token` | — |
| GET | `/api/maintenance/status` | — |
| GET | `/api/privacy` (#138: current privacy policy `{ markdown, version, updatedAt }`, 404 without one) | — |
| GET | `/api/server-info` (`{ serverName, iconUrl, guildId, debugMode, ai: { memberAssistant, assistantName, teaserText, adminAssistant } }`; `ai` also in the error fallback, all off) | —
| GET | `/api/updates` | — |
| GET / HEAD | `/plugins/:pluginId/<client.js\|client.css\|assets/<name>>` (client files of switched-on plugins, `routes/pluginStatic.js`; allow-list, creates no session; anything else plain 404) | — |
| GET | `/theme.css` (published stylesheets of enabled plugins with `theme`, `routes/pluginTheme.js`; re-checked with `checkThemeCss`, ETag + `Cache-Control: no-cache`, creates no session; empty in safe mode) | — |
| GET | `/theme-preview.css` (like `/theme.css`, with a plugin's draft replacing its published sheet; `Cache-Control: no-store`; non-admins get 404) | A |
| GET | `/api/plugins` (client list of switched-on plugins: `[{ id, name, version, official, permissions, client, css }]`; `[]` in safe mode or before the host is ready) | U |
| any | `/api/plugins/:pluginId/{*splat}` (dispatcher for `ctx.routes.*`, `routes/plugins.js`; off or unknown plugin 404 `Plugin nicht gefunden.`, unknown route 404 `Nicht gefunden.`, routes with `password: true` also check `req.body.password` against `ADMIN_RESET_PASSWORD` and strip it before the handler) | U or A, per route `access` |
| GET | `/{*splat}` (SPA fallback) | — |

## /api/setup — setup wizard (#138, `routes/setup.js`, [security](../concepts/security.md#first-run-setup-138))

Only in setup mode (afterwards 409 `Die Einrichtung ist bereits abgeschlossen.`); `P` = session that entered the setup PIN (else 403). In setup mode every other `/api/*` and `/auth/*` path except `/api/csrf-token`, `/api/server-info`, `/api/maintenance/status`, `/api/privacy` and `/api/updates` answers 503 `{ error: 'DEMS ist noch nicht eingerichtet.', setupRequired: true }`.

| Method | Path | Guard |
|---|---|---|
| GET | `/api/setup/status` → `{ required, unlocked, locked, httpsRequired (production over plain HTTP), defaults: { BASE_URL, TIMEZONE } }`, with `P` also `discordDone`, `values` (non-secret), `secretsSet`, `aiProviders` (`[{ id, label, defaultBaseUrl, keyRequired }]`) | — |
| POST | `/api/setup/unlock` `{ pin }` (5 attempts / 15 min / IP → 429; new session) | — |
| GET | `/api/setup/invite-url?clientId=` → `{ url }` | P |
| POST | `/api/setup/discord` `{ clientId, clientSecret, botToken, guildId }` → `{ guildName, roles, channels, categories }`; 400 names the guide step, `inviteUrl` when the bot is not on the guild | P |
| GET | `/api/setup/guild` → roles, channels, categories again | P |
| POST | `/api/setup/ai/test`, `/api/setup/ai/models` `{ provider, baseUrl, apiKey, model }` → same answers as `/api/admin/ai/test` and `/api/admin/ai/models` (optional step „KI") | P |
| POST | `/api/setup/complete` `{ baseUrl, serverName, timezone, adminRoleId, announceChannelId, eventCategoryId, threadSync, adminResetPassword, aiProvider?, aiBaseUrl?, aiApiKey?, aiModel?, privacyMarkdown? }` → `{ success, restartRequired }`; AI values only with a provider, which needs a model (400); ends setup mode and the session | P |

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
| GET / POST / DELETE | `/api/user/calendar` (calendar subscription: show, set up or renew, end) | U |
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
| DELETE | `/api/admin/reset` (`targets` incl. `pluginData`; `users` wipes plugin data too) |
| GET | `/api/admin/plugins` (`{ safeMode, uploadEnabled, plugins }`, views + public `settingsValues`) |
| POST | `/api/admin/plugins/upload/check` (raw `application/octet-stream` `.dems` ≤ 5 MB, 413 above; `PLUGINS_UPLOAD=true` else 403, 409 in safe mode, 429 after 10 checks per 10 min per session; writes nothing → `{ uploadId, report }`, `uploadId` only for a package without errors, `report.replaces` for an installed id) |
| POST | `/api/admin/plugins/upload/install` (`{ uploadId, password, replace }`; reset password (401) before the upload is taken, 410 expired or used, 409 already installed without `replace` or plugin on, 400 package error → `{ plugin }`; audit `PLUGIN_UPLOAD`) |
| PUT | `/api/admin/plugins/:id/enabled` (`{ enabled, trust?, password? }`; custom plugin on needs `trust` + reset password), `/plugins/:id/settings` (`{ values, password? }`; a secret needs the reset password) |
| DELETE | `/api/admin/plugins/:id/data` (only while off; `{ deleted }`) |
| DELETE | `/api/admin/plugins/:id` (`{ password }`; `PLUGINS_UPLOAD=true` else 403; custom and off only, deletes the folder, the state stays („Verwaist“) → `{ removed: true }`; audit `PLUGIN_REMOVE`) |
| GET | `/api/admin/bot/status`, `/bot/running-events` |
| GET / PUT | `/api/admin/bot/settings` |
| GET / PUT | `/api/admin/maintenance` |
| POST | `/api/admin/maintenance/panic`, `/maintenance/panic/deactivate` |

## /api/plugins/custom-design — official plugin „Design anpassen“ ([plugin-sdk](../concepts/plugin-sdk.md), all A)

| Method | Path |
|---|---|
| GET | `/api/plugins/custom-design/` (`{ published, draft, defaults, warnings }`) |
| PUT | `/api/plugins/custom-design/draft` (validates source, compiles CSS, saves draft via `ctx.theme.saveDraft`; stores filter errors on `draft.error` and answers 200 `{ draft, warnings }`) |
| DELETE | `/api/plugins/custom-design/draft` (discards draft in `ctx.theme` and `designs/draft`) |
| POST | `/api/plugins/custom-design/publish` (publishes stored draft when free CSS did not change; 409 without a draft or with `draft.error`, 403 when free CSS changed) |
| POST | `/api/plugins/custom-design/publish-css` (`password: true` admin reset password; publishes stored draft including changed free CSS) |
| POST | `/api/plugins/custom-design/reset` (clears `ctx.theme` and deletes `draft` and `published`) |
