# Proposal

## Why

Ticket **B-15** (#98, milestone M4 · Discord-Funktionen). When a place frees up, the oldest fitting waitlist entry moves up at once (accepted, or pending for manual approval) — even when that member can no longer come. The place then stays blocked until they notice and unregister, and the next member on the list misses it.

## What Changes

- **Offer instead of instant move-up:** with the bot center switch „Nachrücken bestätigen“ on (default), a freed place is **offered**: the registration gets the new status `offered` with a deadline, the place is held for it, and the member gets a DM with „Platz annehmen“, „Doch nicht“ and „Zum Event“. The event page shows the same two buttons with the deadline.
- **Confirm** within the deadline → the member moves up exactly as today (accepted, or pending for events with manual approval; role, channel access, welcome DM, approval request).
- **„Doch nicht“ or no answer in time** → the registration is removed (the member is unregistered, DM „Dein Platz ist verfallen.“ on expiry) and the next waitlist entry gets the offer.
- **Deadline:** bot center setting „Bestätigungsfrist“ in hours (default 12, 1–72), never later than 1 h before the event start. When the start is less than 1 h away (or the switch is off), members move up at once as today.
- **Status everywhere:** „⏳ Platz angeboten – bestätigen bis <Zeit>“ on the event page, profile, `/meine-events`, `/event info`; „Angeboten“ with the deadline in the admin registrations dialog. Admins can still accept or reject an offered registration directly.
- **Expiry pass:** a scheduler (every 5 minutes, after the bot start) removes expired offers and hands the place on.

Out of scope: a second reminder before the deadline, offers for guest invitations, moving an expired member to the end of the list instead of removing them (decided: removed).

## Capabilities

### New Capabilities
- `waitlist-offers`: offering a freed place with a confirmation deadline — when it applies, how members confirm or decline (Discord and web), expiry, display and settings.

### Modified Capabilities
_None._ (The move-up rules of the registration flow are described in the wiki; no existing spec covers the promotion itself. `waitlist-position` stays valid: offered registrations are no longer on the waitlist.)

## Impact

- Code:
  - Data and rules: `utils/capacity.js` (`offered` occupies a place), `utils/eventUtils.js` (`promoteFromWaitlistLocked` / `announcePromotions` offer when the switch applies), new `utils/waitlistOffers.js` (`offerDeadline`, `confirmOffer`, `declineOffer`, `expireOffers`, scheduler), `utils/botSettings.js` (`waitlistConfirmation`, `waitlistConfirmHours`), `utils/registrationStatus.js` / `utils/bulkRegistrations.js` (admin actions on `offered`), `utils/profileEvents.js`, `utils/eventListing.js` (`myRegistrationStatus`).
  - Discord: new bot area module `bot/waitlistOffers.js` (offer DM with buttons `offer_confirm:<registrationId>` / `offer_decline:<registrationId>`, button handler), exported helper `sendWaitlistOffer` through `bot.js` with a mock twin; status texts in `bot/myEvents.js`, `bot/infoCommands.js`, `bot/interactions.js` routing.
  - Routes: `routes/events.js` (`POST /api/events/:id/offer/confirm|decline`, `my-registration` answers the offer), `routes/admin.js` (bot settings), `server.js` (scheduler start/stop).
  - Frontend: event page offer card (`public/js/events/detail.js` + markup), admin registrations status, profile, bot center switch and hours (`public/js/admin/bot-control.js` + markup).
- Data: registrations get status `offered` and `offer: { offeredAt, expiresAt }`; bot settings get `waitlistConfirmation` (default true) and `waitlistConfirmHours` (default 12).
- No new env variable or dependency.
- Tests: new `test/waitlistOffers.test.js`, `test/waitlistOfferButtons.test.js`; `test/devServer.test.js`; capacity/slot tests; frontend tests for the offer card and the bot center; seed test.
- Wiki: `docs/wiki/concepts/registration-flow.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/modules/bot.md`, `docs/wiki/modules/routes-events.md`, `docs/wiki/concepts/reminders-presence.md` (scheduler), `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/utils.md`, `docs/wiki/index.md`.
