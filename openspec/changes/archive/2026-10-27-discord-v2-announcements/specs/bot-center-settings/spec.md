# Spec Delta

## MODIFIED Requirements

### Requirement: Stored settings always have defaults
Reading the bot settings SHALL give every setting a value: a key missing from the stored document SHALL take its default (DM notifications, reminders, start notifications, channel creation and announcement threads on; presence auto-update and automatic status off; announcement channel and welcome message empty). A change saved in the bot center SHALL take effect for the next action of the bot without a restart.

#### Scenario: Settings saved before this change
- **WHEN** the stored settings have no `eventStartNotifications` key
- **THEN** start notifications count as on

#### Scenario: Settings saved before announcement threads existed
- **WHEN** the stored settings have no key for announcement threads
- **THEN** announcement threads count as on

#### Scenario: Switch takes effect at once
- **WHEN** an admin switches "DM-Benachrichtigungen" off and a member registers a minute later
- **THEN** the member gets no DM
