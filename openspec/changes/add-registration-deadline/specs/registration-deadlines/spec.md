# Spec Delta

## Purpose

Lets admins close registration, and optionally self-service unregistration, for an event at a fixed time before it starts, on the website and in Discord alike.

## ADDED Requirements

### Requirement: Optional deadlines per event
An event SHALL have two optional deadlines: a registration deadline and an unregister deadline, each a date and time. An event without a deadline SHALL behave as before: registration is open until the event ends, unregistering is always possible.

#### Scenario: Event without deadlines
- **WHEN** an active event has neither deadline and has not ended
- **THEN** members can register and unregister as before

#### Scenario: Existing events after the update
- **WHEN** an event was created before this change and has no deadline fields
- **THEN** it is treated as an event without deadlines

### Requirement: Admins set deadlines in the event wizard
Admins SHALL be able to set, change and clear both deadlines when creating or editing an event. A deadline that is not a valid date, or that lies after the event's end (the end date, else start plus two hours), SHALL be refused with a German message, in the wizard and by the API.

#### Scenario: Valid deadline is saved
- **WHEN** an admin saves an event with a registration deadline one day before the start
- **THEN** the event stores that deadline and editing the event shows it again

#### Scenario: Deadline after the end
- **WHEN** an admin sets an unregister deadline after the event's end
- **THEN** the wizard marks the field and the API answers 400 with a German error

#### Scenario: Clearing a deadline
- **WHEN** an admin empties a deadline field and saves
- **THEN** the event has no such deadline any more

### Requirement: Series dates keep the deadline offset
When an admin creates a recurring event with a deadline, every date of the series SHALL get a deadline with the same distance to its own start as the first date.

#### Scenario: Weekly series
- **WHEN** a weekly series starts Friday 20:00 with registration deadline Thursday 20:00
- **THEN** each later date's registration deadline is 24 hours before its own start

### Requirement: Registration closes at the registration deadline
Once the registration deadline has passed, a new registration SHALL be refused on every channel (website, Discord button, Discord modal, Discord slot buttons) with the German message "Die Anmeldung für dieses Event ist geschlossen.". Registrations made before the deadline SHALL stay unchanged.

#### Scenario: Registering on the website after the deadline
- **WHEN** a member registers through the website after the registration deadline
- **THEN** the API answers 400 with the German message, and no registration is stored

#### Scenario: Discord modal sent after the deadline
- **WHEN** a member opened the Discord modal before the deadline and submits it after
- **THEN** the bot answers ephemerally with the German message and stores nothing

#### Scenario: Registering just before the deadline
- **WHEN** a member registers one minute before the registration deadline
- **THEN** the registration is processed as usual

### Requirement: Slot switches close at the registration deadline
After the registration deadline, members SHALL NOT switch their own slot (website and Discord); the refusal uses the same German message. Admins SHALL still move registrations between slots.

#### Scenario: Member switches slot after the deadline
- **WHEN** a member asks to move to another free slot after the registration deadline
- **THEN** the request is refused with the German message and the slot stays unchanged

### Requirement: Places still move up after the registration deadline
Waitlist promotion, guest invitation answers and admin status changes SHALL keep working between the registration deadline and the end of the event.

#### Scenario: Freed place after the deadline
- **WHEN** an accepted member is removed by an admin after the registration deadline
- **THEN** the oldest fitting waitlisted registration moves up as before

### Requirement: Self-service unregistering closes at the unregister deadline
Once the unregister deadline has passed, members SHALL NOT unregister themselves on any channel (website, `/unregister`, Discord "Abmelden" button); they SHALL receive the German message "Abmelden ist nicht mehr möglich. Wende dich an einen Admin.". Admins SHALL still remove, reject or move registrations.

#### Scenario: Unregistering on the website after the deadline
- **WHEN** a member unregisters through the website after the unregister deadline
- **THEN** the API answers 400 with the German message, and the registration stays

#### Scenario: Discord unregister after the deadline
- **WHEN** a member uses `/unregister` or the "Abmelden" button after the unregister deadline
- **THEN** the bot answers ephemerally with the German message and the registration stays

#### Scenario: Admin removes a registration after the deadline
- **WHEN** an admin rejects a registration after the unregister deadline
- **THEN** the change is applied as before

### Requirement: Members see the deadlines
Members SHALL see "Anmeldung bis <Datum, Uhrzeit>" and "Abmeldung bis <Datum, Uhrzeit>" on the event page and in the Discord announcement for each deadline the event has. After the registration deadline the event page SHALL show that registration is closed instead of the form, the overview card SHALL show "Anmeldung geschlossen", and a registered member SHALL no longer see an unregister button after the unregister deadline.

#### Scenario: Event page before the deadline
- **WHEN** a member opens an event with a registration deadline in the future
- **THEN** the details show "Anmeldung bis" with the date and the form is available

#### Scenario: Event page after the registration deadline
- **WHEN** a member who is not registered opens the event after the registration deadline
- **THEN** the page shows a "registration closed" notice and no form or register button

#### Scenario: Registered member after the unregister deadline
- **WHEN** a registered member opens the event after the unregister deadline
- **THEN** the page shows their status with a hint to contact an admin and no "Abmelden" button

### Requirement: Discord announcement closes at the registration deadline
When the registration deadline passes, the stored Discord announcements of the event SHALL be refreshed once, without "Anmelden" and slot buttons; the link to the event page SHALL stay. Changing the deadline later SHALL allow a new refresh.

#### Scenario: Deadline passes
- **WHEN** the registration deadline of an announced active event passes
- **THEN** within the scheduler interval (5 minutes) its announcements show only the link button

#### Scenario: Deadline moved into the future again
- **WHEN** an admin moves a passed registration deadline into the future
- **THEN** the next announcement refresh shows the registration buttons again
