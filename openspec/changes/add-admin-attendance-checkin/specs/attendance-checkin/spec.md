# Spec Delta

## Purpose

Records whether a member with an accepted registration was present at an event, either by their own check-in code or by an admin in the registration list, so badges and evaluations can count attendance.

## ADDED Requirements

### Requirement: Admin checks a registration in or out
An admin SHALL be able to set and clear the check-in of a single accepted registration. Setting it marks the registration as checked in with the current time; clearing it removes the check-in and its time. The action SHALL NOT need a generated check-in code and SHALL work before, during and after the event, also for archived events.

#### Scenario: Admin checks in an accepted registration without a code
- **WHEN** an admin checks in an accepted registration of an event that has no check-in code
- **THEN** the registration is stored as checked in with a check-in time and the response confirms `checkedIn: true`

#### Scenario: Admin takes a check-in back
- **WHEN** an admin clears the check-in of a checked-in registration
- **THEN** the registration is stored as not checked in without a check-in time

#### Scenario: Check-in after the event
- **WHEN** an admin checks in an accepted registration of an archived event
- **THEN** the check-in is stored like for an active event

#### Scenario: Repeating the same state
- **WHEN** an admin checks in a registration that is already checked in
- **THEN** the request succeeds and the registration stays checked in

### Requirement: Only accepted registrations carry a check-in
The admin check-in SHALL be refused for registrations that are pending, waitlisted or rejected, with HTTP 400 and a German error. An unknown registration SHALL be answered with HTTP 404, and a request without a boolean check-in value with HTTP 400.

#### Scenario: Pending registration
- **WHEN** an admin tries to check in a pending registration
- **THEN** the API answers 400 with a German error and the registration is unchanged

#### Scenario: Unknown registration
- **WHEN** an admin sends a check-in for a registration id that does not exist
- **THEN** the API answers 404 with a German error

#### Scenario: Missing value
- **WHEN** an admin sends the check-in request without a boolean value
- **THEN** the API answers 400 with a German error

### Requirement: Leaving the accepted status clears the check-in
When an admin sets a checked-in registration to rejected or waitlisted, the system SHALL clear its check-in.

#### Scenario: Checked-in member is moved to the waitlist
- **WHEN** an admin sets a checked-in registration to waitlisted
- **THEN** the registration is no longer checked in

### Requirement: Admin check-in is restricted and audited
Setting or clearing a check-in SHALL require an admin session and the CSRF header, and every change SHALL be written to the audit log with the acting admin.

#### Scenario: Member tries the admin check-in
- **WHEN** a logged-in member without admin rights calls the admin check-in endpoint
- **THEN** the API refuses the request and the registration is unchanged

#### Scenario: Audit entry
- **WHEN** an admin checks a registration in or out
- **THEN** the audit log has a new entry naming the admin and the registration

### Requirement: Registration list shows and toggles the check-in
The admin registrations dialog SHALL show a check-in column. For an accepted registration it SHALL show whether the member is checked in and offer one control that switches the state; for other statuses it SHALL show no control. After a change the list SHALL show the new state and a German confirmation.

#### Scenario: Admin ticks a member off in the dialog
- **WHEN** an admin opens the registrations of an event and uses the check-in control of an accepted, not checked-in registration
- **THEN** a German confirmation appears and the row shows the member as checked in

#### Scenario: No control for open requests
- **WHEN** the dialog lists a pending registration
- **THEN** its check-in cell shows no control

### Requirement: Admin check-ins count like code check-ins
A check-in set by an admin SHALL count everywhere a code check-in counts: the profile check-in number and the `perfect-attendance` badge, the "Eingecheckt" state on the member's profile and event page, and the admin check-in stats of the event. Taking it back SHALL remove it from these counts.

#### Scenario: Badge progress
- **WHEN** an admin checks in a member's accepted registration
- **THEN** the member's profile check-in count rises by one

#### Scenario: Member sees the check-in
- **WHEN** an admin has checked in a member and the member opens the event page
- **THEN** the page shows the member as checked in instead of the code input

### Requirement: Export shows the check-in
The CSV export of an event's registrations SHALL have a column "Eingecheckt" with "Ja" for checked-in registrations and "Nein" otherwise.

#### Scenario: Export after an admin check-in
- **WHEN** an admin exports the registrations after checking in one member
- **THEN** that member's row says "Ja" in the "Eingecheckt" column and the other rows say "Nein"

### Requirement: Member code check-in stays available
A member with an accepted registration SHALL still be able to check in with the event's code on the event page as before.

#### Scenario: Code check-in after an admin took a check-in back
- **WHEN** an admin cleared a member's check-in and the member then enters the correct code
- **THEN** the member is checked in again
