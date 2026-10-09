# Frontend in ES-Module aufteilen — Design Spec
**Datum:** 2026-10-09 · **Ticket:** D-01 (Prio-Plan `2026-10-07-dems-3.0-prioplan.md`)

## Überblick

`public/js/app.js` hat 5507 Zeilen mit 182 globalen Funktionen. 108 Inline-Handler (`onclick`, `onchange`, `oninput`, `onerror`; 51 in `index.html`, 57 in HTML-Strings von `app.js`) rufen 82 dieser Funktionen auf. Deshalb muss die CSP `'unsafe-inline'` für Skripte erlauben (Audit H-05), und jede neue Seite des 3.0-Redesigns landet wieder in derselben Datei.

D-01 zerlegt `app.js` in native ES-Module pro Bereich (ohne Build-Schritt, ohne neue Abhängigkeit), ersetzt alle Inline-Handler durch Event-Delegation und verschärft danach die CSP für Skripte. Sichtbar ändert sich nichts.

**Ziel:** Das Redesign (D-04, D-05, D-07, D-08 …) arbeitet in kleinen, getrennten Modulen, und die CSP verhindert, dass Inline-Handler zurückkommen.

**Erfolgskriterien**
- `public/js/app.js` gibt es nicht mehr; an seiner Stelle stehen ~27 Module unter `public/js/`, keins länger als ~500 Zeilen.
- Kein Modul führt beim Laden Code aus außer `registerActions(...)`; gestartet wird nur in `main.js`.
- `index.html` und `public/js/**` enthalten kein `on…=`-Attribut mehr.
- Der Server schickt `script-src 'self'` (ohne `'unsafe-inline'`) und `script-src-attr 'none'`.
- `npm test` und `npm run test:e2e` sind grün, die Smoke-Tour zeigt keinen Konsolenfehler (auch keinen CSP-Verstoß).
- Keine neue Abhängigkeit, kein Bundler, kein Build-Schritt.

**Nicht im Umfang**
- Die 132 `style="…"`-Attribute: `style-src` behält `'unsafe-inline'`, bis D-02 die Stile aufräumt.
- `fetch`-Aufrufe vereinheitlichen, Texte auslagern (W-19), Barrierefreiheit (D-03), Avatare (D-09).
- Per Property gesetzte Handler (`btn.onclick = () => …`, 7 Stellen): Sie sind keine Inline-Attribute und bleiben.
- `window.DEBUG_MODE`, `window.VERBOSE_LOG`, `window._demsGuildId` bleiben `window`-Eigenschaften.

---

## Teil 1 — Module, Zustand, Laden

### Dateien

| Modul | Inhalt (Abschnitte aus `app.js`) |
|---|---|
| `main.js` | Einstieg: importiert alle Module, ruft `initActions(document)`, hängt die bisherigen `DOMContentLoaded`-Listener und den Klick-Listener der Ort-Autovervollständigung an |
| `core/state.js` | gemeinsamer Zustand (siehe unten) |
| `core/actions.js` | Event-Delegation und Bild-Fallbacks (Teil 2) |
| `core/ui.js` | Utilities: `escapeHtml`, `renderMarkdownSafe`, `markdownPreview`, `showToast`, `showError`, `renderSkeletonEvents`, `isValidBannerUrl`, `getErrorMessage`, `showConfirmDialog` |
| `core/router.js` | SPA Router: `handleRoute`, `navigateTo`, Pending-Route |
| `core/boot.js` | Boot Animation, `fetchCSRFToken`, `loadServerInfo`, `updateServerNameInUI`, `finishLoading` |
| `core/auth.js` | Auth: `checkAuth`, `showLoggedIn`, `showLoggedOut`, `logout`, `showUserData` |
| `core/updates.js` | Updates System |
| `events/list.js` | Events Section, Countdown, Category Filter, Participant Warning Badge, Series Toggle, Debounced Search, View Toggle, Calendar View |
| `events/detail.js` | Detail View Helpers, Event Detail (inkl. `submitRegistration`, `unregisterFromEvent`) |
| `events/slots.js` | Role Slots (event page) |
| `events/registration-form.js` | Form Field Types & Widgets |
| `events/guests.js` | Guest Search |
| `events/checkin.js` | Check-in System |
| `events/comments.js` | Event Comments |
| `polls/polls.js` | Date Polls |
| `polls/admin.js` | Date Polls (admin) ohne `showConfirmDialog` |
| `admin/dashboard.js` | Admin Section, Audit Log, `showResetModal`, `performSystemReset` |
| `admin/event-actions.js` | `deleteEvent`, `deleteEventSeries`, `changeEventStatus`, Ankündigung, `startEvent`, `endEvent`, `exportRegistrations`, Duplicate Event, Discord Sync |
| `admin/wizard.js` | Event Wizard Navigation, `reminderHoursOf`, `showCreateEventModal`, `updateBannerPreview`, `editEvent`, `saveEvent`, Roles, Location Autocomplete |
| `admin/wizard-builders.js` | Form Builder, Role Slots (wizard) |
| `admin/registrations.js` | Registrations |
| `admin/maintenance.js` | `checkMaintenanceStatus`, Wartungsdialog, Panik-Modus |
| `admin/bot-control.js` | Bot-Zentrale (`showBotControlSection` … `saveBotSettingsForm`) |
| `admin/bot-messages.js` | Bot Messages |
| `admin/discord-import.js` | Discord Import |
| `pages/profile.js` | Profile Section, Account Settings, First-Login Modal |
| `pages/info.js` | Info Section |
| `pages/debug.js` | Debug / Styling Guide Section |

