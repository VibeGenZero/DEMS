---
id: frontend-app
title: public/js — SPA modules and function map
type: module
tags: [frontend, spa, javascript, router, ui, admin-ui, forms, gsap, bootstrap]
sources: [public/js/main.js, public/js/core, public/js/events, public/js/polls, public/js/admin, public/js/pages]
part_of: [architecture]
depends_on: [routes-auth, routes-events, routes-admin, routes-user]
see_also: [frontend-markup, api-index]
---
# public/js — SPA modules and function map

> TL;DR: The SPA is native ES modules without a build step: `public/js/main.js` imports one module per area (`core/`, `events/`, `polls/`, `admin/`, `pages/`, each ≤ ~500 lines). Values several modules share live in `state` (`core/state.js`). A hash router (`handleRoute`) shows one `<section class="app-section">` at a time; every section has a `show*Section()` loader that fetches the REST API and renders HTML strings. Find the module below and open only that file.

## Boot sequence

1. `main.js` registers the startup listeners in the old order: `DOMContentLoaded` #1 → boot animation (`runBootAnimation`, GSAP) or skip if `localStorage.dems_boot_ts` is <24 h old → `finishLoading()`.
2. `finishLoading()` → `fetchCSRFToken()` → `loadServerInfo()` (server name, guild id, `window.DEBUG_MODE`) → show `?error=` message → `checkAuth()` → `checkMaintenanceStatus()` → `restorePendingRoute()` → `handleRoute()` + `hashchange` listener.
3. `DOMContentLoaded` #2 ("Initialization") → `checkUpdates()` only. Login state comes from `checkAuth()` alone: `/auth/me` clears `isNewUser` on its first read, so a second request at startup would swallow the welcome dialog.
4. `DOMContentLoaded` #3 → click listener of `#info-show-data-btn` (`showUserData`).

Module scripts run like `defer`, before `DOMContentLoaded`, so the order is the same as with the old classic script. The vendored libraries (`bootstrap`, `gsap`, `marked`, `DOMPurify`, `EasyMDE`, `flatpickr`) stay classic scripts in `public/vendor/`; modules use their globals.

## Router (`handleRoute`)

| Hash | Shows | Guard |
|---|---|---|
| `#events` (default) | `showEventsSection()` | login required |
| `#event/<id>` | `showEventDetail(id)` | login required |
| `#polls` | `showPollsSection()` | login required |
| `#poll/<id>` | `showPollDetail(id)` (also remembered as pending route before the login) | login required |
| `#events/<id>` (old Discord links) | rewritten to `#event/<id>` with `history.replaceState` | login required |
| `#profile` | `showProfileSection()` | login required |
| `#admin` | `showAdminSection()` | `state.currentUser.isAdmin` |
| `#bot-control` | `showBotControlSection()` | `state.currentUser.isAdmin` |
| `#info` | `showInfoSection()` | public |
| `#debug` | `showDebugSection()` | `window.DEBUG_MODE` |

Logged-out users see `#login-section` for every route except `info`. An event route is stored in `localStorage.dems_pending_route` (15 min); after the login redirect to `#events`, `restorePendingRoute()` opens that event once. Navigate with `navigateTo('event/' + id)`.

## Module map

