# Spec Delta

## Purpose

Lets admins change several dates of a recurring event in one save and extend a series to a later end date, instead of editing every date by hand or creating a new series.

## ADDED Requirements

### Requirement: Scope choice when editing a series date
When an admin edits a date that belongs to a series and at least one later date of that series can still be changed, the wizard SHALL show next to "Speichern" the choice "Nur dieser Termin" and "Dieser und alle folgenden Termine", with "Nur dieser Termin" selected. The choice SHALL NOT appear when creating an event or editing an event without a series.

#### Scenario: Editing a series date
- **WHEN** an admin edits the second of four upcoming dates of a weekly series and goes to the last step
- **THEN** the choice is visible with "Nur dieser Termin" selected

#### Scenario: Last changeable date
- **WHEN** an admin edits the last date of a series and every other date is earlier
- **THEN** the choice does not appear

#### Scenario: Single event
- **WHEN** an admin edits an event without a series
- **THEN** the choice does not appear

### Requirement: Only this date by default
A save of a series date without a scope, or with "Nur dieser Termin", SHALL change only that date, exactly as before this change.

#### Scenario: Default scope
- **WHEN** an admin changes the title of a series date and saves with "Nur dieser Termin"
- **THEN** only that date has the new title and every other date keeps its title

#### Scenario: Older client
- **WHEN** a save request for a series date carries no scope
- **THEN** only that date is changed

### Requirement: Which dates follow
With "Dieser und alle folgenden Termine" the server SHALL change the edited date and every other date of the same series that starts later than the edited date did before the save, is not over, and is neither cancelled nor archived. Earlier, ended, cancelled and archived dates SHALL stay unchanged.

#### Scenario: Earlier and later dates
- **WHEN** an admin saves the third of five dates with "Dieser und alle folgenden Termine"
- **THEN** dates three, four and five are changed and dates one and two are not

#### Scenario: Cancelled later date
- **WHEN** one of the later dates is cancelled
- **THEN** that date keeps its old settings and stays cancelled

#### Scenario: Draft later date
- **WHEN** one of the later dates is a draft
- **THEN** its settings are changed and it stays a draft

### Requirement: Settings copied to the following dates
The following dates SHALL take the saved title, description, banner, accent colour, location, category, places and slots, access mode, required roles, approval mode, assigned role, form fields, reminder hours, check-in message, bot messages, channel settings and guest setting. Each date SHALL keep its own status, registrations, check-in code and check-in state, and reminders already sent for an unchanged start SHALL stay sent.

#### Scenario: Description and places
- **WHEN** an admin changes the description and raises the places from 10 to 12 for this and all following dates
- **THEN** every following date shows the new description and has 12 places

#### Scenario: Status stays per date
- **WHEN** the edited date is active, a following date is a draft and the admin saves with "Dieser und alle folgenden Termine"
- **THEN** the following date is still a draft

#### Scenario: Registrations stay
- **WHEN** a following date has three accepted members
- **THEN** after the save the three members are still accepted for that date

### Requirement: Start time and duration copied, days kept
Each following date SHALL keep its own calendar day in the configured time zone, take the start time of the edited date and the edited date's duration; without an end on the edited date the following dates SHALL have no end. Registration and unregister deadlines SHALL keep the edited date's distance to the start, or be empty when the edited date has none.

#### Scenario: New start time
- **WHEN** a weekly series runs Fridays 20:00–22:00 and the admin changes one date to 19:30–22:00 for this and all following dates
- **THEN** every following date starts at 19:30 and ends at 22:00 on its own Friday

#### Scenario: Day of the edited date moved
- **WHEN** the admin moves the edited date from Friday to Saturday and keeps the time
- **THEN** the following dates stay on their Fridays

#### Scenario: Daylight saving time
- **WHEN** the start time is changed to 19:30 and a following date lies after the switch to winter time
- **THEN** that date also starts at 19:30 local time

#### Scenario: Deadline offset
- **WHEN** the edited date has a registration deadline 24 hours before its start
- **THEN** every following date gets a registration deadline 24 hours before its own start

