# DEMS Styling Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three-phase UI overhaul — 24h loading gate, series date limit, two-column event detail with sidebar/participants/location, overview card improvements.

**Architecture:** All frontend changes live in `public/index.html`, `public/js/app.js`, and `public/css/style.css`. Backend changes add two new API endpoints (`/api/events/:id/participants`, `/api/admin/channels`) and two new optional Firestore fields (`accentColor`, `location`). Existing event data is fully backwards-compatible.

**Tech Stack:** Express.js, Vanilla JS, Bootstrap 5.3, CSS custom properties, Firebase Firestore, Discord.js bot

---

## File Map

| File | Role |
|------|------|
| `public/js/app.js` | Boot gate, series limit, card rendering, detail rendering, location autocomplete |
| `public/index.html` | HTML structure of `#event-detail-section`, admin form new fields |
| `public/css/style.css` | Banner, sidebar, participants, capacity bar, card, location dropdown styles |
| `routes/events.js` | `GET /api/events/:id` (add `createdByName`), new `GET /api/events/:id/participants` |
| `routes/admin.js` | New `GET /api/admin/channels`, add `accentColor`/`location` to create+update |
| `bot.js` | New `getGuildChannels()` function, add to exports |

---

## Phase 1 — Loading Gate & Series Limit

---

### Task 1: 24h Loading Screen Gate

**Files:**
- Modify: `public/js/app.js:20-23`

- [ ] **Step 1: Replace the DOMContentLoaded handler**

Find this block in `app.js` (~line 20):
```javascript
document.addEventListener('DOMContentLoaded', () => {
    createParticles();
    runBootAnimation();
});
```

Replace it with:
```javascript
document.addEventListener('DOMContentLoaded', () => {
    const lastBoot = localStorage.getItem('dems_boot_ts');
    const shouldSkip = lastBoot && (Date.now() - parseInt(lastBoot, 10)) < 86_400_000;

    if (shouldSkip) {
        document.getElementById('loading-screen').style.display = 'none';
        finishLoading();
    } else {
        createParticles();
        runBootAnimation();
    }
});
```

- [ ] **Step 2: Save timestamp in finishLoading()**

Find `finishLoading()` (~line 171):
```javascript
async function finishLoading() {
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.style.display = 'none';
    document.getElementById('app').style.display = 'block';
```

Add `localStorage.setItem` as the first line inside the function:
```javascript
async function finishLoading() {
    localStorage.setItem('dems_boot_ts', Date.now().toString());
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.style.display = 'none';
    document.getElementById('app').style.display = 'block';
```

- [ ] **Step 3: Verify manually**
  1. Open the app in browser — loading animation plays
  2. Refresh the page — loading animation is skipped, app appears instantly
  3. Open DevTools → Application → Local Storage → confirm `dems_boot_ts` key exists
  4. Delete `dems_boot_ts` key → refresh → animation plays again

- [ ] **Step 4: Commit**
```bash
git add public/js/app.js
git commit -m "feat: skip boot animation when visited within last 24h (localStorage)"
```

---

### Task 2: Series Dates Limit in Detail View

**Files:**
- Modify: `public/js/app.js` — `showEventDetail()` series rendering (~line 738)

- [ ] **Step 1: Find and replace the series rendering block**

In `showEventDetail()`, find this block (~line 733):
```javascript
        if (event.seriesId) {
            try {
                const seriesRes = await fetch(`/api/events/series/${event.seriesId}`);
                const seriesEvents = await seriesRes.json();
                if (Array.isArray(seriesEvents) && seriesEvents.length > 1) {
                    seriesContainer.innerHTML = `
                        <div class="series-detail-section mt-4">
                            <h6 class="mb-3"><i class="bi bi-arrow-repeat me-2"></i>Termine der Serie</h6>
                            <div class="series-dates-list">
                                ${seriesEvents.map(se => {
                                    const isCurrent = se.id === eventId;
                                    const safeD = se.startDate ? se.startDate.replace(' ', 'T') : null;
                                    const dateStr = safeD ? new Date(safeD).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                                    return `
                                        <a class="series-date-item ${isCurrent ? 'active' : ''}" href="#" onclick="navigateTo('event/${se.id}'); return false;">
                                            <span><i class="bi bi-calendar-event me-2"></i>${dateStr}</span>
                                            <span class="series-date-participants"><i class="bi bi-people me-1"></i>${se.currentParticipants || 0}${se.maxParticipants > 0 ? '/' + se.maxParticipants : ''}</span>
                                        </a>`;
                                }).join('')}
                            </div>
                        </div>`;
```

Replace with:
```javascript
        if (event.seriesId) {
            try {
                const seriesRes = await fetch(`/api/events/series/${event.seriesId}`);
                const seriesEvents = await seriesRes.json();
                if (Array.isArray(seriesEvents) && seriesEvents.length > 1) {
                    const maxVisible = 5;
                    const visibleSeries = seriesEvents.slice(0, maxVisible);
                    const hiddenSeries = seriesEvents.slice(maxVisible);
                    const hiddenCount = hiddenSeries.length;

                    const renderSeriesItem = (se) => {
                        const isCurrent = se.id === eventId;
                        const safeD = se.startDate ? se.startDate.replace(' ', 'T') : null;
                        const dateStr = safeD ? new Date(safeD).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                        return `
                            <a class="series-date-item ${isCurrent ? 'active' : ''}" href="#" onclick="navigateTo('event/${se.id}'); return false;">
                                <span><i class="bi bi-calendar-event me-2"></i>${dateStr}</span>
                                <span class="series-date-participants"><i class="bi bi-people me-1"></i>${se.currentParticipants || 0}${se.maxParticipants > 0 ? '/' + se.maxParticipants : ''}</span>
                            </a>`;
                    };

                    seriesContainer.innerHTML = `
                        <div class="series-detail-section mt-4">
                            <h6 class="mb-3"><i class="bi bi-arrow-repeat me-2"></i>Termine der Serie</h6>
                            <div class="series-dates-list">
                                ${visibleSeries.map(renderSeriesItem).join('')}
                                ${hiddenCount > 0 ? `
                                    <div id="detail-series-hidden" style="display:none;">
                                        ${hiddenSeries.map(renderSeriesItem).join('')}
                                    </div>
                                    <a class="series-dates-toggle" href="#" onclick="toggleDetailSeriesDates(); return false;">
                                        <i class="bi bi-chevron-down me-1" id="detail-series-icon"></i>
                                        <span id="detail-series-toggle-text">${hiddenCount} weitere Termine anzeigen</span>
                                    </a>` : ''}
                            </div>
                        </div>`;
```

