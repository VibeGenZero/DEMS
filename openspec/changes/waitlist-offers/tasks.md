# Tasks

## 1. Status and settings

- [x] 1.1 Tests first (RED): `offered` counts as occupying in `countOccupiedPlaces`, `summarizePlaces`, slot occupancy and both promotion pickers, and is left out of `waitlistPositions` (capacity/slot tests); `normalizeBotSettings` gives `waitlistConfirmation: true` and `waitlistConfirmHours: 12` by default, keeps 1–72 and resets other values; `PUT /api/admin/bot/settings` refuses 0 and 73 with „Die Bestätigungsfrist muss zwischen 1 und 72 Stunden liegen.“ (devServer). Implement design 1 and the settings part of design 5; verify green.

## 2. Offers

- [x] 2.1 Tests first (RED) in the new `test/waitlistOffers.test.js` (mock mode, own SQLite): `offerDeadline` (12 h, capped at start − 1 h, null under 1 h, switch off, no start); a freed place on a full event makes the first waitlisted entry `offered` with `offer.expiresAt` and the slot on slot events, logs the mock offer DM, and keeps the event full; with the switch off or close to the start the old instant move-up happens. Implement design 2 (incl. `sendWaitlistOffer` stub export in `bot.js` + mock twin, extend the pinned export lists); verify green and the existing promotion tests (`test/capacity*.test.js`, `test/devServer.test.js`) stay green.
- [x] 2.2 Tests first (RED): `confirmOffer` accepts (role/channels/welcome in the mock log) or makes pending with an approval request for manual events; refuses expired, not offered, foreign and missing; `declineOffer` deletes and offers the place to the next entry; `expireOffers` removes expired offers with the „verfallen“ DM and offers the next, leaves unexpired ones, deletes offers of cancelled events without DM; two parallel confirmations → one success. Implement design 3 (incl. `completePromotion` factored out of `announcePromotions`); verify green.
- [x] 2.3 Tests first (RED): the offer scheduler starts after `waitFor`, runs `expireOffers`, and a stop before the start prevents the run (pattern of `test/eventArchive.test.js`); `server.js` starts/stops it. Implement; verify green.

## 3. Discord

- [x] 3.1 Tests first (RED) in the new `test/waitlistOfferButtons.test.js` (mock mode, fake interactions): `buildOfferMessage` text with deadline and the three buttons; the real `sendWaitlistOffer` answers `false` while not ready (`test/botRealExports.test.js`); „Platz annehmen“ from the member accepts and leaves only „Zum Event“ with „✅ Du bist dabei!“; „Doch nicht“ removes and offers the next; a click after expiry answers „⌛ Das Angebot ist nicht mehr gültig.“; another user's click changes nothing. Implement `bot/waitlistOffers.js` and the routing (design 4); verify green and `test/botModules.test.js`.
- [x] 3.2 Tests first (RED): `/meine-events` and `/event info` show „⏳ Platz angeboten – bestätigen bis …“ for an offered registration (`formatStatus`). Implement; verify `test/myEventsCommand.test.js`, `test/infoCommands.test.js` green.

## 4. Web

- [x] 4.1 Tests first (RED) in `test/devServer.test.js`: `POST /api/events/:id/offer/confirm` and `/decline` as the offered persona (accepted / removed + next offered), 409 after expiry, 404 without registration, CSRF required; `my-registration` returns `status: 'offered'` and `offer.expiresAt`; admin status change and bulk accept on an offered registration clear the offer; profile entries carry the offered status. Implement the routes and design 6; verify green.
- [x] 4.2 Tests first (RED) with the frontend harness: the event page shows `#detail-offer` with the deadline and both buttons for an offered registration, hides the register/unregister areas, and the buttons call the routes with the CSRF token and reload; the profile and the admin registrations dialog show „Platz angeboten“ / „Angeboten · bis …“; the bot center loads and saves the switch and the hours. Implement markup (tokens/components, no inline styles, `.is-hidden` start state) and JS (design 5); verify green and the CSS/CSP checks of `npm test`.

## 5. Seed, wiki, verification

- [x] 5.1 Seed (design 7): Elif `offered` on the second training date (`SERIES_EVENT_IDS[1]`) with a deadline 6 h ahead; pin it in `test/seed.test.js` (registrations 38 → 39). Verify `node --test test/seed.test.js` and `npm run dev:reset`.
- [x] 5.2 Wiki: `docs/wiki/concepts/registration-flow.md` (state diagram, offers section), `docs/wiki/concepts/data-model.md` (`offered`, `offer`, settings), `docs/wiki/concepts/discord-integration.md`, `docs/wiki/modules/bot.md` (module, custom IDs, export count), `docs/wiki/modules/routes-events.md`, `docs/wiki/concepts/reminders-presence.md` (offer scheduler), `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/utils.md`, `docs/wiki/index.md` (file rows); run `npm run wiki` and verify `node --test test/wiki.test.js`.
- [x] 5.3 Run `npm test` and `npm run test:e2e` and verify both pass; in `npm run dev:mock` unregister an accepted member of the full event as admin and check the mock offer log; log in as the offered persona path where possible and confirm on the event page.

## Workflow follow-up

- PR from `98-b-15-nachrücken-mit-bestätigung` into `feature/m4-discord-funktionen` (German: Problem / Ursache / Änderung / Verifikation); note the test-server check (offer DM, confirm, decline, expiry after the period).
- Archive the change with `/opsx:archive` after review.
