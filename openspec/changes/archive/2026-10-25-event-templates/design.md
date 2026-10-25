# Design

## Context

See proposal.md (Why). Current state that shapes the approach:

- The wizard (`public/js/admin/wizard.js`, 537 lines, over the ~500-line module budget) has two near-identical fill paths: `showCreateEventModal()` resets every input, `editEvent()` fills every input from a stored event. `collectEventDraft()` already turns the inputs into the body POST/PUT expect.
- Event fields are whitelisted twice in `routes/admin.js` (`baseEvent` in `POST /events`, `updates` in `PUT /events/:id`). `validateEvent` in `middleware/validators.js` checks title, enums, dates, deadlines, description length, banner and accent colour; it always demands a title and, for active events, a start date. Slots are normalised separately by `normalizeSlots` (`utils/slotService.js`).
- W-12 banner clean-up: `releaseBanners(values)` deletes a candidate file unless `usedBanners()` finds it in the `events` collection; `sweepOrphanBanners` at startup uses the same set.
- The only existing "template" concept is the bot message singleton `botMessages/templates` and audit action `UPDATE_TEMPLATES`; names below avoid both.

## Goals / Non-Goals

**Goals:**
- One whitelist of template fields that both the server and the wizard use, so a template never carries date or lifecycle data.
- Reuse the event checks instead of a second copy of the banner/colour/slot rules.
- One fill function for the wizard, shared by "edit event" and "apply template", so a field added later lands in both.

**Non-Goals:**
- No template versioning, no link from event to template, no Discord side.
- No change to the duplicate feature.

## Decisions

### D1 — Collection `eventTemplates`, auto ids, document shape
`{ name, settings: { …whitelisted event fields… }, createdAt, createdBy, updatedAt, updatedBy }`. Settings live in a nested object so a template field can never collide with the template's own metadata and so the frontend can hand `settings` straight to the fill function. Alternative: flat fields like an event — rejected, because `name`/`createdAt` would shadow event semantics and the whitelist would be harder to read.

### D2 — `utils/eventTemplates.js` owns the rules (pure, no database)
Exports `TEMPLATE_FIELDS` (the list from the spec), `TEMPLATE_NAME_MAX = 80`, `MAX_TEMPLATES = 50`, `pickTemplateSettings(input)` (keeps only `TEMPLATE_FIELDS`, normalises defaults like `baseEvent` does: `parseInt` for `maxParticipants`, `!!` for booleans, `[]` / `{}` / `null` for lists, objects and location; `reminderHours` reduced to a plain list of positive hours via `normalizeReminderHours`, no `sent`), `normalizeTemplateName(name)` (trim, length check → `{ name } | { error }`), `nameTaken(templates, name, exceptId)` (case-insensitive via `toLocaleLowerCase('de')`). Slots go through `normalizeSlots`; with slots, `maxParticipants = sumCapacity(slots)` and `allowGuests = false` exactly like `baseEvent`. Unit tests cover these without a server.

### D3 — Shared field checks in `middleware/validators.js`
Extract the body of `validateEvent` into `checkEventFields(body, { template = false })` returning the German error list. With `template: true` it skips the title-required rule (but keeps the 200-char limit), the status enum, start-date, end-before-start and deadline rules — those fields are not stored anyway. `validateEvent` becomes `errors = await checkEventFields(req.body)` + the existing 400 answer, so event behaviour is unchanged (existing tests guard it). Alternative: a separate `validateTemplate` copy — rejected, it would drift from the event rules (the spec says "same rules").

### D4 — Routes in `routes/admin.js` (already behind `requireAuth` + `requireAdmin` + CSRF)
- `GET /event-templates` → all documents, sorted by name in memory (`localeCompare(…, 'de')`).
- `POST /event-templates` `{ name, settings }` → name check (400), count check (400 at 50), duplicate check (409), `checkEventFields(settings, { template: true })` (400), `normalizeSlots` (400), `addDoc`, `addAuditLog('CREATE_EVENT_TEMPLATE', …)`, answer the stored template with id.
- `PUT /event-templates/:id` → 404 if missing, same checks (duplicate excludes own id), `setDoc` keeping `createdAt/createdBy`, `releaseBanners([old.settings.bannerUrl])` after the write when the banner changed, audit `UPDATE_EVENT_TEMPLATE`.
- `DELETE /event-templates/:id` → 404 if missing, `deleteDoc`, `releaseBanners([bannerUrl])`, audit `DELETE_EVENT_TEMPLATE`.
Static path `/event-templates` does not collide with `/events/:id`. Each handler has its own try/catch with a German 500 message ("Fehler beim Laden/Speichern/Löschen der Vorlage"). The count/duplicate check reads all templates (≤ 50) — no index needed. Two admins saving the same name at the same moment could both pass the check; accepted (see Risks), no lock.