- [ ] **Step 2: Add the toggle function**

Add this function near the other `toggleSeriesDates` function (search for `function toggleSeriesDates` in app.js):
```javascript
function toggleDetailSeriesDates() {
    const hidden = document.getElementById('detail-series-hidden');
    const icon = document.getElementById('detail-series-icon');
    const text = document.getElementById('detail-series-toggle-text');
    if (!hidden) return;
    const isOpen = hidden.style.display !== 'none';
    hidden.style.display = isOpen ? 'none' : 'block';
    icon.className = isOpen ? 'bi bi-chevron-down me-1' : 'bi bi-chevron-up me-1';
    const count = hidden.querySelectorAll('.series-date-item').length;
    text.textContent = isOpen ? `${count} weitere Termine anzeigen` : 'Weniger anzeigen';
}
```

- [ ] **Step 3: Verify manually**
  1. Open a recurring event with more than 5 dates in detail view
  2. Confirm only 5 dates are shown
  3. Click "X weitere Termine anzeigen" — hidden dates appear
  4. Click again — collapses

- [ ] **Step 4: Commit**
```bash
git add public/js/app.js
git commit -m "fix: limit series dates in detail view to 5 with expand toggle"
```

---

## Phase 2 — Event Detail Redesign

---

### Task 3: Add `getGuildChannels` to Bot

**Files:**
- Modify: `bot.js` — add function after `getGuildRoles` (~line 580), add to exports

- [ ] **Step 1: Add `getGuildChannels` after `getGuildRoles`**

Find the closing `}` of `getGuildRoles` (~line 580) and add after it:
```javascript
/**
 * Get all channels from the guild (for location autocomplete)
 */
async function getGuildChannels(guildId) {
    if (!isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const channels = await guild.channels.fetch();
        return channels
            .filter(c => c && [ChannelType.GuildVoice, ChannelType.GuildText, ChannelType.GuildStageVoice, ChannelType.GuildForum].includes(c.type))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => ({
                id: c.id,
                name: c.name,
                type: (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) ? 'voice' : 'text'
            }));
    } catch (err) {
        console.error('Failed to get guild channels:', err.message);
        return [];
    }
}
```

- [ ] **Step 2: Add to module.exports**

Find `module.exports = {` at the bottom of `bot.js`. Add `getGuildChannels` to the exports object:
```javascript
module.exports = {
    client,
    startBot,
    stopBot,
    sendDM,
    sendChannelMessage,
    buildEventEmbed,
    assignRole,
    removeRole,
    getUserRoles,
    isGuildMember,
    getGuildName,
    getGuildRoles,
    getGuildChannels,        // ← add this line
    getGuildScheduledEvents,
    parseTemplate,
    startReminderScheduler,
    createEventChannels,
    addParticipantToEventChannels,
    removeParticipantFromEventChannels,
    deleteEventChannels,
    createScheduledEvent,
    getBotStatus,
    getBotSettings,
    saveBotSettings,
    getRunningEvents,
    sendGuestInvitation
};
```

- [ ] **Step 3: Commit**
```bash
git add bot.js
git commit -m "feat: add getGuildChannels to bot exports for location autocomplete"
```

---

### Task 4: New API Endpoints — Channels & Participants

**Files:**
- Modify: `routes/admin.js` — add `GET /api/admin/channels`
- Modify: `routes/events.js` — add `GET /api/events/:id/participants`, add `createdByName` to single event response

- [ ] **Step 1: Add channels endpoint to routes/admin.js**

Find the require line at the top of `routes/admin.js`:
```javascript
const { startBot, startReminderScheduler, stopBot, getGuildName } = require('./bot');
```
Replace with:
```javascript
const { startBot, startReminderScheduler, stopBot, getGuildName, getGuildRoles, getGuildChannels } = require('./bot');
```

Wait — check what's already imported. Search for `require('./bot')` in `routes/admin.js` and add `getGuildChannels` to the destructuring. Then add the endpoint before the module.exports (or near other Discord-related routes):

```javascript
/**
 * GET /api/admin/channels — List guild channels for location autocomplete
 */
router.get('/channels', async (req, res) => {
    try {
        const guildId = process.env.DISCORD_GUILD_ID;
        if (!guildId) return res.json([]);
        const channels = await getGuildChannels(guildId);
        res.json(channels);
    } catch (err) {
        console.error('Get channels error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Channels' });
    }
});
```

Place this after the existing `GET /api/admin/roles` endpoint (search for `router.get('/roles'`).

- [ ] **Step 2: Add createdByName to single event response in routes/events.js**

In `routes/events.js`, find `GET /api/events/:id` (~line 201). After fetching the event doc but before `res.json(...)`, add a user lookup:

```javascript
        // Look up creator display name
        let createdByName = '';
        const creatorId = docSnap.data().createdBy;
        if (creatorId) {
            try {
                const userSnap = await getDoc(doc(db, 'users', creatorId));
                if (userSnap.exists()) {
                    const u = userSnap.data();
                    createdByName = u.displayName || u.username || '';
                }
            } catch { /* non-fatal */ }
        }

        res.json({
            id: docSnap.id,
            ...docSnap.data(),
            currentParticipants,
            waitlistCount: waitSnap.size,
            createdByName              // ← add this
        });
```

- [ ] **Step 3: Add participants endpoint to routes/events.js**

Add after the `GET /:id/my-registration` route:

```javascript
/**
 * GET /api/events/:id/participants — Get accepted participants (auth required)
 */
router.get('/:id/participants', requireAuth, async (req, res) => {
    try {
        const regQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('status', '==', 'accepted')
        );
        const regSnap = await getDocs(regQ);

        const userIds = [];
        regSnap.forEach(d => {
            if (d.data().userId) userIds.push(d.data().userId);
        });

        const total = userIds.length;
        const limited = userIds.slice(0, 20);

        const participants = [];
        for (const uid of limited) {
            try {
                const userSnap = await getDoc(doc(db, 'users', uid));
                if (userSnap.exists()) {
                    const u = userSnap.data();
                    participants.push({
                        displayName: u.displayName || u.username || 'Unbekannt',
                        avatar: u.avatar || ''
                    });
                }
            } catch { /* skip missing users */ }
        }

        res.json({ participants, total });
    } catch (err) {
        console.error('Participants error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Teilnehmer' });
    }
});
```

- [ ] **Step 4: Test endpoints with curl**

```bash
# Channels (requires admin session — test via browser or with session cookie)
curl http://localhost:3000/api/admin/channels

# Participants (requires auth session)
curl http://localhost:3000/api/events/SOME_EVENT_ID/participants
```

