# Spec Delta

## Purpose

Lets members of raids and teams give a non-binding „Vielleicht“ answer that puts them on the event's Ersatzbank without taking a place, so leads see who could step in and members can confirm later.

## ADDED Requirements

### Requirement: Events opt in to „Vielleicht“
An event SHALL accept „Vielleicht“ answers only when its setting `allowTentative` is on. The setting SHALL default to off, SHALL be saved by creating and by editing an event, and SHALL be offered as a switch in the event wizard. Turning it off SHALL keep existing tentative registrations.

#### Scenario: Setting off
- **WHEN** a member answers „Vielleicht“ for an event without `allowTentative`
- **THEN** the request is refused with HTTP 400 and „Für dieses Event gibt es kein „Vielleicht“.“ and nothing is stored

#### Scenario: Edit keeps the setting
- **WHEN** an admin turns `allowTentative` on in the wizard of an existing event and saves
- **THEN** reading the event returns `allowTentative: true`

#### Scenario: Switched off later
- **WHEN** an event with two tentative registrations gets `allowTentative` turned off
- **THEN** both stay tentative and new „Vielleicht“ answers are refused

### Requirement: Answering „Vielleicht“ uses the registration checks
A „Vielleicht“ answer SHALL pass the same checks as a registration: event active and not over, registration deadline not reached, no own registration yet, required role, required form fields, and on slot events a valid wanted role with optional fallback roles. Guests SHALL be refused. The answer SHALL be stored as a registration with status `tentative`.

#### Scenario: Answer on an open event
- **WHEN** a member answers „Vielleicht“ with all required fields for an event that allows it
- **THEN** a registration with status `tentative` and the form answers is stored and the member sees „Du stehst auf der Ersatzbank.“

#### Scenario: Already registered
- **WHEN** an accepted member answers „Vielleicht“ for the same event
- **THEN** the answer is refused with „Du bist bereits registriert.“

#### Scenario: Guests sent
- **WHEN** a member answers „Vielleicht“ and invites a guest
- **THEN** the answer is refused with HTTP 400 and „Gäste sind für dieses Event nicht zugelassen.“

#### Scenario: Slot event
- **WHEN** a member answers „Vielleicht“ on a raid with wanted role „Heiler“
- **THEN** the registration keeps „Heiler“ as wanted role and holds no slot

### Requirement: Tentative registrations take no place
A tentative registration SHALL NOT count as a taken place of the event or of a role slot, SHALL NOT have a waitlist position, and SHALL NOT move up when a place frees. A full event SHALL still accept „Vielleicht“ answers.

#### Scenario: Places unchanged
- **WHEN** an event has 3 of 10 places taken and a member answers „Vielleicht“
- **THEN** the places sentence still reads „3 von 10 Plätzen belegt“

#### Scenario: Full event
- **WHEN** a member answers „Vielleicht“ for a full event
- **THEN** the registration becomes `tentative`, not `waitlisted`

#### Scenario: Place frees
- **WHEN** an accepted member unregisters and the event has one tentative and no waitlisted registration
- **THEN** the tentative registration stays tentative

### Requirement: Tentative registrations grant nothing
A tentative registration SHALL NOT get the event role or event channel access, SHALL NOT receive reminders or a status DM, SHALL NOT create an approval request and SHALL NOT be checked in.

#### Scenario: No role and no DM
- **WHEN** a member answers „Vielleicht“ for an event with an event role and instant approval
- **THEN** the member gets no role, no channel access and no DM

#### Scenario: Reminder
- **WHEN** the 24-hour reminder of an event is sent
- **THEN** tentative members do not get it

### Requirement: Members confirm a tentative registration
A tentative member SHALL be able to „Fest zusagen“. The registration SHALL then get the status a new registration would get at that moment: accepted or pending by approval mode, or waitlisted when no place (or no wanted or fallback role) is free. For the waitlist order it SHALL count as registered at the time of confirming.

#### Scenario: Free place, instant approval
- **WHEN** a tentative member confirms on an event with a free place and instant approval
- **THEN** the registration becomes accepted, the member gets the accepted DM, role and channel access

#### Scenario: Event full
- **WHEN** a tentative member confirms on a full event that already has one waitlisted registration
- **THEN** the registration becomes waitlisted at position 2 of 2

#### Scenario: Slot event
- **WHEN** a tentative member with wanted role „Heiler“ and fallback „Schaden“ confirms while „Heiler“ is full and „Schaden“ is free
- **THEN** the registration is accepted in „Schaden“

