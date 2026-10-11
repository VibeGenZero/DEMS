# Admin-Dashboard neu (D-07) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Admin-Dashboard zeigt die Events als Tabelle mit den Tabs Entwürfe · Aktiv · Archiv, Suche und Sortierung; jede Zeile hat eine Hauptaktion und ein Menü, Rückfragen laufen über den DEMS-Dialog.

**Architecture:**
1. Server: `GET /api/admin/all-events` liefert je Event `places` (dasselbe Objekt wie `/api/events`), gebaut von der neuen Funktion `describePlaces` in `utils/capacity.js` aus einem einzigen Lesen der Anmeldungen.
2. Regeln: `admin/event-rows.js` ist rein (kein HTML, kein DOM) und entscheidet Tab, Zustand, Zeilen (Serien), Suche, Sortierung und die Aktionen einer Zeile.
3. Markup: `admin/event-table.js` ist rein und baut aus den Zeilen HTML; `admin/dashboard.js` hält den Ansichtszustand (`adminView`) und rendert, `admin/event-actions.js` fragt über `showConfirmDialog` nach.
4. Komponenten: Tabelle (`.data-table`) und Menü (Bootstrap-Dropdown mit Tokens) kommen nach `components.css` und in den Styleguide.

**Tech Stack:** Node.js ≥ 22, Express 5, Vanilla-JS-SPA (native ES-Module, kein Build), Bootstrap 5.3.2 + Bootstrap Icons aus `public/vendor/`, `node:test` + `node:vm` (`--experimental-vm-modules`), Playwright (`npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-10-11-admin-dashboard-design.md`

**Branch:** `56-d-07-admin-dashboard-neu` (Ticket #56), von `origin/main` nach dem Merge von D-06.

## Global Constraints

- Kein Build-Schritt, keine neue npm-Abhängigkeit, kein TypeScript.
- Alles, was Nutzer sehen, auf Deutsch; Code, Kommentare, Commits und Wiki auf Englisch.
- Symbole sind Bootstrap Icons (`bi-*`), nie Emojis.
- Neuer Code enthält kein `style="…"`-Attribut.
- In `components.css` und `style.css` keine Farbwerte, keine Schriftgröße in px/rem, kein `z-index` ab 10, kein Radius in px; jede `var(--x)` ist ein Token oder in den Stylesheets definiert; keine Selektor-Liste doppelt im selben Kontext (`test/cssRules.test.js`).
- Aktionsnamen stehen wörtlich im Markup (`data-click="name"`, nie `data-click="${…}"`) und sind registriert (`test/frontendCsp.test.js`); jeder eingesetzte Wert geht durch `escapeHtml(...)`.
- Module führen beim Laden nur `import`/`export`, Deklarationen und `registerActions(...)` aus; höchstens ~500 Zeilen.
- Exportnamen sind über alle Frontend-Module eindeutig (`loadFrontendApp` legt alle Exporte in ein Objekt).
- Datenzugriff nur über `firebaseAdmin.js`.
- Laufzeit-Regel überall gleich: Ende = `endDate`, sonst Start + 2 Stunden (`eventEnd`, `isRunning` aus `events/cards.js`).
- Zeilen der Tabelle bekommen weder `opacity` noch `transform` (auch nicht per GSAP): Beides erzeugt einen eigenen Stapelkontext, das Menü der Zeile läge dann unter den folgenden Zeilen.
- Jeder Commit ist grün: `npm test` und `npm run test:e2e`.
- Commit-Texte: englischer Imperativ als Betreff, das Warum im Text; kein `#<Zahl>` außer echten Ticket-Verweisen. Commits enden mit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01RBtousiUTyQtMzbEfU9oBs
  ```
- Wiki: Jeder Task korrigiert im selben Commit die Wiki-Aussagen, die er falsch macht, danach `npm run wiki`.
- Dateien im Repo haben CRLF-Zeilenenden. Bestehende Dateien mit dem Edit-Werkzeug ändern, nie mit `sed -i`.
- Einmal-Skripte und Screenshots liegen in `data/d07/` (per `.gitignore` ausgeschlossen) und werden nie committet.

## Review Focus

1. **Event ohne `places`, ohne Termin oder mit kaputtem Datum** (`startDate` leer, `'kein Datum'`, Leerzeichen statt `T`). Erwartung: Die Zeile zeigt „–“ bzw. „Kein Termin“, steht beim Sortieren nach Termin am Ende und bringt die Tabelle nicht zum Absturz. Tests in Task 2 und Task 4.
2. **Unbekannte Werte aus dem Markup:** `data-tab="constructor"`, `data-sort="__proto__"`, unbekannter Status (`'paused'`). Erwartung: Tab und Sortierung bleiben, wie sie sind; ein unbekannter Status landet im Archiv. Tests in Task 2 und Task 4.
3. **Admin-Texte mit HTML und Anführungszeichen** in Titel, Kategorie und Suchbegriff (`Bob's "Raid" & <mehr>`). Erwartung: alles escaped; der Titel kommt im Dialog und im Anmeldungen-Dialog unverändert an. Tests in Task 4 und Task 5.
4. **Serie über mehrere Tabs:** ein Termin archiviert, zwei aktiv; alle Termine vorbei; nur ein Termin im Tab. Erwartung: jeder Tab zeigt nur seine Termine, „Termin 3 von 3“ zählt über die ganze Serie, die Zeile mit einem Termin ist nicht aufklappbar, hat aber „Ganze Serie löschen …“. Tests in Task 2 und Task 4.
5. **Fehlerantwort und Abbruch bei Aktionen:** Server antwortet mit 404/500, der Admin bricht den Dialog ab, die Liste lädt nach einer Aktion nicht mehr. Erwartung: Toast mit der Meldung des Servers, keine Anfrage nach dem Abbruch, kein „Erfolg“ nach einem Fehler, bei Ladefehler „Erneut versuchen“. Tests in Task 4 und Task 5.

## Dateien

| Datei | Aufgabe | Task |
|---|---|---|
| `docs/superpowers/specs/2026-10-11-admin-dashboard-design.md` | zwei Korrekturen (`eventStart`, API-Index) | 0 |
| `utils/capacity.js` | `describePlaces` | 1 |
| `routes/events.js`, `routes/admin.js` | `withPlaces` nutzt `describePlaces`; `all-events` mit `places` | 1 |
| `test/capacity.test.js`, `test/devServer.test.js` | Zahlen und Satz; Admin-Liste | 1 |
| `public/js/events/cards.js` | neuer Export `eventStart` | 2 |
| `public/js/admin/event-rows.js` (neu) | Regeln der Tabelle | 2 |
| `test/adminEventRows.test.js` (neu) | Tabs, Serien, Suche, Sortierung, Aktionen | 2 |
| `public/css/components.css` | DATA TABLE, MENU | 3 |
| `public/css/style.css` | `.status-dropdown` weg (3); ADMIN EVENTS statt ADMIN EVENT CARD (4) | 3, 4 |
| `public/js/pages/debug-components.js` | Styleguide-Blöcke `data-table`, `menu` | 3 |
| `public/js/core/ui.js` | `showConfirmDialog` mit `danger` (3); `renderSkeletonEvents` weg (4) | 3, 4 |
| `test/helpers.js` | Bestätigungsdialog im Frontend-Harness (`dialogs`, `confirm`) | 3 |
| `test/htmlSource.js` (neu) | `elementsWith`, `actionTargets`, `actionElement` für mehrere Tests | 4 |
| `public/js/admin/event-table.js` (neu) | Markup der Tabelle | 4 |
| `public/js/admin/dashboard.js` | Ansichtszustand, Rendern, Aktionen der Tabelle | 4 |
| `public/index.html` | Werkzeugleiste und Tabellen-Container; Danger-Zone-Menü | 3, 4 |
| `test/adminEventTable.test.js` (neu) | Markup und Verhalten der Tabelle | 4 |
| `test/eventCards.test.js`, `test/actionAttributes.test.js`, `test/eventForm.test.js`, `test/components.test.js`, `test/cssRules.test.js`, `test/styleguide.test.js` | Umzug bzw. Wegfall der Karten-Prüfungen, Obergrenzen | 3, 4 |
| `public/js/admin/event-actions.js` | Dialog statt `confirm()`, Meldungen, Fehlerprüfung | 5 |
| `test/adminEventActions.test.js` (neu) | Rückfragen, Abbruch, Fehler | 5 |
| `e2e/admin.spec.js` (neu), `e2e/tour.spec.js`, `e2e/styleguide.spec.js` | Browser-Tests | 3, 6 |
| Wiki (`docs/wiki/…`) | Doku | 1–6 |

---

### Task 0: Ausgangslage, Spec-Korrekturen, Plan committen

**Files:**
- Modify: `docs/superpowers/specs/2026-10-11-admin-dashboard-design.md`
- Create: `docs/superpowers/plans/2026-10-11-admin-dashboard.md` (diese Datei)

**Interfaces:**
- Consumes: nichts.
- Produces: grüner Ausgangsstand; Vorher-Bilder `data/d07/before-mobile.png` (6780 px) und `data/d07/before-desktop.png` (2964 px) liegen bereits vor.

- [ ] **Step 1: Ausgangslage prüfen**

Run: `npm test 2>&1 | tail -8`
Expected: `# pass 415`, `# fail 0`.

Run: `npm run test:e2e 2>&1 | tail -4`
Expected: `40 passed`, `2 skipped`.

- [ ] **Step 2: Spec an zwei Stellen berichtigen**

Beim Planen haben sich zwei Aussagen der Spec als ungenau erwiesen.

In Teil 5 die Zeile zu `events/cards.js` ersetzen durch:

```markdown
| `events/cards.js` | neuer Export `eventStart(event)` (Start als `Date` oder `null`); liefert außerdem `eventEnd`, `isRunning`, `relativeDay` |
```

In Teil 7 die Zeile zu `routes-admin.md` ersetzen durch (die API-Übersicht `api-index.md` listet nur Pfade und braucht keine Änderung):

```markdown
| `docs/wiki/modules/routes-admin.md` | `places` in `all-events` |
```

- [ ] **Step 3: Committen**

```bash
git add docs/superpowers/specs/2026-10-11-admin-dashboard-design.md docs/superpowers/plans/2026-10-11-admin-dashboard.md
git commit -m "Add the implementation plan for the new admin dashboard" -m "Seven tasks from the API to the browser tests. Two statements of the spec are corrected: cards.js gets one new export, and the API index lists paths only." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBtousiUTyQtMzbEfU9oBs"
```

---

### Task 1: Die Admin-Liste liefert `places`

**Files:**
- Modify: `utils/capacity.js`, `routes/events.js:12-32`, `routes/admin.js:103-119`
- Test: `test/capacity.test.js`, `test/devServer.test.js`
- Wiki: `docs/wiki/modules/utils.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/routes-events.md`

**Interfaces:**
- Consumes: `summarizePlaces`, `formatPlaces`, `formatWaitlist` aus `utils/capacity.js`.
- Produces: `describePlaces(registrations: Object[], maxParticipants: number) → { taken, capacity, guests, pending, waitlist, text, waitlistText }`; jedes Event in der Antwort von `GET /api/admin/all-events` trägt dieses Objekt als `places`.

- [ ] **Step 1: Failing test für `describePlaces`**

In `test/capacity.test.js` den Import um `describePlaces` erweitern und ans Ende anfügen:

```js
test('describePlaces adds the sentence and the waitlist note to the numbers', () => {
    const registrations = [
        registration('a', 'accepted', '1', { guests: ['g1'] }),
        registration('b', 'pending', '2'),
        registration('c', 'waitlisted', '3'),
        registration('d', 'rejected', '4')
    ];
    assert.deepEqual(describePlaces(registrations, 20), {
        taken: 3, capacity: 20, guests: 1, pending: 1, waitlist: 1,
        text: '3 von 20 Plätzen belegt (inkl. 1 Gast, 1 Anfrage offen)',
        waitlistText: '1 auf der Warteliste'
    });
    assert.deepEqual(describePlaces([], 0), {
        taken: 0, capacity: 0, guests: 0, pending: 0, waitlist: 0, text: '0 Plätze belegt', waitlistText: ''
    });
});
```

- [ ] **Step 2: Test schlägt fehl**

Run: `node --test test/capacity.test.js 2>&1 | tail -12`
Expected: FAIL mit `describePlaces is not a function`.

- [ ] **Step 3: `describePlaces` schreiben**

In `utils/capacity.js` nach `formatWaitlist` einfügen und in `module.exports` aufnehmen:

```js
/**
 * Places of an event as every view shows them: the numbers plus the sentence.
 *
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @param {number} maxParticipants -> Capacity of the event, 0 = unlimited.
 * @returns {Object} -> `{ taken, capacity, guests, pending, waitlist, text, waitlistText }`.
 */
function describePlaces(registrations, maxParticipants) {
    const places = summarizePlaces(registrations, maxParticipants);
    return { ...places, text: formatPlaces(places), waitlistText: formatWaitlist(places.waitlist) };
}
```

In `routes/events.js` den Import auf `const { describePlaces } = require('../utils/capacity');` kürzen und `withPlaces` darauf umstellen:

```js
function withPlaces(event, registrations) {
    const places = describePlaces(registrations, event.maxParticipants);
    return { ...event, currentParticipants: places.taken, places };
}
```

Run: `node --test test/capacity.test.js 2>&1 | tail -6`
Expected: PASS.

- [ ] **Step 4: Failing test für die Admin-Liste**

In `test/devServer.test.js` nach dem Test `list and event page tell the places of an event with the same sentence` einfügen:

```js
test('the admin list tells the places of every event like the event page', async () => {
    const admin = await loginAs('admin');
    const events = await (await admin.request('/api/admin/all-events')).json();
    assert.ok(events.length >= 10);
    for (const event of events) {
        assert.equal(typeof event.places.text, 'string', event.title);
        assert.equal(typeof event.places.waitlistText, 'string', event.title);
        for (const key of ['taken', 'capacity', 'guests', 'pending', 'waitlist']) {
            assert.equal(typeof event.places[key], 'number', `${event.title}: ${key}`);
        }
    }
    for (const id of [EVENT_ID.OPEN, EVENT_ID.FORM, EVENT_ID.FULL, EVENT_ID.BIG_FORM]) {
        const single = await (await admin.request(`/api/events/${id}`)).json();
        assert.deepEqual(events.find(event => event.id === id).places, single.places, id);
    }
    // Members never see the archive; the admin list counts it all the same
    assert.equal(events.find(event => event.id === EVENT_ID.ARCHIVED).places.text, '3 von 50 Plätzen belegt');
});
```

Das archivierte „Sommerfest“ hat in `dev/seedData.js` 50 Plätze und drei angenommene Anmeldungen.

Run: `node --test test/devServer.test.js 2>&1 | grep -A6 "admin list"`
Expected: FAIL, `Cannot read properties of undefined (reading 'text')`.

- [ ] **Step 5: `all-events` um `places` erweitern**

In `routes/admin.js` `describePlaces` importieren (`const { describePlaces } = require('../utils/capacity');`, bei den übrigen `utils`-Imports) und den Handler ersetzen:

```js
/**
 * GET /api/admin/all-events — Get ALL events (including draft/archived) with their places
 */
router.get('/all-events', async (req, res) => {
    try {
        const [eventsSnap, registrationsSnap] = await Promise.all([
            getDocs(query(collection(db, 'events'), orderBy('createdAt', 'desc'))),
            getDocs(collection(db, 'registrations'))
        ]);
        // One read for all events, grouped in memory instead of one query per event
        const registrationsByEvent = new Map();
        registrationsSnap.forEach(docSnap => {
            const registration = docSnap.data();
            if (!registrationsByEvent.has(registration.eventId)) registrationsByEvent.set(registration.eventId, []);
            registrationsByEvent.get(registration.eventId).push(registration);
        });
        const events = [];
        eventsSnap.forEach(docSnap => {
            const event = docSnap.data();
            events.push({
                id: docSnap.id,
                ...event,
                places: describePlaces(registrationsByEvent.get(docSnap.id) || [], event.maxParticipants)
            });
        });
        res.json(events);
    } catch (err) {
        console.error('Error fetching all events:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Events' });
    }
});
```

- [ ] **Step 6: Tests grün**

Run: `node --test test/devServer.test.js test/capacity.test.js test/eventPlaces.test.js 2>&1 | tail -8`
Expected: `# fail 0`.

- [ ] **Step 7: Wiki**

`docs/wiki/modules/routes-admin.md`, Zeile `/all-events` ersetzen durch:

```markdown
| GET | `/all-events` | all events incl. draft/archived, `orderBy('createdAt','desc')`; each with `places` (`describePlaces`: `taken`, `capacity`, `guests`, `pending`, `waitlist`, `text`, `waitlistText`), built from one read of `registrations` grouped by `eventId` | — |
```

Außerdem `utils/capacity.js` in die `sources` dieser Seite aufnehmen.

`docs/wiki/modules/utils.md`, im Abschnitt `utils/capacity.js, utils/slotService.js (pure)` nach dem Satz zu `formatWaitlist(n)` einfügen:

```markdown
 `describePlaces(registrations, maxParticipants)` returns the numbers together with `text` and `waitlistText`; `GET /api/events` and `GET /api/admin/all-events` put exactly this object into `places`.
```

`docs/wiki/modules/routes-events.md`: Wo `summarizePlaces` als Quelle von `places` genannt ist, `describePlaces` schreiben.

Run: `npm run wiki && npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 8: Committen**

```bash
git add utils/capacity.js routes/events.js routes/admin.js test/capacity.test.js test/devServer.test.js docs/wiki
git commit -m "Tell the places of every event in the admin list" -m "The admin dashboard could not show how full an event is or whether requests wait: GET /api/admin/all-events carried no counts. It now returns the same places object as the event API, built by describePlaces from one read of the registrations." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBtousiUTyQtMzbEfU9oBs"
```

---

### Task 2: Regeln der Tabelle (`admin/event-rows.js`)

**Files:**
- Create: `public/js/admin/event-rows.js`, `test/adminEventRows.test.js`
- Modify: `public/js/events/cards.js` (neuer Export `eventStart`), `public/js/main.js` (Import des neuen Moduls)
- Wiki: `docs/wiki/modules/frontend-app.md`, `docs/wiki/ops/testing.md`

**Interfaces:**
- Consumes: `eventEnd(event) → Date|null`, `isRunning(event, now) → boolean` aus `events/cards.js`.
- Produces:
  - `eventStart(event) → Date|null` (`events/cards.js`)
  - `ADMIN_TABS: Array<{ id: 'drafts'|'active'|'archive', label: string }>`
  - `ADMIN_SORT_KEYS: ['title', 'date', 'places']`
  - `DEFAULT_ADMIN_SORT: { drafts, active, archive }`, je `{ key: 'title'|'date'|'places', direction: 'asc'|'desc' }`
  - `adminTabOf(event) → 'drafts'|'active'|'archive'`
  - `adminStateOf(event, now) → 'draft'|'upcoming'|'running'|'past'|'archived'`
  - `buildAdminRows(events, { tab, search, sort, now }) → Row[]` mit `Row = { key: string, event: Object, state: string, series: null | { id: string, total: number, pendingElsewhere: number, dates: Array<{ event, state, position: number }> } }`
  - `adminTabCounts(events, search, now) → { drafts: number, active: number, archive: number }`
  - `adminEventActions(event, state, { inSeries, seriesRow }) → { main: string, general: string[], status: string[], danger: string[] }` mit den Schlüsseln `registrations`, `edit`, `announce`, `duplicate`, `export`, `syncDiscord`, `publish`, `reactivate`, `toDraft`, `archive`, `start`, `end`, `delete`, `deleteDate`, `deleteSeries`

- [ ] **Step 1: Failing tests schreiben**

`test/adminEventRows.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

let app;
before(async () => { ({ app } = await loadFrontendApp({})); });

// "Now" is Sunday, 11 October 2026, 16:00. All dates are built in local time,
// so the tests give the same result in every time zone.
const NOW = new Date(2026, 9, 11, 16, 0);
const at = (day, hour = 19, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const places = (fields = {}) => ({ taken: 0, capacity: 10, guests: 0, pending: 0, waitlist: 0, text: '0 von 10 Plätzen belegt', waitlistText: '', ...fields });
const event = (id, fields = {}) => ({ id, title: id, status: 'active', category: 'Gaming', startDate: at(20), maxParticipants: 10, places: places(), ...fields });
const rows = (events, options = {}) => app.buildAdminRows(events, { tab: 'active', now: NOW, ...options });
const keys = (list) => list.map(row => row.key);

test('the status decides the tab, the time decides the state', () => {
    const cases = [
        [event('draft', { status: 'draft' }), 'drafts', 'draft'],
        [event('soon'), 'active', 'upcoming'],
        [event('no-status', { status: undefined }), 'active', 'upcoming'],
        [event('no-date', { startDate: '' }), 'active', 'upcoming'],
        [event('broken-date', { startDate: 'kein Datum' }), 'active', 'upcoming'],
        // Started 30 minutes ago, without an end an event lasts two hours
        [event('live', { startDate: at(11, 15, 30) }), 'active', 'running'],
        [event('just-over', { startDate: at(11, 13, 0) }), 'active', 'past'],
        [event('long', { startDate: at(10, 10), endDate: at(12, 10) }), 'active', 'running'],
        [event('old', { status: 'archived', startDate: at(1) }), 'archive', 'archived'],
        [event('off', { status: 'cancelled' }), 'archive', 'archived'],
        // Nobody can set this status; it must not turn up as an active event
        [event('odd', { status: 'paused' }), 'archive', 'archived']
    ];
    for (const [entry, tab, state] of cases) {
        assert.equal(app.adminTabOf(entry), tab, `tab of ${entry.id}`);
        assert.equal(app.adminStateOf(entry, NOW), state, `state of ${entry.id}`);
    }
});

test('every tab lists its own events', () => {
    const events = [event('a'), event('d', { status: 'draft' }), event('x', { status: 'archived' }), event('c', { status: 'cancelled' })];
    assert.deepEqual(keys(rows(events, { tab: 'drafts' })), ['d']);
    assert.deepEqual(keys(rows(events, { tab: 'active' })), ['a']);
    assert.deepEqual(keys(rows(events, { tab: 'archive' })).sort(), ['c', 'x']);
    assert.deepEqual(app.adminTabCounts(events, '', NOW), { drafts: 1, active: 1, archive: 2 });
    assert.deepEqual(rows(undefined), []);
    assert.deepEqual(app.adminTabCounts(null, '', NOW), { drafts: 0, active: 0, archive: 0 });
});

test('a series is one row that stands for its next date', () => {
    const events = [
        event('s3', { seriesId: 'series', startDate: at(26), places: places({ pending: 2 }) }),
        event('s1', { seriesId: 'series', startDate: at(5) }),
        event('s2', { seriesId: 'series', startDate: at(19), places: places({ pending: 1 }) }),
        event('single')
    ];
    const [series] = rows(events).filter(row => row.series);
    assert.equal(series.key, 'series:series');
    // s1 is over, so the next date s2 stands for the series
    assert.equal(series.event.id, 's2');
    assert.equal(series.state, 'upcoming');
    assert.equal(series.series.total, 3);
    assert.deepEqual(series.series.dates.map(date => [date.event.id, date.position, date.state]), [['s1', 1, 'past'], ['s2', 2, 'upcoming'], ['s3', 3, 'upcoming']]);
    // Requests of the other dates, not of the one the row shows
    assert.equal(series.series.pendingElsewhere, 2);
    assert.equal(rows(events).length, 2);
});

test('each tab shows only the dates of a series that belong to it', () => {
    const events = [
        event('s1', { seriesId: 'series', startDate: at(5), status: 'archived' }),
        event('s2', { seriesId: 'series', startDate: at(19) }),
        event('s3', { seriesId: 'series', startDate: at(26) })
    ];
    const [active] = rows(events);
    assert.deepEqual(active.series.dates.map(date => date.position), [2, 3]);
    assert.equal(active.series.total, 3);
    const [archived] = rows(events, { tab: 'archive' });
    assert.deepEqual(archived.series.dates.map(date => [date.event.id, date.position]), [['s1', 1]]);
    assert.equal(archived.event.id, 's1');
    assert.deepEqual(rows(events, { tab: 'drafts' }), []);
});

test('a series whose dates are all over is stood for by its last date', () => {
    const events = [event('s1', { seriesId: 'series', startDate: at(1) }), event('s2', { seriesId: 'series', startDate: at(8) })];
    const [series] = rows(events);
    assert.equal(series.event.id, 's2');
    assert.equal(series.state, 'past');
});

test('the search looks at title and category and counts the hits per tab', () => {
    const events = [
        event('raid', { title: 'Raid: Schattenfestung', category: 'Raid' }),
        event('night', { title: 'Spieleabend', category: 'Gaming' }),
        event('old-raid', { title: 'Alter RAID', status: 'archived' }),
        event('s1', { title: 'Training', seriesId: 'series', category: 'Raid-Training' }),
        event('s2', { title: 'Training', seriesId: 'series', category: 'Raid-Training', startDate: at(27) })
    ];
    assert.deepEqual(keys(rows(events, { search: '  rAiD ' })).sort(), ['raid', 'series:series']);
    assert.deepEqual(app.adminTabCounts(events, 'raid', NOW), { drafts: 0, active: 2, archive: 1 });
    assert.deepEqual(keys(rows(events, { search: 'gaming' })), ['night']);
    assert.deepEqual(rows(events, { search: 'nichts' }), []);
    // A matching series keeps all its dates
    assert.equal(rows(events, { search: 'raid-training' })[0].series.dates.length, 2);
    // The description is not searched: admins look for a name
    assert.deepEqual(rows([event('x', { description: 'raid' })], { search: 'raid' }), []);
});

test('the default sorting is by date, the archive newest first', () => {
    const events = [event('late', { startDate: at(30) }), event('early', { startDate: at(12) }), event('none', { startDate: '' }), event('mid', { startDate: at(20) })];
    assert.deepEqual(keys(rows(events)), ['early', 'mid', 'late', 'none']);
    const archive = events.map(entry => ({ ...entry, status: 'archived' }));
    assert.deepEqual(keys(rows(archive, { tab: 'archive' })), ['late', 'mid', 'early', 'none']);
    assert.deepEqual(app.DEFAULT_ADMIN_SORT.archive, { key: 'date', direction: 'desc' });
});

test('columns sort in both directions, events without a date stay last', () => {
    const events = [
        event('b', { title: 'berta', startDate: at(12), places: places({ taken: 7 }) }),
        event('a', { title: 'Anton', startDate: at(30), places: places({ taken: 2 }) }),
        event('z', { title: 'Ärger', startDate: '', places: places({ taken: 4 }) })
    ];
    const sorted = (key, direction) => keys(rows(events, { sort: { key, direction } }));
    // German order: Ä sorts with A, upper and lower case are the same
    assert.deepEqual(sorted('title', 'asc'), ['a', 'z', 'b']);
    assert.deepEqual(sorted('title', 'desc'), ['b', 'z', 'a']);
    assert.deepEqual(sorted('places', 'asc'), ['a', 'z', 'b']);
    assert.deepEqual(sorted('places', 'desc'), ['b', 'z', 'a']);
    assert.deepEqual(sorted('date', 'asc'), ['b', 'a', 'z']);
    assert.deepEqual(sorted('date', 'desc'), ['a', 'b', 'z']);
});

test('an unknown sort key falls back to the default of the tab', () => {
    const events = [event('late', { startDate: at(30) }), event('early', { startDate: at(12) })];
    for (const key of ['__proto__', 'constructor', '', undefined]) {
        assert.deepEqual(keys(rows(events, { sort: { key, direction: 'desc' } })), ['early', 'late'], String(key));
    }
    assert.deepEqual(keys(rows(events, { sort: null })), ['early', 'late']);
});

test('past events of the active tab stand below the others in every sorting', () => {
    const events = [
        event('past-a', { title: 'Alt', startDate: at(1), places: places({ taken: 9 }) }),
        event('soon', { title: 'Zebra', startDate: at(12), places: places({ taken: 1 }) }),
        event('past-b', { title: 'Bald vorbei', startDate: at(4) }),
        event('live', { title: 'Marathon', startDate: at(11, 15, 30) })
    ];
    assert.deepEqual(keys(rows(events)), ['live', 'soon', 'past-a', 'past-b']);
    assert.deepEqual(keys(rows(events, { sort: { key: 'title', direction: 'asc' } })), ['live', 'soon', 'past-a', 'past-b']);
    assert.deepEqual(keys(rows(events, { sort: { key: 'places', direction: 'desc' } })), ['soon', 'live', 'past-a', 'past-b']);
    // The archive has no second group
    const archive = events.map(entry => ({ ...entry, status: 'archived' }));
    assert.deepEqual(keys(rows(archive, { tab: 'archive' })), ['soon', 'live', 'past-b', 'past-a']);
});

test('an event without places sorts as empty', () => {
    const events = [event('with', { places: places({ taken: 3 }) }), event('without', { places: undefined, startDate: at(12) })];
    assert.deepEqual(keys(rows(events, { sort: { key: 'places', direction: 'asc' } })), ['without', 'with']);
});

test('the main action follows the state', () => {
    const actions = (state, fields = {}, options = {}) => app.adminEventActions(event('e', fields), state, options);
    assert.equal(actions('draft').main, 'publish');
    assert.equal(actions('upcoming').main, 'registrations');
    assert.equal(actions('running').main, 'registrations');
    assert.equal(actions('past').main, 'archive');
    assert.equal(actions('archived').main, 'registrations');
});

test('the menu names the status changes that fit the state', () => {
    const status = (state, fields = {}) => app.adminEventActions(event('e', fields), state).status;
    assert.deepEqual(status('draft'), ['archive']);
    // Only a draft without a date can be started on the spot
    assert.deepEqual(status('draft', { startDate: '' }), ['archive', 'start']);
    assert.deepEqual(status('draft', { startDate: 'kein Datum' }), ['archive', 'start']);
    assert.deepEqual(status('upcoming'), ['toDraft', 'archive']);
    assert.deepEqual(status('running'), ['end', 'toDraft']);
    assert.deepEqual(status('past'), ['toDraft']);
    assert.deepEqual(status('archived'), ['reactivate', 'toDraft']);
    assert.deepEqual(status('constructor'), []);
});

test('the general entries leave out the main action and a finished Discord entry', () => {
    const general = (state, fields = {}) => app.adminEventActions(event('e', fields), state).general;
    assert.deepEqual(general('upcoming'), ['edit', 'announce', 'duplicate', 'export', 'syncDiscord']);
    assert.deepEqual(general('past'), ['registrations', 'edit', 'announce', 'duplicate', 'export', 'syncDiscord']);
    assert.deepEqual(general('draft'), ['registrations', 'edit', 'announce', 'duplicate', 'export', 'syncDiscord']);
    assert.deepEqual(general('upcoming', { discordScheduledEventId: '123' }), ['edit', 'announce', 'duplicate', 'export']);
});

test('deleting names the date inside a series and offers the whole series on its row', () => {
    const danger = (options) => app.adminEventActions(event('e'), 'upcoming', options).danger;
    assert.deepEqual(danger(), ['delete']);
    assert.deepEqual(danger({ inSeries: true }), ['deleteDate']);
    assert.deepEqual(danger({ inSeries: true, seriesRow: true }), ['deleteDate', 'deleteSeries']);
});
```

- [ ] **Step 2: Tests schlagen fehl**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/adminEventRows.test.js 2>&1 | tail -12`
Expected: FAIL, `app.adminTabOf is not a function`.

- [ ] **Step 3: `eventStart` exportieren**

In `public/js/events/cards.js` vor `eventEnd` einfügen:

```js
/**
 * Start of an event.
 *
 * @param {Object} event -> Event with `startDate`.
 * @returns {Date|null} -> The start, or null without a valid date.
 */
export function eventStart(event) {
    return parseDate(event.startDate);
}
```

- [ ] **Step 4: `admin/event-rows.js` schreiben**

```js
/**
 * Rules of the admin event table (#admin): which tab an event belongs to,
 * how the dates of a series become one row, search, sorting and the actions
 * a row offers. Pure functions without HTML and DOM; admin/event-table.js
 * turns their result into markup.
 */
import { eventEnd, eventStart, isRunning } from '../events/cards.js';

/** Tabs of the table in display order. */
export const ADMIN_TABS = [
    { id: 'drafts', label: 'Entwürfe' },
    { id: 'active', label: 'Aktiv' },
    { id: 'archive', label: 'Archiv' }
];

/** Sorting of each tab until the admin picks another one. */
export const DEFAULT_ADMIN_SORT = {
    drafts: { key: 'date', direction: 'asc' },
    active: { key: 'date', direction: 'asc' },
    archive: { key: 'date', direction: 'desc' }
};

/** Columns the table can be sorted by. */
export const ADMIN_SORT_KEYS = ['title', 'date', 'places'];

/**
 * Tab of an event.
 *
 * @param {Object} event -> Event with `status`.
 * @returns {string} -> `drafts`, `active` (also without a status) or `archive` (archived, cancelled and anything else).
 */
export function adminTabOf(event) {
    const status = event.status || 'active';
    if (status === 'draft') return 'drafts';
    return status === 'active' ? 'active' : 'archive';
}

const isOver = (event, now) => {
    const end = eventEnd(event);
    return !!end && end < now;
};

/**
 * State of an event, which decides its actions.
 *
 * @param {Object} event -> Event.
 * @param {Date} now -> Reference time.
 * @returns {string} -> `draft`, `upcoming` (also without a date), `running`, `past` (active but over) or `archived`.
 */
export function adminStateOf(event, now) {
    const tab = adminTabOf(event);
    if (tab === 'drafts') return 'draft';
    if (tab === 'archive') return 'archived';
    if (isRunning(event, now)) return 'running';
    return isOver(event, now) ? 'past' : 'upcoming';
}

const timeOf = (event) => {
    const start = eventStart(event);
    return start ? start.getTime() : null;
};
const titleOf = (event) => String(event.title ?? '');
const takenOf = (event) => Number(event.places?.taken) || 0;
const pendingOf = (event) => Number(event.places?.pending) || 0;
const byTitle = (a, b) => titleOf(a).localeCompare(titleOf(b), 'de', { sensitivity: 'base' });

// Dates ascending; an event without a date comes last
function byDate(a, b) {
    const left = timeOf(a);
    const right = timeOf(b);
    if (left === null || right === null) return (left === null) - (right === null);
    return left - right;
}

function compareRows(a, b, sort) {
    const sign = sort.direction === 'desc' ? -1 : 1;
    let order;
    if (sort.key === 'title') order = sign * byTitle(a.event, b.event);
    else if (sort.key === 'places') order = sign * (takenOf(a.event) - takenOf(b.event));
    // Rows without a date stay at the end in both directions
    else if (timeOf(a.event) === null || timeOf(b.event) === null) order = byDate(a.event, b.event);
    else order = sign * byDate(a.event, b.event);
    return order || byDate(a.event, b.event) || byTitle(a.event, b.event);
}

/**
 * Rows of one tab.
 *
 * @param {Array<Object>} events -> All events of GET /api/admin/all-events.
 * @param {Object} options -> `{ tab, search, sort, now }`; `sort` is `{ key: 'title'|'date'|'places', direction: 'asc'|'desc' }`, anything else means the default of the tab.
 * @returns {Array<Object>} -> `{ key, event, state, series }` per row. A series is one row for the dates of this tab: `event` is its first date that is not over (else the last), `series` is `{ id, total, pendingElsewhere, dates: [{ event, state, position }] }` with `total` and `position` counted over the whole series.
 */
export function buildAdminRows(events, { tab, search = '', sort, now }) {
    const list = Array.isArray(events) ? events : [];
    const order = sort && ADMIN_SORT_KEYS.includes(sort.key) ? sort : DEFAULT_ADMIN_SORT[tab] || DEFAULT_ADMIN_SORT.active;
    const needle = String(search ?? '').trim().toLowerCase();
    const matches = (event) => !needle || [event.title, event.category].some(text => String(text ?? '').toLowerCase().includes(needle));

    const seriesDates = new Map();
    for (const event of list) {
        if (!event.seriesId) continue;
        if (!seriesDates.has(event.seriesId)) seriesDates.set(event.seriesId, []);
        seriesDates.get(event.seriesId).push(event);
    }
    for (const dates of seriesDates.values()) dates.sort(byDate);

    const rows = [];
    const seen = new Set();
    for (const event of list) {
        if (adminTabOf(event) !== tab) continue;
        if (!event.seriesId) {
            if (matches(event)) rows.push({ key: event.id, event, state: adminStateOf(event, now), series: null });
            continue;
        }
        if (seen.has(event.seriesId)) continue;
        seen.add(event.seriesId);
        const all = seriesDates.get(event.seriesId);
        const dates = all.filter(date => adminTabOf(date) === tab);
        if (!dates.some(matches)) continue;
        const representative = dates.find(date => !isOver(date, now)) || dates[dates.length - 1];
        rows.push({
            key: `series:${event.seriesId}`,
            event: representative,
            state: adminStateOf(representative, now),
            series: {
                id: event.seriesId,
                total: all.length,
                pendingElsewhere: dates.filter(date => date !== representative).reduce((sum, date) => sum + pendingOf(date), 0),
                dates: dates.map(date => ({ event: date, state: adminStateOf(date, now), position: all.indexOf(date) + 1 }))
            }
        });
    }
    rows.sort((a, b) => compareRows(a, b, order));
    // Past events of the active tab form a second group below the others
    return tab === 'active' ? [...rows.filter(row => row.state !== 'past'), ...rows.filter(row => row.state === 'past')] : rows;
}

/**
 * Number of rows per tab, after the search.
 *
 * @param {Array<Object>} events -> All events.
 * @param {string} search -> Search text.
 * @param {Date} now -> Reference time.
 * @returns {Object} -> `{ drafts, active, archive }`.
 */
export function adminTabCounts(events, search, now) {
    const counts = {};
    for (const { id } of ADMIN_TABS) counts[id] = buildAdminRows(events, { tab: id, search, now }).length;
    return counts;
}

/**
 * Actions of one event: the main action and the three groups of its menu.
 *
 * @param {Object} event -> Event.
 * @param {string} state -> Result of adminStateOf().
 * @param {Object} [options] -> `{ inSeries, seriesRow }`: the event is a date of a series / the row stands for the series.
 * @returns {Object} -> `{ main, general, status, danger }` with action keys; admin/event-table.js knows label, icon and markup of each key.
 */
export function adminEventActions(event, state, { inSeries = false, seriesRow = false } = {}) {
    let main = 'registrations';
    if (state === 'draft') main = 'publish';
    else if (state === 'past') main = 'archive';

    let status = [];
    // "Start now" writes the start date, so only a draft without one offers it
    if (state === 'draft') status = eventStart(event) ? ['archive'] : ['archive', 'start'];
    else if (state === 'upcoming') status = ['toDraft', 'archive'];
    else if (state === 'running') status = ['end', 'toDraft'];
    else if (state === 'past') status = ['toDraft'];
    else if (state === 'archived') status = ['reactivate', 'toDraft'];

    return {
        main,
        general: [
            ...(main === 'registrations' ? [] : ['registrations']),
            'edit', 'announce', 'duplicate', 'export',
            ...(event.discordScheduledEventId ? [] : ['syncDiscord'])
        ],
        status,
        danger: [inSeries ? 'deleteDate' : 'delete', ...(seriesRow ? ['deleteSeries'] : [])]
    };
}
```

`public/js/main.js` importiert die Admin-Module einzeln. Dort nach `import './admin/event-actions.js';` die Zeile `import './admin/event-rows.js';` ergänzen, damit Seite und `loadFrontendApp` das Modul laden.

- [ ] **Step 5: Tests grün**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/adminEventRows.test.js 2>&1 | tail -8`
Expected: `# pass 15`, `# fail 0`.

Run: `npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 6: Wiki**

`docs/wiki/modules/frontend-app.md`:
- In der Zeile `events/cards.js` vor `eventEnd` ergänzen: `` `eventStart(event)` (start as `Date` or `null`), ``.
- Nach der Zeile `admin/dashboard.js` einfügen:

```markdown
| `admin/event-rows.js` | rules of the admin event table, pure (no HTML, no DOM) | `ADMIN_TABS`, `ADMIN_SORT_KEYS`, `DEFAULT_ADMIN_SORT`, `adminTabOf(event)` (`draft` → drafts, `active` or none → active, everything else incl. `cancelled` → archive), `adminStateOf(event, now)` (`draft`, `upcoming`, `running`, `past`, `archived`), `buildAdminRows(events, { tab, search, sort, now })` (one row per event, one per series with the dates of the tab; search in title and category; past events of the active tab below the others; no date = last), `adminTabCounts`, `adminEventActions(event, state, { inSeries, seriesRow })` → `{ main, general, status, danger }` |
```

`docs/wiki/ops/testing.md`, in der Tabelle der Testdateien nach `eventCards.test.js` einfügen:

```markdown
| `adminEventRows.test.js` | rules of the admin table: tab and state per status (also `cancelled`, none, unknown), series per tab with representative and position, search with hit counts, sorting per column and direction (past below, no date last, unknown key), main action and menu entries per state |
```

Run: `npm run wiki && npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 7: Committen**

```bash
git add public/js/admin/event-rows.js public/js/events/cards.js public/js/main.js test/adminEventRows.test.js docs/wiki
git commit -m "Add the rules of the admin event table" -m "Tabs, series rows, search, sorting and the actions of a row are decided by pure functions, so they can be tested without a page and the markup only has to render their result." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBtousiUTyQtMzbEfU9oBs"
```

---

### Task 3: Komponenten Tabelle und Menü, Dialog ohne roten Button

**Files:**
- Modify: `public/css/components.css` (zwei Blöcke am Ende), `public/css/style.css:1007-1021` (`.status-dropdown` weg), `public/js/pages/debug-components.js`, `public/js/core/ui.js:21-33`, `public/index.html:686-697` (Danger-Zone-Menü), `test/helpers.js` (Harness)
- Test: `test/cssRules.test.js`, `test/styleguide.test.js`, `test/components.test.js`, `e2e/styleguide.spec.js`
- Wiki: `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/ops/testing.md`

**Interfaces:**
- Consumes: Tokens aus `public/css/tokens.css`; `block(id, title, classes, body)` und `LONG_LABEL` in `debug-components.js`.
- Produces:
  - CSS-Klassen `.data-table`, `.data-table-sort`, `.data-table-title`, `.data-table-meta`, `.data-table-actions`, `.data-table-buttons`, Zeilen `tr.is-sub`, `tr.is-muted`; gestaltetes `.dropdown-menu` mit `.dropdown-item.is-danger`
  - `showConfirmDialog(message, confirmLabel = 'Bestätigen', { danger = true } = {}) → Promise<boolean>`
  - Test-Harness: `loadFrontendApp(routes, { storage, confirm = true })` liefert zusätzlich `dialogs: Array<{ text, label, danger }>`; der Bestätigungsdialog antwortet sofort mit `confirm`

- [ ] **Step 1: Failing tests**

`test/cssRules.test.js`: ans Ende von `COMPONENT_SELECTORS` anfügen:

```js
    '.data-table', '.data-table th', '.data-table td', '.data-table-sort', '.data-table-title', '.data-table-meta',
    '.data-table-actions', '.data-table-buttons', '.data-table tr.is-sub td', '.data-table tr.is-muted .data-table-title',
    '.dropdown-menu', '.dropdown-item', '.dropdown-header', '.dropdown-item.is-danger'
```

und ans Ende von `MOVED`:

```js
    // Replaced by the menu component (D-07)
    '.status-dropdown .dropdown-menu', '.status-dropdown .dropdown-item', '.status-dropdown .dropdown-item:hover'
```

`test/styleguide.test.js`: `BLOCKS` endet neu auf `'date-tile', 'capacity', 'data-table', 'menu'`.

`e2e/styleguide.spec.js`: dieselbe Ergänzung in `BLOCKS`.

`test/components.test.js`: `loadFrontendApp` aus `./helpers` importieren und anfügen:

```js
test('the confirm dialog shows a red button unless told otherwise', async () => {
    const { app, dialogs } = await loadFrontendApp({});
    assert.equal(await app.showConfirmDialog('Eintragen?', 'Eintragen', { danger: false }), true);
    assert.equal(await app.showConfirmDialog('Löschen?', 'Löschen'), true);
    assert.deepEqual(dialogs, [
        { text: 'Eintragen?', label: 'Eintragen', danger: false },
        { text: 'Löschen?', label: 'Löschen', danger: true }
    ]);
});

test('a dismissed confirm dialog answers no', async () => {
    const { app, dialogs } = await loadFrontendApp({}, { confirm: false });
    assert.equal(await app.showConfirmDialog('Löschen?', 'Löschen'), false);
    assert.equal(dialogs.length, 1);
});
```

Run: `npm test 2>&1 | grep -E "^not ok|# fail"`
Expected: fünf Tests schlagen fehl (Komponenten-Selektoren, die drei `.status-dropdown`-Regeln stehen noch in `style.css`, Styleguide-Blöcke, zwei Dialog-Tests; die Dialog-Tests laufen in ein Timeout oder melden `dialogs` als `undefined`).

- [ ] **Step 2: Harness kann den Bestätigungsdialog beantworten**

`test/helpers.js`, in `createFakeElement` die Listener merken und auslösbar machen (ersetzt `addEventListener() {}`):

```js
    const listeners = new Map();
```

```js
        addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]); },
        removeEventListener() {},
        /** Run the listeners of `type` once and forget them, like { once: true }. */
        dispatch(type) {
            const waiting = listeners.get(type) || [];
            listeners.delete(type);
            for (const listener of waiting) listener({ type });
        },
```

In `loadFrontendApp` die Signatur auf `{ storage = {}, confirm = true } = {}` erweitern, `const dialogs = [];` neben `toasts` anlegen, `dialogs` zurückgeben und die `Modal`-Attrappe ersetzen:

```js
            Modal: class {
                show() {}
                hide() {}
                static getOrCreateInstance(element) {
                    if (element !== registry.get('confirmModal')) return { show: noop, hide: noop };
                    // The confirm dialog answers at once, like an admin who clicks one of its buttons
                    const close = () => element.dispatch('hidden.bs.modal');
                    return {
                        show() {
                            const button = registry.get('confirm-modal-ok');
                            dialogs.push({
                                text: registry.get('confirm-modal-text').textContent,
                                label: button.textContent,
                                danger: button.classList.contains('btn-danger')
                            });
                            if (confirm) button.onclick();
                            else close();
                        },
                        hide: close
                    };
                }
                static getInstance() { return null; }
            }
```

Den JSDoc-Kommentar von `loadFrontendApp` ergänzen: `@param {boolean} [options.confirm] -> Answer of the confirm dialog (default: confirmed).` und in `@returns` `dialogs lists the confirm dialogs shown ({ text, label, danger })`.

- [ ] **Step 3: `showConfirmDialog` mit Option**

`public/js/core/ui.js`:

```js
/**
 * Ask before an action that cannot be undone or that others will notice.
 *
 * @param {string} message -> Question (plain text).
 * @param {string} [confirmLabel] -> Label of the confirming button.
 * @param {Object} [options] -> `{ danger }`: false shows a primary button instead of the red one, for actions that destroy nothing.
 * @returns {Promise<boolean>} -> true when confirmed, false when dismissed.
 */
export function showConfirmDialog(message, confirmLabel = 'Bestätigen', { danger = true } = {}) {
    return new Promise(resolve => {
        const modalEl = document.getElementById('confirmModal');
        const confirmBtn = document.getElementById('confirm-modal-ok');
        document.getElementById('confirm-modal-text').textContent = message;
        confirmBtn.textContent = confirmLabel;
        confirmBtn.classList.toggle('btn-danger', danger);
        confirmBtn.classList.toggle('btn-primary', !danger);
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        let confirmed = false;
        confirmBtn.onclick = () => { confirmed = true; modal.hide(); };
        modalEl.addEventListener('hidden.bs.modal', () => resolve(confirmed), { once: true });
        modal.show();
    });
}
```

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/components.test.js 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 4: CSS der beiden Komponenten**

Ans Ende von `public/css/components.css`:

```css

/* ═══════════════════════════════════════════ */
/* DATA TABLE                                  */
/* A real <table>: sortable heads, cells with  */
/* a second line, sub-rows. Below 768 px every */
/* row is a block                              */
/* ═══════════════════════════════════════════ */
.data-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--text-primary);
}

.data-table th {
  padding: var(--space-8) var(--space-12);
  border-bottom: 1px solid var(--border-strong);
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}

.data-table td {
  padding: var(--space-12);
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.data-table-sort {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
}

.data-table-sort:hover,
.data-table th[aria-sort="ascending"] .data-table-sort,
.data-table th[aria-sort="descending"] .data-table-sort {
  color: var(--text-primary);
}

/* Name of the row; a button, because it opens the row's main view */
.data-table-title {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-primary);
  font-size: var(--font-size-md);
  font-weight: 600;
  text-align: left;
}

.data-table-title:hover {
  color: var(--accent-text);
  text-decoration: underline;
}

.data-table-meta {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.data-table-actions {
  text-align: right;
  white-space: nowrap;
}

.data-table-buttons {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
}

.data-table tr.is-sub td {
  background: var(--bg-tint-1);
}

.data-table tr.is-sub td:first-child {
  padding-left: var(--space-48);
}

/* Muted by colour, never by opacity: opacity would put the row's menu behind the rows below */
.data-table tr.is-muted .data-table-title {
  color: var(--text-secondary);
}

@media (max-width: 767.98px) {
  /* The heads stay for screen readers */
  .data-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .data-table,
  .data-table tbody,
  .data-table tr,
  .data-table td {
    display: block;
  }

  .data-table tr {
    padding: var(--space-12) 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .data-table td {
    padding: var(--space-4) 0;
    border-bottom: 0;
  }

  .data-table-actions {
    text-align: left;
  }

  .data-table tr.is-sub td:first-child {
    padding-left: var(--space-16);
  }
}

/* ═══════════════════════════════════════════ */
/* MENU                                        */
/* Bootstrap .dropdown-menu markup with        */
/* .dropdown-item, -header and -divider        */
/* ═══════════════════════════════════════════ */
.dropdown-menu {
  --bs-dropdown-bg: var(--bg-secondary);
  --bs-dropdown-border-color: var(--border-strong);
  --bs-dropdown-border-radius: var(--radius);
  --bs-dropdown-padding-x: var(--space-4);
  --bs-dropdown-padding-y: var(--space-4);
  --bs-dropdown-font-size: var(--font-size-sm);
  --bs-dropdown-link-color: var(--text-primary);
  --bs-dropdown-link-hover-color: var(--text-primary);
  --bs-dropdown-link-hover-bg: var(--bg-tint-2);
  --bs-dropdown-link-active-color: var(--text-primary);
  --bs-dropdown-link-active-bg: var(--accent-tint-2);
  --bs-dropdown-header-color: var(--text-muted);
  --bs-dropdown-divider-bg: var(--border-subtle);
  box-shadow: var(--shadow-lg);
}

.dropdown-item {
  border-radius: var(--radius-sm);
}

.dropdown-header {
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

/* The one entry that destroys something; it stands last, below a divider */
.dropdown-item.is-danger {
  color: var(--danger);
}

.dropdown-item.is-danger:hover,
.dropdown-item.is-danger:focus {
  background: var(--danger-bg);
  color: var(--danger);
}
```

In `public/css/style.css` den Kommentar `/* Admin status toggle */` und die drei Regeln `.status-dropdown .dropdown-menu`, `.status-dropdown .dropdown-item`, `.status-dropdown .dropdown-item:hover` löschen.

In `public/index.html` im Danger-Zone-Menü `dropdown-menu dropdown-menu-dark dropdown-menu-end` zu `dropdown-menu dropdown-menu-end` kürzen und beim Eintrag PANIC BUTTON `class="dropdown-item text-danger"` durch `class="dropdown-item is-danger"` ersetzen.

- [ ] **Step 5: Styleguide-Blöcke**

In `public/js/pages/debug-components.js` vor `renderDebugComponents` einfügen:

```js
function dataTableBlock() {
    const head = (label, sort, icon) => `<th scope="col" aria-sort="${sort}"><button type="button" class="data-table-sort">${label}<i class="bi bi-${icon}" aria-hidden="true"></i></button></th>`;
    const actions = (label, className = 'btn-secondary') => `<td class="data-table-actions"><div class="data-table-buttons"><button type="button" class="btn btn-sm ${className}">${label}</button><button type="button" class="btn btn-sm btn-ghost btn-icon" aria-label="Weitere Aktionen"><i class="bi bi-three-dots"></i></button></div></td>`;
    return block('data-table', 'Tabelle', '.data-table mit .data-table-sort, -title, -meta, -actions, -buttons; Zeilen .is-sub, .is-muted', `
        <table class="data-table">
            <thead><tr>${head('Event', 'none', 'arrow-down-up')}${head('Termin', 'ascending', 'arrow-up')}<th scope="col" class="data-table-actions">Aktionen</th></tr></thead>
            <tbody>
                <tr><td><button type="button" class="data-table-title">${LONG_LABEL}</button><div class="data-table-meta">Raid · Rolle nötig · Sofort bestätigt</div></td><td>Mi., 14. Okt. · 20:00<div class="data-table-meta">in 4 Tagen</div></td>${actions('Anmeldungen · 2 offen', 'btn-primary')}</tr>
                <tr class="is-sub"><td>Termin 2 von 3</td><td>Mi., 21. Okt. · 20:00<div class="data-table-meta">in 11 Tagen</div></td>${actions('Anmeldungen')}</tr>
                <tr class="is-muted"><td><button type="button" class="data-table-title">Retro-Spieleabend</button> <span class="chip chip-sm">Vorbei</span><div class="data-table-meta">Gaming · Offen · Sofort bestätigt</div></td><td>So., 4. Okt. · 19:00<div class="data-table-meta">vor 6 Tagen</div></td>${actions('Archivieren')}</tr>
            </tbody>
        </table>`);
}

function menuBlock() {
    const item = (icon, label, className = '') => `<li><button type="button" class="dropdown-item${className}"><i class="bi bi-${icon} me-2" aria-hidden="true"></i>${label}</button></li>`;
    // Shown open and in the flow of the page; a real menu opens from a button with data-bs-toggle="dropdown"
    return block('menu', 'Menü', '.dropdown-menu mit .dropdown-item, .dropdown-header, .dropdown-divider; .dropdown-item.is-danger', `
        <ul class="dropdown-menu show position-static">
            ${item('pencil', 'Bearbeiten')}
            ${item('copy', 'Duplizieren')}
            <li><hr class="dropdown-divider"></li>
            <li><h6 class="dropdown-header">Status</h6></li>
            ${item('archive', 'Archivieren')}
            <li><hr class="dropdown-divider"></li>
            ${item('trash', 'Löschen …', ' is-danger')}
        </ul>`);
}
```

und in `renderDebugComponents` die Liste um `dataTableBlock(), menuBlock()` nach `capacityBlock()` verlängern.

- [ ] **Step 6: Tests grün, Blick in den Browser**

Run: `npm test 2>&1 | tail -6`
Expected: `# fail 0`.

Run: `npm run test:e2e 2>&1 | tail -4`
Expected: `40 passed`, `2 skipped`.

Im Mock-Modus mit `DEBUG_MODE=true` (`PORT=3127 DEBUG_MODE=true node dev/start.js`, Port mit `netstat -ano | grep 3127` vorher prüfen, Prozess danach per PID beenden) `#debug` als Admin öffnen: Tabelle und Menü bei 1440 px und 390 px ansehen, ebenso das Danger-Zone-Menü unter `#admin`. Stimmt ein Abstand oder eine Farbe nicht, das CSS aus Step 4 nachziehen (nur Tokens).

- [ ] **Step 7: Wiki**

`docs/wiki/modules/frontend-markup.md`, in der Komponenten-Tabelle die Zeile `Dialog` ersetzen und nach `Capacity` zwei Zeilen einfügen:

```markdown
| Dialog | Bootstrap `.modal` markup; `showConfirmDialog(message, label, { danger })` asks with the red button, `danger: false` with a primary one | – |
```

```markdown
| Data table | `<table class="data-table">`: head button `.data-table-sort` (the `<th>` carries `aria-sort`), row name `.data-table-title` (a button), second line `.data-table-meta`, last cell `.data-table-actions` with `.data-table-buttons`; rows `.is-sub` (indented, tinted) and `.is-muted` (colour only, never opacity or transform: the row's menu would end up behind the following rows). Below 768 px every row is a block and the heads are only read by screen readers | – |
| Menu | Bootstrap dropdown: a button with `data-bs-toggle="dropdown"` and `<ul class="dropdown-menu">` with `.dropdown-item` buttons, `.dropdown-header`, `.dropdown-divider`; `.dropdown-item.is-danger` for the one destroying entry, last and below a divider | – |
```

`docs/wiki/modules/frontend-app.md`, Zeile `core/ui.js`: `showConfirmDialog` ersetzen durch `` `showConfirmDialog(message, confirmLabel, { danger = true })` (resolves true/false; `danger: false` shows a primary button) ``.

`docs/wiki/ops/testing.md`:
- Zeile `styleguide.test.js`: „(eleven)“ → „(thirteen)“.
- Zeile `components.test.js`: ergänzen um `` `showConfirmDialog` (red or primary button, dismissed = false) ``.
- Zeile `await loadFrontendApp(routes)` der Helfer-Tabelle: ergänzen um `` `dialogs` lists the confirm dialogs shown (`{ text, label, danger }`); the dialog answers at once with the option `confirm` (default `true`) ``.

Run: `npm run wiki && npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 8: Committen**

```bash
git add public/css public/js/pages/debug-components.js public/js/core/ui.js public/index.html test/helpers.js test/cssRules.test.js test/styleguide.test.js test/components.test.js e2e/styleguide.spec.js docs/wiki
git commit -m "Add the table and menu components" -m "The admin dashboard needs a table with sortable heads and a menu per row, and W-08 will reuse the table for registrations. Both get tokens-only styles and a styleguide block. The confirm dialog can show a primary button for questions that destroy nothing, and the frontend test harness can answer it." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBtousiUTyQtMzbEfU9oBs"
```

---

### Task 4: Die Tabelle ersetzt die Karten

**Files:**
- Create: `public/js/admin/event-table.js`, `test/adminEventTable.test.js`, `test/htmlSource.js`
- Modify: `public/js/admin/dashboard.js:1-232`, `public/index.html:707-709`, `public/css/style.css` (Block ADMIN EVENT CARD, Serien-Regeln der Admin-Karten), `public/js/core/ui.js` (`renderSkeletonEvents` weg), `public/js/main.js` (Import)
- Test: `test/eventCards.test.js`, `test/actionAttributes.test.js`, `test/eventForm.test.js`, `test/components.test.js`, `test/cssRules.test.js`, `e2e/tour.spec.js`
- Wiki: `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/howto/add-event-field.md`, `docs/wiki/ops/testing.md`

**Interfaces:**
- Consumes: aus Task 2 `ADMIN_TABS`, `ADMIN_SORT_KEYS`, `DEFAULT_ADMIN_SORT`, `buildAdminRows`, `adminTabCounts`, `adminEventActions`, `eventStart`; aus `events/cards.js` `relativeDay(date, now)`; `emptyState({ icon, title, text, action })` aus `core/components.js`; aus Task 3 die Klassen der Tabelle und des Menüs. Bereits registrierte Aktionen: `showRegistrations` (`data-event-id`, `data-event-title`), `editEvent`, `announceEvent`, `duplicateEvent`, `exportRegistrations`, `syncDiscordEvent`, `changeEventStatus` (`data-status`), `startEvent`, `endEvent`, `deleteEvent` (alle `data-event-id`), `deleteEventSeries` (`data-series-id`).
- Produces:
  - `renderAdminTabs(counts: Object|null, activeTab: string) → string`
  - `renderAdminTable(rows: Row[], { sort, expanded: string[], now: Date }) → string`
  - `renderAdminTableSkeleton() → string`, `renderAdminEmpty({ tab, search, counts }) → string`, `renderAdminLoadError() → string`
  - `adminView: { events: Object[]|null, tab, search, sorts, expanded: string[] }`, `renderAdminEvents(now?)`, `loadAdminEvents()`, `switchAdminTab(tab)`, `searchAdminEvents(text)`, `resetAdminSearch()`, `sortAdminEvents(key)`, `toggleAdminSeries(seriesId)`
  - Aktionen `switchAdminTab` (`data-tab`), `searchAdminEvents` (Eingabefeld), `resetAdminSearch`, `sortAdminEvents` (`data-sort`), `toggleAdminSeries` (`data-series-id`), `reloadAdminEvents`
  - Markup-Attribute für Task 5: `data-event-title` an `deleteEvent`, `startEvent`, `endEvent`, `syncDiscordEvent`; `data-channels="1"` an `endEvent` bei `autoCreateChannels`; `data-event-title` und `data-count` an `deleteEventSeries`
  - IDs `#admin-events-tabs`, `#admin-events-search`, `#admin-events-table`

- [ ] **Step 1: HTML-Helfer der Tests in eine eigene Datei**

`test/htmlSource.js` anlegen. Die fünf Funktionen `decodeAttribute`, `elementsWith`, `actionTargets`, `actionElement` und `assertNoInlineHandlers` samt der Konstante `ENTITIES` unverändert aus `test/actionAttributes.test.js` hierher verschieben:

```js
/**
 * Reads rendered HTML strings in the frontend tests: elements with their
 * attributes as the browser sees them, and element doubles for app.runAction().
 */
const assert = require('node:assert/strict');

// … ENTITIES, decodeAttribute, elementsWith, actionTargets, actionElement, assertNoInlineHandlers (moved, unchanged) …

module.exports = { decodeAttribute, elementsWith, actionTargets, actionElement, assertNoInlineHandlers };
```

In `test/actionAttributes.test.js` stattdessen importieren:

```js
const { elementsWith, actionTargets, actionElement, assertNoInlineHandlers } = require('./htmlSource');
```

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/actionAttributes.test.js 2>&1 | tail -6`
Expected: `# fail 0` (reine Verschiebung).

- [ ] **Step 2: Failing tests der Tabelle**

`test/adminEventTable.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');
const { elementsWith, actionTargets, actionElement, assertNoInlineHandlers } = require('./htmlSource');

const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };
// Admin-set text with everything that breaks unescaped markup
const TRICKY_TEXT = 'Bob\'s "Raid" & <mehr>';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const EMOJI = /\p{Extended_Pictographic}/u;
// The page renders with the real clock, so these events are placed around it
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const places = (fields = {}) => ({ taken: 2, capacity: 10, guests: 0, pending: 0, waitlist: 0, text: '2 von 10 Plätzen belegt', waitlistText: '', ...fields });
const adminEvent = (id, fields = {}) => ({
    id, title: id, status: 'active', category: 'Gaming', accessMode: 'open', approvalMode: 'instant',
    maxParticipants: 10, startDate: iso(3 * DAY), places: places(), ...fields
});

const EVENTS = [
    adminEvent('upcoming', { title: 'Spieleabend' }),
    adminEvent('requests', { title: 'Turnier', category: 'Turnier', approvalMode: 'manual', startDate: iso(5 * DAY), places: places({ pending: 2, text: '2 von 10 Plätzen belegt (2 Anfragen offen)' }) }),
    adminEvent('running', { title: 'Marathon', startDate: iso(-HOUR / 2), autoCreateChannels: true }),
    adminEvent('past', { title: 'Retro', startDate: iso(-7 * DAY) }),
    adminEvent('draft', { title: 'Halloween', status: 'draft' }),
    adminEvent('old', { title: 'Sommerfest', status: 'archived', startDate: iso(-90 * DAY) }),
    adminEvent('s1', { title: 'Training', seriesId: 'series', startDate: iso(1 * DAY) }),
    adminEvent('s2', { title: 'Training', seriesId: 'series', startDate: iso(8 * DAY), places: places({ pending: 1, text: '2 von 10 Plätzen belegt (1 Anfrage offen)' }) })
];

async function openTable(events = EVENTS, routes = {}) {
    const harness = await loadFrontendApp({ '/api/admin/all-events': events, ...routes });
    harness.state.currentUser = ADMIN;
    await harness.app.loadAdminEvents();
    return {
        ...harness,
        table: () => harness.element('admin-events-table').innerHTML,
        tabs: () => harness.element('admin-events-tabs').innerHTML,
        run: (action, dataset = {}, extra = {}) => harness.app.runAction(action, { dataset, ...extra })
    };
}

// Body rows of the table as HTML strings
const rowsOf = (html) => html.split('<tr').slice(1).map(row => `<tr${row}`).filter(row => !row.includes('<th'));
const rowOf = (html, text) => {
    const row = rowsOf(html).find(candidate => candidate.includes(text));
    assert.ok(row, `no row with "${text}"`);
    return row;
};
const isSubRow = (row) => row.includes('class="is-sub');
const titlesOf = (html) => rowsOf(html).filter(row => !isSubRow(row)).map(row => row.match(/class="data-table-title"[^>]*>([^<]*)</)[1]);
const mainButtons = (row) => [...row.matchAll(/class="btn btn-sm (btn-primary|btn-secondary)"[^>]*><i[^>]*><\/i>([^<]+)</g)].map(match => ({ style: match[1], label: match[2] }));
const menuLabels = (row) => [...row.matchAll(/class="dropdown-item[^"]*"[^>]*><i[^>]*><\/i>([^<]+)</g)].map(match => match[1]);

test('the table opens in the active tab with one main action and one menu per row', async () => {
    const { table, tabs, requests, toasts } = await openTable();
    // The running event first, then by date; the past one stands last
    assert.deepEqual(titlesOf(table()), ['Marathon', 'Training', 'Spieleabend', 'Turnier', 'Retro']);
    for (const row of rowsOf(table())) {
        assert.equal(mainButtons(row).length, 1, row);
        assert.equal((row.match(/data-bs-toggle="dropdown"/g) || []).length, 1, row);
        assert.match(row, /aria-label="Weitere Aktionen für „[^"]+“"/);
    }
    assert.match(tabs(), /Entwürfe <span class="chip chip-sm">1<\/span>/);
    assert.match(tabs(), /class="nav-link active"[^>]*data-tab="active"[^>]*>Aktiv <span class="chip chip-sm">5<\/span>/);
    assert.match(tabs(), /Archiv <span class="chip chip-sm">1<\/span>/);
    assert.deepEqual(requests.map(request => request.url), ['/api/admin/all-events']);
    assert.deepEqual(toasts, []);
});

test('the main action follows the state and shows open requests', async () => {
    const { table, run } = await openTable();
    assert.deepEqual(mainButtons(rowOf(table(), '>Turnier<')), [{ style: 'btn-primary', label: 'Anmeldungen · 2 offen' }]);
    assert.deepEqual(mainButtons(rowOf(table(), '>Spieleabend<')), [{ style: 'btn-secondary', label: 'Anmeldungen' }]);
    const past = rowOf(table(), '>Retro<');
    assert.deepEqual(mainButtons(past), [{ style: 'btn-secondary', label: 'Archivieren' }]);
    assert.match(past, /^<tr class="is-muted">/);
    assert.match(past, />Vorbei</);
    assert.match(rowOf(table(), '>Marathon<'), /Läuft gerade/);

    await run('switchAdminTab', { tab: 'drafts' });
    assert.deepEqual(mainButtons(rowOf(table(), '>Halloween<')), [{ style: 'btn-secondary', label: 'Veröffentlichen' }]);
    await run('switchAdminTab', { tab: 'archive' });
    assert.deepEqual(mainButtons(rowOf(table(), '>Sommerfest<')), [{ style: 'btn-secondary', label: 'Anmeldungen' }]);
});

test('the menu has three groups and is the only place to delete', async () => {
    const { table } = await openTable();
    const row = rowOf(table(), '>Spieleabend<');
    assert.deepEqual(menuLabels(row), ['Bearbeiten', 'Ankündigen', 'Duplizieren', 'CSV-Export', 'In Discord eintragen …', 'Zurück in Entwürfe', 'Archivieren', 'Löschen …']);
    assert.equal((row.match(/dropdown-divider/g) || []).length, 2);
    assert.match(row, /<h6 class="dropdown-header">Status<\/h6>/);
    assert.match(row, /class="dropdown-item is-danger" data-click="deleteEvent"/);
    // Outside the menu nothing deletes
    assert.doesNotMatch(row.replace(/<ul class="dropdown-menu[\s\S]*?<\/ul>/, ''), /deleteEvent/);

    assert.deepEqual(menuLabels(rowOf(table(), '>Retro<')).slice(0, 2), ['Anmeldungen', 'Bearbeiten']);
    const running = rowOf(table(), '>Marathon<');
    assert.deepEqual(menuLabels(running).slice(-3), ['Jetzt beenden …', 'Zurück in Entwürfe', 'Löschen …']);
    assert.match(running, /data-click="endEvent" data-event-id="running" data-event-title="Marathon" data-channels="1"/);
});

test('tabs, search, sorting and the series toggle need no request', async () => {
    const { table, tabs, run, requests } = await openTable();
    await run('searchAdminEvents', {}, { value: 'tur' });
    assert.deepEqual(titlesOf(table()), ['Turnier']);
    assert.match(tabs(), /Aktiv <span class="chip chip-sm">1<\/span>/);
    await run('searchAdminEvents', {}, { value: '' });

    await run('sortAdminEvents', { sort: 'title' });
    assert.match(table(), /aria-sort="ascending"><button[^>]*data-sort="title"/);
    assert.deepEqual(titlesOf(table()), ['Marathon', 'Spieleabend', 'Training', 'Turnier', 'Retro']);
    await run('sortAdminEvents', { sort: 'title' });
    assert.match(table(), /aria-sort="descending"><button[^>]*data-sort="title"/);
    assert.deepEqual(titlesOf(table()), ['Turnier', 'Training', 'Spieleabend', 'Marathon', 'Retro']);

    // Each tab keeps its own sorting
    await run('switchAdminTab', { tab: 'archive' });
    assert.match(table(), /aria-sort="descending"><button[^>]*data-sort="date"/);
    await run('switchAdminTab', { tab: 'active' });
    assert.match(table(), /aria-sort="descending"><button[^>]*data-sort="title"/);

    await run('toggleAdminSeries', { seriesId: 'series' });
    assert.deepEqual(requests.map(request => request.url), ['/api/admin/all-events']);
});

test('an unknown tab or sort key changes nothing', async () => {
    const { table, tabs, run } = await openTable();
    const before = table();
    for (const tab of ['constructor', '__proto__', '', undefined]) await run('switchAdminTab', { tab });
    for (const sort of ['constructor', '__proto__', '', undefined]) await run('sortAdminEvents', { sort });
    assert.equal(table(), before);
    assert.match(tabs(), /class="nav-link active"[^>]*data-tab="active"/);
});

test('a search without hits says where the hits are and can be reset', async () => {
    const { table, run, element } = await openTable();
    element('admin-events-search').value = 'sommer';
    await run('searchAdminEvents', {}, { value: 'sommer' });
    assert.match(table(), /Keine Treffer/);
    assert.match(table(), /Treffer in anderen Tabs: Archiv 1/);
    assert.match(table(), /data-click="resetAdminSearch"/);

    await run('resetAdminSearch');
    assert.equal(element('admin-events-search').value, '');
    assert.equal(titlesOf(table()).length, 5);

    await run('searchAdminEvents', {}, { value: '<b>nix</b>' });
    assert.match(table(), /in keinem Tab/);
    assert.doesNotMatch(table(), /<b>nix/);
    assert.match(table(), /&lt;b&gt;nix/);
});

test('a series row opens its dates', async () => {
    const { table, run } = await openTable();
    const closed = rowOf(table(), '>Training<');
    assert.match(closed, /Serie · 2 Termine</);
    assert.match(closed, /data-click="toggleAdminSeries" data-series-id="series" aria-expanded="false"/);
    assert.match(closed, /1 Anfrage offen in weiteren Terminen/);
    assert.deepEqual(menuLabels(closed).slice(-2), ['Termin löschen …', 'Ganze Serie löschen …']);
    assert.match(closed, /data-click="deleteEventSeries" data-series-id="series" data-event-title="Training" data-count="2"/);
    assert.ok(!rowsOf(table()).some(isSubRow));

    await run('toggleAdminSeries', { seriesId: 'series' });
    const subRows = rowsOf(table()).filter(isSubRow);
    assert.deepEqual(subRows.map(row => row.match(/Termin \d von \d/)[0]), ['Termin 1 von 2', 'Termin 2 von 2']);
    assert.deepEqual(mainButtons(subRows[1]), [{ style: 'btn-primary', label: 'Anmeldungen · 1 offen' }]);
    assert.deepEqual(menuLabels(subRows[0]).slice(-1), ['Termin löschen …']);
    // The dialogs name the date, because all dates share the title
    assert.match(subRows[0], /data-click="showRegistrations" data-event-id="s1" data-event-title="Training · [^"]+"/);
    assert.match(rowOf(table(), '>Training<'), /aria-expanded="true"/);

    await run('toggleAdminSeries', { seriesId: 'series' });
    assert.ok(!rowsOf(table()).some(isSubRow));
});

test('a series with one date in the tab is a plain row that can still delete the series', async () => {
    const { table } = await openTable([
        adminEvent('k1', { title: 'Kurs', seriesId: 'kurs', status: 'archived', startDate: iso(-30 * DAY) }),
        adminEvent('k2', { title: 'Kurs', seriesId: 'kurs' })
    ]);
    const row = rowOf(table(), '>Kurs<');
    assert.match(row, /Serie · 1 Termin</);
    assert.doesNotMatch(row, /toggleAdminSeries/);
    assert.match(row, /data-click="deleteEventSeries" data-series-id="kurs" data-event-title="Kurs" data-count="2"/);
});

test('texts of admins are escaped and reach the actions unchanged', async () => {
    const { app, table, element, requests } = await openTable(
        [adminEvent('tricky', { title: TRICKY_TEXT, category: TRICKY_TEXT })],
        { '/api/admin/events/tricky/registrations': { data: [], slots: [] } }
    );
    const html = table();
    assertNoInlineHandlers(html);
    assert.doesNotMatch(html, /<mehr>/);
    for (const { attributes } of elementsWith(html, 'data-click')) {
        if (attributes['data-click'] === 'sortAdminEvents') continue;
        assert.equal(attributes['data-event-id'], 'tricky', `${attributes['data-click']} without its event`);
    }
    const [open] = actionTargets(html, 'showRegistrations');
    await app.runAction('showRegistrations', actionElement(open));
    assert.equal(element('reg-event-title').textContent, TRICKY_TEXT);
    assert.ok(requests.some(request => request.url === '/api/admin/events/tricky/registrations'));
    assert.equal(actionTargets(html, 'deleteEvent')[0].attributes['data-event-title'], TRICKY_TEXT);
});

test('an event without places, date or title still gets its row', async () => {
    const { table, toasts } = await openTable([
        adminEvent('bare', { title: '', category: '', places: undefined, startDate: '' }),
        adminEvent('broken', { title: 'Kaputt', places: { text: 5 }, startDate: 'kein Datum' }),
        adminEvent('fine', { title: 'Gut' })
    ]);
    // Without a date an event sorts last
    assert.deepEqual(titlesOf(table()), ['Gut', '(ohne Titel)', 'Kaputt']);
    const bare = rowOf(table(), '(ohne Titel)');
    assert.match(bare, /Kein Termin/);
    assert.match(bare, /<span class="data-table-meta">–<\/span>/);
    assert.match(rowOf(table(), '>Kaputt<'), /<span class="data-table-meta">–<\/span>/);
    assert.deepEqual(toasts, []);
});

test('the date column tells day, time and distance', async () => {
    const { app } = await loadFrontendApp({});
    // Sunday, 11 October 2026, 16:00; local dates, so every time zone gives the same text
    const now = new Date(2026, 9, 11, 16, 0);
    const at = (year, month, day, hour, minute = 0) => new Date(year, month, day, hour, minute).toISOString();
    const rows = app.buildAdminRows([
        adminEvent('soon', { title: 'Bald', startDate: at(2026, 9, 14, 19) }),
        adminEvent('next-year', { title: 'Neujahr', startDate: at(2027, 0, 1, 18, 30) }),
        adminEvent('live', { title: 'Live', startDate: at(2026, 9, 11, 15, 30) })
    ], { tab: 'active', now });
    const html = app.renderAdminTable(rows, { sort: app.DEFAULT_ADMIN_SORT.active, expanded: [], now });
    assert.match(rowOf(html, '>Bald<'), /Mi\., 14\. Okt\. · 19:00<\/div><div class="data-table-meta">in 3 Tagen</);
    assert.match(rowOf(html, '>Neujahr<'), /Fr\., 1\. Jan\. 2027 · 18:30/);
    assert.match(rowOf(html, '>Live<'), /Läuft gerade<\/span><div class="data-table-meta">seit 15:30</);
});

test('the places column shows the bar, the sentence and the waitlist', async () => {
    const { app } = await loadFrontendApp({});
    const now = new Date();
    const rows = app.buildAdminRows([
        adminEvent('full', { title: 'Voll', places: places({ taken: 5, capacity: 5, waitlist: 3, text: '5 von 5 Plätzen belegt', waitlistText: '3 auf der Warteliste' }) }),
        adminEvent('open', { title: 'Offen', maxParticipants: 0, places: places({ capacity: 0, text: '2 Plätze belegt' }) })
    ], { tab: 'active', now });
    const html = app.renderAdminTable(rows, { sort: app.DEFAULT_ADMIN_SORT.active, expanded: [], now });
    const full = rowOf(html, '>Voll<');
    assert.match(full, /<div class="capacity is-full"><progress class="capacity-meter" max="5" value="5" aria-label="5 von 5 Plätzen belegt"><\/progress><\/div>/);
    assert.match(full, /<div>5 von 5 Plätzen belegt<\/div><div class="data-table-meta">3 auf der Warteliste<\/div>/);
    const open = rowOf(html, '>Offen<');
    assert.doesNotMatch(open, /<progress/);
    assert.match(open, /<div>2 Plätze belegt<\/div>/);
});

test('empty tabs and a failed load say what is going on', async () => {
    const { table, run } = await openTable([adminEvent('only')]);
    await run('switchAdminTab', { tab: 'drafts' });
    assert.match(table(), /Keine Entwürfe/);
    await run('switchAdminTab', { tab: 'archive' });
    assert.match(table(), /Das Archiv ist leer/);
    assert.match((await openTable([])).table(), /Keine aktiven Events/);

    // No route: the request answers 404
    const failing = await loadFrontendApp({});
    failing.state.currentUser = ADMIN;
    await failing.app.loadAdminEvents();
    const html = failing.element('admin-events-table').innerHTML;
    assert.match(html, /Events konnten nicht geladen werden/);
    assert.match(html, /data-click="reloadAdminEvents"/);
});

test('a reload keeps tab and table until the new answer is there', async () => {
    let release;
    let answer = new Promise(resolve => { release = resolve; });
    const harness = await loadFrontendApp({ '/api/admin/all-events': () => answer });
    harness.state.currentUser = ADMIN;
    const table = () => harness.element('admin-events-table').innerHTML;

    const first = harness.app.loadAdminEvents();
    assert.match(table(), /skeleton/);
    release(EVENTS);
    await first;
    assert.doesNotMatch(table(), /skeleton/);

    await harness.app.runAction('switchAdminTab', { dataset: { tab: 'archive' } });
    answer = new Promise(resolve => { release = resolve; });
    const second = harness.app.loadAdminEvents();
    assert.match(table(), /Sommerfest/);
    assert.doesNotMatch(table(), /skeleton/);
    release(EVENTS.filter(event => event.id !== 'old'));
    await second;
    assert.match(table(), /Das Archiv ist leer/);
    assert.match(harness.element('admin-events-tabs').innerHTML, /class="nav-link active"[^>]*data-tab="archive"/);
});

test('the table markup carries no emojis and no style attributes', async () => {
    const { table, tabs, run } = await openTable();
    await run('toggleAdminSeries', { seriesId: 'series' });
    for (const html of [table(), tabs()]) {
        assert.doesNotMatch(html, EMOJI);
        assert.doesNotMatch(html, /style="/);
    }
});
```

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/adminEventTable.test.js 2>&1 | tail -12`
Expected: FAIL (`admin-events-table` gibt es noch nicht: `Cannot read properties of null`).

- [ ] **Step 3: `admin/event-table.js` schreiben**

```js
/**
 * Markup of the admin event table (#admin): tabs, table, row menu,
 * placeholders and empty states. Pure functions that turn the rows of
 * admin/event-rows.js into HTML; no DOM access. Styles: DATA TABLE and MENU
 * in components.css, ADMIN EVENTS in style.css.
 */
import { emptyState } from '../core/components.js';
import { escapeHtml } from '../core/ui.js';
import { eventStart, relativeDay } from '../events/cards.js';
import { ADMIN_TABS, adminEventActions } from './event-rows.js';

const SKELETON_ROWS = 5;
const UNTITLED = '(ohne Titel)';

const COLUMNS = [
    { key: 'title', label: 'Event' },
    { key: 'date', label: 'Termin' },
    { key: 'places', label: 'Plätze' }
];

const EMPTY_TABS = {
    drafts: { icon: 'file-earmark', title: 'Keine Entwürfe' },
    active: { icon: 'calendar-x', title: 'Keine aktiven Events' },
    archive: { icon: 'archive', title: 'Das Archiv ist leer' }
};

// One entry per action key of adminEventActions(). The action names stand
// literally in the markup, so the guard in frontendCsp.test.js finds them.
// `t` is the escaped target built by actionTarget().
const ACTIONS = {
    registrations: { icon: 'list-check', label: 'Anmeldungen', attributes: (t) => `data-click="showRegistrations" data-event-id="${t.id}" data-event-title="${t.label}"` },
    edit: { icon: 'pencil', label: 'Bearbeiten', attributes: (t) => `data-click="editEvent" data-event-id="${t.id}"` },
    announce: { icon: 'megaphone', label: 'Ankündigen', attributes: (t) => `data-click="announceEvent" data-event-id="${t.id}"` },
    duplicate: { icon: 'copy', label: 'Duplizieren', attributes: (t) => `data-click="duplicateEvent" data-event-id="${t.id}"` },
    export: { icon: 'download', label: 'CSV-Export', attributes: (t) => `data-click="exportRegistrations" data-event-id="${t.id}"` },
    syncDiscord: { icon: 'discord', label: 'In Discord eintragen …', attributes: (t) => `data-click="syncDiscordEvent" data-event-id="${t.id}" data-event-title="${t.label}"` },
    publish: { icon: 'send', label: 'Veröffentlichen', attributes: (t) => `data-click="changeEventStatus" data-event-id="${t.id}" data-status="active"` },
    reactivate: { icon: 'arrow-counterclockwise', label: 'Wieder aktivieren', attributes: (t) => `data-click="changeEventStatus" data-event-id="${t.id}" data-status="active"` },
    toDraft: { icon: 'file-earmark', label: 'Zurück in Entwürfe', attributes: (t) => `data-click="changeEventStatus" data-event-id="${t.id}" data-status="draft"` },
    archive: { icon: 'archive', label: 'Archivieren', attributes: (t) => `data-click="changeEventStatus" data-event-id="${t.id}" data-status="archived"` },
    start: { icon: 'play-fill', label: 'Jetzt starten …', attributes: (t) => `data-click="startEvent" data-event-id="${t.id}" data-event-title="${t.label}"` },
    end: { icon: 'stop-fill', label: 'Jetzt beenden …', attributes: (t) => `data-click="endEvent" data-event-id="${t.id}" data-event-title="${t.label}" data-channels="${t.channels}"` },
    delete: { icon: 'trash', label: 'Löschen …', attributes: (t) => `data-click="deleteEvent" data-event-id="${t.id}" data-event-title="${t.label}"` },
    deleteDate: { icon: 'trash', label: 'Termin löschen …', attributes: (t) => `data-click="deleteEvent" data-event-id="${t.id}" data-event-title="${t.label}"` },
    deleteSeries: { icon: 'trash', label: 'Ganze Serie löschen …', attributes: (t) => `data-click="deleteEventSeries" data-series-id="${t.seriesId}" data-event-title="${t.title}" data-count="${t.seriesTotal}"` }
};

const formatTime = (date) => date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

// "Mo., 12. Okt."; with the year when it is not the current one
function formatDay(date, now) {
    const options = { weekday: 'short', day: 'numeric', month: 'short' };
    if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
    return date.toLocaleDateString('de-DE', options);
}

/**
 * Escaped values of one event for the attributes of its actions.
 *
 * @param {Object} event -> Event.
 * @param {Object|null} series -> `series` of the row when the event is a date of a series.
 * @param {Date} now -> Reference time.
 * @returns {Object} -> `{ id, title, label, channels, seriesId, seriesTotal }`; `label` names the day for a date of a series, because its dates share the title.
 */
function actionTarget(event, series, now) {
    const title = String(event.title ?? '').trim() || UNTITLED;
    const start = eventStart(event);
    const label = series && start ? `${title} · ${formatDay(start, now)}` : title;
    return {
        id: escapeHtml(String(event.id ?? '')),
        title: escapeHtml(title),
        label: escapeHtml(label),
        channels: event.autoCreateChannels ? '1' : '',
        seriesId: series ? escapeHtml(String(series.id)) : '',
        seriesTotal: series ? Number(series.total) || 0 : 0
    };
}

function renderStateChips(event, state) {
    const chips = [];
    if (state === 'past') chips.push('<span class="chip chip-sm">Vorbei</span>');
    if (event.status === 'cancelled') chips.push('<span class="chip chip-sm chip-danger">Abgesagt</span>');
    return chips.join('');
}

function renderEventCell(row, target, isOpen) {
    const { event, state, series } = row;
    const count = series ? series.dates.length : 0;
    const toggle = count > 1
        ? `<button type="button" class="btn btn-sm btn-ghost btn-icon" data-click="toggleAdminSeries" data-series-id="${target.seriesId}" aria-expanded="${isOpen}" aria-label="Termine von „${target.title}“ ${isOpen ? 'zuklappen' : 'aufklappen'}"><i class="bi bi-chevron-${isOpen ? 'down' : 'right'}" aria-hidden="true"></i></button>`
        : '';
    const seriesChip = series
        ? `<span class="chip chip-sm"><i class="bi bi-arrow-repeat" aria-hidden="true"></i>Serie · ${count} ${count === 1 ? 'Termin' : 'Termine'}</span>`
        : '';
    const meta = [
        event.category,
        event.accessMode === 'open' ? 'Offen' : 'Rolle nötig',
        event.approvalMode === 'instant' ? 'Sofort bestätigt' : 'Freigabe durch Admin'
    ].filter(Boolean).map(text => escapeHtml(String(text))).join(' · ');
    return `<td><div class="admin-events-event">${toggle}<div><div class="admin-events-heading"><button type="button" class="data-table-title" data-click="editEvent" data-event-id="${target.id}">${target.title}</button>${seriesChip}${renderStateChips(event, state)}</div><div class="data-table-meta">${meta}</div></div></div></td>`;
}

function renderDateCell(event, state, now) {
    const start = eventStart(event);
    if (!start) return '<td><span class="data-table-meta">Kein Termin</span></td>';
    if (state === 'running') {
        return `<td><span class="chip chip-sm chip-danger"><i class="bi bi-broadcast" aria-hidden="true"></i>Läuft gerade</span><div class="data-table-meta">seit ${formatTime(start)}</div></td>`;
    }
    return `<td><div>${formatDay(start, now)} · ${formatTime(start)}</div><div class="data-table-meta">${relativeDay(start, now)}</div></td>`;
}

function renderPlacesCell(event, pendingElsewhere = 0) {
    const places = event.places;
    // An answer of an older server or a broken event must not take the table down
    if (!places || typeof places.text !== 'string') return '<td><span class="data-table-meta">–</span></td>';
    const capacity = Math.max(0, Math.floor(Number(places.capacity) || 0));
    const taken = Math.max(0, Math.floor(Number(places.taken) || 0));
    const sentence = escapeHtml(places.text);
    const bar = capacity > 0
        ? `<div class="capacity${taken >= capacity ? ' is-full' : ''}"><progress class="capacity-meter" max="${capacity}" value="${Math.min(taken, capacity)}" aria-label="${sentence}"></progress></div>`
        : '';
    const waitlist = places.waitlistText ? `<div class="data-table-meta">${escapeHtml(String(places.waitlistText))}</div>` : '';
    const elsewhere = pendingElsewhere > 0
        ? `<div class="admin-events-pending">${pendingElsewhere} ${pendingElsewhere === 1 ? 'Anfrage' : 'Anfragen'} offen in weiteren Terminen</div>`
        : '';
    return `<td><div class="admin-events-places">${bar}<div>${sentence}</div>${waitlist}${elsewhere}</div></td>`;
}

function renderActionButton(key, target, className, iconSpace, suffix = '') {
    const action = ACTIONS[key];
    return `<button type="button" class="${className}" ${action.attributes(target)}><i class="bi bi-${action.icon} ${iconSpace}" aria-hidden="true"></i>${action.label}${suffix}</button>`;
}

function renderActionsCell(event, state, target, options) {
    const actions = adminEventActions(event, state, options);
    const pending = actions.main === 'registrations' ? Math.max(0, Math.floor(Number(event.places?.pending) || 0)) : 0;
    const main = renderActionButton(actions.main, target, `btn btn-sm ${pending > 0 ? 'btn-primary' : 'btn-secondary'}`, 'me-1', pending > 0 ? ` · ${pending} offen` : '');
    const item = (key, tone = '') => `<li>${renderActionButton(key, target, `dropdown-item${tone}`, 'me-2')}</li>`;
    const menu = [
        ...actions.general.map(key => item(key)),
        '<li><hr class="dropdown-divider"></li>',
        '<li><h6 class="dropdown-header">Status</h6></li>',
        ...actions.status.map(key => item(key)),
        '<li><hr class="dropdown-divider"></li>',
        ...actions.danger.map(key => item(key, ' is-danger'))
    ].join('');
    return `<td class="data-table-actions"><div class="data-table-buttons">${main}<div class="dropdown"><button type="button" class="btn btn-sm btn-ghost btn-icon" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Weitere Aktionen für „${target.label}“"><i class="bi bi-three-dots" aria-hidden="true"></i></button><ul class="dropdown-menu dropdown-menu-end">${menu}</ul></div></div></td>`;
}

function renderSubRow(date, series, now) {
    const { event, state, position } = date;
    const target = actionTarget(event, series, now);
    return `<tr class="is-sub${state === 'past' ? ' is-muted' : ''}"><td><div class="admin-events-heading"><span>Termin ${position} von ${series.total}</span>${renderStateChips(event, state)}</div></td>${renderDateCell(event, state, now)}${renderPlacesCell(event)}${renderActionsCell(event, state, target, { inSeries: true })}</tr>`;
}

function renderRow(row, { expanded, now }) {
    const { event, state, series } = row;
    const target = actionTarget(event, series, now);
    const isOpen = !!series && series.dates.length > 1 && expanded.includes(series.id);
    const main = `<tr${state === 'past' ? ' class="is-muted"' : ''}>${renderEventCell(row, target, isOpen)}${renderDateCell(event, state, now)}${renderPlacesCell(event, series ? series.pendingElsewhere : 0)}${renderActionsCell(event, state, target, { inSeries: !!series, seriesRow: !!series })}</tr>`;
    return isOpen ? main + series.dates.map(date => renderSubRow(date, series, now)).join('') : main;
}

/**
 * Tabs above the table.
 *
 * @param {Object|null} counts -> Rows per tab (`{ drafts, active, archive }`); null while the list loads, then the tabs show no number.
 * @param {string} activeTab -> Id of the open tab.
 * @returns {string} -> `<li>` elements for a .nav.nav-pills list.
 */
export function renderAdminTabs(counts, activeTab) {
    return ADMIN_TABS.map(({ id, label }) => {
        const active = id === activeTab;
        const counter = counts ? ` <span class="chip chip-sm">${Number(counts[id]) || 0}</span>` : '';
        return `<li class="nav-item" role="presentation"><button type="button" class="nav-link${active ? ' active' : ''}" role="tab" aria-selected="${active}" data-click="switchAdminTab" data-tab="${id}">${label}${counter}</button></li>`;
    }).join('');
}

/**
 * The event table of one tab.
 *
 * @param {Array<Object>} rows -> Result of buildAdminRows(); at least one row.
 * @param {Object} options -> `{ sort, expanded, now }`: sorting shown in the heads, ids of the opened series, reference time.
 * @returns {string} -> HTML of a .data-table.
 */
export function renderAdminTable(rows, { sort, expanded = [], now }) {
    const heads = COLUMNS.map(({ key, label }) => {
        const descending = sort.direction === 'desc';
        const active = sort.key === key;
        const ariaSort = active ? (descending ? 'descending' : 'ascending') : 'none';
        const icon = active ? (descending ? 'arrow-down' : 'arrow-up') : 'arrow-down-up';
        return `<th scope="col" aria-sort="${ariaSort}"><button type="button" class="data-table-sort" data-click="sortAdminEvents" data-sort="${key}">${label}<i class="bi bi-${icon}" aria-hidden="true"></i></button></th>`;
    }).join('');
    return `<table class="data-table admin-events-table"><thead><tr>${heads}<th scope="col" class="data-table-actions">Aktionen</th></tr></thead><tbody>${rows.map(row => renderRow(row, { expanded, now })).join('')}</tbody></table>`;
}

/**
 * Placeholder rows while the list loads for the first time.
 *
 * @returns {string} -> HTML of a table without content.
 */
export function renderAdminTableSkeleton() {
    const cell = '<td><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text is-short"></div></td>';
    const row = `<tr>${cell}${cell}${cell}<td class="data-table-actions"><div class="skeleton skeleton-chip"></div></td></tr>`;
    return `<table class="data-table admin-events-table" aria-hidden="true"><tbody>${row.repeat(SKELETON_ROWS)}</tbody></table>`;
}

/**
 * What a tab shows without rows.
 *
 * @param {Object} options -> `{ tab, search, counts }`; `counts` are the rows per tab after the search.
 * @returns {string} -> Empty state; after a search it tells where the hits are and offers to reset it.
 */
export function renderAdminEmpty({ tab, search = '', counts = {} }) {
    const needle = String(search ?? '').trim();
    if (!needle) return emptyState(Object.hasOwn(EMPTY_TABS, tab) ? EMPTY_TABS[tab] : EMPTY_TABS.active);
    const elsewhere = ADMIN_TABS.filter(({ id }) => id !== tab && counts[id] > 0).map(({ id, label }) => `${label} ${counts[id]}`);
    const text = elsewhere.length
        ? `Für „${needle}“ gibt es hier nichts. Treffer in anderen Tabs: ${elsewhere.join(' · ')}`
        : `Für „${needle}“ gibt es in keinem Tab ein Event.`;
    return emptyState({
        icon: 'search',
        title: 'Keine Treffer',
        text,
        action: '<button type="button" class="btn btn-secondary btn-sm" data-click="resetAdminSearch">Suche zurücksetzen</button>'
    });
}

/**
 * Shown when the list could not be loaded.
 *
 * @returns {string} -> Empty state with a retry button.
 */
export function renderAdminLoadError() {
    return emptyState({
        icon: 'exclamation-triangle',
        title: 'Events konnten nicht geladen werden',
        action: '<button type="button" class="btn btn-secondary btn-sm" data-click="reloadAdminEvents">Erneut versuchen</button>'
    });
}
```

- [ ] **Step 4: `dashboard.js` auf die Tabelle umstellen**

In `public/js/admin/dashboard.js` den Kopfkommentar („event table“ statt „event cards“) und die Imports ersetzen, `loadAdminEvents` samt Karten-Markup (Zeilen 63–232) durch den folgenden Block ersetzen und die Registrierung am Dateiende ergänzen. `loadAdminStats`, `loadAuditLog`, `showResetModal` und `performSystemReset` bleiben unverändert.

```js
/**
 * Admin area: stats, event table, audit log, system reset.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast } from '../core/ui.js';
import { ADMIN_SORT_KEYS, ADMIN_TABS, DEFAULT_ADMIN_SORT, adminTabCounts, buildAdminRows } from './event-rows.js';
import { renderAdminEmpty, renderAdminLoadError, renderAdminTable, renderAdminTableSkeleton, renderAdminTabs } from './event-table.js';

/**
 * What the admin looks at in the event table. It lives as long as the page:
 * reloading the list after an action keeps tab, search, sorting and the
 * opened series.
 */
export const adminView = {
    // null until GET /api/admin/all-events has answered once
    events: null,
    tab: 'active',
    search: '',
    // Sorting per tab; a tab without an entry uses DEFAULT_ADMIN_SORT
    sorts: {},
    // Ids of the opened series
    expanded: []
};

const sortOfTab = (tab) => adminView.sorts[tab] || DEFAULT_ADMIN_SORT[tab];
```

```js
/**
 * Render tabs and table from adminView. Does nothing before the first answer.
 *
 * @param {Date} [now] -> Reference time for "Läuft gerade", "Vorbei" and the distance of a date.
 * @returns {void}
 */
export function renderAdminEvents(now = new Date()) {
    if (!adminView.events) return;
    const { events, tab, search, expanded } = adminView;
    const counts = adminTabCounts(events, search, now);
    const sort = sortOfTab(tab);
    const rows = buildAdminRows(events, { tab, search, sort, now });
    document.getElementById('admin-events-tabs').innerHTML = renderAdminTabs(counts, tab);
    document.getElementById('admin-events-table').innerHTML = rows.length
        ? renderAdminTable(rows, { sort, expanded, now })
        : renderAdminEmpty({ tab, search, counts });
}

export async function loadAdminEvents() {
    const table = document.getElementById('admin-events-table');
    // Placeholders only before the first answer: after an action the old table stays until the new one is there
    if (!adminView.events) {
        document.getElementById('admin-events-tabs').innerHTML = renderAdminTabs(null, adminView.tab);
        table.innerHTML = renderAdminTableSkeleton();
    }
    try {
        const res = await fetch('/api/admin/all-events');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = await res.json();
        adminView.events = Array.isArray(events) ? events : [];
        renderAdminEvents();
    } catch {
        adminView.events = null;
        table.innerHTML = renderAdminLoadError();
    }
}

export function switchAdminTab(tab) {
    if (!ADMIN_TABS.some(entry => entry.id === tab)) return;
    adminView.tab = tab;
    renderAdminEvents();
}

export function searchAdminEvents(text) {
    adminView.search = String(text ?? '');
    renderAdminEvents();
}

export function resetAdminSearch() {
    document.getElementById('admin-events-search').value = '';
    searchAdminEvents('');
}

/**
 * Sort the open tab by a column; the same column again turns the direction.
 *
 * @param {string} key -> One of ADMIN_SORT_KEYS; anything else is ignored.
 * @returns {void}
 */
export function sortAdminEvents(key) {
    if (!ADMIN_SORT_KEYS.includes(key)) return;
    const current = sortOfTab(adminView.tab);
    adminView.sorts[adminView.tab] = { key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' };
    renderAdminEvents();
}

export function toggleAdminSeries(seriesId) {
    adminView.expanded = adminView.expanded.includes(seriesId)
        ? adminView.expanded.filter(id => id !== seriesId)
        : [...adminView.expanded, seriesId];
    renderAdminEvents();
}
```

```js
registerActions({
    loadAuditLog: () => loadAuditLog(),
    showResetModal: () => showResetModal(),
    performSystemReset: () => performSystemReset(),
    reloadAdminEvents: () => loadAdminEvents(),
    switchAdminTab: (el) => switchAdminTab(el.dataset.tab),
    searchAdminEvents: (el) => searchAdminEvents(el.value),
    resetAdminSearch: () => resetAdminSearch(),
    sortAdminEvents: (el) => sortAdminEvents(el.dataset.sort),
    toggleAdminSeries: (el) => toggleAdminSeries(el.dataset.seriesId)
});
```

Die Importe `reminderHoursOf`, `isValidBannerUrl`, `markdownPreview`, `renderSkeletonEvents` entfallen aus `dashboard.js`. Danach `renderSkeletonEvents` aus `public/js/core/ui.js` löschen (`grep -rn "renderSkeletonEvents" public/js` zeigt vorher nur noch die Definition) und in `public/js/main.js` nach `import './admin/event-rows.js';` die Zeile `import './admin/event-table.js';` ergänzen.

- [ ] **Step 5: Markup in `index.html`**

Den Block `<div class="row g-4" id="admin-events-grid">…</div>` ersetzen durch:

```html
        <div class="admin-events-toolbar">
          <ul class="nav nav-pills" id="admin-events-tabs" role="tablist" aria-label="Events nach Status"></ul>
          <div class="events-search">
            <i class="bi bi-search events-search-icon" aria-hidden="true"></i>
            <input type="search" class="form-control" id="admin-events-search" placeholder="Titel oder Kategorie suchen …"
              aria-label="Events durchsuchen" data-input="searchAdminEvents">
          </div>
        </div>
        <div id="admin-events-table"></div>
```

- [ ] **Step 6: Seiten-CSS**

In `public/css/style.css` den Block ADMIN EVENT CARD (`.admin-event-card`, `.admin-event-card .admin-actions`) ersetzen durch:

```css
/* ═══════════════════════════════════════════ */
/* ADMIN EVENTS                                */
/* Table of #admin: tabs and search above,     */
/* renderAdminTable() in admin/event-table.js. */
/* Table and menu come from components.css     */
/* ═══════════════════════════════════════════ */
.admin-events-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-12);
  margin: var(--space-24) 0 var(--space-12);
}

.admin-events-toolbar .events-search {
  max-width: 24rem;
  margin-left: auto;
}

.admin-events-table th:nth-child(1) {
  width: 38%;
}

.admin-events-table th:nth-child(2) {
  width: 20%;
}

.admin-events-table th:nth-child(3) {
  width: 24%;
}

/* Toggle of a series and the text beside it */
.admin-events-event {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
}

.admin-events-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4) var(--space-8);
}