Expected for channels: `[{"id":"...","name":"general","type":"text"}, ...]`  
Expected for participants: `{"participants":[{"displayName":"Alex K.","avatar":"https://cdn..."}],"total":6}`

- [ ] **Step 5: Commit**
```bash
git add routes/events.js routes/admin.js
git commit -m "feat: add participants endpoint, channels endpoint, createdByName to event response"
```

---

### Task 5: Add accentColor + location to Event Schema

**Files:**
- Modify: `routes/admin.js` — create + update routes

- [ ] **Step 1: Add fields to event create (POST /api/admin/events)**

In `routes/admin.js`, find the destructuring in `router.post('/events', ...)` (~line 109):
```javascript
        const {
            title, description, maxParticipants, accessMode, requiredRoles,
            approvalMode, assignRoleId, formFields,
            startDate, endDate, bannerUrl, category, status, reminderHours,
            recurring, recurringInterval, recurringUntil, checkinMessage,
            customBotMessages, autoCreateChannels, channelConfig, allowGuests
        } = req.body;
```

Add `accentColor, location` to the destructuring:
```javascript
        const {
            title, description, maxParticipants, accessMode, requiredRoles,
            approvalMode, assignRoleId, formFields,
            startDate, endDate, bannerUrl, category, status, reminderHours,
            recurring, recurringInterval, recurringUntil, checkinMessage,
            customBotMessages, autoCreateChannels, channelConfig, allowGuests,
            accentColor, location
        } = req.body;
```

Then find the `baseEvent` object and add the new fields:
```javascript
        const baseEvent = {
            // ... existing fields ...
            allowGuests: allowGuests !== false,
            accentColor: accentColor || '',
            location: location || null,
            // ... rest of existing fields ...
        };
```

- [ ] **Step 2: Add fields to event update (PUT /api/admin/events/:id)**

Find `router.put('/events/:id', ...)` in `routes/admin.js`. Find where `updates` object is built and add:
```javascript
        if (req.body.accentColor !== undefined) updates.accentColor = req.body.accentColor || '';
        if (req.body.location !== undefined) updates.location = req.body.location || null;
```

Place these lines alongside similar optional field updates (near `channelConfig`, `allowGuests`).

- [ ] **Step 3: Commit**
```bash
git add routes/admin.js
git commit -m "feat: add accentColor and location fields to event schema"
```

---

### Task 6: CSS — Phase 2 Styles

**Files:**
- Modify: `public/css/style.css` — append new sections at end of file

- [ ] **Step 1: Append all Phase 2 styles to style.css**

Add to the end of `public/css/style.css`:

```css
/* ═══════════════════════════════════════════ */
/* EVENT DETAIL — BANNER HEADER               */
/* ═══════════════════════════════════════════ */
.event-detail-banner-header {
  width: 100%;
  height: 220px;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%);
  flex-shrink: 0;
}

.event-detail-banner-header .event-detail-banner-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.event-detail-banner-header .event-detail-banner-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 30%, rgba(10, 10, 15, 0.75) 100%);
  pointer-events: none;
}

/* ═══════════════════════════════════════════ */
/* EVENT DETAIL — SIDEBAR                     */
/* ═══════════════════════════════════════════ */
.event-detail-sidebar {
  position: sticky;
  top: 80px;
}

.sidebar-section-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 1rem;
}

.sidebar-detail-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.sidebar-icon {
  color: var(--accent-light);
  font-size: 1rem;
  margin-top: 0.1rem;
  flex-shrink: 0;
  width: 1rem;
  text-align: center;
}

.sidebar-label {
  font-size: 0.7rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 0.15rem;
}

.sidebar-value {
  font-size: 0.9rem;
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-word;
}

.sidebar-value a {
  color: var(--accent-light);
  text-decoration: none;
}

.sidebar-value a:hover {
  text-decoration: underline;
}

/* ═══════════════════════════════════════════ */
/* EVENT DETAIL — CAPACITY BAR                */
/* ═══════════════════════════════════════════ */
.capacity-progress {
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  margin: 0.5rem 0 0.4rem;
}

.capacity-progress-bar {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 0.4s ease;
}

.capacity-progress-bar.danger {
  background: var(--danger);
}

.capacity-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.capacity-sublabel {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-top: 0.2rem;
}

/* ═══════════════════════════════════════════ */
/* EVENT DETAIL — PARTICIPANTS                */
/* ═══════════════════════════════════════════ */
.section-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.participants-avatar-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}

.participant-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--bg-card);
  object-fit: cover;
  cursor: default;
  transition: transform 0.15s;
}

.participant-avatar:hover {
  transform: scale(1.12);
  z-index: 1;
  position: relative;
}

.participant-avatar-placeholder {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-dark), var(--accent));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  color: #fff;
  border: 2px solid var(--bg-card);
  cursor: default;
}

.participants-overflow-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-secondary);
  border: 2px solid var(--border-subtle);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-secondary);
}

/* ═══════════════════════════════════════════ */
/* LOCATION AUTOCOMPLETE DROPDOWN             */
/* ═══════════════════════════════════════════ */
.location-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1050;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  max-height: 220px;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  margin-top: 2px;
}

.location-suggestion-item {
  padding: 0.5rem 0.85rem;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--text-secondary);
  transition: background 0.15s;
  display: flex;
  align-items: center;
}

.location-suggestion-item:hover {
  background: rgba(139, 92, 246, 0.12);
  color: var(--accent-light);
}
```

- [ ] **Step 2: Verify no syntax errors**

Open browser, check DevTools console for any CSS parse errors after saving.

- [ ] **Step 3: Commit**
```bash
git add public/css/style.css
git commit -m "feat: add CSS for detail banner, sidebar, participants, capacity bar, location dropdown"
```

---

### Task 7: HTML — Restructure Event Detail Section

**Files:**
- Modify: `public/index.html` — replace `#event-detail-section` block (~line 252–360)

- [ ] **Step 1: Replace the entire event-detail-section**

Find this block in `index.html` (~line 252):
```html
    <!-- ── EVENT DETAIL SECTION ── -->
    <section id="event-detail-section" class="app-section" style="display:none;">
      <div class="container section-container">
        <button class="btn btn-outline-light mb-4" onclick="navigateTo('events')">
          <i class="bi bi-arrow-left me-1"></i>Zurück
        </button>
        <div class="glass-card" id="event-detail-card">
          <!-- Banner rendered here -->
          <div id="detail-banner-area"></div>
          <div class="p-4 p-md-5">
```

Replace the entire `#event-detail-section` (from `<!-- ── EVENT DETAIL SECTION ── -->` to its closing `</section>`) with:

