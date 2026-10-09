---
id: frontend-markup
title: public/index.html and public/css/style.css — markup and styling map
type: module
tags: [frontend, html, css, bootstrap, theme, modals, sections, vendor, fonts]
sources: [public/index.html, public/css/style.css, public/vendor, test/vendorAssets.test.js]
part_of: [architecture]
see_also: [frontend-app, security]
---
# public/index.html and public/css/style.css — markup and styling map

> TL;DR: `index.html` (~1760 lines) contains every section and modal statically; JS toggles `display`. `style.css` (~3270 lines) is a dark theme driven by CSS variables in `:root`, organised in banner-commented blocks. Find things by element id (HTML) or block header (CSS) with `grep -n`.

## index.html structure

| Part | Ids / notes |
|---|---|
| `<head>` | everything from `/vendor` (see below): `fonts/fonts.css`, FontAwesome (for EasyMDE), Bootstrap CSS + Bootstrap Icons, EasyMDE + Flatpickr, marked + DOMPurify; then `/css/style.css?v=2` |
| Loading screen | `#loading-screen`, `.loading-letter`, `.loading-status`, `#particles` |
| Navbar | `#main-navbar`, `#nav-polls` (with `#nav-polls-badge`), `#nav-profile`, `#nav-admin`, `#nav-bot-control`, `#nav-debug`, `#login-btn-container`, `#user-info`, `#user-avatar`, `#user-name` |
| Banners | error banner, maintenance banner, planned-maintenance banner, panic lockdown overlay |
| Sections (`.app-section`) | `#login-section`, `#events-section`, `#event-detail-section`, `#polls-section`, `#poll-detail-section`, `#profile-section`, `#debug-section`, `#admin-section`, `#bot-control-section`, `#info-section` |
| Modals | `#importDiscordEventsModal`, `#eventModal` (5-step wizard: Grundlagen, Datum & Zeit, Teilnehmer & Zugang, Anmeldeformular, Erweitert), `#resetModal`, `#maintenanceModal`, `#registrationsModal`, `#botMessagesModal`, `#announceModal`, `#dataPrivacyModal`, `#updatesModal`, `#firstLoginModal`, `#pollEditorModal` (incl. answer fields `#poll-label-yes|maybe|no`), `#pollAnnounceModal`, `#pollDecideModal`, `#confirmModal` (generic, `showConfirmDialog`) |
| Scripts (end of body) | Bootstrap bundle, GSAP (`/vendor`), `/js/app.js` |

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
| `easymde/`, `flatpickr/` | EasyMDE 2.20.0, Flatpickr 4.6.13 (+ German locale, dark theme) | event description editor, date pickers |
| `fonts/` | Inter (variable, 300–700, 7 subsets) + UnifrakturCook 700, mirrored from Google Fonts; `fonts.css` declares the `@font-face` rules | `--font-body`, `--font-display` |

## style.css blocks (grep the header text)

`:root` variables → LOADING SCREEN → NAVBAR → BUTTONS → GLASS CARDS → SECTIONS → EVENT CARDS (+ Event Series, Rendered Markdown) → COUNTDOWN → CATEGORY PILLS → BADGES → STATS CARDS → PROFILE SECTION → DATE & TIME → WAITLIST → FORMS → TABLE → FORM BUILDER → ENTITY PICKER → LOGIN CARD → TOAST → ADMIN EVENT CARD → SCROLLBAR → CONFETTI → SKELETON LOADING → INFO PARTICLES → PROFILE SECTION (second block) → RESPONSIVE → UTILITY → INFO SECTION → EASYMDE CUSTOMIZATION → Participant Warning Badges → Calendar View → Event Comments → BOT CONTROL CENTER → EVENT WIZARD STEPPER → MAINTENANCE MODE → EVENT DETAIL (banner, sidebar, capacity bar, participants) → EVENT CARD (gradient placeholder, updated layout) → LOCATION AUTOCOMPLETE → DEBUG / STYLING GUIDE → ROLE SLOTS → DATE POLLS.

## Theme variables (`:root`)

`--bg-primary #0a0a0f`, `--bg-secondary`, `--bg-card`, `--bg-glass`, `--accent #8b5cf6` (violet), `--accent-light`, `--accent-dark`, `--danger #ef4444`, `--success #22c55e`, `--warning #eab308`, `--info #06b6d4`, `--text-primary/secondary/muted`, `--border-subtle`, `--border-accent`, `--font-display` (UnifrakturCook), `--font-body` (Inter), `--radius 12px`, `--radius-lg 16px`, `--shadow-glow`, `--transition`. Use these instead of hard-coded colours.

## Rules

- Do not edit `public/vendor/` (third-party builds).
- New sections: add `<section id="<name>-section" class="app-section" style="display:none;">`, a router case in `handleRoute`, and (optionally) a nav item with `data-section="<name>-section"`.
- No CDN links: add a library as pinned files under `public/vendor/<lib>/` (with its license), reference it as `/vendor/...` and list it in the table above. The CSP allows scripts, styles and fonts only from `'self'`; `test/vendorAssets.test.js` fails on external `<script>`/`<link>` URLs, missing files and broken `url()` references in vendored CSS.
- When `DEBUG_MODE=true`, the `#debug` "styling guide" section shows the colour/typography/component inventory — useful before adding UI.

## Gotchas

- "PROFILE SECTION" exists twice in `style.css`; later rules win.
- Source maps are not vendored: with DevTools open, the browser reports missing `.map` files for Bootstrap and DOMPurify (harmless).
