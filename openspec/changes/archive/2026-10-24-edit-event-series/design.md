# Design

## Context

- A series is created in one `POST /api/admin/events` with `recurring`, `recurringInterval` and `recurringUntil`: the inline `writeEvents` loop in `routes/admin.js` writes one event document per date with a shared `seriesId`. Weekly and biweekly dates step by a fixed number of milliseconds; monthly uses `setMonth` in server time. Every date stores the same `recurring*` fields.
- `PUT /api/admin/events/:id` saves one date through `saveEventWithSlots(id, rawSlots, buildUpdates)` (`utils/eventUtils.js`). It runs under the per-event lock, checks slots against that event's registrations (`validateSlotChange`), then `updateDoc`. After that the route handles channels, waitlist promotion, the announcement refresh, banner clean-up (`releaseBanners`) and the optional change DM (`describeEventChanges` + `notifyEventChange`, W-04). The update today writes the request's `recurring*` values onto the single date, which is how dates of one series can drift apart.
- The wizard (`public/js/admin/wizard.js`) loads the event through `GET /api/events/:id?status=all`, shows the "Wiederkehrendes Event" box with interval and "Wiederholen bis" for every edit, and sends the draft by PUT with `notifyParticipants` from `wizard-notify.js`.
- Times are ISO strings in UTC; users think in `TIMEZONE` (default `Europe/Berlin`). `utils/pollService.js` already formats wall-clock parts with `Intl.DateTimeFormat` in that zone.

## Goals / Non-Goals

**Goals:**
- One server-side code path for "save this date" that the series path calls once per date, so every per-date side effect (channels, waitlist promotion, announcement refresh, change DM) behaves exactly as a single edit.
- Wall-clock-correct start times across daylight saving changes for following dates and for dates created by an extension.
- The whole save is refused before any write when a slot check fails on one date.

**Non-Goals:**
- Changing the date step of series creation (weekly in fixed milliseconds) — existing series keep their stored dates.
- Turning a single event into a series, or detaching a date from its series.
- Shortening a series automatically, or changing a series' interval.
- Creating Discord channels for dates created by an extension (series creation does not do it either; the channels follow when a date is edited or published).
- A "whole series including past dates" scope.

## Decisions

### 1. Request shape: `applyTo` on the existing PUT
`PUT /api/admin/events/:id` takes `applyTo: 'this' | 'following'` (anything else → `this`). The answer adds `updatedDates` (number of following dates changed) and `createdDates` (number of dates created by an extension) next to `notifiedCount`.
*Alternative:* a new `PUT /events/series/:seriesId` — rejected, because the edited date is the anchor for "following" and its own save must keep all single-edit behaviour; a second endpoint would duplicate the whitelist (top trap 3 in CLAUDE.md).

### 2. New pure module `utils/eventSeries.js`
Pure, unit-testable helpers without database access:
- `followingDates(seriesEvents, edited, now)` — same `seriesId`, start after the edited date's old start, `!isEventOver`, status `draft` or `active`; sorted by start.
- `transferTime(targetStart, sourceStart, sourceEnd, deadlines, timeZone)` — returns `{ startDate, endDate, registrationDeadline, unregisterDeadline }` for a following date: the target's calendar day in `timeZone`, the source's wall-clock time, the source's duration and deadline offsets in milliseconds (empty stays empty).
- `nextSeriesStart(start, interval, timeZone)` — the next date in the rhythm, keeping the wall-clock time in `timeZone` (weekly +7 days, biweekly +14 days, else +1 month).
- `planExtension({ seriesEvents, interval, oldUntil, newUntil, timeZone })` — the start dates to create after the last date up to and including `newUntil` (compared as `YYYY-MM-DD` in `timeZone`), or `{ error }` when `newUntil < oldUntil`.
- `seriesUpdateFields(updates)` — the field whitelist that following dates take (see spec "Settings copied to the following dates"); keeps status, dates, `seriesId`, check-in fields, `createdAt`/`createdBy`, `sourcePollId` per date.
Wall-clock conversion uses `Intl.DateTimeFormat(…, { timeZone })` parts and a two-pass offset correction; no new dependency.
*Alternative:* reuse the creation loop — rejected, it is inline in the route and steps weekly dates in UTC milliseconds, which shifts the local time across a DST change.

### 3. Single-date save extracted into a helper
The body of today's PUT after the `saveEventWithSlots` call (audit `UPDATE_EVENT`, banner release, channels, `promoteFromWaitlist`, `notifyRegistrationsChanged`, change DM + `NOTIFY_EVENT_CHANGE`) moves into `applySavedEvent({ eventId, oldEvent, updates, notify, adminId })` inside `routes/admin.js`, returning `{ notified }`. The edited date and every following date go through it. The banner release runs once at the end over all replaced banner values, so a banner still used by another date is not deleted halfway (`releaseBanners` already checks every event).

