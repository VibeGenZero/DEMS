# admin-manual-registration Specification

## Purpose

Lets admins find members of the Discord server and put them on an event's registration list themselves, so registrations made by voice, DM or forgotten clicks still end up in the list and count for attendance.

## Requirements

### Requirement: Admins search the members of the Discord server
An admin SHALL be able to search the members of the Discord server by display name or username for a given event. A query shorter than 2 characters SHALL return no results. Each result SHALL carry id, display name, username, avatar and whether the member is already on this event's list (own registration or guest). The search SHALL return at most 10 members and an empty list when Discord cannot answer.

#### Scenario: Member who never used the website
- **WHEN** an admin searches for a part of the name of a server member who never logged in to the website
- **THEN** the member is among the results

#### Scenario: Already registered member is marked
- **WHEN** an admin searches for a member who already has a registration for the event
- **THEN** the result marks the member as already registered

#### Scenario: Too short query
- **WHEN** an admin searches with a single character
- **THEN** the result list is empty

### Requirement: Admins register a member directly as accepted
An admin SHALL be able to register a server member for an event. The registration SHALL get the source `admin`, the status `accepted` regardless of the event's approval mode, empty form answers and no guests. The response SHALL contain the new registration id and status.

#### Scenario: Event with manual approval
- **WHEN** an admin registers a member for an active event with manual approval
- **THEN** the member has an accepted registration with source `admin`

### Requirement: Admin entries override member rules
An admin entry SHALL NOT be refused because of the event's role requirement, its required form fields, its registration deadline, its end or the archived status. It SHALL be refused with HTTP 400 and a German error for drafts and cancelled events.

#### Scenario: Member without the required role after the deadline
- **WHEN** an admin registers a member who lacks the required role for an event whose registration deadline has passed
- **THEN** the member is registered as accepted

#### Scenario: Archived event
- **WHEN** an admin registers a member for an archived event
- **THEN** the member is registered as accepted

#### Scenario: Draft
- **WHEN** an admin tries to register a member for a draft
- **THEN** the API answers 400 with a German error and no registration is written

### Requirement: No double entries and only server members
An admin entry SHALL be refused with HTTP 400 and a German error when the member already has a registration for the event or is a guest (accepted or invited) of another registration. It SHALL be refused with HTTP 404 when the user is not a member of the Discord server, and with HTTP 503 when Discord cannot be asked.

#### Scenario: Member already registered
- **WHEN** an admin registers a member who already has a registration for the event
- **THEN** the API answers 400 with a German error and the list is unchanged

#### Scenario: Unknown user
- **WHEN** an admin registers a user id that is not a member of the server
- **THEN** the API answers 404 with a German error

### Requirement: A full event or slot is overbooked with a warning
A full event or slot SHALL NOT stop an admin entry. When the entry exceeds the capacity of the event or of the chosen slot, the response SHALL carry a German warning. For slot events the admin SHALL choose an existing slot; a missing or unknown slot SHALL be refused with HTTP 400.

#### Scenario: Full event
- **WHEN** an admin registers a member for an event whose places are all taken
- **THEN** the member is registered as accepted and the response warns that the event is now overbooked

#### Scenario: Full slot
- **WHEN** an admin registers a member into a full slot
- **THEN** the member gets that slot and the response warns that the slot is now overbooked

#### Scenario: Slot event without slot
- **WHEN** an admin registers a member for a slot event without choosing a slot
- **THEN** the API answers 400 with a German error

### Requirement: The member is notified like an accepted registration before the end
Before the event is over, an admin entry SHALL send the member the "accepted" message (event template, else global template, else the default text) and grant the event role and event channel access when the event has them. After the end no message SHALL be sent.

#### Scenario: Entry before the start
- **WHEN** an admin registers a member for an upcoming event
- **THEN** the member receives the accepted message as a Discord DM

#### Scenario: Entry after the end
- **WHEN** an admin registers a member for an event that is over
- **THEN** no DM is sent

### Requirement: Admin entries are restricted and audited
Search and entry SHALL require an admin session; the entry SHALL require the CSRF header and SHALL be written to the audit log with the acting admin and the member's name.

#### Scenario: Member tries to add someone
- **WHEN** a logged-in member without admin rights calls the entry endpoint
- **THEN** the API refuses the request and no registration is written

#### Scenario: Audit entry
- **WHEN** an admin registers a member
- **THEN** the audit log has an entry naming the admin and the member

### Requirement: The registration list offers the entry and shows the source
The admin registrations dialog SHALL offer a member search with an add action for active and archived events, with a slot choice on slot events, and SHALL show German confirmation and warning messages. It SHALL label registrations with source `admin` as "Admin"; the CSV export SHALL write "Admin" in its source column.

#### Scenario: Admin adds a member in the dialog
- **WHEN** an admin opens the registrations of an active event, searches a member and adds them
- **THEN** a German confirmation appears and the list shows the member as accepted with the source "Admin"

#### Scenario: No entry for drafts
- **WHEN** an admin opens the registrations of a draft
- **THEN** the dialog shows no member search
