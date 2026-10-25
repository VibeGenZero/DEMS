# Spec Delta

## Purpose

Lets admins store the recurring setup of an event type (form, slots, roles, reminders, channels, messages) as a named template and start new events from it in the event wizard.

## ADDED Requirements

### Requirement: Templates hold the recurring event settings
An event template SHALL store a name and these event settings: title, description, banner, accent colour, category, location, maximum participants, access mode, required roles, approval mode, guests allowed, role slots, assigned role, form fields, reminder hours, check-in message, automatic channels with their channel settings, and custom bot messages.

#### Scenario: Settings are kept
- **WHEN** an admin saves a template with three slots, a form field "Charaktername" and approval mode `manual`
- **THEN** listing the templates shows the three slots, the form field and approval mode `manual`

### Requirement: Templates never hold date or lifecycle data
A template SHALL NOT store start or end, registration or unregister deadline, status, series settings, Discord ids, announcements, check-in code or any "already sent" flag. Such fields in a request SHALL be ignored, not refused.

#### Scenario: Date fields are dropped
- **WHEN** an admin saves a template whose settings contain `startDate`, `status: 'active'`, `checkinCode` and `recurring: true`
- **THEN** the stored template contains none of these fields

#### Scenario: Reminders without sent state
- **WHEN** an admin saves a template with reminder hours 24 and 1
- **THEN** the template stores the hours 24 and 1 and no sent state

### Requirement: Admins list the shared templates
The system SHALL give every admin the same list of all templates, sorted by name, each with its id, name, settings, creator and last change. Only admins SHALL be able to read templates; members SHALL get 403.

#### Scenario: Two admins see the same list
- **WHEN** one admin created the template "Raid-Abend" and another admin lists the templates
- **THEN** the list contains "Raid-Abend" with the creator's id

#### Scenario: Member is refused
- **WHEN** a logged-in member without admin rights requests the template list
- **THEN** the answer is 403

### Requirement: Admins create a template under a unique name
An admin SHALL be able to create a template with a name of 1 to 80 characters after trimming. A name that another template already has (ignoring case) SHALL be refused with 409 and "Eine Vorlage mit diesem Namen gibt es schon."; an empty or too long name with 400 and "Der Name der Vorlage muss 1 bis 80 Zeichen lang sein.". When 50 templates exist, a new one SHALL be refused with 400 and "Es sind höchstens 50 Vorlagen möglich.". Creation SHALL be written to the audit log.

#### Scenario: New template
- **WHEN** an admin creates the template "Spieleabend" from the wizard inputs
- **THEN** the answer is 200 with the stored template and the audit log has a `CREATE_EVENT_TEMPLATE` entry

#### Scenario: Name taken
- **WHEN** a template "Raid-Abend" exists and an admin creates one named "raid-abend"
- **THEN** the answer is 409 with "Eine Vorlage mit diesem Namen gibt es schon." and no template is added

#### Scenario: Missing CSRF token
- **WHEN** an admin creates a template without the `X-CSRF-TOKEN` header
- **THEN** the request is refused and no template is added

### Requirement: Template settings are checked like event settings
Saving a template SHALL check its settings with the same rules as saving an event, except that the title may be empty: role slots follow the slot rules, the banner SHALL be empty, an http(s) URL or an existing uploaded banner, and the accent colour SHALL be a hex colour. A failing check SHALL be refused with 400 and the same German message as for events, and nothing SHALL be stored.

#### Scenario: Bad banner
- **WHEN** an admin saves a template with banner `javascript:alert(1)`
- **THEN** the answer is 400 with "Banner muss eine http(s)-URL oder ein hochgeladenes Bild sein."

#### Scenario: Empty title allowed
- **WHEN** an admin saves a template named "Leer" with an empty title
- **THEN** the template is stored

### Requirement: Admins overwrite a template
An admin SHALL be able to replace the name and settings of an existing template; the same name, check and audit rules as for creating apply (a rename to a name another template has SHALL get 409). The template SHALL remember who changed it and when. An unknown template id SHALL be answered with 404 and "Vorlage nicht gefunden".

#### Scenario: Overwrite
- **WHEN** an admin overwrites "Raid-Abend" with new form fields
- **THEN** listing the templates shows the new form fields, the admin as last editor and an `UPDATE_EVENT_TEMPLATE` audit entry exists

#### Scenario: Unknown template
- **WHEN** an admin overwrites a template id that does not exist
- **THEN** the answer is 404 with "Vorlage nicht gefunden"

### Requirement: Admins delete a template
An admin SHALL be able to delete a template. Events created from it SHALL stay unchanged. The deletion SHALL be written to the audit log; an unknown id SHALL be answered with 404 and "Vorlage nicht gefunden".

#### Scenario: Delete
- **WHEN** an admin deletes the template "Spieleabend" that an event was started from
- **THEN** the template is gone from the list, the event is unchanged and a `DELETE_EVENT_TEMPLATE` audit entry exists

### Requirement: The wizard starts a new event from a template
When an admin creates a new event and at least one template exists, step 1 of the wizard SHALL show a "Aus Vorlage starten" chooser listing the templates by name. Choosing one SHALL fill every template setting into the wizard, replacing the current inputs of those settings, keep dates and status untouched and show the toast "Vorlage „<Name>“ übernommen.". The event SHALL keep no link to the template. When editing an existing event the chooser SHALL be hidden.

#### Scenario: Apply a template
- **WHEN** an admin opens "Neues Event erstellen" and chooses the template "Raid-Abend" with three slots and a form field "Charaktername"
- **THEN** the wizard shows the template's title, the three slots and the form field, the date fields stay empty, and saving creates an event with these settings

#### Scenario: No templates
- **WHEN** no template exists and an admin opens "Neues Event erstellen"
- **THEN** no template chooser is shown

#### Scenario: Editing an event
- **WHEN** an admin opens an existing event in the wizard
- **THEN** no template chooser is shown

### Requirement: The wizard saves its inputs as a template
The wizard footer SHALL offer "Als Vorlage speichern" for new and existing events. It SHALL open an inline name field, prefilled with the name of the template the wizard was started from. Saving SHALL create a template from the current inputs; if the name matches an existing template, the wizard SHALL first show the inline warning "Die Vorlage „<Name>“ wird überschrieben." and overwrite it only after a second click. Success SHALL show a toast; the event itself SHALL not be saved by this action.

#### Scenario: Save as new template
- **WHEN** an admin fills the wizard, clicks "Als Vorlage speichern", types "Turnier" and confirms
- **THEN** a template "Turnier" exists with the wizard's settings and no event was created

#### Scenario: Overwrite after warning
- **WHEN** an admin types the name of the existing template "Raid-Abend" and clicks save once
- **THEN** the warning "Die Vorlage „Raid-Abend“ wird überschrieben." is shown and nothing is saved until the second click

### Requirement: The wizard deletes a template after confirmation
Next to the template chooser the wizard SHALL offer a delete button for the chosen template. It SHALL ask for an inline confirmation before deleting; afterwards the template SHALL disappear from the chooser and the wizard inputs SHALL stay as they are.

#### Scenario: Delete from the wizard
- **WHEN** an admin chooses "Spieleabend", clicks delete and confirms
- **THEN** the template is deleted, the chooser no longer lists it and the filled inputs stay
