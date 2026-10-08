---
id: security
title: Security model and open audit findings
type: concept
tags: [security, csp, helmet, csrf, xss, rate-limit, audit, https]
sources: [server.js, docs/security/SECURITY_AUDIT_2026-04-22.md, ISSUE.md, routes/events.js, routes/user.js, utils/eventUtils.js, public/js/app.js]
depends_on: [server]
see_also: [auth-session, known-issues, deployment]
---
# Security model and open audit findings

> TL;DR: Defenses: helmet CSP (scripts, styles and fonts only from `'self'`, still allows `unsafe-inline`), CORS to `BASE_URL`, rate limits, double-submit CSRF on `/api`, httpOnly session cookie, server-side admin guards, `escapeHtml` + DOMPurify in the SPA. The 2026-04-22 audit lists 28 findings; most are still open — check the table before touching auth, events or exports. Serve DEMS over HTTPS: helmet's default `upgrade-insecure-requests` breaks plain-HTTP access from anything but localhost.

## Defenses in place

| Layer | Where |
|---|---|
| Security headers + CSP | `helmet(...)` in `server.js` (directive list there) |
| CORS | `cors({ origin: BASE_URL, credentials: true })` |
| Rate limits | `/api/` 200 / 15 min, `/auth/` 30 / 15 min (off in dev mock mode) |
| CSRF | double-submit token, see [auth-session](auth-session.md) |
| AuthZ | `requireAuth`, `requireAdmin`; the whole event API needs a login (no public preview); `draft`/`archived` events answer 404 to non-admins; comment delete = owner or admin |
| XSS | frontend `escapeHtml()` for interpolated values, `renderMarkdownSafe()` = marked + DOMPurify for descriptions |
| Secrets | `.env` never in the image (`.dockerignore`); `checkinCode` removed from every event answer outside `/api/admin` (`toPublicEvent` in `utils/eventUtils.js`) |
| Dev mode | `DEV_MOCK=true` + `NODE_ENV=production` → refuses to start |
| Container | runs as user `node`; production compose pins `NODE_ENV=production` |

## Audit 2026-04-22 — status as of 2026-10-02 (checked against code)

| ID | Finding | Status |
|---|---|---|
| C-01 | check-in code leak | fixed: every event answer outside `/api/admin` goes through `toPublicEvent` (F-02) |
| C-02 | draft/archived/cancelled readable | fixed: the event API needs a login, `draft`/`archived` answer 404 to non-admins on every `/:id` route and are left out of series answers, `?status=` other than `active` answers 403 (F-03); `cancelled` stays readable by id for members on purpose |
| C-03 | session cookie not `secure` | open (`secure: false`) |
| C-04 | vulnerable dependencies | fixed (dependency update 2026-09, `npm audit` 0) |
| H-01 / H-02 / H-03 | OAuth `state`, session regeneration, 24 h admin cache | open |
| H-04 | guest `my-registration` leaks registrant data | open |
| H-05 | CSP `unsafe-inline` + `unsafe-eval` | **partial**: `unsafe-eval` removed (F-07); `unsafe-inline` stays while inline `onclick` handlers exist |
| H-06 | check-in code via `Math.random`, not specifically rate-limited | open (only the global `/api` limit) |
| M-01 | Firebase client SDK used server-side | open (depends on Firestore rules) |
| M-02 | CDN assets without SRI | fixed: no CDN assets, libraries and fonts are vendored in `public/vendor/` (F-07) |
| M-03 / M-04 | non-constant-time password compare, panic without 2nd factor | open |
| M-05 | public comments | fixed (comments require login) |
| M-06 / M-07 | unbounded queries, user search enumeration | open |
| M-08 / M-09 | `bannerUrl` / `accentColor` not validated server-side | open |
| L-02 / L-03 / L-04 / L-07 | MemoryStore, `parseTemplate` `$` patterns, CSV formula injection, logout via GET | open |

Full report: `docs/security/SECURITY_AUDIT_2026-04-22.md`; older notes: `ISSUE.md`.

## HTTPS requirement

Helmet adds `upgrade-insecure-requests` to the CSP by default. Browsers then rewrite all asset URLs of a page served via `http://<ip>:3000` to `https://` → CSS/JS fail, the SPA hangs on the loading screen ("Initialisiere System..."). `http://localhost` is exempt. Use a TLS reverse proxy ([deployment](../ops/deployment.md)) or set `upgradeInsecureRequests: null` in the CSP directives for intentional plain-HTTP setups.

## Rules for changes

- New endpoints: decide the guard explicitly (`requireAuth`/`requireAdmin`), never trust frontend hiding.
- `routes/events.js` guards itself: `router.use(requireAuth)` for every route and `router.param('id')` hides `draft`/`archived` events from non-admins; new `/:id` routes inherit both.
- Build event answers outside the admin area with `toPublicEvent(id, data)` (`utils/eventUtils.js`), never by spreading the document; a new secret event field goes into its `PRIVATE_EVENT_FIELDS`.
- Do not add CDN hosts to the CSP: vendor scripts, styles and fonts into `public/vendor/` instead (see [frontend-markup](../modules/frontend-markup.md)). External images are already covered by `img-src https:`.
