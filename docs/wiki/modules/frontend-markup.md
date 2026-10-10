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

> TL;DR: `index.html` contains every section and modal statically; JS toggles `display`. Styling is three files, loaded in this order: `tokens.css` (every colour, font size, spacing, radius, layer and shadow as a CSS variable), `components.css` (Bootstrap bridge and the nine components) and `style.css` (page-specific rules in banner-commented blocks). No raw colour, px/rem font size or z-index ≥ 10 outside `tokens.css`. Find things by element id (HTML) or block header (CSS) with `grep -n`.

## index.html structure

| Part | Ids / notes |
|---|---|
| `<head>` | everything from `/vendor` (see below): `fonts/fonts.css`, FontAwesome (for EasyMDE), Bootstrap CSS + Bootstrap Icons, EasyMDE + Flatpickr, marked + DOMPurify; then `/css/tokens.css?v=3`, `/css/components.css?v=3` and `/css/style.css?v=3` (in this order) |
| Loading screen | `#loading-screen`, `.loading-letter`, `.loading-status`, `#particles` |
| Navbar | `#main-navbar`, `#nav-polls` (with `#nav-polls-badge`), `#nav-profile`, `#nav-admin`, `#nav-bot-control`, `#nav-debug`, `#login-btn-container`, `#user-info`, `#user-avatar`, `#user-name` |
| Banners | error banner, maintenance banner, planned-maintenance banner, panic lockdown overlay |
| Sections (`.app-section`) | `#login-section`, `#events-section`, `#event-detail-section`, `#polls-section`, `#poll-detail-section`, `#profile-section`, `#debug-section`, `#admin-section`, `#bot-control-section`, `#info-section` |
| Modals | `#importDiscordEventsModal`, `#eventModal` (5-step wizard: Grundlagen, Datum & Zeit, Teilnehmer & Zugang, Anmeldeformular, Erweitert), `#resetModal`, `#maintenanceModal`, `#registrationsModal`, `#botMessagesModal`, `#announceModal`, `#dataPrivacyModal`, `#updatesModal`, `#firstLoginModal`, `#pollEditorModal` (incl. answer fields `#poll-label-yes|maybe|no`), `#pollAnnounceModal`, `#pollDecideModal`, `#confirmModal` (generic, `showConfirmDialog`) |
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
| `easymde/`, `flatpickr/` | EasyMDE 2.20.0, Flatpickr 4.6.13 (+ German locale, dark theme) | event description editor, date pickers |
| `fonts/` | Inter (variable, 300–700, 7 subsets) + UnifrakturCook 700, mirrored from Google Fonts; `fonts.css` declares the `@font-face` rules | `--font-body`, `--font-logo` |

## Stylesheets (`public/css/`)

| File | Content | Rule |
|---|---|---|
| `tokens.css` | one `:root` block with all design tokens (dark scheme) | the only file with colour values, font sizes in px/rem and layer numbers |
| `components.css` | BOOTSTRAP BRIDGE → BUTTON → DIALOG → TABS → TOAST → CARD → CHIP → SKELETON → EMPTY STATE → AVATAR | colours, px/rem font sizes, radii and layers ≥ 10 only from tokens (enforced by `npm test`); spacing from the `--space-*` tokens by convention; `!important` only in the colour helpers |
| `style.css` | page-specific blocks, see below | colours, px/rem font sizes, px radii and layers ≥ 10 only from tokens (enforced by `npm test`); spacing keeps its old raw values until a page is rebuilt; one rule per selector list |

`style.css` blocks (grep the header text): LOADING SCREEN → NAVBAR → SECTIONS → EVENT CARDS (+ Event Series, Rendered Markdown) → COUNTDOWN → CATEGORY PILLS (filter bar) → BADGES (upper-case rule of the event chips) → STATS CARDS → DATE & TIME → WAITLIST → FORMS → TABLE → FORM BUILDER → ENTITY PICKER → LOGIN CARD → ADMIN EVENT CARD → CONFETTI → PROFILE SECTION → RESPONSIVE → UTILITY → INFO SECTION → EASYMDE CUSTOMIZATION → Participant Warning Badges → Calendar View → Event Comments → BOT CONTROL CENTER → EVENT WIZARD STEPPER → MAINTENANCE MODE → EVENT DETAIL (banner, sidebar, capacity bar, participants) → LOCATION AUTOCOMPLETE → EVENT CARD (gradient placeholder, updated layout) → DEBUG / STYLING GUIDE → ROLE SLOTS → DATE POLLS.