.admin-events-places {
  font-size: var(--font-size-sm);
}

.admin-events-places .capacity {
  margin-bottom: var(--space-4);
}

.admin-events-pending {
  color: var(--warning);
  font-weight: 600;
}

@media (max-width: 767.98px) {
  .admin-events-toolbar .events-search {
    max-width: none;
    margin-left: 0;
  }
}
```

Außerdem löschen: `.series-admin-date-item`, `.series-admin-date-item:last-child`, `.series-admin-card`. `.series-badge` nur löschen, wenn `grep -rn "series-badge" public/js public/index.html` keinen Treffer mehr hat.

- [ ] **Step 7: Bestehende Tests umziehen**

- `test/eventCards.test.js`: den Test `admin cards show the preview, no Markdown` löschen. Den Test `a cut preview never splits an HTML entity` ohne die Admin-Karte schreiben:

```js
test('a cut preview never splits an HTML entity', async () => {
    const { app } = await loadFrontendApp({});
    // 116 letters, then "&": escaping before cutting left a half "&am" at character 120
    assert.doesNotMatch(app.escapeHtml(app.markdownPreview(`${'a'.repeat(116)} & mehr Text danach`)), /&am(?!p;)/);
});
```

- `test/actionAttributes.test.js`: den Test `admin cards name every action with the event it belongs to` löschen (er steht neu in `adminEventTable.test.js`); den Helfer `adminEvent` behalten, solange ein anderer Test ihn nutzt.
- `test/eventForm.test.js`: den Test `the admin card shows every reminder` löschen (die Tabelle zeigt keine Erinnerungen; die Tests zum Feld `#event-reminder` bleiben).
- `test/components.test.js`: den Test `skeleton cards use component classes, no style attributes` löschen.
- `test/cssRules.test.js`: `STYLE_ATTRIBUTE_BUDGET = 113`, `EMOJI_BUDGET = 37`; ans Ende von `MOVED`:

