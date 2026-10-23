# Spec Delta

## Purpose

Lets admins reach the people registered for one event with a free-text Discord DM, choosing accepted participants only or every open registration, with a preview, a confirmation, a delivery count and an audit log entry.

## ADDED Requirements

### Requirement: Admins open the message dialog for one event
The registrations dialog SHALL have a button "Nachricht an Teilnehmer", and the ⋯ menu of the admin event table SHALL have the entry "Nachricht an Teilnehmer …" for every event that is not a draft. Both SHALL open the same dialog for that event, titled with the event title.

#### Scenario: From the event table
- **WHEN** an admin opens the ⋯ menu of an active, past or archived event and picks "Nachricht an Teilnehmer …"
- **THEN** the message dialog opens for that event

#### Scenario: Draft
- **WHEN** an admin opens the ⋯ menu of a draft
- **THEN** it has no entry "Nachricht an Teilnehmer …"

### Requirement: Two recipient groups
The admin SHALL choose "Nur Angenommene" (default) or "Alle Anmeldungen". "Nur Angenommene" SHALL reach every accepted registration and their accepted guests; "Alle Anmeldungen" SHALL additionally reach pending and waitlisted registrations and their accepted guests. Rejected registrations and open guest invitations SHALL never be reached. Every user SHALL receive at most one DM, even when they are both a member and a guest.

#### Scenario: Accepted only
- **WHEN** an event has 3 accepted registrations (one with an accepted guest), 2 pending, 1 waitlisted and 1 rejected, and the admin picks "Nur Angenommene"
- **THEN** 4 people are addressed

#### Scenario: All registrations
- **WHEN** the admin picks "Alle Anmeldungen" for the same event
- **THEN** 7 people are addressed and the rejected member is not among them

#### Scenario: Member is also a guest
- **WHEN** an accepted member is also the accepted guest of another accepted registration
- **THEN** they are addressed once

### Requirement: Counter, preview and confirmation
The dialog SHALL show the number of people the chosen group reaches ("an 12 Personen") and update it when the group changes, and SHALL show a preview of the DM exactly as it will be sent. Sending SHALL ask "Nachricht an <n> Personen senden?" before anything goes out. With nobody to reach, the send button SHALL be disabled with the note "Niemand in dieser Auswahl".

#### Scenario: Switching the group
- **WHEN** the admin switches from "Nur Angenommene" to "Alle Anmeldungen"
- **THEN** the counter changes to the number of the new group

#### Scenario: Cancel the confirmation
- **WHEN** the admin cancels the confirmation question
- **THEN** no DM is sent and the dialog stays open with the text

### Requirement: Message text
The text SHALL be required and at most 1500 characters after trimming; otherwise the server SHALL answer HTTP 400 with "Bitte gib eine Nachricht ein." or "Die Nachricht darf höchstens 1500 Zeichen lang sein.". The DM SHALL contain the event title, the admin's text unchanged, the sender's display name and the link to the event page.

#### Scenario: Empty text
- **WHEN** the admin sends only spaces
- **THEN** the server answers 400 "Bitte gib eine Nachricht ein." and sends nothing

#### Scenario: DM content
- **WHEN** admin "Mori" sends "Treffpunkt ist heute Tor 2." for the event "Raid: Schattenfestung"
- **THEN** each recipient's DM names "Raid: Schattenfestung", contains "Treffpunkt ist heute Tor 2.", names "Mori" as sender and links to the event page

### Requirement: Delivery regardless of DM choices
The message SHALL be sent to every addressed person regardless of their DM choices (reminders, changes, waitlist) and of the invitation setting.

#### Scenario: Member with all DM kinds off
- **WHEN** an accepted member switched all three DM kinds off and the admin sends a message to accepted participants
- **THEN** the member receives the DM

### Requirement: Result shown to the admin
After sending, the server SHALL answer with the number of addressed people and of delivered DMs, and the dialog SHALL close with the toast "Nachricht an <delivered> von <n> Personen zugestellt." — success when all arrived, warning otherwise. A send without addressed people SHALL answer HTTP 400 "Niemand in dieser Auswahl." and send nothing.

#### Scenario: Bot offline
- **WHEN** the bot is not connected and the admin sends to 5 people
- **THEN** the toast says "Nachricht an 0 von 5 Personen zugestellt." as a warning

#### Scenario: Nobody addressed
- **WHEN** the admin sends to "Nur Angenommene" of an event without accepted registrations
- **THEN** the server answers 400 "Niemand in dieser Auswahl."

### Requirement: Audit log
Each send with at least one addressed person SHALL write the audit entry `MESSAGE_PARTICIPANTS` with the acting admin, the event, the group, the addressed and delivered counts and the first 100 characters of the text. A refused send SHALL write no entry.

#### Scenario: Partial delivery is logged
- **WHEN** the bot is not connected and the admin sends to 5 people
- **THEN** the audit entry records 5 addressed and 0 delivered

#### Scenario: Refused send
- **WHEN** a send is refused because nobody is addressed or the text is empty
- **THEN** no audit entry is written

### Requirement: Restricted to admins
Both the recipient counts and sending SHALL require an admin session; sending SHALL also require the CSRF header. An unknown event SHALL be answered with HTTP 404 "Event nicht gefunden", an unknown group with HTTP 400 "Ungültige Empfängerauswahl.". The counts answer SHALL contain only numbers, no names or ids.

#### Scenario: Member tries to send
- **WHEN** a logged-in member without admin rights posts a message for an event
- **THEN** the server answers 403 and nobody receives a DM

#### Scenario: Missing CSRF token
- **WHEN** an admin posts a message without the CSRF header
- **THEN** the server answers 403 and nobody receives a DM
