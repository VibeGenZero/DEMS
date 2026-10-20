# Tasks

## 1. Position helper and API

- [x] 1.1 Write failing unit tests in `test/capacity.test.js` for `waitlistPositions`: three waitlisted registrations with different `createdAt` get 1..3 of 3 (oldest first), non-waitlisted ones are absent, equal `createdAt` is ordered by id, no waitlisted → empty map. Verify they fail.
- [x] 1.2 Implement `waitlistPositions` in `utils/capacity.js` and export it. Verify 1.1 passes.
- [x] 1.3 Write failing server tests in `test/devServer.test.js` (seed event `EVENT_ID.FULL`: Elif, Greta, Tom waitlisted, Tom newest): the member persona's `my-registration` has `waitlistPosition { position: 3, total: 3 }`; an accepted registration (raider on the running event) has none; the profile entry of the full event has the same position and other entries `null` (update the key test to include `waitlistPosition`); the admin list marks the three waitlisted rows 1..3; after an admin accepts the oldest one, Tom is 2 of 2. Verify they fail.
- [x] 1.4 Implement in `routes/events.js` (`my-registration`), `utils/profileEvents.js` + `routes/user.js` (profile) and `routes/admin.js` (registrations list). Verify 1.3 passes and `node --test test/devServer.test.js test/profileEvents.test.js` is green.
- [x] 1.5 Update `docs/wiki/concepts/registration-flow.md` (waitlist position), `docs/wiki/modules/routes-events.md`, `docs/wiki/modules/routes-user.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/utils.md`; run `npm run wiki` and verify `test/wiki.test.js`.

## 2. Texts on the page, in the profile and in the admin dialog

- [x] 2.1 Write failing frontend tests (run with `node --experimental-vm-modules --test`): event page status "Platz 2 von 3 auf der Warteliste" and fallback "Warteliste" (`test/eventPage.test.js`); slot area text and hint (`renderOwnSlot`); profile chip "Warteliste · Platz 3 von 3" for upcoming and "Warteliste" in the history (`test/profileView.test.js`); admin dialog badge "Warteliste · Platz 2" (`test/adminRegistrations.test.js`). Verify they fail for the right reason.
- [x] 2.2 Implement in `public/js/events/detail.js`, `public/js/events/slots.js`, `public/js/pages/profile-view.js` (+ label override in `renderStatusChip` in `public/js/events/cards.js` if needed) and `public/js/admin/registrations.js`. Verify 2.1 passes and `test/cssRules.test.js`, `test/actionAttributes.test.js` stay green.
- [x] 2.3 Add an e2e check (`e2e/eventPage.spec.js` or `e2e/profile.spec.js`): the member persona sees "Platz 3 von 3 auf der Warteliste" on the full event and "Warteliste · Platz 3 von 3" in the profile. Verify with `npx playwright test` on that spec.
- [x] 2.4 Update `docs/wiki/modules/frontend-app.md` and `docs/wiki/ops/testing.md`; run `npm run wiki`.

## 3. Integration

- [x] 3.1 Browser check in mock mode on a scratch DB: member persona on the full event (page and profile), admin dialog of the full event, then the admin accepts the first waitlisted member and Tom's page shows "Platz 2 von 2".
- [x] 3.2 Run `npm test` and `npm run test:e2e` three times and verify everything is green.

## Workflow follow-up

- Commit planning and code separately, push, open the MR "W-05: Wartelisten-Position anzeigen" (text only, `Closes #69`).
- After the merge: `/opsx:archive` on a `chore/` branch from `origin/main` (also archives the open `add-admin-manual-registration` of W-06).
