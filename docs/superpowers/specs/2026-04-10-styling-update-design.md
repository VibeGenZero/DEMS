# DEMS Styling Update — Design Spec
**Date:** 2026-04-10  
**Status:** Approved

---

## Overview

Three-phase UI overhaul covering the event overview, event detail page, and the boot loading screen. The goal is a cleaner, more structured interface with a two-column event detail layout (matching the provided screenshot reference), consistent banner headers, participant avatars, and a smarter loading screen.

---

## Phase 1: Loading Screen (24h) + Series-Limit Fix

### Loading Screen — LocalStorage 24h Gate

**File:** `public/js/app.js` (~line 20)

On `DOMContentLoaded`, before calling `runBootAnimation()`:
- Read `localStorage.getItem('dems_boot_ts')`
- If the value exists and `Date.now() - value < 86_400_000` (24h in ms): skip animation, call `finishLoading()` directly (loading screen stays hidden)
- Otherwise: run animation as normal, then `localStorage.setItem('dems_boot_ts', Date.now())` inside `finishLoading()`

The `#loading-screen` element gets `style="display:none"` by default via CSS when the skip path is taken — achieved by hiding it immediately before `#app` is shown.

### Series-Limit in Detail-View

**File:** `public/js/app.js` (`showEventDetail`, ~line 738)

Currently all series dates are rendered without limit. Fix:
- `const maxVisible = 5`
- Render first 5 dates normally
- Remaining dates wrapped in `<div id="detail-series-hidden" style="display:none">`
- Toggle button below: `"X weitere Termine anzeigen"` / `"Weniger anzeigen"` using the same pattern already used in event cards (`toggleSeriesDates`)

---

## Phase 2: Event-Detail Redesign

### New Fields in Event Schema

**`accentColor`** (string, hex, e.g. `"#8b5cf6"`)
- Added to event create/edit form in admin: a color picker (`<input type="color">`) next to the Banner-URL field
- Stored in Firestore alongside other event fields
- Used as fallback when no banner image is set

**`location`** (object: `{ text: string, channelId?: string, channelType?: 'voice'|'text' }`)
- New text input in admin form with Discord channel autocomplete
- Autocomplete: new endpoint `GET /api/admin/channels` returns list of guild channels (`id`, `name`, `type`) via Discord bot
- Typing `#` or any text triggers dropdown suggestions filtered by name
- Selecting a channel saves `channelId` + `channelType`; free text saves only `text`, no `channelId`
- In detail view: if `channelId` present → render as `<a href="discord://channels/GUILD_ID/CHANNEL_ID">#channel-name</a>`; otherwise plain text

### Banner Header (always visible)

**File:** `public/index.html` + `public/js/app.js` + `public/css/style.css`

The `#detail-banner-area` is always rendered with a minimum height of 220px.

Priority:
1. `bannerUrl` set → `<img>` with `object-fit: cover` + dark gradient overlay at bottom
2. No banner, `accentColor` set → `background: linear-gradient(135deg, accentColor 0%, accentColor darkened 100%)`
3. Neither → deterministic gradient from 5 preset palette combos, chosen via `event.id.charCodeAt(0) % 5`

Preset gradients (using existing CSS vars):
```
0: #6d28d9 → #8b5cf6   (purple)
1: #1e40af → #3b82f6   (blue)
2: #065f46 → #10b981   (green)
3: #92400e → #f59e0b   (amber)
4: #9d174d → #ec4899   (pink)
```

### Two-Column Layout

**Structure:**
```html
<section id="event-detail-section">
  <div class="container section-container">
    <!-- Banner: full width -->
    <div id="detail-banner-area" class="event-detail-banner"></div>

    <!-- Back button -->
    <button onclick="navigateTo('events')">← Zurück zur Übersicht</button>

    <div class="row g-4">
      <!-- LEFT col -->
      <div class="col-lg-8">
        tags + title + countdown
        description (markdown)
        participants section
        registration form / status
        series dates
        comments
      </div>

      <!-- RIGHT col (sticky sidebar) -->
      <div class="col-lg-4">
        <div class="event-detail-sidebar sticky-top">
          details panel (date/time/duration/location/createdBy)
          capacity panel (progress bar)
          action button (Anmelden / registered status)
        </div>
      </div>
    </div>
  </div>
</section>
```

The sidebar uses `position: sticky; top: 80px` (below navbar).

### Participants Section

