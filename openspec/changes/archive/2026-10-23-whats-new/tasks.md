# Tasks

## 1. Release notes data

- [x] 1.1 Write `test/updatesData.test.js` first (RED): `updates.json` has `version` equal to `releases[0].version`, releases strictly newest first by semantic version, each with a `YYYY-MM-DD` date, at least one entry with non-empty `title`/`content`, `highlight` only as boolean, at most 3 highlights per release; versions 1.1.0, 2.0.0, 2.0.1, 2.1.0, 2.2.0, 2.3.0, 2.3.1, 2.4.0, 2.5.0, 2.5.1, 2.6.0 present and 2.7.0 absent; `GET /api/updates` of the dev server (or a direct `require`) returns the same object; verify it fails on the current file
- [x] 1.2 Generate the history with a one-off scratchpad script (git log of `updates.json`, last commit per version, skip 2.7.0), write the new `updates.json` with `highlight: true` on three 2.6.0 entries; verify `node --test test/updatesData.test.js` passes and `git diff updates.json` shows the 2.6.0 texts unchanged

## 2. Popup, badge and page logic

- [x] 2.1 RED tests `test/newsView.test.js` (via `loadFrontendApp`) for `normalizeReleases` (new shape; old single-release shape from `test/startup.test.js`; entries without title dropped), `popupEntries` (spec scenarios: marked 2 and 5 → those two; none marked → first 3; never more than 3), `formatReleaseDate`, `renderNewsPopup` and `renderReleaseList` (first release `open`, others not, version and German date in `summary`, `<b>fett</b>` stays text, emojis as written); verify they fail
- [x] 2.2 RED tests `test/newsFlow.test.js` for `core/updates.js` and `pages/news.js`: `loadUpdates` sets `#info-version` and never opens the popup; `showNewsAfterLogin({ isNewUser: false })` opens it once for an unseen version, firing `hidden.bs.modal` stores `dems_last_seen_version` and a second call opens nothing; `showNewsAfterLogin({ isNewUser: true })` opens nothing and stores the version; the badge `#nav-info-badge` is visible for an unread version, `showNewsSection` renders all releases into `#news-list` and hides the badge; a throwing `localStorage` (`storage: 'throws'`) neither breaks loading nor opens the popup twice in one page load; `openAllNews` routes to `news`; verify they fail
- [x] 2.3 Implement `public/js/pages/news-view.js`, rework `public/js/core/updates.js`, add `public/js/pages/news.js`, call `showNewsAfterLogin` from `core/auth.js#checkAuth`, replace the `DOMContentLoaded` call in `public/js/main.js` with `loadUpdates`, add the `news` route (public, `NAV_ROUTE.news = 'info'`) to `core/router.js`; verify 2.1/2.2 pass and `test/startup.test.js`, `test/navLinks.test.js` (extend: `#news` marks Info and works logged out), `test/frontendModules.test.js`, `test/actionAttributes.test.js`, `test/frontendCsp.test.js`, `test/frontendActions.test.js`, `test/updateEffects.test.js` stay green

## 3. Markup and styles

- [x] 3.1 `public/index.html`: `#news-section`, `#updatesModal` footer without checkbox (buttons "Alle Neuigkeiten" and "Verstanden"), `#nav-info-badge` in the Info link, `#info-version` as link to `#news`, link "Was ist neu in DEMS" on the info page; extend `test/authFrontend.test.js` or a markup test first (no `dont-show-again`, `#info-version` is an `<a href="#news">`, badge has the screen-reader text); verify it passes and `test/cssRules.test.js` (no inline styles, emoji budget) stays green
- [x] 3.2 Styles (block NEWS in `public/css/style.css`, tokens only: release cards, entries, nav dot, version badge link states); verify `test/cssRules.test.js`, `test/designTokens.test.js`, `test/contrast.test.js` pass
- [x] 3.3 Update `docs/wiki/modules/server.md` (`/api/updates` shape), `docs/wiki/overview/directory-map.md` (`updates.json`), `docs/wiki/modules/frontend-app.md` (route `#news`, modules `core/updates.js`, `pages/news.js`, `pages/news-view.js`, `checkAuth` calling `showNewsAfterLogin`), `docs/wiki/modules/frontend-markup.md` (section, dialog footer, nav dot, NEWS block), `docs/wiki/ops/testing.md` (`e2e/updates.spec.js` behaviour), `docs/wiki/index.md`; run `npm run wiki` and verify `node --test test/wiki.test.js` passes

## 4. Integration

- [x] 4.1 Update `e2e/updates.spec.js`: logged out the login page has no news dialog; after login as `member` the dialog shows at most 3 entries and plays the effect once; after closing and reloading it stays away; "Alle Neuigkeiten" opens `#news`; `#news` lists all releases with the newest open, works logged out, and clears the Info badge; a `newbie` login shows the welcome dialog and no news dialog; verify `npm run test:e2e` passes three times in a row
- [x] 4.2 Browser check in mock mode (own PORT, scratch `DEV_SQLITE_PATH`) at 1440 px and 390 px with Playwright screenshots: popup, `#news` with an old release opened, Info badge, logged-out `#news`; no console/CSP errors
- [x] 4.3 Run `npm test` and verify it passes completely (including wiki validation and the stale `graph.json` check)

## Workflow follow-up

- Commit planning and code separately, push `62-d-13-neuigkeiten-ohne-pop-up`, MR "D-13: „Neuigkeiten“ ohne Pop-up" with German description and `Closes #62`.
- After the merge: `/opsx:archive` on a `chore/openspec-archive-…` branch from `origin/main`.