## Tokens (`tokens.css`)

| Group | Tokens |
|---|---|
| Surfaces | `--bg-primary`, `--bg-secondary`, `--bg-card`, `--bg-glass`, `--bg-glass-hover`, `--bg-tint-1/2/3` (white 4/8/12 %), `--bg-inset`, `--bg-scrim` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted` |
| Borders | `--border-subtle`, `--border-strong`, `--border-accent` |
| Accent | `--accent` (brand violet: borders, icons, glows), `--accent-light`, `--accent-dark`, `--accent-text` (violet text and links), `--accent-fill` + `--accent-fill-hover` + `--on-accent` (solid fill and the text on it), `--accent-tint-1/2`, `--accent-glow` |
| Status | per `success`, `warning`, `danger`, `info`: `--<s>` (text), `--<s>-bg`, `--<s>-border`, `--<s>-fill`, `--on-<s>`; plus `--danger-fill-hover`; Discord: `--discord`, `--discord-hover`, `--on-discord` |
| Type | `--font-body` (Inter), `--font-logo` (UnifrakturCook, only `.loading-logo` and `.brand-text`), `--font-size-xs` 12 px … `-sm` 14, `-md` 16, `-lg` 18, `-xl` 20, `-2xl` 24, `-3xl` 32, `-4xl` 40, `-display` and `-logo` (fluid) |
| Spacing | `--space-4`, `-8`, `-12`, `-16`, `-24`, `-32`, `-48`, `-64` (name = pixels; not Bootstrap's `p-3` numbering) |
| Radius | `--radius-sm` 8 px, `--radius` 12 px, `--radius-lg` 16 px, `--radius-pill` |
| Layers | `--z-dropdown` 1000 < `--z-sticky` < `--z-nav` < `--z-banner` < `--z-dialog` < `--z-toast` < `--z-overlay` 2000 (Bootstrap's scale); local stacking from -1 to 9 may stay a number |
| Shadows, motion | `--shadow-sm/md/lg`, `--shadow-glow`, `--shadow-ring`; `--duration-fast/base/slow`, `--ease-standard`, `--transition` |

Contrast rules, enforced by `test/designTokens.test.js` (WCAG AA): every text colour (`--text-*`, `--accent-text`, the four status colours) has at least 4.5:1 on every surface and on `--bg-tint-1`; on `--bg-tint-2` and `--bg-tint-3` the test guarantees this only for `--text-primary` and `--text-secondary` (`--text-muted` falls below 4.5 on tint-2, most colours on tint-3), so use only those two there; a status colour has 4.5:1 on its own `-bg`; `--on-*` has 4.5:1 on its fill. White text never sits on `--accent`, it sits on `--accent-fill`.

## Components (`components.css`)

| Component | Classes | Old names that still work |
|---|---|---|
| Button | `.btn` + `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-discord`; `.btn-sm` 32 px, default 40 px, `.btn-lg` 48 px (height from `--btn-height`; a button stays an inline block, as a flex box it would drop the space between icon and label); `.btn-icon` | `.btn-accent` = primary; `.btn-outline-light`, `.btn-outline-secondary` = secondary; also themed: `.btn-warning`, `.btn-outline-primary/success/warning/danger` |
| Card | `.glass-card`; reacts to hover only as `.glass-card[data-click]`, `a.glass-card` or `.glass-card.is-clickable` | – |
| Chip | `.chip` + `.chip-success/warning/danger/info/accent`, `.chip-sm` (height from `--chip-height` and padding, so utility classes like `d-inline-block` do not shift the text); a `<button class="chip">` filters, `.active` marks the chosen one | `.badge-pill` (+ `.status-pending/accepted/rejected/waitlisted`), `.category-pill`, `.event-status-badge` (+ `.event-status-active/archived`), `.event-category-tag` |
| Tabs | `.nav.nav-pills` with `.nav-link` and `data-bs-toggle="pill"`; counter as `.chip.chip-sm` (gets `--text-primary` inside the active tab); scrolls sideways when the entries do not fit | – |
| Dialog | Bootstrap `.modal` markup | – |
| Toast | `showToast(message, type)`; class `toast-<type>` colours the edge and the icon | – |
| Empty state | `emptyState({ icon, title, text, action })` → `.empty-state` | – |
| Skeleton | `.skeleton` + `.skeleton-text` (`.is-short`), `-title`, `-img`, `-chip`, `-avatar`, `-card-body` | – |
| Avatar | `avatar({ url, name, size })` → `.avatar` (36 px), `.avatar-sm` 24, `.avatar-lg` 64, `.avatar-xl` 96, `.avatar-initials`; `.avatar-stack`, `.avatar-more` | the ten page-specific avatar classes stay until D-09 |

The Bootstrap bridge sets Bootstrap's own variables from the tokens (`--bs-body-*`, `--bs-btn-*`, `--bs-modal-*`, `--bs-toast-*`, `--bs-nav-pills-*`, `--bs-alert-*`) and overrides the colour helpers `.text-*`, `.bg-*`, `.text-bg-*` for primary, success, warning, danger and info, plus `.text-secondary` (Bootstrap's own grey has only 3.6–4.2:1 on the dark surfaces). `.text-muted` renders `--text-secondary` (Bootstrap ties it to its "secondary" colour); use `.text-body-tertiary` for `--text-muted`.

## Actions

No inline handlers (`onclick`, `onchange`, `oninput`, `onerror`): the CSP blocks them (`script-src-attr 'none'`). Instead:

| Attribute | Meaning |
|---|---|
| `data-click="name"` / `data-change="name"` / `data-input="name"` | runs the action `name` registered with `registerActions` (see [frontend-app](frontend-app.md)); the innermost element with an action wins; links get `preventDefault` |
| other `data-*` | parameters of the action, read via `el.dataset` (always escaped with `escapeHtml`) |
| `data-fallback="hide\|invisible\|initials"` | broken image: hide it, keep its space, or replace it with an initials tile (`data-initials`, `title`) — an `img.avatar` keeps its size classes and becomes `.avatar.avatar-initials` |
| `data-click="hide"` / `data-click="scrollTo"` / `data-change="toggleVisible"` + `data-target="<id>"` | built-in actions: hide, scroll to, or show/hide (checkbox) the element with that id |

## Rules

- Do not edit `public/vendor/` (third-party builds).
- New sections: add `<section id="<name>-section" class="app-section" style="display:none;">`, a router case in `handleRoute`, and (optionally) a nav item with `data-section="<name>-section"`.
- No CDN links: add a library as pinned files under `public/vendor/<lib>/` (with its license), reference it as `/vendor/...` and list it in the table above. The CSP allows scripts, styles and fonts only from `'self'`; `test/vendorAssets.test.js` fails on external `<script>`/`<link>` URLs, missing files and broken `url()` references in vendored CSS.
- When `DEBUG_MODE=true`, the `#debug` styleguide shows every token (read from `tokens.css`; text colours with their contrast) and every component with its class names — look there before adding UI.
- New CSS uses tokens only; a missing value becomes a new token in `tokens.css` (the contrast test must stay green). `test/cssRules.test.js` fails on a raw colour, a px/rem font size, a z-index ≥ 10, a px radius, a `var(--x)` that nothing defines, a selector list defined twice, and on more `style` attributes (markup) or `!important` (in `style.css`) than its budgets allow. Spacing and shadow geometry are not checked.
- Build UI from the components above; add a variant to `components.css` and to the styleguide (`pages/debug-components.js`) instead of a page-specific copy.
- Hover feedback (glow, lift) only on elements that do something when clicked.
- The `style` attributes in `index.html` and the modules are legacy (budget in `test/cssRules.test.js`, D-16 removes them); new markup uses classes, dynamic values go through `element.style.setProperty`.

## Gotchas

- Source maps are not vendored: with DevTools open, the browser reports missing `.map` files for Bootstrap and DOMPurify (harmless).