```js
    // Admin cards, replaced by the table (D-07)
    '.admin-event-card', '.admin-event-card .admin-actions', '.series-admin-date-item', '.series-admin-card'
```

- `e2e/tour.spec.js`: `#admin-events-grid .admin-event-card` ersetzen durch `#admin-events-table .data-table tbody tr`.

- [ ] **Step 8: Tests grün**

Run: `npm test 2>&1 | tail -8`
Expected: `# fail 0`. Meldet ein Obergrenzen-Test eine andere Zahl („found N“), die Konstante auf N setzen, sofern N kleiner ist als der alte Wert; ist N größer, steht irgendwo ein neues `style`-Attribut oder Emoji, das weg muss.

Run: `npm run test:e2e 2>&1 | tail -4`
Expected: `40 passed`, `2 skipped`.

Run: `wc -l public/js/admin/*.js`
Expected: jede Datei ≤ 500 Zeilen.

- [ ] **Step 9: Im Browser prüfen**

Mock-Server starten (`PORT=3127 node dev/start.js`, vorher `netstat -ano | grep 3127`), als Admin `#admin` öffnen und bei 1440 px, 800 px und 390 px prüfen:
- alle drei Tabs, Suche („raid“, „xyz“), Sortieren nach jeder Spalte, Serie auf- und zuklappen;
- das Menü der ersten, einer mittleren und der letzten Zeile: liegt vollständig im Fenster und über den Zeilen darunter;
- Titel-Klick öffnet den Assistenten, „Anmeldungen“ den Anmeldungen-Dialog.