```html
    <!-- ── EVENT DETAIL SECTION ── -->
    <section id="event-detail-section" class="app-section" style="display:none;">

      <!-- Full-width banner (outside container) -->
      <div id="detail-banner-area" class="event-detail-banner-header"></div>

      <div class="container section-container">
        <button class="btn btn-sm btn-outline-light mt-3 mb-4" onclick="navigateTo('events')">
          <i class="bi bi-arrow-left me-1"></i>Zurück zur Übersicht
        </button>

        <div class="row g-4">

          <!-- ── LEFT: Main Content ── -->
          <div class="col-lg-8">

            <!-- Tags + Title + Countdown -->
            <div class="d-flex flex-wrap gap-2 mb-2 align-items-center">
              <span id="detail-category-tag"></span>
              <span id="detail-status-tag"></span>
            </div>
            <h2 id="detail-title" class="mb-3 fw-bold"></h2>
            <div id="detail-countdown-area" class="countdown countdown-detail countdown-live mb-4" style="display:none;"></div>

            <!-- Description -->
            <div class="glass-card p-4 mb-4">
              <h6 class="section-label mb-3"><i class="bi bi-text-left me-2"></i>BESCHREIBUNG</h6>
              <div id="detail-description"></div>
            </div>

            <!-- Participants (only shown when logged in) -->
            <div id="detail-participants-section" class="glass-card p-4 mb-4" style="display:none;">
              <h6 class="section-label mb-3">
                <i class="bi bi-people me-2"></i>TEILNEHMER
                <span id="detail-participants-count" class="ms-1 fw-normal text-secondary"></span>
              </h6>
              <div id="detail-participants-avatars" class="participants-avatar-stack"></div>
            </div>

            <!-- Series dates (rendered by JS) -->
            <div id="detail-series-section"></div>

            <!-- Registration Form -->
            <div id="detail-register-area">
              <div class="glass-card p-4 mb-4">
                <h5 class="mb-3"><i class="bi bi-pencil-square me-2"></i>Anmeldung</h5>
                <form id="registration-form">
                  <div id="dynamic-form-fields"></div>

                  <div class="mt-3 mb-2" id="guest-tickets-area">
                    <label class="form-label mb-1"><i class="bi bi-person-plus me-1"></i>Gäste hinzufügen (optional)</label>
                    <div class="input-group mb-2">
                      <input type="text" class="form-control" id="guest-search-input"
                        placeholder="Name oder Benutzername suchen..."
                        oninput="debounceGuestSearch()" autocomplete="off">
                      <span class="input-group-text bg-transparent border-secondary">
                        <i class="bi bi-search text-muted"></i>
                      </span>
                    </div>
                    <div id="guest-search-results" class="list-group mb-2" style="display:none;max-height:200px;overflow-y:auto;"></div>
                    <div id="selected-guests" class="d-flex flex-wrap gap-2 mb-1"></div>
                    <small class="text-muted">Suche nach Servernutzern — sie erhalten eine Discord-Einladung und müssen bestätigen. Jeder Gast belegt einen Event-Platz.</small>
                  </div>

                  <button type="submit" class="btn btn-accent btn-lg mt-3" id="register-btn">
                    <i class="bi bi-check-circle me-2"></i>Teilnehmen
                  </button>
                </form>
              </div>
            </div>

            <!-- Waitlist -->
            <div id="detail-waitlist" style="display:none;">
              <div class="glass-card p-4 mb-4">
                <hr class="border-secondary">
                <div class="d-flex align-items-center gap-3 mb-3">
                  <i class="bi bi-hourglass-split text-info" style="font-size:2rem;"></i>
                  <div>
                    <h5 class="mb-1">Event ist voll</h5>
                    <p class="text-secondary mb-0">Du kannst dich auf die Warteliste setzen. <span id="detail-waitlist-count"></span></p>
                  </div>
                </div>
                <form id="waitlist-form">
                  <div id="waitlist-form-fields"></div>
                  <button type="submit" class="btn btn-outline-light btn-lg mt-2" id="waitlist-btn">
                    <i class="bi bi-list-nested me-2"></i>Auf Warteliste setzen
                  </button>
                </form>
              </div>
            </div>

            <!-- Already registered -->
            <div id="detail-registered" style="display:none;">
              <div class="glass-card p-4 mb-4">
                <div class="d-flex align-items-center gap-3">
                  <i class="bi bi-check-circle-fill text-success" style="font-size:2rem;"></i>
                  <div class="flex-grow-1">
                    <h5 class="mb-1">Bereits registriert</h5>
                    <p class="text-secondary mb-0">Status: <span id="detail-reg-status" class="fw-bold"></span></p>
                  </div>
                  <button class="btn btn-outline-danger" onclick="unregisterFromEvent()" id="unregister-btn">
                    <i class="bi bi-x-circle me-1"></i>Abmelden
                  </button>
                </div>
              </div>
            </div>

            <!-- No access -->
            <div id="detail-no-access" style="display:none;">
              <div class="glass-card p-4 mb-4">
                <div class="d-flex align-items-center gap-3">
                  <i class="bi bi-lock-fill text-warning" style="font-size:2rem;"></i>
                  <div>
                    <h5 class="mb-1">Zugriff eingeschränkt</h5>
                    <p class="text-secondary mb-0" id="no-access-text">Du hast nicht die erforderliche Rolle für dieses Event.</p>
                  </div>
                </div>
              </div>
            </div>

          </div><!-- /col-lg-8 -->

          <!-- ── RIGHT: Sidebar ── -->
          <div class="col-lg-4">
            <div class="event-detail-sidebar">

              <!-- Details panel -->
              <div class="glass-card p-4 mb-3">
                <div class="sidebar-section-title">DETAILS</div>
                <div id="sidebar-date-row" class="sidebar-detail-row" style="display:none;"></div>
                <div id="sidebar-time-row" class="sidebar-detail-row" style="display:none;"></div>
                <div id="sidebar-duration-row" class="sidebar-detail-row" style="display:none;"></div>
                <div id="sidebar-location-row" class="sidebar-detail-row" style="display:none;"></div>
                <div id="sidebar-creator-row" class="sidebar-detail-row" style="display:none;"></div>
              </div>

              <!-- Capacity panel -->
              <div class="glass-card p-4 mb-3" id="sidebar-capacity-panel" style="display:none;">
                <div class="sidebar-section-title">KAPAZITÄT</div>
                <div id="sidebar-capacity-content"></div>
              </div>

              <!-- Action button -->
              <div id="sidebar-action-area"></div>

            </div>
          </div><!-- /col-lg-4 -->

        </div><!-- /row -->
      </div><!-- /container -->
    </section>
```

