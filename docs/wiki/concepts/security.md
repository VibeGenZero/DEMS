---
id: security
title: Security model and open audit findings
type: concept
tags: [security, csp, helmet, csrf, xss, rate-limit, audit, https]
sources: [server.js, routes/setup.js, utils/setupState.js, docs/security/SECURITY_AUDIT_2026-04-22.md, ISSUE.md, routes/events.js, routes/user.js, utils/eventUtils.js, bot/threadSync.js, public/js/core/ui.js, public/js/core/actions.js]
depends_on: [server]
see_also: [auth-session, known-issues, deployment]
---
# Security model and open audit findings

> TL;DR: Defenses: helmet CSP (scripts, styles and fonts only from `'self'`; no inline scripts, event handlers or styles), CORS to `BASE_URL`, rate limits, double-submit CSRF on `/api` and `/auth`, httpOnly session cookie, server-side admin guards, `escapeHtml` + DOMPurify in the SPA. The 2026-04-22 audit (28 findings) and the 2026-10-25 pentest are tracked in the tables below — check them before touching auth, events or exports. Serve DEMS over HTTPS: helmet's default `upgrade-insecure-requests` breaks plain-HTTP access from anything but localhost.

## Defenses in place

| Layer | Where |
|---|---|
| Security headers + CSP | `helmet(...)` in `server.js` (directive list there) |
| CORS | `cors({ origin: BASE_URL, credentials: true })` |
| Rate limits | `/api/` 200 / 15 min, `/auth/` 30 / 15 min (off in dev mock mode); failed check-ins 10 / 15 min per member (`checkinLimiter`, on in mock mode too); member search `GET /api/user/search` 60 / min per member (`searchLimiter` in `routes/user.js`, on in mock mode too) |
| CSRF | double-submit token, see [auth-session](auth-session.md) |
| AuthZ | `requireAuth`, `requireAdmin`; the whole event API needs a login (no public preview); `draft`/`archived` events answer 404 to non-admins; comment delete = owner or admin |
| XSS | frontend `escapeHtml()` for interpolated values, values for actions in `data-*` attributes (escaped with `escapeHtml`, read via `dataset`), never in handler code — the CSP blocks inline handlers, `renderMarkdownSafe()` = marked + DOMPurify for descriptions |
| Secrets | `.env` never in the image (`.dockerignore`); `checkinCode` removed from every event answer outside `/api/admin` (`toPublicEvent` in `utils/eventUtils.js`); the token of the comment-sync webhook (B-16) lives only in memory (`bot/threadSync.js`), never in the database or an answer |
| Mirrored comments (B-16) | web comments go into Discord with `allowedMentions: { parse: [] }` (no `@everyone`, role or user pings) and the suffix „(Web)“; comments from Discord are plain text rendered with `escapeHtml` and marked „Discord“ |
| Uploads (W-12) | banners only via `POST /api/admin/uploads/banner` (admin + CSRF); type read from the magic bytes (PNG, JPEG, GIF, WebP — never SVG), ≤ 5 MB, random `<uuid>.<ext>` name; served read-only under `/uploads/banners/` only for that name pattern, with the image content type and helmet's `nosniff`, so a polyglot file is never run as HTML |
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

## HTTPS requirement

Helmet adds `upgrade-insecure-requests` to the CSP by default. Browsers then rewrite all asset URLs of a page served via `http://<ip>:3000` to `https://` → CSS/JS fail, the SPA hangs on the loading screen ("Initialisiere System..."). `http://localhost` is exempt. Use a TLS reverse proxy ([deployment](../ops/deployment.md)) or set `upgradeInsecureRequests: null` in the CSP directives for intentional plain-HTTP setups.

## First-run setup (#138)

A fresh installation (no setup completed, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` or `DISCORD_GUILD_ID` missing after the stored configuration was loaded; never in dev mock mode) runs in **setup mode** (`utils/setupState.js`):

- The gate in `server.js` answers every `/api/*` and `/auth/*` request with 503 except `/api/setup/*` and the public start-page endpoints ([api-index](../reference/api-index.md)). Static files and `/healthz` stay up.
- The setup PIN is `SETUP_PIN` or a random 8-digit PIN (`crypto.randomInt`) created at every start, printed in the log, kept in memory only and compared with `safeEqual`. Whoever reads the container log already controls the host; the PIN changes with each start and is void once the setup is done.
- `POST /api/setup/unlock` is limited to 5 attempts per 15 minutes and IP and regenerates the session (a planted cookie is useless); only that session may run the steps.
- The Discord step checks the client id/secret with an OAuth2 `client_credentials` request and the bot token with a real login before anything is stored; the values reach `process.env` for the login and are taken back on failure.
- Completing stores the values (`systemSettings/config`, secrets in plain text, never returned), ends setup mode without a restart and destroys the setup session.
- The setup needs HTTPS like the login: in production the session cookie is `Secure`, so over plain HTTP — `http://localhost` included — the PIN never sticks (the unlock answers 403 „Ungültiges CSRF-Token“); `GET /api/setup/status` then reports `httpsRequired: true` and the PIN step shows a warning. Plain `http://<ip>` also hangs on the loading screen (see below). Outside production (`npm start` without `NODE_ENV`, dev) plain HTTP works.

## Rules for changes

- New endpoints: decide the guard explicitly (`requireAuth`/`requireAdmin`), never trust frontend hiding.
- `routes/events.js` guards itself: `router.use(requireAuth)` for every route and `router.param('id')` hides `draft`/`archived` events from non-admins; new `/:id` routes inherit both.
- Build event answers outside the admin area with `toPublicEvent(id, data)` (`utils/eventUtils.js`), never by spreading the document; a new secret event field goes into its `PRIVATE_EVENT_FIELDS`.
- Do not add CDN hosts to the CSP: vendor scripts, styles and fonts into `public/vendor/` instead (see [frontend-markup](../modules/frontend-markup.md)). External images are already covered by `img-src https:`.
