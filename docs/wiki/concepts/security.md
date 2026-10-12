---
id: security
title: Security model and open audit findings
type: concept
tags: [security, csp, helmet, csrf, xss, rate-limit, audit, https]
sources: [server.js, docs/security/SECURITY_AUDIT_2026-04-22.md, ISSUE.md, routes/events.js, routes/user.js, utils/eventUtils.js, public/js/core/ui.js, public/js/core/actions.js]
depends_on: [server]
see_also: [auth-session, known-issues, deployment]
---
# Security model and open audit findings

> TL;DR: Defenses: helmet CSP (scripts, styles and fonts only from `'self'`; no inline scripts, event handlers or styles), CORS to `BASE_URL`, rate limits, double-submit CSRF on `/api` and `/auth`, httpOnly session cookie, server-side admin guards, `escapeHtml` + DOMPurify in the SPA. The 2026-04-22 audit lists 28 findings; most are still open — check the table before touching auth, events or exports. Serve DEMS over HTTPS: helmet's default `upgrade-insecure-requests` breaks plain-HTTP access from anything but localhost.

## Defenses in place

| Layer | Where |
|---|---|
| Security headers + CSP | `helmet(...)` in `server.js` (directive list there) |
| CORS | `cors({ origin: BASE_URL, credentials: true })` |
| Rate limits | `/api/` 200 / 15 min, `/auth/` 30 / 15 min (off in dev mock mode); failed check-ins 10 / 15 min per member (`checkinLimiter`, on in mock mode too) |
| CSRF | double-submit token, see [auth-session](auth-session.md) |
| AuthZ | `requireAuth`, `requireAdmin`; the whole event API needs a login (no public preview); `draft`/`archived` events answer 404 to non-admins; comment delete = owner or admin |
| XSS | frontend `escapeHtml()` for interpolated values, values for actions in `data-*` attributes (escaped with `escapeHtml`, read via `dataset`), never in handler code — the CSP blocks inline handlers, `renderMarkdownSafe()` = marked + DOMPurify for descriptions |
| Secrets | `.env` never in the image (`.dockerignore`); `checkinCode` removed from every event answer outside `/api/admin` (`toPublicEvent` in `utils/eventUtils.js`) |
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
| M-01 | Firebase client SDK used server-side | open (depends on Firestore rules) |
| M-02 | CDN assets without SRI | fixed: no CDN assets, libraries and fonts are vendored in `public/vendor/` (F-07) |
| M-03 | non-constant-time password compare | fixed: `safeEqual` (SHA-256 + `timingSafeEqual`) for reset and panic deactivation (F-14) |
| M-04 | panic without 2nd factor | open |
| M-05 | public comments | fixed (comments require login) |
| M-06 / M-07 | unbounded queries, user search enumeration | open |
| M-08 / M-09 | `bannerUrl` / `accentColor` not validated server-side | fixed: `validateEvent` allows only http(s) URLs and hex colours (F-14) |
| L-02 | MemoryStore | fixed: sessions in the database via `PersistentSessionStore`, document id = SHA-256 of the session id (F-06) |
| L-03 / L-04 | `parseTemplate` `$` patterns, CSV formula injection | fixed: `parseTemplate` inserts values literally (`utils/template.js`), CSV cells via `csvCell` with a leading apostrophe for `= + - @` (F-14) |
| L-07 | logout via GET | fixed: `POST /auth/logout` with CSRF token (F-05) |

Full report: `docs/security/SECURITY_AUDIT_2026-04-22.md`; older notes: `ISSUE.md`.

## HTTPS requirement

Helmet adds `upgrade-insecure-requests` to the CSP by default. Browsers then rewrite all asset URLs of a page served via `http://<ip>:3000` to `https://` → CSS/JS fail, the SPA hangs on the loading screen ("Initialisiere System..."). `http://localhost` is exempt. Use a TLS reverse proxy ([deployment](../ops/deployment.md)) or set `upgradeInsecureRequests: null` in the CSP directives for intentional plain-HTTP setups.

## Rules for changes

- New endpoints: decide the guard explicitly (`requireAuth`/`requireAdmin`), never trust frontend hiding.
- `routes/events.js` guards itself: `router.use(requireAuth)` for every route and `router.param('id')` hides `draft`/`archived` events from non-admins; new `/:id` routes inherit both.
- Build event answers outside the admin area with `toPublicEvent(id, data)` (`utils/eventUtils.js`), never by spreading the document; a new secret event field goes into its `PRIVATE_EVENT_FIELDS`.
- Do not add CDN hosts to the CSP: vendor scripts, styles and fonts into `public/vendor/` instead (see [frontend-markup](../modules/frontend-markup.md)). External images are already covered by `img-src https:`.
