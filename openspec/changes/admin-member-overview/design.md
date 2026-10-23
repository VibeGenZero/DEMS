# Design: Member overview for admins (W-15)

## Context

See proposal.md for the motivation and specs/member-overview/spec.md for the behaviour.

What exists today:

- `users` documents (`{ id, username, displayName, avatar, acceptInvitations, notifications?, createdAt, updatedAt }`) are written on web login (`utils/userProfile.js#saveUserProfile`) and on a Discord registration (`bot.js#ensureUserProfile`), so Discord-only members are already in the collection.
- `GET /api/user/profile` builds a member's own lists with the pure helper `utils/profileEvents.js` (`toProfileEntry`, `buildProfileEvents`), which never carries the check-in code. `utils/eventListing.js#isEventOver` is the shared "over" rule; `utils/notificationPrefs.js#normalizeNotificationPrefs` turns a stored `notifications` field into three booleans.
- The admin event table (`admin/event-rows.js` pure rules + `admin/event-table.js` pure markup + `admin/dashboard.js` DOM) is the pattern for a searchable, sortable admin list; the `data-table` component already has sort heads (`aria-sort`) and a block layout below 768 px.
- Admin pages with their own route exist (`#bot-control`, own navbar link toggled in `core/auth.js#showLoggedIn`). Detail routes with a parameter exist (`#poll/<id>`, `#event/<id>`).

## Goals / Non-Goals

**Goals:**
- Two read-only admin endpoints whose numbers come from one pure, unit-tested helper.
- A list page and a detail page built from existing components (data table, card, chip, avatar, empty state, skeleton), following the pure-markup/DOM split of the admin event table.