Hängt eine Funktion fachlich an einem anderen Modul, als die Tabelle sagt, darf der Plan sie verschieben. Die Grenze von ~500 Zeilen gilt.

### Zustand

- `core/state.js` exportiert ein Objekt `state` mit jeder Variable auf oberster Ebene, die mehr als ein Modul liest oder schreibt. Laut Prototyp sind das 15: `currentUser`, `csrfToken`, `serverName`, `cachedRoles`, `countdownTimers`, `descriptionEditor`, `startDatePicker`, `endDatePicker`, `selectedSlotId`, `selectedAltSlotIds`, `detailEventId`, `currentPoll`, `pendingPollDecision`, `botStatusRefreshInterval`, `selectedGuests`. Zugriff überall als `state.currentUser` usw.
- Was nur ein Modul nutzt, bleibt dort als Modul-Variable (`activeCategory`, `currentWizardStep`, `calendarMonth`, `guestSearchTimer`, …).
- Module exportieren Funktionen und Konstanten. Gegenseitige Importe sind erlaubt, weil beim Laden nichts aufgerufen wird.

### Laden

- `index.html`: `<script src="/js/app.js">` wird zu `<script type="module" src="/js/main.js">` an derselben Stelle.
- Die Bibliotheken in `public/vendor/` bleiben klassische Skripte; Module nutzen ihre Globals (`bootstrap`, `gsap`, `marked`, `DOMPurify`, `EasyMDE`, `flatpickr`).
- Modul-Skripte laufen wie `defer` vor `DOMContentLoaded`; die bisherige Startreihenfolge bleibt.
- Kein `modulepreload`, kein Cache-Busting: `express.static` liefert ohne `maxAge`, der Browser prüft jedes Modul per ETag.

---

## Teil 2 — Event-Delegation, Bilder, CSP

### Markup

Ein Attribut pro Ereignis, der Wert ist der Aktionsname, Parameter stehen in eigenen `data-*`-Feldern (mit `escapeHtml`, wie bisher):

```html
<!-- vorher -->
<a href="#" onclick="changeEventStatus('${event.id}', 'active'); return false;">✅ Aktiv</a>
<select onchange="filterByCategory(this.value)">
<!-- nachher -->
<a href="#" data-click="changeEventStatus" data-id="${escapeHtml(event.id)}" data-status="active">✅ Aktiv</a>
<select data-change="filterByCategory">
```

- Attribute: `data-click`, `data-change`, `data-input`.
- Aktionsnamen stehen immer wörtlich im Markup, nie als `${…}`.
- Die Funktionen selbst behalten ihre Signaturen; die registrierte Aktion übersetzt Element → Argumente.

### `core/actions.js`

```js
registerActions({
    changeEventStatus: (el) => changeEventStatus(el.dataset.id, el.dataset.status),
    filterByCategory: (el) => filterByCategory(el.value)
});
initActions(document);
```

- `registerActions(map)`: trägt Aktionen in eine Tabelle ein; ein schon vergebener Name wirft einen `Error`. Jedes Modul registriert seine eigenen Aktionen auf oberster Ebene.
- `initActions(root)`: hängt je einen Listener für `click`, `change`, `input` an `root` und einen Capture-Listener für `error` (Bilder).
- Verteilen: `event.target.closest('[data-click]')` (bzw. `data-change`/`data-input`) – nur das **nächstgelegene** Element mit Aktion wird ausgeführt. Damit ersetzt die Delegation `event.stopPropagation()` in Karten mit inneren Links.
- `preventDefault()` ruft der Verteiler nur bei Klicks auf `<a>` auf (ersetzt `return false`); Buttons und Checkboxen behalten ihr Standardverhalten.
- Ein unbekannter Name oder ein Fehler (auch ein abgelehntes Promise) in einer Aktion endet in `console.error(...)` (englisch, Entwickler-Ausgabe).
- Allgemeine Aktionen für reine DOM-Umschalter: `toggleVisible` (`data-change`, blendet `#<data-target>` je nach `checked` ein/aus), `hide` (`data-click`, blendet `#<data-target>` aus), `scrollTo` (`data-click`, scrollt sanft zu `#<data-target>`).