### Requirement: Confirming ends with the registration
„Fest zusagen“ SHALL be refused with the existing German messages once the event is over or its registration deadline has passed, and when the event is not active. The registration SHALL then stay tentative. Only the owner of the registration SHALL be able to confirm it.

#### Scenario: After the registration deadline
- **WHEN** a tentative member confirms after the registration deadline
- **THEN** the request is refused with HTTP 400 and „Die Anmeldung für dieses Event ist geschlossen.“ and the registration stays tentative

#### Scenario: Not tentative
- **WHEN** an accepted member sends „Fest zusagen“
- **THEN** the request is refused with HTTP 400 and „Du stehst nicht auf der Ersatzbank.“

### Requirement: Members withdraw a tentative registration
A tentative member SHALL be able to unregister like any member. The unregister deadline SHALL NOT apply to tentative registrations. Withdrawing SHALL send no DM.

#### Scenario: After the unregister deadline
- **WHEN** a tentative member unregisters after the event's unregister deadline
- **THEN** the registration is removed

### Requirement: Admins decide tentative registrations
An admin SHALL be able to accept, waitlist or reject a tentative registration with the existing single status action. Accepting SHALL follow the rules of accepting a pending registration (free wanted role or overbooking with a warning on slot events, accepted DM, role). Waitlisting SHALL count as registered at that time.

#### Scenario: Admin accepts from the bench
- **WHEN** an admin accepts a tentative registration on a full event without slots
- **THEN** it becomes accepted and the member gets the accepted DM

#### Scenario: Admin rejects
- **WHEN** an admin rejects a tentative registration
- **THEN** it becomes rejected and the member gets the rejected DM

### Requirement: The website shows the bench
When an event allows „Vielleicht“ or has tentative registrations, the event page SHALL show „<n> auf der Ersatzbank“ next to the places when n > 0, and to logged-in members the names on the bench, on slot events with their wanted role. The register area SHALL offer „Vielleicht“ next to „Anmelden“ while answering is possible.

#### Scenario: Bench shown
- **WHEN** a logged-in member opens a raid with two tentative registrations
- **THEN** the page shows „2 auf der Ersatzbank“ and both names with their wanted role

#### Scenario: Button hidden
- **WHEN** an event does not allow „Vielleicht“
- **THEN** the register area shows no „Vielleicht“ button

### Requirement: Tentative status is labelled everywhere
A tentative registration SHALL be shown as „Vielleicht“: on the event page as own status „Vielleicht (Ersatzbank)“ with the actions „Fest zusagen“ and „Abmelden“, in the profile's event lists, on the overview cards, in the admin registrations dialog (with accept, waitlist and reject), in a member's details and in Discord's `/meine-events`. The CSV export SHALL carry the status code `tentative`, like the codes of the other statuses.

#### Scenario: Own status on the event page
- **WHEN** a tentative member opens the event
- **THEN** the status reads „Vielleicht (Ersatzbank)“ with buttons „Fest zusagen“ and „Abmelden“

#### Scenario: Admin dialog
- **WHEN** an admin opens the registrations of an event with a tentative registration
- **THEN** its status reads „Vielleicht“ and the actions accept, waitlist and reject are offered

### Requirement: Answering „Vielleicht“ from Discord
A click on an announcement's „Vielleicht“ button SHALL run the same checks as the website. It SHALL open a modal with the form fields and, on slot events, a wanted-role select; without form and slots it SHALL answer at once. The member SHALL get a private German confirmation; refusals SHALL be private German messages.

#### Scenario: Click without form
- **WHEN** a member clicks „Vielleicht“ on an event without form and slots
- **THEN** a tentative registration is stored and the member privately sees „Du stehst auf der Ersatzbank.“ and the announcement shows the bench count

#### Scenario: Setting turned off meanwhile
- **WHEN** a member clicks an older „Vielleicht“ button after the event's setting was turned off
- **THEN** nothing is stored and the member privately sees „Für dieses Event gibt es kein „Vielleicht“.“

### Requirement: Bench data stays minimal
The API SHALL expose the bench of an event to logged-in users only with display name, avatar and on slot events the wanted role. It SHALL NOT expose answer times, form answers or registration ids of other members.

#### Scenario: Event data
- **WHEN** a member reads an event with a bench
- **THEN** the event carries the bench count and sentence but no names

#### Scenario: Participants
- **WHEN** a member reads the participants of an event with a bench
- **THEN** each bench entry carries only display name, avatar and on slot events the wanted role
