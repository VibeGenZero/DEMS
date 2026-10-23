# Tasks

## 1. Numbers and history (pure helper)

- [x] 1.1 Write `test/memberOverview.test.js` first (RED): Anmeldungen/Teilnahmen/Check-ins/No-Shows for the spec scenarios (mixed history, cancelled and deleted events, tracked by `checkinEnabled`, tracked by one checked-in registration, untracked event without no-shows, archived counts as over), `trackedEventIds`, `lastActivity` (registration after login, no readable date → `null`), `buildMemberList` (one entry per user, registrations of unknown user ids ignored, name fallback `displayName` → `username` → id), `buildMemberHistory` (newest event first, no-date rows by registration time, `source` default `web`, `noShow` flag, no `formAnswers`/`guests`/`pendingGuests`/`checkinCode` in the output); verify with `node --test test/memberOverview.test.js` failing on the missing module
- [x] 1.2 Export `byDateDescending` from `utils/profileEvents.js` and create `utils/memberOverview.js` (`trackedEventIds`, `memberStats`, `lastActivity`, `buildMemberList`, `buildMemberHistory`) per design decisions 1–2; verify `node --test test/memberOverview.test.js test/profileEvents.test.js` passes

## 2. Admin endpoints

- [x] 2.1 Add RED cases to `test/devServer.test.js`: `GET /api/admin/members` is 401 without session and 403 for the `member` persona; for `admin` it lists every seeded `users` doc with `stats` and `lastActiveAt` and the count equals the seeded users; a Discord-only seeded user (if the seed has none, check the `raider`/`newbie` personas) appears; `GET /api/admin/members/<raider id>` returns `member` with `acceptInvitations` and normalized `notifications`, `stats`, `history` with `source`; unknown id → 404 `Mitglied nicht gefunden.`; neither answer contains a `checkinCode` value of the seeded events or `formAnswers`; verify the new cases fail
- [x] 2.2 Implement both routes in `routes/admin.js` (own `try/catch`, German errors, no audit entry, reads only via `firebaseAdmin.js`, `loadEventRegistrations` for tracked events of the detail) per design decision 3; verify `node --experimental-vm-modules --test test/devServer.test.js test/memberOverview.test.js` passes
- [x] 2.3 Update `docs/wiki/reference/api-index.md` (two GET lines, guard A), `docs/wiki/modules/routes-admin.md` (table rows, W-15, no audit action), `docs/wiki/concepts/data-model.md` (`users` section names `utils/memberOverview.js` as reader and the no-show/tracked rule), `docs/wiki/index.md` (file → node row for `utils/memberOverview.js`); run `npm run wiki` and verify `node --test test/wiki*.test.js` (or `npm test`) reports no wiki errors

## 3. Frontend: list page

- [x] 3.1 RED tests `test/memberRows.test.js` for `public/js/admin/member-rows.js` (`filterMembers` by display name/username/id, case-insensitive, empty search = all; `sortMembers` default name A–Z with `localeCompare('de')`, numbers and last activity descending first, tie → name; `nextMemberSort` flips the same key) via `loadFrontendApp`; verify they fail with `node --experimental-vm-modules --test test/memberRows.test.js`
- [x] 3.2 RED tests `test/memberView.test.js` for `renderMemberTable` (link `#member/<id>`, `aria-sort` on the active head, all values escaped — a display name with `<script>` stays text), `renderMemberEmpty` ("Keine Mitglieder gefunden" + reset button with `data-click="resetMemberSearch"`), header count text "<n> Mitglieder"; verify they fail
- [x] 3.3 Implement `member-rows.js`, the list part of `member-view.js` and `public/js/admin/members.js` (`showMembersSection`, `searchMembers`, `resetMemberSearch`, `sortMembers` via `registerActions`), add `#members-section` to `public/index.html`, import in `public/js/main.js`; verify 3.1/3.2 pass and `test/frontendModules.test.js`, `test/actionAttributes.test.js`, `test/frontendCsp.test.js` stay green
- [x] 3.4 Navigation: navbar item `#nav-members` (`bi-people`, "Mitglieder") between Admin and Bot-Zentrale, toggled in `core/auth.js` with the other admin links, button `href="#members"` in the admin dashboard header, routes `members`/`member` with the admin check in `core/router.js` and the active link for `member`; extend `test/navLinks.test.js` (and `test/authFrontend.test.js` if it lists the admin links) first; verify those tests pass
- [x] 3.5 Styles for the member cell and the list in `public/css/style.css` with tokens only; verify `test/cssRules.test.js`, `test/designTokens.test.js`, `test/contrast.test.js` pass
- [x] 3.6 Update `docs/wiki/modules/frontend-app.md` (route table, module rows for `admin/members.js`, `admin/member-rows.js`, `admin/member-view.js`, `core/auth.js` admin links), `docs/wiki/modules/frontend-markup.md` (new sections/blocks), `docs/wiki/index.md` (file → node rows); run `npm run wiki`

## 4. Frontend: member details

- [x] 4.1 RED tests in `test/memberView.test.js` for `renderMemberDetail` (names, Discord id, "Dabei seit", last activity, invitations and the three DM choices "an"/"aus", four numbers) and `renderMemberHistoryRow` (event link `#event/<id>`, "Gelöschtes Event" without link, status chip, "Eingecheckt" / "Nicht erschienen", source "Web"/"Discord"/"Admin" with `bi-globe`/`bi-discord`/`bi-person-gear`, slot with emoji, empty history → empty state) and `renderMemberNotFound` (link back to `#members`); verify they fail
- [x] 4.2 Implement the detail part of `member-view.js`, `showMemberDetail(id)` in `members.js` (skeleton, drops stale answers, load error with "Erneut versuchen", 404 → not-found state), `#member-detail-section` in `public/index.html`, styles with tokens; verify 4.1 passes and the CSS/CSP tests stay green
- [x] 4.3 Update `docs/wiki/modules/frontend-app.md` and `docs/wiki/modules/frontend-markup.md` for the detail page; run `npm run wiki`

## 5. Integration

- [x] 5.1 Add an e2e case to `e2e/admin.spec.js`: admin opens "Mitglieder" from the navbar, sees the count, searches a seeded member, sorts by Teilnahmen, opens the member and sees the history; a member persona does not see the link; verify `npm run test:e2e` passes (run it three times, shared-DB races)
- [x] 5.2 Browser check in mock mode (`npm run dev:mock` with a scratch `DEV_SQLITE_PATH`) as admin on desktop and at 390 px: list, search, sort, detail, deleted event row, no console/CSP errors
- [x] 5.3 Run `npm test` and verify it passes completely (including wiki validation and the stale `graph.json` check)

## Workflow follow-up

- Commit planning and code separately, push `79-w-15-mitgliederubersicht-fur-admins`, MR "W-15: Mitgliederübersicht für Admins" with German description and `Closes #79`.
- After the merge: `/opsx:archive` on a `chore/openspec-archive-…` branch from `origin/main`.