### Bilder

- `onerror` wird zu `data-fallback`:
  - `hide` → `display: none`
  - `invisible` → `visibility: hidden`
  - `initials` → ersetzt das Bild durch `<div class="participant-avatar-placeholder">` mit dem Text aus `data-initials` und dem `title` des Bildes, wie heute in der Teilnehmerliste. Der heutige Handler ist eine Lücke (siehe „Nebenbei geschlossen“).
- `error`-Events steigen nicht auf; der Capture-Listener an `document` fängt sie trotzdem.
- `initActions` behandelt einmal alle `img[data-fallback]`, die schon vor dem Modulstart gescheitert sind (`complete && naturalWidth === 0`).
- `this.src='/img/default-avatar.png'` (die Datei existiert nicht) und `this.src=''` in der Gästesuche werden zu `hide`.

### CSP (`server.js`)

```js
scriptSrc: ["'self'"],
scriptSrcAttr: ["'none'"],
styleSrc: ["'self'", "'unsafe-inline'"],   // unverändert bis D-02
```

Ein vergessener Inline-Handler wird blockiert; Chromium meldet den Verstoß als Konsolenfehler, und die Smoke-Tour schlägt fehl.

### Übergang

Im Verschiebe-Commit stellt jedes Modul die Funktionen, die noch per Inline-Handler aufgerufen werden, mit `Object.assign(window, { … })` bereit. Die Bereichs-Commits streichen ihre Einträge; der letzte Commit löscht die Brücke und verschärft die CSP.

---

## Teil 3 — Tests

### Test-Gerüst (`test/helpers.js`)

- `loadFrontendApp(routes, { storage })` wird `async` und lädt das Modulnetz ab `public/js/main.js` mit `vm.SourceTextModule` in einem frischen `vm`-Kontext – jeder Aufruf ist isoliert.
- Rückgabe wie bisher (`element`, `toasts`, `requests`, `location`, `fire`), dazu `app` (Exporte aller Module zusammengeführt; ein doppelter Exportname ist ein Fehler) und `state`.
- Ohne `--experimental-vm-modules` bricht der Lader mit einer verständlichen Meldung ab.
- Das falsche DOM lernt `dataset`, `closest`, `matches`, `addEventListener` auf Elementen.
- `package.json`: `"test": "node --experimental-vm-modules --disable-warning=ExperimentalWarning --test \"test/**/*.test.js\""` (läuft unter Node 22 und 24).
- Die sechs Dateien mit `loadFrontendApp` (`authFrontend`, `eventCards`, `eventDetailReset`, `eventForm`, `profileRegistrations`, `startup`) warten auf den Lader und nutzen `state` statt `getCurrentUser`/`setCurrentUser`/`setCsrfToken`.

### Neue Tests

- `test/frontendActions.test.js` (vor `actions.js` geschrieben): nächstgelegenes Element gewinnt; `preventDefault` nur bei `<a>`; unbekannte Aktion → `console.error`; doppelte Registrierung wirft; `toggleVisible`/`hide`/`scrollTo`; `data-fallback` mit `hide`/`invisible`/`initials`, auch für vor dem Start gescheiterte Bilder.
- `test/frontendCsp.test.js` (Wächter, rot bis zum letzten Commit):
  - kein `on…=`-Attribut in `public/index.html` und `public/js/**`;
  - jedes wörtliche `data-click|change|input="x"` in `index.html` und den Modulen ist registriert; kein `${` im Aktionsnamen;
  - kein `Object.assign(window` in `public/js/**`;
  - Dev-Server (in `test/devServer.test.js`, dort läuft schon ein Server): Header `content-security-policy` enthält `script-src 'self'` ohne `'unsafe-inline'` und `script-src-attr 'none'`.
- Import-Wächter (im selben Test): Ruft ein Modul `name(` auf und ist `name` eine exportierte Funktion eines anderen Moduls, muss es `name` importieren. Die Importe im Verschiebe-Commit erzeugt ein Skript (Scratchpad, nicht im Repo) mit derselben Regel.

### Browser

