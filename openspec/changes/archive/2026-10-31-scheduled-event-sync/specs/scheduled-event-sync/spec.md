# Spec Delta

## Purpose

Keeps the Discord server event created by „Mit Discord synchronisieren“ in step with its DEMS event — details, removal and status — so members see the same event in Discord as on the website.

## ADDED Requirements

### Requirement: Edits update the Discord event
Saving a synced event SHALL update its Discord event's name, description, start, end and location, and its image when the banner changed. Dates of a series saved together SHALL each update their own Discord event. A failed update SHALL NOT fail the save.

#### Scenario: Start moved
- **WHEN** an admin moves the start of a synced event from 19:00 to 20:00
- **THEN** the Discord event starts at 20:00

#### Scenario: Series edited
- **WHEN** an admin changes the title of a series date with „Dieser und alle folgenden Termine“ and two of those dates are synced
- **THEN** both Discord events carry the new title

#### Scenario: Not synced
- **WHEN** an admin saves an event that was never synced
- **THEN** nothing is sent to Discord

#### Scenario: Discord refuses
- **WHEN** the bot cannot edit the Discord event
- **THEN** the event is saved and the failure is logged

### Requirement: Location of the Discord event
The Discord event SHALL be a voice event in the event's own voice channel or a chosen voice location, and otherwise an external event with the event's location text, or „Discord“ when there is none.

#### Scenario: Location text
- **WHEN** a synced event has the location text "Gemeindehaus"
- **THEN** the Discord event is external with the location "Gemeindehaus"

#### Scenario: Voice location
- **WHEN** a synced event's location is a voice channel
- **THEN** the Discord event takes place in that voice channel

### Requirement: Cancelling, deleting and drafting remove the Discord event
Cancelling a synced event, deleting it (alone or with its series) and setting it back to draft SHALL remove its Discord event. A cancelled or drafted event SHALL count as not synced afterwards.

#### Scenario: Cancelled
- **WHEN** an admin cancels a synced event
- **THEN** its Discord event disappears and the event no longer counts as synced

#### Scenario: Series deleted
- **WHEN** an admin deletes a series with three synced dates
- **THEN** the three Discord events disappear

#### Scenario: Back to draft
- **WHEN** an admin sets a synced active event back to draft
- **THEN** its Discord event disappears and „Mit Discord synchronisieren“ is offered again

### Requirement: The Discord status follows start and end
At the start time the Discord event SHALL be set to running, and once the event is over (its end, else start + 2 hours) to completed, checked every 5 minutes. „Starten“ SHALL set it to running at once and „Beenden“ to completed at once. A Discord event that was never started SHALL still end as completed. While the bot is offline the status SHALL be set once it is back, as long as the event still exists.

#### Scenario: Start time reached
- **WHEN** a synced event's start time passes
- **THEN** within 5 minutes its Discord event shows as running

#### Scenario: Event over
- **WHEN** a synced event's end passes
- **THEN** within 5 minutes its Discord event is completed

#### Scenario: Admin ends early
- **WHEN** an admin clicks „Beenden“ on a running synced event
- **THEN** its Discord event is completed at once

#### Scenario: Bot offline at the start
- **WHEN** the bot was offline at the start and connects while the event runs
- **THEN** the next scheduler pass sets the Discord event to running

### Requirement: A Discord event deleted in Discord is forgotten
When the Discord event no longer exists in Discord, the event SHALL count as not synced, so it can be synced again.

#### Scenario: Deleted by a moderator
- **WHEN** a moderator deleted the Discord event and an admin saves the DEMS event
- **THEN** the event is saved, counts as not synced and „Mit Discord synchronisieren“ is offered again

### Requirement: Copies are never synced
Duplicating an event and the dates added by extending a series SHALL NOT be linked to the original's Discord event.

#### Scenario: Duplicate of a synced event
- **WHEN** an admin duplicates a synced event
- **THEN** the copy counts as not synced and editing it does not change the original's Discord event
