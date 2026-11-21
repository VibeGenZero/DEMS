---
id: security
title: Security model and open audit findings
type: concept
tags: [security, csp, helmet, csrf, xss, rate-limit, audit, https]
sources: [server.js, routes/adminPlugins.js, routes/pluginTheme.js, plugin-sdk/themeCss.js, plugin-sdk/theme.js, public/design-boot.js, routes/calendar.js, utils/calendarFeedStore.js, SECURITY.md, routes/setup.js, utils/setupState.js, docs/security/SECURITY_AUDIT_2026-04-22.md, ISSUE.md, routes/events.js, routes/user.js, utils/eventUtils.js, bot/threadSync.js, public/js/core/ui.js, public/js/core/actions.js, utils/trustProxy.js, utils/requestPath.js, utils/ipAddress.js, ai/addressGuard.js, utils/eventComments.js, compose.yaml]
depends_on: [server]
see_also: [auth-session, known-issues, deployment, plugin-sdk]
---
# Security model and open audit findings

> TL;DR: Defenses: helmet CSP (scripts, styles and fonts only from `'self'`; no inline scripts, event handlers or styles), CORS to `BASE_URL`, rate limits, double-submit CSRF on `/api` and `/auth`, httpOnly session cookie, server-side admin guards, `escapeHtml` + DOMPurify in the SPA. The 2026-04-22 audit (28 findings) and the 2026-10-25 pentest are tracked in the tables below — check them before touching auth, events or exports. Serve DEMS over HTTPS: helmet's default `upgrade-insecure-requests` breaks plain-HTTP access from anything but localhost.

## Reporting vulnerabilities

`SECURITY.md` is the public policy: reports only via GitHub private vulnerability reporting (Security › Report a vulnerability), first answer within 7 days, fixes only for the newest release (`latest`) and the newest pre-release (`beta`), then a GitHub Security Advisory. It also lists what is in and out of scope and the hardening hints for operators; keep it in step when a defense below changes.

## Defenses in place

