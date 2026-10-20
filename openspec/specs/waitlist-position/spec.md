# waitlist-position Specification

## Purpose

Tells waitlisted members and admins where a registration stands on an event's waitlist, so members can judge their chances and admins see the order in which places are offered.

## Requirements

### Requirement: Waitlist position is the rank by registration time
The position of a waitlisted registration SHALL be its rank among all waitlisted registrations of the same event, ordered by registration time, oldest first, starting at 1; the total SHALL be the number of waitlisted registrations of the event. Events with role slots SHALL use the same single list. Registrations that are not waitlisted SHALL have no position.

#### Scenario: Three members wait
- **WHEN** three registrations of an event are waitlisted and the member's registration is the newest of them
- **THEN** its position is 3 of 3

#### Scenario: Someone ahead moves up
- **WHEN** the oldest waitlisted registration of the event is accepted
- **THEN** the positions of the others move up by one and the total drops by one

#### Scenario: Accepted registration
- **WHEN** a member's registration is accepted
- **THEN** no waitlist position is reported for it

### Requirement: Members see their position on the event page
The event page SHALL show a waitlisted member "Platz <n> von <total> auf der Warteliste" as the status of their own registration. On events with role slots the slot area SHALL say "Du stehst auf Platz <n> von <total> der Warteliste." and add that members with a free wanted role can move up earlier. A guest SHALL see no position.

#### Scenario: Event without slots
- **WHEN** a member whose registration is second of three on the waitlist opens the event page
- **THEN** the status reads "Platz 2 von 3 auf der Warteliste"

#### Scenario: Slot event
- **WHEN** a waitlisted member opens a slot event
- **THEN** the slot area names the position and that a free wanted role can move others up earlier

### Requirement: Members see their position in the profile
The upcoming events of the member's profile SHALL label a waitlisted registration "Warteliste · Platz <n> von <total>". Past events SHALL keep the label "Warteliste".

#### Scenario: Upcoming waitlisted event
- **WHEN** a member who is third of three on a full upcoming event opens the profile
- **THEN** that event's chip reads "Warteliste · Platz 3 von 3"

### Requirement: Admins see the order in the registration list
The admin registrations dialog SHALL show a waitlisted registration's status as "Warteliste · Platz <n>".

#### Scenario: Admin opens a full event
- **WHEN** an admin opens the registrations of an event with waitlisted members
- **THEN** each waitlisted row shows its place

### Requirement: Positions stay private to the member and admins
A member SHALL only receive the position of their own registration; the API SHALL NOT expose other members' positions or registration times outside the admin area.

#### Scenario: Another member's event page
- **WHEN** a member who is not on the waitlist opens the event page
- **THEN** the response for their registration carries no waitlist position of other members