**New endpoint:** `GET /api/events/:id/participants` (auth required)
- Queries `registrations` collection: `eventId == id AND status == 'accepted'`
- Joins with `users` collection to get `displayName`, `avatar`
- Returns max 20 entries + `total` count
- No admin required — any logged-in user can call it

**UI (left column, below description):**
```
TEILNEHMER (6/20)
[Avatar] [Avatar] [Avatar] ... +N
```
- 32px circle avatars, `title` attribute = displayName (tooltip)
- `+N` pill if more than 20 accepted participants
- Only rendered when `currentUser` is set (logged-in gate in JS)
- Loaded in `showEventDetail()` alongside existing data fetches

### Details Sidebar Content

| Row | Icon | Content |
|-----|------|---------|
| Datum | `bi-calendar3` | `Mi., 15. April 2026` |
| Uhrzeit | `bi-clock` | `20:00 Uhr` |
| Dauer | `bi-hourglass` | `2h 30min` (only if `endDate` set; calculated as `endDate - startDate`) |
| Ort | `bi-geo-alt` | text or `<a href="discord://...">` |
| Erstellt von | `bi-person` | username from Firestore `users/{createdBy}.displayName` |

Kapazität section (below details):
- Label: `N Anmeldungen / M max.` (or `Unbegrenzt` if `maxParticipants == 0`)
- Progress bar: `width: (currentParticipants / maxParticipants * 100)%`, accent color, turns red when ≥ 90%
- `N Plätze verfügbar` subtext

Action button at bottom of sidebar:
- Mirrors the register/waitlist/registered/no-access states that currently appear in the left column
- Left column still shows the full form; sidebar button scrolls to `#detail-register-area` on click

---

## Phase 3: Overview Cards Update

### Layout Change

`col-md-6 col-lg-4` → `col-md-6` for all event cards (both standard and series).

### Card Structure (new)

```
┌──────────────────────────────────────┐
│ [Banner img OR gradient placeholder] │  160px, object-fit: cover
├──────────────────────────────────────┤
│ [Category Tag]            [Status]   │  top row
│                                      │
│  Event-Titel                         │  font-weight: 700
│  Beschreibung (2 lines, clamped)     │  text-secondary, font-size: 0.9rem
│                                      │
│  📅 Mi., 15. Apr · 20:00 Uhr         │  prominent date row
│  [Countdown]                         │
│                                      │
│  ████████░░  6 / 20 Plätze           │  mini progress bar (if maxParticipants > 0)
│                                      │
│  [🔓 Offen]  [⚡ Instant]            │  badge pills (smaller)
└──────────────────────────────────────┘
```

### Gradient Placeholder for Cards

Same deterministic logic as Phase 2 — `event.id.charCodeAt(0) % 5` selects from the 5 preset gradients. Applied as inline `style` on the banner placeholder `<div>`.

### Series Cards

Same 2-column layout. Series date list already has a `maxVisible` limit on cards — verify it is set to `3` (already in code). No change needed unless currently broken.

---

## Files Changed (Summary)

| File | Phase | Changes |
|------|-------|---------|
| `public/js/app.js` | 1 | Boot animation 24h gate |
| `public/js/app.js` | 1 | Series detail limit (max 5) |
| `public/js/app.js` | 2 | `showEventDetail` → 2-col layout, banner, participants, sidebar |
| `public/js/app.js` | 2 | Location autocomplete logic |
| `public/js/app.js` | 3 | Event card rendering (2-col, new structure) |
| `public/index.html` | 2 | `#event-detail-section` HTML restructure |
| `public/css/style.css` | 2+3 | New sidebar, banner, participants, card styles |
| `routes/events.js` | 2 | New `GET /api/events/:id/participants` endpoint |
| `routes/admin.js` | 2 | New `GET /api/admin/channels` endpoint |
| `routes/admin.js` | 2 | `accentColor` + `location` fields in create/update |

---

## Constraints & Notes

- All changes are frontend-first (CSS/JS) except 2 new API endpoints and 2 new Firestore fields
- `accentColor` and `location` are optional fields — existing events without them fall back gracefully
- The `location.channelId` deeplink uses `discord://channels/GUILD_ID/CHANNEL_ID` format (opens Discord app)
- Participants endpoint requires auth (`requireAuth` middleware) — no public exposure of user data
- Sticky sidebar: `top: 80px` to clear the fixed navbar height
