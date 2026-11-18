# Tasks

## 1. iCalendar writer

- [ ] 1.1 Write `test/icalendar.test.js` first (node:test + node:assert/strict): `escapeText` escapes backslash, `;`, `,` and CR/LF; `foldLine` keeps every line at ≤ 75 octets, starts continuation lines with a space and never splits a UTF-8 character (umlauts, emoji in a title); `formatUtc` gives `YYYYMMDDTHHMMSSZ`; `buildCalendar` joins with CRLF, has the header lines of design decision 6, and a title containing `\nEND:VEVENT\nBEGIN:VEVENT` yields exactly one `BEGIN:VEVENT`. Verify the tests fail.
- [ ] 1.2 Implement `utils/icalendar.js` (no new dependency) and verify `node --test test/icalendar.test.js` passes.

## 2. Feed entries from participations

- [ ] 2.1 Add `hostUserName: registration.userName` to `guestParticipation` in `utils/participations.js`, test first in the existing participations tests (guest entry carries the host's name; own entries unchanged); verify `npm test` stays green.
- [ ] 2.2 Write `test/calendarFeed.test.js` first for `buildFeedEntries(participations, eventsById, now)`: accepted → `CONFIRMED` and plain title; pending/waitlisted/offered/tentative → `TENTATIVE` with „[Ausstehend]“/„[Warteliste]“/„[Nachrücken bestätigen]“/„[Vielleicht]“; cancelled event → `CANCELLED` and „[Abgesagt]“; rejected, missing event, draft, no start and start 40 days ago are left out while 29 days ago stays; missing or earlier end → start + 2 h; guest place says „Du bist Gast von <Name>.“; `uid` is `<eventId>@<host of BASE_URL>` and stays the same when the start moves; location text and event link (`buildEventUrl`) present. Verify the tests fail.
- [ ] 2.3 Implement `utils/calendarFeed.js` (pure, no database access) and verify `node --test test/calendarFeed.test.js` passes.

## 3. Subscription storage and links

- [ ] 3.1 Write tests first for `buildCalendarFeedUrls(token)` in `utils/eventUrl.js` (https and http `BASE_URL` → `url`, `webcal://` variant, Google link with the encoded webcal URL) and for the token helpers in `utils/calendarFeed.js` (`createFeedToken` gives 43 base64url characters and differs between calls; `isFeedToken` rejects other lengths and characters). Verify they fail, implement, verify they pass.
- [ ] 3.2 Implement `getFeedOf(userId)`, `saveNewFeed(userId)` (create or renew, `setDoc` on `calendarFeeds/<userId>`), `deleteFeed(userId)` and `findFeedByToken(token)` through `firebaseAdmin.js`; cover them with a test on a temporary SQLite file (`runNode` + `createTempDir` from `test/helpers.js`, as `test/seed.test.js` does): create, renew replaces the token, find by token, delete; verify the test passes.
- [ ] 3.3 Add `calendarFeeds` to `SEED_COLLECTIONS` in `dev/seed.js`, wipe it together with the `users` target in `DELETE /api/admin/reset` (`routes/admin.js`) and delete `calendarFeeds/<userId>` in the batch of `DELETE /api/user/account`; test first in `test/devServer.test.js` (a persona with a feed deletes the account → the link answers 404) and verify `npm run dev:reset` still runs.
- [ ] 3.4 Document the `calendarFeeds` collection (producer, fields, reset and account deletion) in `docs/wiki/concepts/data-model.md`.

## 4. Profile API

- [ ] 4.1 Write `test/devServer.test.js` cases first: `GET /api/user/calendar` without a session → 401, for a persona without a feed → `{ enabled: false }`; `POST` without CSRF → 403, with CSRF → `{ enabled: true, url, webcalUrl, googleUrl, createdAt }`; a second `POST` gives a new token; `DELETE` → `{ enabled: false }`; the member list, insights and member details of the admin persona never contain the token. Verify they fail.
- [ ] 4.2 Implement `GET/POST/DELETE /api/user/calendar` in `routes/user.js` (own try/catch per handler, German `{ error }` messages) and verify the tests of 4.1 pass.
- [ ] 4.3 Add the three endpoints to `docs/wiki/reference/api-index.md` and `docs/wiki/modules/routes-user.md`.

## 5. Public feed

- [ ] 5.1 Write tests first: `createCalendarLimiters()` in `test/rateLimits.test.js` (per-token budget 30 per 15 minutes, per-address 600, per-address skipped in mock mode); `test/devServer.test.js`: a client without cookies fetches the persona's link → 200, `text/calendar; charset=utf-8`, the persona's seeded events with the right marks; unknown token and malformed name → 404; renewed and deleted links → 404; maintenance mode on → still 200; fetching one link 31 times → 429 while another persona's link still answers; the request creates no session document. Verify they fail.
- [ ] 5.2 Extract the server name order of `/api/server-info` (`SERVER_NAME`, Discord guild name, „DEMS“) into a helper both use, guarded for a bot that is not ready; verify `test/serverNameCopy.test.js` and the server-info tests stay green.
- [ ] 5.3 Implement `routes/calendar.js` (`GET /calendar/:file`, headers of design decision 7, plain-text errors) and the limiters in `middleware/rateLimits.js`; mount it in `server.js` after the banner uploads and before the session middleware; verify the tests of 5.1 pass.
- [ ] 5.4 Document the feed: route and limiters in `docs/wiki/modules/server.md`, the secret link, the skipped privacy gate and the plain-text token decision in `docs/wiki/concepts/security.md`, the endpoint in `docs/wiki/reference/api-index.md`, and the Google-needs-public-HTTPS limitation in `docs/wiki/reference/known-issues.md` (pitfalls).

## 6. Profile UI

- [ ] 6.1 Write a frontend test first (`loadFrontendApp` from `test/helpers.js`, next to `test/profileView.test.js`): without a feed the block shows „Kalender-Abo einrichten“; with a feed it shows the link and the five actions; „Link erneuern“ and „Abo beenden“ ask through `showConfirmDialog` and only call the API after confirming; the link value is escaped. Verify it fails.
- [ ] 6.2 Add the „Kalender-Abo“ block to `#account-settings-card` in `public/index.html` (components from `public/css/components.css`, tokens only, no `style` attributes, start state `.is-hidden`) and the logic with `registerActions` in `public/js/pages/profile.js` (or `profile-calendar.js` if the module passes ~500 lines); verify the test of 6.1 passes and `npm test` (tokens, contrast, icon checks) stays green.
- [ ] 6.3 Add an e2e case to `e2e/profile.spec.js`: the member sets up the subscription, sees the link, fetches it with `page.request` and gets a calendar, renews it and the old link answers 404. Verify `npx playwright test e2e/profile.spec.js` passes on desktop and mobile.
- [ ] 6.4 Describe the block in `docs/wiki/modules/frontend-app.md` (profile module map).

## 7. Integration

- [ ] 7.1 Run `npm run wiki` and verify `npm run wiki:check` reports a valid, current graph.
- [ ] 7.2 Run `npm test` and `npm run test:e2e` and verify both are green.
- [ ] 7.3 Manual check: in dev mock mode subscribe to the link (`webcal://localhost:3000/...`) in Apple Calendar or Outlook, verify the marks and that a moved date updates the same entry after a refresh; note the result (and that Google needs a public HTTPS installation) in the PR description (Verifikation).

## Workflow follow-up

- Add a release note entry for the feature to `updates.json` on the next release branch.
- Archive the change with `/opsx:archive` once the PR is merged.
