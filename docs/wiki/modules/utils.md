---
id: utils
title: utils/ — domain helpers
type: module
tags: [utils, registration, form-fields, waitlist, audit-log, profile, debug]
sources: [utils/registrationService.js, utils/formFields.js, utils/eventUtils.js, utils/eventUrl.js, utils/userProfile.js, utils/debugLog.js]
part_of: [architecture]
depends_on: [data-layer, bot]
see_also: [registration-flow, form-fields]
---
# utils/ — domain helpers

> TL;DR: Shared domain logic used by routes and the bot: `registrationService.js` (the single source of truth for creating registrations), `formFields.js` (field types and answer format), `eventUtils.js` (waitlist promotion, audit log), `eventUrl.js` (links to event pages), `userProfile.js` (users upsert after login) and `debugLog.js` (`DEBUG_MODE` logger).

## utils/registrationService.js

| Export | Contract |
|---|---|
| `registerUserForEvent({ eventId, user: { id, displayName, roles }, formAnswers, guests, source })` | returns `{ ok: true, id, status, message, event }` or `{ ok: false, code, httpStatus, error }` |
| `REGISTRATION_SOURCE` | `WEB: 'web'`, `DISCORD: 'discord'` |
| `REGISTRATION_STATUS` | `PENDING`, `ACCEPTED`, `WAITLISTED` |
| `REGISTRATION_ERROR` | `event_not_found` 404, `event_inactive` 400, `already_registered` 400, `missing_role` 403, `guests_not_allowed` 400, `missing_fields` 400, `registration_failed` 500 |

Used by `POST /api/events/:id/register` and by the Discord button/modal. Rules: [registration-flow](../concepts/registration-flow.md).

## utils/formFields.js

Exports `FORM_FIELD_TYPE` (`text, textarea, dropdown, checkbox, user, role, channel, mentionable`), `FORM_FIELD_TYPES`, `ENTITY_FIELD_TYPES`, `MODAL_MAX_FIELDS = 5`, `getFormFields`, `getFieldType`, `isEntityFieldType`, `formatEntityAnswer`, `fitsIntoDiscordModal`, `findMissingRequiredFields`. Details: [form-fields](../concepts/form-fields.md).

## utils/eventUtils.js

| Export | Behaviour |
|---|---|
| `promoteFromWaitlist(eventId, event)` | if a slot is free, the oldest `waitlisted` registration becomes `accepted` (instant events) or `pending`; sends DM, assigns role |
| `addAuditLog(action, adminId, details, targetId = null)` | writes `auditLogs` `{ action, adminId, details, targetId, timestamp }`; errors only logged |

## utils/eventUrl.js

`buildEventUrl(eventId)` → `<BASE_URL>/#event/<id>` (fallback `http://localhost:3000`). Every event link that leaves the server is built with it: announcement embed and "Zum Event" button, `/events` command, event channel embed, DMs, guest invitation, `{event.url}`. `test/eventUrl.test.js` fails when server code builds `#events/<id>` links again.

## utils/userProfile.js

`saveUserProfile({ id, username, displayName, avatar })` → `true` when the `users` document was created (sets `acceptInvitations: true`, `createdAt`), else refreshes name/avatar/`updatedAt` and returns `false`. Used by the OAuth callback and the dev persona login.

## utils/debugLog.js

`debugLog(label, data)` prints only when `DEBUG_MODE=true`; `IS_DEBUG` is exported for `server.js` and `/api/server-info`. Use it for verbose traces instead of `console.log`.

## Gotchas

- `promoteFromWaitlist` counts registrations (`regSnap.size`) without guests, while `registerUserForEvent` counts guests and pending guest invitations → promotion can overbook events that have guests. See [known-issues](../reference/known-issues.md).
- `bot.js` requires `registrationService` and `eventUtils` lazily inside functions (circular dependency).