- Die Smoke-Tour (`e2e/tour.spec.js`) läuft nach jedem Commit.
- Neue Klicks: Kalender/Raster umschalten und Kategorie filtern (alle Personas), Assistent öffnen, vor, zurück, schließen und Audit-Log auf/zu (Admin), in der offenen Abstimmung abstimmen und einen Slot wählen (Raider – die offene Abstimmung ist laut Seed nur fürs Raid-Team), „Neuigkeiten“-Dialog schließen.
- Abschluss: Browser-Prüfung im Mock-Modus mit Konsole (keine CSP-Verstöße).

---

## Teil 4 — Doku

Jeder Commit aktualisiert die Wiki-Knoten, deren Verhalten er ändert, und läuft `npm run wiki`:

- `modules/frontend-app.md`: Modulkarte (Modul → Funktionen) statt Funktionsliste von `app.js`; Boot-Ablauf; Regeln für `data-click` und `registerActions`.
- `modules/frontend-markup.md`: Aktions-Attribute und `data-fallback` statt Inline-Handlern.
- `concepts/security.md`: H-05 „Skripte erledigt (D-01), Stile offen (D-02)“; TL;DR zur CSP.
- `reference/decisions.md`: neue Zeile (ES-Module ohne Build, Delegation, strenge Skript-CSP).
- `ops/testing.md`: Modul-Lader, Flag, Wächter-Tests.
- `index.md`, `overview/directory-map.md`, `overview/architecture.md`: Pfade `public/js/**` statt `app.js`.
- `CLAUDE.md`: Frontend-Regel (`data-click` + `registerActions` statt globaler Funktionen), Sicherheitsregel (keine Inline-Handler, CSP), Spar-Hinweis (`app.js` entfällt aus der Liste).

---

## Teil 5 — Commit-Folge (ein MR)

Jeder Commit ist mit `npm test` und `npm run test:e2e` grün.

1. Spec und Plan.
2. `app.js` in Module zerlegen: `state`, `window`-Brücke, Modul-Lader im Test-Gerüst, `npm test`-Flag, `<script type="module">`. Keine Logikänderung außer `state.x` statt globaler Variablen und Init-Funktionen statt Listenern auf oberster Ebene.
3. `core/actions.js` mit Tests; `initActions` in `main.js`.
4. Handler je Bereich umstellen, je ein Commit: Übersicht → Event-Seite (Slots, Kommentare, Check-in, Gäste, Formular) → Abstimmungen → Admin-Dashboard und Event-Aktionen → Assistent → Wartung, Bot-Zentrale, Import, Bot-Nachrichten → Profil, Info, Debug und statisches `index.html`. Die Tour-Erweiterung kommt mit dem Bereich, den sie prüft.
5. Brücke löschen, CSP verschärfen, Wächter grün, Doku abschließen.

## Nebenbei geschlossen

Inline-Handler bauen heute Texte in JS-Strings innerhalb eines HTML-Attributs ein. `escapeHtml` schützt dort nicht: Der Browser wandelt `&#039;` und `&quot;` im Attribut zurück, bevor er den Handler ausführt. Betroffen sind Anzeigenamen, die jedes Mitglied selbst wählt:

| Stelle | Auslöser |
|---|---|
| Teilnehmer-Avatar `onerror` (`loadDetailParticipants`) | Name mit `'`, Avatarbild lädt nicht |
| Antworten-Button am Kommentar (`replyToComment`) | Name mit `'`, jemand klickt „Antworten“ |
| Gast hinzufügen (`addGuestToList` mit `JSON.stringify`) | Name mit `&quot;`, jemand wählt den Gast aus |

Event-Titel (`showRegistrations`, `updateRegStatus`), Kategorien und Kanalnamen haben dasselbe Muster, sind aber nur für Admins setzbar; ein `'` im Titel macht heute die Buttons kaputt. Mit `data-*`-Attributen ist jeder Wert nur noch HTML-Text, und die strenge CSP blockiert Inline-Code zusätzlich.

## Risiken

| Risiko | Gegenmittel |
|---|---|
| Fehlender Import fällt erst zur Laufzeit auf (die Brücke verdeckt ihn bis zum Schluss) | Importe per Skript erzeugen; Import-Wächter; Tour nach jedem Commit |
| Reihenfolge beim Start ändert sich | Listener nur in `main.js`, in der bisherigen Reihenfolge; `test/startup.test.js` |
| Aktion übersetzt Argumente falsch (`this.value`, Zahlen, Booleans) | Aktionen lesen `el.value`/`el.checked`/`el.dataset` ausdrücklich; Zahlen mit `Number(...)`; Tour-Klicks |
| Vendor-Bibliothek braucht Inline-Skript | Prüfung der Konsole in der Tour und im Browser nach dem CSP-Commit |
| `vm.SourceTextModule` ist experimentell | nur im Test-Gerüst; seit Node 12 stabil hinter dem Flag; CI (Node 24) und lokal (Node 22) geprüft |
