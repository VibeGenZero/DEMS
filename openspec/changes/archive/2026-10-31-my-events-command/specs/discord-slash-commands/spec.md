# Spec Delta

## ADDED Requirements

### Requirement: /my-events lists the member's upcoming registrations
`/my-events` (German clients: `/meine-events`) SHALL answer privately with the member's registrations for events that are not over, cancelled or archived, next event first. Each entry SHALL show the event title, its start in German format and the configured time zone, the status and, for slot events, the slot.

#### Scenario: Member with two registrations
- **WHEN** a member registered for a raid on Friday and a game night on Saturday runs `/meine-events`
- **THEN** only they see an answer listing the raid first, then the game night, each with title, start and status

#### Scenario: Past and archived events are left out
- **WHEN** a member with a registration for a past event and one for an archived event runs `/meine-events`
- **THEN** neither event is listed

#### Scenario: German name
- **WHEN** a member whose Discord language is German types `/`
- **THEN** the bot offers `/meine-events`; other languages see `/my-events`

### Requirement: Status and slot of each entry
The status SHALL read "Angemeldet", "Anfrage ausstehend", "Warteliste – Platz N von M" or "Abgelehnt". For slot events the entry SHALL name the taken slot with its emoji; a pending or waitlisted registration without a slot SHALL name the wished main role as a wish.

#### Scenario: Waitlisted member
- **WHEN** the member is second of three on the waitlist of a full event
- **THEN** the entry reads "Warteliste – Platz 2 von 3"

#### Scenario: Slot taken
- **WHEN** the member is accepted as "Heiler" in a slot event
- **THEN** the entry names "💚 Heiler"

### Requirement: Empty and long lists
Without upcoming registrations the answer SHALL say so in German and link the event overview. The answer SHALL list at most five events; with more, a closing line SHALL name how many are not shown and link the profile page.

#### Scenario: No registrations
- **WHEN** a member without upcoming registrations runs `/meine-events`
- **THEN** the private answer says they are not registered for any upcoming event and links the event overview

#### Scenario: Seven registrations
- **WHEN** a member with seven upcoming registrations runs `/meine-events`
- **THEN** the next five events are listed and a closing line says "2 weitere" with the link to the profile page

### Requirement: Leaving from the overview asks first
Each entry SHALL carry „Abmelden“ while the member may still unregister and the registration is not rejected. A click SHALL answer privately „Wirklich von **<Titel>** abmelden?“ with „Ja, abmelden“ and „Abbrechen“. Only „Ja, abmelden“ SHALL unregister, with the same effects and messages as unregistering anywhere else; „Abbrechen“ SHALL change nothing.

#### Scenario: Confirmed
- **WHEN** the member clicks „Abmelden“ and then „Ja, abmelden“
- **THEN** the registration is deleted, the event role is removed, the waitlist moves up and the answer reads "✅ Du wurdest von **<Titel>** abgemeldet."

#### Scenario: Cancelled
- **WHEN** the member clicks „Abmelden“ and then „Abbrechen“
- **THEN** the registration stays and the answer says the unregistering was cancelled

#### Scenario: Unregister deadline passed
- **WHEN** the unregister deadline of the event has passed
- **THEN** the entry has no „Abmelden“ button

### Requirement: Switching the slot from the overview
An entry of a slot event SHALL carry „Slot wechseln“ while registration is open and the member holds a slot. A click SHALL answer privately with one button per other slot that has a free place („Zu <Slot> wechseln“); a click on one SHALL switch exactly like the switch button of the slot answer. Without a free other slot the answer SHALL say so.

#### Scenario: Free other slot
- **WHEN** a member holding "Tank" clicks „Slot wechseln“ while "Heiler" has a free place and "Schaden" is full
- **THEN** the answer offers only „Zu Heiler wechseln“, and clicking it moves the member to "Heiler"

#### Scenario: No free slot
- **WHEN** every other slot is full
- **THEN** the answer says that no other slot is free right now

#### Scenario: Registration closed
- **WHEN** the registration deadline has passed
- **THEN** the entry has no „Slot wechseln“ button

### Requirement: Link to the event
Every entry SHALL carry the link button „Zum Event“ to the event page.

#### Scenario: Rejected registration
- **WHEN** the member's registration was rejected
- **THEN** the entry shows "Abgelehnt" and only the „Zum Event“ button
