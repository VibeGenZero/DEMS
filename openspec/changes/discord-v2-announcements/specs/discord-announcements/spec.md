# Spec Delta

## Purpose

Defines how event announcements and date poll messages look in Discord and how posted messages stay up to date, so members see the event's colour, banner and line-up and can register right next to their role.

## ADDED Requirements

### Requirement: Event announcements are framed in the event colour
An event announcement SHALL be one Components V2 message whose content sits in a container with the event's colour. A valid `#rrggbb` event colour SHALL be used as is; without one the container SHALL use the DEMS accent `#8b5cf6`.

#### Scenario: Event with its own colour
- **WHEN** an admin announces an event with the colour `#f59e0b`
- **THEN** the message is one container with the accent colour `#f59e0b`

#### Scenario: Event without a colour
- **WHEN** an admin announces an event whose colour is empty or not a hex colour
- **THEN** the container has the accent colour `#8b5cf6`

### Requirement: Announcement content
The container SHALL show, in this order: the banner as an image when the event has one, the title as a heading, the description, and the facts date, places sentence, access, and, when set, waitlist count, category, registration and unregister deadline. Dates SHALL be shown in the configured time zone in German format.

#### Scenario: Event with banner and deadline
- **WHEN** an event with a banner, 3 of 10 places taken and a registration deadline is announced
- **THEN** the container starts with the banner image, then the title, the description and the facts including "3 von 10 Plätzen belegt" and "Anmeldung bis" with the deadline

#### Scenario: Event without description
- **WHEN** an event without description is announced
- **THEN** the description reads "Keine Beschreibung."

### Requirement: Long descriptions are cut to fit Discord
The whole text of an announcement SHALL stay within Discord's text limit for one message (4000 characters). When it would not, the description SHALL be cut and end with "…"; the event page SHALL keep the full description. A cut SHALL never split an emoji.

#### Scenario: Description of 5000 characters
- **WHEN** an event with a 5000-character description is announced
- **THEN** Discord accepts the message, the description ends with "…" and the whole message text is at most 4000 characters

### Requirement: Line-up with a button per role
For an event with slots the container SHALL show one block per slot with the slot label, the taken and total places (marked full or overbooked), and the first five names then "+N" (or "— frei —"). While the event can be joined from Discord, each block SHALL carry that slot's button beside it; a full slot's button SHALL say "(voll)" and stay clickable.

#### Scenario: Slot event open for registration
- **WHEN** a slot event with the slots Tank (2/2) and Heiler (1/3) is announced and can be joined from Discord
- **THEN** the message shows a Tank block marked full with the button "Tank (voll)" beside it and a Heiler block with the button "Heiler"

#### Scenario: Ten slots
- **WHEN** an event with the maximum of ten slots is announced
- **THEN** Discord accepts the message and every slot has its own block with its button

#### Scenario: Registration closed
- **WHEN** the registration deadline of a slot event has passed
- **THEN** the line-up blocks are still shown with their names but without buttons

### Requirement: Buttons at the end of an announcement
Below the content the announcement SHALL show "Anmelden" for an event without slots while it can be joined from Discord, and always the link button "Zum Event" to the event page.

#### Scenario: Event without slots
- **WHEN** an event without slots that can be joined from Discord is announced
- **THEN** the last row holds "Anmelden" and "Zum Event"

#### Scenario: Form too big for Discord
- **WHEN** an event whose form does not fit into a Discord modal is announced
- **THEN** the last row holds only "Zum Event"

### Requirement: Pings and custom text above the announcement
Role mentions, `@everyone` and the admin's custom text SHALL appear as text above the container and SHALL notify as chosen when the announcement is posted. Later updates of the message SHALL keep this text without notifying again.

#### Scenario: Announcement with role ping
- **WHEN** an admin announces an event with the role "Raider" and the text "Heute Abend!"
- **THEN** members with "Raider" are notified and the text "@Raider" and "Heute Abend!" stands above the container

#### Scenario: Update after a registration
- **WHEN** a member registers for that event afterwards
- **THEN** the message is updated, still shows "@Raider" and "Heute Abend!", and nobody is notified again

### Requirement: Posted announcements stay up to date
Whenever the line-up, deadline state, status or details of an announced event change, every stored announcement of the event SHALL be re-rendered in this layout. An announcement whose message was deleted SHALL be dropped from the event; other failures SHALL be logged and the announcement kept.

#### Scenario: Registration updates the line-up
- **WHEN** a member takes the last Heiler place of an announced event
- **THEN** the announcement shows the Heiler block as full with the button "Heiler (voll)"

#### Scenario: Deleted message
- **WHEN** an announcement message was deleted in Discord and the event is updated
- **THEN** the announcement is removed from the event and the others are updated

### Requirement: Announcements posted before this change are converted
An announcement posted as a classic embed before this change SHALL be turned into the new layout on its next update, keeping its pings. When Discord refuses the conversion, the message SHALL stay as it is, the failure SHALL be logged and the announcement SHALL be kept.

#### Scenario: Old embed announcement
- **WHEN** an event announced before this change gets a new registration
- **THEN** its announcement message now shows the container layout instead of the embed

### Requirement: Date poll messages use the same frame
A posted date poll SHALL be one Components V2 container: accent colour while open, green when decided, grey when closed or deleted. It SHALL show the title, the description (or the chosen date when decided), each option with its yes and maybe counts and first five yes-names, and the deadline or end state with the vote count. "Abstimmen" (while open) and the link buttons SHALL follow below.

#### Scenario: Open poll
- **WHEN** an admin posts an open poll with a deadline
- **THEN** the message is an accent-coloured container with the options, the favourite marked, "Abstimmung bis" with the deadline and the buttons "Abstimmen" and "Im Web ansehen"

#### Scenario: Decided poll
- **WHEN** an admin decides the poll and creates the event
- **THEN** the posted messages turn green, show "Termin steht" with the chosen date and the button "Zum Event"

#### Scenario: Deleted poll
- **WHEN** an admin deletes a posted poll
- **THEN** its messages turn into a grey container "Abstimmung gelöscht" without buttons

### Requirement: The wizard preview shows the new layout
The Discord preview in the event wizard SHALL draw the announcement as the bot would post it now: the container in the event colour, banner, text, line-up blocks with their buttons and the button row.

#### Scenario: Colour changed in the wizard
- **WHEN** an admin changes the event colour in the wizard
- **THEN** the preview's container border takes the new colour