- [ ] **Step 2: Verify the HTML is valid**

Open the page in browser. The event detail section should render without JS errors. Navigate to an event — the two-column layout should appear (even if not fully styled yet).

- [ ] **Step 3: Commit**
```bash
git add public/index.html
git commit -m "feat: restructure event detail section to two-column layout with sidebar"
```

---

### Task 8: JS — showEventDetail() Rewrite + Sidebar + Participants

**Files:**
- Modify: `public/js/app.js` — `showEventDetail()` (~line 651) + new helper functions

- [ ] **Step 1: Add helper functions before showEventDetail()**

Add these functions just above `async function showEventDetail(eventId) {`:

```javascript
// ─── Detail View Helpers ─────────────────────
const GRADIENT_PRESETS = [
    'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)',
    'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
    'linear-gradient(135deg, #065f46 0%, #10b981 100%)',
    'linear-gradient(135deg, #92400e 0%, #f59e0b 100%)',
    'linear-gradient(135deg, #9d174d 0%, #ec4899 100%)'
];

function getEventGradient(eventId) {
    const idx = (eventId || '').charCodeAt(0) % GRADIENT_PRESETS.length;
    return GRADIENT_PRESETS[isNaN(idx) ? 0 : idx];
}

function renderDetailBanner(event) {
    const bannerArea = document.getElementById('detail-banner-area');
    if (!bannerArea) return;

    if (isValidBannerUrl(event.bannerUrl)) {
        bannerArea.style.background = '';
        bannerArea.innerHTML = `
            <img src="${escapeHtml(event.bannerUrl)}" class="event-detail-banner-img" alt="Banner">
            <div class="event-detail-banner-overlay"></div>`;
        bannerArea.querySelector('img').addEventListener('error', function () {
            this.style.display = 'none';
            bannerArea.style.background = event.accentColor
                ? `linear-gradient(135deg, ${escapeHtml(event.accentColor)}99 0%, ${escapeHtml(event.accentColor)} 100%)`
                : getEventGradient(event.id);
        });
    } else {
        bannerArea.innerHTML = '';
        bannerArea.style.background = event.accentColor
            ? `linear-gradient(135deg, ${escapeHtml(event.accentColor)}99 0%, ${escapeHtml(event.accentColor)} 100%)`
            : getEventGradient(event.id);
    }
}

function setSidebarRow(rowId, icon, label, value, isHtml = false) {
    const el = document.getElementById(rowId);
    if (!el) return;
    el.style.display = 'flex';
    el.innerHTML = `
        <i class="bi ${icon} sidebar-icon"></i>
        <div>
            <div class="sidebar-label">${escapeHtml(label)}</div>
            <div class="sidebar-value">${isHtml ? value : escapeHtml(String(value))}</div>
        </div>`;
}

function renderSidebarDetails(event) {
    const guildId = window._demsGuildId || '';

    if (event.startDate) {
        const safeStart = event.startDate.replace(' ', 'T');
        const d = new Date(safeStart);
        const dateStr = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
        setSidebarRow('sidebar-date-row', 'bi-calendar3', 'Datum', dateStr);
        setSidebarRow('sidebar-time-row', 'bi-clock', 'Uhrzeit', timeStr);

        if (event.endDate) {
            const safeEnd = event.endDate.replace(' ', 'T');
            const end = new Date(safeEnd);
            const diffMs = end - d;
            if (diffMs > 0) {
                const hours = Math.floor(diffMs / 3600000);
                const mins = Math.floor((diffMs % 3600000) / 60000);
                const durationStr = hours > 0
                    ? `${hours}h${mins > 0 ? ` ${mins}min` : ''}`
                    : `${mins}min`;
                setSidebarRow('sidebar-duration-row', 'bi-hourglass', 'Dauer', durationStr);
            }
        }
    }

    if (event.location && event.location.text) {
        const locHtml = event.location.channelId && guildId
            ? `<a href="discord://channels/${guildId}/${escapeHtml(event.location.channelId)}">${escapeHtml(event.location.text)}</a>`
            : escapeHtml(event.location.text);
        setSidebarRow('sidebar-location-row', 'bi-geo-alt', 'Ort', locHtml, true);
    }

    if (event.createdByName) {
        setSidebarRow('sidebar-creator-row', 'bi-person', 'Erstellt von', event.createdByName);
    }

    renderSidebarCapacity(event);
}

function renderSidebarCapacity(event) {
    const panel = document.getElementById('sidebar-capacity-panel');
    const content = document.getElementById('sidebar-capacity-content');
    if (!panel || !content) return;

    if (event.maxParticipants > 0) {
        const current = event.currentParticipants || 0;
        const max = event.maxParticipants;
        const pct = Math.min(100, Math.round((current / max) * 100));
        const isDanger = pct >= 90;
        const available = max - current;

        panel.style.display = 'block';
        content.innerHTML = `
            <div class="capacity-label">${current} Anmeldungen / ${max} max.</div>
            <div class="capacity-progress">
                <div class="capacity-progress-bar${isDanger ? ' danger' : ''}" style="width:${pct}%"></div>
            </div>
            <div class="capacity-sublabel">${available > 0 ? `${available} Plätze verfügbar` : 'Ausgebucht'}</div>`;
    } else {
        panel.style.display = 'block';
        content.innerHTML = `<div class="capacity-label">Unbegrenzte Kapazität</div>`;
    }
}

async function loadDetailParticipants(eventId) {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/events/${eventId}/participants`);
        if (!res.ok) return;
        const data = await res.json();
        const section = document.getElementById('detail-participants-section');
        const avatarsEl = document.getElementById('detail-participants-avatars');
        const countEl = document.getElementById('detail-participants-count');
        if (!section || !avatarsEl) return;

        section.style.display = 'block';
        countEl.textContent = `(${data.total})`;

        if (!data.participants.length) {
            avatarsEl.innerHTML = '<span class="text-muted small">Noch keine bestätigten Teilnehmer.</span>';
            return;
        }

        const overflow = data.total > 20 ? data.total - 20 : 0;
        avatarsEl.innerHTML = data.participants.map(p => {
            const initials = (p.displayName || '?').charAt(0).toUpperCase();
            if (p.avatar) {
                return `<img src="${escapeHtml(p.avatar)}" class="participant-avatar" title="${escapeHtml(p.displayName)}" alt="${escapeHtml(p.displayName)}" onerror="this.outerHTML='<div class=\\'participant-avatar-placeholder\\' title=\\'${escapeHtml(p.displayName)}\\'>${initials}</div>'">`;
            }
            return `<div class="participant-avatar-placeholder" title="${escapeHtml(p.displayName)}">${initials}</div>`;
        }).join('') + (overflow > 0 ? `<div class="participants-overflow-badge">+${overflow}</div>` : '');
    } catch { /* non-fatal */ }
}
```

- [ ] **Step 2: Update showEventDetail() — banner, sidebar, participants**

In `showEventDetail()`, find the existing banner rendering block:
```javascript
        // Banner
        const bannerArea = document.getElementById('detail-banner-area');
        if (isValidBannerUrl(event.bannerUrl)) {
            bannerArea.innerHTML = `<img src="${escapeHtml(event.bannerUrl)}" class="event-banner-detail" alt="Banner">`;
            bannerArea.querySelector('img').addEventListener('error', function () { this.style.display = 'none'; });
        } else {
            bannerArea.innerHTML = '';
        }