| Module | Area | Functions (grep `function <name>`) |
|---|---|---|
| `main.js` | entry point | imports every module, registers the startup listeners |
| `core/state.js` | shared values | `state` (see below) |
| `core/actions.js` | event delegation | `registerActions(map)`, `initActions(root)` (called once in `main.js`), `runAction(name, element, event)`, `actionNames()`; built-in actions `toggleVisible`, `hide`, `scrollTo`; image fallbacks `hide`, `invisible`, `initials` |
| `core/components.js` | markup helpers of the component library | `initialsOf(name)`, `avatar({ url, name, size })` (image with `data-fallback="initials"`, or an initials tile), `emptyState({ icon, title, text, action })` (`action` is ready button HTML with a literal `data-click`) |
| `core/contrast.js` | WCAG contrast maths (styleguide and token test) | `parseColor`, `composite`, `contrastRatio` |
| `core/boot.js` | startup | `createParticles`, `runBootAnimation`, `fetchCSRFToken`, `loadServerInfo`, `updateServerNameInUI`, `finishLoading` |
| `core/auth.js` | login state | `logout` (`POST /auth/logout` with CSRF token, then `/`; toast on failure), `checkAuth`, `showLoggedIn`, `showLoggedOut` |
| `core/router.js` | hash router | `handleRoute` (shows the section and marks its link among `#main-navbar .nav-link`; other `.nav-link`s, e.g. tabs, are left alone), `navigateTo`, `rememberPendingRoute`, `restorePendingRoute` |
| `core/ui.js` | shared UI helpers | `escapeHtml`, `renderMarkdownSafe` (marked + DOMPurify), `markdownPreview(text, maxLength = 120)` (one line of plain text for card previews: Markdown characters removed, cut on a word with "…"), `showToast(message, type)` (type `success`, `danger`, `warning` or `info` sets the class `toast-<type>` and the icon from `TOAST_ICONS`; anything else is `info`), `showError`, `showConfirmDialog`, `getErrorMessage`, `renderSkeletonEvents`, `isValidBannerUrl` |
| `core/updates.js` | "Neuigkeiten & Updates" | `checkUpdates`, `closeUpdatesModal` |
| `events/list.js` | overview | `showEventsSection` (loads `UPCOMING_EVENTS_URL` = `/api/events?upcoming=1&limit=100` once, skeleton cards, load error/429 with "Erneut versuchen", calls `forgetCalendarEvents`), `renderOverview(now)`, `filterEvents(events, { category, search })` (title, description, category), `categoryCounts(events)`, `filterByCategory`, `resetEventFilters`, `switchView(view)`; actions `showEventsSection`, `filterByCategory`, `searchEvents`, `resetEventFilters`, `switchView`; the banner colour goes from `data-banner-bg` into `--event-banner-bg` via `style.setProperty` |
| `events/calendar.js` | calendar view of the overview | `showCalendar` (loads `CALENDAR_EVENTS_URL` = `/api/events?limit=500` once, past events included), `forgetCalendarEvents`, `calendarEntries` (one entry per series date), `renderCalendar`, `shiftCalendarMonth(delta)` |
| `events/cards.js` | overview cards, pure (no DOM) | `eventEnd`, `isRunning(event, now)` (end rule of `utils/eventListing.js`), `relativeDay(date, now)` ("Heute", "Morgen", "in 3 Tagen", "in 2 Wochen", "Gestern", "vor 3 Tagen"; calendar days), `renderDateTile`, `renderEventWhen`, `renderCapacity`, `renderStatusChip(myStatus)` (`STATUS_CHIPS`), `bannerBackground` (event colour, else `getEventGradient`), `renderEventCard(event, now)`, `renderEventCardSkeletons(count)` |
| `events/detail.js` | event page | `showEventDetail` (first calls `resetEventDetailAreas`, then sets `state.detailEventId`), `resetEventDetailAreas` (hides/empties register/registered/no-access/waitlist areas, participants, `#comments-section`, `#checkin-section`), `getEventGradient`, `formatCountdown`, `renderCountdownHTML`, `startCountdown` (event page countdown), `renderDetailBanner`, `setSidebarRow`, `renderSidebarDetails`, `renderSidebarAction`, `renderSidebarCapacity`, `loadDetailParticipants`, `toggleDetailSeriesDates` |
| `events/slots.js` | role slots on the event page | `eventHasSlots`, `renderSlotPicker`, `selectPrimarySlot`, `renderAltSlotChips`, `toggleAltSlot`, `renderRoster`, `renderRosterAvatar`, `renderOwnSlot`, `switchMySlot`, `formatSlotLabel` (shared with cards and the registrations dialog) |
| `events/registration-form.js` | sign-up | `submitRegistration`, `unregisterFromEvent`, `normalizeFieldType`, `formatEntityAnswer`, `loadFormOptions`, `renderEntityPicker`, `initFormFieldWidgets`, `fillEntitySelects`, `initEntityPicker`, `searchEntities`, `renderFormFields`, `collectFormAnswers` |
| `events/guests.js` | guests of a registration | `debounceGuestSearch`, `searchGuests`, `addGuestToList`, `removeGuestFromList`, `renderSelectedGuests`, `resetGuestSelection` |
| `events/checkin.js` | check-in | `renderCheckinSection`, `generateCheckinCode`, `submitCheckin` |
| `events/comments.js` | comments | `loadComments`, `renderComment`, `postComment(eventId, replyTo)`, `replyToComment(commentId, userName)` (fills `#comment-input` and marks `dataset.replyTo`; the `postComment` action sends that reply target once), `deleteComment` |
| `polls/polls.js` | date polls | `formatPollDate`, `formatPollOptionLabel`, `getPollLabels` / `DEFAULT_POLL_LABELS`, `renderPollAnswerIcon` (`POLL_ANSWER_ICONS`: Bootstrap Icons instead of emojis), `renderPollCounts`, `refreshPollBadge`, `showPollsSection`, `renderPollCard`, `showPollDetail`, `renderPollDetail`, `renderPollOptionRow`, `setPollVote` |
| `polls/admin.js` | date polls for admins | `renderPollRoleCheckboxes`, `togglePollRoles`, `showPollEditor` (answer fields stay empty for default answers), `addPollOptionRow`, `collectPollEditor` (sends `labels`), `savePoll`, `renderPollAdminBar`, `showPollAnnounceDialog`, `sendPollAnnouncement`, `closePollFromUi`, `deletePollFromUi`, `showPollDecideDialog`, `startEventFromPoll` (prefills the event wizard; `saveEvent` sends `fromPoll`) |
| `admin/dashboard.js` | admin area | `showAdminSection`, `loadAdminStats`, `loadAdminEvents`, `loadAuditLog`, `showResetModal`, `performSystemReset` |
| `admin/event-actions.js` | actions on one event | `changeEventStatus`, `deleteEvent`, `deleteEventSeries`, `duplicateEvent`, `startEvent`, `endEvent`, `exportRegistrations`, `syncDiscordEvent`, `announceEvent`, `renderAnnounceButtonsPreview`, `sendAnnouncement` |
| `admin/wizard.js` | event wizard | `showCreateEventModal`, `editEvent`, `saveEvent`, `reminderHoursOf` (stored list / legacy number / form text → hours, mirrors `normalizeReminderHours`; used for `#event-reminder` and the admin card badge), `wizardGoTo`, `wizardNext`, `wizardBack`, `updateBannerPreview`, `loadRoles`, `populateRoles`, `getSelectedRoles`, `loadChannelsForAutocomplete`, `handleLocationInput`, `selectLocationChannel` |
| `admin/wizard-builders.js` | wizard builders | form fields: `addFormField`, `toggleOptionsInput`, `getFormFieldsFromBuilder`; role slots: `renderSlotEditor`, `toggleSlotEditor`, `addSlotRow`, `removeSlotRow`, `applySlotPreset`, `getSlotsFromEditor`, `updateSlotTotals` |
| `admin/registrations.js` | registrations dialog | `showRegistrations`, `updateRegStatus`, `renderRegistrationSlotCell`, `moveRegistrationSlot` |
| `admin/maintenance.js` | maintenance | `checkMaintenanceStatus`, `showMaintenanceModal`, `saveMaintenanceSettings`, `activatePanicMode`, `deactivatePanicMode` |
| `admin/bot-control.js` | bot control center | `showBotControlSection`, `formatUptime`, `loadBotStatus`, `loadBotRunningEvents`, `loadBotSettings`, `saveBotSettingsForm` |
| `admin/bot-messages.js` | bot templates | `showBotMessagesModal`, `saveBotMessages` |
| `admin/discord-import.js` | Discord import | `showImportDiscordEventsModal`, `fetchDiscordEvents`, `selectDiscordEvent` |
| `pages/profile.js` | profile & account | `showProfileSection` (registration cards link only if `canOpenEvent(event)`, else class `profile-reg-card-static`), `canOpenEvent` (mirrors `isEventVisibleTo`), `loadAccountSettings`, `saveAccountSettings`, `deleteUserAccount`, `showFirstLoginModal`, `confirmInvitationPreference`, `toggleVerboseLog` |
| `pages/info.js` | info page | `showInfoSection`, `spawnInfoParticles`, `showUserData` (profile + registrations from `/auth/me` and `/api/user/registrations`) |
| `pages/debug.js` | styleguide: tokens and remaining page styles | `showDebugSection`, `contrastLabel(value, surface)`, `contrastNote(name, valueOf)` (contrast line of a token tile: text colours on the card, `--on-*` on their fill), `sgRunAnimation` |
| `pages/debug-components.js` | styleguide: the nine components | `renderDebugComponents(container)`; actions `sgShowDialog`, `sgShowToast` |

