# Proposal: "Was ist neu" page and a lighter news popup (D-13)

## Why

The "Neuigkeiten & Updates" dialog opens on every page load until the member ticks "Nicht erneut anzeigen", it opens even on the login page before anyone is logged in, and it shows every entry of the release in full. Older releases are gone: `updates.json` only holds the current version, so nobody can look up what changed before. Ticket D-13 (GitLab issue 62, prioplan `docs/superpowers/plans/2026-10-07-dems-3.0-prioplan.md`) asks for a badge plus a "Was ist neu" page in the info area; its note of 13.10.2026 says the dialog with its version effects should stay. The user decided: keep a popup, but only with the top new features.

## What Changes

- **News data:** `updates.json` becomes a list of releases (newest first), each `{ version, date, news: [{ title, content, highlight? }] }`; the top-level `version` stays for existing readers. The past releases 1.1.0–2.6.0 are taken over from the git history of `updates.json` (2.7.0 was folded into 2.6.0 and is left out). `GET /api/updates` keeps its URL.
- **Popup:** only after login (never on the login page, never on top of the first-login dialog of a new member), once per version: closing it marks the version as seen, the checkbox "Nicht erneut anzeigen" goes away. It shows up to 3 entries marked `highlight` (the first 3 when none is marked), each with title and text, plus a button "Alle Neuigkeiten" to the new page. The version effects (confetti, power-up, bugs) stay unchanged.
- **Page `#news` "Was ist neu":** all releases, newest first and opened, older ones collapsible, with version, date and every entry. Public like `#info`. Reached from the info page (link and the clickable version badge) and from the popup.
- **Badge:** a small "neu" dot on the navbar link "Info" while the current version's page has not been opened in this browser; opening `#news` clears it.

## Capabilities

### New Capabilities
- `whats-new`: release notes of DEMS — the data format, the once-per-version popup with the top features, the "Was ist neu" page with all releases and the unread badge.

### Modified Capabilities
- none (no existing spec covers the news dialog).

## Impact

- Data: `updates.json` (new format, history), read by `server.js` (`/api/updates`, unchanged route) and by `e2e/updates.spec.js` (`version`).
- Frontend: `public/js/core/updates.js` (load once at boot for badge and dot; popup only via the login path), new `public/js/pages/news.js` (+ pure `pages/news-view.js`), `public/js/core/auth.js` (start the popup after login, not for new members), `public/js/core/router.js` (route `news`, public), `public/js/main.js`, `public/index.html` (`#news-section`, dialog without checkbox, nav dot, links on the info page), styles in `public/css/style.css`.
- Tests: `test/startup.test.js` mocks `/api/updates`; `e2e/updates.spec.js` expects the dialog to return after a reload, which changes (closing now marks it seen); `e2e/helpers.js#loginAs` keeps working (it pre-sets `dems_last_seen_version`).
- No server logic change, no new dependency, no env variable.
- Wiki nodes: `docs/wiki/modules/server.md` (`/api/updates` shape), `docs/wiki/overview/directory-map.md` (`updates.json`), `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/ops/testing.md` (`e2e/updates.spec.js`), `docs/wiki/index.md`.
- Related, not part of this change: R-05 (version 3.0.0 and its highlights in `updates.json`) will use the new format.
