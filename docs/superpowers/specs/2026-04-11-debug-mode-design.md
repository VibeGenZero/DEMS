# Debug Mode — Design Spec
**Datum:** 2026-04-11

## Überblick

Debug Mode ist ein rein entwicklerseitiges Feature, das über die `.env`-Variable `DEBUG_MODE=true` aktiviert wird. Es besteht aus drei Teilen:

1. **Extreme Logging** — Server loggt alles im Terminal
2. **Debug-Karte** — ausklappbarer Bereich in den Account-Einstellungen
3. **Styling Guide Tab** — neuer Nav-Tab mit vollständiger UI-Komponentenübersicht

Endnutzer können den Modus nicht aktivieren. Er ist ausschließlich für den Entwickler/Betreiber gedacht.

---

## Teil 1 — ENV & Server-Side Logging

### Neue ENV-Variable
```
DEBUG_MODE=false   # in .env.example
```

### Server (`server.js`)
- Wenn `DEBUG_MODE=true`: Logging-Middleware nach dem `helmet`/`cors`-Block einbinden
- Format: `[DEBUG HH:MM:SS] METHOD /path → STATUS (Xms) — IP`
- Farben: grün für 2xx, gelb für 3xx/4xx, rot für 5xx
- Request-Body wird geloggt, außer Felder: `password`, `token`, `secret`, `key`
- Keine externe Logging-Library — reines `console.log` mit eigenem Formatter

### Routes (`routes/*.js`)
- `debugLog(label, data)` Helper-Funktion in `utils/debugLog.js`
- Wird in allen Route-Handlern aufgerufen für: Firebase Reads/Writes, Discord API Calls
- Gibt nichts aus wenn `DEBUG_MODE !== 'true'`

### Bot (`bot.js`)
- Bestehende kritische Pfade (Event erstellen, Kanal erstellen, Reminder senden) rufen `debugLog()` auf

### API-Exposition
- `GET /api/server-info` (bestehender Endpoint) liefert zusätzlich: `debugMode: process.env.DEBUG_MODE === 'true'`
- Das Frontend liest diesen Wert beim Start und speichert ihn in `window.DEBUG_MODE`

---

## Teil 2 — Debug-Karte in Account-Einstellungen

### Sichtbarkeit
- Nur wenn `window.DEBUG_MODE === true`
- Wird nach dem bestehenden Account-Einstellungen-Block eingefügt (`#account-settings-card`)

### HTML-Struktur
```
<h5 id="debug-settings-heading">  (nur sichtbar wenn debugMode)
<div class="glass-card" id="debug-card">
  <button data-bs-toggle="collapse" data-bs-target="#debug-collapse">
    🐛 Debug-Informationen  [Chevron]
  </button>
  <div id="debug-collapse" class="collapse">
    — User-JSON
    — Server-Info (NODE_ENV, DEBUG_MODE, Version)
    — Frontend-Verbose-Logging Toggle (localStorage)
  </div>
</div>
```

### Frontend-Verbose-Logging
- Toggle-Switch: schaltet `window.VERBOSE_LOG = true` und persistiert in `localStorage`
- Wenn aktiv: alle `fetch()`-Calls in `app.js` loggen Request + Response via `console.log`
- Umsetzung: Nach jedem `await fetch()` in `showProfileSection()` und verwandten Funktionen wird ein `if (window.VERBOSE_LOG) console.log(...)` Block eingefügt — kein globaler Wrapper, gezielt in den Debug-relevanten API-Calls

---

## Teil 3 — Styling Guide Tab

### Sichtbarkeit
- Neuer `<li id="nav-debug">` in der Navbar — `display:none` by default
- Wird sichtbar wenn `window.DEBUG_MODE === true` (analog zu `nav-admin`)
- Hash: `#debug`, Section-ID: `debug-section`

### Routing
- In `navigateTo()` neuer Case `'debug'` → `showDebugSection()`
- `showDebugSection()` rendert alle Kategorien statisch (kein API-Call nötig)

### Inhalts-Sektionen

#### 1. Farben
- Grid aller CSS-Custom-Properties aus `:root` in `style.css`
- Jede Kachel zeigt: Farbblock + Variablenname + berechneter Hex-Wert (via `getComputedStyle`)

#### 2. Typographie
- H1–H6, `.lead`, `body`, `small`, `code`, `.text-muted` je mit Label

#### 3. Buttons
- Alle Klassen: `btn-primary`, `btn-outline-primary`, `btn-accent`, `btn-danger`, `btn-outline-danger`, `btn-outline-secondary`, `btn-outline-light`, `btn-discord`
- Je in Normal, Hover (via `:hover`-Demo), `btn-sm`, `btn-lg`

#### 4. Badges & Pills
- Status-Pills: `status-pending`, `status-accepted`, `status-rejected`, `status-waitlisted`
- Bootstrap-Badges: primary, secondary, success, danger, warning

#### 5. Cards
- `glass-card`, `stat-card`, `profile-reg-card`, `profile-badge-card` (unlocked + locked)

#### 6. Formulare
- Text-Input, Select, Textarea, Form-Switch, Checkbox, Range — je mit Label

#### 7. Feedback
- Spinner: `spinner-border` sm/md/lg + `spinner-grow`
- Alerts: success, warning, danger, info
- Button: "Toast testen" → triggert einen echten Toast via `showToast()`

#### 8. Animationen (GSAP)
- Buttons mit Labels: Fade In, Slide Up, Stagger, Bounce, Shake, Pulse
- Jeder Button animiert ein Demo-Element darunter

#### 9. Icons
- Grid der ~40 im Projekt verwendeten Bootstrap-Icons (aus `app.js` gescannt)

---

## Datei-Änderungen

| Datei | Änderung |
|---|---|
| `.env.example` | `DEBUG_MODE=false` hinzufügen |
| `server.js` | Debug-Logging-Middleware + `server-info` Endpoint erweitern |
| `utils/debugLog.js` | Neuer Helper |
| `routes/events.js`, `routes/user.js`, `routes/admin.js`, `routes/auth.js` | `debugLog()` Calls einbauen |
| `bot.js` | `debugLog()` Calls einbauen |
| `public/index.html` | Debug-Karte + Styling-Guide-Section + Nav-Tab |
| `public/js/app.js` | `showDebugSection()`, `window.DEBUG_MODE` Logik, Debug-Karte rendern |
| `public/css/style.css` | Ggf. kleine Stile für Debug-Karte und Styling-Guide-Grid |

---

## Nicht im Scope

- Kein Log-File-Export
- Kein Remote-Logging (Sentry etc.)
- Kein User-seitiges Aktivieren des Debug-Modus
- Kein automatisches Deaktivieren nach Timeout