## State

`state` from `core/state.js` holds every top-level value that more than one module reads or writes: `currentUser`, `csrfToken`, `serverName`, `cachedRoles`, `countdownTimers`, `descriptionEditor` (EasyMDE), `startDatePicker`/`endDatePicker` (Flatpickr), `detailEventId` (event the detail page shows; `showEventDetail`, `loadDetailParticipants`, `loadComments` and the admin path of `renderCheckinSection` drop answers that arrive for another id), slots: `selectedSlotId`, `selectedAltSlotIds`, polls: `currentPoll`, `pendingPollDecision`, bot control: `botStatusRefreshInterval`, guests: `selectedGuests`.

Module-local values (e.g. `activeCategory`, `currentView`, `calendarEvents`, `calendarMonth`, `currentWizardStep`, `slotPickerSlots`, `pollDeadlinePicker`) stay in their module. `window.DEBUG_MODE`, `window.VERBOSE_LOG`, `window._demsGuildId` stay window properties.

## Rules for changes

- New code: export the function, import what you call (`import { escapeHtml } from '../core/ui.js'`), never assign to an imported binding — shared values go through `state`. Nothing runs on import except registrations; startup code belongs in `main.js`.
- Rendering is string-built HTML: wrap every user value in `escapeHtml(...)`; render Markdown only via `renderMarkdownSafe(...)`; short previews of Markdown (cards, lists) via `escapeHtml(markdownPreview(text))` — cut first, escape after, so no `&amp;` is cut in half.
- Mutating calls: `fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken }, body })`.
- Show results with `showToast(msg, type)` where `type` is a Bootstrap context (`success`, `danger`, `warning`, `info` → class `text-bg-<type>`; there is no `error`); texts in German. Login/OAuth errors use `showError(msg)` (banner).
- Actions: `data-click="name"` / `data-change` / `data-input` on the element, parameters in `data-*` (escaped with `escapeHtml`), `registerActions({ name: (el) => fn(el.dataset.x) })` at the end of the owning module; the innermost action wins; links get `preventDefault`. Broken images: `data-fallback="hide|invisible|initials"`. Built-in: `toggleVisible`, `hide`, `scrollTo` with `data-target`.
- Never write `onclick=` or other inline handlers — the CSP blocks them (`script-src-attr 'none'`) and `test/frontendCsp.test.js` fails. Action names stay literal in the markup (`data-click="saveEvent"`, never `data-click="${name}"`), so the guard test can check that each one is registered.
- New per-event areas on the event page: clear them in `resetEventDetailAreas`, show them again where they are filled, and drop late answers with `if (state.detailEventId !== eventId) return;` after each `await`.

## Gotchas

