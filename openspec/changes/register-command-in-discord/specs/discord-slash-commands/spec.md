# Spec Delta

## Purpose

Defines the bot's slash commands, their German names and what each command answers, so members can find, join and leave events without leaving Discord.

## ADDED Requirements

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