Abstände, Spaltenbreiten und Umbrüche in den CSS-Blöcken aus Step 6 und Task 3 nachziehen, bis nichts überlappt (nur Tokens). Nachher-Bilder: `node data/d07/shots.js after` (schreibt `data/d07/after-desktop.png` und `after-mobile.png`); die Seitenlänge am Desktop muss ≤ 1482 px sein.

- [ ] **Step 10: Wiki**

`docs/wiki/modules/frontend-app.md`:
- Zeile `admin/dashboard.js` ersetzen durch:

```markdown
| `admin/dashboard.js` | admin area | `showAdminSection`, `loadAdminStats`, `adminView` (`events`, `tab`, `search`, `sorts`, `expanded`; lives as long as the page), `loadAdminEvents` (placeholder rows only before the first answer, a reload keeps the table until the new one is there), `renderAdminEvents(now)`, `switchAdminTab`, `searchAdminEvents`, `resetAdminSearch`, `sortAdminEvents`, `toggleAdminSeries`, `loadAuditLog`, `showResetModal`, `performSystemReset` |
| `admin/event-table.js` | markup of the admin event table, pure (no DOM) | `renderAdminTabs(counts, activeTab)`, `renderAdminTable(rows, { sort, expanded, now })` (four columns: event with series and state chips, date with distance, places sentence of the API with bar and waitlist, one main action plus a menu; the action names are literal in the `ACTIONS` map), `renderAdminTableSkeleton`, `renderAdminEmpty({ tab, search, counts })`, `renderAdminLoadError` |
```

