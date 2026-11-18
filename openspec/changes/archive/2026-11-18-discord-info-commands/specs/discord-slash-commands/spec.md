# Spec Delta

## ADDED Requirements

### Requirement: Open polls on request
`/abstimmungen` (base name `/polls`) SHALL answer privately with the date polls that are open (status open, before their deadline) and in which the member may vote, soonest deadline first (polls without deadline last). Each entry SHALL show title, number of dates, deadline and whether the member already voted, with the buttons „Abstimmen“ (the vote flow of the posted poll message) and „Ansehen“ (link to the poll page).

#### Scenario: One open poll
- **WHEN** a member runs `/abstimmungen` while one poll with three dates is open until Friday 18:00 and they have not voted
- **THEN** they see its title, „3 Termine“, the deadline, „Noch nicht abgestimmt“, „Abstimmen“ and „Ansehen“

#### Scenario: Role-restricted poll
- **WHEN** an open poll requires a role the member does not have
- **THEN** it is not listed

#### Scenario: Closed or expired poll
- **WHEN** a poll is decided, closed or past its deadline
- **THEN** it is not listed

### Requirement: Poll list limits
The poll list SHALL show at most five polls; with more, a closing line SHALL name the number of further polls and link the poll overview. Without any open poll the answer SHALL say „📭 Gerade läuft keine Abstimmung.“ with the link to the poll overview.

#### Scenario: No open poll
- **WHEN** no poll is open
- **THEN** the member gets the note and the link privately

#### Scenario: Seven open polls
- **WHEN** seven polls are open for the member
- **THEN** five are listed and the closing line says „… und 2 weitere“

### Requirement: Event details on request
`/event info event:<event>` SHALL answer privately with the event in the layout of its announcement (banner, description, facts, line-up, registration or slot buttons while registration is open, „Zum Event“). The option SHALL autocomplete active events that are not over, next first, at most 25. Members without the admin role SHALL get „❌ Event nicht gefunden.“ for drafts, archived and unknown events.

#### Scenario: Open event
- **WHEN** a member asks for an active event with free places
- **THEN** they see its details with „Anmelden“ and „Zum Event“, visible only to them

#### Scenario: Draft
- **WHEN** a member without the admin role asks for a draft by its id
- **THEN** the answer is „❌ Event nicht gefunden.“

#### Scenario: Autocomplete
- **WHEN** a member types „raid“ into the option
- **THEN** active events not yet over whose title contains „raid“ are offered, the next one first

### Requirement: Own status in the event details
When the member has a registration for the event, the details SHALL add their status: „✅ Angemeldet“, „📋 Anfrage ausstehend“, „🕒 Warteliste – Platz N von M“ or „❌ Abgelehnt“, with the slot (or slot wish) for slot events.

#### Scenario: Waitlisted member
- **WHEN** a member on place 2 of 3 of the waitlist asks for the event
- **THEN** the details end with „Dein Status: 🕒 Warteliste – Platz 2 von 3“
