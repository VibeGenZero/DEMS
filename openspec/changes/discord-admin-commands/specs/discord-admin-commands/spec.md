# Spec Delta

## Purpose

Lets admins create an event or a date poll straight from Discord through a slash command and a modal, as a quick path next to the website wizard.

## ADDED Requirements

### Requirement: Only admins use the admin commands
`/event erstellen` and `/abstimmung erstellen` SHALL be visible to every member. A member without the DEMS admin role SHALL get the private answer „⛔ Nur Admins können Events und Abstimmungen erstellen.“ and no modal; the same SHALL apply to every button and modal of these commands. Without a configured admin role nobody SHALL pass.

#### Scenario: Member tries the command
- **WHEN** a member without the admin role runs `/event erstellen`
- **THEN** they get the private refusal and no modal opens

#### Scenario: Admin runs the command
- **WHEN** a member with the admin role runs `/abstimmung erstellen`
- **THEN** the poll modal opens

### Requirement: Event modal
`/event erstellen` SHALL open a modal with Titel (required, ≤ 200), Beginn (required), Ende (optional), Plätze (optional, empty or 0 = unbegrenzt) and Beschreibung (optional). With the option `vorlage` the modal SHALL be prefilled with the template's title, description and places; a template with slots SHALL leave out Plätze, its places come from the slots.

#### Scenario: Template prefills
- **WHEN** an admin runs `/event erstellen vorlage:Raid-Abend` and the template has the title „Raid-Abend“ and 12 places
- **THEN** the modal shows „Raid-Abend“ as title and 12 as places

#### Scenario: Unknown template
- **WHEN** the chosen template no longer exists
- **THEN** the admin gets „Diese Vorlage gibt es nicht mehr.“ privately and no modal opens

#### Scenario: Template autocomplete
- **WHEN** an admin types „ra“ into the option `vorlage`
- **THEN** the templates whose name contains „ra“ are offered, at most 25; members without the admin role are offered nothing

### Requirement: Date input
Beginn SHALL be read as `TT.MM.JJJJ HH:MM` (one-digit day, month and hour allowed, two-digit year = 20xx) in the server's time zone. Ende SHALL accept the same or only `HH:MM`, meaning the start day, or the next day when the time lies before the start time. Beginn SHALL lie in the future; Ende SHALL lie after Beginn.

#### Scenario: Local time
- **WHEN** an admin types „24.12.2026 19:30“ as Beginn with the time zone Europe/Berlin
- **THEN** the event starts at 2026-12-24T18:30:00.000Z

#### Scenario: Time only for the end
- **WHEN** Beginn is „31.12.2026 22:00“ and Ende is „01:00“
- **THEN** the event ends on 01.01.2027 at 01:00 local time

#### Scenario: Unreadable date
- **WHEN** Beginn is „morgen abend“
- **THEN** the answer names the expected format with an example and nothing is saved

### Requirement: The event modal saves a draft
A valid event modal SHALL save one event with status `draft`, the template's settings (else the defaults of a new web event) and the typed values, and answer privately with title, start, places and the buttons „Veröffentlichen & ankündigen“, „Nur veröffentlichen“ and the link „Im Web öffnen“.

#### Scenario: Draft with template
- **WHEN** an admin submits the modal of the template „Raid-Abend“ (manual approval, slots) with Beginn „24.12.2026 19:30“
- **THEN** a draft with manual approval, the template's slots and that start exists, and the answer shows the three buttons

### Requirement: Publish or announce the draft
„Nur veröffentlichen“ SHALL set the draft `active` with the same effects as publishing on the website. „Veröffentlichen & ankündigen“ SHALL additionally post it to the announcement channel like „Ankündigen“ on the website. Both SHALL replace the buttons with the result.

#### Scenario: Publish and announce
- **WHEN** the admin clicks „Veröffentlichen & ankündigen“ on a fresh draft
- **THEN** the event is active, the announcement is posted, and the answer says „✅ Veröffentlicht und angekündigt.“ with the link

#### Scenario: No announcement channel
- **WHEN** no announcement channel is configured and the admin clicks „Veröffentlichen & ankündigen“
- **THEN** the event is active and the answer says it could not be announced and why

#### Scenario: Already published
- **WHEN** the event is no longer a draft (published on the website meanwhile, or deleted)
- **THEN** the button answers that the draft is already published or gone and changes nothing

### Requirement: Poll modal posts at once
`/abstimmung erstellen` SHALL open a modal with Titel (required), Termine (required, one per line in the date input format, optionally `– HH:MM` or `– TT.MM.JJJJ HH:MM` as end; 2–10 lines) and Beschreibung (optional). A valid modal SHALL create an open date poll with the same rules as the website and post it to the announcement channel; the private answer SHALL link the posted message. Without an announcement channel the poll SHALL be created and the answer SHALL say it was not posted.

#### Scenario: Three dates
- **WHEN** an admin submits three future dates
- **THEN** an open poll with three dates exists, it is posted, and the answer links the message

#### Scenario: One date
- **WHEN** an admin submits a single date
- **THEN** the answer says „Eine Abstimmung braucht 2–10 Termine.“ and nothing is saved

### Requirement: Correct a refused input
A refused modal SHALL answer privately with the reason and the button „Korrigieren“, which reopens the same modal with the typed values for 15 minutes. After that, or after a restart, the button SHALL answer „Die Eingabe ist abgelaufen. Starte den Befehl neu.“

#### Scenario: Fix a typo
- **WHEN** an admin submits Beginn „24.13.2026 19:30“ and clicks „Korrigieren“
- **THEN** the modal opens again with all typed values

### Requirement: Logged like the website
Creating, publishing and announcing from Discord SHALL write the same audit entries as the website (`CREATE_EVENT`, `UPDATE_EVENT_STATUS`, `ANNOUNCE_EVENT`, `CREATE_POLL`, `ANNOUNCE_POLL`) with the admin's Discord id; the detail SHALL say „in Discord“.

#### Scenario: Audit entry
- **WHEN** an admin creates an event „Spieleabend“ through the modal
- **THEN** the audit log shows `CREATE_EVENT` by that admin with „Created event "Spieleabend" in Discord“
