# Guest Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guests see the real status of the inviting registration, check in themselves (code and Discord), and count as participants of their own in every attendance number (#110).

**Architecture:** A guest's check-in is stored on the inviting registration in `guestCheckins[<guestId>]`. A pure helper turns registrations into one *participation* per person; evaluations, member overview, profile numbers and the admin check-in box count participations. Check-in rules stay in `utils/checkin.js`, so the code route and the Discord button pick up guests together.

**Tech Stack:** Node ≥ 22, Express 5, discord.js, `firebaseAdmin.js` document store (SQLite in tests), vanilla ES modules, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-10-guest-checkin-design.md`

## Global Constraints

- Data only through `firebaseAdmin.js`; dates are ISO strings; filter in memory.
- Everything users see in German; code, comments, commits, wiki in English.
- Each route handler has its own `try/catch` → `res.status(x).json({ error: '<German>' })`; admin mutations call `addAuditLog(...)`.
- Never return `checkinCode` in any event or registration response.
- A guest gets nothing of the inviting registration beyond `id`, `status` and their own `checkedIn` / `checkedInAt`.
- Only ids in `guests` count as guests; `guestCheckins` entries of other ids are ignored everywhere.
- Every write to `guestCheckins` runs inside `withEventLock(eventId, …)`, re-reads the registration and writes the whole map.
- Frontend: `escapeHtml` for interpolated values, actions via `data-click` + `registerActions`, no inline styles, Bootstrap Icons only.
- Tests first (`node:test` + `node:assert/strict`); update the wiki node of every changed file in the same commit, then `npm run wiki`; `npm test` green before each commit.

## Review Focus

1. **Guest of a registration that is not accepted** (pending, waitlisted, offered): the code check-in must refuse with „Keine akzeptierte Anmeldung gefunden.“ and the page must show no code field. Pinned in Task 2 and Task 5.
2. **Member who is both listed guest and has an own registration** (old data): the own registration wins for check-in, the guest participation is still counted once for the guest. Pinned in Task 1 and Task 2.
3. **Stale `guestCheckins` entry** of an id no longer in `guests`: never counted, never shown. Pinned in Task 1.
4. **Concurrent writes** (guest accepts an invitation while another guest checks in): no lost update. Pinned in Task 2 by running both under the lock.
5. **Lock nesting:** `inviteToCheckin` holds `withEventLock('checkin:<id>')`; `markInvited` for a guest takes `withEventLock(<id>)` — a different key, so no self-deadlock; no caller may hold `withEventLock(<id>)` while calling `markInvited`/`checkInMember`. Pinned in Task 2 (invitation run with a guest finishes).

---

### Task 1: Participations helper

**Files:**
- Create: `utils/participations.js`
- Test: `test/participations.test.js`

**Interfaces:**
- Produces:
  - `isListedGuest(registration, userId) -> boolean`
  - `guestCheckinOf(registration, guestId) -> { checkedIn: boolean, checkedInAt: string|null, checkinInvitedAt: string|null }` (defaults when missing or not listed)
  - `toParticipations(registrations: Object[]) -> Object[]`: for each registration first `{ ...registration, asGuest: false }`, then per id in `guests`: `{ id: \`${registration.id}#${guestId}\`, registrationId: registration.id, eventId, status, createdAt, source, userId: guestId, userName, userAvatar, checkedIn, checkedInAt, asGuest: true, hostUserId: registration.userId }` with `userName`/`userAvatar` from `pendingGuests[].displayName`/`avatar` (fallback: the id / `''`)
  - `participationsOf(registrations, userId) -> Object[]`: `toParticipations` filtered to `userId`
  - `hasAnyCheckin(registration) -> boolean`: own `checkedIn` or a listed guest checked in
  - `clearedCheckins(registration) -> Object`: update fields `{ checkedIn: false, checkedInAt: null }` plus, when `guestCheckins` exists, `guestCheckins` with every entry `checkedIn: false, checkedInAt: null` and `checkinInvitedAt` kept

- [ ] **Step 1: Write the failing tests** in `test/participations.test.js`:
  - `a registration with two guests becomes three participations` — ids `r1`, `r1#g1`, `r1#g2`; guests carry `status`, `eventId`, `createdAt` of `r1`, `asGuest: true`, `hostUserId`, name from `pendingGuests`.
  - `guest check-ins come from guestCheckins, only for listed guests` — `guestCheckins: { g1: { checkedIn: true, checkedInAt: 'T1' }, gone: { checkedIn: true } }` → `r1#g1.checkedIn === true`, no participation for `gone`, `guestCheckinOf(reg, 'gone').checkedIn === false`.
  - `participationsOf lists own registrations and guest places of one user`.
  - `hasAnyCheckin sees own and guest check-ins, not stale ones`.
  - `clearedCheckins resets own and guest check-ins and keeps the invitation time` — `{ checkedIn: false, checkedInAt: null, guestCheckins: { g1: { checkedIn: false, checkedInAt: null, checkinInvitedAt: 'T0' } } }`; without `guestCheckins` the key is absent.

- [ ] **Step 2: Run** `node --test test/participations.test.js` — Expected: FAIL `Cannot find module '../utils/participations'`.
- [ ] **Step 3: Implement** the six exports in `utils/participations.js` (pure, no database import).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Wiki + commit.** Add a `## utils/participations.js (pure)` section to `docs/wiki/modules/utils.md` (+ `sources`), a row in the file → node table of `docs/wiki/index.md` (`utils, registration-flow, insights` nodes as they exist), and the `guestCheckins` field to the registration shape in `docs/wiki/concepts/data-model.md`. `npm run wiki`, `npm test`, commit `Add a per-person view of registrations and their guests`.

### Task 2: Check-in rules for guests

**Files:**
- Modify: `utils/checkin.js`, `bot/checkin.js:115-130`, `dev/mockBot.js:290-300`
- Test: `test/discordCheckin.test.js`

**Interfaces:**
- Consumes: `isListedGuest`, `guestCheckinOf` (Task 1); `withEventLock` (`utils/eventLock.js`).
- Produces:
  - `findAcceptedGuestRegistration(eventId, userId) -> Promise<{ id, data }|null>`: accepted registration of the event whose `guests` contain `userId`.
  - `checkInMember({ eventId, userId, now, requireRunning })` — same results and codes as today, plus `asGuest: boolean` on `ok: true`. Order: own accepted registration first, else the guest registration (checked in under `withEventLock(eventId)` with a fresh read).
  - `listCheckinInvitees(eventId) -> Promise<Array<{ id: string, userId: string, guestId: string|null }>>`: per accepted registration in creation order the member (if not checked in / invited, `guestId: null`), then each listed guest not checked in / invited (`userId = guestId`).
  - `markInvited(registrationId, now = new Date(), guestId = null)`: guest → `guestCheckins[guestId].checkinInvitedAt` under the event lock.

- [ ] **Step 1: Write the failing tests** in `test/discordCheckin.test.js` (reuse `seedEvent` / `seedRegistration`):
  - `a listed guest of an accepted registration checks in on that registration` — `checkInMember({ eventId, userId: 'guest-1' })` → `{ ok: true, asGuest: true, alreadyCheckedIn: false }`; stored `guestCheckins['guest-1'].checkedIn === true`; the host's own `checkedIn` unchanged; second call → `alreadyCheckedIn: true` with the first time.
  - `a guest of a pending or waitlisted registration gets no_registration` — for both statuses, nothing written.
  - `an own accepted registration wins over a guest place`.
  - `invitees list guests after their host and only once` — host + 2 guests, one guest already checked in → `[{ userId: host, guestId: null }, { userId: 'guest-2', guestId: 'guest-2' }]`; after `markInvited(id, now, 'guest-2')` the guest is gone from the list.
  - `the Discord button checks a guest in` — click `event_checkin:<id>` as the guest (pattern of `a click checks the member in and replaces the button`) → „✅ Du bist eingecheckt!“.
  - `the mock twin invites guests too` — extend `the mock twin invites the open members of a running event once` with a guest; the guest is in the logged recipients once.
  - `a guest check-in and a guest answer at the same time both stay` — run `checkInMember` for `guest-1` and, inside `withEventLock(eventId)`, a write that adds `guest-3` to `guests` via `Promise.all`; afterwards both changes are stored.

- [ ] **Step 2: Run** `node --test test/discordCheckin.test.js` — Expected: the new tests FAIL (`no_registration` / missing guest entries).
- [ ] **Step 3: Implement** the interfaces above in `utils/checkin.js`; in `bot/checkin.js` and `dev/mockBot.js` pass `guestId` to `markInvited` (the DM goes to `userId` as today).
- [ ] **Step 4: Run** `node --test test/discordCheckin.test.js test/reminderScheduler.test.js` — Expected: PASS.
- [ ] **Step 5: Wiki + commit.** Update `## Check-in` in `docs/wiki/concepts/event-lifecycle.md` and `## Check-in invitations (B-07)` in `docs/wiki/concepts/discord-integration.md` (guests check in on the inviting registration, get the DM). `npm run wiki`, `npm test`, commit `Let guests check in with the code and the Discord button`.

### Task 3: Reset guest check-ins when a registration leaves „accepted“

**Files:**
- Modify: `utils/registrationStatus.js:58-62`, `utils/bulkRegistrations.js:47`, `routes/admin.js:1255`
- Test: `test/bulkRegistrations.test.js`, `test/discordApprovals.test.js` (its service tests call `changeRegistrationStatus`)

**Interfaces:**
- Consumes: `hasAnyCheckin`, `clearedCheckins` (Task 1).
- Produces: `planBulkAction` changes keep `clearCheckin: boolean`, now `hasAnyCheckin(registration)`.

- [ ] **Step 1: Write the failing tests** (in `test/discordApprovals.test.js` next to its `changeRegistrationStatus` service tests, and in `test/bulkRegistrations.test.js`):
  - `changeRegistrationStatus to waitlisted clears own and guest check-ins` — accepted registration with own and guest check-in → after the change both `checkedIn: false`, `checkedInAt: null`, `checkinInvitedAt` kept.
  - `planBulkAction marks clearCheckin when only a guest is checked in`.
- [ ] **Step 2: Run** `node --test test/discordApprovals.test.js test/bulkRegistrations.test.js` — Expected: the two new tests FAIL.
- [ ] **Step 3: Implement:** `registrationStatus.js` uses `hasAnyCheckin(reg)` and `Object.assign(update, clearedCheckins(reg))`; `bulkRegistrations.js` sets `clearCheckin: hasAnyCheckin(registration)`; the bulk route in `routes/admin.js` assigns `clearedCheckins(registrationsById.get(change.id))` instead of the two fixed fields.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Wiki + commit.** One line in `## Guests` of `docs/wiki/concepts/registration-flow.md` (leaving „accepted“ resets guest check-ins). Commit `Reset guest check-ins with the registration's check-in`.

### Task 4: Server API for guests

**Files:**
- Modify: `routes/events.js:446-463` (my-registration), `routes/admin.js:1126-1149` (checkin-stats), `routes/admin.js:1423-1452` (PUT check-in), `routes/admin.js:1360-1380` (CSV)
- Create: `test/guestCheckinServer.test.js` (shared SQLite file + `dev/start.js`, as `test/roleRefreshServer.test.js`; persona login as in `test/devServer.test.js`)
- Modify: `test/devServer.test.js:340-345`

**Interfaces:**
- Consumes: `checkInMember` (Task 2), `toParticipations`, `guestCheckinOf`, `isListedGuest` (Task 1).
- Produces:
  - my-registration (guest): `{ registered: true, asGuest: true, id, status, checkedIn, checkedInAt }`.
  - `GET /api/admin/events/:id/checkin-stats` → `{ total, checkedIn, code }` counting accepted participations.
  - `PUT /api/admin/registrations/:id/checkin` body `{ checkedIn: boolean, guestId?: string }`; unknown guest → 400 `{ error: 'Dieser Gast gehört nicht zu der Anmeldung.' }`; registration not accepted → today's error; audit `CHECKIN_REGISTRATION` / `UNDO_CHECKIN_REGISTRATION` with details naming the guest (`Checked in guest <name> of <host>`); answer `{ id, guestId, checkedIn, checkedInAt }`.
  - CSV: new column `Gäste eingecheckt` (number) after the guest columns.

- [ ] **Step 1: Write the failing tests** in `test/guestCheckinServer.test.js` (plant before start: a running event with check-in code `123456`, an accepted registration of `member` with guest `newbie`, a pending registration of `raider` with guest `admin`):
  - `a guest sees status and own check-in, nothing else` — newbie → exactly the keys `registered, asGuest, id, status, checkedIn, checkedInAt`.
  - `a guest of an accepted registration checks in with the code` — 200 `{ success: true }`, then my-registration `checkedIn: true`.
  - `a guest of a pending registration is refused` — the `admin` persona (guest of raider's pending registration) posts the right code → 400 „Keine akzeptierte Anmeldung gefunden.“, nothing stored.
  - `the admin check-in box counts persons` — stats `total: 2` (member + newbie), `checkedIn` follows.
  - `an admin ticks a guest off and back` — PUT with `guestId` → `checkedIn: true`; an unknown `guestId` → 400 with the German text; the audit log has the entry.
  - Update `a guest sees only status and id of the registration that invited them` in `test/devServer.test.js` to the new key set (`checkedIn: false, checkedInAt: null`).
- [ ] **Step 2: Run** `node --test test/guestCheckinServer.test.js test/devServer.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the four route changes.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Wiki + commit.** `docs/wiki/reference/api-index.md` (PUT body `guestId`), `docs/wiki/concepts/registration-flow.md` (`## Guests`: my-registration shape, check-in), `docs/wiki/ops/testing.md` (new file). Commit `Answer guests' check-in state and let admins tick guests off`.

### Task 5: Event page for guests

**Files:**
- Modify: `public/js/events/detail.js:405-418`, `public/js/events/checkin.js:55-90`
- Create: `test/guestViews.test.js` (pattern of `test/waitlistPositionViews.test.js`)

**Interfaces:**
- Consumes: my-registration guest shape (Task 4).

- [ ] **Step 1: Write the failing tests:**
  - `the guest label follows the real status` — for `pending`, `accepted`, `waitlisted`, `offered` → `Ausstehend (Gast)`, `Angenommen (Gast)`, `Warteliste (Gast)`, `Platz angeboten (Gast)`; class `text-warning` / `text-success` / `text-info` as today; a waitlisted guest with a `waitlistPosition` still shows `Warteliste (Gast)`.
  - `an accepted guest gets the code field while check-in is on` — event `checkinEnabled: true`, guest `accepted`, `checkedIn: false` → `checkin-code-input` exists.
  - `a checked-in guest sees the done state, a pending guest no code field`.
- [ ] **Step 2: Run** `node --test test/guestViews.test.js` — Expected: FAIL (`Angenommen (Gast)` for every status).
- [ ] **Step 3: Implement:** label `${statusTexts[status] || status} (Gast)` for `asGuest`; `renderCheckinSection` needs no guest branch beyond reading `checkedIn` (verify).
- [ ] **Step 4: Run** `node --test test/guestViews.test.js test/waitlistPositionViews.test.js test/eventPage.test.js` — Expected: PASS.
- [ ] **Step 5: Wiki + commit.** `docs/wiki/modules/frontend-app.md` if it documents the status line; remove the #110 entry from `docs/wiki/reference/known-issues.md` if listed. Commit `Show guests the real status of their invitation`.

### Task 6: Guests in the registrations dialog

**Files:**
- Modify: `public/js/admin/registrations.js:55-75` (guest cell), `:245-280` (`checkinToggle`, `toggleRegCheckin`)
- Test: `test/adminRegistrations.test.js`

**Interfaces:**
- Consumes: PUT `{ checkedIn, guestId }` (Task 4); the admin registrations list returns raw registrations incl. `guests`, `pendingGuests`, `guestCheckins`.
- Produces: `toggleRegCheckin({ regId, guestId, checkedIn, eventId, eventTitle })` — `guestId` from `data-guest-id` (absent for the member).

- [ ] **Step 1: Write the failing tests:**
  - `guests are listed by name with their own check-in toggle` — accepted registration with guests `g1` (name „Greta“ in `pendingGuests`) and `g2` (no name → id), `guestCheckins.g1.checkedIn: true` → the row shows `Greta` and `g2` (escaped), two `toggleRegCheckin` targets with `data-guest-id`, `g1` pressed.
  - `guests of open requests get no toggle`.
  - `the guest toggle sends guestId` — click → request body `{ checkedIn: false, guestId: 'g1' }` with the CSRF token, then the list reloads.
- [ ] **Step 2: Run** `node --test test/adminRegistrations.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** with existing components (badge/chip, `btn` classes of `checkinToggle`); no new CSS unless tokens only.
- [ ] **Step 4: Run** the same plus `node --test test/frontendActions.test.js test/actionAttributes.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `List guests by name in the registrations dialog and tick them off`.

### Task 7: Guests in the numbers

**Files:**
- Modify: `utils/insights.js` (`eventRow`, `topMembers`, `buildInsights`), `utils/memberOverview.js` (`trackedEventIds`, `memberStats`, `buildMemberList`, `buildMemberHistory`, `memberBase`/`lastActivity` stay own), `utils/profileEvents.js` (`toProfileEntry` carries `asGuest`), `utils/eventUtils.js` (new loader), `routes/user.js` (`GET /profile`), `routes/admin.js:1761-1795` (member detail), `public/js/pages/profile-view.js`
- Test: `test/insights.test.js`, `test/memberOverview.test.js`, `test/profileEvents.test.js`, `test/profileView.test.js`, `test/guestCheckinServer.test.js`

**Interfaces:**
- Consumes: `toParticipations`, `participationsOf` (Task 1).
- Produces:
  - `loadUserParticipations(userId) -> Promise<Object[]>` in `utils/eventUtils.js`: own registrations + registrations with `guests` array-contains `userId`, as `participationsOf(…, userId)`.
  - `buildInsights` / `buildMemberList` keep their signatures and expand registrations internally; `eventRow` counts `accepted`, `checkedIn`, `noShows`, `attendanceRate` over participations, `placesTaken` over registrations (unchanged); category `registrations` stays registrations.
  - `memberStats(participations, …)`: `registrations` = own entries only (`!asGuest`), `attended`/`checkedIn`/`noShows` over all.
  - Profile entries: `asGuest: boolean`; the view marks them with a chip „Gast“ and renders no own-registration action for them.
  - Profile stats: `total` = own registrations; `accepted`, `checkedIn` and the badges Regular, Veteran, Legende, Perfect Attendance, Streak over participations; Newcomer, Early Bird over own registrations.

- [ ] **Step 1: Write the failing tests:**
  - insights: `a checked-in guest counts as a participant who came` — one accepted registration with two guests, host and one guest checked in → event row `accepted: 3, checkedIn: 2, noShows: 1, attendanceRate: 67`; `placesTaken: 3` unchanged; top members list the guest with `attended: 1, checkedIn: 1`.
  - insights: `an event counts as tracked when only a guest checked in`.
  - memberOverview: `a guest place counts as Teilnahme and Check-in, not as Anmeldung` — guest of an accepted, ended registration → `{ registrations: 0, attended: 1, checkedIn: 1, noShows: 0 }`; history entry `asGuest: true`.
  - profileEvents: `guest entries are marked`.
  - profileView: `a guest entry shows „Gast“ and no unregister action`.
  - server (`test/guestCheckinServer.test.js`): `the guest's profile counts the guest check-in` — after newbie's check-in, `/api/user/profile` stats `accepted: 1, checkedIn: 1, total: 0`, and `/api/admin/members/<newbie>` stats match.
- [ ] **Step 2: Run** `node --test test/insights.test.js test/memberOverview.test.js test/profileEvents.test.js test/profileView.test.js test/guestCheckinServer.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above. `GET /api/user/registrations` stays own registrations (not in the spec).
- [ ] **Step 4: Run** the same plus `node --test test/insightsView.test.js test/memberView.test.js test/memberRows.test.js` — Expected: PASS.
- [ ] **Step 5: Wiki + commit.** `docs/wiki/modules/utils.md` (insights, memberOverview, profileEvents rules), `docs/wiki/modules/routes-user.md` (profile numbers), `docs/wiki/modules/routes-admin.md` (member detail). `npm run wiki`, `npm test`, commit `Count guests as participants in evaluations, member overview and profile`.

### Task 8: Final check

- [ ] **Step 1:** `npm test` — Expected: 0 failures.
- [ ] **Step 2:** `npm run dev:reset` and `npm run dev:mock`; as `newbie` open „Workshop: Streaming-Setup“ → status „Ausstehend (Gast)“, no code field.
- [ ] **Step 3:** Grep that no response gained `checkinCode`: `node --test test/devServer.test.js` (existing secret checks) — Expected: PASS.
- [ ] **Step 4:** Push the branch and open the PR against `release/3.0` (German: Problem / Ursache / Änderung / Verifikation, `Closes #110`).
