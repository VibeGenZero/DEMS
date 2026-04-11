# Debug Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a developer-only debug mode (ENV-gated) with extreme terminal logging, a collapsible debug card in Account-Einstellungen, and a full Styling Guide tab.

**Architecture:** `DEBUG_MODE=true` in `.env` activates server-side verbose logging via a shared `debugLog()` helper, exposes the flag to the frontend via `/api/server-info`, and the frontend gates both the debug card and the Styling Guide nav tab behind `window.DEBUG_MODE`. All debug UI is rendered purely client-side — no new API endpoints needed.

**Tech Stack:** Node.js/Express, vanilla JS (no framework), Bootstrap 5, GSAP, existing `glass-card` / `stat-card` CSS patterns.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `.env.example` | Modify | Document new `DEBUG_MODE` variable |
| `utils/debugLog.js` | Create | Shared verbose logging helper (server-side) |
| `server.js` | Modify | Debug HTTP logging middleware + expose `debugMode` in server-info |
| `routes/events.js` | Modify | Add `debugLog()` to key route handlers |
| `routes/admin.js` | Modify | Add `debugLog()` to key route handlers |
| `routes/user.js` | Modify | Add `debugLog()` to key route handlers |
| `routes/auth.js` | Modify | Add `debugLog()` to login flow |
| `bot.js` | Modify | Add `debugLog()` to Discord operations |
| `public/index.html` | Modify | Debug card HTML + Styling Guide section + nav tab |
| `public/js/app.js` | Modify | `window.DEBUG_MODE`, nav visibility, debug card render, `showDebugSection()`, router case |
| `public/css/style.css` | Modify | Styles for debug card + styling guide grid |

---

## Task 1: `utils/debugLog.js` + `.env.example`

**Files:**
- Create: `utils/debugLog.js`
- Modify: `.env.example`

- [ ] **Step 1: Create `utils/debugLog.js`**

```js
// utils/debugLog.js
// Verbose debug logger — only active when DEBUG_MODE=true in .env
// Usage: debugLog('label', { any: 'data' })

const IS_DEBUG = process.env.DEBUG_MODE === 'true';

const COLORS = {
    reset: '\x1b[0m',
    cyan:  '\x1b[36m',
    yellow:'\x1b[33m',
    magenta:'\x1b[35m',
    gray:  '\x1b[90m',
};

function timestamp() {
    return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}

function debugLog(label, data) {
    if (!IS_DEBUG) return;
    const ts = `${COLORS.gray}[DEBUG ${timestamp()}]${COLORS.reset}`;
    const lbl = `${COLORS.cyan}${label}${COLORS.reset}`;
    if (data !== undefined) {
        console.log(`${ts} ${lbl}`, data);
    } else {
        console.log(`${ts} ${lbl}`);
    }
}

module.exports = { debugLog, IS_DEBUG };
```

- [ ] **Step 2: Add `DEBUG_MODE` to `.env.example`**

Open `.env.example` and append after the `TIMEZONE` line:

```
# Debug mode — logs all HTTP requests, Firebase ops, and bot calls to terminal
# Set to true only in development. Never enable in production.
DEBUG_MODE=false
```

- [ ] **Step 3: Verify the helper works**

Add a temporary line to any route file:
```js
const { debugLog } = require('../utils/debugLog');
debugLog('TEST', { hello: 'world' });
```
Start the server with `DEBUG_MODE=true node server.js` — confirm output appears.
Remove the temporary line.

- [ ] **Step 4: Commit**

```bash
git add utils/debugLog.js .env.example
git commit -m "feat: add debugLog helper and DEBUG_MODE env var"
```

---

## Task 2: Server-Side HTTP Logging Middleware + server-info

**Files:**
- Modify: `server.js` (after line 66 `// ── Middleware` block, and the `/api/server-info` handler at line 150)

- [ ] **Step 1: Import `debugLog` and add HTTP logging middleware**

At the top of `server.js`, after `require('dotenv').config();`:

```js
const { debugLog, IS_DEBUG } = require('./utils/debugLog');
```

After the `app.use(express.static(...))` line (around line 109), add:

```js
// ── Debug HTTP logging ───────────────────────────────────────────────────
if (IS_DEBUG) {
    app.use((req, res, next) => {
        const start = Date.now();
        const sensitiveFields = ['password', 'token', 'secret', 'key', 'csrfToken'];

        // Sanitize body for logging
        let safeBody = null;
        if (req.body && Object.keys(req.body).length) {
            safeBody = Object.fromEntries(
                Object.entries(req.body).map(([k, v]) =>
                    [k, sensitiveFields.includes(k.toLowerCase()) ? '[REDACTED]' : v]
                )
            );
        }

        res.on('finish', () => {
            const ms = Date.now() - start;
            const status = res.statusCode;
            const color = status >= 500 ? '\x1b[31m'   // red
                        : status >= 400 ? '\x1b[33m'   // yellow
                        : '\x1b[32m';                  // green
            const reset = '\x1b[0m';
            const ip = req.ip || req.connection.remoteAddress || '-';
            console.log(
                `\x1b[90m[DEBUG ${new Date().toTimeString().slice(0,8)}]\x1b[0m` +
                ` \x1b[36m${req.method}\x1b[0m ${req.originalUrl}` +
                ` → ${color}${status}${reset} (${ms}ms) — ${ip}`
            );
            if (safeBody) debugLog('  body', safeBody);
        });

        next();
    });
}
```

- [ ] **Step 2: Extend `/api/server-info` to expose `debugMode`**

Find the `/api/server-info` handler (around line 150). Replace all three `res.json({...})` calls to include `debugMode`:

```js
app.get('/api/server-info', async (req, res) => {
    const debugMode = process.env.DEBUG_MODE === 'true';
    try {
        const guildId = process.env.DISCORD_GUILD_ID || '';
        if (process.env.SERVER_NAME) {
            return res.json({ serverName: process.env.SERVER_NAME, guildId, debugMode });
        }

        if (guildId) {
            const serverName = await getGuildName(guildId);
            if (serverName) {
                return res.json({ serverName, guildId, debugMode });
            }
        }

        res.json({ serverName: 'DEMS', guildId, debugMode });
    } catch (err) {
        console.error('Error fetching server info:', err);
        res.json({ serverName: 'DEMS', guildId: '', debugMode });
    }
});
```

- [ ] **Step 3: Verify**

Start server with `DEBUG_MODE=true node server.js`.
Open browser → make any request (e.g. navigate to the app).
Terminal should show colored HTTP log lines.

Run in browser console:
```js
fetch('/api/server-info').then(r=>r.json()).then(console.log)
```
Confirm response includes `"debugMode": true`.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add debug HTTP logging middleware and expose debugMode in server-info"
```

---

## Task 3: `debugLog()` in Routes

**Files:**
- Modify: `routes/events.js`, `routes/admin.js`, `routes/user.js`, `routes/auth.js`

- [ ] **Step 1: Add `debugLog` import to all four route files**

Add this line at the top of each file (after existing requires):
```js
const { debugLog } = require('../utils/debugLog');
```

- [ ] **Step 2: Add calls to `routes/events.js`**

In `router.get('/')` after `const snapshot = await getDocs(q)`:
```js
debugLog('events.GET /', { count: events.length, filters: req.query });
```

In `router.post('/:id/register')` (or wherever registration is handled) after the `addDoc` call:
```js
debugLog('events.register', { eventId: req.params.id, userId: req.session?.userId });
```

In `router.delete('/:id/register')` (or cancel) after the `deleteDoc` call:
```js
debugLog('events.cancelRegistration', { eventId: req.params.id, userId: req.session?.userId });
```

- [ ] **Step 3: Add calls to `routes/admin.js`**

Find the event creation handler (`router.post('/')` or similar). After the `addDoc` call:
```js
debugLog('admin.createEvent', { title: req.body.title, adminId: req.session?.userId });
```

Find the registration status update handler. After the `updateDoc` call:
```js
debugLog('admin.updateRegStatus', { regId: req.params.id, newStatus: req.body.status });
```

- [ ] **Step 4: Add calls to `routes/user.js`**

Find `router.get('/profile')`. After the Firebase fetch:
```js
debugLog('user.getProfile', { userId: req.session?.userId });
```

- [ ] **Step 5: Add calls to `routes/auth.js`**

Find the Discord callback/login completion. After `req.session.save`:
```js
debugLog('auth.login', { userId: req.session?.userId, username: req.session?.username });
```

Find the logout handler. After `req.session.destroy`:
```js
debugLog('auth.logout', { userId: req.session?.userId });
```

- [ ] **Step 6: Verify**

With `DEBUG_MODE=true`, trigger a login and load the events page.
Confirm terminal shows `[DEBUG HH:MM:SS] events.GET /` and `auth.login` entries.

- [ ] **Step 7: Commit**

```bash
git add routes/events.js routes/admin.js routes/user.js routes/auth.js
git commit -m "feat: add debugLog calls to all route handlers"
```

---

## Task 4: `debugLog()` in `bot.js`

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Add `debugLog` import**

At the top of `bot.js`:
```js
const { debugLog } = require('./utils/debugLog');
```

- [ ] **Step 2: Log key bot operations**

In `client.once('ready', ...)` after the existing `console.log`:
```js
debugLog('bot.ready', { tag: client.user.tag, guildId: process.env.DISCORD_GUILD_ID });
```

In `sendDM` function (or equivalent) before the DM send:
```js
debugLog('bot.sendDM', { userId, messageType: typeof message === 'string' ? 'text' : 'embed' });
```

In `assignRole` function (or equivalent) before the role assignment:
```js
debugLog('bot.assignRole', { userId, roleId });
```

In the reminder scheduler's send loop before each reminder:
```js
debugLog('bot.sendReminder', { eventId, recipientCount: participants?.length });
```

- [ ] **Step 3: Verify**

With `DEBUG_MODE=true`, start the server. After bot connects, terminal should show `bot.ready` log.

- [ ] **Step 4: Commit**

```bash
git add bot.js
git commit -m "feat: add debugLog calls to bot operations"
```

---

## Task 5: Frontend — `window.DEBUG_MODE` + Nav Tab Visibility

**Files:**
- Modify: `public/js/app.js` (around line 143 `loadServerInfo`, around line 274 `showLoggedIn`, around line 344 router switch)
- Modify: `public/index.html` (navbar, around line 103)

- [ ] **Step 1: Add debug nav tab to `index.html`**

In the navbar `<ul class="navbar-nav me-auto">`, after the `nav-bot-control` item (around line 107):

```html
<li class="nav-item" id="nav-debug" style="display:none;">
  <a class="nav-link" href="#debug" data-section="debug-section">
    <i class="bi bi-bug me-1"></i>Styling Guide
  </a>
</li>
```

- [ ] **Step 2: Store `debugMode` from server-info in `app.js`**

In `loadServerInfo()` (around line 143), add after `window._demsGuildId = data.guildId || ''`:

```js
window.DEBUG_MODE = data.debugMode === true;
if (window.DEBUG_MODE) {
    document.getElementById('nav-debug').style.display = 'block';
}
```

- [ ] **Step 3: Add `debug` case to the router switch in `handleRoute()`**

After `case 'info':` (around line 362):

```js
case 'debug':
    if (window.DEBUG_MODE) {
        showDebugSection();
    } else {
        navigateTo('events');
    }
    break;
```

- [ ] **Step 4: Verify**

With `DEBUG_MODE=false` in `.env`: nav tab must not appear, `#debug` redirects to events.
With `DEBUG_MODE=true`: nav tab is visible, clicking it shows the (empty for now) section.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/app.js
git commit -m "feat: add debug nav tab and window.DEBUG_MODE routing"
```

---

## Task 6: Debug Card in Account-Einstellungen

**Files:**
- Modify: `public/index.html` (after `#account-settings-card`, around line 470)
- Modify: `public/js/app.js` (in `showProfileSection()`, after `loadAccountSettings()`)

- [ ] **Step 1: Add debug card HTML to `index.html`**

After the closing `</div>` of `#account-settings-card` (around line 470), before `</div></section>`:

```html
<!-- Debug Card (only shown when DEBUG_MODE=true) -->
<div id="debug-card-wrapper" style="display:none;">
  <h5 class="mb-3 mt-4"><i class="bi bi-bug me-2" style="color:var(--warning);"></i>Debug-Informationen</h5>
  <div class="glass-card mb-4">
    <div class="d-flex align-items-center justify-content-between p-4" style="cursor:pointer;"
      data-bs-toggle="collapse" data-bs-target="#debug-collapse" aria-expanded="false">
      <div>
        <div class="fw-semibold" style="color:var(--warning);">🐛 Debug Panel</div>
        <small class="text-muted">Session, User-Daten, Server-Info, Verbose-Logging</small>
      </div>
      <i class="bi bi-chevron-down" id="debug-chevron"></i>
    </div>
    <div class="collapse" id="debug-collapse">
      <div class="p-4 pt-0">
        <hr class="border-secondary mt-0">

        <!-- User JSON -->
        <div class="mb-3">
          <div class="fw-semibold mb-1 small text-muted text-uppercase">currentUser</div>
          <pre id="debug-user-json" class="debug-json-block"></pre>
        </div>

        <!-- Server Info -->
        <div class="mb-3">
          <div class="fw-semibold mb-1 small text-muted text-uppercase">Server-Info</div>
          <pre id="debug-server-info" class="debug-json-block"></pre>
        </div>

        <!-- Verbose Logging Toggle -->
        <hr class="border-secondary">
        <div class="d-flex align-items-center justify-content-between">
          <div>
            <div class="fw-semibold">Verbose Frontend-Logging</div>
            <small class="text-muted">Loggt alle API-Calls in die Browser-Konsole</small>
          </div>
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" id="verbose-log-toggle" role="switch"
              onchange="toggleVerboseLog(this.checked)">
          </div>
        </div>

      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add debug card render logic to `app.js`**

At the end of `showProfileSection()`, before the closing `}` (after `await loadAccountSettings();`), add:

```js
// ── Debug Card ──────────────────────────────────────
if (window.DEBUG_MODE) {
    const wrapper = document.getElementById('debug-card-wrapper');
    wrapper.style.display = 'block';

    document.getElementById('debug-user-json').textContent =
        JSON.stringify(currentUser, null, 2);

    document.getElementById('debug-server-info').textContent =
        JSON.stringify({
            debugMode: window.DEBUG_MODE,
            guildId: window._demsGuildId,
            userAgent: navigator.userAgent.slice(0, 80),
            href: window.location.href,
        }, null, 2);

    // Restore verbose log toggle state from localStorage
    const verboseToggle = document.getElementById('verbose-log-toggle');
    verboseToggle.checked = localStorage.getItem('dems_verbose_log') === 'true';
    window.VERBOSE_LOG = verboseToggle.checked;

    // Animate chevron on collapse toggle
    const collapseEl = document.getElementById('debug-collapse');
    collapseEl.addEventListener('show.bs.collapse', () => {
        document.getElementById('debug-chevron').style.transform = 'rotate(180deg)';
    });
    collapseEl.addEventListener('hide.bs.collapse', () => {
        document.getElementById('debug-chevron').style.transform = 'rotate(0deg)';
    });
}
```

- [ ] **Step 3: Add `toggleVerboseLog` function to `app.js`**

After the `showProfileSection` function (around line 1929):

```js
function toggleVerboseLog(enabled) {
    window.VERBOSE_LOG = enabled;
    localStorage.setItem('dems_verbose_log', enabled ? 'true' : 'false');
    showToast(enabled ? '🐛 Verbose-Logging aktiviert' : 'Verbose-Logging deaktiviert', enabled ? 'warning' : 'secondary');
}
```

- [ ] **Step 4: Add verbose logging to API calls in `app.js`**

In `loadServerInfo()` (around line 143), after `const data = await res.json();`:
```js
if (window.VERBOSE_LOG) console.log('[VERBOSE] GET /api/server-info', data);
```

In `showProfileSection()`, after `const data = await res.json();` (around line 1819):
```js
if (window.VERBOSE_LOG) console.log('[VERBOSE] GET /api/user/profile', data);
```

In `loadAdminEvents()` or other key fetch calls, add the same pattern after each `res.json()`.

- [ ] **Step 5: Verify**

Navigate to Mein Profil. Debug card heading should be visible (if `DEBUG_MODE=true`).
Click the card header → it collapses/expands with chevron rotation.
User JSON and server info should be displayed in pre blocks.
Toggle verbose log → open browser console → navigate to Events → confirm `[VERBOSE]` lines appear.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/app.js
git commit -m "feat: add debug card to account settings with user JSON and verbose log toggle"
```

---

## Task 7: Styling Guide Section — HTML

**Files:**
- Modify: `public/index.html` (after the profile section closing `</section>`, around line 472)

- [ ] **Step 1: Add the full Styling Guide section HTML**

After `</section>` of profile-section and before the Admin section comment, insert:

```html
<!-- ── STYLING GUIDE SECTION (DEBUG ONLY) ── -->
<section id="debug-section" class="app-section" style="display:none;">
  <div class="container section-container">
    <div class="section-header">
      <h2><i class="bi bi-palette me-2"></i>Styling Guide</h2>
      <p class="text-secondary mb-0">Komponentenübersicht — nur im Debug-Modus sichtbar.</p>
    </div>

    <!-- 1. Farben -->
    <h5 class="sg-section-title">Farben</h5>
    <div id="sg-colors" class="sg-color-grid"></div>

    <!-- 2. Typographie -->
    <h5 class="sg-section-title">Typographie</h5>
    <div class="glass-card p-4 mb-4" id="sg-typography">
      <h1>H1 — Überschrift</h1>
      <h2>H2 — Überschrift</h2>
      <h3>H3 — Überschrift</h3>
      <h4>H4 — Überschrift</h4>
      <h5>H5 — Überschrift</h5>
      <h6>H6 — Überschrift</h6>
      <p class="lead">Lead — Einleitungstext für wichtige Aussagen</p>
      <p>Body — Standard-Fließtext. Lorem ipsum dolor sit amet consectetur adipiscing elit.</p>
      <p><small>Small — Kleine Hinweistexte, Metadaten</small></p>
      <p><code>code — Inline-Code-Darstellung</code></p>
      <p class="text-muted">text-muted — Abgedämpfter Hilfetext</p>
    </div>

    <!-- 3. Buttons -->
    <h5 class="sg-section-title">Buttons</h5>
    <div class="glass-card p-4 mb-4">
      <div id="sg-buttons" class="d-flex flex-wrap gap-2"></div>
    </div>

    <!-- 4. Badges & Pills -->
    <h5 class="sg-section-title">Badges &amp; Status-Pills</h5>
    <div class="glass-card p-4 mb-4">
      <div id="sg-badges" class="d-flex flex-wrap gap-2 align-items-center"></div>
    </div>

    <!-- 5. Cards -->
    <h5 class="sg-section-title">Cards</h5>
    <div id="sg-cards" class="mb-4"></div>

    <!-- 6. Formulare -->
    <h5 class="sg-section-title">Formulare</h5>
    <div class="glass-card p-4 mb-4" id="sg-forms">
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label">Text-Input</label>
          <input type="text" class="form-control" placeholder="Placeholder-Text">
        </div>
        <div class="col-md-6">
          <label class="form-label">Select</label>
          <select class="form-select">
            <option>Option 1</option>
            <option>Option 2</option>
            <option>Option 3</option>
          </select>
        </div>
        <div class="col-12">
          <label class="form-label">Textarea</label>
          <textarea class="form-control" rows="3" placeholder="Mehrzeiliger Text..."></textarea>
        </div>
        <div class="col-md-4">
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" id="sg-switch" checked>
            <label class="form-check-label" for="sg-switch">Form-Switch (an)</label>
          </div>
        </div>
        <div class="col-md-4">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="sg-checkbox" checked>
            <label class="form-check-label" for="sg-checkbox">Checkbox</label>
          </div>
        </div>
        <div class="col-md-4">
          <label class="form-label">Range</label>
          <input type="range" class="form-range" value="60">
        </div>
      </div>
    </div>

    <!-- 7. Feedback -->
    <h5 class="sg-section-title">Feedback</h5>
    <div class="glass-card p-4 mb-4">
      <div class="d-flex flex-wrap gap-3 align-items-center mb-3" id="sg-spinners"></div>
      <div id="sg-alerts" class="mb-3"></div>
      <button class="btn btn-outline-secondary btn-sm" onclick="showToast('🐛 Test-Toast vom Styling Guide!', 'info')">
        <i class="bi bi-bell me-1"></i>Toast testen
      </button>
    </div>

    <!-- 8. Animationen -->
    <h5 class="sg-section-title">Animationen (GSAP)</h5>
    <div class="glass-card p-4 mb-4">
      <div class="d-flex flex-wrap gap-2 mb-4" id="sg-anim-buttons"></div>
      <div id="sg-anim-demo" class="sg-anim-demo-box">
        <div class="sg-anim-demo-item glass-card p-3 text-center">Demo-Element A</div>
        <div class="sg-anim-demo-item glass-card p-3 text-center">Demo-Element B</div>
        <div class="sg-anim-demo-item glass-card p-3 text-center">Demo-Element C</div>
      </div>
    </div>

    <!-- 9. Icons -->
    <h5 class="sg-section-title">Icons (Bootstrap Icons)</h5>
    <div class="glass-card p-4 mb-4">
      <div id="sg-icons" class="sg-icon-grid"></div>
    </div>

  </div>
</section>
```

- [ ] **Step 2: Verify HTML parses correctly**

Open the app in browser (with `DEBUG_MODE=true`), navigate to `#debug`.
Section should appear (empty content — JS renders it in Task 8).
No console errors.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add styling guide section HTML structure"
```

---

## Task 8: `showDebugSection()` — JS Content Rendering

**Files:**
- Modify: `public/js/app.js` (add new function after `showProfileSection`)

- [ ] **Step 1: Add `showDebugSection()` to `app.js`**

After `showProfileSection()` (around line 1929), add the entire function:

```js
// ─── Debug / Styling Guide Section ───────────────
function showDebugSection() {
    const section = document.getElementById('debug-section');
    section.style.display = 'block';

    // ── 1. Farben ──────────────────────────────────
    const colorVars = [
        { name: '--bg-primary',     label: 'bg-primary' },
        { name: '--bg-secondary',   label: 'bg-secondary' },
        { name: '--bg-card',        label: 'bg-card' },
        { name: '--bg-glass',       label: 'bg-glass' },
        { name: '--accent',         label: 'accent' },
        { name: '--accent-light',   label: 'accent-light' },
        { name: '--accent-dark',    label: 'accent-dark' },
        { name: '--danger',         label: 'danger' },
        { name: '--success',        label: 'success' },
        { name: '--warning',        label: 'warning' },
        { name: '--info',           label: 'info' },
        { name: '--text-primary',   label: 'text-primary' },
        { name: '--text-secondary', label: 'text-secondary' },
        { name: '--text-muted',     label: 'text-muted' },
        { name: '--border-subtle',  label: 'border-subtle' },
        { name: '--border-accent',  label: 'border-accent' },
    ];
    const root = getComputedStyle(document.documentElement);
    document.getElementById('sg-colors').innerHTML = colorVars.map(c => {
        const val = root.getPropertyValue(c.name).trim();
        return `
      <div class="sg-color-swatch">
        <div class="sg-color-block" style="background:var(${c.name});"></div>
        <div class="sg-color-name">${c.label}</div>
        <div class="sg-color-val">${val}</div>
      </div>`;
    }).join('');

    // ── 2. Buttons ─────────────────────────────────
    const btns = [
        { cls: 'btn-primary',         label: 'btn-primary' },
        { cls: 'btn-outline-primary',  label: 'outline-primary' },
        { cls: 'btn-accent',           label: 'btn-accent' },
        { cls: 'btn-outline-secondary',label: 'outline-secondary' },
        { cls: 'btn-outline-light',    label: 'outline-light' },
        { cls: 'btn-danger',           label: 'btn-danger' },
        { cls: 'btn-outline-danger',   label: 'outline-danger' },
        { cls: 'btn-discord',          label: 'btn-discord' },
        { cls: 'btn-primary btn-sm',   label: 'btn-sm' },
        { cls: 'btn-primary btn-lg',   label: 'btn-lg' },
    ];
    document.getElementById('sg-buttons').innerHTML = btns.map(b =>
        `<button class="btn ${b.cls}">${b.label}</button>`
    ).join('');

    // ── 3. Badges & Pills ──────────────────────────
    const badges = [
        { cls: 'badge-pill status-pending',    label: '⏳ Ausstehend' },
        { cls: 'badge-pill status-accepted',   label: '✅ Angenommen' },
        { cls: 'badge-pill status-rejected',   label: '❌ Abgelehnt' },
        { cls: 'badge-pill status-waitlisted', label: '📋 Warteliste' },
        { cls: 'badge text-bg-primary',        label: 'primary' },
        { cls: 'badge text-bg-secondary',      label: 'secondary' },
        { cls: 'badge text-bg-success',        label: 'success' },
        { cls: 'badge text-bg-danger',         label: 'danger' },
        { cls: 'badge text-bg-warning',        label: 'warning' },
        { cls: 'badge text-bg-info',           label: 'info' },
    ];
    document.getElementById('sg-badges').innerHTML = badges.map(b =>
        `<span class="${b.cls}">${b.label}</span>`
    ).join('');

    // ── 4. Cards ───────────────────────────────────
    document.getElementById('sg-cards').innerHTML = `
      <div class="row g-3 mb-4">
        <div class="col-md-4">
          <div class="glass-card p-4"><div class="fw-semibold mb-1">glass-card</div><small class="text-muted">Standard-Kartenstil mit Glassmorphism</small></div>
        </div>
        <div class="col-md-4">
          <div class="stat-card">
            <div class="stat-icon"><i class="bi bi-star" style="color:var(--accent);"></i></div>
            <div class="stat-value">42</div>
            <div class="stat-label">stat-card</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="profile-reg-card">
            <div class="profile-reg-info">
              <h6>profile-reg-card</h6>
              <small>Kategorie · 01. Jan 2026</small>
            </div>
            <span class="badge-pill status-accepted">✅ Angenommen</span>
          </div>
        </div>
        <div class="col-md-4">
          <div class="profile-badge-card unlocked p-3 text-center">
            <div style="font-size:2rem;">🏆</div>
            <div class="fw-semibold mt-1">badge-card</div>
            <small class="text-muted">unlocked</small>
          </div>
        </div>
        <div class="col-md-4">
          <div class="profile-badge-card locked p-3 text-center">
            <div style="font-size:2rem;">🔒</div>
            <div class="fw-semibold mt-1">badge-card</div>
            <small class="text-muted">locked</small>
          </div>
        </div>
      </div>`;

    // ── 5. Spinners ────────────────────────────────
    document.getElementById('sg-spinners').innerHTML = `
      <div class="spinner-border spinner-border-sm text-secondary" title="spinner-border sm"></div>
      <div class="spinner-border text-accent" style="color:var(--accent);" title="spinner-border md"></div>
      <div class="spinner-border spinner-border-lg text-primary" title="spinner-border lg"></div>
      <div class="spinner-grow spinner-grow-sm text-success" title="spinner-grow sm"></div>
      <div class="spinner-grow text-warning" title="spinner-grow md"></div>`;

    // ── 6. Alerts ──────────────────────────────────
    document.getElementById('sg-alerts').innerHTML = `
      <div class="alert alert-success mb-2">✅ alert-success — Aktion erfolgreich abgeschlossen.</div>
      <div class="alert alert-warning mb-2">⚠️ alert-warning — Bitte beachte diesen Hinweis.</div>
      <div class="alert alert-danger mb-2">❌ alert-danger — Ein Fehler ist aufgetreten.</div>
      <div class="alert alert-info mb-0">ℹ️ alert-info — Informationstext für den Nutzer.</div>`;

    // ── 7. Animationen ─────────────────────────────
    const animations = [
        { label: 'Fade In',   fn: () => gsap.fromTo('.sg-anim-demo-item', { opacity: 0 }, { opacity: 1, duration: 0.6, stagger: 0.1 }) },
        { label: 'Slide Up',  fn: () => gsap.fromTo('.sg-anim-demo-item', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: 'power3.out' }) },
        { label: 'Stagger',   fn: () => gsap.from('.sg-anim-demo-item', { scale: 0.8, opacity: 0, duration: 0.4, stagger: 0.15, ease: 'back.out(1.7)' }) },
        { label: 'Bounce',    fn: () => gsap.from('.sg-anim-demo-item', { y: -30, duration: 0.5, stagger: 0.1, ease: 'bounce.out' }) },
        { label: 'Shake',     fn: () => gsap.to('.sg-anim-demo-item', { x: 10, duration: 0.07, repeat: 5, yoyo: true, ease: 'power1.inOut', stagger: 0.05 }) },
        { label: 'Pulse',     fn: () => gsap.to('.sg-anim-demo-item', { scale: 1.05, duration: 0.3, repeat: 3, yoyo: true, ease: 'power1.inOut', stagger: 0.1 }) },
    ];
    document.getElementById('sg-anim-buttons').innerHTML = animations.map((a, i) =>
        `<button class="btn btn-outline-secondary btn-sm" onclick="sgRunAnimation(${i})">${a.label}</button>`
    ).join('');
    window._sgAnimations = animations;

    // ── 8. Icons ───────────────────────────────────
    const icons = [
        'calendar-event','calendar-check','calendar-x','people','person','person-fill',
        'gear','gear-fill','star','star-fill','trophy','trophy-fill',
        'check-circle','check-circle-fill','x-circle','x-circle-fill',
        'exclamation-triangle','exclamation-triangle-fill','info-circle','info-circle-fill',
        'bell','bell-fill','chat-dots','chat-dots-fill','discord','robot',
        'moon-stars','moon-stars-fill','sun','lightning','lightning-fill',
        'list-check','journal-text','inbox','hourglass-split','shield-check',
        'bug','bug-fill','palette','palette-fill','code-slash','terminal',
    ];
    document.getElementById('sg-icons').innerHTML = icons.map(ic =>
        `<div class="sg-icon-item" title="bi-${ic}">
          <i class="bi bi-${ic}"></i>
          <span>${ic}</span>
        </div>`
    ).join('');

    // Animate section entrance
    if (typeof gsap !== 'undefined') {
        gsap.from('.sg-section-title', { y: 15, opacity: 0, duration: 0.3, stagger: 0.05, ease: 'power3.out' });
    }
}

function sgRunAnimation(index) {
    if (window._sgAnimations && window._sgAnimations[index]) {
        window._sgAnimations[index].fn();
    }
}
```

- [ ] **Step 2: Verify all sections render**

Navigate to `#debug`. Each section should populate:
- Color swatches with labels
- All button variants
- Status pills + Bootstrap badges
- Card examples
- Spinners and alerts
- Animation buttons (click each — demo elements should animate)
- Icon grid (~40 icons)

- [ ] **Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat: implement showDebugSection with full styling guide content"
```

---

## Task 9: CSS — Debug Card + Styling Guide Styles

**Files:**
- Modify: `public/css/style.css` (append at end of file)

- [ ] **Step 1: Append debug/styling-guide CSS**

At the end of `style.css`, add:

```css
/* ═══════════════════════════════════════════ */
/* DEBUG / STYLING GUIDE                       */
/* ═══════════════════════════════════════════ */

/* Debug JSON pre blocks */
.debug-json-block {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 1rem;
  font-size: 0.78rem;
  color: var(--accent-light);
  max-height: 250px;
  overflow-y: auto;
  margin: 0;
}

/* Chevron transition */
#debug-chevron {
  transition: transform 0.25s ease;
}

/* Styling Guide section titles */
.sg-section-title {
  margin-top: 2rem;
  margin-bottom: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  font-weight: 600;
}

/* Color swatches */
.sg-color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.sg-color-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  width: 80px;
}

