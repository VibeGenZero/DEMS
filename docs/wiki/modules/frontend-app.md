---
id: frontend-app
title: public/js/app.js — SPA logic and function map
type: module
tags: [frontend, spa, javascript, router, ui, admin-ui, forms, gsap, bootstrap]
sources: [public/js/app.js]
part_of: [architecture]
depends_on: [routes-auth, routes-events, routes-admin, routes-user]
see_also: [frontend-markup, api-index]
---
# public/js/app.js — SPA logic and function map

> TL;DR: One ~4550-line vanilla-JS file with global functions and globals (no modules, no build). A hash router (`handleRoute`) shows one `<section class="app-section">` at a time; every section has a `show*Section()` loader that fetches the REST API and renders HTML strings. Never read the file whole: find the function below, then `grep -n "function <name>" public/js/app.js` and read ~80 lines from there.

## Boot sequence

1. `DOMContentLoaded` #1 → boot animation (`runBootAnimation`, GSAP) or skip if `localStorage.dems_boot_ts` is <24 h old → `finishLoading()`.
2. `finishLoading()` → `fetchCSRFToken()` → `loadServerInfo()` (server name, guild id, `window.DEBUG_MODE`) → show `?error=` message → `checkAuth()` → `checkMaintenanceStatus()` → `restorePendingRoute()` → `handleRoute()` + `hashchange` listener.
3. `DOMContentLoaded` #2 ("Initialization") → `checkUpdates()` and a second `/auth/me` fetch (buggy, see gotchas).

## Router (`handleRoute`)

| Hash | Shows | Guard |
|---|---|---|
| `#events` (default) | `showEventsSection()` | login required |
| `#event/<id>` | `showEventDetail(id)` | login required |
| `#polls` | `showPollsSection()` | login required |
| `#poll/<id>` | `showPollDetail(id)` (also remembered as pending route before the login) | login required |
| `#events/<id>` (old Discord links) | rewritten to `#event/<id>` with `history.replaceState` | login required |
| `#profile` | `showProfileSection()` | login required |
| `#admin` | `showAdminSection()` | `currentUser.isAdmin` |
| `#bot-control` | `showBotControlSection()` | `currentUser.isAdmin` |
| `#info` | `showInfoSection()` | public |
| `#debug` | `showDebugSection()` | `window.DEBUG_MODE` |

Logged-out users see `#login-section` for every route except `info`. An event route is stored in `localStorage.dems_pending_route` (15 min); after the login redirect to `#events`, `restorePendingRoute()` opens that event once. Navigate with `navigateTo('event/' + id)`.

## Function map by section (grep `function <name>`)

