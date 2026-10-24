# Design

## Context

- Single status changes go through `PUT /api/admin/registrations/:id/status` (`routes/admin.js`): under `withEventLock` it sets the status, clears `slotId` on waitlist/reject for slot events, clears the check-in when the status is no longer accepted, and on accept picks a slot with `resolveAcceptanceSlot` (which overbooks when nothing fits). Outside the lock it sends the accepted DM (template + slot line + `assignRole`) or the rejected DM, then `promoteFromWaitlist` after a rejection, then `notifyRegistrationsChanged` and one audit entry. It sends no DM for `waitlisted`, and it never checks the participant limit.
- The waitlist DM text and the `wantsDm(userId, 'waitlist')` check live in `notifyRegistration` in `utils/registrationService.js` (used when a registration lands on the waitlist).
- Capacity rules are pure in `utils/capacity.js` (`OCCUPYING_STATUSES` = pending + accepted, `placesOf` counts guests and open invitations, `byCreatedAt`) and `utils/slotService.js` (`countSlotOccupancy`, `pickSlot`, `hasFreePlace`).
- The dialog is `public/js/admin/registrations.js` (320 lines). It renders `#registrations-tbody` rows from `GET /api/admin/events/:id/registrations`; per row ✓/✗ only for pending/waitlisted. `showConfirmDialog(message, label, { danger })` exists in `core/ui.js`. Frontend tests use `loadFrontendApp` (`test/adminRegistrations.test.js`).

## Goals / Non-Goals

**Goals:**
- One request per bulk action, one event lock, one reload of the dialog.
- Capacity and slot decisions in a pure, unit-tested planner.
- The same DMs and side effects as the single actions, without copying the DM code.

**Non-Goals:**
- No change to the single actions or their endpoint (they still overbook on accept and send no waitlist DM).
- No bulk actions across several events, no bulk slot moves or check-ins.
- No removal of the event role or channel access when an accepted registration is waitlisted or rejected. The single reject does not do that either; see Risks.
- No new Discord helper; nothing changes in `bot.js` or `dev/mockBot.js`.

## Decisions

1. **Endpoint.** `POST /api/admin/events/:id/registrations/bulk` with body `{ ids: string[], action: 'accept' | 'waitlist' | 'reject' }`. It is a static sub-path of `/events/:id/registrations`, so it sits next to the other `/events/:id/...` routes, with its own `try/catch`. Validation: action in the list, `ids` an array of 1–200 strings (deduplicated) → else 400 „Ungültige Sammelaktion.“ / „Bitte 1 bis 200 Anmeldungen auswählen.“. Unknown event → 404 „Event nicht gefunden“. Answer: `{ accepted, waitlisted, rejected, full, skipped, results: [{ id, status, slotId }] }`, where `full` = selected for accept but put on or kept on the waitlist for lack of places (it is also counted in `waitlisted` when the status changed). The route is a POST because it changes many documents; `PUT /registrations/:id/status` stays the single path.
   *Alternative:* loop the existing PUT in the browser. Rejected: N reloads, N audit entries, and no shared capacity view (each accept would overbook).

2. **Pure planner `utils/bulkRegistrations.js`.** `planBulkAction({ action, ids, registrations, event })` → `{ changes: [{ id, from, to, slotId, clearCheckin }], skipped: [ids], full: [ids] }`. The rules:
   - `APPLIES = { accept: ['pending', 'waitlisted'], waitlist: ['pending', 'accepted'], reject: ['pending', 'waitlisted', 'accepted'] }`; selected ids that are missing from the event or have another status → `skipped`.
   - accept without slots: `base = countOccupiedPlaces(unselected)`, then selected fitting registrations sorted `byCreatedAt`; `maxParticipants > 0 && occupied + placesOf(reg) > max` → waitlisted (`full`), else accepted and `occupied += placesOf(reg)`. A pending registration that ends up waitlisted is a change; a waitlisted one that stays is in `full` but not in `changes`.
   - accept with slots: `occupancy = countSlotOccupancy(slots, unselected)`, same order, `pickSlot(slots, occupancy, preferredSlotId, altSlotIds)`; a hit → accepted into that slot and `occupancy[slot] += 1`; no hit → waitlisted with `slotId: null` (`full`). A pending registration whose current slot is still free gets it again through `pickSlot`, because its own place is not counted (it is selected).
   - waitlist/reject: `to` = action status, `slotId: null` on slot events, `clearCheckin` when it was checked in.
   *Why "unselected":* pending registrations already hold places (`OCCUPYING_STATUSES`). Counting the selection separately lets the planner decide the order inside the selection without counting a place twice.

