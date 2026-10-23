# Spec Delta

## Purpose

Lets members choose in their profile which kinds of Discord DMs about events they receive, so they can turn off reminders, change notices or waitlist messages without losing the messages that tell them their own registration status.

## ADDED Requirements

### Requirement: Three DM kinds with defaults
A member SHALL be able to switch three DM kinds on or off independently: "Erinnerungen", "Änderungen" and "Warteliste". A kind SHALL count as on unless the member switched it off explicitly; a member who never chose, including a member who only registered through Discord, SHALL receive every kind.

#### Scenario: Member who never chose
- **WHEN** a member without stored choices is an accepted participant of an event whose reminder is due
- **THEN** the member receives the reminder DM

#### Scenario: Kinds are independent
- **WHEN** a member switches "Erinnerungen" off and leaves the others on
- **THEN** the member still receives change DMs and the waitlist DM

### Requirement: Erinnerungen
With "Erinnerungen" off, the member SHALL NOT receive the scheduled reminder DMs before an event's start nor the DM when the event starts. Other accepted participants SHALL still receive them.

#### Scenario: Reminder skipped
- **WHEN** a reminder of an event falls due and one of two accepted participants switched "Erinnerungen" off
- **THEN** only the other participant receives the reminder DM, and the reminder still counts as sent

#### Scenario: Start notification skipped
- **WHEN** the event starts and an accepted participant switched "Erinnerungen" off
- **THEN** that participant receives no start DM

### Requirement: Änderungen
With "Änderungen" off, the member SHALL NOT receive the DM about a changed start, end or location, nor the DM that the event was cancelled.

#### Scenario: Cancellation skipped
- **WHEN** an admin cancels an event and one accepted participant switched "Änderungen" off
- **THEN** that participant receives no cancellation DM, every other accepted or pending participant does, and the event is cancelled

### Requirement: Warteliste
With "Warteliste" off, the member SHALL NOT receive the DM that a registration was put on the waitlist. The DM that a member moved up from the waitlist SHALL always be sent.

#### Scenario: Put on the waitlist
- **WHEN** a member with "Warteliste" off registers for a full event
- **THEN** the registration is waitlisted and the member receives no DM about it

#### Scenario: Moving up
- **WHEN** a place becomes free and a member with "Warteliste" off moves up
- **THEN** the member receives the move-up DM

### Requirement: Other DMs are not affected
The choices SHALL NOT affect any other DM: request received, accepted, rejected, moved up from the waitlist, guest invitations and their answers, and date poll messages. Guest invitations stay governed by the existing setting "Einladungen erhalten".

#### Scenario: Everything off
- **WHEN** a member switched all three kinds off and an admin accepts the member's pending registration
- **THEN** the member receives the accepted DM

### Requirement: Choosing in the profile
The profile settings SHALL show the three kinds as switches under "Discord-Nachrichten", each with a short German explanation, reflecting the stored choice. Changing a switch SHALL save that kind at once and confirm it with a German toast; a failed save SHALL put the switch back and say so.

#### Scenario: Switching reminders off
- **WHEN** a member turns "Erinnerungen" off in the profile
- **THEN** the choice is saved, a toast confirms it, and the switch shows off after reloading the page

#### Scenario: Save fails
- **WHEN** saving a switch fails
- **THEN** the switch returns to its previous position and an error toast is shown

### Requirement: Settings API keeps other fields
`GET /api/user/settings` SHALL return the three kinds with their effective values next to `acceptInvitations`. `PUT /api/user/settings` SHALL change only the settings present in the request with a boolean value and leave every other stored setting as it is; values that are not booleans SHALL be ignored.

#### Scenario: Saving one kind
- **WHEN** a member who switched invitations off saves only "Warteliste" off
- **THEN** invitations stay off and "Erinnerungen" and "Änderungen" stay as they were

#### Scenario: Invitations alone
- **WHEN** the first-login dialog saves only `acceptInvitations`
- **THEN** the stored DM choices stay unchanged

#### Scenario: Invalid value
- **WHEN** a request sends `"false"` as text for "Änderungen"
- **THEN** the stored choice does not change