### 4. Order of the series save
1. Load the edited date. Not part of a series, or `applyTo` is `this` and `recurringUntil` is not later → today's path unchanged (apart from keeping the stored `recurring*` fields, decision 6).
2. Run under `withEventLock('series:' + seriesId)` so two saves cannot extend the same series twice.
3. Load all dates of the series (`getDocs(collection(db,'events'))`, filter in memory). Check `recurringUntil` against the stored one → 400 when earlier.
4. With `following`: build the per-date updates (`seriesUpdateFields` + `transferTime` + `mergeReminderHours` and `keepDeadlineRefreshFlag` per date) and pre-check slots for every following date: `normalizeSlots(rawSlots, getSlots(old))` and `validateSlotChange` against `loadEventRegistrations(id)`. The first failure returns 400 `Termin <TT.MM.>: <slot message>` and nothing is written.
5. Save the edited date (`saveEventWithSlots`, as today), then each following date (`saveEventWithSlots` again, which repeats the slot check under the per-event lock). A failure at this point (registration that arrived in between) stops the loop and answers 409 `Die Änderung wurde bis zum <TT.MM.> übernommen; der Termin <TT.MM.> hat inzwischen Anmeldungen in einem entfernten Slot.` — the dates before stay saved.
6. Run `applySavedEvent` per saved date; sum `notified`.
7. Extension (either scope): `planExtension`, then `addDoc` per new start with a copy of the template date (latest `draft`/`active` date after step 5, else the edited date) and per-instance fields reset as in `POST /events/:id/duplicate` (`checkinCode: ''`, `checkinEnabled: false`, `eventStartNotificationSent: false`, `registrationClosedRefreshed: false`, reminders unsent, new `createdAt`/`createdBy`); then `updateDoc` `recurringUntil` on every date.
8. Audit entries: `UPDATE_SERIES` ("Applied changes of "<title>" to n following dates"), `EXTEND_SERIES` ("Extended series "<title>" to YYYY-MM-DD: n new dates"), both with the edited date as target.
*Alternative:* write all dates in one `writeBatch` — rejected, the per-event lock and the side effects (waitlist promotion, DMs) are per date and `saveEventWithSlots` is the established guard.

### 5. Wizard
- `editEvent` remembers `event.seriesId`; when set, it loads `GET /api/events/series/:seriesId` (admins see drafts there) and counts following dates with the same rule as the server (a small pure twin in `wizard-checks.js` or a shared helper exported for the unit test).
- Last step: a radio group "Nur dieser Termin" / "Dieser und alle folgenden Termine (n)" next to "Speichern", shown only when n > 0; markup in `public/index.html` with `.is-hidden`, shown with `toggleElement`; built from existing form components, no new CSS tokens.
- For a series date the "Wiederkehrendes Event" switch and the interval select are disabled; "Wiederholen bis" gets `min` = stored value and a hint "Ein späteres Datum legt neue Termine an." `checkWizardStep(2)` reports an earlier date with the same German text as the server.
- `saveEvent` sends `applyTo`; the toast uses `updatedDates` and `createdDates`: "Event und n folgende Termine aktualisiert!" plus " – x Teilnehmer benachrichtigt." and, when dates were created, "k neue Termine angelegt."
- The notification switch logic (W-04) stays unchanged: it compares the edited date with its loaded values.

### 6. Series fields are no longer taken from the request on edit
For a date with `seriesId`, PUT keeps `recurring: true` and the stored `recurringInterval`; `recurringUntil` only changes through the extension (step 7). For a date without `seriesId`, PUT keeps today's behaviour.

## Risks / Trade-offs

- [Partial save when a registration lands in a removed slot between pre-check and write] → pre-check before any write, re-check under the per-event lock, clear 409 message naming the last saved date; the window is milliseconds.
- [Many DMs for a member in several dates] → accepted by the user (one DM per date, matches the W-04 content per date).
- [DST conversion bugs] → pure helper with unit tests around the last Sunday of March and October in `Europe/Berlin`.
- [Following dates computed differently in wizard and server] → the server decides; the wizard number is only the label, and the answer's `updatedDates` drives the toast.
- [Whole `events` collection read for a series] → same pattern as `DELETE /events/series/:seriesId`; series are small.

## Migration Plan

No data migration. Existing series keep their stored dates and fields; a date whose `recurring*` fields drifted gets the series' stored interval of the edited date on the next series save. Rollback: revert the commit; documents written by this change have no new fields.
