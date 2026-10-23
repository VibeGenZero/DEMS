# Spec Delta

## Purpose

Tells the people who take part in an event by Discord DM when an admin moves it to another date or time or changes its location, so nobody turns up at the old time or place. The admin decides per save whether the message goes out.

## ADDED Requirements

### Requirement: Relevant changes
An event edit SHALL count as a change participants must know about only when the start, the end or the location differs between the saved event and the new values. Times SHALL be compared as points in time, the location by its text and its linked channel. A field going from empty to a value, or from a value to empty, SHALL count as a change. Every other field SHALL never count.

#### Scenario: Start moved
- **WHEN** an admin saves an event whose start moves from Friday 19:00 to Saturday 19:00
- **THEN** the start counts as changed

#### Scenario: Same time in another notation
- **WHEN** the stored start and the new start describe the same point in time in different ISO notations
- **THEN** the start does not count as changed

#### Scenario: Location removed
- **WHEN** an admin clears the location "Lobby"
- **THEN** the location counts as changed

#### Scenario: Only other fields changed
- **WHEN** an admin changes only the title, the description, the capacity or a deadline
- **THEN** nothing counts as changed and no DM is sent, even when the admin asked for a notification

### Requirement: Switch in the event wizard
When editing an event, the wizard SHALL show the switch "Teilnehmer benachrichtigen" next to "Speichern" only while the status "Aktiv" is selected and the start, the end or the location differs from the values the event was loaded with. When the switch appears it SHALL be switched on. The wizard SHALL NOT show the switch when creating an event.

#### Scenario: Start changed while editing
- **WHEN** an admin edits an active event, changes its start and goes to the last step
- **THEN** the switch "Teilnehmer benachrichtigen" is visible next to "Speichern" and switched on

#### Scenario: Change undone
- **WHEN** the admin sets the start back to the loaded value
- **THEN** the switch is hidden again

#### Scenario: New event
- **WHEN** an admin creates a new event
- **THEN** the switch never appears

#### Scenario: Draft
- **WHEN** an admin edits an event with the status "Entwurf" selected and changes its location
- **THEN** the switch stays hidden

### Requirement: Notification only on request
The server SHALL send change DMs only when the save request asks for it explicitly, the event is active after the save and at least one relevant change was saved. The request flag SHALL NOT be stored on the event. A save without the flag, or with the switch turned off, SHALL behave as before and send no change DM.

#### Scenario: Switch turned off
- **WHEN** an admin changes the location of an active event and saves with the switch turned off
- **THEN** the event is saved and no participant gets a DM

#### Scenario: Older client without the flag
- **WHEN** a save request without the notification flag changes the start of an active event
- **THEN** the event is saved and no participant gets a DM

#### Scenario: Event not active after the save
- **WHEN** a save request with the notification flag changes the start and sets the status to draft, archived or cancelled
- **THEN** no participant gets a change DM

#### Scenario: Flag not stored
- **WHEN** an event was saved with the notification flag
- **THEN** reading the event does not return the flag

### Requirement: Recipients
A change DM SHALL go to every member with an accepted registration for the event and to every accepted guest of such a registration, each user once. Members whose registration is pending, waitlisted or rejected, and invited guests who have not accepted yet, SHALL NOT receive it.

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

### Requirement: Content of the change DM
The change DM SHALL be German. It SHALL name the event title and list each changed field ("Beginn", "Ende", "Ort") with its value before and after the change, dates in German format in the configured time zone and an empty value as "nicht festgelegt". Unchanged fields SHALL NOT be listed. The DM SHALL end with a link to the event page.

#### Scenario: Start and location changed
- **WHEN** the start moves from 24.10.2026 19:00 to 25.10.2026 19:00 and the location from "Lobby" to "Event-Voice"
- **THEN** the DM names the event, shows "Beginn" with both dates, "Ort" with "Lobby" and "Event-Voice", does not mention "Ende" and links to the event page

#### Scenario: End added
- **WHEN** an event without an end gets an end at 22:00
- **THEN** the DM shows "Ende" from "nicht festgelegt" to the new date and time

### Requirement: Feedback and audit log
The save answer SHALL report how many participants were notified successfully, and the admin SHALL see that number after saving. A DM that cannot be delivered SHALL NOT make the save fail and SHALL NOT be counted. Each notification SHALL be written to the audit log with the acting admin, the event, the number of recipients and the changed fields.

#### Scenario: Notified participants
- **WHEN** an admin saves a changed start with notification and three DMs are delivered
- **THEN** the answer reports three notified participants and the admin sees "Event aktualisiert – 3 Teilnehmer benachrichtigt."

#### Scenario: DM not deliverable
- **WHEN** one of three recipients does not accept DMs
- **THEN** the event is saved, the answer reports two notified participants and no error is shown

#### Scenario: Audit entry
- **WHEN** a change notification was sent
- **THEN** the audit log contains an entry for the event by the acting admin that names the number of recipients and the changed fields

#### Scenario: Nothing sent
- **WHEN** a save sends no change DM
- **THEN** the answer reports zero notified participants, the admin sees the usual "Event aktualisiert!" and no notification entry is written to the audit log
