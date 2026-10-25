# Proposal

Ticket: **W-10 Event-Vorlagen** (GitLab work item 74, branch `74-w-10-event-vorlagen`, builds on D-10 wizard preview).

## Why

Admins run the same kinds of events again and again (raid night, game evening, tournament) and today can only "Duplizieren" an existing event, which needs an old event lying around, copies its stale title and leaves a draft to clean up. A named template that stores the recurring setup (form, slots, roles, reminders, channels, messages) and can be picked when a new event is started saves that work and keeps event types consistent.

## What Changes

- New shared collection of **event templates** (`eventTemplates`): a name plus every event setting except the date-bound and lifecycle fields (no start/end, deadlines, status, series, Discord ids, announcements, check-in code, sent flags). All admins see and use the same templates; each remembers who created and last changed it.
- New admin API under `/api/admin/event-templates`: list, create, overwrite, delete. Names are unique (case-insensitive), at most 80 characters; at most 50 templates. Every mutation is written to the audit log.
- Event wizard (new events only): a "Aus Vorlage starten" chooser at the top of step 1 fills all template fields into the wizard; dates and status stay as they are. A delete button with inline confirmation removes the chosen template.
- Event wizard (new and edit): a "Als Vorlage speichern" action in the footer opens an inline name field; saving stores the current inputs as a new template, or overwrites the template with the same name after an inline warning.
- Uploaded banners referenced by a template count as "in use", so the automatic banner clean-up (W-12) never deletes a file a template still needs; replacing, overwriting or deleting a template releases its old banner.
- Dev mock mode seeds one example template.
- Out of scope: a separate template page, templates per admin, creating templates from the admin event table menu, Discord commands for templates, linking events to their template (applying is a one-time copy).

## Capabilities

### New Capabilities
- `event-templates`: storing, listing, overwriting and deleting named event templates, and starting a new event from one in the wizard.

### Modified Capabilities
- `event-banners`: "Unused banner files are deleted" — a file counts as used while an event **or an event template** references it; template overwrite and delete also release banners.

## Impact

- Code: `utils/eventTemplates.js` (new, field whitelist + validation), `routes/admin.js` (four routes), `utils/bannerStore.js` (`usedBanners` reads templates), `middleware/validators.js` (shared banner/colour checks), `public/js/admin/wizard-templates.js` (new), `public/js/admin/wizard.js` (fill helper shared by edit and template), `public/index.html` (wizard markup), `public/css/style.css` (small block, tokens only), `dev/seed.js`, `dev/seedData.js`, `test/seed.test.js`.
- API: new `GET/POST /api/admin/event-templates`, `PUT/DELETE /api/admin/event-templates/:id`; new audit actions `CREATE_EVENT_TEMPLATE`, `UPDATE_EVENT_TEMPLATE`, `DELETE_EVENT_TEMPLATE`.
- No Discord/bot change, no new env variables, no new dependencies.
- Wiki nodes: `docs/wiki/concepts/data-model.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/howto/add-event-field.md` (new fields must also go into the template whitelist), `docs/wiki/modules/utils.md`, `docs/wiki/modules/dev-mock-mode.md` (seed).
