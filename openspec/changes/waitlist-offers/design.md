# Design

## Context

- Move-up: `promoteFromWaitlist(eventId, event)` (`utils/eventUtils.js`) runs `promoteFromWaitlistLocked` under `withEventLock(eventId)` (pick via `pickCapacityPromotions` / `pickWaitlistPromotions`, write status `accepted`/`pending` + slot), then `announcePromotions` outside the lock (DM, welcome, role, channels, approval request, `notifyRegistrationsChanged`). It is called after unregistering, rejecting, admin status changes, bulk actions, guest declines, event saves and account deletion.
- Places: `OCCUPYING_STATUSES = ['pending', 'accepted']` (`utils/capacity.js`) drives `countOccupiedPlaces`, `summarizePlaces`, slot occupancy (`countSlotOccupancy`, `buildRoster`) and the promotion pickers; waitlist lists and positions filter `status === 'waitlisted'`.
- Bot center settings: `utils/botSettings.js` (`DEFAULT_BOT_SETTINGS`, `ON_BY_DEFAULT`, `normalizeBotSettings`), saved by `PUT /api/admin/bot/settings`, UI in `public/js/admin/bot-control.js`.
- Schedulers: archive scheduler pattern (`utils/eventArchive.js`: start after `whenBotSettled`, 5-minute interval, `unref`, stop in the graceful shutdown).

## Goals / Non-Goals

**Goals:**
- One new status that the counting code already understands through `OCCUPYING_STATUSES`; every confirm/decline/expiry runs under the event lock.
- The existing move-up side effects stay the single path after a confirmation.

**Non-Goals:**
- No change to how registrations enter the waitlist or to the waitlist order.

## Decisions

### 1. Status `offered` + `offer`

`status: 'offered'`, `offer: { offeredAt, expiresAt }`, `slotId` set like a promotion does (the held slot). `OCCUPYING_STATUSES` becomes `['pending', 'accepted', 'offered']` → counts, places, slot occupancy, pickers and "unregister promotes" all hold the place without further changes. Waitlist filters (`=== 'waitlisted'`) leave offered entries out → positions of the others move up by one. Leaving `offered` (confirm, admin decision) clears `offer` to `null`.

Alternative considered: keep `waitlisted` with an `offer` field. Rejected — every capacity function would need an extra condition, and an offered member would still show a waitlist position.

### 2. Offer or move up (`utils/waitlistOffers.js`)

