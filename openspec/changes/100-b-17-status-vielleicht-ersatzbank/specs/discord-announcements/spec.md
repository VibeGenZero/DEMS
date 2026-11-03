# Spec Delta

## MODIFIED Requirements

### Requirement: Announcement content
The container SHALL show, in this order: the banner as an image when the event has one, the title as a heading, the description, and the facts date, places sentence, access, and, when set, waitlist count, bench count („Ersatzbank“, number of tentative registrations), category, registration and unregister deadline. Dates SHALL be shown in the configured time zone in German format.

#### Scenario: Event with banner and deadline
- **WHEN** an event with a banner, 3 of 10 places taken and a registration deadline is announced
- **THEN** the container starts with the banner image, then the title, the description and the facts including "3 von 10 Plätzen belegt" and "Anmeldung bis" with the deadline

#### Scenario: Event without description
- **WHEN** an event without description is announced
- **THEN** the description reads "Keine Beschreibung."

#### Scenario: Bench count
- **WHEN** an event with 2 tentative registrations is announced
- **THEN** the facts contain the line "Ersatzbank: 2" after the waitlist line and the places sentence does not count them

#### Scenario: Empty bench
- **WHEN** an event without tentative registrations is announced
- **THEN** the facts contain no bench line

### Requirement: Buttons at the end of an announcement
Below the content the announcement SHALL show "Anmelden" for an event without slots while it can be joined from Discord, then "Vielleicht" for any event that allows tentative answers while it can be joined from Discord, and always the link button "Zum Event" to the event page.

#### Scenario: Event without slots
- **WHEN** an event without slots that can be joined from Discord is announced
- **THEN** the last row holds "Anmelden" and "Zum Event"

#### Scenario: Form too big for Discord
- **WHEN** an event whose form does not fit into a Discord modal is announced
- **THEN** the last row holds only "Zum Event"

#### Scenario: Event allows „Vielleicht“
- **WHEN** an event without slots that allows tentative answers and can be joined from Discord is announced
- **THEN** the last row holds "Anmelden", "Vielleicht" and "Zum Event"

#### Scenario: Slot event allows „Vielleicht“
- **WHEN** a slot event that allows tentative answers and can be joined from Discord is announced
- **THEN** the last row holds "Vielleicht" and "Zum Event" and the role buttons stay beside the line-up

#### Scenario: Registration closed
- **WHEN** the registration deadline of an event that allows tentative answers has passed and its announcement is refreshed
- **THEN** the last row holds only "Zum Event"