```

Replace with:
```javascript
        // Banner
        renderDetailBanner(event);
```

- [ ] **Step 3: Replace badge pills with sidebar call**

Find the badges block in `showEventDetail()`:
```javascript
        // Badges
        document.getElementById('detail-access-badge').innerHTML = `...`;
        document.getElementById('detail-approval-badge').innerHTML = `...`;
        document.getElementById('detail-participants-badge').innerHTML = `...`;

        // Date badge
        const dateBadge = document.getElementById('detail-date-badge');
        ...
```

These IDs no longer exist in the new HTML. Remove those blocks entirely and replace with a single call:
```javascript
        // Sidebar details
        renderSidebarDetails(event);
```

- [ ] **Step 4: Remove old GSAP animation targeting #event-detail-card**

Find all occurrences of:
```javascript
gsap.from('#event-detail-card', { y: 20, opacity: 0, duration: 0.5, ease: 'power3.out' });
```

There are several in `showEventDetail()`. Replace each with:
```javascript
gsap.from('.event-detail-sidebar', { x: 20, opacity: 0, duration: 0.5, ease: 'power3.out', delay: 0.1 });
gsap.from('.col-lg-8', { y: 20, opacity: 0, duration: 0.4, ease: 'power3.out' });
```

(Do this replacement only for the first occurrence; the others that appear inside conditional blocks can be simplified to just the `.col-lg-8` animation or removed entirely since the cards are already gone.)

- [ ] **Step 5: Add participant loading after existing data fetches**

In `showEventDetail()`, just before `loadComments(eventId)` near the end of the main try block, add:
```javascript
        loadDetailParticipants(eventId);
        loadComments(eventId);