**Non-Goals:**
- Pagination or server-side search: a community has hundreds of members at most; the list is filtered and sorted in the browser like the admin event table.
- Discord roles or admin flag per member (roles live in Discord and are only read for the logged-in session).
- Guest participation (being someone's `guests[]` entry) in the numbers or history: only the member's own registrations count, as on the profile page.
- Shared numbers with W-14 (evaluations): W-14 can reuse the helper later, but this change does not build dashboard statistics.

## Decisions

1. **One pure helper `utils/memberOverview.js`.** Exports `memberStats(registrations, eventsById, trackedEventIds, now)`, `lastActivity(user, registrations)`, `buildMemberList(users, registrations, eventsById, now)` and `buildMemberHistory(registrations, eventsById, trackedEventIds, now)`; a small `trackedEventIds(events, registrations)` returns the ids of events with `checkinEnabled` or at least one `checkedIn` registration. Rules ("Teilnahme" = accepted and the event is over, not cancelled, not deleted; "over" = `isEventOver` or status `archived`) live only here, mirrored by `test/memberOverview.test.js`. *Alternative:* extend `routes/user.js` profile code — rejected, that route mixes stats, badges and DOM-shaped output and is tied to the session user.

2. **History entries extend `toProfileEntry`.** Each history row is `{ ...toProfileEntry(registration, event), source, noShow }` (`source` = `web` \| `discord` \| `admin`, missing → `web`; `noShow` boolean). That keeps the "no check-in code" guarantee in one place and gives the slot, event title, date and status for free. The detail sorts all rows newest event first with the profile's `byDateDescending` rule (exported for reuse) instead of splitting upcoming/history — the admin wants one complete timeline. Form answers, guests and `pendingGuests` are never copied.

3. **Endpoints in `routes/admin.js`** (already guarded by `requireAuth` + `requireAdmin`):
   - `GET /members` → `{ members: [{ id, username, displayName, avatar, createdAt, lastActiveAt, stats: { registrations, attended, checkedIn, noShows } }] }`. Three full reads (`users`, `registrations`, `events`), everything else in memory. Server returns them unsorted-but-stable (by display name); the browser sorts.
   - `GET /members/:id` → `{ member: { id, username, displayName, avatar, createdAt, lastActiveAt, acceptInvitations, notifications: { reminders, changes, waitlist } }, stats, history }`; reads the `users` doc (404 `Mitglied nicht gefunden.`), the member's registrations (`where('userId', '==', id)`), the events they reference, and — to know whether those events were tracked — the registrations of those events (one `loadEventRegistrations` per distinct event, as the profile does for waitlist places). `acceptInvitations` missing → `true`.
   - Each handler has its own `try/catch` with `Fehler beim Laden der Mitglieder` / `Fehler beim Laden des Mitglieds`. No audit entry (reads are not logged, like `/audit-log` itself).

4. **Frontend split like the event table.**
   - `public/js/admin/member-rows.js` (pure): `MEMBER_SORT_KEYS`, `DEFAULT_MEMBER_SORT` (`name`, ascending), `filterMembers(members, search)` (display name, username, id; case-insensitive, trimmed), `sortMembers(members, sort)` (numbers/date descending first, tie → name via `localeCompare('de')`), `nextMemberSort(current, key)` (same key flips direction).
   - `public/js/admin/member-view.js` (pure): `renderMemberTable(rows, { sort })` (`data-table` with columns Mitglied (avatar + name + `@username`), Anmeldungen, Teilnahmen, Check-ins, No-Shows, Letzte Aktivität; the name is a link to `#member/<id>`), `renderMemberTableSkeleton`, `renderMemberEmpty({ search })`, `renderMemberDetail(detail, now)` (card with account info as `chip`s "an"/"aus", four stat tiles, history list), `renderMemberHistoryRow(entry, now)` (date, title link or "Gelöschtes Event", status chip via `renderStatusChip`, chips "Eingecheckt" / "Nicht erschienen", source chip with `bi-globe` / `bi-discord` / `bi-person-gear`, slot), `renderMemberNotFound`.
   - `public/js/admin/members.js` (DOM): `showMembersSection()` (skeleton, `GET /api/admin/members`, keeps `membersView = { members, search, sort }` for the page's lifetime), `searchMembers` (action `data-input`), `resetMemberSearch`, `sortMembers` action (`data-click` with `data-sort`), `showMemberDetail(id)` (drops answers for an old id like `state.detailEventId`), `reloadMembers`. Errors: `emptyState` with "Erneut versuchen", no toast spam.
   - Last activity shows as a relative day (`relativeDay` from `events/cards.js`) with the exact date as `title`.

5. **Routing and navigation.** `index.html` gets `#members-section` and `#member-detail-section` and a navbar item `#nav-members` (`bi-people`, "Mitglieder", `data-section="members-section"`) between Admin and Bot-Zentrale; `core/auth.js` shows/hides it with the other admin links; the admin dashboard header gets an `<a class="btn btn-outline-light" href="#members">`. `core/router.js` adds `members` and `member` (admin check like `bot-control`, else `navigateTo('events')`); for `member` the navbar marks the `members-section` link (one mapping line next to the existing active-link loop).

6. **Styles.** Reuse `data-table`, `glass-card`, `chip`, `avatar`, `stats-grid`-like tiles from the profile card. New rules only for the member cell (avatar next to two lines) and the history list layout, in `style.css` with tokens; no inline styles, Bootstrap Icons only.

## Risks / Trade-offs

- [Three full collection reads per list load] → acceptable at community scale and already the pattern of `/api/users/search` and the admin stats; filtering in memory follows the "no composite index, no limit" rule. If it ever hurts, the helper stays and only the loading changes.
- [Detail page reads the registrations of every event the member touched to decide "tracked"] → one read per distinct event, bounded by the member's history; same cost model as the profile's waitlist places.
- [No-show definition differs from what W-14 may decide later] → the rule lives in one helper with tests; W-14 will reuse or change it in one place.
- [`updatedAt` also moves on settings saves, not only logins] → the label is "Letzte Aktivität", which a settings change honestly is.
- [`users` docs without `displayName`] (old data) → fall back to `username`, then the id, both for display and for sorting.

## Migration Plan

No data migration; existing documents are read as they are. Rollback = revert the commit.
