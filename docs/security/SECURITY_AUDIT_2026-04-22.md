# DEMS Security Audit — 2026-04-22

**Auditor**: Automated review (Claude)
**Branch**: `claude/security-check-zmwKY`
**Scope**: Full codebase (server, bot, middleware, routes, public frontend, dependencies)
**Commit audited**: `5eea8b1`
**Status**: Educational / defensive — no external systems were touched.

---

## Executive Summary

| Severity | Count | Highlights |
|----------|-------|------------|
| Critical | 4     | Check-in code leak, draft-event disclosure, insecure session cookie, `protobufjs` RCE in deps |
| High     | 6     | OAuth CSRF, session fixation, stale admin cache, guest-registration PII leak, weak CSP, predictable check-in PIN |
| Medium   | 9     | Client-SDK misuse, missing SRI, CSS injection, server-side `bannerUrl` trust, DoS via unbounded queries |
| Low      | 9     | Timing-safe compare, CSV formula injection, verbose debug logs, logout CSRF, etc. |

The highest cross-cutting risk is the use of the **Firebase Client SDK** (`firebaseAdmin.js` is a misnomer — it is `firebase/app`, not `firebase-admin`). If Firestore Security Rules are permissive, every middleware check in this repository can be bypassed by talking to Firebase directly with the public `FIREBASE_API_KEY`. Security Rules are not part of this repository and must be verified separately.