3. **Write under one lock.** The route loads the event and `loadEventRegistrations(eventId)` inside `withEventLock(eventId, …)`, runs the planner on that fresh state and writes all changes with one `writeBatch` (`status`, `slotId` when set, `checkedIn: false, checkedInAt: null` when `clearCheckin`). Firestore batches allow 500 writes, so the 200-id limit stays far below.

4. **Notifications outside the lock, shared with the single route.** A new helper `notifyStatusChange({ registration, event, status, slot })` in `utils/registrationService.js` holds the DM code that `PUT /registrations/:id/status` has today (accepted: template or default text + slot line + `assignRole`; rejected: template or default text). It adds `waitlisted`: the waitlist DM from `notifyRegistration`, behind `wantsDm(userId, 'waitlist')`, factored into a small shared function so both places use one text. The single route calls the helper for accepted/rejected only, so its behaviour stays exactly as it is. The bulk route calls it for every change, one after another, each in its own `try/catch` so one failed DM does not stop the rest. Then `promoteFromWaitlist(eventId, event)` once when anything was rejected, `notifyRegistrationsChanged(eventId)` once, and `addAuditLog('BULK_UPDATE_REGISTRATIONS', admin, '<action>: 3 angenommen, 1 Warteliste, 0 übersprungen', eventId)`.

5. **Frontend module `public/js/admin/registration-bulk.js`.** It keeps the selection in a `Set` for the open dialog and exports pure helpers `BULK_ACTIONS` (applies-to map, the same as the server), `selectableStatus(status)`, `bulkSummary(result, action)` (German toast text: „3 angenommen.“, „2 angenommen, 1 auf die Warteliste (keine freien Plätze).“, „2 abgelehnt, 1 übersprungen.“) and the actions `toggleRegSelection`, `toggleAllRegSelection`, `runBulkAction`. `registrations.js` adds a first column with `<input type="checkbox" class="form-check-input" data-change="toggleRegSelection" data-reg-id data-status>` for selectable rows (escaped `data-*`), clears the selection on every `showRegistrations`, and calls `renderBulkBar()` after rendering. Header: a checkbox `#reg-select-all` (`data-change="toggleAllRegSelection"`, `aria-label="Alle auswählen"`). The colspans 8 → 9.

6. **Action bar markup.** Above the table in `#registrationsModal`: `<div id="reg-bulk-bar" class="reg-bulk-bar is-hidden">` with `<span id="reg-bulk-count">` and three buttons (`btn btn-sm btn-outline-success` „Annehmen“ `bi-check2-all`, `btn-outline-secondary` „Warteliste“ `bi-hourglass-split`, `btn-outline-danger` „Ablehnen“ `bi-x-lg`) with `data-click="runBulkAction" data-action="…"`. Shown with `toggleElement`. Its CSS block in `style.css` uses tokens only (spacing, radius, surface colour), no inline styles. While a request runs, the three buttons are disabled.

7. **Reject confirmation and result.** `runBulkAction('reject')` first calls `showConfirmDialog('<n> Anmeldungen ablehnen?', 'Ablehnen', { danger: true })` (for n = 1: „1 Anmeldung ablehnen?“). Accept and waitlist send at once. After a 200: toast with `bulkSummary` (`success` when nothing was skipped or full, otherwise `warning`), clear the selection, then `showRegistrations`, `loadAdminEvents`, `loadAdminStats` once — the same reload trio as `updateRegStatus`. Error → the `error` of the answer as a `danger` toast, the selection stays.

## Risks / Trade-offs

- [Accepting from the bulk bar respects the limit, the single ✓ still overbooks] → intended: the single action stays the explicit override. The toast says when places ran out, so the admin can still accept one by hand.
- [A rejected or waitlisted member keeps the event role and channel access] → it is already like this for the single reject. It is noted as a follow-up idea in the MR, not fixed here (it would change the single path too).
- [Many DMs in one request (up to 200) take time] → they run after the batch write, so the data is consistent at once. The answer waits for them, as with W-09's participant message. The 200 limit keeps it bounded.
- [The planner and the frontend `BULK_ACTIONS` map can drift] → one test asserts that the frontend map equals the server map (same pattern as the banner regex in W-12).
- [Selection is lost when the dialog reloads after a single ✓/✗] → acceptable; single actions reload the dialog anyway, and the selection is cleared on purpose after every reload so no stale id is sent.

## Migration Plan

No data migration; the endpoint and UI are additive. Rollback = revert; no stored field changes.
