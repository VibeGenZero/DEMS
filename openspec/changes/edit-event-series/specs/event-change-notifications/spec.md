# Spec Delta

## MODIFIED Requirements

### Requirement: Feedback and audit log
The save answer SHALL report how many participants were notified successfully, and the admin SHALL see that number after saving. When one save covers several dates of a series, the answer SHALL report the sum over all dates. A DM that cannot be delivered SHALL NOT make the save fail and SHALL NOT be counted. Each notification SHALL be written to the audit log with the acting admin, the event, the number of recipients and the changed fields, one entry per notified date.

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

#### Scenario: Several dates of a series
- **WHEN** an admin changes the start time for this and two following dates with notification, and two, three and one DMs are delivered for the three dates
- **THEN** the answer reports six notified participants and the audit log contains three notification entries, one for each date