A working proof-of-concept for the two most impactful unauthenticated findings (**#1 check-in code leak** and **#2 draft-event disclosure**) is included as `docs/security/poc/dems_poc.py`.

---

## Table of Contents

1. [Critical Findings](#critical-findings)
2. [High Findings](#high-findings)
3. [Medium Findings](#medium-findings)
4. [Low / Informational](#low--informational)
5. [Proof of Concept](#proof-of-concept)
6. [Recommended Remediation Order](#recommended-remediation-order)

---

## Critical Findings

### C-01 — Check-in code exposed in public event detail endpoint
- **File**: `routes/events.js:245-251`
- **Endpoint**: `GET /api/events/:id` (unauthenticated)
- **Issue**: The response spreads `...docSnap.data()`, leaking `checkinCode`, `checkinEnabled`, `customBotMessages`, `formFields` and the raw registration counts.
- **Impact**: Anyone can read the 6-digit check-in PIN and self-check-in without being on-site.
- **CWE**: CWE-200 (Information Exposure), CWE-284 (Improper Access Control)
- **Fix sketch**:
  ```js
  const data = docSnap.data();
  const { checkinCode, ...safe } = data;
  res.json({ id: docSnap.id, ...safe, checkinEnabled: !!data.checkinEnabled, currentParticipants, waitlistCount, createdByName });
  ```

### C-02 — Draft / archived / cancelled events exposed to anyone
- **File**: `routes/events.js:33-39`
- **Endpoint**: `GET /api/events?status=draft` (unauthenticated)
- **Issue**: The `status` filter is taken verbatim from the query string; no auth / admin check. The default branch only hides drafts when the client doesn't supply `status`.
- **Impact**: Leak of unpublished events, internal titles, descriptions, schedules.
- **CWE**: CWE-285 (Improper Authorization)
- **Fix sketch**:
  ```js
  const isAdmin = !!(req.session?.user?.isAdmin);
  const allowedStatuses = isAdmin ? null : ['active'];
  if (statusFilter && allowedStatuses && !allowedStatuses.includes(statusFilter)) {
      return res.status(403).json({ error: 'Nicht berechtigt.' });
  }
  ```

### C-03 — Session cookie is not `secure`
- **File**: `server.js:74-80`
- **Issue**: Hardcoded `secure: false` with a comment reminding the operator to flip it in production.
- **Impact**: Over HTTP(S+HTTP redirect/mixed environment), the session cookie travels in the clear → session hijack.
- **CWE**: CWE-614 (Sensitive Cookie Without 'Secure' Attribute)
- **Fix sketch**:
  ```js
  cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
  }
  ```

### C-04 — Vulnerable dependencies (`npm audit`)
- **Reproducer**: `npm audit`
- **Findings**:
  - `protobufjs` < 7.5.5 — **Arbitrary Code Execution** (GHSA-xq3m-2v4x-88gg) — transitive via `firebase`
  - `undici` — HTTP Request Smuggling (GHSA-2mjp-6q6p-2qxm), CRLF Injection (GHSA-4992-7rv2-5pvq), WebSocket DoS, insufficient randomness
- **Impact**: RCE / smuggling in the server Node process.
- **Fix**: `npm audit fix`; pin `firebase` to a release that bundles fixed transitives, or migrate to `firebase-admin`.

---

## High Findings

### H-01 — OAuth `state` parameter missing (login-CSRF)
- **File**: `routes/auth.js:24-31`
- **Issue**: Neither `/auth/discord` nor `/auth/discord/callback` uses a `state` parameter. Any attacker can complete the OAuth dance with their own code and feed the callback URL to a victim, logging the victim in as the attacker.
- **CWE**: CWE-352
- **Fix**: Generate `state = crypto.randomBytes(16).toString('hex')`, store in session, verify on callback, reject on mismatch.

### H-02 — Session fixation: no `regenerate()` after login
- **File**: `routes/auth.js:136-147`
- **Fix**: Call `req.session.regenerate(err => { ... })` before writing `req.session.user`.

### H-03 — Admin role cached for 24h — no live revocation
- **Files**: `routes/auth.js:83-86`, `middleware/auth.js:16-29`
- **Issue**: `isAdmin` is evaluated once at login; Discord role changes have zero effect until the cookie expires.
- **Fix**: Re-check membership/role on every `requireAdmin` call (cache for ≤60 s) against the Discord REST API or the bot's local cache.

### H-04 — Guest's `/my-registration` leaks the registrant's form answers
- **File**: `routes/events.js:549-551`
- **Issue**: `...regDoc.data()` includes `formAnswers` and `pendingGuests`, revealing PII that other users submitted.
- **Fix**: Return only `{ registered, id, status, asGuest }`.

### H-05 — CSP weakened by `unsafe-inline` + `unsafe-eval`
- **File**: `server.js:28-44`
- **Issue**: The CSP still allows inline scripts and `eval` — which means every `innerHTML` path (≈120 occurrences in `public/js/app.js`) is a XSS sink without CSP mitigation.
- **Fix**: Move all inline scripts to files, use a per-response nonce, drop `unsafe-eval`.

### H-06 — Check-in code uses `Math.random()` and is un-rate-limited
- **File**: `routes/admin.js:523`, `routes/events.js:602-648`
- **Issue**: Non-CSPRNG, only ~900k codes, and `/api/events/:id/checkin` has no dedicated rate limit beyond the global 200/15min.
- **Fix**: `crypto.randomInt(100000, 1000000)`; per-registration attempt counter with lockout.

---

## Medium Findings

### M-01 — Firebase **Client** SDK misused as a server backend
- **File**: `firebaseAdmin.js` (misleading name)
- **Issue**: The server uses `firebase/app` + `firebase/firestore` (the client SDK) with the public `FIREBASE_API_KEY`. The SDK talks to Firestore under its own (client) credentials. Every server-side permission check is advisory — if Security Rules are permissive, an external actor with the public API key can CRUD the same collections.
- **Fix**: Switch to `firebase-admin` with a service-account JSON **and** publish strict Firestore Rules. The repo currently ships no `firestore.rules` file.

### M-02 — CDN assets without Subresource Integrity
- **File**: `public/index.html:17-36`
- **Issue**: `marked.min.js` is loaded **without a version** or `integrity` hash; DOMPurify, Bootstrap, FontAwesome and Bootstrap-Icons lack SRI.
- **Fix**: Pin all versions, add `integrity="sha384-..." crossorigin="anonymous"`, or vendor locally.

### M-03 — `ADMIN_RESET_PASSWORD` compared with `===`
- **File**: `routes/admin.js:902`, `1151`
- **Fix**: `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` (after length check).

### M-04 — Panic mode activation has no second factor
- **File**: `routes/admin.js:1115-1140`
- **Issue**: Any admin session can lock down the whole platform with one click; deactivation requires the env password, activation does not.
- **Fix**: Require the same reset password, or at minimum a secondary confirmation token.

### M-05 — Public comments (`/api/events/:id/comments`)
- **File**: `routes/events.js:653-671`
- **Issue**: No authentication on read. A drive-by visitor can scrape all comments.
- **Fix**: Add `requireAuth` (or explicitly document the choice).

### M-06 — Unbounded in-memory queries
- **Files**: `routes/events.js:19-30`, `routes/user.js:294-314`, `routes/admin.js:868-874`
- **Fix**: Use Firestore `limit()` + cursor-based pagination; avoid downloading whole collections.

### M-07 — `/api/user/search` enables user enumeration
- **File**: `routes/user.js:287-321`
- **Fix**: Require ≥3 chars, prefix-match only, per-user rate limit, and consider logging scraping attempts.

### M-08 — `bannerUrl` not validated server-side
- **File**: `routes/admin.js:145` / `middleware/validators.js`
- **Fix**: In `validateEvent`, accept only `http(s)://` URLs via `new URL(...)` with an explicit host allow-list if possible.

### M-09 — CSS injection via `accentColor`
- **Files**: `public/js/app.js:807`, `813`, etc.
- **Fix**: Validate server-side with `/^#[0-9a-f]{3,8}$/i` and reject anything else.

---

## Low / Informational

- **L-01** — `DEBUG_MODE=true` redacts only top-level keys (`password`, `token`, `secret`, `key`, `csrftoken`). Add `code`, `pin`, `pw`, `authorization`, and recurse.
- **L-02** — Default `MemoryStore` warning in production — use Redis/connect-redis.
- **L-03** — `parseTemplate` (`bot.js:611-616`) uses `.replace(regex, value)` where `value` is interpolated. If it contains `$&` etc., it is treated as a back-reference. Use a function replacer.
- **L-04** — CSV export is vulnerable to Excel formula injection (`routes/admin.js:629-647`). Prefix cells starting with `= + - @` with `'`.
- **L-05** — `app.set('trust proxy', 1)` — correct for exactly one proxy layer; document this.
- **L-06** — `formAnswers` stored unchecked (depth/keys). Body-size is bounded by Express default (100 KB), acceptable.
- **L-07** — `GET /auth/logout` has no CSRF protection (denial-of-service annoyance only).
- **L-08** — Set an explicit `Referrer-Policy: strict-origin-when-cross-origin` (Helmet default covers this; verify).
- **L-09** — Hard-coded defaults like `http://localhost:3000` fall through when `BASE_URL` is missing — surface a startup error instead.

---

## Proof of Concept

See [`poc/dems_poc.py`](./poc/dems_poc.py). The script demonstrates **C-01** (check-in code leak) and **C-02** (draft-event exposure) against a running DEMS instance without any credentials. It is intentionally read-only and prints a structured report.

```bash
pip install requests
python3 docs/security/poc/dems_poc.py --target http://localhost:3000
```

The PoC walks through the following fully automated steps:

1. Fingerprint the target (`/api/server-info`, `/api/maintenance/status`).
2. Enumerate active events via the legitimate list endpoint (baseline).
3. Re-query the same endpoint with `?status=draft`, `?status=archived`, `?status=cancelled` to prove **C-02**.
4. Fetch every event detail (`GET /api/events/:id`) and extract `checkinCode` / `checkinEnabled` to prove **C-01**.
5. Scrape comments (M-05) and probe Discord-server side channels.
6. Emit a machine-readable JSON report and an operator-friendly summary.

The PoC never mutates state; it performs only `GET` requests.

---

## Recommended Remediation Order

| # | Finding | Effort | Priority |
|---|---------|--------|----------|
| 1 | C-01 redact `checkinCode` from public event responses | 15 min | immediate |
| 2 | C-02 restrict `status` filter to admins | 15 min | immediate |
| 3 | C-03 `secure: true` in production                    | 5 min  | immediate |
| 4 | C-04 `npm audit fix`                                 | 30 min | immediate |
| 5 | H-01 OAuth `state` parameter                         | 1 h    | this week |
| 6 | H-02 `session.regenerate()` after login              | 30 min | this week |
| 7 | H-04 redact `formAnswers` in `my-registration` guest response | 15 min | this week |
| 8 | H-06 `crypto.randomInt` + attempt lockout            | 1 h    | this week |
| 9 | M-01 commit Firestore Rules (or migrate to Admin SDK) | 1 day | next sprint |
| 10 | H-05 CSP hardening (remove `unsafe-inline`)         | 1 day  | next sprint |

---

*Generated from a static + behavioural review; no data was exfiltrated from production systems.*
