# Spec Delta

## MODIFIED Requirements

### Requirement: Switch in the event wizard
When editing an event, the wizard SHALL show the switch "Teilnehmer benachrichtigen" next to "Speichern" only while the status "Aktiv" is selected and the start, the end or the location differs from the values the event was loaded with. When the switch appears it SHALL be switched on. The wizard SHALL NOT show the switch when creating an event, nor while "DM-Benachrichtigungen" is off in the bot center.

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

#### Scenario: DM notifications off
- **WHEN** "DM-Benachrichtigungen" is off in the bot center and an admin changes the start of an active event
- **THEN** the switch stays hidden

### Requirement: Notification only on request
The server SHALL send change DMs only when the save request asks for it explicitly, "DM-Benachrichtigungen" is on in the bot center, the event is active after the save and at least one relevant change was saved. The request flag SHALL NOT be stored on the event. A save without the flag, or with the switch turned off, SHALL behave as before and send no change DM.

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

#### Scenario: DM notifications off in the bot center
- **WHEN** "DM-Benachrichtigungen" is off and a save request with the notification flag changes the start of an active event
- **THEN** the event is saved, no participant gets a DM and the answer reports 0 notified participants
