# Spec Delta

## MODIFIED Requirements

### Requirement: Unused banner files are deleted
When an event's banner is replaced or cleared, an event or series is deleted, events are wiped by the admin reset, or an event template's banner is replaced or the template is deleted, the system SHALL delete each uploaded file no event and no event template uses anymore and SHALL keep files other events (series, duplicates) or templates still use. On startup it SHALL delete uploaded files older than 24 hours that no event and no template uses. External URLs SHALL never cause a deletion. A failed deletion SHALL be logged and not fail the request.

#### Scenario: Banner replaced
- **WHEN** an admin replaces an event's uploaded banner with a new upload and saves
- **THEN** the old file is deleted

#### Scenario: Shared by a duplicate
- **WHEN** an event with an uploaded banner was duplicated and the original is deleted
- **THEN** the file stays because the copy still uses it

#### Scenario: Upload never saved
- **WHEN** an admin uploaded an image, closed the wizard without saving and the server starts more than 24 hours later
- **THEN** the file is deleted on startup

#### Scenario: Fresh upload not yet saved
- **WHEN** the server starts while an unsaved upload is only one hour old
- **THEN** the file is kept

#### Scenario: Kept by a template
- **WHEN** an event and a template use the same uploaded banner and the event is deleted
- **THEN** the file stays because the template still uses it

#### Scenario: Template deleted
- **WHEN** an admin deletes the only template that uses an uploaded banner no event uses
- **THEN** the file is deleted

#### Scenario: Template banner replaced
- **WHEN** an admin overwrites a template whose uploaded banner no event uses with a different banner
- **THEN** the old file is deleted
