# Spec Delta

## Purpose

Lets a member subscribe to the events they take part in from their own calendar app (Google, Apple, Outlook) through a personal, secret and revocable iCalendar link, so dates, changes and cancellations reach their calendar without copying them by hand.

## ADDED Requirements

### Requirement: Member sets up a personal subscription
A logged-in member SHALL be able to set up a calendar subscription in the profile. DEMS SHALL then create a feed link that contains a random secret of at least 128 bits and belongs to this member only. A member SHALL have at most one subscription; until they set one up, they SHALL have none.

#### Scenario: First setup
- **WHEN** a member without a subscription chooses „Kalender-Abo einrichten“
- **THEN** the profile shows their feed link, and fetching it answers their calendar

#### Scenario: No subscription by default
- **WHEN** a member who never set one up opens the profile
- **THEN** the profile offers „Kalender-Abo einrichten“ and shows no link

#### Scenario: Visitor without session
- **WHEN** a request without a logged-in session asks for, creates or ends a subscription
- **THEN** it gets HTTP 401 and no subscription changes

### Requirement: Link stays visible to its owner only
The profile SHALL show the member's current feed link again on every visit, together with a `webcal://` variant and a Google Calendar subscribe link. No other response of DEMS SHALL contain a member's feed secret, including the member overview, insights and member details for admins.

#### Scenario: Link shown again
- **WHEN** a member with a subscription opens the profile on another day
- **THEN** the profile shows the same link as before

#### Scenario: Admins do not see the secret
- **WHEN** an admin loads the member list, the insights or the details of a member who has a subscription
- **THEN** no answer contains that member's feed secret

### Requirement: Renewing replaces the link
A member SHALL be able to renew the link („Link erneuern“). Renewing SHALL create a new secret and the old link SHALL stop working at once. The profile SHALL ask for confirmation before renewing, because subscribed calendar apps stop updating until the new link is added.

#### Scenario: Old link dead after renewing
- **WHEN** a member renews the link
- **THEN** the old link answers HTTP 404 and the new link answers their calendar

### Requirement: Ending the subscription
A member SHALL be able to end the subscription („Abo beenden“). Afterwards the link SHALL answer HTTP 404 and the profile SHALL offer to set up a new one. Deleting the account SHALL end the subscription as well.

#### Scenario: Ended subscription
- **WHEN** a member ends the subscription
- **THEN** the former link answers HTTP 404 and the profile offers „Kalender-Abo einrichten“

#### Scenario: Account deleted
- **WHEN** a member with a subscription deletes the account
- **THEN** the former link answers HTTP 404

### Requirement: Feed is readable without a session
The feed link SHALL answer without a session cookie and without a CSRF token, so calendar apps can fetch it. It SHALL answer a valid iCalendar file (RFC 5545) with content type `text/calendar` and UTF-8 text. An unknown or malformed secret SHALL answer HTTP 404 without telling whether a subscription ever existed. Maintenance mode SHALL NOT stop the feed.

#### Scenario: Calendar app fetches the feed
- **WHEN** a client without cookies requests a valid feed link
- **THEN** it gets HTTP 200, content type `text/calendar; charset=utf-8` and a `VCALENDAR` with the member's entries

#### Scenario: Unknown secret
- **WHEN** a client requests a feed link with a secret that belongs to nobody
- **THEN** it gets HTTP 404

#### Scenario: Maintenance mode
- **WHEN** maintenance mode is on and a calendar app fetches a valid link
- **THEN** it gets the member's calendar as usual

### Requirement: Feed has its own rate limit
Feed requests SHALL NOT count against the general API limit per address. Each feed link SHALL have its own limit; a link fetched more often than its limit allows SHALL answer HTTP 429 until the window ends, and other links SHALL keep working.

#### Scenario: Many subscriptions from one address
- **WHEN** a calendar service fetches the links of many members from one address within 15 minutes
- **THEN** every link answers its calendar

#### Scenario: One link fetched too often
- **WHEN** one link is fetched more often than its limit within the window
- **THEN** further fetches of that link answer HTTP 429 while other links still answer

### Requirement: Feed lists the member's participations
The feed SHALL contain one entry per event the member takes part in: their own registration or a guest place on another member's registration. It SHALL leave out rejected registrations, events that are deleted, drafts, events without a start and events that started more than 30 days ago.

#### Scenario: Own registration and guest place
- **WHEN** a member is accepted for one event and the accepted guest of another member at a second event
- **THEN** the feed contains both events once each

#### Scenario: Left out
- **WHEN** a member has a rejected registration, a registration for a draft, one for an event without a start and one for an event that started 40 days ago
- **THEN** none of these events is in the feed

#### Scenario: Unregistering removes the entry
- **WHEN** a member unregisters from an event and the calendar app fetches the feed again
- **THEN** that event is no longer in the feed

### Requirement: Entry content
Each entry SHALL carry the event title, the start, the end (start plus 2 hours when the event has no end), the location text when there is one, and the link to the event page. Its description SHALL name the member's status, and for a guest place the inviting member. An entry SHALL keep a stable identifier per event, so a moved date updates the existing calendar entry instead of adding a second one. Times SHALL be written in UTC.

#### Scenario: Event without an end
- **WHEN** an event starts at 18:00 UTC and has no end
- **THEN** its entry ends at 20:00 UTC

#### Scenario: Date moved
- **WHEN** an admin moves the start of an event and the calendar app fetches the feed again
- **THEN** the entry keeps its identifier and shows the new start

#### Scenario: Guest place
- **WHEN** a member is a guest of „Chiara“ at an event
- **THEN** the entry's description says that they are Chiara's guest

### Requirement: Open answers are marked
An accepted place SHALL appear as a confirmed entry with the plain event title. Every other status SHALL appear as a tentative entry whose title starts with its German mark: „[Ausstehend]“ for pending, „[Warteliste]“ for waitlisted, „[Nachrücken bestätigen]“ for a waitlist offer and „[Vielleicht]“ for the bench. A guest place SHALL take the status of the registration it belongs to.

#### Scenario: Waitlisted
- **WHEN** a member is on the waitlist of „Raid: Schattenfestung“
- **THEN** the entry is tentative and titled „[Warteliste] Raid: Schattenfestung“

#### Scenario: Moved up
- **WHEN** the waitlisted member moves up and is accepted, and the calendar app fetches the feed again
- **THEN** the same entry is confirmed and titled „Raid: Schattenfestung“

### Requirement: Cancelled events stay as cancelled
A cancelled event the member takes part in SHALL stay in the feed as a cancelled entry titled with „[Abgesagt]“, within the same 30-day window, so calendar apps show the cancellation instead of keeping the old date.

#### Scenario: Event cancelled
- **WHEN** an admin cancels an event the member is accepted for
- **THEN** the entry is marked cancelled and titled „[Abgesagt] <title>“

### Requirement: Feed text is safe
The feed SHALL escape commas, semicolons, backslashes and line breaks in every text value and fold long lines as RFC 5545 requires, without splitting a multi-byte character. Event text SHALL NOT be able to add properties or entries to the feed.

#### Scenario: Title with special characters
- **WHEN** an event title contains a comma, a semicolon and a line break followed by `END:VEVENT`
- **THEN** the feed shows the title as text in one entry and contains no extra entry