| Layer | Where |
|---|---|
| Security headers + CSP | `helmet(...)` in `server.js` (directive list there) |
| CORS | `cors({ origin: BASE_URL, credentials: true })` |
| Rate limits | `/api/` per logged-in user 1000 / 15 min, otherwise per IP 200 / 15 min (`middleware/rateLimits.js`, mounted after the session; `RATE_LIMIT_MAX_USER`, `RATE_LIMIT_MAX`; the 429 names the wait in minutes and the page shows it once per 30 s, `core/rate-limit-notice.js`), `/auth/` 30 / 15 min (both off in dev mock mode); failed check-ins 10 / 15 min per member (`checkinLimiter`, on in mock mode too); member search `GET /api/user/search` 60 / min per member (`searchLimiter` in `routes/user.js`, on in mock mode too); calendar feed `GET /calendar/<token>.ics` outside `/api`: 30 / 15 min per link (on in mock mode too) and 600 / 15 min per address (off in mock mode), `createCalendarLimiters` |
| Client address | `trust proxy` from `TRUST_PROXY` (`utils/trustProxy.js`): by default one hop, and only when the direct peer is on a loopback, link-local or private address (TLS proxy on the same host or in the Docker network); a client from the internet cannot pick its `req.ip` through `X-Forwarded-For`. `compose.yaml` publishes the port on `127.0.0.1` only (`DEMS_BIND`), so clients cannot skip the proxy |
| CSRF | double-submit token, see [auth-session](auth-session.md) |
| Path gates | the CSRF check, the setup gate and the privacy gate compare the lower-cased path (`utils/requestPath.js`), and `server.js` sets `case sensitive routing`: `/API/…` neither skips a gate nor reaches an `/api` router (it gets 404) |
| AuthZ | `requireAuth`, `requireAdmin`; the whole event API needs a login (no public preview); `draft`/`archived` events answer 404 to non-admins; comments only on an existing event (404 otherwise), delete = owner or admin and only under the comment's own event; deleting an event or a series deletes its comments |
| AI addresses | every AI request goes through `ai/addressGuard.js`: link-local (`169.254.0.0/16`, `fe80::/10`) and known cloud metadata addresses (`metadata.google.internal`, `100.100.100.200`, `fd00:ec2::254`) are refused, written or resolved, with `blocked_address`; only http(s), no redirects; `AI_BASE_URL` with such an address is not stored. Loopback and LAN stay open for a local Ollama. The model list carries only id-shaped strings (≤ 200 chars, ≤ 1000 ids, `ai/providers/modelIds.js`) |
| XSS | frontend `escapeHtml()` for interpolated values, values for actions in `data-*` attributes (escaped with `escapeHtml`, read via `dataset`), never in handler code — the CSP blocks inline handlers, `renderMarkdownSafe()` = marked + DOMPurify for descriptions |
| Secrets | `.env` never in the image (`.dockerignore`); `checkinCode` removed from every event answer outside `/api/admin` (`toPublicEvent` in `utils/eventUtils.js`); the token of the comment-sync webhook (B-16) lives only in memory (`bot/threadSync.js`), never in the database or an answer |
| Mirrored comments (B-16) | web comments go into Discord with `allowedMentions: { parse: [] }` (no `@everyone`, role or user pings) and the suffix „(Web)“; comments from Discord are plain text rendered with `escapeHtml` and marked „Discord“ |
| Uploads (W-12) | banners only via `POST /api/admin/uploads/banner` (admin + CSRF); type read from the magic bytes (PNG, JPEG, GIF, WebP — never SVG), ≤ 5 MB, random `<uuid>.<ext>` name; served read-only under `/uploads/banners/` only for that name pattern, with the image content type and helmet's `nosniff`, so a polyglot file is never run as HTML |
| Calendar subscription | `GET /calendar/<token>.ics` is public on purpose (calendar apps send no cookie): the 256-bit random token (`crypto.randomBytes(32)`, base64url) is the only key, checked against `^[A-Za-z0-9_-]{43}$` before any query; unknown, renewed and ended links all answer the same 404. The token is stored in plain text in `calendarFeeds/<userId>` (not in `users`, whose documents admin code spreads) so the profile can show the link again — a hash would force members to renew and re-subscribe whenever they lose it, and a leaked database exposes more than an event list anyway. Only the owner's `GET /api/user/calendar` answers it (`test/calendarFeedServer.test.js` checks the admin member answers). The feed skips the privacy gate on purpose: it is the member's own data for their own calendar, set up after consent; a new policy version applies on the next website visit. It carries no event description and no other member's data |
| Setup mode (#138) | see [First-run setup](#first-run-setup-138): only the wizard answers until it is completed, its steps need the setup PIN |
| Dev mode | `DEV_MOCK=true` + `NODE_ENV=production` → refuses to start |
| Container | runs as user `node`; production compose pins `NODE_ENV=production` |

## Audit 2026-04-22 — status as of 2026-10-02 (checked against code)

| ID | Finding | Status |
|---|---|---|
| C-01 | check-in code leak | fixed: every event answer outside `/api/admin` goes through `toPublicEvent` (F-02) |
| C-02 | draft/archived/cancelled readable | fixed: the event API needs a login, `draft`/`archived` answer 404 to non-admins on every `/:id` route and are left out of series answers, `?status=` other than `active` answers 403 (F-03); `cancelled` stays readable by id for members on purpose |
| C-03 | session cookie not `secure` | fixed: session and `XSRF-TOKEN` cookies are `Secure` with `NODE_ENV=production` (F-05) |
| C-04 | vulnerable dependencies | fixed (dependency update 2026-09, `npm audit` 0) |
| H-01 / H-02 | OAuth `state`, session regeneration | fixed: one-time `state` per login, `startUserSession` regenerates the session (F-05) |
| H-03 | 24 h admin cache | fixed: roles and `isAdmin` are re-read from Discord at most every 5 minutes (`createRoleRefresh`, F-15) |
| H-04 | guest `my-registration` leaks registrant data | fixed: guests get only `{ registered, asGuest, id, status }` (F-04) |
| H-05 | CSP `unsafe-inline` + `unsafe-eval` | **done**. Scripts (D-01): `unsafe-eval` removed (F-07); `script-src 'self'`, `script-src-attr 'none'`; actions via `data-click`/`data-change`/`data-input` (`core/actions.js`). Styles (D-16): `style-src 'self'`, `style-src-attr 'none'`; markup carries no `style` attribute and no `<style>` element (guard in `test/cssRules.test.js`), start states use the class `.is-hidden`, runtime values go through `data-style-*` + `applyStyleData` (`core/ui.js`); Markdown of users loses `style` attributes and `<style>` tags (`renderMarkdownSafe`), so it can neither style nor overlay the page. Styles that scripts set through the CSSOM (`element.style.…`) are not affected by the policy |
| H-06 | check-in code via `Math.random`, not specifically rate-limited | fixed: `crypto.randomInt`, 10 failed check-ins / 15 min per member (F-14) |
| M-01 | Firebase client SDK used server-side | obsolete — Firestore removed in 3.0 (R-01), PostgreSQL is only reachable inside the compose network |
| M-02 | CDN assets without SRI | fixed: no CDN assets, libraries and fonts are vendored in `public/vendor/` (F-07) |
| M-03 | non-constant-time password compare | fixed: `safeEqual` (SHA-256 + `timingSafeEqual`) for reset and panic deactivation (F-14) |
| M-04 | panic without 2nd factor | open |
| M-05 | public comments | fixed (comments require login) |
| M-06 | unbounded queries | open |
| M-07 | user search enumeration | mitigated: 60 searches / min per member (pentest 2026-10-25) |
| M-08 / M-09 | `bannerUrl` / `accentColor` not validated server-side | fixed: `validateEvent` allows only http(s) URLs and hex colours (F-14) |
| L-02 | MemoryStore | fixed: sessions in the database via `PersistentSessionStore`, document id = SHA-256 of the session id (F-06) |
| L-03 / L-04 | `parseTemplate` `$` patterns, CSV formula injection | fixed: `parseTemplate` inserts values literally (`utils/template.js`), CSV cells via `csvCell` with a leading apostrophe for `= + - @` (F-14) |
| L-07 | logout via GET | fixed: `POST /auth/logout` with CSRF token (F-05) |

Full report: `docs/security/SECURITY_AUDIT_2026-04-22.md`; older notes: `ISSUE.md`.

## Pentest 2026-10-25 (3.0.0-beta.3, issue #115) — status

The report itself is confidential and stays in the issue; this table only tracks the fixes.

| ID | Finding | Status |
|---|---|---|
| vuln-0001 | body-parser 2.3.0, DoS before login (CVE-2026-111181) | fixed: body-parser 2.4.0 |
| vuln-0002 / 0003 | undici 6.29.0, DoS (CVE-2026-109869, CVE-2026-109924) | fixed: undici 6.29.1 |
| vuln-0004 / 0005 | @grpc/grpc-js 1.9.16 (via Firebase) | obsolete: Firebase removed (R-01) |
| vuln-0007 | expired sessions accepted | hardened: the stored cookie expiry is checked too, broken records count as no session (the reported bypass needed write access to the database) |
| vuln-0008 | guest objects taken verbatim | fixed: guests resolved against `users`, name/avatar from the profile, max 10 (`loadValidGuests`) |
| vuln-0009 | `formAnswers` stored unvalidated | fixed: `sanitizeFormAnswers` |
| vuln-0010 | admin reset of the users kept their sessions | fixed: ends all non-admin sessions like panic mode |
| — | two guests accepting at once lose an answer | fixed: guest buttons under `withEventLock` |

## White-box audit 2026-11-20 (3.4.0) — status

| # | Finding | Status |
|---|---|---|
| 1 | setup PIN limit bypassed with a forged `X-Forwarded-For` (`trust proxy 1`, port published directly) | fixed: `TRUST_PROXY` default trusts only a local proxy (`utils/trustProxy.js`), `compose.yaml` binds `127.0.0.1` (`DEMS_BIND`), and on top of 5 / 15 min per IP at most 20 wrong PINs / 15 min from all addresses together |
| 2 | SSRF through the admin-typed AI base URL | fixed: `ai/addressGuard.js` refuses link-local and metadata addresses (also after DNS), only http(s), no redirects; model list reduced to ids. Loopback/LAN stay reachable on purpose (local Ollama); DNS rebinding between check and fetch is not covered |
| 3 | CSRF, privacy and setup gates skipped via `/API/…` (case-insensitive routing, case-sensitive checks) | fixed: gates compare in lower case (`utils/requestPath.js`), `case sensitive routing` on |
| 4 | comments of deleted or unknown events stay readable / can be created | fixed: comment routes 404 without the event, delete only under the comment's event, event and series deletion delete comments, migration `001-remove-orphan-comments` cleans old orphans |

## HTTPS requirement

Helmet adds `upgrade-insecure-requests` to the CSP by default. Browsers then rewrite all asset URLs of a page served via `http://<ip>:3000` to `https://` → CSS/JS fail, the SPA hangs on the loading screen ("Initialisiere System..."). `http://localhost` is exempt. Use a TLS reverse proxy ([deployment](../ops/deployment.md)) or set `upgradeInsecureRequests: null` in the CSP directives for intentional plain-HTTP setups.

## First-run setup (#138)

A fresh installation (no setup completed, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` or `DISCORD_GUILD_ID` missing after the stored configuration was loaded; never in dev mock mode) runs in **setup mode** (`utils/setupState.js`):

- The gate in `server.js` answers every `/api/*` and `/auth/*` request with 503 except `/api/setup/*` and the public start-page endpoints ([api-index](../reference/api-index.md)). Static files and `/healthz` stay up.
- The setup PIN is `SETUP_PIN` or a random 8-digit PIN (`crypto.randomInt`) created at every start, printed in the log, kept in memory only and compared with `safeEqual`. Whoever reads the container log already controls the host; the PIN changes with each start and is void once the setup is done.
- `POST /api/setup/unlock` is limited to 5 attempts per 15 minutes and IP, and to 20 wrong PINs per 15 minutes from all addresses together („Zu viele falsche Setup-PINs. Bitte warte 15 Minuten oder starte DEMS neu.“; the counters live in memory, a restart clears them and logs a new PIN unless `SETUP_PIN` is set). A success regenerates the session (a planted cookie is useless); only that session may run the steps.
- The Discord step checks the client id/secret with an OAuth2 `client_credentials` request and the bot token with a real login before anything is stored; the values reach `process.env` for the login and are taken back on failure.
- The optional step „KI" tries typed AI values through `POST /api/setup/ai/test` and `/api/setup/ai/models` (same handlers as the admin routes, `routes/aiConnection.js`, behind the setup session). Completing stores `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` only when a provider is chosen (a provider without a model → 400 „Bitte wähle ein KI-Modell oder überspringe den KI-Schritt."); „Überspringen" sends them empty and nothing of the AI is stored. Values from `.env` stay.
- Completing stores the values (`systemSettings/config`, secrets in plain text, never returned), ends setup mode without a restart and destroys the setup session.
- The setup needs HTTPS like the login: in production the session cookie is `Secure`, so over plain HTTP — `http://localhost` included — the PIN never sticks (the unlock answers 403 „Ungültiges CSRF-Token“); `GET /api/setup/status` then reports `httpsRequired: true` and the PIN step shows a warning. Plain `http://<ip>` also hangs on the loading screen (see below). Outside production (`npm start` without `NODE_ENV`, dev) plain HTTP works.

## Rules for changes

- New endpoints: decide the guard explicitly (`requireAuth`/`requireAdmin`), never trust frontend hiding.
- `routes/events.js` guards itself: `router.use(requireAuth)` for every route and `router.param('id')` hides `draft`/`archived` events from non-admins; new `/:id` routes inherit both.
- AI integration ([ai-integration](ai-integration.md)): `AI_BASE_URL` is set only by admins (System › KI, with the reset password like every managed key) or the setup session, and tested only by them; it may point at a private address on purpose (Ollama on the LAN), so it is a server-side request the admin chooses. The stored key reaches only the stored provider and endpoint, is kept in plain text in `systemSettings/config` like the other secrets and never appears in an answer, a log line or the audit log. The provider receives the question, the history and the data of one event the asker can see (plus `aiNotes`, the assistant name and the admin's extra instructions) — never the asker's name or Discord id, other members or their registrations (only counts of places and the waitlist), or check-in codes; an admin draft sends roles, channels, templates and recent event settings. No question or answer text is stored or logged. Every AI answer in Discord is sent with `allowedMentions: { parse: [] }`.
- Plugins ([plugin-sdk](plugin-sdk.md), full security model there): plugins run in the DEMS process without a sandbox; `ctx`/`ui` permissions are a guard rail, not a wall. Code reaches the server only through its file system (`<app>/plugins` official, `PLUGINS_DIR` custom; no upload, no URL install), „Offiziell“ comes from the folder, a plugin that is off never has its code required, `PLUGINS_SAFE_MODE=true` runs none. Plugin Discord messages never mention anyone and are capped per plugin (200 DMs / 30 posts per 10 min). Switching on a custom plugin (not from the DEMS project, full process access) needs the admin's trust confirmation (`trust: true`) and the admin reset password in `PUT /api/admin/plugins/:id/enabled`; so does changing a `secret` plugin setting. An unset `ADMIN_RESET_PASSWORD` makes every password wrong (`safeEqual`). Official plugins switch at once. Every switch, settings save and data delete writes an audit entry (`PLUGIN_ENABLE`, `PLUGIN_DISABLE`, `PLUGIN_SETTINGS` without values, `PLUGIN_DELETE_DATA`); secret values never leave the server (`{ set }` only). Account deletion purges every plugin document with the member's `userId`; the system reset wipes plugin data with `pluginData` or `users`. Plugin themes (`theme` permission, `ctx.theme`, served at `/theme.css` and admin-only `/theme-preview.css`) are checked by the allow-list filter `checkThemeCss` (`plugin-sdk/themeCss.js`: ≤ 50 000 chars, no backslashes, balanced `{}`/`()`, only allow-listed functions and at-rules, also right after a comment (`center/**/image-set(` is a real `image-set()`) — `url()`, `@import` and `@font-face` are refused because the CSP has `img-src https:` for avatars and banners) both when saved into core-owned `pluginThemes` and **again when served**; `?design=standard` in the URL disables `#custom-theme` before the first paint (`public/design-boot.js`), and `password: true` on a plugin admin route checks `req.body.password` against `ADMIN_RESET_PASSWORD` in the SDK router and strips `password` before the plugin handler runs (used by `plugins/custom-design/` when publishing changed free CSS).
- `aiNotes` is admin-only in event answers (`ADMIN_EVENT_FIELDS`; `toPublicEvent(id, data, viewer)` keeps it only for an admin viewer, and only `GET /api/events/:id` passes the viewer) but not a secret store: the AI assistant may pass it on to members, so the editor says "Keine Geheimnisse eintragen".
- Build event answers outside the admin area with `toPublicEvent(id, data)` (`utils/eventUtils.js`), never by spreading the document; a new secret event field goes into its `PRIVATE_EVENT_FIELDS`.
- Do not add CDN hosts to the CSP: vendor scripts, styles and fonts into `public/vendor/` instead (see [frontend-markup](../modules/frontend-markup.md)). External images are already covered by `img-src https:`.