```

(The `loadComments` call already exists — add `loadDetailParticipants` just before it, wherever `loadComments` appears in the function.)

- [ ] **Step 6: Store guildId globally for deeplinks**

In `loadServerInfo()` in app.js (~line 131), after fetching server info, expose the guildId from a new field. First update server.js to include guildId in the response:

In `server.js`, find:
```javascript
app.get('/api/server-info', async (req, res) => {
    try {
        // Priority 1: Environment variable override
        if (process.env.SERVER_NAME) {
            return res.json({ serverName: process.env.SERVER_NAME });
        }
        // Priority 2: Fetch from Discord API
        const guildId = process.env.DISCORD_GUILD_ID;
        if (guildId) {
            const serverName = await getGuildName(guildId);
            if (serverName) {
                return res.json({ serverName });
            }
        }
        // Fallback
        res.json({ serverName: 'DEMS' });
```

Change every `res.json({ serverName })` / `res.json({ serverName: ... })` to also include `guildId`:
```javascript
app.get('/api/server-info', async (req, res) => {
    try {
        const guildId = process.env.DISCORD_GUILD_ID || '';
        if (process.env.SERVER_NAME) {
            return res.json({ serverName: process.env.SERVER_NAME, guildId });
        }
        if (guildId) {
            const serverName = await getGuildName(guildId);
            if (serverName) {
                return res.json({ serverName, guildId });
            }
        }
        res.json({ serverName: 'DEMS', guildId });
```

Then in `loadServerInfo()` in `app.js`:
```javascript
async function loadServerInfo() {
    try {
        const res = await fetch('/api/server-info');
        const data = await res.json();
        serverName = data.serverName || 'DEMS';
        window._demsGuildId = data.guildId || '';   // ← add this line
        updateServerNameInUI();
    } catch (e) {
        console.error('Failed to fetch server info', e);
        serverName = 'DEMS';
    }
}
```

- [ ] **Step 7: Test event detail rendering**

1. Navigate to any event — two-column layout should appear
2. Confirm banner shows (image or gradient)
3. Sidebar shows date, time, creator
4. For events with `endDate` set: duration row appears
5. For logged-in users: participants section loads
6. Capacity bar appears for events with `maxParticipants > 0`

- [ ] **Step 8: Commit**
```bash
git add public/js/app.js server.js
git commit -m "feat: event detail two-column layout with banner, sidebar, participants, capacity"
```

---

### Task 9: Admin Form — Color Picker + Location Autocomplete

**Files:**
- Modify: `public/index.html` — add fields to event wizard
- Modify: `public/js/app.js` — location autocomplete logic, saveEvent(), editEvent()

- [ ] **Step 1: Add accentColor field to admin event form HTML**

In `index.html`, find the banner URL field in the event wizard (search for `id="event-banner-url"`). Add the color picker immediately after the banner URL field group:

```html
              <div class="mb-3">
                <label class="form-label small text-muted"><i class="bi bi-palette me-1"></i>Akzentfarbe (optional)</label>
                <div class="d-flex align-items-center gap-3">
                  <input type="color" class="form-control form-control-color" id="event-accent-color"
                    value="#8b5cf6" style="width:48px;height:36px;padding:2px;">
                  <small class="text-muted">Hintergrundfarbe wenn kein Banner-Bild gesetzt ist.</small>
                </div>
              </div>
```

- [ ] **Step 2: Add location field to admin event form HTML**

In `index.html`, in the same wizard step as the banner URL field, add after the accentColor field:

```html
              <div class="mb-3 position-relative">
                <label class="form-label small text-muted"><i class="bi bi-geo-alt me-1"></i>Ort (optional)</label>
                <input type="text" class="form-control form-control-sm" id="event-location-text"
                  placeholder="z.B. #gaming-voice oder Teamspeak Server"
                  autocomplete="off" oninput="handleLocationInput()">
                <div id="location-suggestions" class="location-dropdown" style="display:none;"></div>
                <input type="hidden" id="event-location-channel-id">
                <input type="hidden" id="event-location-channel-type">
                <small class="text-muted mt-1 d-block">Tippe # für Discord-Channel-Vorschläge.</small>
              </div>
```

- [ ] **Step 3: Add location autocomplete JS to app.js**

Add these functions near the admin-related functions (e.g., after `loadCategories`):

```javascript
// ─── Location Autocomplete ───────────────────
let _cachedChannels = null;

async function loadChannelsForAutocomplete() {
    if (_cachedChannels !== null) return _cachedChannels;
    try {
        const res = await fetch('/api/admin/channels');
        _cachedChannels = await res.json();
        return _cachedChannels;
    } catch { return []; }
}

async function handleLocationInput() {
    const input = document.getElementById('event-location-text');
    const suggestionsEl = document.getElementById('location-suggestions');
    if (!input || !suggestionsEl) return;

    const val = input.value.trim();

    // Clear saved channel selection when user types
    const chanIdEl = document.getElementById('event-location-channel-id');
    const chanTypeEl = document.getElementById('event-location-channel-type');
    if (chanIdEl) chanIdEl.value = '';
    if (chanTypeEl) chanTypeEl.value = '';

    if (!val) {
        suggestionsEl.style.display = 'none';
        return;
    }

    const channels = await loadChannelsForAutocomplete();
    const query = val.replace(/^#/, '').toLowerCase();
    const filtered = channels.filter(c => c.name.toLowerCase().includes(query)).slice(0, 8);

    if (!filtered.length) {
        suggestionsEl.style.display = 'none';
        return;
    }

    suggestionsEl.innerHTML = filtered.map(c => `
        <div class="location-suggestion-item"
             onclick="selectLocationChannel('${escapeHtml(c.id)}', '${escapeHtml(c.name)}', '${c.type}')">
            <i class="bi bi-${c.type === 'voice' ? 'volume-up' : 'hash'} me-2"></i>${escapeHtml(c.name)}
        </div>`).join('');
    suggestionsEl.style.display = 'block';
}

function selectLocationChannel(channelId, channelName, channelType) {
    const input = document.getElementById('event-location-text');
    if (input) input.value = '#' + channelName;
    const chanIdEl = document.getElementById('event-location-channel-id');
    if (chanIdEl) chanIdEl.value = channelId;
    const chanTypeEl = document.getElementById('event-location-channel-type');
    if (chanTypeEl) chanTypeEl.value = channelType;
    const suggestionsEl = document.getElementById('location-suggestions');
    if (suggestionsEl) suggestionsEl.style.display = 'none';
}

// Close location dropdown when clicking outside
document.addEventListener('click', (e) => {
    const suggestionsEl = document.getElementById('location-suggestions');
    if (suggestionsEl && !e.target.closest('#event-location-text') && !e.target.closest('#location-suggestions')) {
        suggestionsEl.style.display = 'none';
    }
});
```

- [ ] **Step 4: Add new fields to saveEvent()**

In `saveEvent()` (~line 2823), find the `data` object and add before the closing `}`:
```javascript
        accentColor: document.getElementById('event-accent-color')?.value || '',
        location: (() => {
            const text = document.getElementById('event-location-text')?.value?.trim() || '';
            if (!text) return null;
            return {
                text,
                channelId: document.getElementById('event-location-channel-id')?.value || '',
                channelType: document.getElementById('event-location-channel-type')?.value || ''
            };
        })(),
```

- [ ] **Step 5: Populate new fields in editEvent()**

In `editEvent()` (~line 2718), after `document.getElementById('event-banner-url').value = event.bannerUrl || '';` add:
```javascript
        // Accent color
        const accentEl = document.getElementById('event-accent-color');
        if (accentEl) accentEl.value = event.accentColor || '#8b5cf6';

        // Location
        const locationText = document.getElementById('event-location-text');
        const locationChanId = document.getElementById('event-location-channel-id');
        const locationChanType = document.getElementById('event-location-channel-type');
        if (locationText) locationText.value = event.location?.text || '';
        if (locationChanId) locationChanId.value = event.location?.channelId || '';
        if (locationChanType) locationChanType.value = event.location?.channelType || '';
```

- [ ] **Step 6: Test the admin form**

1. Open admin → create new event
2. Confirm color picker appears next to banner URL field
3. Confirm location field appears
4. Type `#` in location field — Discord channels should appear as dropdown
5. Select a channel — field fills with `#channel-name`
6. Save event — `accentColor` and `location` saved (check in Firebase Console or via `/api/events/:id`)
7. Edit existing event — fields pre-populate correctly

- [ ] **Step 7: Commit**
```bash
git add public/index.html public/js/app.js
git commit -m "feat: admin form — accentColor picker and location field with channel autocomplete"
```

---

## Phase 3 — Overview Cards Update

---

### Task 10: CSS — Updated Card Styles

**Files:**
- Modify: `public/css/style.css` — update `.event-card` section and add card gradient placeholder

- [ ] **Step 1: Add card gradient placeholder styles to style.css**

Append to `public/css/style.css`:

```css
/* ═══════════════════════════════════════════ */
/* EVENT CARD — GRADIENT PLACEHOLDER          */
/* ═══════════════════════════════════════════ */
.event-banner-placeholder {
  width: 100%;
  height: 160px;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  display: block;
  flex-shrink: 0;
}

/* ═══════════════════════════════════════════ */
/* EVENT CARD — UPDATED LAYOUT                */
/* ═══════════════════════════════════════════ */
.event-card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}

.event-card-date-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.event-card-date-row i {
  color: var(--accent-light);
  font-size: 0.9rem;
}

.event-card-mini-progress {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.07);
  overflow: hidden;
  margin-bottom: 0.3rem;
}

.event-card-mini-progress-bar {
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
}

.event-card-mini-progress-bar.danger {
  background: var(--danger);
}

.event-card-capacity-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}
```

- [ ] **Step 2: Commit**
```bash
git add public/css/style.css
git commit -m "feat: add CSS for updated event card layout with gradient placeholder and mini progress bar"
```

---

### Task 11: JS — Event Card Rendering Update

**Files:**
- Modify: `public/js/app.js` — `showEventsSection()` card rendering (~line 447)

- [ ] **Step 1: Replace banner HTML logic in card rendering**

In `showEventsSection()`, find:
```javascript
        grid.innerHTML = events.map(event => {
            const bannerHtml = isValidBannerUrl(event.bannerUrl)
                ? `<img src="${escapeHtml(event.bannerUrl)}" class="event-banner" alt="Banner">`
                : '';
```

Replace with:
```javascript
        grid.innerHTML = events.map(event => {
            const bannerHtml = isValidBannerUrl(event.bannerUrl)
                ? `<img src="${escapeHtml(event.bannerUrl)}" class="event-banner" alt="Banner">`
                : `<div class="event-banner-placeholder" style="background:${
                    event.accentColor
                        ? `linear-gradient(135deg,${escapeHtml(event.accentColor)}99 0%,${escapeHtml(event.accentColor)} 100%)`
                        : getEventGradient(event.id)
                  }"></div>`;
```

- [ ] **Step 2: Replace standard event card HTML**

Find the standard (non-series) event card template string (~line 551):
```javascript
            return `
        <div class="col-md-6 col-lg-4">
          <div class="glass-card event-card" onclick="navigateTo('event/${event.id}')">
            ${bannerHtml}
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <h5 class="mb-0">${escapeHtml(event.title)}</h5>
                ${categoryHtml}
              </div>
              <p>${escapeHtml(event.description || '').substring(0, 120)}${(event.description || '').length > 120 ? '...' : ''}</p>
              ${dateHtml}
              ${safeDate ? `<div class="countdown" id="${countdownId}" data-date="${safeDate}"></div>` : ''}
              <div class="d-flex flex-wrap gap-2 mt-3">
                <span class="badge-pill">
                  <i class="bi bi-${event.accessMode === 'open' ? 'unlock' : 'lock'}"></i>
                  ${event.accessMode === 'open' ? 'Offen' : 'Rolle nötig'}
                </span>
                <span class="badge-pill">
                  <i class="bi bi-${event.approvalMode === 'instant' ? 'lightning' : 'hourglass-split'}"></i>
                  ${event.approvalMode === 'instant' ? 'Instant' : 'Manuell'}
                </span>
                ${event.maxParticipants > 0 ? `
                  <span class="badge-pill">
                    <i class="bi bi-people"></i>Max ${event.maxParticipants}
                  </span>
                ` : ''}
                ${getParticipantWarningBadge(event)}
              </div>
            </div>
          </div>
        </div>
      `;
```

Replace with:
```javascript
            // Build date string for card
            let cardDateStr = '';
            if (safeDate) {
                const d = new Date(safeDate);
                cardDateStr = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short' })
                    + ' · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
            }

            // Mini capacity bar
            let miniCapacityHtml = '';
            if (event.maxParticipants > 0) {
                const current = event.currentParticipants || 0;
                const pct = Math.min(100, Math.round((current / event.maxParticipants) * 100));
                const isDanger = pct >= 90;
                miniCapacityHtml = `
                    <div class="event-card-mini-progress">
                        <div class="event-card-mini-progress-bar${isDanger ? ' danger' : ''}" style="width:${pct}%"></div>
                    </div>
                    <div class="event-card-capacity-label">${current} / ${event.maxParticipants} Plätze</div>`;
            }

            return `
        <div class="col-md-6">
          <div class="glass-card event-card" onclick="navigateTo('event/${event.id}')">
            ${bannerHtml}
            <div class="card-body">
              <div class="event-card-header-row">
                ${categoryHtml}
                <span></span>
              </div>
              <h5 class="mb-1 fw-bold">${escapeHtml(event.title)}</h5>
              <p class="mb-2">${escapeHtml(event.description || '').substring(0, 120)}${(event.description || '').length > 120 ? '...' : ''}</p>
              ${cardDateStr ? `<div class="event-card-date-row"><i class="bi bi-calendar3"></i>${escapeHtml(cardDateStr)}</div>` : ''}
              ${safeDate ? `<div class="countdown" id="${countdownId}" data-date="${safeDate}"></div>` : ''}
              ${miniCapacityHtml}
              <div class="d-flex flex-wrap gap-2 mt-2">
                <span class="badge-pill">
                  <i class="bi bi-${event.accessMode === 'open' ? 'unlock' : 'lock'}"></i>
                  ${event.accessMode === 'open' ? 'Offen' : 'Rolle nötig'}
                </span>
                <span class="badge-pill">
                  <i class="bi bi-${event.approvalMode === 'instant' ? 'lightning' : 'hourglass-split'}"></i>
                  ${event.approvalMode === 'instant' ? 'Instant' : 'Manuell'}
                </span>
                ${getParticipantWarningBadge(event)}
              </div>
            </div>
          </div>
        </div>
      `;
```

- [ ] **Step 3: Update series card column width**

Find the series card template (~line 491):
```javascript
                return `
            <div class="col-md-6 col-lg-4">
              <div class="glass-card event-card series-card">
```

Change `col-md-6 col-lg-4` to `col-md-6`:
```javascript
                return `
            <div class="col-md-6">
              <div class="glass-card event-card series-card">
```

Also update the banner in the series card from empty string to gradient placeholder — find in the series card where `bannerHtml` is used and confirm it picks up the updated `bannerHtml` variable from Step 1 (it should already since it's in the same `.map()` scope).

- [ ] **Step 4: Handle banner load errors for placeholder cards**

After the `grid.innerHTML = ...` block, the existing error handler targets `.event-banner` images. This is fine since placeholder `<div>` elements have no error events. No change needed.

- [ ] **Step 5: Test overview cards**

1. Navigate to events section
2. Confirm 2-column grid (was 3-column before)
3. Events without banner show a gradient placeholder
4. Date row appears below title with icon
5. Events with `maxParticipants > 0` show mini progress bar

- [ ] **Step 6: Commit**
```bash
git add public/js/app.js
git commit -m "feat: update event overview cards to 2-column with gradient placeholders and capacity bar"
```

---

## Self-Review Checklist

- [x] Loading 24h gate — Task 1
- [x] Series limit (max 5) in detail view — Task 2
- [x] `getGuildChannels` bot function — Task 3
- [x] Participants endpoint — Task 4
- [x] Channels endpoint — Task 4
- [x] `createdByName` in event response — Task 4
- [x] `accentColor` field stored + returned — Task 5
- [x] `location` field stored + returned — Task 5
- [x] CSS: banner, sidebar, participants, capacity, location dropdown — Task 6
- [x] HTML restructure (2-col layout) — Task 7
- [x] Banner rendering (image/accentColor/gradient) — Task 8
- [x] Sidebar: date, time, duration, location, creator — Task 8
- [x] Capacity bar in sidebar — Task 8
- [x] Participants section (logged-in only) — Task 8
- [x] `guildId` in server-info for deeplinks — Task 8
- [x] Admin color picker — Task 9
- [x] Admin location field + autocomplete — Task 9
- [x] `saveEvent()` + `editEvent()` updated — Task 9
- [x] Card gradient placeholder — Task 10 + 11
- [x] Card 2-column layout — Task 11
- [x] Card date row prominent — Task 11
- [x] Card mini capacity bar — Task 11
- [x] Series card 2-column — Task 11