| Section | Functions |
|---|---|
| Boot | `createParticles`, `runBootAnimation`, `fetchCSRFToken`, `loadServerInfo`, `updateServerNameInUI`, `finishLoading`, `getErrorMessage` |
| Auth | `logout` (`POST /auth/logout` with CSRF token, then `/`; toast on failure), `checkAuth`, `showLoggedIn`, `showLoggedOut`, `showUserData` (declared twice!) |
| Router | `handleRoute`, `navigateTo`, `rememberPendingRoute`, `restorePendingRoute` |
| Countdown | `formatCountdown`, `renderCountdownHTML`, `startCountdown` |
| Event list | `showEventsSection`, `loadCategories`, `filterByCategory`, `debouncedSearch`, `switchView`, `renderCalendar`, `toggleSeriesDates`, `getParticipantWarningBadge` |
| Location autocomplete | `loadChannelsForAutocomplete`, `handleLocationInput`, `selectLocationChannel` |
| Event detail | `showEventDetail` (first calls `resetEventDetailAreas`, then sets `detailEventId`), `resetEventDetailAreas` (hides/empties register/registered/no-access/waitlist areas, participants, `#comments-section`, `#checkin-section`), `getEventGradient`, `renderDetailBanner`, `setSidebarRow`, `renderSidebarDetails`, `renderSidebarAction`, `renderSidebarCapacity`, `loadDetailParticipants`, `toggleDetailSeriesDates` |
| Registration | `submitRegistration`, `unregisterFromEvent` |
| Registration form widgets | `normalizeFieldType`, `formatEntityAnswer`, `loadFormOptions`, `renderEntityPicker`, `initFormFieldWidgets`, `fillEntitySelects`, `initEntityPicker`, `searchEntities`, `renderFormFields`, `collectFormAnswers` |
| Guests | `debounceGuestSearch`, `searchGuests`, `addGuestToList`, `removeGuestFromList`, `renderSelectedGuests`, `resetGuestSelection` |
| Check-in | `renderCheckinSection`, `generateCheckinCode`, `submitCheckin` |
| Comments | `loadComments`, `renderComment`, `postComment`, `replyToComment`, `deleteComment` |
| Profile & account | `showProfileSection` (registration cards link only if `canOpenEvent(event)`, else class `profile-reg-card-static`), `canOpenEvent` (mirrors `isEventVisibleTo`), `loadAccountSettings`, `saveAccountSettings`, `deleteUserAccount`, `showFirstLoginModal`, `confirmInvitationPreference`, `toggleVerboseLog` |
| Admin dashboard | `showAdminSection`, `loadAdminStats`, `loadAdminEvents`, `loadAuditLog`, `showResetModal`, `performSystemReset` |
| Event wizard (create/edit) | `showCreateEventModal`, `editEvent`, `saveEvent`, `wizardGoTo`, `wizardNext`, `wizardBack`, `updateBannerPreview`, `loadRoles`, `populateRoles`, `getSelectedRoles` |
| Form builder | `addFormField`, `toggleOptionsInput`, `getFormFieldsFromBuilder` |
| Event admin actions | `deleteEvent`, `deleteEventSeries`, `changeEventStatus`, `duplicateEvent`, `startEvent`, `endEvent`, `exportRegistrations`, `syncDiscordEvent` |
| Announcements | `announceEvent`, `renderAnnounceButtonsPreview`, `sendAnnouncement` |
| Registrations review | `showRegistrations`, `updateRegStatus`, `renderRegistrationSlotCell`, `moveRegistrationSlot` |
| Role slots | wizard: `renderSlotEditor`, `toggleSlotEditor`, `addSlotRow`, `removeSlotRow`, `applySlotPreset`, `getSlotsFromEditor`, `updateSlotTotals`; cards: `renderSlotChips`; event page: `eventHasSlots`, `renderSlotPicker`, `selectPrimarySlot`, `renderAltSlotChips`, `toggleAltSlot`, `renderRoster`, `renderRosterAvatar`, `renderOwnSlot`, `switchMySlot`; shared: `formatSlotLabel` |
| Date polls | `formatPollDate`, `formatPollOptionLabel`, `getPollLabels` / `DEFAULT_POLL_LABELS`, `renderPollAnswerIcon` (`POLL_ANSWER_ICONS`: Bootstrap Icons instead of emojis), `renderPollCounts`, `refreshPollBadge`, `showPollsSection`, `renderPollCard`, `showPollDetail`, `renderPollDetail`, `renderPollOptionRow`, `setPollVote` |
| Date polls (admin) | `showConfirmDialog`, `renderPollRoleCheckboxes`, `togglePollRoles`, `showPollEditor` (answer fields stay empty for default answers), `addPollOptionRow`, `collectPollEditor` (sends `labels`), `savePoll`, `renderPollAdminBar`, `showPollAnnounceDialog`, `sendPollAnnouncement`, `closePollFromUi`, `deletePollFromUi`, `showPollDecideDialog`, `startEventFromPoll` (prefills the event wizard; `saveEvent` sends `fromPoll`) |
| Discord import | `showImportDiscordEventsModal`, `fetchDiscordEvents`, `selectDiscordEvent` |
| Bot templates | `showBotMessagesModal`, `saveBotMessages` |
| Maintenance | `checkMaintenanceStatus`, `showMaintenanceModal`, `saveMaintenanceSettings`, `activatePanicMode`, `deactivatePanicMode` |
| Bot control center | `showBotControlSection`, `formatUptime`, `loadBotStatus`, `loadBotRunningEvents`, `loadBotSettings`, `saveBotSettingsForm` |
| Updates | `checkUpdates`, `closeUpdatesModal` |
| Info & debug | `showInfoSection`, `spawnInfoParticles`, `showDebugSection`, `sgRunAnimation` |
| Utilities | `showError`, `showToast(message, type)`, `renderSkeletonEvents`, `escapeHtml`, `renderMarkdownSafe` (marked + DOMPurify), `isValidBannerUrl` |

## Globals

`currentUser`, `csrfToken`, `serverName`, `cachedRoles`, `cachedEvents`, `countdownTimers`, `activeCategory`, `currentView`, `descriptionEditor` (EasyMDE), `startDatePicker`/`endDatePicker` (Flatpickr), `window.DEBUG_MODE`, `window.VERBOSE_LOG`, `window._demsGuildId`, `detailEventId` (event the detail page shows; `showEventDetail`, `loadDetailParticipants`, `loadComments` and the admin path of `renderCheckinSection` drop answers that arrive for another id), slots: `selectedSlotId`, `selectedAltSlotIds`, `slotPickerSlots`, `MAX_SLOTS_PER_EVENT`, `SLOT_PRESETS`, polls: `currentPoll`, `pendingPollDecision`, `pollDeadlinePicker`.

## Rules for changes

- Rendering is string-built HTML: wrap every user value in `escapeHtml(...)`; render Markdown only via `renderMarkdownSafe(...)`.
- Mutating calls: `fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken }, body })`.
- Show results with `showToast(msg, type)` where `type` is a Bootstrap context (`success`, `danger`, `warning`, `info` → class `text-bg-<type>`; there is no `error`); texts in German. Login/OAuth errors use `showError(msg)` (banner).
- Inline `onclick="fn(...)"` handlers are used throughout (CSP allows `unsafe-inline`) — new handlers must be global functions.
- New per-event areas on the event page: clear them in `resetEventDetailAreas`, show them again where they are filled, and drop late answers with `if (detailEventId !== eventId) return;` after each `await`.

## Gotchas

- `showUserData` is declared twice; the later `async` version wins (function hoisting).
- The second `DOMContentLoaded` handler calls `setupEventListeners()`, which does not exist → its `.catch` runs `showLoggedOut()`; this can race with `checkAuth()`.
