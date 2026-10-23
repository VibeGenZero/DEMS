# member-overview Specification

## Purpose

Gives admins an overview of the community's members across all events: who they are, how often they register, attend, check in or stay away, and the complete participation history of one member.

## Requirements

### Requirement: Member overview is for admins only
The member list and a member's details SHALL require an admin session. A logged-in non-admin SHALL get HTTP 403 and a visitor without session HTTP 401, as every other admin endpoint. In the web app the navbar link "Mitglieder" SHALL be visible to admins only, and opening `#members` or `#member/<id>` without admin rights SHALL lead to the event overview.

#### Scenario: Member asks for the list
- **WHEN** a logged-in member without admin rights requests the member list
- **THEN** the server answers 403 and sends no member data

#### Scenario: Member opens the page by hash
- **WHEN** a member without admin rights opens `#members`
- **THEN** the app shows the event overview instead

#### Scenario: Admin sees the link
- **WHEN** an admin is logged in
- **THEN** the navbar shows "Mitglieder" between "Admin" and "Bot-Zentrale", and the admin dashboard header has a "Mitglieder" button that opens the same page

### Requirement: The list holds every stored member
The member list SHALL contain one entry per document of the `users` collection, including members who only ever used Discord, with Discord id, username, display name and avatar. Registrations of user ids without a `users` document SHALL NOT create an entry. The page SHALL show the number of members in its header.

#### Scenario: Discord-only member
- **WHEN** a member registered only through the Discord button and never logged into the website
- **THEN** they appear in the list with the name and avatar stored by the bot

#### Scenario: Header count
- **WHEN** the `users` collection holds 12 documents
- **THEN** the page header reads "12 Mitglieder"

### Requirement: Participation numbers per member
Each list entry SHALL carry: Anmeldungen = all registrations of the member, any status; Teilnahmen = accepted registrations of events that are over (ended or archived, not cancelled, not deleted); Check-ins = registrations marked checked in, by code or by an admin; No-Shows = accepted registrations of over events with attendance tracking that are not checked in.

#### Scenario: Mixed history
- **WHEN** a member has one pending registration for an upcoming event, two accepted registrations of ended events of which one is checked in, and one accepted registration of a cancelled event
- **THEN** the entry shows 4 Anmeldungen, 2 Teilnahmen, 1 Check-in

#### Scenario: Cancelled and deleted events
- **WHEN** an accepted registration belongs to a cancelled event or to an event that no longer exists
- **THEN** it counts as Anmeldung but neither as Teilnahme nor as No-Show

### Requirement: No-shows count only where attendance was tracked
An over event SHALL count as tracked when check-in was enabled for it or at least one of its registrations is checked in. Only accepted, not checked-in registrations of tracked events SHALL count as No-Show; an event nobody checked in for SHALL produce no No-Shows.

#### Scenario: Event with check-in
- **WHEN** an ended event had check-in enabled and the member's accepted registration is not checked in
- **THEN** it counts as one No-Show

#### Scenario: Event without any check-in
- **WHEN** an ended event had check-in disabled and none of its registrations is checked in
- **THEN** its accepted registrations count as Teilnahmen and none as No-Show

### Requirement: Last activity
Each member SHALL carry a last activity time: the latest of the `users` document's `updatedAt` (last login or profile update) and the creation times of the member's registrations. Without any readable date the page SHALL show a dash.

#### Scenario: Registered after the last login
- **WHEN** a member last logged in on 1 October and registered through Discord on 5 October
- **THEN** the last activity is 5 October

### Requirement: Search the list
The page SHALL filter the list while the admin types, case-insensitively by display name, username or Discord id. An empty search SHALL show everybody; a search without hits SHALL show an empty state "Keine Mitglieder gefunden" with a way to clear the search.

#### Scenario: Search by username part
- **WHEN** the admin types "ann" and the members "Anna" (username `anna`) and "Bernd" exist
- **THEN** only Anna is listed

#### Scenario: No hit
- **WHEN** the admin types a text no member matches
- **THEN** the page shows "Keine Mitglieder gefunden" and a button that clears the search

### Requirement: Sort the list
The list SHALL be sorted by display name A–Z by default. The admin SHALL be able to sort by name, Anmeldungen, Teilnahmen, Check-ins, No-Shows and last activity; numbers and last activity SHALL sort highest or newest first, and a second choice of the same column SHALL reverse the order. Equal values SHALL keep name order.

#### Scenario: Most active first
- **WHEN** the admin sorts by Teilnahmen
- **THEN** the member with the most Teilnahmen is first, and members with equal Teilnahmen are ordered by name

### Requirement: Member details
Opening a member SHALL show `#member/<id>` with avatar, display name, username, Discord id, "Dabei seit" (creation time of the `users` document), last activity, whether guest invitations are allowed, the three DM choices (Erinnerungen, Änderungen, Warteliste; a missing choice counts as on) and the four numbers of the list. An unknown id SHALL get HTTP 404 "Mitglied nicht gefunden." and the page an empty state with a link back to the list.

#### Scenario: Member with DM choices
- **WHEN** an admin opens a member who switched off change DMs and guest invitations
- **THEN** the details show invitations "aus", reminders "an", changes "aus" and waitlist "an"

#### Scenario: Unknown member
- **WHEN** an admin opens `#member/123` and no `users` document has that id
- **THEN** the page says the member was not found and links back to "Mitglieder"

### Requirement: Complete participation history
The details SHALL list every registration of the member, newest event first; registrations without event date sort by registration time. Each row SHALL show event title, event date, status, check-in, No-Show mark, source ("Web", "Discord", "Admin") and the taken slot. A row SHALL link to the event when it still exists; a deleted event SHALL read "Gelöschtes Event" without link. Without registrations the page SHALL show an empty state.

#### Scenario: Deleted event
- **WHEN** an event the member was registered for was deleted
- **THEN** its row reads "Gelöschtes Event", has no link and still shows the registration status

#### Scenario: Admin entry with slot
- **WHEN** an admin entered the member into a slot event (W-06)
- **THEN** the row shows the source "Admin" and the slot name with its emoji

### Requirement: The overview exposes no secrets and changes nothing
The member endpoints SHALL be read-only, write no audit entry and change no data. They SHALL NOT return check-in codes, form answers, session data or guest lists of other members.

#### Scenario: Event with check-in code
- **WHEN** a member's history contains an event with a generated check-in code
- **THEN** neither the list nor the details answer contains that code

#### Scenario: Registration with form answers
- **WHEN** a member answered the registration form of an event
- **THEN** the details answer contains no form answers