### D5 — Banner protection
`usedBanners()` in `utils/bannerStore.js` also reads `eventTemplates` and adds `settings.bannerUrl`. That single change makes event deletion, series deletion, reset and the startup sweep keep template banners. Template overwrite/delete call `releaseBanners` like event edits do. The admin system reset does not wipe templates (they are configuration, like bot messages), so it needs no change.

### D6 — Frontend: new module `public/js/admin/wizard-templates.js`
- `loadTemplates()` → `GET /api/admin/event-templates`, kept in module state; `renderTemplateChooser({ editing })` fills `#event-template-select` and shows `#wizard-template-area` (top of step 1) only for a new event with ≥ 1 template.
- `applyTemplate` (`data-change` on the select) → `fillWizard(settings)` from `wizard.js`, toast "Vorlage „X“ übernommen.", remembers the chosen name for the save field.
- `openTemplateSave` / `saveTemplate` (footer button `#wizard-btn-template`, inline panel `#wizard-template-save` with name input, warning line and save/cancel): the payload is `pickTemplateDraft(collectEventDraft())` — a frontend mirror of `TEMPLATE_FIELDS` (a test keeps the two lists equal, like the slot sentences in `wizard-checks.js`). First click on an existing name shows the overwrite warning, second click sends `PUT`; otherwise `POST`. Server errors show as `showToast(error, 'danger')`.
- `askDeleteTemplate` / `deleteTemplate` → inline confirmation row (pattern from W-09), `DELETE`, re-render the chooser.
- In `wizard.js`, split `editEvent()`'s input filling into `fillWizard(fields)` (everything the event fills except id, title of the modal, dates, deadlines, status and series) and call it from `editEvent()` and `applyTemplate`; `showCreateEventModal()` then calls `loadTemplates()` + `renderTemplateChooser({ editing: false })`, `editEvent()` calls `renderTemplateChooser({ editing: true })`. This also brings `wizard.js` back toward the size budget. Role checkboxes need `loadRoles()` before filling, which `fillWizard` awaits.
- Markup in `public/index.html`: chooser block at the top of `#wizard-page-1`, footer button "Als Vorlage speichern" (`bi-bookmark-plus`) left of the step counter, the inline save panel below the footer row. Hidden start states use `.is-hidden`; shown with `toggleElement`. No Bootstrap `d-flex` on toggled elements (W-09 trap). Styles: a small `.wizard-template-*` block in `public/css/style.css` with tokens only.

### D7 — Dev mock mode
`eventTemplates` joins `SEED_COLLECTIONS` in `dev/seed.js`; `dev/seedData.js` seeds one template "Raid-Abend" (three slots, one form field, reminders 24 and 1). `test/seed.test.js` `EXPECTED_COUNTS` gets `eventTemplates: 1`.

## Risks / Trade-offs

- [Concurrent saves with the same name create a duplicate] → Rare (few admins, ≤ 50 templates); the list still works and either can be renamed or deleted. No lock, consistent with other admin config writes.
- [Template references a role, channel or category that was deleted in Discord] → Applying fills the ids; a missing role simply stays unchecked / the select falls back to empty, and the existing wizard checks and server validation run on save. Not checked at template save time.
- [A new event field is added later but not to `TEMPLATE_FIELDS`] → The `add-event-field` how-to gets a checklist row; a unit test asserts the frontend and server lists match.
- [Applying overwrites inputs the admin already typed] → Intended (spec); the chooser sits at the top of step 1 so it is the first thing done, and the toast names the template.
- [`validateEvent` refactor changes event behaviour] → Pure extraction; the existing devServer and hardening tests on event validation must stay green.

## Migration Plan

No migration: the collection is new and empty in production. Rollback = revert the commit; stored template documents are ignored by older code (only `usedBanners` would no longer protect their banners).
