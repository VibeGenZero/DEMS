# Proposal

## Why

Members see their events only inside DEMS (profile, event overview, Discord DMs). Anyone who plans their week in Google, Apple or Outlook Calendar has to copy every date by hand, and a moved start or a cancelled event never reaches their calendar. A personal calendar subscription (iCalendar feed) puts every event a member is registered for into their own calendar app and keeps it up to date there.

## What Changes

- A member can set up a personal calendar subscription in the profile settings („Kalender-Abo“): DEMS creates a secret, random feed link for them.
- The feed (`GET /calendar/<token>.ics`, no session needed, so calendar apps can fetch it) answers an iCalendar file (RFC 5545) with the events the member takes part in: own registrations and guest places on another member's registration.
- Confirmed places (`accepted`) appear as normal entries. Open answers appear marked in the title and as `STATUS:TENTATIVE`: „[Ausstehend]“ (pending), „[Warteliste]“ (waitlisted), „[Nachrücken bestätigen]“ (offered), „[Vielleicht]“ (tentative). Rejected registrations, drafts, deleted events and events without a start never appear. A cancelled event stays in the feed as `STATUS:CANCELLED`, so calendar apps strike it through instead of keeping a stale date.
- Each entry carries title, start, end (start + 2 h without an end, the rule of `isEventOver`), location text, the member's status, the inviting member for guest places and the link to the event page (`buildEventUrl`).
- The profile shows the link with „Kopieren“, „In Google Kalender öffnen“, „In Apple/Outlook abonnieren“ (`webcal://`), „Link erneuern“ (the old link stops working at once) and „Abo beenden“.
- The feed has its own rate limit per link, outside the general `/api` limit (calendar services such as Google fetch every subscription from a few shared addresses).
- Deleting the account (`DELETE /api/user/account`) also deletes the subscription.

Out of scope: a public feed of all events, a Discord command for the link, choosing which statuses appear (the member gets all of the above), event descriptions in the feed.

## Capabilities

### New Capabilities
- `calendar-subscription`: a member's personal, revocable iCalendar feed of the events they take part in — setting it up, renewing and ending it, what the feed contains and how it marks open answers and cancellations, and who can read it.

### Modified Capabilities

None. Account deletion already removes all of a member's data; the subscription is covered by a requirement of the new capability.

## Impact

- **New code:** `utils/icalendar.js` (iCalendar text: escaping, line folding, CRLF; no new dependency), `utils/calendarFeed.js` (participations → feed entries, token handling), `routes/calendar.js` (public feed), endpoints `GET/POST/DELETE /api/user/calendar` in `routes/user.js`.
- **Changed code:** `server.js` (mount `/calendar` with its own limiter before the SPA fallback), `routes/user.js` (`DELETE /account`), `dev/seed.js` (`SEED_COLLECTIONS`), profile settings card in `public/index.html` and `public/js/pages/profile.js`.
- **Data:** new collection `calendarFeeds` (one document per member).
- **No new dependencies, no new environment variables.** Links use `BASE_URL` as event links do today; Google Calendar can only subscribe to a feed reachable over public HTTPS.
- **Wiki nodes:** `docs/wiki/modules/routes-user.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/concepts/security.md`, `docs/wiki/modules/server.md`, `docs/wiki/modules/frontend-app.md`.
- **Ticket:** none yet.
