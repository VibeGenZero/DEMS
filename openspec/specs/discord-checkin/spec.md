# discord-checkin Specification

## Purpose
Lets accepted participants check in to a running event with one click on an „Einchecken“ button the bot sends them by DM, as an alternative to typing the check-in code on the website.

## Requirements

### Requirement: Check-in invitation at the start
When an active event with check-in switched on (a check-in code was generated) has started and is not over, every accepted participant who is not checked in yet SHALL get one DM with an „Einchecken“ button and a link to the event. Events without check-in SHALL send no invitation.

#### Scenario: Event with check-in starts
- **WHEN** an event with a generated check-in code starts and has two accepted participants
- **THEN** both get a DM with an „Einchecken“ button within the next scheduler pass

#### Scenario: Event without check-in starts
- **WHEN** an event without a check-in code starts
- **THEN** no participant gets a check-in invitation and the start DM has no button

#### Scenario: Only accepted participants
- **WHEN** an event with check-in starts and has one accepted, one pending and one waitlisted registration
- **THEN** only the accepted participant gets an invitation

#### Scenario: Already checked in
- **WHEN** an admin checked a participant in before the start
- **THEN** that participant gets no invitation

### Requirement: Invitation does not depend on start notifications or reminder preferences
The check-in invitation SHALL be sent when the bot center switch for start notifications is off and when the participant switched off reminders in the profile.

#### Scenario: Start notifications switched off
- **WHEN** start notifications are switched off in the bot center and an event with check-in starts
- **THEN** accepted participants get the check-in invitation and no start DM

#### Scenario: Member without reminders
- **WHEN** a participant switched off reminders and an event with check-in starts
- **THEN** that participant gets the check-in invitation

### Requirement: One message when the start DM goes out too
A participant who gets the start DM and the check-in invitation in the same pass SHALL get one DM: the start text with the „Einchecken“ button.

#### Scenario: Start DM with button
- **WHEN** start notifications are on, the participant wants reminders and an event with check-in starts
- **THEN** the participant gets exactly one DM, which names the start and carries the „Einchecken“ button

### Requirement: Each registration is invited once
A registration SHALL get at most one check-in invitation, also across restarts and repeated scheduler passes, and also when the admin generates a new code. The invitation SHALL be recorded before the DM is sent.

#### Scenario: Next scheduler pass
- **WHEN** a participant got an invitation and the scheduler runs again while the event runs
- **THEN** the participant gets no second invitation

#### Scenario: New code
- **WHEN** an admin generates a new check-in code while the event runs
- **THEN** participants who already got an invitation get no second one

### Requirement: Late invitations while the event runs
Participants accepted after the start SHALL get their invitation while the event runs. When an admin generates the check-in code while the event runs, the invitations SHALL be sent right away. Once the event is over, no invitation SHALL be sent.

#### Scenario: Accepted during the event
- **WHEN** an admin accepts a pending registration while an event with check-in runs
- **THEN** the participant gets an invitation within the next scheduler pass

#### Scenario: Code generated during the event
- **WHEN** an admin generates the check-in code while the event runs
- **THEN** the accepted participants get their invitation right away

#### Scenario: Code generated before the start
- **WHEN** an admin generates the check-in code a day before the event
- **THEN** no invitation is sent before the start

#### Scenario: Event over
- **WHEN** an event with check-in is over and a participant has no invitation yet
- **THEN** no invitation is sent

### Requirement: Clicking „Einchecken“ checks the member in
A click SHALL check the clicking member in, with the current time, when the event is active, has check-in switched on, has started and is not over, and the member holds an accepted registration. The DM SHALL then show "✅ Du bist eingecheckt!" with the event's check-in message instead of the button.

#### Scenario: Successful check-in
- **WHEN** an accepted participant clicks „Einchecken“ while the event runs
- **THEN** the registration is stored as checked in with a time and the DM shows "✅ Du bist eingecheckt!" and the check-in message, without the button

#### Scenario: Already checked in
- **WHEN** a participant who is already checked in clicks „Einchecken“
- **THEN** the check-in time stays unchanged and the DM shows "ℹ️ Du bist bereits eingecheckt." without the button

### Requirement: Refused clicks
A click SHALL change nothing and answer with a German reason when the event is over ("⌛ Der Check-in für dieses Event ist vorbei."), no longer active or deleted ("❌ Dieses Event ist nicht mehr aktiv."), check-in is switched off ("❌ Check-in ist für dieses Event nicht aktiviert.") or the member has no accepted registration ("❌ Du hast keine angenommene Anmeldung für dieses Event.").

#### Scenario: Event over
- **WHEN** a participant clicks „Einchecken“ after the event is over
- **THEN** the registration stays not checked in and the DM shows "⌛ Der Check-in für dieses Event ist vorbei." without the button

#### Scenario: Member unregistered
- **WHEN** a member who unregistered after the invitation clicks „Einchecken“
- **THEN** nothing is stored and the member gets "❌ Du hast keine angenommene Anmeldung für dieses Event."

#### Scenario: Event cancelled
- **WHEN** a participant clicks „Einchecken“ for an event that was cancelled
- **THEN** nothing is stored and the member gets "❌ Dieses Event ist nicht mehr aktiv."

### Requirement: Discord check-ins count like code check-ins
A check-in through Discord SHALL count everywhere a code check-in counts: profile check-in number and badge, "Eingecheckt" on the event page and profile, admin check-in stats, export and evaluations. Admins SHALL be able to take it back in the registration list.

#### Scenario: Event page after a Discord check-in
- **WHEN** a participant checked in through Discord and opens the event page
- **THEN** the page shows the participant as checked in instead of the code input

#### Scenario: Admin stats
- **WHEN** one of three accepted participants checked in through Discord
- **THEN** the admin check-in stats of the event show 1 of 3

### Requirement: The code check-in stays available
The website check-in with the event's code SHALL keep working with the same answers and limits.

#### Scenario: Code check-in during the event
- **WHEN** an accepted participant enters the correct code on the event page
- **THEN** the participant is checked in as before

#### Scenario: Wrong code
- **WHEN** a participant enters a wrong code
- **THEN** the API answers 400 "Ungültiger Check-in Code." as before

### Requirement: Bot offline
While the bot is not connected, invitations SHALL NOT be recorded as sent; they SHALL go out once the bot is connected again and the event still runs. Generating codes, the code check-in and the admin check-in SHALL keep working without the bot.

#### Scenario: Bot offline at the start
- **WHEN** the bot is not connected while an event with check-in starts
- **THEN** no invitation is recorded, and generating codes and the code check-in keep working

#### Scenario: Bot back during the event
- **WHEN** the bot connects again while that event still runs
- **THEN** the accepted participants get their invitation in the next scheduler pass
