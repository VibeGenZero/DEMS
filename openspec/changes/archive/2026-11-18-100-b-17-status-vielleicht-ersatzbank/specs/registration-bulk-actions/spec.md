# Spec Delta

## MODIFIED Requirements

### Requirement: Each action applies only to fitting statuses
Accept SHALL apply to pending, waitlisted, offered and tentative registrations, waitlist to pending, accepted, offered and tentative ones, and reject to pending, waitlisted, accepted, offered and tentative ones. A selected registration whose status the action does not apply to, including every rejected registration, SHALL stay unchanged and count as skipped.

#### Scenario: Mixed selection rejected
- **WHEN** an admin rejects a selection of one pending, one accepted and one already rejected registration
- **THEN** the first two are rejected and the answer reports 2 rejected and 1 skipped

#### Scenario: Accepting an accepted registration
- **WHEN** an accepted registration is part of a selection that is accepted
- **THEN** it stays as it is and counts as skipped

#### Scenario: Accepting from the bench
- **WHEN** an admin accepts a selection of two tentative registrations on an event with two free places
- **THEN** both are accepted and get the accepted DM

#### Scenario: Waitlisting from the bench
- **WHEN** an admin waitlists a tentative registration
- **THEN** it becomes waitlisted at the end of the waitlist

## ADDED Requirements

### Requirement: Tentative registrations take no place during bulk accept
While a bulk accept fills the event, unselected tentative registrations SHALL NOT count as holding places. The dialog SHALL offer the row checkbox for tentative registrations too.

#### Scenario: Unselected bench
- **WHEN** an event has 10 places, 8 taken, three unselected tentative registrations, and an admin accepts two pending registrations
- **THEN** both pending registrations are accepted