### Requirement: Slot changes checked for every date
Before any date is written, the server SHALL check the new slots against the registrations of every affected date. When a slot change is not allowed for one date, the server SHALL refuse the whole save with a German error message that names that date, and no date SHALL be changed.

#### Scenario: Removed slot still used on a later date
- **WHEN** the admin removes the slot "Heiler" for this and all following dates and a member is accepted as "Heiler" on the date of 14.11.
- **THEN** the save is refused with a message naming the 14.11., and no date is changed

### Requirement: Change DMs per date
When the admin asks for a change notification, every affected date that is active after the save and whose start, end or location changed SHALL notify its own recipients by the rules of the change notification. A user who takes part in several affected dates SHALL receive one DM per date.

#### Scenario: Start time changed for three dates
- **WHEN** the start time changes for three active dates with notification and a member is accepted for two of them
- **THEN** that member receives two DMs, one per date

#### Scenario: Only the title changed
- **WHEN** only the title changes for this and all following dates with the switch on
- **THEN** no DM is sent

### Requirement: Feedback after saving several dates
The save answer SHALL report how many following dates were changed. The admin SHALL see a German toast that names the number of changed following dates and, when DMs were sent, the total number of notified participants.

#### Scenario: Three following dates
- **WHEN** an admin saves with "Dieser und alle folgenden Termine" and three following dates are changed without notification
- **THEN** the admin sees "Event und 3 folgende Termine aktualisiert!"

#### Scenario: With notification
- **WHEN** three following dates are changed and five participants are notified in total
- **THEN** the admin sees "Event und 3 folgende Termine aktualisiert – 5 Teilnehmer benachrichtigt."

### Requirement: Extending a series
When a date of a series is saved with a later "Wiederholen bis" than stored, the server SHALL create the missing dates after the last date of the series in the series' interval, up to and including the new end day, and store the new "Wiederholen bis" on every date of the series. This SHALL work with either scope.

#### Scenario: Weekly series extended by two weeks
- **WHEN** a weekly series ends on 28.11. and an admin sets "Wiederholen bis" to 12.12.
- **THEN** dates on 05.12. and 12.12. are created and every date of the series shows "Wiederholen bis" 12.12.

#### Scenario: End day inclusive
- **WHEN** the new end day is the day of a date in the rhythm
- **THEN** that date is created

### Requirement: New dates copy the last date
A date created by an extension SHALL copy the settings and status of the latest series date that is a draft or active, falling back to the edited date, and SHALL keep that date's start time, duration and deadline offsets on its own day. It SHALL start without registrations, check-in code or check-in state, and without reminders or start notification marked as sent.

#### Scenario: Copy of the last date
- **WHEN** the last date of the series has 12 places and the slot "Tank"
- **THEN** every new date has 12 places, the slot "Tank" and no registrations

### Requirement: A series cannot be shortened or changed in rhythm
The server SHALL refuse a save of a series date whose "Wiederholen bis" lies before the stored one with the German message "„Wiederholen bis“ kann nur verlängert werden. Einzelne Termine löschst du in der Terminliste." and change nothing. For a series date the server SHALL keep the stored interval and keep the date part of its series, whatever the request says; the wizard SHALL show the switch "Wiederholendes Event" and the interval as not changeable for such a date.

#### Scenario: Earlier end
- **WHEN** an admin sets "Wiederholen bis" of a series from 12.12. to 28.11.
- **THEN** the save is refused with the message and no date is changed or deleted

#### Scenario: Interval in the request
- **WHEN** a save request for a weekly series date sends the interval "monthly"
- **THEN** the date stays weekly and an extension follows the weekly rhythm

### Requirement: Audit entries for series changes
Applying changes to following dates SHALL write one audit entry by the acting admin that names the series title and the number of changed following dates. Extending a series SHALL write one audit entry that names the new end day and the number of created dates.

#### Scenario: Following dates changed
- **WHEN** an admin applies changes to three following dates
- **THEN** the audit log contains one entry for the series naming three dates

#### Scenario: Series extended
- **WHEN** an extension creates two dates
- **THEN** the audit log contains one entry naming the new end day and two created dates
