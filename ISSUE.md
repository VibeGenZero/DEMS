# Security Audit Findings

**Target System:** DEMS (Dein Event-Management-System)
**Date:** 2026-02-15
**Auditor:** Antigravity

## Executive Summary
The application has a generally solid security foundation, leveraging standard libraries (`helmet`, `express-session`, `DOMPurify`) for core defenses. However, several configuration weaknesses and logical risks were identified that should be addressed before a production deployment. The most critical issues relate to Content Security Policy (CSP) configurations and session security.

## Findings

### [P2] Weak Content Security Policy (CSP)
**Location:** [server.js](file:///c:/Users/lyone/Documents/dems/server.js)
**Description:** The Helmet CSP configuration explicitly allows `'unsafe-inline'` and `'unsafe-eval'` for scripts.
```javascript
scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...]
```
This significantly reduces the effectiveness of CSP as a defense-in-depth mechanism against Cross-Site Scripting (XSS). If an attacker finds a way to inject script tags, they can execute arbitrary code.
**Recommendation:** 
- Remove `'unsafe-eval'` if possible.
- Remove `'unsafe-inline'` and replace it with a **nonce** or **hash** based approach for necessary inline scripts.

### [P2] Insecure Session Cookies
**Location:** [server.js](file:///c:/Users/lyone/Documents/dems/server.js)
**Description:** The session cookie configuration has specific security flags disabled:
```javascript
cookie: {
    secure: false, // Set to true in production with HTTPS
    // ...
}
```
While this allows testing over HTTP, it is dangerous for production. If deployed without HTTPS or with this flag false, session cookies can be intercepted over unencrypted networks.
**Recommendation:** 
- Ensure `secure: true` is set in production.
- Use an environment variable (e.g., `NODE_ENV === 'production'`) to toggle this automatically.

### [P3] Potential CSV Injection
**Location:** [routes/admin.js](file:///c:/Users/lyone/Documents/dems/routes/admin.js) (Export Registrations endpoint)
**Description:** The CSV export functionality wraps fields in quotes but does not escape special characters that Spreadsheet software (Excel, Sheets) interprets as formulas (e.g., `=`, `+`, `-`, `@`).
```javascript
// Current implementation
return `"${String(val || '').replace(/"/g, '""')}"`;
```
A malicious user could register with a name like `=cmd|' /C calc'!A0` which could execute commands on an admin's machine when the CSV is opened.
**Recommendation:** Prepend a single quote `'` to any field starting with `=`, `+`, `-`, or `@` to force it to be treated as text.

### [P3] Stale Admin Session Validations
**Location:** [middleware/auth.js](file:///c:/Users/lyone/Documents/dems/middleware/auth.js) / Session Storage
**Description:** User privileges (`isAdmin`) are determined at login and stored in the session.
```javascript
// routes/auth.js
req.session.user = { ..., isAdmin: ... };
```
The [requireAdmin](file:///c:/Users/lyone/Documents/dems/middleware/auth.js#11-30) middleware checks this session value. If an administrator is removed from the Discord role, they will retain admin access to the DEMS application until their session expires or they log out.
**Recommendation:** Implement a strategy to re-validate the admin role against the Discord API periodically (e.g., every 15 minutes) or on critical actions, rather than trusting the session indefinitely.

### [Positive Findings]
*   **XSS Mitigation:** [app.js](file:///c:/Users/lyone/Documents/dems/public/js/app.js) consistently uses [renderMarkdownSafe](file:///c:/Users/lyone/Documents/dems/public/js/app.js#2165-2178) which leverages `DOMPurify` to sanitize user content.
*   **CSRF Protection:** Double-submit cookie pattern is implemented and verified on mutating API requests.
*   **Bot Security:** Critical commands like `/register` are disabled in the bot to force users to the web UI, centralizing logic and security controls.
