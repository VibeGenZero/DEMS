# Spec Delta

## MODIFIED Requirements

### Requirement: Two recipient groups
The admin SHALL choose "Nur Angenommene" (default) or "Alle Anmeldungen". "Nur Angenommene" SHALL reach every accepted registration and their accepted guests; "Alle Anmeldungen" SHALL additionally reach pending, waitlisted, offered and tentative registrations and their accepted guests. Rejected registrations and open guest invitations SHALL never be reached. Every user SHALL receive at most one DM, even when they are both a member and a guest.

#### Scenario: Accepted only
- **WHEN** an event has 3 accepted registrations (one with an accepted guest), 2 pending, 1 waitlisted and 1 rejected, and the admin picks "Nur Angenommene"
- **THEN** 4 people are addressed

#### Scenario: All registrations
- **WHEN** the admin picks "Alle Anmeldungen" for the same event
- **THEN** 7 people are addressed and the rejected member is not among them

#### Scenario: Member is also a guest
- **WHEN** an accepted member is also the accepted guest of another accepted registration
- **THEN** they are addressed once

#### Scenario: Bench is reached
- **WHEN** an event has 2 accepted and 3 tentative registrations and the admin picks "Alle Anmeldungen"
- **THEN** 5 people are addressed; with "Nur Angenommene" 2
