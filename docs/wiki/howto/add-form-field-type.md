---
id: add-form-field-type
title: How to add a registration form field type
type: howto
tags: [howto, forms, form-fields, discord-modal, web-form]
sources: [utils/formFields.js, bot.js, public/js/app.js, README.md]
depends_on: [form-fields, bot, frontend-app]
see_also: [registration-flow]
---
# How to add a registration form field type

> TL;DR: A field type must exist in three places that mirror each other: `utils/formFields.js` (`FORM_FIELD_TYPE`), `bot.js` (Discord component in `applyFieldComponent`, parsing in `readModalField`) and `public/js/app.js` (`FORM_FIELD_TYPE_LABELS`, widget in `renderFormFields`/`initFormFieldWidgets`, value in `collectFormAnswers`). Answers must have the same format from web and Discord.

## Checklist

| # | File | Change |
|---|---|---|
| 1 | `utils/formFields.js` | add to `FORM_FIELD_TYPE` (and `ENTITY_FIELD_TYPES` if it references a Discord entity); adjust `findMissingRequiredFields` if "empty" means something special |
| 2 | `bot.js` | `applyFieldComponent`: map to a Discord modal component inside the `LabelBuilder` (respect `applySelectConstraints` for selects) |
| 3 | `bot.js` | `readModalField`: read the submitted value and return `{ value, error }` in the shared answer format |
| 4 | `public/js/app.js` | `FORM_FIELD_TYPE_LABELS` entry with German label (shows up in the form builder) |
| 5 | `public/js/app.js` | `renderFormFields` (markup), `initFormFieldWidgets` (pickers), `collectFormAnswers` (value); `toggleOptionsInput` if it needs options |
| 6 | `README.md` | row in the "Feldtyp / Web-Formular / Discord-Modal" table |
| 7 | `dev/seedData.js` | use the type in a seed form (e.g. `WORKSHOP_FORM`) so it can be tried in mock mode |
| 8 | wiki | [form-fields](../concepts/form-fields.md) type matrix; `npm run wiki` |

## Constraints

- Discord modals: ≤5 top-level components, label ≤45 chars, description/placeholder ≤100 chars; only component types allowed inside a Label can be used.
- Keep `fitsIntoDiscordModal` true for the new type only if Discord can render it; otherwise such forms become web-only.
- Answers are keyed by the field label; entity answers use `formatEntityAnswer` (`@Name (id)` / `#name (id)`).