- Zeile `core/ui.js`: `renderSkeletonEvents` streichen.
- Zeile `admin/wizard.js`: „used for `#event-reminder` and the admin card badge“ → „used for `#event-reminder`“.

`docs/wiki/modules/frontend-markup.md`: in der Tabelle der IDs (dort stehen Navbar und Sections) eine Zeile ergänzen:

```markdown
| Admin events | `#admin-stats`; `.admin-events-toolbar` with `#admin-events-tabs` (tabs Entwürfe · Aktiv · Archiv with counts) and `#admin-events-search`; `#admin-events-table` (table, placeholder rows or empty state, rendered by `admin/event-table.js`) |
```

`docs/wiki/howto/add-event-field.md`, Schritt 6: „admin cards in `loadAdminEvents`“ → „the admin table in `admin/event-table.js`, only when admins need the field in the list“; `public/js/admin/dashboard.js` in der Dateispalte durch `public/js/admin/event-table.js` ersetzen.

`docs/wiki/ops/testing.md`:
- `eventCards.test.js`: „admin and Discord import cards show no raw Markdown“ → „the Discord import list shows no raw Markdown“.
- `eventForm.test.js`: den Teil „, `loadAdminEvents` shows the "24h · 1h" badge“ streichen.
- `actionAttributes.test.js`: „admin cards and registrations“ → „registrations“.
- `components.test.js`: `renderSkeletonEvents` streichen.
- neue Zeile nach `adminEventRows.test.js`:

```markdown
| `adminEventTable.test.js` | the admin table on the page: order and one main action plus one menu per row, "Anmeldungen · 2 offen" as primary button, menu groups with delete only there, tabs/search/sorting/series toggle without a request, unknown tab or sort key ignored, hits per tab and reset, series rows and dates, escaping, events without places/date/title, date and places columns, empty states, load error, reload keeps tab and table, no emojis or style attributes |
```

- im Abschnitt Helpers: `` `test/htmlSource.js`: `elementsWith(html, attribute)`, `actionTargets(html, action)`, `actionElement(target)` and `assertNoInlineHandlers(html)` read rendered HTML strings `` ergänzen.

Run: `grep -rn "admin-event-card\|admin-events-grid\|renderSkeletonEvents\|admin cards" docs/wiki CLAUDE.md`
Expected: kein Treffer.

Run: `npm run wiki && npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 11: Committen**

