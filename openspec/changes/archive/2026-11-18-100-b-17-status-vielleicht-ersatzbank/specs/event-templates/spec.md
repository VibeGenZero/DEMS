# Spec Delta

## MODIFIED Requirements

### Requirement: Templates hold the recurring event settings
An event template SHALL store a name and these event settings: title, description, banner, accent colour, category, location, maximum participants, access mode, required roles, approval mode, guests allowed, „Vielleicht“ allowed, role slots, assigned role, form fields, reminder hours, check-in message, automatic channels with their channel settings, and custom bot messages.

#### Scenario: Settings are kept
- **WHEN** an admin saves a template with three slots, a form field "Charaktername" and approval mode `manual`
- **THEN** listing the templates shows the three slots, the form field and approval mode `manual`

#### Scenario: „Vielleicht“ is kept
- **WHEN** an admin saves a template from a wizard with „Vielleicht“ allowed and later starts a new event from it
- **THEN** the wizard of the new event has „Vielleicht“ allowed
