# Design: "Was ist neu" page and a lighter news popup (D-13)

## Context

See proposal.md for the motivation and specs/whats-new/spec.md for the behaviour.

What exists:

- `updates.json` = `{ version, date, news: [{ title, content }] }` for the current release only; `server.js` sends it unchanged at `GET /api/updates`. Titles carry emojis (data, outside the frontend emoji budget of `test/cssRules.test.js`, which only counts `public/` sources).
- `public/js/core/updates.js#checkUpdates()` runs on `DOMContentLoaded` (before the login state is known): sets `#info-version` to `v<version>`, and when `localStorage.dems_last_seen_version` differs, fills `#updatesModal` with every entry, opens it with `new bootstrap.Modal` and calls `celebrateUpdate(version)` (`core/update-effects.js`, once per version via its own key). `closeUpdatesModal` only stores the version when `#dont-show-again` is ticked.
- `core/auth.js#checkAuth()` calls `showLoggedIn()` and, for `isNewUser`, opens `#firstLoginModal` after 800 ms (`pages/profile.js#showFirstLoginModal`).
- `core/router.js` lets logged-out visitors see only `login` and `info`; `NAV_ROUTE` maps detail routes to a navbar link (W-15).
- `e2e/helpers.js#loginAs` pre-sets `dems_last_seen_version` to skip the dialog; `e2e/updates.spec.js` opens the app as `member` without that key and expects the dialog to come back after a reload (changes with this design); `test/startup.test.js` mocks `/api/updates` in the old single-release shape.

## Goals / Non-Goals

**Goals:**
- One place decides what the popup shows (pure helpers, unit-tested); the page and the popup render from the same normalized data.
- No popup before the login state is known, never on top of another dialog the login path opens.

**Non-Goals:**
- Writing the 3.0.0 notes (R-05) or changing how versions are released.
- Server-side "seen" state per member: seen/read stays per browser in `localStorage`, like today.
- Changing the version effects.

## Decisions

1. **Data format.** `updates.json` = `{ "version": "<newest>", "releases": [{ "version", "date", "news": [{ "title", "content", "highlight"? }] }] }`, newest first; top-level `version` equals `releases[0].version` (kept for `e2e/updates.spec.js` and other readers; a unit test guards it and the order). History: a one-off script (scratchpad, not committed) walks `git log --follow -- updates.json`, takes the **last** commit in which each version stood, drops 2.7.0 (folded into 2.6.0 by commit `0eefdd8`), and writes the releases; the current 2.6.0 entries get `highlight: true` on the top three (Rollen-Slots, Live-Ankündigungen, Terminabstimmungen) as an example of the marking. The server keeps `res.sendFile`.
   *Alternative:* separate `changelog.json` — rejected, two files for one thing and two requests.

2. **Pure module `public/js/pages/news-view.js`.** `normalizeReleases(data)` (accepts the new shape and the old `{ version, date, news }`; drops entries without title; returns `{ version, releases }`), `popupEntries(release)` (highlights in order, max 3, else first 3), `formatReleaseDate(iso)` ("03.10.2026", dash when invalid), `renderNewsPopup(release)` (entries as `.news-entry` with escaped title and text), `renderReleaseList(releases)` (one `<details class="news-release">` per release, the first `open`, `<summary>` with version chip and date, entries inside). Native `<details>` needs no JS and no inline handler (CSP).

3. **`core/updates.js` becomes the controller.**
   - `loadUpdates()` (boot, replaces `checkUpdates` on `DOMContentLoaded`): fetches once, keeps `newsState = { version, releases }` and a promise for later callers, sets `#info-version`, and calls `updateNewsBadge()`. Never opens the popup.
   - `showNewsAfterLogin({ isNewUser })` called from `checkAuth()` right after `showLoggedIn()`: awaits the data; new member → `markVersionSeen()` only; otherwise, when `dems_last_seen_version` ≠ version → `openNewsPopup()`.
   - `openNewsPopup()`: renders `popupEntries(releases[0])`, sets `#updates-version-badge`, registers `hidden.bs.modal` once → `markVersionSeen()`, shows the modal, `celebrateUpdate(version)`.
   - `openAllNews()` (action on "Alle Neuigkeiten"): hides the modal (the hidden handler marks it seen) and `navigateTo('news')`.
   - Badge: `dems_news_read_version`; `updateNewsBadge()` toggles `#nav-info-badge` (`.is-hidden` start state, `toggleElement`); `markNewsRead()` stores the version and hides it. All `localStorage` access in try/catch (storage can throw); a failing storage shows the popup at most once per page load.
   - `closeUpdatesModal` and the checkbox are removed; "Verstanden" just dismisses (`data-bs-dismiss`).

4. **Page `pages/news.js`.** `showNewsSection()`: shows `#news-section`, awaits the loaded data (or loads it), renders `renderReleaseList` into `#news-list` (load error → `emptyState` with "Erneut versuchen", action `reloadNews`), then `markNewsRead()`. Router: case `news`, added to the logged-out allowlist next to `info`; `NAV_ROUTE.news = 'info'` so the Info link stays marked.

5. **Markup.** `#news-section` (header "Was ist neu" with `bi-stars`, `#news-list`); `#updatesModal` body as before, footer = "Alle Neuigkeiten" (`btn btn-secondary`, `data-click="openAllNews"`) and "Verstanden" (`btn-accent`, `data-bs-dismiss`), checkbox removed; navbar Info link gets `<span id="nav-info-badge" class="nav-dot is-hidden"><span class="visually-hidden">Neuigkeiten ungelesen</span></span>`; info page: `#info-version` becomes `<a class="info-version-badge" href="#news">` (same id, so the GSAP intro keeps working) and the about card gets a link "Was ist neu in DEMS" to `#news`.

6. **Styles.** Block NEWS in `style.css`: `.news-release` (glass card look via tokens, `summary` row with version chip and date, marker icon via `bi`), `.news-entry` (title in `--text-primary`, text in `--text-secondary`), `.nav-dot` (small accent dot, positioned at the link's corner), link state of `.info-version-badge` (hover/focus ring with tokens). Tokens only.

## Risks / Trade-offs

- [Members who ticked nothing before saw the dialog every load; now it is once per version] → intended (spec).
- [The badge shows in every fresh browser, also in e2e runs] → harmless; e2e specs that need a quiet navbar can pre-set `dems_news_read_version` in `loginAs` like the seen key.
- [Recovered texts of old releases mention features that changed since] → they are history and dated; no rewriting.
- [Popup waiting for `/api/updates` after login] → data is loaded at boot, so after login it is usually there; the popup simply opens a moment later otherwise.
- [First-login timing: welcome dialog opens after 800 ms] → the popup is skipped for new members, so they never collide.

## Migration Plan

Browsers that stored `dems_last_seen_version` keep it (same key and meaning). Rollback = revert the commit; the old `checkUpdates` reads only the top-level `version` and would miss `news` — therefore the rollback reverts `updates.json` too (same commit).
