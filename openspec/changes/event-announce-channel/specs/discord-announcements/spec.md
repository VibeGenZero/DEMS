# Spec Delta

## ADDED Requirements

### Requirement: Announcement channel per event
An event SHALL store an optional announcement channel chosen in the wizard step „Erweitert“. The dropdown SHALL offer „Standard aus der Bot-Zentrale“ (naming the current default channel when known) first, then the server's text channels, and keep a stored channel the bot cannot list as „Gespeicherter Kanal (<id>)“. The value SHALL be empty or a Discord id; anything else SHALL be refused with „Ankündigungskanal ist ungültig.“

#### Scenario: Own channel chosen
- **WHEN** an admin picks `#raid-termine` in the wizard and saves
- **THEN** the event stores that channel and reopening the wizard shows it selected

#### Scenario: Default kept
- **WHEN** an admin leaves „Standard aus der Bot-Zentrale“
- **THEN** the event stores no own channel

#### Scenario: Invalid value
- **WHEN** a request saves the channel „abc“
- **THEN** the answer is 400 „Ankündigungskanal ist ungültig.“ and nothing is saved

### Requirement: Announcements go to the event's channel
Announcing an event — on the website or through „Veröffentlichen & ankündigen“ in Discord — SHALL post to the event's own channel when it has one, else to the bot center's channel, else to `DISCORD_ANNOUNCE_CHANNEL_ID`. When the event's own channel cannot take the post, the answer SHALL be „Der Ankündigungskanal des Events ist nicht erreichbar – wähle im Assistenten einen anderen.“ and nothing SHALL be stored.

#### Scenario: Own channel
- **WHEN** an event with the channel `#raid-termine` is announced
- **THEN** the message is posted in `#raid-termine`, not in the default channel

#### Scenario: Own channel without a default
- **WHEN** no default channel is configured and the event has its own channel
- **THEN** the announcement is posted in the event's channel

#### Scenario: Channel gone
- **WHEN** the event's channel was deleted in Discord and the admin announces
- **THEN** the admin sees the unreachable-channel message and the event keeps no new announcement

### Requirement: The announce dialog names the target
The „Ankündigen“ dialog SHALL say which channel the announcement goes to: „Wird in #<name> gepostet.“, or the default channel's name with „(Standard)“; without any channel it SHALL say that none is set.

#### Scenario: Default target
- **WHEN** the admin opens the dialog for an event without own channel and the default is `#ankündigungen`
- **THEN** the dialog says „Wird in #ankündigungen (Standard) gepostet.“

### Requirement: Series and templates carry the channel
The channel SHALL be a shared setting of a series (taken over by „Dieser und alle folgenden Termine“ and by new dates of an extended series), a setting of event templates, and SHALL be kept by „Duplizieren“.

#### Scenario: Template
- **WHEN** an admin saves a template from an event with its own channel and later creates an event from it (wizard or `/event erstellen vorlage:…`)
- **THEN** the new event has the same channel
