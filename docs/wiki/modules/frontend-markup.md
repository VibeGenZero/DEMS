---
id: frontend-markup
title: public/index.html and public/css/style.css — markup and styling map
type: module
tags: [frontend, html, css, bootstrap, theme, modals, sections, vendor, fonts]
sources: [public/index.html, public/css/tokens.css, public/css/components.css, public/css/style.css, public/vendor, test/vendorAssets.test.js, test/cssRules.test.js, test/designTokens.test.js]
part_of: [architecture]
see_also: [frontend-app, security]
---
# public/index.html and public/css/style.css — markup and styling map

> TL;DR: `index.html` contains every section and modal statically; JS toggles `display`. Styling is three files, loaded in this order: `tokens.css` (every colour, font size, spacing, radius, layer and shadow as a CSS variable; colours and shadows in a dark and a light scheme), `components.css` (Bootstrap bridge and the nine components) and `style.css` (page-specific rules in banner-commented blocks). `data-bs-theme="dark|light"` on `<html>` picks the scheme (D-15). No raw colour, px/rem font size or z-index ≥ 10 outside `tokens.css`. Find things by element id (HTML) or block header (CSS) with `grep -n`.

## index.html structure

| Part | Ids / notes |
|---|---|
| `<head>` | first `/theme-boot.js` (classic script: sets `data-bs-theme` before the first paint, see [frontend-app](frontend-app.md)); then everything from `/vendor` (see below): `fonts/fonts.css`, FontAwesome (for EasyMDE), Bootstrap CSS + Bootstrap Icons, EasyMDE + Flatpickr (`#flatpickr-dark-css` = its dark theme, disabled in the light scheme), marked + DOMPurify; then `/css/tokens.css?v=3`, `/css/components.css?v=3` and `/css/style.css?v=3` (in this order). `<html data-bs-theme="dark">` is only the fallback |
| Loading screen | `#loading-screen`, `.loading-letter`, `.loading-status`, `#particles` |
| Navbar | `#main-navbar`, `#nav-brand-name` (server name, set as text), `#nav-events`, `#nav-polls` (with `#nav-polls-badge`), `#nav-profile`, `#nav-admin`, `#nav-bot-control`, `#nav-debug` (all of these only with a login; logged out the navbar shows the logo and "Info", D-12), `#user-info`, `#user-avatar` (empty; `showLoggedIn` puts `avatar()` into it), `#user-name`; `#nav-marker` (last `li` of the link list, the underline that glides to the active link from 992 px on) |
| Banners | error banner, maintenance banner, planned-maintenance banner, panic lockdown overlay |
| Login card | `#login-section` → `.login-card` with `#login-server-icon` (`avatar()` of the Discord server, initials without an icon), `#login-server-name`, the list `.login-points` (three points, `#login-server-ref` = server name), the only "Login mit Discord" button and the privacy link; no events and no numbers without a login (decision 3) |
| Sections (`.app-section`) | `#login-section`, `#events-section`, `#event-detail-section`, `#polls-section`, `#poll-detail-section`, `#profile-section`, `#debug-section`, `#admin-section`, `#bot-control-section`, `#info-section` |
| Event page | `#event-detail-section`: `#detail-banner-area`, then `.event-page-container` with the back button and the grid `.event-page` (D-05). Areas in phone order: `#detail-head` (tags, `#detail-title`, `#detail-countdown-area`), `#detail-side` (`.event-detail-sidebar`: two `.event-side-card`s with `.sidebar-detail-rows` and `#sidebar-capacity-panel`, then `#sidebar-action-area.detail-action` with `#register-btn` (`form="registration-form"`), `#waitlist-btn` (`form="waitlist-form"`) and `#sidebar-status-btn`), `#detail-status` (`#detail-registered` with `#detail-unregister-closed`, `#detail-no-access`, `#detail-ended`, `#detail-registration-closed` (W-03), later `#checkin-section`), `#detail-main` (description, `#detail-participants-section`, `#detail-series-section`, `#detail-register-area` with `#registration-form` (inputs only), `#detail-waitlist` with `#waitlist-form`, later `#comments-section`). From 992 px: main on the left, side on the right (sticky). Below 992 px the action area is a 64 px bar at the bottom while `.has-action-bar` is set (the page keeps that room free and the toasts move up by it; `handleRoute` removes the class when another route shows), and the card titles of the side are hidden |
| Profile | `.profile-layout` with four areas: events (`#profile-upcoming` with `#profile-upcoming-count`, `#profile-history-block` with `#profile-history`, `#profile-history-count` and the button `#profile-history-more`), `#profile-card`, badges (`#profile-badges`, `#profile-badge-count`), `#account-settings-card` (first row "Darstellung": radio group `.theme-choice` with `#theme-choice-light|dark|system`, `data-change="setThemeChoice"`; each `.theme-choice-preview` / `.theme-choice-half` carries its own `data-bs-theme`, so it shows that scheme's tokens); below it `#debug-card-wrapper` |
| Admin events | `#admin-stats`; `.admin-events-toolbar` with `#admin-events-tabs` (tabs Entwürfe · Aktiv · Archiv with counts) and `#admin-events-search`; `#admin-events-table` (table, placeholder rows or empty state, rendered by `admin/event-table.js`) |
| Modals | `#importDiscordEventsModal`, `#eventModal` (5-step wizard: Grundlagen, Datum & Zeit, Teilnehmer & Zugang, Anmeldeformular, Erweitert; `.wizard-head` with the step dots and the pills `#wizard-mode` with `#wizard-mode-edit`/`#wizard-mode-preview`; `#wizard-preview` with `#wizard-preview-card` and `#wizard-preview-discord`, both `inert`; `#event-start-required`; one `.invalid-feedback` per checked field: `#event-title-feedback`, `#event-banner-url-feedback`, `#event-start-date-feedback`, `#event-end-date-feedback`, `#event-registration-deadline-feedback`, `#event-unregister-deadline-feedback` (step 2 deadlines, W-03), `#event-recurring-until-feedback`, `#event-max-feedback`, `#event-reminder-feedback`, `#role-checkboxes-feedback`, `#slot-editor-feedback`, `#form-fields-feedback`), `#resetModal`, `#maintenanceModal`, `#registrationsModal` (member entry `#reg-add` with `#reg-add-search`, `#reg-add-slot`, `#reg-add-results`, hidden start state, W-06; columns User, Gäste, Status, Check-in, Slot, Formular-Antworten, Datum, Aktionen), `#botMessagesModal`, `#announceModal`, `#dataPrivacyModal`, `#updatesModal`, `#firstLoginModal`, `#pollEditorModal` (incl. answer fields `#poll-label-yes|maybe|no`), `#pollAnnounceModal`, `#pollDecideModal`, `#confirmModal` (generic, `showConfirmDialog`) |
| Card flight | `#card-flight` (`.card-flight`, starts `.is-hidden`): fixed layer under the navbar for the card flight of `events/card-flight.js` (scrim, sheet with banner, card face and a copy of the event page) |
| Scripts (end of body) | Bootstrap bundle, GSAP (`/vendor`), `<script type="module" src="/js/main.js">` (ES modules, see [frontend-app](frontend-app.md)) |

All login buttons are plain links to `/auth/discord`.

## Vendored libraries and fonts (`public/vendor/`)

No CDN: every library and font is a pinned copy with its license next to it.

| Folder | Version | Used for |
|---|---|---|
| `bootstrap/` | Bootstrap 5.3.2 (CSS + JS bundle) | layout, modals, dropdowns |
| `bootstrap-icons/` | Bootstrap Icons 1.11.2 (CSS + `fonts/`) | all `bi bi-*` icons |
| `fontawesome/` | Font Awesome Free 6.0.0 (`css/all.min.css` + `webfonts/`) | EasyMDE toolbar only |
| `marked/` | marked 15.0.12 | `renderMarkdownSafe` |
| `dompurify/` | DOMPurify 3.2.4 | `renderMarkdownSafe` |
| `gsap/` | GSAP 3.12.5 | boot animation and UI animations (the boot sequence needs it to show the app) |
| `easymde/`, `flatpickr/` | EasyMDE 2.20.0, Flatpickr 4.6.13 (+ German locale, dark theme; the light scheme uses Flatpickr's base style) | event description editor, date pickers |
| `fonts/` | Inter (variable, 300–700, 7 subsets) + UnifrakturCook 700, mirrored from Google Fonts; `fonts.css` declares the `@font-face` rules | `--font-body`, `--font-logo` |

## Stylesheets (`public/css/`)

| File | Content | Rule |
|---|---|---|
| `tokens.css` | `:root` (scheme-free tokens and `--discord-*`), `:root.is-theme-switching` (durations 0 s while the scheme switches), `:root, [data-bs-theme="dark"]` (dark colours and shadows), `[data-bs-theme="light"]` (light colours and shadows) | the only file with colour values, font sizes in px/rem and layer numbers |
| `components.css` | BOOTSTRAP BRIDGE → BUTTON → DIALOG → TABS → TOAST → CARD → CHIP → SKELETON → EMPTY STATE → AVATAR → DATE TILE → CAPACITY | colours, px/rem font sizes, radii and layers ≥ 10 only from tokens (enforced by `npm test`); spacing from the `--space-*` tokens by convention; `!important` only in the colour helpers |
| `style.css` | page-specific blocks, see below | colours, px/rem font sizes, px radii and layers ≥ 10 only from tokens (enforced by `npm test`); spacing keeps its old raw values until a page is rebuilt; one rule per selector list |

`style.css` blocks (grep the header text): LOADING SCREEN → NAVBAR → SECTIONS → EVENT CARDS (overview: toolbar, grid, card, `.event-card.is-flying` keeps the place of a flying card; + Event Series, Rendered Markdown) → COUNTDOWN (event page; `.countdown-digit` cells, `.countdown-digit-next` while a digit flips) → CATEGORY PILLS (filter chips, one line on phones) → BADGES (upper-case rule of the event chips) → STATS CARDS → WAITLIST → FORMS → TABLE → FORM BUILDER → ENTITY PICKER → LOGIN CARD → ADMIN EVENTS (table of `#admin`: toolbar, column widths, event and places cells) → UPDATE EFFECTS (layer `#update-effects` over the page: confetti, power-up and bug pieces with their keyframes; hidden for `prefers-reduced-motion`) → PROFILE SECTION (two-column grid from 992 px, profile card, event rows, history rows, badge list) → RESPONSIVE → UTILITY → INFO SECTION → EASYMDE CUSTOMIZATION → Calendar View → Event Comments → BOT CONTROL CENTER → EVENT WIZARD STEPPER (`.has-error` red dot) → DISCORD PREVIEW (`.discord-message`, `.discord-embed`, `.discord-button.is-*`) → WIZARD PREVIEW (`.wizard-head`, `.wizard-mode`, `.wizard-preview-card`) → MAINTENANCE MODE → EVENT DETAIL (banner, page areas of D-05 with the phone action bar, sidebar, capacity bar, participants; the section fades in without a slide, because a transform would make it the frame of the fixed bar) → LOCATION AUTOCOMPLETE → DEBUG / STYLING GUIDE → ROLE SLOTS → DATE POLLS → CARD FLIGHT (`.card-flight`, `-scrim`, `-sheet`, `-banner`, `-face`, `-page`). The NAVBAR block holds `.nav-marker` (the old `.nav-link.active::after` underline stays below 992 px); SECTIONS has `sectionFadeInCalm` (opacity only, 0.2 s) for `prefers-reduced-motion`.

## Tokens (`tokens.css`)

| Group | Tokens |
|---|---|
| Surfaces | `--bg-primary`, `--bg-secondary`, `--bg-card`, `--bg-glass`, `--bg-glass-hover`, `--bg-tint-1/2/3` (dark: white 4/8/12 %, light: black 3/6/10 %), `--bg-inset`, `--bg-scrim` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted` |
| Borders | `--border-subtle`, `--border-strong`, `--border-accent` |
| Accent | `--accent` (brand violet: borders, icons, glows), `--accent-light`, `--accent-dark`, `--accent-text` (violet text and links), `--accent-fill` + `--accent-fill-hover` + `--on-accent` (solid fill and the text on it), `--accent-tint-1/2`, `--accent-glow` |
| Status | per `success`, `warning`, `danger`, `info`: `--<s>` (text), `--<s>-bg`, `--<s>-border`, `--<s>-fill`, `--on-<s>`; plus `--danger-fill-hover`; Discord: `--discord`, `--discord-hover`, `--on-discord`; Discord look of the wizard preview: `--discord-bg`, `--discord-embed-bg`, `--discord-text`, `--discord-heading`, `--discord-muted`, `--discord-link`, `--discord-button-secondary/-success/-danger` (AA on both Discord surfaces) |
| Type | `--font-body` (Inter), `--font-logo` (UnifrakturCook, only `.loading-logo` and `.brand-text`), `--font-size-xs` 12 px … `-sm` 14, `-md` 16, `-lg` 18, `-xl` 20, `-2xl` 24, `-3xl` 32, `-4xl` 40, `-display` and `-logo` (fluid) |
| Spacing | `--space-4`, `-8`, `-12`, `-16`, `-24`, `-32`, `-48`, `-64` (name = pixels; not Bootstrap's `p-3` numbering) |
| Radius | `--radius-sm` 8 px, `--radius` 12 px, `--radius-lg` 16 px, `--radius-pill` |
| Layers | `--z-dropdown` 1000 < `--z-sticky` < `--z-nav` < `--z-banner` < `--z-dialog` < `--z-toast` < `--z-overlay` 2000 (Bootstrap's scale); local stacking from -1 to 9 may stay a number |
| Shadows, motion | `--shadow-sm/md/lg`, `--shadow-glow`, `--shadow-ring`; `--duration-fast/base/slow`, `--ease-standard`, `--transition` |

**Two schemes (D-15).** Colour and shadow tokens exist twice: dark on `:root, [data-bs-theme="dark"]`, light (Discord light: grey page `#f2f3f5`, white cards, dark-grey text, violet accent) on `[data-bs-theme="light"]`. The attribute works on any element, so a subtree can force a scheme (the profile preview tiles do). The light rule may only hold colour and shadow tokens, and every name in it must also be in the dark rule (else a dark subtree inside a light page keeps the light value); shadows belong to the scheme rules because a `var()` resolves where it is declared. `--discord-*` exists once: the wizard's Discord preview stays dark in both schemes. A value that differs per scheme is a token in both rules, never a `[data-bs-theme="light"] .x` rule in `style.css`.

Contrast rules, enforced by `test/designTokens.test.js` for both schemes (WCAG AA): every text colour (`--text-*`, `--accent-text`, the four status colours) has at least 4.5:1 on every surface and on `--bg-tint-1`; on `--bg-tint-2` and `--bg-tint-3` the test guarantees this only for `--text-primary` and `--text-secondary` (`--text-muted` falls below 4.5 on tint-2, most colours on tint-3), so use only those two there; a status colour has 4.5:1 on its own `-bg`; `--on-*` has 4.5:1 on its fill. White text never sits on `--accent`, it sits on `--accent-fill`.

## Components (`components.css`)

| Component | Classes | Old names that still work |
|---|---|---|
| Button | `.btn` + `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-discord`; `.btn-sm` 32 px, default 40 px, `.btn-lg` 48 px (height from `--btn-height`; a button stays an inline block, as a flex box it would drop the space between icon and label); `.btn-icon` | `.btn-accent` = primary; `.btn-outline-light`, `.btn-outline-secondary` = secondary; also themed: `.btn-warning`, `.btn-outline-primary/success/warning/danger` |
| Card | `.glass-card`; reacts to hover only as `.glass-card[data-click]`, `a.glass-card` or `.glass-card.is-clickable` | – |
| Chip | `.chip` + `.chip-success/warning/danger/info/accent`, `.chip-sm` (height from `--chip-height` and padding, so utility classes like `d-inline-block` do not shift the text); a `<button class="chip">` filters, `.active` marks the chosen one | `.badge-pill` (+ `.status-pending/accepted/rejected/waitlisted`), `.category-pill`, `.event-status-badge` (+ `.event-status-active/archived`), `.event-category-tag` |
| Tabs | `.nav.nav-pills` with `.nav-link` and `data-bs-toggle="pill"`, or — when JS renders the content, as in the admin table — with `data-click` and `aria-selected`; counter as `.chip.chip-sm` (gets `--text-primary` inside the active tab); scrolls sideways when the entries do not fit; with `glideTabs(container)` (`core/tab-glider.js`) the list gets `.has-glider` and one `.nav-glider` surface slides to the active tab, the tab itself turns transparent | – |
| Dialog | Bootstrap `.modal` markup; `showConfirmDialog(message, label, { danger })` asks with the red button, `danger: false` with a primary one; Bootstrap's own transform of `.modal-dialog` is off, GSAP springs the box (`initDialogMotion`) and Bootstrap keeps its fade | – |
| Toast | `showToast(message, type)`; class `toast-<type>` colours the edge and the icon; springs in from the right, glides out | – |
| Empty state | `emptyState({ icon, title, text, action })` → `.empty-state` | – |
| Skeleton | `.skeleton` + `.skeleton-text` (`.is-short`), `-title`, `-img`, `-chip`, `-avatar`, `-card-body` | – |
| Avatar | `avatar({ url, name, size })` → `.avatar` (36 px), `.avatar-sm` 24, `.avatar-lg` 64, `.avatar-xl` 96, `.avatar-initials`; `.avatar-stack`, `.avatar-more` ("+5"). Every person and the bot use it: navbar and participants 36 px; comments, line-up, waitlist, poll votes and guests `sm`; profile card and bot control `lg`. Without an image, or when it fails to load, the same tile shows the initials | – |
| Date tile | `renderDateTile(event, now)` (`events/cards.js`) → `.date-tile` with `.date-tile-weekday`, `-day`, `-month`; `.is-live` shows "LIVE" in red while the event runs | – |
| Capacity | `renderCapacity(event)` → `.capacity` with a `<progress class="capacity-meter">` and `.capacity-text` ("5 von 20 belegt"); `.is-low` from 80 % ("Noch 2 Plätze"), `.is-full` ("Ausgebucht"), "· 3 warten" with a waitlist; the places sentence of the API (`places.text`) is the tooltip; without a limit "5 Plätze belegt" and no bar. The event page sidebar uses the same bar. The older `.capacity-bar` of the bot centre and `.capacity-label`/`.capacity-sublabel` of the event page are separate | – |
| Data table | `<table class="data-table">`: head button `.data-table-sort` (the `<th>` carries `aria-sort`), row name `.data-table-title` (a button), second line `.data-table-meta`, last cell `.data-table-actions` with `.data-table-buttons`; rows `.is-sub` (indented, tinted) and `.is-muted` (colour only, never opacity or transform: the row's menu would end up behind the following rows). Below 768 px every row is a block and the heads are only read by screen readers | – |
| Menu | Bootstrap dropdown: a button with `data-bs-toggle="dropdown"` and `<ul class="dropdown-menu">` with `.dropdown-item` buttons, `.dropdown-header`, `.dropdown-divider`; `.dropdown-item.is-danger` for the one destroying entry, last and below a divider | – |
| Helpers | `.is-hidden` (start state "hidden"), `.icon-lg` / `.icon-xl` / `.icon-2xl` (stand-alone icons in 1.5 / 2 / 2.5 rem), `.cursor-pointer`, `.glass-card.is-tinted` (card on a hint of the accent colour) | `showElement`, `toggleElement`, `applyStyleData` (`core/ui.js`) |

The Bootstrap bridge (selector `[data-bs-theme]`, so both schemes) sets Bootstrap's own variables from the tokens (`--bs-body-*`, `--bs-emphasis-color`, `--bs-secondary-bg`, `--bs-tertiary-bg`, `--bs-btn-*`, `--bs-modal-*`, `--bs-toast-*`, `--bs-nav-pills-*`, `--bs-alert-*`) and overrides the colour helpers `.text-*`, `.bg-*`, `.text-bg-*` for primary, success, warning, danger and info, plus `.text-secondary` (Bootstrap's own grey has only 3.6–4.2:1 on the dark surfaces). `.text-muted` renders `--text-secondary` (Bootstrap ties it to its "secondary" colour); use `.text-body-tertiary` for `--text-muted`.

## Actions

No inline handlers (`onclick`, `onchange`, `oninput`, `onerror`): the CSP blocks them (`script-src-attr 'none'`). Instead:

| Attribute | Meaning |
|---|---|
| `data-click="name"` / `data-change="name"` / `data-input="name"` | runs the action `name` registered with `registerActions` (see [frontend-app](frontend-app.md)); the innermost element with an action wins; links get `preventDefault` |
| other `data-*` | parameters of the action, read via `el.dataset` (always escaped with `escapeHtml`) |
| `data-fallback="hide\|initials"` | broken image: hide it (event banners), or replace an `img.avatar` with a `span` of the same classes plus `.avatar-initials`, text from `data-initials`, `title` kept (`avatar()` sets both) |
| `data-click="hide"` / `data-click="scrollTo"` / `data-change="toggleVisible"` + `data-target="<id>"` | built-in actions: hide, scroll to, or show/hide (checkbox) the element with that id |

## Rules

- Do not edit `public/vendor/` (third-party builds).
- New sections: add `<section id="<name>-section" class="app-section is-hidden">`, a router case in `handleRoute`, and (optionally) a nav item with `data-section="<name>-section"`.
- No CDN links: add a library as pinned files under `public/vendor/<lib>/` (with its license), reference it as `/vendor/...` and list it in the table above. The CSP allows scripts, styles and fonts only from `'self'`; `test/vendorAssets.test.js` fails on external `<script>`/`<link>` URLs, missing files and broken `url()` references in vendored CSS.
- When `DEBUG_MODE=true`, the `#debug` styleguide shows every token (read from `tokens.css`; text colours with their contrast) and every component with its class names — look there before adding UI.
- New CSS uses tokens only; a missing value becomes a new token in `tokens.css` (the contrast test must stay green). `test/cssRules.test.js` fails on a raw colour, a px/rem font size, a z-index ≥ 10, a px radius, a `var(--x)` that nothing defines, a selector list defined twice, on any `style` attribute or `<style>` element in markup, and on more `!important` in `style.css` than its budget allows. Spacing and shadow geometry are not checked.
- Build UI from the components above; add a variant to `components.css` and to the styleguide (`pages/debug-components.js`) instead of a page-specific copy.
- Hover feedback (glow, lift) only on elements that do something when clicked.
- The event overview card is a link (`a.glass-card.event-card`) with `data-click="openEventCard"`: a plain click flies the card open, a middle or modifier click still opens a tab (`core/actions.js` leaves it to the browser) and the keyboard reaches it.
- Markup carries no `style` attribute and no `<style>` element: the CSP refuses them (`style-src-attr 'none'`) and `test/cssRules.test.js` fails on one. A start state "hidden" is the class `.is-hidden` (it beats every component rule and loses to an inline style; do not combine it with Bootstrap's `d-flex`/`d-block`, whose `!important` beats it). Scripts show such an element with `element.style.display = 'block'` or, in its own display type, with `showElement()` / `toggleElement()` from `core/ui.js` — never by clearing `style.display` (`test/frontendCsp.test.js` fails on that). A value that is only known at runtime (role or badge colour, a share in percent) goes into `data-style-color`, `data-style-border-color`, `data-style-background`, `data-style-glow` or `data-style-width`, and `applyStyleData(container)` sets it after rendering; values from a fixed set become classes.
- No Bootstrap class that forces light text or a dark surface: `navbar-dark`, `text-light`, `text-white`, `text-white-50`, `bg-dark`, `table-dark`, `btn-close-white` (`test/cssRules.test.js` fails on one). Use `text-secondary` for quiet text and plain `table` / `btn-close`; Bootstrap 5.3 colours `.btn-close` and the navbar toggler from `data-bs-theme` itself. A Bootstrap `.badge` is white text, so every badge also carries `text-bg-*`, `text-*-emphasis` or a class whose rule sets `color` / `--bs-badge-color` (test in `cssRules.test.js`). Every token used in `color:` must be one the contrast tests check (`designTokens.test.js`); `--accent-light` is a text colour too.
- Symbols are Bootstrap Icons (`<i class="bi bi-…">`), never emojis; only emojis that users type in (slot emojis, Discord names) appear. `test/cssRules.test.js` counts the emojis left in `index.html` and `public/js` (budget, D-05 to D-08 lower it).

## Gotchas

- Source maps are not vendored: with DevTools open, the browser reports missing `.map` files for Bootstrap and DOMPurify (harmless).