```bash
git add public test e2e/tour.spec.js docs/wiki
git commit -m "Show the admin events as a table with tabs, search and sorting" -m "Every event card carried up to nine buttons, two of them icon-only, and drafts, active and archived events were mixed in creation order. The table has one row per event or series, one main action that fits the state and a menu for the rest; open requests show on the main action. Tabs, search and sorting work on the loaded list without a request." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBtousiUTyQtMzbEfU9oBs"
```

---

### Task 5: Aktionen fragen über den DEMS-Dialog und melden in Worten

**Files:**
- Modify: `public/js/admin/event-actions.js:1-83` und `:207-284`
- Create: `test/adminEventActions.test.js`
- Wiki: `docs/wiki/modules/frontend-app.md`, `docs/wiki/concepts/event-lifecycle.md`, `docs/wiki/ops/testing.md`

**Interfaces:**
- Consumes: `showConfirmDialog(message, label, { danger })` und das Harness mit `dialogs`/`confirm` aus Task 3; `switchAdminTab(tab)`, `loadAdminEvents()`, `loadAdminStats()` aus `dashboard.js`; die `data-*`-Attribute aus Task 4 (`data-event-title`, `data-channels`, `data-count`).
- Produces: `duplicateEvent(eventId)`, `deleteEvent(eventId, title)`, `deleteEventSeries(seriesId, title, count)`, `changeEventStatus(eventId, status)`, `startEvent(eventId, title)`, `endEvent(eventId, title, hasChannels)`, `syncDiscordEvent(eventId, title)`; keine Browser-Rückfrage mehr in diesem Modul.

