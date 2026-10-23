# Tasks

## 1. Evaluation rules (pure helper)

- [x] 1.1 Write `test/insights.test.js` first (RED): range filter (90-day default, event 120 days ago only in `365`/`all`, upcoming and cancelled never, archived counts, undated only in `all`), unknown range rejected by `isValidRange`, totals for the spec scenarios (10/8 + 5/2 → 67 % / 33 %, untracked event leaves the rates unchanged but counts as evaluated, nothing tracked → `null` rates, occupancy 8/10 + 12/20 → 67 % with an unlimited event left out, guests count as places), per-event rows (`noShows`/`attendanceRate` `null` when untracked, `occupancyRate` `null` without limit), top members (tie by check-ins then name, max 10, no zero entries, name fallback profile → registration → id, `hasProfile`), categories (case-insensitive grouping with first spelling, "Ohne Kategorie", average with one decimal, `share` relative to the largest, order), no `checkinCode`/`formAnswers`/`guests`/`notifications` in the output; verify `node --test test/insights.test.js` fails on the missing module
- [x] 1.2 Export `isOver` from `utils/memberOverview.js` and create `utils/insights.js` (`RANGES`, `DEFAULT_RANGE`, `isValidRange`, `evaluatedEvents`, `buildInsights`) per design decisions 1–3; verify `node --test test/insights.test.js test/memberOverview.test.js` passes

## 2. Endpoint

- [x] 2.1 Add RED cases to `test/devServer.test.js`: `GET /api/admin/insights` 401 without session, 403 for `member`; for `admin` the default range is `90` and the answer has `totals`, `members`, `categories`, `events`; `range=all` evaluates at least the seeded past events (e.g. the archived "Sommerfest"); `range=7` → 400 `Ungültiger Zeitraum.`; the answer contains neither the seeded check-in codes nor form answers; verify the new cases fail
- [x] 2.2 Implement the route in `routes/admin.js` per design decision 4; verify `node --experimental-vm-modules --test test/devServer.test.js test/insights.test.js` passes
- [x] 2.3 Update `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md` (row, W-14, no audit action), `docs/wiki/modules/utils.md` (section `utils/insights.js`, `isOver` export of `memberOverview.js`), `docs/wiki/index.md` (file → node row); run `npm run wiki` and verify `node --test test/wiki.test.js` passes

## 3. Frontend page

- [x] 3.1 RED tests `test/insightsView.test.js` (via `loadFrontendApp`): `formatRate` ("67 %", "–" for `null`), `sortInsightEvents` (default date desc, `null` last in both directions, tie by date), `nextInsightSort`, `renderInsightRanges` (four buttons, active one marked, `data-click="setInsightRange"`), `renderInsightTotals` (four stat cards, hint when nothing tracked), `renderInsightMembers` (rank, link `#member/<id>` only with `hasProfile`, escaped names), `renderInsightCategories` (`<progress class="capacity-meter" max="100" value="…">`, "Ohne Kategorie", "Ø 3,5 Teilnehmer" with German decimal comma), `renderInsightTable` (link `#event/<id>`, `aria-sort`, `data-click="sortInsights"`, dashes for untracked and unlimited events, escaping), `renderInsightsEmpty`; plus a DOM test that `showInsightsSection` loads `/api/admin/insights?range=90` and `setInsightRange('365')` reloads with `range=365`; verify they fail
- [x] 3.2 Implement `public/js/admin/insights-view.js` and `public/js/admin/insights.js` per design decision 5, add `#insights-section` and the dashboard button to `public/index.html`, import both modules in `public/js/main.js`; verify 3.1 passes and `test/frontendModules.test.js`, `test/actionAttributes.test.js`, `test/frontendCsp.test.js`, `test/frontendActions.test.js` stay green
- [x] 3.3 Routing: extend `test/navLinks.test.js` first (`#insights` marks the "Admin" link) and `test/authFrontend.test.js` (dashboard button `href="#insights"`), then add the `insights` case with the admin check and `NAV_ROUTE.insights = 'admin'` in `public/js/core/router.js`; verify those tests pass
- [x] 3.4 Styles (block INSIGHTS in `public/css/style.css`, tokens only, phone layout of the table via `data-label`); verify `test/cssRules.test.js`, `test/designTokens.test.js`, `test/contrast.test.js` pass
- [x] 3.5 Update `docs/wiki/modules/frontend-app.md` (route row, module rows for `admin/insights.js` and `admin/insights-view.js`, `NAV_ROUTE`) and `docs/wiki/modules/frontend-markup.md` (section, dashboard button, INSIGHTS block); run `npm run wiki` and verify `node --test test/wiki.test.js` passes

## 4. Integration

- [x] 4.1 Add e2e cases to `e2e/admin.spec.js`: admin opens "Auswertungen" from the dashboard, sees four key figures, switches to "Alles" and sees a seeded past event in the table and at least one category; desktop sorts the table by quote; a member opening `#insights` lands on the events; verify `npm run test:e2e` passes three times in a row
- [x] 4.2 Browser check in mock mode (own PORT, scratch `DEV_SQLITE_PATH`) as admin at 1440 px and 390 px with Playwright screenshots: every range, empty range state if reachable, no console/CSP errors
- [x] 4.3 Run `npm test` and verify it passes completely (including wiki validation and the stale `graph.json` check)

## Workflow follow-up

- Commit planning and code separately, push `78-w-14-auswertungen-fur-admins`, MR "W-14: Auswertungen für Admins" with German description and `Closes #78`.
- After the merge: `/opsx:archive` on a `chore/openspec-archive-…` branch from `origin/main`.
