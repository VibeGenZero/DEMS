---
id: glossary
title: Glossary — German UI terms and code names
type: reference
tags: [glossary, terminology, german, i18n]
sources: [public/index.html, public/js, utils/registrationService.js]
see_also: [data-model, conventions]
---
# Glossary — German UI terms and code names

> TL;DR: The UI, API errors and Discord messages are German; code and data use English names. This table maps the German term a user or ticket uses to the field, status or function in the code.

| German (UI / user) | Code term | Where |
|---|---|---|
| Event, Veranstaltung | `events` document | [data-model](../concepts/data-model.md) |
| Anmeldung / Registrierung | registration (`registrations`) | [registration-flow](../concepts/registration-flow.md) |
| Abmeldung | unregister (`DELETE /api/events/:id/register`, `/unregister`) | routes/events.js, bot.js |
| Anmeldeschluss, „Anmeldung bis“, „Anmeldung geschlossen“ | `registrationDeadline`, `isRegistrationClosed`, code `registration_closed` | [registration-flow](../concepts/registration-flow.md) |
| Abmeldeschluss, „Abmeldung bis“ | `unregisterDeadline`, `isUnregisterClosed`, code `unregister_closed` | [registration-flow](../concepts/registration-flow.md) |
| Anfrage (wartet auf Bestätigung) | status `pending` | registration |
| Angenommen / bestätigt | status `accepted` | registration |
| Abgelehnt | status `rejected` | registration |
| Warteliste | status `waitlisted`, `promoteFromWaitlist` | utils/eventUtils.js |
| Teilnehmer / Plätze | participants, `maxParticipants` (0 = unbegrenzt) | event |
| Gast / Gäste, Einladung | `guests`, `pendingGuests`, guest invitation | registration |
| Einladungen erlauben | `acceptInvitations` | users |
| Anmeldeformular, Feld, Pflichtfeld | `formFields`, field, `required` | [form-fields](../concepts/form-fields.md) |
| Antworten | `formAnswers` (keyed by label) | registration |
| Zugang: offen / Rollen-Requirement | `accessMode`: `open` / `role-required`, `requiredRoles` | event |
| Genehmigung: manuell / sofort | `approvalMode`: `manual` / `instant` | event |
| Rolle vergeben | `assignRoleId`, `assignRole` | event, bot.js |
| Entwurf / Aktiv / Archiviert / Abgesagt | status `draft` / `active` / `archived` / `cancelled` | [event-lifecycle](../concepts/event-lifecycle.md) |
| Serie, wiederkehrend | `seriesId`, `recurring`, `recurringInterval` | event |
| Check-in, Code | `checkinEnabled`, `checkinCode`, `checkedIn` | event / registration |
| Erinnerung | `reminderHours`, `checkReminders` | [reminders-presence](../concepts/reminders-presence.md) |
| Ankündigen / Ankündigung | announce (`POST .../announce`) | [discord-integration](../concepts/discord-integration.md) |
| Event-Channels | `autoCreateChannels`, `channelConfig`, `createEventChannels` | bot.js |
| Ort | `location` `{ text, channelId, channelType }` | event |
| Kategorie | `category` | event |
| Bot-Nachrichten / Vorlagen | `botMessages/templates`, `customBotMessages` | data-model |
| Bot-Zentrale | bot control center (`#bot-control`, `/api/admin/bot/*`) | reminders-presence |
| Wartungsmodus, Wartungsbanner | maintenance mode (`maintenanceSettings/config`) | [maintenance-mode](../concepts/maintenance-mode.md) |
| Panic Mode, Notfall-Lockdown | `panicMode` | maintenance-mode |
| Login gesperrt / Registrierungen deaktiviert | `loginDisabled` / `registrationDisabled` | maintenance-mode |
| System-Reset | `DELETE /api/admin/reset` | routes/admin.js |
| Audit-Log | `auditLogs`, `addAuditLog` | utils/eventUtils.js |
| Abzeichen / Badges | profile badges (computed) | [routes-user](../modules/routes-user.md) |
| Neuer Nutzer (Willkommen) | `isNewUser`, `#firstLoginModal` | auth |
| Persona, Mock-Modus | dev persona login, `DEV_MOCK` | [dev-mock-mode](../modules/dev-mock-mode.md) |
