# bot-center-settings Specification

## Purpose

Defines what each switch and field of the bot control center does, so that every saved setting changes the bot's behaviour: automatic DMs, reminders, start DMs, event channels, the welcome message and the announcement channel.

## Requirements

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

### Requirement: The DM switch covers every automatic DM
With "DM-Benachrichtigungen" off the bot SHALL NOT send any DM it sends on its own: request received, accepted, rejected, put on the waitlist, moved up from the waitlist, the answers to guest invitations, event change notices, date poll results and the welcome message. Everything else a registration does (status, event role, channel access) SHALL happen as before. The guest invitation itself SHALL still be sent, because guests can only answer it through its buttons.

#### Scenario: Accepted without a DM
- **WHEN** the switch is off and an admin accepts a pending registration
- **THEN** the registration is accepted, the event role is given and no DM is sent

#### Scenario: Moved up without a DM
- **WHEN** the switch is off and a place frees up for a waitlisted member
- **THEN** the member moves up and gets no DM

#### Scenario: Switch on
- **WHEN** the switch is on and a member registers for an event with instant approval
- **THEN** the member gets the "accepted" DM as before

### Requirement: Admin-triggered messages and guest invitations ignore the DM switch
The DM switch SHALL NOT affect messages an admin sends on purpose (the DM about a cancelled event, the "Nachricht an Teilnehmer" of an event) nor the guest invitation with its answer buttons. They SHALL be sent as before when the switch is off.

#### Scenario: Guest invitation with the switch off
- **WHEN** the switch is off and a member registers with a guest
- **THEN** the guest gets the invitation with its buttons, and the member gets no DM when the guest answers

#### Scenario: Cancellation with the switch off
- **WHEN** the switch is off and an admin cancels an event with accepted participants
- **THEN** the participants get the cancellation DM

### Requirement: Reminders have their own switch and are not sent late
With "Erinnerungen" off the bot SHALL send no reminder DMs. A reminder whose time comes while the switch is off SHALL be dropped and SHALL NOT be sent after the switch is turned on again. The regular 5-minute check SHALL keep running in every case, so other timed work (closing announcements at the registration deadline, start notifications) is not affected by this switch.

#### Scenario: Reminder due while off
- **WHEN** an event's 24-hour reminder comes due while "Erinnerungen" is off and an admin turns the switch on an hour later
- **THEN** no 24-hour reminder is sent for that event

#### Scenario: Deadline refresh with reminders off
- **WHEN** "Erinnerungen" is off and the registration deadline of an announced event passes
- **THEN** its announcements still lose the registration buttons within 5 minutes

### Requirement: The start DM has its own switch
With "Event-Start Benachrichtigungen" off the bot SHALL NOT send the DM at an event's start. An event that starts while the switch is off SHALL NOT get the start DM later.

#### Scenario: Event starts with the switch off
- **WHEN** the switch is off and an active event with accepted participants starts
- **THEN** nobody gets the start DM, and turning the switch on afterwards sends none

#### Scenario: Switch on
- **WHEN** the switch is on and the event starts
- **THEN** the accepted participants get the start DM once

### Requirement: Channel creation is locked globally
With "Auto Channel-Erstellung" off the bot SHALL create no event channels, also for events whose own option "Auto-Voice/Text Channels generieren" is on; the option SHALL be kept on the event. Channels that already exist SHALL keep working and SHALL still be deleted with their event. The event wizard SHALL show the event option disabled with the hint "In der Bot-Zentrale ausgeschaltet." while the lock is on.

#### Scenario: Event saved with the lock on
- **WHEN** the switch is off and an admin activates an event whose channel option is on
- **THEN** no channel is created and the event still has the option on

#### Scenario: Lock lifted
- **WHEN** the admin turns the switch on and saves that event again
- **THEN** the channels are created as before

#### Scenario: Wizard
- **WHEN** the switch is off and an admin opens the event wizard
- **THEN** the channel option is disabled and shows "In der Bot-Zentrale ausgeschaltet."

### Requirement: Welcome message once per member
When the welcome message is not empty, a member SHALL get it by DM the first time one of their registrations becomes accepted (instant approval, admin acceptance, bulk acceptance, admin entry or moving up), and never again. The text SHALL support `{user.name}` and `{user.mention}`. With an empty message, or with "DM-Benachrichtigungen" off, nothing SHALL be sent and the member SHALL get it at a later first acceptance when it is sent.

#### Scenario: First acceptance
- **WHEN** the welcome message is "Willkommen, {user.name}!" and a member is accepted for the first time
- **THEN** the member gets "Willkommen, <name>!" once, in addition to the accepted DM

#### Scenario: Second acceptance
- **WHEN** the same member is accepted for another event later
- **THEN** no welcome DM is sent

#### Scenario: Member accepted before the welcome message existed
- **WHEN** a member already has an accepted registration from before and is accepted for another event after a welcome message was set
- **THEN** no welcome DM is sent

#### Scenario: Empty message
- **WHEN** the welcome message is empty and a member is accepted for the first time
- **THEN** no welcome DM is sent

### Requirement: The bot center chooses the announcement channel
The bot center SHALL offer "Ankündigungskanal" with the text channels of the server and the entry "Standard aus .env". Event and date poll announcements SHALL go to the chosen channel, or to `DISCORD_ANNOUNCE_CHANNEL_ID` when none is chosen. With neither a choice nor the env variable, announcing SHALL be refused with 400 "Kein Ankündigungskanal festgelegt – bitte in der Bot-Zentrale wählen.".

#### Scenario: Channel chosen
- **WHEN** an admin chooses "#events" in the bot center and announces an event
- **THEN** the announcement is posted in "#events"

#### Scenario: Default
- **WHEN** no channel is chosen and `DISCORD_ANNOUNCE_CHANNEL_ID` is set
- **THEN** announcements go to that channel as before

#### Scenario: Nothing configured
- **WHEN** no channel is chosen, the env variable is empty and an admin announces a date poll
- **THEN** the answer is 400 with "Kein Ankündigungskanal festgelegt – bitte in der Bot-Zentrale wählen."

### Requirement: Only text channels of the server can be chosen
Saving the bot settings with an announcement channel id that is not a text channel of the server SHALL be refused with 400 "Ankündigungskanal nicht gefunden." and nothing SHALL be saved, as long as the bot can read the channel list. While the list cannot be read (bot offline), a saved id SHALL be kept as it is.

#### Scenario: Unknown channel
- **WHEN** an admin saves the settings with an announcement channel id that is not a text channel of the server
- **THEN** the answer is 400 with "Ankündigungskanal nicht gefunden." and nothing is saved

#### Scenario: Bot offline
- **WHEN** the bot is offline and an admin saves the settings without changing the announcement channel
- **THEN** the settings are saved and the channel stays as it was
