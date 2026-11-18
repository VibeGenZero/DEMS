# Design

## Context

See proposal.md for the motivation and specs/calendar-subscription/spec.md for the required behaviour. The current state that shapes the approach:

- Event dates are UTC ISO strings (`toISOString()` in the wizard and the seed data), so the feed needs no time zone conversion.
- `loadUserParticipations(userId)` (`utils/eventUtils.js`) already returns a member's own registrations plus their guest places (`asGuest`, `hostUserId`, status of the host registration), one per event (`utils/participations.js` keeps the best place per event and person). The profile lists use it (#110).
- `server.js` runs session, CSRF, setup mode and privacy gate on the way to the routes. `/api/*` has a general limit of 200 requests per 15 minutes per address for visitors without a session (`middleware/rateLimits.js`). Calendar services such as Google fetch the subscriptions of all their users from a few shared addresses, so a feed below `/api` would hit that limit as soon as a community has a few dozen subscribers.
- Admin answers spread whole `users` documents internally (`routes/admin.js`, member list, insights, member details) and rely on mapping functions to pick fields. A secret stored on `users` would be one careless spread away from an answer.
- `DELETE /api/user/account` deletes the member's documents in one `writeBatch`. The admin system reset (`DELETE /api/admin/reset`) wipes collections from a fixed map.
- The SPA has no inline handlers; actions go through `data-click` + `registerActions`, confirmations through `showConfirmDialog` (`public/js/core/ui.js`).

## Goals / Non-Goals

**Goals:**
- A feed that Google, Apple and Outlook Calendar subscribe to without extra setup, built from data DEMS already loads for the profile.
- A secret that can only leak through the member themselves, and that the member can replace at any time.
- No session work, no database writes and no Discord calls per feed fetch.

**Non-Goals:**
- Pushing changes to calendars: subscriptions are polled by the calendar app (Google roughly every 8–24 h; DEMS cannot shorten that).
- Recurrence rules (`RRULE`): every series date is its own event document and becomes its own entry.
- Reminders (`VALARM`) in the feed; DEMS already sends reminder DMs.
- Tracking when a feed was last fetched.

## Decisions

### 1. Own collection `calendarFeeds`, document id = user id

`calendarFeeds/<userId>`: `{ userId, token, createdAt }`. The feed looks the token up with `query(collection(db, 'calendarFeeds'), where('token', '==', token))`; renewing overwrites the document (`setDoc`), ending deletes it.

- *Why not a field on `users`:* the admin answers spread `users` documents (see Context); a separate collection keeps the secret out of every existing code path and makes "who has a subscription" a single place to clean up.
- *Why not doc id = token:* renewing would need a delete plus a create, and finding a member's own feed would need a query; with the user id as key both are one `getDoc`/`setDoc`.
- Added to `SEED_COLLECTIONS` in `dev/seed.js`; no seed documents. The system reset wipes `calendarFeeds` together with the target `users` (a feed without its member makes no sense); `DELETE /account` adds `batch.delete(doc(db, 'calendarFeeds', userId))` to its batch.

### 2. Token stored in plain text, 32 random bytes, base64url

`crypto.randomBytes(32).toString('base64url')` (43 characters, 256 bits; the spec asks for at least 128). The token is compared as a string from a `where` clause, so timing leaks nothing usable at this length.

- *Alternative: store only a SHA-256 hash.* Safer against a leaked database, but the profile could then show the link only once and a member who lost it would have to renew it and re-subscribe every calendar. A leaked database already exposes far more than a member's event list, so the convenience wins. The token is checked against `^[A-Za-z0-9_-]{43}$` before any query, so malformed requests never reach the database.

### 3. Feed outside `/api`, mounted before the session middleware

`routes/calendar.js` handles `GET /calendar/:file` (`<token>.ics`; other names → 404) and is mounted in `server.js` right after the banner uploads, before `express.json`, the session middleware, CSRF, setup mode and the privacy gate.

- No session is read or written per fetch (`saveUninitialized: false` would already avoid the write, but this also skips the session lookup and the role refresh).
- CSRF does not apply (GET only) and the privacy gate is skipped on purpose: the feed is the member's own data for their own calendar, set up while they were logged in and consented; a new policy version is enforced the next time they use the website.
- Setup mode needs no special case: a fresh installation has no feeds, every link answers 404.
- Maintenance mode only guards logins and registrations (`middleware/maintenance.js`), so the feed keeps answering, as the spec requires.

### 4. Two limiters for the feed

`createCalendarLimiters()` in `middleware/rateLimits.js` with express-rate-limit (already a dependency):

- per token: 30 requests per 15 minutes (`keyGenerator` = the token from the path; calendar apps poll hourly at most);
- per address: 600 requests per 15 minutes as a scan brake (`ipKeyGenerator`), high enough for a calendar service fetching many members' links from one address.

Both answer 429 with a short German plain-text message. Constants, no new environment variables (the general limits have env overrides because admins hit them while working; nobody works against a feed). In dev mock mode the per-address limit is skipped (as the API limiter is); the per-token limit stays on, so the server tests can prove it.

### 5. Feed content: pure builder over participations

`utils/calendarFeed.js` exports pure functions; the route does the loading:

1. `loadUserParticipations(userId)`, then one `getDoc` per distinct event (the profile does the same; fine for the data sizes of a community).
2. `buildFeedEntries(participations, eventsById, now)`: drops `rejected`, missing events, `draft`, events without a parseable start and events whose start is more than 30 days before `now`; maps the rest to `{ uid, title, start, end, location, url, status, description }`.
3. Status mapping: `accepted` → `CONFIRMED`, plain title; `pending` → „[Ausstehend]“, `waitlisted` → „[Warteliste]“, `offered` → „[Nachrücken bestätigen]“, `tentative` → „[Vielleicht]“, all `TENTATIVE`; an event with `status: 'cancelled'` → `CANCELLED` and „[Abgesagt]“ whatever the registration status. Unknown statuses fall back to `TENTATIVE` without a mark.
4. End: `endDate` if parseable and after the start, else start + 2 h (the rule of `isEventOver`).
5. Description lines (German): „Status: Angemeldet“ / „Ausstehend“ / …, „Du bist Gast von <Name>.“ for guest places, then the event link. The event description is not included (Markdown would come out as raw syntax, and the link leads to the formatted page).
6. Guest places need the inviting member's name: `guestParticipation` (`utils/participations.js`) gets `hostUserName: registration.userName`, next to the existing `hostUserId`. Existing callers ignore the new field.
7. `UID`: `<eventId>@<host of BASE_URL>`, so a moved date updates the same entry. `LAST-MODIFIED` from `event.updatedAt` when present; `DTSTAMP` = now.

### 6. Own iCalendar writer, no library

`utils/icalendar.js`: `escapeText` (backslash, `;`, `,`, CR/LF → `\n`), `foldLine` (75 octets, split only between UTF-8 characters, continuation lines start with a space), `formatUtc` (`YYYYMMDDTHHMMSSZ`) and `buildCalendar({ name, entries })` joined with CRLF. Header: `VERSION:2.0`, `PRODID:-//DEMS//Kalender-Abo//DE`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`, `X-WR-CALNAME:<Servername> · Meine Events`, `X-WR-TIMEZONE:<getTimezone()>`, `REFRESH-INTERVAL;VALUE=DURATION:PT1H`, `X-PUBLISHED-TTL:PT1H`.

- *Alternative: the `ics` or `ical-generator` package.* Both work, but the subset needed here is about 80 lines and the project avoids dependencies without a clear reason. Escaping and folding get their own unit tests, including an injection attempt (`\nEND:VEVENT` in a title).
- The server name follows `/api/server-info`: `SERVER_NAME`, else the Discord guild name, else „DEMS“. That lookup moves into a small exported helper so both use the same order; in the feed it is read through `require('./bot')` and returns the neutral value when the bot is not ready.

### 7. Response headers

`Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: inline; filename="dems.ics"`, `Cache-Control: private, max-age=300`, `X-Robots-Tag: noindex`. Express's default ETag gives calendar apps `304 Not Modified` for unchanged feeds. Errors answer plain text (`404 Kalender nicht gefunden.`, `500 Kalender konnte nicht erstellt werden.`), not JSON, because calendar apps show the body.

### 8. API for the profile

In `routes/user.js` (all `requireAuth`, mutations need CSRF as every `/api` call):

- `GET /api/user/calendar` → `{ enabled: false }` or `{ enabled: true, url, webcalUrl, googleUrl, createdAt }`
- `POST /api/user/calendar` → creates or renews (new token every time), answers like `GET`
- `DELETE /api/user/calendar` → `{ enabled: false }`

`url` = `<BASE_URL>/calendar/<token>.ics`, `webcalUrl` = the same with `webcal://` instead of `https://`/`http://`, `googleUrl` = `https://calendar.google.com/calendar/r?cid=` + `encodeURIComponent(webcalUrl)`. Built by `buildCalendarFeedUrls(token)` next to `buildEventUrl` in `utils/eventUrl.js`. User mutations get no audit log entry (audit logs are for admin actions).

### 9. Profile UI

A block „Kalender-Abo“ in `#account-settings-card` (`public/index.html`), logic in `public/js/pages/profile.js` (273 lines; if it passes ~500, the block moves to `public/js/pages/profile-calendar.js`):

- without a feed: short text and button „Kalender-Abo einrichten“;
- with a feed: read-only input with the link, buttons „Kopieren“ (`navigator.clipboard`, toast), „In Google Kalender öffnen“ (link, `target="_blank" rel="noopener"`), „In Apple/Outlook abonnieren“ (`webcal://` link), „Link erneuern“ (`showConfirmDialog`: „Der alte Link funktioniert danach nicht mehr. Kalender, die ihn abonniert haben, musst du neu verbinden.“) and „Abo beenden“ (`showConfirmDialog`);
- hint: „Jeder mit diesem Link sieht deine Events. Teile ihn nicht.“ and „Kalender-Apps aktualisieren Abos meist nur alle paar Stunden.“

Built from existing components (buttons, card, `.is-hidden` + `toggleElement`), icons `bi-calendar-plus`, `bi-clipboard`, `bi-google`, `bi-arrow-repeat`, `bi-x-circle` (all in the vendored font; `test/vendorAssets.test.js` checks). No Discord changes, so no bot helper and no `dev/mockBot.js` twin.

## Risks / Trade-offs

- [A member shares the link, e.g. in a screenshot] → the hint in the profile, „Link erneuern“ kills the old link at once.
- [Google polls rarely, so a change shows up hours later] → the hint in the profile; the event page and DMs stay the source of truth.
- [Google cannot reach installations without public HTTPS (`localhost`, LAN, test setups)] → the Apple/Outlook link and the copy button still work locally; the wiki notes the limitation.
- [`BASE_URL` missing or wrong gives dead links] → same dependency as every event link today; the setup wizard already asks for it.
- [One `getDoc` per event per fetch] → bounded by the member's own registrations in a 30-day-back window; rate limit per token caps abuse.
- [Plain-text token in the database] → accepted trade-off, see decision 2.

## Migration Plan

No data migration: `calendarFeeds` starts empty and members opt in. Rollback: removing the route makes every link answer the SPA fallback (HTML, which calendar apps reject); the collection can stay or be dropped.
