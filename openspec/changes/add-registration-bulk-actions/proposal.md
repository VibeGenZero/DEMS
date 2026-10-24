# Proposal

Ticket: **W-08 Sammelaktionen für Anmeldungen** (GitLab work item 72, branch `72-w-08-sammelaktionen-fur-anmeldungen`, depends on D-07, which is done).

## Why

With manual approval, admins handle every registration on its own: one click and one reload of the dialog per member. For a raid with 30 requests that is 30 round trips. There is also no way to put someone on the waitlist by hand, although the API already allows it.

## What Changes

- The registrations dialog gets a checkbox column, "Alle auswählen" and an action bar ("3 ausgewählt · Annehmen · Warteliste · Ablehnen") that shows while something is selected.
- Selectable: pending, waitlisted and accepted registrations (rejected ones are not). Accept applies to pending and waitlisted, waitlist to pending and accepted, reject to all three. A selected registration the action does not apply to is skipped and counted.
- Accept fills the event up to its capacity in registration order (guests count). Whatever does not fit goes on the waitlist (or stays there), and the answer says how many. On slot events each registration gets its wanted or fallback slot while one is free, otherwise the waitlist.
- Every member gets the same DM as with the single actions: accepted (plus the event role), rejected, and the waitlist DM for anyone put on the waitlist (which respects the member's W-16 "Warteliste" choice). After rejections the waitlist moves up as today.
- Reject asks for confirmation with the number of registrations; accept and waitlist run at once. Afterwards a German toast sums up the result, and the dialog, the admin table and the stats reload once.
- New admin endpoint `POST /api/admin/events/:id/registrations/bulk` that changes all selected registrations of one event under one event lock and writes one audit entry.

No breaking change: the single actions and `PUT /api/admin/registrations/:id/status` stay as they are.

## Capabilities

### New Capabilities
- `registration-bulk-actions`: selecting several registrations of an event and accepting, waitlisting or rejecting them together, with the capacity and slot rules, notifications, confirmation and result summary.

### Modified Capabilities
- none (`dm-preferences` already covers the waitlist DM: its "Warteliste" choice governs every DM that puts a registration on the waitlist, and the accepted/rejected DMs stay always on).

## Impact

- Code: `routes/admin.js` (new route; the DM part of `PUT /registrations/:id/status` moves into a shared helper), new pure planner `utils/bulkRegistrations.js` (which registration ends in which status and slot), `utils/registrationService.js` (shared status-notification helper next to `notifyRegistration`), frontend `public/js/admin/registrations.js` and a new `public/js/admin/registration-bulk.js`, `public/index.html` (checkbox column, action bar), styles from existing tokens/components.
- API: new `POST /api/admin/events/:id/registrations/bulk`.
- Discord: no new Discord call; uses `sendDM` and `assignRole` as the single actions do.
- Dependencies: none.
- Wiki nodes: `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/concepts/registration-flow.md`, `docs/wiki/modules/utils.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`.