.sg-color-block {
  width: 80px;
  height: 48px;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
}

.sg-color-name {
  font-size: 0.65rem;
  color: var(--text-muted);
  text-align: center;
  word-break: break-all;
}

.sg-color-val {
  font-size: 0.6rem;
  color: var(--text-muted);
  opacity: 0.6;
}

/* Animation demo */
.sg-anim-demo-box {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.sg-anim-demo-item {
  flex: 1;
  min-width: 120px;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

/* Icon grid */
.sg-icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.sg-icon-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  width: 72px;
  padding: 0.5rem 0.25rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  transition: var(--transition);
  cursor: default;
}

.sg-icon-item:hover {
  background: var(--bg-glass-hover);
  border-color: var(--border-accent);
}

.sg-icon-item i {
  font-size: 1.4rem;
  color: var(--accent-light);
}

.sg-icon-item span {
  font-size: 0.55rem;
  color: var(--text-muted);
  text-align: center;
  word-break: break-all;
}
```

- [ ] **Step 2: Verify styling**

With `DEBUG_MODE=true`:
- Mein Profil → debug card has correct spacing, JSON blocks scrollable, chevron rotates
- Styling Guide → colors grid is clean, icon grid has hover effect, animation demo box lays out horizontally

- [ ] **Step 3: Final end-to-end check**

1. `DEBUG_MODE=false` in `.env` → no nav tab, no debug card, `#debug` redirects
2. `DEBUG_MODE=true` in `.env` → nav tab visible, all 9 styling guide sections render, animations fire, debug card shows correct data, verbose log toggle persists across page reload

- [ ] **Step 4: Commit**

```bash
git add public/css/style.css
git commit -m "feat: add debug card and styling guide CSS"
```

---

## Spec Coverage Check

| Spec requirement | Covered in |
|---|---|
| `DEBUG_MODE=false` in `.env.example` | Task 1 |
| `debugLog()` helper | Task 1 |
| HTTP logging with color, sanitized body | Task 2 |
| Firebase/route logging | Task 3 |
| Bot logging | Task 4 |
| `debugMode` exposed via `/api/server-info` | Task 2 |
| `window.DEBUG_MODE` in frontend | Task 5 |
| Debug nav tab (hidden by default) | Task 5 |
| Router case `debug` | Task 5 |
| Debug card collapsible in Account-Einstellungen | Task 6 |
| User JSON in debug card | Task 6 |
| Server-info in debug card | Task 6 |
| Verbose frontend logging toggle | Task 6 |
| Styling Guide section HTML | Task 7 |
| Colors swatch grid | Task 8 |
| Typography | Task 7 (static HTML) |
| Buttons | Task 8 |
| Badges & Pills | Task 8 |
| Cards | Task 8 |
| Form elements | Task 7 (static HTML) |
| Spinners + Alerts + Toast test | Task 8 |
| GSAP animation buttons | Task 8 |
| Icon grid | Task 8 |
| CSS styles | Task 9 |