# discord-slash-commands Specification

## Purpose
Defines the bot's slash commands, their German names and what each command answers, so members can find, join and leave events without leaving Discord.

## Requirements

### Requirement: Commands have German names
The commands `/register` and `/unregister` SHALL be shown to members with a German Discord client as `/anmelden` and `/abmelden`, with German descriptions. Members with another client language SHALL keep the names `/register` and `/unregister`. Both names SHALL run the same command.

#### Scenario: German client
- **WHEN** a member whose Discord language is German types `/`
- **THEN** the bot offers `/anmelden` and `/abmelden` with German descriptions

#### Scenario: English client
- **WHEN** a member whose Discord language is English types `/`
- **THEN** the bot offers `/register` and `/unregister`

### Requirement: /register checks the registration conditions first
`/register event:<event>` SHALL check the same conditions as the "Anmelden" button of an announcement before showing any form: maintenance, event status, event over, registration deadline, already registered and required role. A failed check SHALL be answered privately with the same German message as the button, and no registration SHALL be created.

#### Scenario: Unknown event
- **WHEN** a member runs `/register` with an event that does not exist
- **THEN** the bot answers privately "❌ Event nicht gefunden."

#### Scenario: Already registered
- **WHEN** a member runs `/register` for an event they are registered for
- **THEN** the bot answers privately "❌ Du bist bereits für dieses Event registriert." and nothing changes

#### Scenario: Registration deadline passed
- **WHEN** a member runs `/register` after the event's registration deadline
- **THEN** the bot answers privately with the registration-closed message and creates no registration

### Requirement: /register registers events without slots directly
For an event without slots that passed the checks, `/register` SHALL behave like the "Anmelden" button: with a form it SHALL open the registration form as a Discord modal; without a form it SHALL create the registration at once and answer privately with the result (accepted, pending or waitlist), including the DM, role and announcement update the button triggers.

#### Scenario: Event without form
- **WHEN** a member runs `/register` for an open event without slots and without form
- **THEN** the member is registered and the private answer shows the registration result

#### Scenario: Event with a small form
- **WHEN** a member runs `/register` for an open event without slots whose form fits into a Discord modal
- **THEN** the registration modal opens and submitting it registers the member as the button flow does

### Requirement: /register offers the slots of slot events
For an event with slots that passed the checks, `/register` SHALL answer privately with one button per slot, labelled like the announcement's slot buttons (a full slot says "(voll)" and stays clickable). A click SHALL continue exactly like the slot button of the announcement (form or fallback roles in a modal, waitlist when full).

#### Scenario: Two slots, one full
- **WHEN** a member runs `/register` for an open slot event with the slots Tank (1/1) and Heiler (0/1)
- **THEN** the private answer shows the buttons "Tank (voll)" and "Heiler"

#### Scenario: Choosing a slot
- **WHEN** the member clicks "Heiler" in that answer
- **THEN** the bot continues as if "Heiler" had been clicked on the announcement

### Requirement: /register falls back to the website for big forms
When the event's form does not fit into a Discord modal, `/register` SHALL answer privately with the link to the event page instead of a form or slot buttons.

#### Scenario: Form with too many fields
- **WHEN** a member runs `/register` for an event whose form has more fields than a Discord modal allows
- **THEN** the bot answers privately with the hint that the form is too big for Discord and the event page link

### Requirement: /my-events lists the member's upcoming registrations
`/my-events` (German clients: `/meine-events`) SHALL answer privately with the member's registrations for events that are not over, cancelled or archived, next event first. Each entry SHALL show the event title, its start in German format and the configured time zone, the status and, for slot events, the slot.

#### Scenario: Member with two registrations
- **WHEN** a member registered for a raid on Friday and a game night on Saturday runs `/meine-events`
- **THEN** only they see an answer listing the raid first, then the game night, each with title, start and status

#### Scenario: Past and archived events are left out
- **WHEN** a member with a registration for a past event and one for an archived event runs `/meine-events`
- **THEN** neither event is listed

#### Scenario: German name
- **WHEN** a member whose Discord language is German types `/`
- **THEN** the bot offers `/meine-events`; other languages see `/my-events`

### Requirement: Status and slot of each entry
The status SHALL read "Angemeldet", "Anfrage ausstehend", "Warteliste – Platz N von M" or "Abgelehnt". For slot events the entry SHALL name the taken slot with its emoji; a pending or waitlisted registration without a slot SHALL name the wished main role as a wish.

#### Scenario: Waitlisted member
- **WHEN** the member is second of three on the waitlist of a full event
- **THEN** the entry reads "Warteliste – Platz 2 von 3"

#### Scenario: Slot taken
- **WHEN** the member is accepted as "Heiler" in a slot event
- **THEN** the entry names "💚 Heiler"

### Requirement: Empty and long lists
Without upcoming registrations the answer SHALL say so in German and link the event overview. The answer SHALL list at most five events; with more, a closing line SHALL name how many are not shown and link the profile page.

#### Scenario: No registrations
- **WHEN** a member without upcoming registrations runs `/meine-events`
- **THEN** the private answer says they are not registered for any upcoming event and links the event overview

#### Scenario: Seven registrations
- **WHEN** a member with seven upcoming registrations runs `/meine-events`
- **THEN** the next five events are listed and a closing line says "2 weitere" with the link to the profile page

### Requirement: Leaving from the overview asks first
Each entry SHALL carry „Abmelden“ while the member may still unregister and the registration is not rejected. A click SHALL answer privately „Wirklich von **<Titel>** abmelden?“ with „Ja, abmelden“ and „Abbrechen“. Only „Ja, abmelden“ SHALL unregister, with the same effects and messages as unregistering anywhere else; „Abbrechen“ SHALL change nothing.

#### Scenario: Confirmed
- **WHEN** the member clicks „Abmelden“ and then „Ja, abmelden“
- **THEN** the registration is deleted, the event role is removed, the waitlist moves up and the answer reads "✅ Du wurdest von **<Titel>** abgemeldet."

#### Scenario: Cancelled
- **WHEN** the member clicks „Abmelden“ and then „Abbrechen“
- **THEN** the registration stays and the answer says the unregistering was cancelled

#### Scenario: Unregister deadline passed
- **WHEN** the unregister deadline of the event has passed
- **THEN** the entry has no „Abmelden“ button

### Requirement: Switching the slot from the overview
An entry of a slot event SHALL carry „Slot wechseln“ while registration is open and the member holds a slot. A click SHALL answer privately with one button per other slot that has a free place („Zu <Slot> wechseln“); a click on one SHALL switch exactly like the switch button of the slot answer. Without a free other slot the answer SHALL say so.

#### Scenario: Free other slot
- **WHEN** a member holding "Tank" clicks „Slot wechseln“ while "Heiler" has a free place and "Schaden" is full
- **THEN** the answer offers only „Zu Heiler wechseln“, and clicking it moves the member to "Heiler"

#### Scenario: No free slot
- **WHEN** every other slot is full
- **THEN** the answer says that no other slot is free right now

#### Scenario: Registration closed
- **WHEN** the registration deadline has passed
- **THEN** the entry has no „Slot wechseln“ button

### Requirement: Link to the event
Every entry SHALL carry the link button „Zum Event“ to the event page.

#### Scenario: Rejected registration
- **WHEN** the member's registration was rejected
- **THEN** the entry shows "Abgelehnt" and only the „Zum Event“ button