- `offerDeadline(event, settings, now)` → `Date|null`: null when `waitlistConfirmation` is off, the event has no start, or `start - 1h <= now`; else `min(now + hours, start - 1h)`.
- `promoteFromWaitlistLocked` gets the bot settings (loaded before taking the lock) and writes, per pick, either today's status or `{ status: 'offered', offer, slotId }`. The returned promotion carries `status: 'offered'` and `expiresAt`.
- `announcePromotions` for `offered`: `require('../bot').sendWaitlistOffer(registrationId)` (always, regardless of the member's „Warteliste“ DM preference — moving up is always announced, W-16), then `notifyRegistrationsChanged`. No role, channels, welcome or approval request yet.

### 3. Confirm, decline, expire (`utils/waitlistOffers.js`)

- `confirmOffer({ registrationId, userId, now })` under `withEventLock(eventId)`: registration exists, belongs to `userId`, status `offered`, `expiresAt > now`, event not over → write `status: accepted|pending` (by `approvalMode`), `offer: null`. Outside the lock: the existing per-status side effects, factored out of `announcePromotions` into `completePromotion(eventId, event, promotion)` (accepted → welcome, role, channels; pending → approval request) plus `notifyRegistrationsChanged`. Answers `{ ok, status, event }` or `{ ok: false, code: 'expired'|'not_offered'|'not_yours'|'missing' }`.
- `declineOffer({ registrationId, userId })`: same checks (no deadline check) → delete the registration under the lock, then `promoteFromWaitlist` (the next entry gets an offer) and `notifyRegistrationsChanged`.
- `expireOffers({ now })`: all registrations with status `offered` and `offer.expiresAt <= now` → per event under the lock delete them (re-checked inside), DM „⌛ Dein Platz bei **<Titel>** ist verfallen – du bist nicht mehr angemeldet.“, then `promoteFromWaitlist`. Offers of events that are cancelled/archived/over are deleted without DM and without promotion.
- `startOfferScheduler({ waitFor })` / `stopOfferScheduler()` like the archive scheduler (first run after `whenBotSettled`, 5 minutes, `unref`); `server.js` starts and stops it.

### 4. Discord (`bot/waitlistOffers.js`)

- `buildOfferMessage(event, eventId, registrationId, expiresAt)`: classic DM text „🎉 Ein Platz bei **<Titel>** ist frei geworden! Bestätige ihn bis **<Zeit in TIMEZONE>**, sonst rückt der Nächste nach.“ + row „Platz annehmen“ (`offer_confirm:<registrationId>`, success), „Doch nicht“ (`offer_decline:<registrationId>`, secondary), „Zum Event“ (link `buildEventUrl`).
- `sendWaitlistOffer(registrationId)` (exported through `bot.js`; `if (!state.isReady) return false`, try/catch; mock twin logs „Platz angeboten: <user> für "<Titel>" bis <Zeit>“).
- `handleOfferButton(interaction, action, registrationId)`: `deferUpdate` → `confirmOffer`/`declineOffer` with `interaction.user.id` (lazy require of the util) → `editReply` keeps the text, adds the result line („✅ Du bist dabei!“ / „📋 Deine Anfrage wird jetzt geprüft.“ / „👋 Alles klar, dein Platz geht an den Nächsten.“ / „⌛ Das Angebot ist nicht mehr gültig.“) and leaves only „Zum Event“. Routed in `bot/interactions.js`.

### 5. Web

- `routes/events.js`: `POST /api/events/:id/offer/confirm` and `/offer/decline` (`requireAuth`, CSRF by the global middleware) → the own registration of the event → util; answers `{ success: true, status }` or 409 „Das Angebot ist nicht mehr gültig.“ / 404 „Keine Anmeldung gefunden.“. `my-registration` already spreads the registration (status + `offer`).
- Event page (`events/detail.js` + markup): `#detail-offer` card (hidden start state) with „Ein Platz ist frei! Bestätige bis <Zeit>.“ and the buttons `data-click="confirmOffer"` / `data-click="declineOffer"`; after an answer the page reloads its registration state. Status texts: profile (`pages/profile-view.js`), admin registrations („Angeboten · bis <Zeit>“ chip, existing accept/reject actions), bulk dialog (offered counts like waitlisted).
- Bot center: switch `#bot-waitlist-confirmation` and number `#bot-waitlist-confirm-hours` (1–72); `PUT /bot/settings` validates the hours (400 „Die Bestätigungsfrist muss zwischen 1 und 72 Stunden liegen.“).

### 6. Admin decisions and other paths

- `utils/registrationStatus.js`: `offered` may be accepted, rejected or waitlisted like `waitlisted`; any change clears `offer`.
- Bulk: accept/reject/waitlist treat `offered` like `waitlisted`.
- `myRegistrationStatus` / profile entries / `formatStatus` (`bot/myEvents.js`) get the offered text with the deadline.
- Participant message groups (`utils/participantMessage.js`): offered members belong to the waitlist group.

### 7. Seed

Elif gets an extra registration `offered` on the second training date (`SERIES_EVENT_IDS[1]`, 8 places, in 8 days) with a deadline 6 hours ahead, so the admin dialog and her profile show an open offer. (The full event `EVENT_ID.FULL` was the first idea; its numbers — 5 of 5, 3 waiting, Tom at place 3 of 3 — are pinned by many tests and e2e specs, so it stays unchanged.)

## Risks / Trade-offs

- [Many touch points for a new status] → each list of statuses is found by grep (`'waitlisted'`, `OCCUPYING_STATUSES`) and covered by tests in its task; unknown statuses in old UI code fall back to a neutral label.
- [Member never sees the DM (DMs closed)] → the event page shows the offer too; the deadline hands the place on anyway.
- [Server down during the deadline] → the first scheduler run after the start expires the offers (the run waits for the bot, so the DMs go out).
- [Two confirmations at once (web + Discord)] → the event lock and the status check let only the first one through.
