# Spec Delta

## MODIFIED Requirements

### Requirement: Recipients
A change DM SHALL go to every member with an accepted registration for the event and to every accepted guest of such a registration, each user once, unless that user switched "Änderungen" off in the profile. Members whose registration is pending, waitlisted or rejected, and invited guests who have not accepted yet, SHALL NOT receive it.

#### Scenario: Accepted member with an accepted guest
- **WHEN** an accepted member has brought an accepted guest and the start changes with notification
- **THEN** both the member and the guest receive one DM each

#### Scenario: Pending and waitlisted members
- **WHEN** the start changes with notification while one member is pending and one is on the waitlist
- **THEN** neither of them receives a DM

#### Scenario: Open guest invitation
- **WHEN** an accepted member has invited a guest who has not answered yet
- **THEN** that guest receives no change DM

#### Scenario: Same user twice
- **WHEN** a user is listed as accepted guest of two registrations of the event
- **THEN** the user receives exactly one DM

#### Scenario: Changes switched off
- **WHEN** the start changes with notification and one of two accepted members switched "Änderungen" off
- **THEN** only the other member receives the DM, the answer counts one notified participant and the audit entry names one participant who opted out
