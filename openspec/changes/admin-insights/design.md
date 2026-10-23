# Design: Evaluations for admins (W-14)

## Context

See proposal.md for the motivation and specs/admin-insights/spec.md for the behaviour.

What exists:

- `utils/memberOverview.js` (W-15) holds the attendance rules: `isOver(event, now)` (exists, not cancelled, archived or `isEventOver`; module-private today), `trackedEventIds(eventsById, registrations)` (exported), and the no-show rule. `GET /api/admin/members` already loads `users`, `registrations`, `events` in three full reads.
- `utils/capacity.js#placesOf(registration)` counts a registration's places (member + guests + open invitations), the same count the places display uses.
- The admin dashboard (`admin/dashboard.js`) renders six counters into `#admin-stats` with `.stat-card`; the W-15 pages show the pattern for an admin page with its own route, a pure view module and a DOM module (`admin/member-view.js`, `admin/members.js`), sortable `.data-table` heads, and `NAV_ROUTE` in `core/router.js` to mark a navbar link for a page without its own.
- `<progress class="capacity-meter">` is the existing bar component (styled per theme, AA-checked); `data-style-width` + `applyStyleData()` would be the alternative for custom bars.

## Goals / Non-Goals

**Goals:**
- One read-only endpoint whose numbers come from one pure, unit-tested helper; the attendance rules stay in `memberOverview.js`.
- A page built from existing components (stat cards, glass cards, data table, chips, avatar, progress meter, empty state, skeleton).

**Non-Goals:**
- Charts over time (trend lines), CSV export, per-series grouping, filters other than the range.
- Changing the old six counters of the dashboard.
- Caching: numbers are computed per request, like the member list.

## Decisions

1. **Pure helper `utils/insights.js`.** `RANGES = { '30': 30, '90': 90, '365': 365, all: null }`, `DEFAULT_RANGE = '90'`; `evaluatedEvents(eventsById, range, now)` (over, not cancelled, start within `now - days … now`; for `all` also undated over events — `isOver` is false for undated active events, so in practice archived undated ones), `buildInsights({ users, registrations, eventsById, range, now })` → `{ range, totals: { events, accepted, checkedIn, trackedEvents, attendanceRate, noShowRate, placesTaken, placesOffered, occupancyRate }, members: [...top 10], categories: [...], events: [...] }`. Rates are whole numbers 0–100 or `null` when the denominator is 0; `noShowRate = 100 - attendanceRate` so both always add up to 100. *Alternative:* compute in the browser from `/members` + `/all-events` — rejected: the browser would need every registration, and the rules would exist twice.

2. **Reuse, don't copy, the W-15 rules.** Export `isOver` from `memberOverview.js` (already used by `memberStats`) and call `trackedEventIds` with all registrations. Per event: `accepted` = accepted registrations; `checkedIn` = accepted and checked in; `noShows` = accepted − checkedIn when tracked, else `null`; `attendanceRate` per event = checkedIn ÷ accepted when tracked and accepted > 0; `placesTaken` = Σ `placesOf` over accepted registrations; `occupancyRate` when `maxParticipants > 0`. Totals sum per-event counts (weighted), not averages of per-event rates — matches the spec scenario (10/15 = 67 %).

3. **Members and categories.** Members: group accepted registrations of evaluated events by `userId`; `attended` count, `checkedIn` count; name from the `users` doc (`displayName` → `username`), else `registration.userName`, else the id; `hasProfile` decides the link; sort attended ↓, checkedIn ↓, name (`localeCompare` de); top 10. Categories: key = `category.trim().toLocaleLowerCase('de')`, label = first trimmed spelling seen (events iterated newest first, so the label is the latest spelling), empty → `Ohne Kategorie`; fields `events`, `registrations` (any status), `averageAccepted` (one decimal), `attendanceRate` (over its tracked events, `null` without), `share` (events ÷ largest category's events, 0–100, for the bar). Order: events ↓, registrations ↓, label.

4. **Endpoint `GET /api/admin/insights?range=`** in `routes/admin.js` (guarded by the router). Missing `range` → `90`; unknown → 400 `Ungültiger Zeitraum.`. Three full reads like `/members`, then `buildInsights`. Output event rows carry only `{ id, title, startDate, category, accepted, checkedIn, noShows, attendanceRate, placesTaken, placesOffered, occupancyRate }` — no codes, answers, guests or settings. Own `try/catch`, `Fehler beim Laden der Auswertungen`, no audit entry.

5. **Frontend split like W-15.**
   - `public/js/admin/insights-view.js` (pure): `INSIGHT_RANGES` (labels "30 Tage", "90 Tage", "12 Monate", "Alles"), `INSIGHT_SORT_KEYS`, `DEFAULT_INSIGHT_SORT` (`date` desc), `sortInsightEvents(rows, sort)` (`null` values always last, ties by date desc), `nextInsightSort`, `formatRate(n)` ("67 %" / "–"), `renderInsightRanges(active)` (`.nav.nav-pills` buttons, `data-click="setInsightRange"`), `renderInsightTotals(totals)` (four `.stat-card`s; hint when `trackedEvents === 0`), `renderInsightMembers(members)` (ordered list with avatar-less rank, name link, "n Teilnahmen · m Check-ins"), `renderInsightCategories(categories)` (rows with label, `<progress class="capacity-meter" max="100" value="share">`, "n Events · m Anmeldungen · Ø x Teilnehmer · Quote"), `renderInsightTable(rows, { sort })` (`.data-table.insights-table` with `data-label` cells for phones, title link `#event/<id>`), `renderInsightsEmpty()`, `renderInsightsSkeleton()`, `renderInsightsError()`.
   - `public/js/admin/insights.js` (DOM): `insightsView = { range: '90', data: null, sort }`, `showInsightsSection()`, `loadInsights()` (drops an answer for an older range), `setInsightRange(range)`, `sortInsights(key)`; actions `setInsightRange`, `sortInsights`, `reloadInsights`. Range and sort live as long as the page.
   - Pure helpers that also exist server-side are not duplicated: the browser only formats and sorts.

6. **Routing and markup.** `index.html` gets `#insights-section` (header "Auswertungen" with `bi-graph-up`, `#insights-ranges`, `#insights-totals` as `.stats-grid`, a two-column `.insights-grid` with `#insights-members` and `#insights-categories`, then `#insights-table`) and a dashboard header button `<a class="btn btn-outline-light" href="#insights">`. `core/router.js`: case `insights` with the admin check, `NAV_ROUTE.insights = 'admin'`.

7. **Styles.** `style.css` block INSIGHTS after MEMBERS: `.insights-grid` (two columns from 992 px), `.insights-rank` list, `.insights-category` rows, `.insights-hint`; table column labels below 768 px via `data-label` like `.members-table`. Tokens only; bars are `capacity-meter`, so no runtime width.

## Risks / Trade-offs

- [Three full collection reads per page load and range change] → same cost as the member list; fine at community scale. The range filter runs in memory.
- [Rates mean little with few tracked events] → the key figure shows the number of evaluated events next to the rates, and the hint names when nothing was tracked.
- [Category spelling drift ("Gaming" vs "gaming")] → grouped case-insensitively; W-13 (managed categories) will remove the drift later without changing this logic.
- [Guests in occupancy but not in quotes] → quotes are about members who checked in (guests have no own check-in); occupancy is about places, where guests count. Both labelled accordingly.
- [`isOver` export widens `memberOverview.js`] → it is the shared rule; exporting keeps one definition.

## Migration Plan

No data migration. Rollback = revert the commit.