- [ ] **Step 1: Aufrufer prüfen**

Run: `grep -rn "deleteEvent(\|deleteEventSeries(\|startEvent(\|endEvent(\|syncDiscordEvent(\|duplicateEvent(\|changeEventStatus(" public/js --include=*.js`
Expected: Treffer nur in `admin/event-actions.js` (Definitionen und `registerActions`). Ruft ein anderes Modul eine der Funktionen auf, dort den Titel mitgeben.

- [ ] **Step 2: Failing tests**

`test/adminEventActions.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, REPO_ROOT } = require('./helpers');

// setImmediate runs after the microtask queue is drained, so the reload an action starts has settled
const settle = () => new Promise(resolve => setImmediate(resolve));

const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };
const STATS = { events: { total: 0, active: 0, draft: 0, archived: 0 }, registrations: { total: 0, pending: 0, accepted: 0, rejected: 0, waitlisted: 0 } };
// Admin-set title with everything that breaks unescaped markup
const TRICKY_TEXT = 'Bob\'s "Raid" & <mehr>';

async function openAdmin(routes = {}, options = {}) {
    const harness = await loadFrontendApp({ '/api/admin/all-events': [], '/api/admin/stats': STATS, ...routes }, options);
    harness.state.currentUser = ADMIN;
    harness.state.csrfToken = 'token';
    return {
        ...harness,
        run: async (action, dataset) => { await harness.app.runAction(action, { dataset }); await settle(); },
        // Requests that change something, in call order
        sent: () => harness.requests.filter(request => request.method !== 'GET').map(request => `${request.method} ${request.url}`)
    };
}

// Every action that asks first
const QUESTIONS = [
    ['deleteEvent', { eventId: 'e1', eventTitle: 'Raid' }],
    ['deleteEventSeries', { seriesId: 's1', eventTitle: 'Raid', count: '3' }],
    ['startEvent', { eventId: 'e1', eventTitle: 'Raid' }],
    ['endEvent', { eventId: 'e1', eventTitle: 'Raid', channels: '1' }],
    ['syncDiscordEvent', { eventId: 'e1', eventTitle: 'Raid' }]
];

test('deleting asks in the DEMS dialog, names the event and reloads the list', async () => {
    const { run, sent, dialogs, toasts, requests } = await openAdmin({ '/api/admin/events/e1': { success: true } });
    await run('deleteEvent', { eventId: 'e1', eventTitle: TRICKY_TEXT });
    assert.deepEqual(dialogs, [{ text: `„${TRICKY_TEXT}“ löschen? Alle Anmeldungen werden mitgelöscht.`, label: 'Löschen', danger: true }]);
    assert.deepEqual(sent(), ['DELETE /api/admin/events/e1']);
    assert.deepEqual(toasts, ['Event gelöscht.']);
    assert.ok(requests.some(request => request.url === '/api/admin/all-events'));
    assert.ok(requests.some(request => request.url === '/api/admin/stats'));
});

test('dismissing the dialog sends nothing', async () => {
    for (const [action, dataset] of QUESTIONS) {
        const { run, sent, dialogs, toasts } = await openAdmin({}, { confirm: false });
        await run(action, dataset);
        assert.equal(dialogs.length, 1, action);
        assert.deepEqual(sent(), [], action);
        assert.deepEqual(toasts, [], action);
    }
});

test('each question says what happens and which button confirms', async () => {
    const { run, sent, dialogs, toasts } = await openAdmin({
        '/api/admin/events/series/s1': { deletedCount: 3 },
        '/api/admin/events/e1/start': { success: true },
        '/api/admin/events/e1/end': { success: true },
        '/api/admin/events/e1/sync-discord': { success: true }
    });
    await run('deleteEventSeries', { seriesId: 's1', eventTitle: 'Training', count: '3' });
    await run('startEvent', { eventId: 'e1', eventTitle: 'Spontan' });
    await run('endEvent', { eventId: 'e1', eventTitle: 'Marathon', channels: '1' });
    await run('endEvent', { eventId: 'e1', eventTitle: 'Marathon', channels: '' });
    await run('syncDiscordEvent', { eventId: 'e1', eventTitle: 'Raid' });
    assert.deepEqual(dialogs, [
        { text: 'Ganze Serie „Training“ löschen? Alle 3 Termine und ihre Anmeldungen werden gelöscht.', label: 'Serie löschen', danger: true },
        { text: '„Spontan“ jetzt starten? Das Event wird veröffentlicht, als Start wird jetzt eingetragen.', label: 'Starten', danger: false },
        { text: '„Marathon“ jetzt beenden? Das Event wird archiviert, als Ende wird jetzt eingetragen. Die Event-Channels werden gelöscht.', label: 'Beenden', danger: true },
        { text: '„Marathon“ jetzt beenden? Das Event wird archiviert, als Ende wird jetzt eingetragen.', label: 'Beenden', danger: true },
        { text: '„Raid“ als geplantes Event in Discord eintragen?', label: 'Eintragen', danger: false }
    ]);
    assert.deepEqual(sent(), [
        'DELETE /api/admin/events/series/s1', 'POST /api/admin/events/e1/start', 'POST /api/admin/events/e1/end',
        'POST /api/admin/events/e1/end', 'POST /api/admin/events/e1/sync-discord'
    ]);
    assert.deepEqual(toasts, ['Serie gelöscht (3 Termine).', 'Event gestartet.', 'Event beendet.', 'Event beendet.', 'Event in Discord eingetragen.']);
});

test('a series with one date or an unknown number is asked about correctly', async () => {
    const { run, dialogs } = await openAdmin({}, { confirm: false });
    await run('deleteEventSeries', { seriesId: 's1', eventTitle: 'Kurs', count: '1' });
    await run('deleteEventSeries', { seriesId: 's1', eventTitle: 'Kurs' });
    await run('deleteEvent', { eventId: 'e1' });
    assert.deepEqual(dialogs.map(dialog => dialog.text), [
        'Ganze Serie „Kurs“ löschen? Ihr Termin und seine Anmeldungen werden gelöscht.',
        'Ganze Serie „Kurs“ löschen? Alle Termine und ihre Anmeldungen werden gelöscht.',
        '„Event“ löschen? Alle Anmeldungen werden mitgelöscht.'
    ]);
});

test('status changes need no question and say where the event is now', async () => {
    const { run, dialogs, toasts, requests } = await openAdmin({ '/api/admin/events/e1/status': { id: 'e1' } });
    for (const status of ['active', 'draft', 'archived']) await run('changeEventStatus', { eventId: 'e1', status });
    const changes = requests.filter(request => request.method === 'PUT');
    assert.deepEqual(dialogs, []);
    assert.deepEqual(toasts, ['Event ist jetzt aktiv.', 'Event liegt jetzt in den Entwürfen.', 'Event archiviert.']);
    assert.deepEqual(changes.map(request => JSON.parse(request.body).status), ['active', 'draft', 'archived']);
    assert.ok(changes.every(request => request.headers['X-CSRF-TOKEN'] === 'token'));
});

test('a refused action shows the reason of the server and no success', async () => {
    // No routes: every request answers 404 { error: 'Nicht gefunden' }
    const { run, toasts, requests } = await openAdmin();
    await run('deleteEvent', { eventId: 'gone', eventTitle: 'Raid' });
    await run('deleteEventSeries', { seriesId: 'gone', eventTitle: 'Raid', count: '2' });
    await run('changeEventStatus', { eventId: 'gone', status: 'archived' });
    await run('duplicateEvent', { eventId: 'gone' });
    await run('startEvent', { eventId: 'gone', eventTitle: 'Raid' });
    assert.deepEqual(toasts, ['Nicht gefunden', 'Nicht gefunden', 'Nicht gefunden', 'Nicht gefunden', 'Nicht gefunden']);
    // Nothing changed, so the list is not loaded again
    assert.ok(!requests.some(request => request.url === '/api/admin/all-events'));
});

test('duplicating shows the copy among the drafts', async () => {
    const copy = {
        id: 'copy', title: 'Raid (Kopie)', status: 'draft', startDate: '',
        places: { taken: 0, capacity: 0, guests: 0, pending: 0, waitlist: 0, text: '0 Plätze belegt', waitlistText: '' }
    };
    const { app, run, element, dialogs, toasts } = await openAdmin({
        '/api/admin/all-events': [copy],
        '/api/admin/events/e1/duplicate': { id: 'copy', title: 'Raid (Kopie)' }
    });
    await app.loadAdminEvents();
    await run('duplicateEvent', { eventId: 'e1' });
    assert.deepEqual(dialogs, []);
    assert.deepEqual(toasts, ['Kopie liegt in den Entwürfen: Raid (Kopie)']);
    assert.match(element('admin-events-tabs').innerHTML, /class="nav-link active"[^>]*data-tab="drafts"/);
    assert.match(element('admin-events-table').innerHTML, />Raid \(Kopie\)</);
});

test('the event actions never ask through the browser dialog', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'admin', 'event-actions.js'), 'utf8');
    assert.doesNotMatch(source, /(?<![\w.])confirm\(/);
});
```

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/adminEventActions.test.js 2>&1 | tail -14`
Expected: FAIL (`confirm is not defined` bzw. falsche Texte; der Quelltext-Test findet `confirm(`).

- [ ] **Step 3: `event-actions.js` umschreiben**

Kopfkommentar, Imports und die Funktionen `duplicateEvent`, `deleteEvent`, `deleteEventSeries`, `changeEventStatus` (oberer Teil der Datei) sowie `startEvent`, `endEvent`, `syncDiscordEvent` und die Registrierung (unterer Teil) ersetzen. `renderAnnounceButtonsPreview`, `announceEvent`, `sendAnnouncement` und `exportRegistrations` bleiben unverändert.

```js
/**
 * Admin actions on one event: status, delete, announce, start/end, export,
 * duplicate, Discord entry. Actions that destroy something or show up in
 * Discord ask first, in the DEMS confirm dialog.
 */
import { state } from '../core/state.js';
import { loadAdminEvents, loadAdminStats, switchAdminTab } from './dashboard.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showConfirmDialog, showToast } from '../core/ui.js';
import { DISCORD_MODAL_MAX_FIELDS } from '../events/registration-form.js';

// Toast after a status change, by the status the event has now
const STATUS_TOASTS = {
    active: 'Event ist jetzt aktiv.',
    draft: 'Event liegt jetzt in den Entwürfen.',
    archived: 'Event archiviert.'
};

/**
 * Send one admin request; an error ends in a toast with the server's reason.
 *
 * @param {string} method -> HTTP method.
 * @param {string} url -> API path.
 * @param {string} fallbackError -> Shown when the server names no reason.
 * @param {Object} [body] -> JSON body.
 * @returns {Promise<Object|null>} -> The answer, or null after an error.
 */
async function sendAdminAction(method, url, fallbackError, body) {
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data || {};
        showToast(data.error || fallbackError, 'danger');
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
    return null;
}

function refreshAdminEvents() {
    loadAdminEvents();
    loadAdminStats();
}

const quoted = (title) => `„${title || 'Event'}“`;

export async function duplicateEvent(eventId) {
    const data = await sendAdminAction('POST', `/api/admin/events/${eventId}/duplicate`, 'Fehler beim Duplizieren.');
    if (!data) return;
    showToast(`Kopie liegt in den Entwürfen: ${data.title}`, 'success');
    // The copy is a draft, so the table shows that tab
    switchAdminTab('drafts');
    refreshAdminEvents();
}

export async function deleteEvent(eventId, title) {
    if (!await showConfirmDialog(`${quoted(title)} löschen? Alle Anmeldungen werden mitgelöscht.`, 'Löschen')) return;
    if (!await sendAdminAction('DELETE', `/api/admin/events/${eventId}`, 'Fehler beim Löschen.')) return;
    showToast('Event gelöscht.', 'success');
    refreshAdminEvents();
}

/**
 * Delete all dates of a series.
 *
 * @param {string} seriesId -> Id of the series.
 * @param {string} title -> Title of the series, for the question.
 * @param {string|number} count -> Number of its dates over all tabs; unknown values leave the number out.
 * @returns {Promise<void>}
 */
export async function deleteEventSeries(seriesId, title, count) {
    const total = Number(count) || 0;
    let scope = 'Alle Termine und ihre Anmeldungen werden gelöscht.';
    if (total === 1) scope = 'Ihr Termin und seine Anmeldungen werden gelöscht.';
    else if (total > 1) scope = `Alle ${total} Termine und ihre Anmeldungen werden gelöscht.`;
    if (!await showConfirmDialog(`Ganze Serie ${quoted(title)} löschen? ${scope}`, 'Serie löschen')) return;
    const data = await sendAdminAction('DELETE', `/api/admin/events/series/${seriesId}`, 'Fehler beim Löschen der Serie.');
    if (!data) return;
    const deleted = Number(data.deletedCount) || 0;
    showToast(`Serie gelöscht (${deleted} ${deleted === 1 ? 'Termin' : 'Termine'}).`, 'success');
    refreshAdminEvents();
}

export async function changeEventStatus(eventId, status) {
    if (!await sendAdminAction('PUT', `/api/admin/events/${eventId}/status`, 'Fehler beim Ändern des Status.', { status })) return;
    showToast(Object.hasOwn(STATUS_TOASTS, status) ? STATUS_TOASTS[status] : 'Status geändert.', 'success');
    refreshAdminEvents();
}
```

```js
export async function startEvent(eventId, title) {
    const question = `${quoted(title)} jetzt starten? Das Event wird veröffentlicht, als Start wird jetzt eingetragen.`;
    if (!await showConfirmDialog(question, 'Starten', { danger: false })) return;
    if (!await sendAdminAction('POST', `/api/admin/events/${eventId}/start`, 'Fehler beim Starten.')) return;
    showToast('Event gestartet.', 'success');
    refreshAdminEvents();
}

/**
 * End a running event now.
 *
 * @param {string} eventId -> Event id.
 * @param {string} title -> Title, for the question.
 * @param {boolean} [hasChannels] -> The event has its own Discord channels, which ending deletes.
 * @returns {Promise<void>}
 */
export async function endEvent(eventId, title, hasChannels = false) {
    const channels = hasChannels ? ' Die Event-Channels werden gelöscht.' : '';
    const question = `${quoted(title)} jetzt beenden? Das Event wird archiviert, als Ende wird jetzt eingetragen.${channels}`;
    if (!await showConfirmDialog(question, 'Beenden')) return;
    if (!await sendAdminAction('POST', `/api/admin/events/${eventId}/end`, 'Fehler beim Beenden.')) return;
    showToast('Event beendet.', 'success');
    refreshAdminEvents();
}

export function exportRegistrations(eventId) {
    window.open(`/api/admin/events/${eventId}/registrations/export`, '_blank');
}

export async function syncDiscordEvent(eventId, title) {
    if (!await showConfirmDialog(`${quoted(title)} als geplantes Event in Discord eintragen?`, 'Eintragen', { danger: false })) return;
    if (!await sendAdminAction('POST', `/api/admin/events/${eventId}/sync-discord`, 'Fehler beim Eintragen in Discord.')) return;
    showToast('Event in Discord eingetragen.', 'success');
    loadAdminEvents();
}

registerActions({
    deleteEvent: (el) => deleteEvent(el.dataset.eventId, el.dataset.eventTitle),
    deleteEventSeries: (el) => deleteEventSeries(el.dataset.seriesId, el.dataset.eventTitle, el.dataset.count),
    changeEventStatus: (el) => changeEventStatus(el.dataset.eventId, el.dataset.status),
    announceEvent: (el) => announceEvent(el.dataset.eventId),
    sendAnnouncement: () => sendAnnouncement(),
    startEvent: (el) => startEvent(el.dataset.eventId, el.dataset.eventTitle),
    endEvent: (el) => endEvent(el.dataset.eventId, el.dataset.eventTitle, el.dataset.channels === '1'),
    exportRegistrations: (el) => exportRegistrations(el.dataset.eventId),
    duplicateEvent: (el) => duplicateEvent(el.dataset.eventId),
    syncDiscordEvent: (el) => syncDiscordEvent(el.dataset.eventId, el.dataset.eventTitle)
});
```

- [ ] **Step 4: Tests grün**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/adminEventActions.test.js 2>&1 | tail -8`
Expected: `# pass 8`, `# fail 0`.

Run: `npm test 2>&1 | tail -6 && npm run test:e2e 2>&1 | tail -4`
Expected: `# fail 0`; `40 passed`, `2 skipped`.

- [ ] **Step 5: Im Browser prüfen**

Im Mock-Modus als Admin unter `#admin`: Entwurf veröffentlichen, zurück in Entwürfe, archivieren, wieder aktivieren, duplizieren (Tabelle wechselt in „Entwürfe“), die Kopie löschen (erst Abbrechen, dann Löschen), das laufende Event beenden (Dialog nennt das Ende), „In Discord eintragen“ (blauer Button im Dialog). Kein Browser-Fenster darf erscheinen.

- [ ] **Step 6: Wiki**

`docs/wiki/modules/frontend-app.md`, Zeile `admin/event-actions.js` ersetzen durch:

```markdown
| `admin/event-actions.js` | actions on one event | `changeEventStatus(id, status)` (toast per new status), `deleteEvent(id, title)`, `deleteEventSeries(seriesId, title, count)`, `duplicateEvent(id)` (switches the table to the drafts), `startEvent(id, title)`, `endEvent(id, title, hasChannels)`, `syncDiscordEvent(id, title)`, `exportRegistrations`, `announceEvent`, `renderAnnounceButtonsPreview`, `sendAnnouncement`. Delete, series delete, start, end and the Discord entry ask through `showConfirmDialog` with the event title; a server error ends in a toast with its `error` and no reload |
```

`docs/wiki/concepts/event-lifecycle.md`, nach der Tabelle „Statuses and transitions“ einfügen:

```markdown
The admin table names these actions by what they do (`admin/event-rows.js` decides which a row offers): "Veröffentlichen" and "Wieder aktivieren" send `PUT …/status` with `active`, "Zurück in Entwürfe" with `draft`, "Archivieren" with `archived`. "Jetzt starten …" (`POST …/start`) is only offered for a draft without a start date, "Jetzt beenden …" (`POST …/end`) only while the event runs, because it writes the end date. `cancel` has no button; cancelled events show in the archive tab with the chip "Abgesagt".
```

`docs/wiki/ops/testing.md`, neue Zeile nach `adminEventTable.test.js`:

```markdown
| `adminEventActions.test.js` | admin actions: each question in the confirm dialog (text with the title, button label, red or primary), dismissing sends nothing, status changes without a question and with a toast per status, a refused request shows the server's reason and reloads nothing, duplicating switches to the drafts, no `confirm(` in the module |
```

Run: `npm run wiki && npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 7: Committen**

```bash
git add public/js/admin/event-actions.js test/adminEventActions.test.js docs/wiki
git commit -m "Ask in the DEMS dialog before an admin action that cannot be undone" -m "Six event actions asked through the browser's confirm window, deleting reported success even when the server refused, and status changes answered with 'Status geändert: Aktiv'. Questions now name the event and say what happens, a refused request shows the server's reason, and each status change says where the event is now. Duplicating needs no question any more and shows the copy among the drafts." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBtousiUTyQtMzbEfU9oBs"
```

---

### Task 6: Browser-Tests und Abschluss

**Files:**
- Create: `e2e/admin.spec.js`
- Wiki: `docs/wiki/ops/testing.md`

**Interfaces:**
- Consumes: `watchErrors`, `loginAs`, `navigate`, `waitForDialog` aus `e2e/helpers.js`; Dummy-Events aus `dev/seedData.js` („Live: Speedrun-Marathon“ läuft, „Retro-Spieleabend“ ist vorbei, „Wöchentliches Training“ ist eine Serie, „Entwurf: Halloween-Special“ ist ein Entwurf, „Sommerfest“ ist archiviert, „Turnier: Arena-Cup“ hat zwei offene Anfragen).
- Produces: Browser-Tests der Tabelle; Vorher-Nachher-Bilder und Zahlen für die Merge-Request-Beschreibung.

- [ ] **Step 1: `e2e/admin.spec.js` schreiben**

Desktop und Handy laufen gleichzeitig gegen dieselbe Datenbank. Tests, die etwas ändern, legen deshalb ihr eigenes Event an und räumen es wieder weg; die Dummy-Events bleiben unberührt.

```js
/**
 * Admin dashboard (D-07): the event table with tabs, search, sorting, series
 * rows, one main action and a menu per row. Seed data: dev/seedData.js (dev
 * mock mode). Desktop and phone share one database, so tests that change
 * something create their own event.
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, navigate, waitForDialog } = require('./helpers');

const rows = (page) => page.locator('#admin-events-table .data-table tbody tr');
const row = (page, title) => rows(page).filter({ hasText: title });
const tab = (page, label) => page.locator('#admin-events-tabs .nav-link', { hasText: label });
const toast = (page) => page.locator('#app-toast');

async function openAdmin(page) {
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    await expect(rows(page).first()).toBeVisible();
}

/** Send an admin request from the page, with the CSRF token of its session. */
async function adminRequest(page, method, path, body) {
    return page.evaluate(async ([requestMethod, requestPath, requestBody]) => {
        const { token } = await (await fetch('/api/csrf-token')).json();
        const res = await fetch(requestPath, {
            method: requestMethod,
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token },
            body: requestBody ? JSON.stringify(requestBody) : undefined
        });
        return res.json();
    }, [method, path, body]);
}

/** Create an event of this test; the title is unique per project and run. */
async function createEvent(page, testInfo, fields = {}) {
    const title = `E2E ${testInfo.project.name} ${testInfo.title.slice(0, 20)} ${Date.now()}`;
    const created = await adminRequest(page, 'POST', '/api/admin/events', { title, status: 'draft', accessMode: 'open', approvalMode: 'instant', ...fields });
    return { id: created.id, title };
}

test('the tabs sort the events by status', async ({ page }) => {
    const errors = watchErrors(page);
    await openAdmin(page);
    await expect(tab(page, 'Aktiv')).toHaveClass(/\bactive\b/);
    await expect(rows(page).first()).toContainText('Live: Speedrun-Marathon');
    await expect(rows(page).first()).toContainText('Läuft gerade');
    await expect(row(page, 'Turnier: Arena-Cup').locator('.btn-primary')).toHaveText(/Anmeldungen · 2 offen/);
    const past = row(page, 'Retro-Spieleabend');
    await expect(past).toContainText('Vorbei');
    await expect(past.locator('.data-table-buttons > .btn')).toHaveText(/Archivieren/);
    await expect(page.locator('#admin-events-table')).not.toContainText('Sommerfest');

    await tab(page, 'Entwürfe').click();
    await expect(row(page, 'Entwurf: Halloween-Special').locator('.data-table-buttons > .btn')).toHaveText(/Veröffentlichen/);
    await tab(page, 'Archiv').click();
    await expect(row(page, 'Sommerfest')).toBeVisible();
    expect(errors).toEqual([]);
});

test('search and sorting work on the loaded list', async ({ page }, testInfo) => {
    let listRequests = 0;
    page.on('request', request => { if (request.url().endsWith('/api/admin/all-events')) listRequests += 1; });
    await openAdmin(page);

    await page.locator('#admin-events-search').fill('raid');
    await expect(row(page, 'Raid: Schattenfestung')).toBeVisible();
    await expect(page.locator('#admin-events-table')).not.toContainText('Community-Spieleabend');
    await page.locator('#admin-events-search').fill('sommerfest');
    await expect(page.locator('#admin-events-table')).toContainText('Keine Treffer');
    await expect(page.locator('#admin-events-table')).toContainText('Archiv 1');
    await page.locator('[data-click="resetAdminSearch"]').click();
    await expect(page.locator('#admin-events-search')).toHaveValue('');
    await expect(row(page, 'Community-Spieleabend')).toBeVisible();

    // The heads are only reachable on the desktop; the phone keeps the default order
    if (testInfo.project.name === 'desktop') {
        const head = page.locator('#admin-events-table th', { hasText: 'Event' });
        await head.locator('.data-table-sort').click();
        await expect(head).toHaveAttribute('aria-sort', 'ascending');
        await expect(rows(page).first()).toContainText('Community-Spieleabend');
        await head.locator('.data-table-sort').click();
        await expect(head).toHaveAttribute('aria-sort', 'descending');
    }
    expect(listRequests).toBe(1);
});

test('a series opens its dates', async ({ page }) => {
    await openAdmin(page);
    const series = row(page, 'Wöchentliches Training');
    await expect(series).toContainText(/Serie · \d Termine/);
    await expect(page.locator('#admin-events-table tr.is-sub')).toHaveCount(0);
    await series.locator('[data-click="toggleAdminSeries"]').click();
    await expect(page.locator('#admin-events-table tr.is-sub').first()).toContainText('Termin 1 von');
    await page.locator('[data-click="toggleAdminSeries"]').click();
    await expect(page.locator('#admin-events-table tr.is-sub')).toHaveCount(0);
});

test('the menu opens above the rows and stays inside the window', async ({ page }) => {
    await openAdmin(page);
    const first = rows(page).first();
    await first.locator('[data-bs-toggle="dropdown"]').click();
    const menu = first.locator('.dropdown-menu.show');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.dropdown-item').last()).toHaveText(/Löschen …/);
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    // Every entry can be hit: no following row lies on top of the menu
    for (const item of await menu.locator('.dropdown-item').all()) {
        await item.scrollIntoViewIfNeeded();
        const onTop = await item.evaluate(element => {
            const itemBox = element.getBoundingClientRect();
            const hit = document.elementFromPoint(itemBox.left + itemBox.width / 2, itemBox.top + itemBox.height / 2);
            return element === hit || element.contains(hit);
        });
        expect(onTop).toBe(true);
    }
});

test('a draft is published, then deleted through the menu and the dialog', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    const { title } = await createEvent(page, testInfo);
    await navigate(page, 'admin');
    await tab(page, 'Entwürfe').click();
    await row(page, title).locator('.data-table-buttons > .btn').click();
    await expect(toast(page)).toContainText('Event ist jetzt aktiv.');
    await expect(row(page, title)).toHaveCount(0);

    await tab(page, 'Aktiv').click();
    const published = row(page, title);
    await expect(published.locator('.data-table-buttons > .btn')).toHaveText(/Anmeldungen/);

    // Dismissing the dialog keeps the event
    await published.locator('[data-bs-toggle="dropdown"]').click();
    await published.locator('.dropdown-item.is-danger').click();
    const dialog = await waitForDialog(page, '#confirmModal');
    await expect(dialog).toContainText(title);
    await dialog.locator('[data-bs-dismiss="modal"]').click();
    await expect(dialog).toBeHidden();
    await expect(published).toBeVisible();

    await published.locator('[data-bs-toggle="dropdown"]').click();
    await published.locator('.dropdown-item.is-danger').click();
    await waitForDialog(page, '#confirmModal');
    await page.locator('#confirm-modal-ok').click();
    await expect(toast(page)).toContainText('Event gelöscht.');
    await expect(row(page, title)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('a cancelled event shows in the archive', async ({ page }, testInfo) => {
    await loginAs(page, 'admin');
    const { id, title } = await createEvent(page, testInfo);
    await adminRequest(page, 'PUT', `/api/admin/events/${id}/status`, { status: 'cancelled' });
    await navigate(page, 'admin');
    await tab(page, 'Archiv').click();
    await expect(row(page, title)).toContainText('Abgesagt');
    await adminRequest(page, 'DELETE', `/api/admin/events/${id}`);
});

test('the desktop shows compact rows with one main action', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
    await openAdmin(page);
    const heights = await rows(page).evaluateAll(list => list.map(element => element.getBoundingClientRect().height));
    // Two lines of text plus the bar; a card of the old dashboard was about 500 px tall
    expect(Math.max(...heights)).toBeLessThanOrEqual(110);
    for (const tableRow of await rows(page).all()) {
        await expect(tableRow.locator('.data-table-buttons > .btn')).toHaveCount(1);
        await expect(tableRow.locator('[data-bs-toggle="dropdown"]')).toHaveCount(1);
    }
});

test('the phone stacks the rows and nothing sticks out', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone layout');
    await openAdmin(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const first = rows(page).first();
    const title = await first.locator('.data-table-title').boundingBox();
    const actions = await first.locator('.data-table-buttons').boundingBox();
    expect(actions.y).toBeGreaterThan(title.y + title.height);
});
```

- [ ] **Step 2: Browser-Tests laufen lassen**

Run: `npm run test:e2e 2>&1 | tail -6`
Expected: `54 passed`, `4 skipped` (40 + 2 von vorher, dazu 8 neue Tests mal zwei Viewports: 14 laufen, 2 werden übersprungen). Schlägt ein Test fehl, liegt der Fehler in Markup oder CSS aus Task 3 bis 5 und wird dort behoben, nicht im Test abgeschwächt.

- [ ] **Step 3: Vorher-Nachher**

Run: `node data/d07/shots.js after`
Danach `data/d07/after-desktop.png` und `data/d07/after-mobile.png` ansehen und die Höhen notieren (vorher 2964 px bzw. 6780 px). Erwartet am Desktop: höchstens 1482 px.

- [ ] **Step 4: Erfolgskriterien der Spec abhaken**

Run: `grep -c "confirm(" public/js/admin/event-actions.js; wc -l public/js/admin/*.js; grep -n "STYLE_ATTRIBUTE_BUDGET =\|EMOJI_BUDGET =" test/cssRules.test.js`
Expected: `0`; jede Datei ≤ 500 Zeilen; Obergrenzen 113 und 37 (oder niedriger).

Run: `git diff origin/main --stat -- package.json package-lock.json`
Expected: leer (keine neue Abhängigkeit).

- [ ] **Step 5: Wiki**

`docs/wiki/ops/testing.md`:
- im Abschnitt „Browser smoke tests“ nach der Zeile zu `e2e/events.spec.js` einfügen:

```markdown
- `e2e/admin.spec.js`: the admin table of D-07 — tabs by status with the running event first, "Anmeldungen · 2 offen" and "Archivieren" for the past event; search with hit counts and reset, sorting by a head, both without a second request; a series opens its dates; the menu lies inside the window and above the following rows; a draft of the test is published and deleted through the menu and the confirm dialog (dismissed once); a cancelled event shows "Abgesagt" in the archive; compact rows on 1440 px, stacked rows without sideways scrolling on 390 px. Tests that change data create their own event, because desktop and phone share the database.
```

- `e2e/admin.spec.js`, `test/htmlSource.js`, `test/adminEventRows.test.js`, `test/adminEventTable.test.js` und `test/adminEventActions.test.js` in die `sources` der Seite aufnehmen.
- im Satz zu `e2e/tour.spec.js` bleibt „admin also admin area“ richtig; nichts zu ändern.

Run: `npm run wiki && npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 6: Committen**

```bash
git add e2e/admin.spec.js docs/wiki
git commit -m "Check the admin table in the browser on phone and desktop" -m "The unit tests read markup strings; whether the menu really opens above the following rows, the dialog asks before deleting and the rows stack on a phone only shows in a browser." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBtousiUTyQtMzbEfU9oBs"
```

- [ ] **Step 7: Abschluss**

Abschluss-Review durch einen frischen Reviewer über `git diff $(git merge-base origin/main HEAD)..HEAD` mit Spec und Plan; Befunde beheben und committen. Danach die Merge-Request-Beschreibung (deutsch: Problem / Ursache / Änderung / Verifikation, Zuordnung alt → neu der Buttons, Vorher-Nachher-Zahlen, `Closes #56`) nach `data/d07/mr.md` schreiben und vor dem Pushen nachfragen.

