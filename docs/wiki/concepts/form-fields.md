---
id: form-fields
title: Registration form fields — types, web widgets, Discord components
type: concept
tags: [forms, form-fields, discord-modal, entity-picker, validation]
sources: [utils/formFields.js, bot.js, public/js/events/registration-form.js, public/js/admin/wizard-builders.js]
see_also: [registration-flow, discord-integration, add-form-field-type]
---
# Registration form fields — types, web widgets, Discord components

> TL;DR: An event's `formFields` is a list of `{ label, type, required, options[], description }`. Eight types exist (`text`, `textarea`, `dropdown`, `checkbox`, `user`, `role`, `channel`, `mentionable`); each maps to a web widget and a Discord modal component. Answers are stored in `registration.formAnswers` keyed by the label, in the same format from web and Discord. Forms with more than 5 fields are web-only.

## Type matrix

| Type | Web widget (`renderFormFields` in `events/registration-form.js`) | Discord modal component (`applyFieldComponent` in bot.js) | Stored answer |
|---|---|---|---|
| `text` (default/unknown) | input | TextInput short | string |
| `textarea` | textarea | TextInput paragraph | string |
| `dropdown` | select of `options` | StringSelect (values = option index) | option text |
| `checkbox` | checkbox | StringSelect Ja/Nein | boolean |
| `user` | member search (entity picker) | UserSelect | `@Name (id)` |
| `role` | role list from `/api/events/form-options` | RoleSelect | `@Role (id)` |
| `channel` | public channel list from `/api/events/form-options` | ChannelSelect (text, voice, announcement, stage, forum) | `#name (id)` |
| `mentionable` | combined search | MentionableSelect | `@Name (id)` |

Entity answers are produced by `formatEntityAnswer(type, name, id)` (same function name in `utils/formFields.js` and `public/js/events/registration-form.js`).

## Discord modal rules

- `MODAL_MAX_FIELDS = 5`; Discord allows 5 top-level components per modal. `getModalFieldLimit(event)` returns 4 for slot events with more than one slot (the fallback-role select takes one place).
- An intro text display (title, date, capacity) is added only when the form has fewer than 5 fields (it counts as a component).
- `fitsIntoDiscordModal(event)` decides whether the announcement gets an "Anmelden" button; otherwise only the "Zum Event" link.
- Required selects use `setMinValues(1)` + `setRequired(true)`; optional selects `setMinValues(0)` (Discord rejects required selects with min 0).
- A dropdown without options falls back to a text input.

## Validation

`findMissingRequiredFields(formFields, formAnswers)`: required checkbox must be `true`; other required fields must be non-empty strings. Nothing else is validated server-side (no option membership check for web answers).

## Where in code

| What | grep |
|---|---|
| type constants | `FORM_FIELD_TYPE` (utils/formFields.js) |
| Discord mapping | `function applyFieldComponent`, `function readModalField` (bot.js) |
| web rendering / answers | `function renderFormFields`, `function collectFormAnswers`, `function initEntityPicker` (`public/js/events/registration-form.js`) |
| admin form builder | `function addFormField`, `function getFormFieldsFromBuilder` (`public/js/admin/wizard-builders.js`) |

## Gotchas

- Answers are keyed by label: renaming a label breaks the link to old answers; two fields with the same label overwrite each other.
- The field type list exists twice: backend `FORM_FIELD_TYPE` / `MODAL_MAX_FIELDS` in `utils/formFields.js`, frontend `FORM_FIELD_TYPE_LABELS` (with German labels) / `DISCORD_MODAL_MAX_FIELDS` in `public/js/events/registration-form.js` — keep both in sync.
