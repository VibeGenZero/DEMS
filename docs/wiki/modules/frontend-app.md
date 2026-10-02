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
2. `finishLoading()` → `fetchCSRFToken()` → `loadServerInfo()` (server name, guild id, `window.DEBUG_MODE`) → show `?error=` message → `checkAuth()` → `checkMaintenanceStatus()` → `handleRoute()` + `hashchange` listener.
3. `DOMContentLoaded` #2 ("Initialization") → `checkUpdates()` and a second `/auth/me` fetch (buggy, see gotchas).

## Router (`handleRoute`)

| Hash | Shows | Guard |
|---|---|---|
| `#events` (default) | `showEventsSection()` | login required |
| `#event/<id>` | `showEventDetail(id)` | login required |
| `#profile` | `showProfileSection()` | login required |
| `#admin` | `showAdminSection()` | `currentUser.isAdmin` |
| `#bot-control` | `showBotControlSection()` | `currentUser.isAdmin` |
| `#info` | `showInfoSection()` | public |
| `#debug` | `showDebugSection()` | `window.DEBUG_MODE` |

Logged-out users see `#login-section` for every route except `info`. Navigate with `navigateTo('event/' + id)`.

## Function map by section (grep `function <name>`)

| Section | Functions |
|---|---|
| Boot | `createParticles`, `runBootAnimation`, `fetchCSRFToken`, `loadServerInfo`, `updateServerNameInUI`, `finishLoading`, `getErrorMessage` |
| Auth | `checkAuth`, `showLoggedIn`, `showLoggedOut`, `showUserData` (declared twice!) |
| Router | `handleRoute`, `navigateTo` |
| Countdown | `formatCountdown`, `renderCountdownHTML`, `startCountdown` |
| Event list | `showEventsSection`, `loadCategories`, `filterByCategory`, `debouncedSearch`, `switchView`, `renderCalendar`, `toggleSeriesDates`, `getParticipantWarningBadge` |
| Location autocomplete | `loadChannelsForAutocomplete`, `handleLocationInput`, `selectLocationChannel` |
| Event detail | `showEventDetail`, `getEventGradient`, `renderDetailBanner`, `setSidebarRow`, `renderSidebarDetails`, `renderSidebarAction`, `renderSidebarCapacity`, `loadDetailParticipants`, `toggleDetailSeriesDates` |
| Registration | `submitRegistration`, `unregisterFromEvent` |
| Registration form widgets | `normalizeFieldType`, `formatEntityAnswer`, `loadFormOptions`, `renderEntityPicker`, `initFormFieldWidgets`, `fillEntitySelects`, `initEntityPicker`, `searchEntities`, `renderFormFields`, `collectFormAnswers` |
| Guests | `debounceGuestSearch`, `searchGuests`, `addGuestToList`, `removeGuestFromList`, `renderSelectedGuests`, `resetGuestSelection` |
| Check-in | `renderCheckinSection`, `generateCheckinCode`, `submitCheckin` |
| Comments | `loadComments`, `renderComment`, `postComment`, `replyToComment`, `deleteComment` |
| Profile & account | `showProfileSection`, `loadAccountSettings`, `saveAccountSettings`, `deleteUserAccount`, `showFirstLoginModal`, `confirmInvitationPreference`, `toggleVerboseLog` |
| Admin dashboard | `showAdminSection`, `loadAdminStats`, `loadAdminEvents`, `loadAuditLog`, `showResetModal`, `performSystemReset` |
| Event wizard (create/edit) | `showCreateEventModal`, `editEvent`, `saveEvent`, `wizardGoTo`, `wizardNext`, `wizardBack`, `updateBannerPreview`, `loadRoles`, `populateRoles`, `getSelectedRoles` |
| Form builder | `addFormField`, `toggleOptionsInput`, `getFormFieldsFromBuilder` |
| Event admin actions | `deleteEvent`, `deleteEventSeries`, `changeEventStatus`, `duplicateEvent`, `startEvent`, `endEvent`, `exportRegistrations`, `syncDiscordEvent` |
| Announcements | `announceEvent`, `renderAnnounceButtonsPreview`, `sendAnnouncement` |
| Registrations review | `showRegistrations`, `updateRegStatus` |
| Discord import | `showImportDiscordEventsModal`, `fetchDiscordEvents`, `selectDiscordEvent` |
| Bot templates | `showBotMessagesModal`, `saveBotMessages` |
| Maintenance | `checkMaintenanceStatus`, `showMaintenanceModal`, `saveMaintenanceSettings`, `activatePanicMode`, `deactivatePanicMode` |
| Bot control center | `showBotControlSection`, `formatUptime`, `loadBotStatus`, `loadBotRunningEvents`, `loadBotSettings`, `saveBotSettingsForm` |
| Updates | `checkUpdates`, `closeUpdatesModal` |
| Info & debug | `showInfoSection`, `spawnInfoParticles`, `showDebugSection`, `sgRunAnimation` |
| Utilities | `showError`, `showToast(message, type)`, `renderSkeletonEvents`, `escapeHtml`, `renderMarkdownSafe` (marked + DOMPurify), `isValidBannerUrl` |

## Globals

`currentUser`, `csrfToken`, `serverName`, `cachedRoles`, `cachedEvents`, `countdownTimers`, `activeCategory`, `currentView`, `descriptionEditor` (EasyMDE), `startDatePicker`/`endDatePicker` (Flatpickr), `window.DEBUG_MODE`, `window.VERBOSE_LOG`, `window._demsGuildId`.

## Rules for changes

- Rendering is string-built HTML: wrap every user value in `escapeHtml(...)`; render Markdown only via `renderMarkdownSafe(...)`.
- Mutating calls: `fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken }, body })`.
- Show results with `showToast(msg, type)` where `type` is a Bootstrap context (`success`, `danger`, `warning`, `info` → class `text-bg-<type>`; there is no `error`); texts in German. Login/OAuth errors use `showError(msg)` (banner).
- Inline `onclick="fn(...)"` handlers are used throughout (CSP allows `unsafe-inline`) — new handlers must be global functions.

## Gotchas

- `showUserData` is declared twice; the later `async` version wins (function hoisting).
- The second `DOMContentLoaded` handler calls `setupEventListeners()`, which does not exist → its `.catch` runs `showLoggedOut()`; this can race with `checkAuth()`.
- Deep links from Discord use `#events/<id>` → the router shows the list, not the event. Detail route is `#event/<id>`.
