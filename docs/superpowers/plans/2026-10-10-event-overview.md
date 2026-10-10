# Event-Übersicht neu (D-04) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Event-Übersicht zeigt nur kommende und laufende Events als kompakte Karten (Handy: Zeile mit Datums-Kachel und breitem Banner-Vorschaubild, Desktop: Kacheln mit Banner oben in drei Spalten), mit Plätze-Balken und eigener Markierung; Kategorie und Suche filtern im Browser.

**Architecture:**
1. Server: ein reines Modul `utils/eventListing.js` (Laufzeit-Regel, `myRegistrationStatus`) speist `GET /api/events?upcoming=1` und das neue Feld `myStatus`; der Bot-Status nutzt dieselbe Regel. `GET /api/events/categories` entfällt.
2. Frontend: `events/cards.js` rendert Karten als reine Funktionen (testbar ohne DOM); `events/list.js` lädt einmal, filtert im Browser und rendert; `events/calendar.js` lädt für den Kalender alle Events selbst; der Countdown zieht nach `events/detail.js`.
3. Komponenten: Datums-Kachel (`.date-tile`) und Plätze-Balken (`.capacity`, ein `<progress>`) kommen nach `components.css` und in den Styleguide; die Karte ersetzt den Block EVENT CARDS in `style.css`.
4. Dummy-Daten: SVG-Banner aus `dev/banners/` (nur im Mock-Modus unter `/dev-banners/`) und zwei Anmeldungen für Tom, damit alle Markierungen zu sehen sind.

**Tech Stack:** Node.js ≥ 22, Express 5, Vanilla-JS-SPA (native ES-Module, kein Build), Bootstrap 5.3.2 + Bootstrap Icons aus `public/vendor/`, `node:test` + `node:vm` (`--experimental-vm-modules`), Playwright 1.63.0 (`npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-10-10-event-overview-design.md`

**Branch:** `53-d-04-event-ubersicht-neu` (Ticket #53), von `main` nach dem Merge von D-02.

## Global Constraints

- Kein Build-Schritt, keine neue npm-Abhängigkeit, kein TypeScript.
- Alles, was Nutzer sehen, auf Deutsch; Code, Kommentare, Commits und Wiki auf Englisch.
- Symbole sind Bootstrap Icons (`bi-*`), nie Emojis. Ausnahme: Emojis, die Nutzer eingeben (z. B. Slot-Emojis).
- Neuer Code enthält kein `style="…"`-Attribut; dynamische Werte setzt JS per `element.style.setProperty`.
- In `components.css` und `style.css` keine Farbwerte, keine Schriftgröße in px/rem, kein `z-index` ab 10, kein Radius in px; jede `var(--x)` ist ein Token oder in den Stylesheets definiert (`test/cssRules.test.js`).
- Aktionsnamen stehen wörtlich im Markup (`data-click="name"`); jeder eingesetzte Wert geht durch `escapeHtml(...)`; Banner-Adressen nur über `isValidBannerUrl`.
- Module führen beim Laden nur `import`/`export`, Deklarationen und `registerActions(...)` aus (keine Funktionsaufrufe in `const`-Initialisierern); höchstens ~500 Zeilen.
- Exportnamen sind über alle Frontend-Module eindeutig (`loadFrontendApp` legt alle Exporte in ein Objekt).
- Datenzugriff nur über `firebaseAdmin.js`; `checkinCode` erscheint in keiner Event-Antwort.
- Laufzeit-Regel überall gleich: Ende = `endDate`, sonst Start + 2 Stunden.
- Jeder Commit ist grün: `npm test` und `npm run test:e2e`.
- Commit-Texte: englischer Imperativ als Betreff, das Warum im Text; kein `#<Zahl>` außer echten Ticket-Verweisen. Commits enden mit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- Wiki: Jeder Task korrigiert im selben Commit die Wiki-Aussagen, die er falsch macht, danach `npm run wiki`.
- Einmal-Skripte und Screenshots liegen in `data/d04/` (per `.gitignore` ausgeschlossen) und werden nie committet.

## Review Focus

1. **Events ohne oder mit seltsamem Datum:** kein `endDate`, `startDate` mit Leerzeichen statt `T`, kein `startDate`, ungültiges Datum. Erwartung: Ende = Start + 2 h; ohne gültigen Start gilt das Event als kommend, die Karte zeigt „Termin folgt“ und eine leere Kachel statt abzustürzen. Tests in Task 1 und Task 4.
2. **Status-Randfälle:** Gast in einer abgelehnten oder wartenden Anmeldung, eigene Anmeldung abgelehnt, `myStatus` mit unbekanntem Wert (`'constructor'`, `'__proto__'`). Erwartung: keine Markierung. Tests in Task 1 und Task 4.
3. **Admin-Texte mit HTML und Anführungszeichen:** Titel, Kategorie, Banner-Adresse mit `"`, `<`, `'`; ungültige `accentColor`; `#rgb`-Farbe. Erwartung: alles escaped, Kategorie-Filter trifft den exakten Text, Farbe fällt auf den Verlauf zurück bzw. wird zu `#rrggbb` erweitert. Tests in Task 4 und Task 6.
4. **Gewählte Kategorie verschwindet** (nach erneutem Öffnen gibt es dort kein kommendes Event mehr). Erwartung: Filter springt auf „Alle“, keine leere Liste ohne Ausweg. Test in Task 6.
5. **Mitternacht und Sommerzeit bei „Heute/Morgen“:** 23:30 heute, 00:30 morgen, Zeitumstellung Ende Oktober, 13/14 Tage. Erwartung: Kalendertage in Browser-Zeit, kein „in 1 Tagen“. Tests in Task 4.

## Dateien

| Datei | Aufgabe | Task |
|---|---|---|
| `.gitignore` | `.superpowers/` ausschließen | 0 |
| `utils/eventListing.js` (neu) | `eventEndTime`, `isEventOver`, `myRegistrationStatus` | 1 |
| `test/eventListing.test.js` (neu) | Laufzeit-Regel, eigener Status | 1 |
| `bot.js` | Auto-Status nutzt `isEventOver` | 1 |
| `routes/events.js` | `?upcoming=1`, `myStatus` (2); `/categories` entfällt (6) | 2, 6 |
| `dev/seedData.js` | Toms Anmeldungen (2); Banner (3) | 2, 3 |
| `dev/banners/*.svg` (neu) | neun Dummy-Banner | 3 |
| `server.js` | `/dev-banners` nur im Mock-Modus | 3 |
| `test/devServer.test.js`, `test/seed.test.js`, `test/noMock.test.js` | API, Dummy-Daten, Banner-Route | 2, 3, 6 |
| `public/js/events/cards.js` (neu) | Karten als reine Funktionen | 4 |
| `public/css/components.css` | DATE TILE, CAPACITY | 4 |
| `public/js/pages/debug-components.js` | Styleguide-Blöcke `date-tile`, `capacity` | 4 |
| `public/js/events/calendar.js` (neu) | Kalender lädt selbst | 5 |
| `public/js/events/detail.js` | übernimmt den Countdown | 5 |
| `public/js/events/list.js` | Übersicht neu | 5, 6 |
| `public/index.html` | Kopf der Übersicht | 6 |
| `public/css/style.css` | EVENT CARDS neu, alte Übersichtsregeln weg | 4, 5, 6 |
| `test/eventCards.test.js`, `test/eventCalendar.test.js` (neu), `test/actionAttributes.test.js`, `test/startup.test.js`, `test/styleguide.test.js`, `test/cssRules.test.js` | Frontend-Tests | 4–7 |
| `e2e/tour.spec.js`, `e2e/styleguide.spec.js`, `e2e/events.spec.js` (neu) | Browser-Tests | 4, 6, 8 |
| Wiki, `CLAUDE.md` | Doku | 1–8 |

---

### Task 0: Ausgangslage, Spec und Plan committen, Vorher-Screenshots

**Files:**
- Modify: `.gitignore`
- Create: `data/d04/shots.js` (nicht im Repo)
- Commit: Spec, Plan, `.gitignore`

- [ ] **Step 1: Branch prüfen**

```bash
git switch 53-d-04-event-ubersicht-neu
git log --oneline -1
git status --short
```
Expected: HEAD ist der Merge von D-02 (`Merge branch '51-d-02-…' into 'main'`); unversioniert nur `.superpowers/`, `docs/superpowers/specs/2026-10-10-event-overview-design.md`, `docs/superpowers/plans/2026-10-10-event-overview.md`.

- [ ] **Step 2: Ausgangslage ist grün**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -4
```
Expected: `# fail 0`; Playwright `24 passed`.

- [ ] **Step 3: Screenshot-Skript anlegen**

`data/d04/shots.js`:
```js
// Screenshots of the events overview in mock mode (own port, fresh database),
// for the before/after comparison in the merge request. Not part of the repo.
// Usage (from the repo root): node data/d04/shots.js <name>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');

const REPO = path.join(__dirname, '..', '..');
const { version } = require(path.join(REPO, 'updates.json'));
const PORT = 3125;
const BASE = `http://localhost:${PORT}`;
const VIEWPORTS = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

async function waitForServer() {
    for (let i = 0; i < 240; i++) {
        if (await fetch(`${BASE}/healthz`).then(res => res.ok, () => false)) return;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('mock server did not start');
}

(async () => {
    const name = process.argv[2] || 'shot';
    const dbPath = path.join(os.tmpdir(), `dems-d04-${Date.now()}.sqlite`);
    const server = spawn(process.execPath, ['dev/start.js'], { cwd: REPO, env: { ...process.env, PORT: String(PORT), DEV_SQLITE_PATH: dbPath }, stdio: 'ignore' });
    const browser = await chromium.launch();
    try {
        await waitForServer();
        for (const [label, viewport] of Object.entries(VIEWPORTS)) {
            const context = await browser.newContext({ viewport });
            await context.addInitScript((current) => {
                localStorage.setItem('dems_boot_ts', String(Date.now()));
                localStorage.setItem('dems_last_seen_version', current);
            }, version);
            const page = await context.newPage();
            await page.goto(`${BASE}/auth/dev-login/raider`);
            await page.locator('#events-grid .event-card').first().waitFor();
            await page.waitForTimeout(1500);
            const height = await page.evaluate(() => document.documentElement.scrollHeight);
            const cards = await page.locator('#events-grid .event-card').count();
            console.log(`${label}: ${height} px, ${cards} cards`);
            await page.screenshot({ path: path.join(__dirname, `${name}-${label}.png`), fullPage: true });
            await context.close();
        }
    } finally {
        await browser.close();
        await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
        fs.rmSync(dbPath, { force: true });
    }
})().catch(err => { console.error(err); process.exitCode = 1; });
```

- [ ] **Step 4: Vorher-Screenshots**

```bash
node data/d04/shots.js before
```
Expected: `mobile: 4438 px, 8 cards` und `desktop: … px, 8 cards` (Werte notieren, sie kommen in die MR-Beschreibung); `data/d04/before-mobile.png`, `data/d04/before-desktop.png` existieren. Danach `netstat -ano | grep ":3125 .*LISTEN"` → keine Ausgabe.

- [ ] **Step 5: `.gitignore` ergänzen**

Am Ende von `.gitignore` anhängen:
```
# Superpowers working files (brainstorming mockups, plan ledgers)
.superpowers/
```
Run: `git status --short` → `.superpowers/` erscheint nicht mehr.

- [ ] **Step 6: Commit**

```bash
git add .gitignore docs/superpowers/specs/2026-10-10-event-overview-design.md docs/superpowers/plans/2026-10-10-event-overview.md
git commit -m "Add the design spec and plan for the new event overview

D-04 turns the overview into compact cards with a date tile, banner,
capacity bar and the member's own status, and shows only upcoming
events. The brainstorming mockups under .superpowers/ stay out of git.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Laufzeit-Regel und eigener Status (`utils/eventListing.js`)

**Files:**
- Create: `utils/eventListing.js`, `test/eventListing.test.js`
- Modify: `bot.js` (Auto-Status), `docs/wiki/modules/utils.md`, `docs/wiki/concepts/reminders-presence.md`, `docs/wiki/index.md`, `docs/wiki/ops/testing.md`

**Interfaces:**
- Produces: `eventEndTime(event) → Date|null`, `isEventOver(event, now = new Date()) → boolean`, `myRegistrationStatus(registrations, userId) → 'accepted'|'pending'|'waitlisted'|'guest'|null`, `DEFAULT_DURATION_MS` (2 h). CommonJS, keine Abhängigkeiten.

- [ ] **Step 1: Failing test**

`test/eventListing.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { eventEndTime, isEventOver, myRegistrationStatus } = require('../utils/eventListing');

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-10T15:00:00.000Z');

test('an event ends at its end date, without one two hours after the start', () => {
    assert.equal(eventEndTime({ startDate: '2026-10-10T18:00:00.000Z', endDate: '2026-10-10T23:00:00.000Z' }).toISOString(), '2026-10-10T23:00:00.000Z');
    assert.equal(eventEndTime({ startDate: '2026-10-10T18:00:00.000Z', endDate: '' }).toISOString(), '2026-10-10T20:00:00.000Z');
    // Older events store a space instead of the T
    assert.equal(eventEndTime({ startDate: '2026-10-10 18:00' }).getTime(), new Date('2026-10-10T18:00').getTime() + 2 * HOUR);
    assert.equal(eventEndTime({ startDate: '2026-10-10T18:00:00.000Z', endDate: 'kaputt' }).toISOString(), '2026-10-10T20:00:00.000Z');
    assert.equal(eventEndTime({ startDate: '' }), null);
    assert.equal(eventEndTime({ startDate: 'kein Datum' }), null);
    assert.equal(eventEndTime({}), null);
});

test('an event is over once its end has passed', () => {
    assert.equal(isEventOver({ startDate: '2026-10-10T14:30:00.000Z', endDate: '2026-10-10T17:00:00.000Z' }, NOW), false, 'running');
    assert.equal(isEventOver({ startDate: '2026-10-10T13:30:00.000Z' }, NOW), false, 'within the default two hours');
    assert.equal(isEventOver({ startDate: '2026-10-10T12:00:00.000Z' }, NOW), true, 'two hours have passed');
    assert.equal(isEventOver({ startDate: '2026-10-03T19:00:00.000Z', endDate: '2026-10-03T22:00:00.000Z' }, NOW), true, 'last week');
    assert.equal(isEventOver({ startDate: '2026-10-11T19:00:00.000Z' }, NOW), false, 'tomorrow');
    assert.equal(isEventOver({}, NOW), false, 'without a date it counts as upcoming');
});

test('the own status comes from the own registration, else from being a guest', () => {
    const registrations = [
        { userId: 'u-accepted', status: 'accepted', guests: ['u-guest'] },
        { userId: 'u-pending', status: 'pending', guests: ['u-pending-guest'] },
        { userId: 'u-wait', status: 'waitlisted', guests: ['u-wait-guest'] },
        { userId: 'u-rejected', status: 'rejected', guests: ['u-rejected-guest'] },
        { userId: 'u-cancelled', status: 'cancelled' }
    ];
    assert.equal(myRegistrationStatus(registrations, 'u-accepted'), 'accepted');
    assert.equal(myRegistrationStatus(registrations, 'u-pending'), 'pending');
    assert.equal(myRegistrationStatus(registrations, 'u-wait'), 'waitlisted');
    assert.equal(myRegistrationStatus(registrations, 'u-guest'), 'guest');
    assert.equal(myRegistrationStatus(registrations, 'u-pending-guest'), 'guest');
    assert.equal(myRegistrationStatus(registrations, 'u-wait-guest'), null, 'guest of a waitlisted registration');
    assert.equal(myRegistrationStatus(registrations, 'u-rejected-guest'), null, 'guest of a rejected registration');
    assert.equal(myRegistrationStatus(registrations, 'u-rejected'), null);
    assert.equal(myRegistrationStatus(registrations, 'u-cancelled'), null);
    assert.equal(myRegistrationStatus(registrations, 'u-stranger'), null);
    assert.equal(myRegistrationStatus(registrations, undefined), null);
    assert.equal(myRegistrationStatus([], 'u-accepted'), null);
});

test('an own rejected registration does not hide a guest place', () => {
    const registrations = [
        { userId: 'u-1', status: 'rejected', guests: [] },
        { userId: 'u-2', status: 'accepted', guests: ['u-1'] }
    ];
    assert.equal(myRegistrationStatus(registrations, 'u-1'), 'guest');
});
```

- [ ] **Step 2: Test schlägt fehl**

Run: `node --test test/eventListing.test.js 2>&1 | tail -5`
Expected: FAIL, `Cannot find module '../utils/eventListing'`.

- [ ] **Step 3: Modul schreiben**

`utils/eventListing.js`:
```js
/**
 * Pure helpers for listing events: when an event is over and how the
 * signed-in member takes part. No database or bot access, so the routes
 * and bot.js share them without a require cycle. The overview cards in
 * public/js/events/cards.js apply the same end rule in the browser.
 */

// Without an end date an event counts as two hours long
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
// Own registrations that put the member on the event's list
const OWN_STATUSES = ['accepted', 'pending', 'waitlisted'];
// Registrations whose guests count as taking part
const HOST_STATUSES = ['accepted', 'pending'];

/**
 * Parse a stored date; older events use a space instead of the T.
 *
 * @param {string} value -> ISO date or empty.
 * @returns {Date|null} -> The date, or null when there is none or it is invalid.
 */
function parseDate(value) {
    if (!value) return null;
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * End of an event.
 *
 * @param {Object} event -> Event data with `startDate` and optional `endDate`.
 * @returns {Date|null} -> `endDate`, else start + 2 hours; null without a valid start.
 */
function eventEndTime(event) {
    const start = parseDate(event.startDate);
    if (!start) return null;
    return parseDate(event.endDate) || new Date(start.getTime() + DEFAULT_DURATION_MS);
}

/**
 * Whether an event has ended.
 *
 * @param {Object} event -> Event data.
 * @param {Date} [now] -> Reference time.
 * @returns {boolean} -> True once the end lies before `now`; events without a date are never over.
 */
function isEventOver(event, now = new Date()) {
    const end = eventEndTime(event);
    return end !== null && end < now;
}

/**
 * Status of a member for one event, as the overview marks it.
 *
 * @param {Array<Object>} registrations -> Registrations of the event (`userId`, `status`, `guests`).
 * @param {string} userId -> Discord user ID of the member.
 * @returns {string|null} -> Own `accepted`/`pending`/`waitlisted`, else `guest` in an accepted or pending registration, else null.
 */
function myRegistrationStatus(registrations, userId) {
    if (!userId) return null;
    const own = registrations.find(registration => registration.userId === userId);
    if (own && OWN_STATUSES.includes(own.status)) return own.status;
    const host = registrations.find(registration => HOST_STATUSES.includes(registration.status)
        && Array.isArray(registration.guests) && registration.guests.includes(userId));
    return host ? 'guest' : null;
}

module.exports = { DEFAULT_DURATION_MS, eventEndTime, isEventOver, myRegistrationStatus };
```

- [ ] **Step 4: Test grün**

Run: `node --test test/eventListing.test.js 2>&1 | tail -5`
Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Bot-Status auf dieselbe Regel umstellen**

In `bot.js` nach der Zeile `const { normalizeReminderHours, findDueReminders } = require('./utils/reminders');` einfügen:
```js
const { isEventOver } = require('./utils/eventListing');
```
Im Auto-Status (`settings.autoStatusCalendarEvents`) ersetzen:
```js
                const running = events.some(e => {
                    if (!e.startDate) return false;
                    const start = new Date(e.startDate);
                    const end = e.endDate ? new Date(e.endDate) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
                    return start <= now && now <= end;
                });
```
durch:
```js
                // Same end rule as the event overview (utils/eventListing.js)
                const running = events.some(e => e.startDate && new Date(e.startDate) <= now && !isEventOver(e, now));
```
Run: `node -e "require('./utils/eventListing'); console.log('ok')"` → `ok`; `npm test 2>&1 | tail -4` → `# fail 0`.

- [ ] **Step 6: Wiki nachziehen**

`docs/wiki/modules/utils.md`: im Frontmatter `utils/eventUtils.js, utils/eventUrl.js` → `utils/eventUtils.js, utils/eventListing.js, utils/eventUrl.js`; vor `## utils/capacity.js, utils/slotService.js (pure)` einfügen:
```markdown
## utils/eventListing.js (pure)

| Export | Behaviour |
|---|---|
| `eventEndTime(event)` | `endDate`, else start + 2 h (`DEFAULT_DURATION_MS`); `null` without a valid `startDate` (a space instead of `T` is accepted) |
| `isEventOver(event, now)` | end before `now`; an event without a date counts as upcoming. Used by `GET /api/events?upcoming=1` and the bot's auto status; `public/js/events/cards.js` applies the same rule in the browser |
| `myRegistrationStatus(registrations, userId)` | `myStatus` of the event list: own `accepted`/`pending`/`waitlisted`, else `guest` in an accepted or pending registration of someone else, else `null` |

```
`docs/wiki/concepts/reminders-presence.md`: Frontmatter `sources: [bot.js, utils/reminders.js, routes/admin.js, server.js]` → `sources: [bot.js, utils/reminders.js, utils/eventListing.js, routes/admin.js, server.js]`; die Zeile
```
| `autoStatusCalendarEvents` (needs `autoUpdatePresence`) | `dnd` while an event runs, `online` if one is upcoming, else `idle` |
```
→
```
| `autoStatusCalendarEvents` (needs `autoUpdatePresence`) | `dnd` while an event runs (started and not `isEventOver`: end, else start + 2 h), `online` if one is upcoming, else `idle` |
```
`docs/wiki/index.md`: in der Zeile `| \`utils/eventUtils.js\`, \`utils/userProfile.js\`, …` nach `` `utils/eventUtils.js`, `` einfügen: `` `utils/eventListing.js`, ``.
`docs/wiki/ops/testing.md`: nach der Zeile `| \`eventUrl.test.js\` | …` einfügen:
```
| `eventListing.test.js` | `utils/eventListing.js`: end of an event (with/without `endDate`, space instead of `T`, no or invalid start), `isEventOver`, `myRegistrationStatus` for every status, guests of accepted/pending/waitlisted/rejected registrations and strangers |
```
Run: `npm run wiki && npm test 2>&1 | tail -4` → `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add utils/eventListing.js test/eventListing.test.js bot.js docs/wiki docs/wiki/graph.json
git commit -m "Share the end-of-event rule and add the own registration status

The overview has to leave out events that are over and mark the
member's own events. A pure module holds the end rule (end date, else
two hours after the start) and the status rule, so the routes and the
bot status use the same logic without a require cycle.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: API liefert kommende Events und `myStatus`; Toms Anmeldungen

**Files:**
- Modify: `routes/events.js` (`GET /`), `dev/seedData.js` (`buildRegistrations`), `test/devServer.test.js`, `test/seed.test.js`
- Modify: `docs/wiki/modules/routes-events.md`, `docs/wiki/modules/dev-mock-mode.md`

**Interfaces:**
- Consumes: `isEventOver`, `myRegistrationStatus` (Task 1)
- Produces: `GET /api/events?upcoming=1` (ohne vorbei gelaufene Events, Serien danach zusammengefasst); jedes Event trägt `myStatus`. Dummy-Anmeldungen `dev-reg-full-tom` (waitlisted) und `dev-reg-form-tom` (pending).

- [ ] **Step 1: Failing tests**

In `test/devServer.test.js` direkt nach dem Test `'a guest sees only status and id of the registration that invited them'` einfügen:
```js
test('the overview gets only events that are not over, each with the own status', async () => {
    const upcomingFor = async (personaId) => {
        const res = await (await loginAs(personaId)).request('/api/events?upcoming=1&limit=100');
        assert.equal(res.status, 200);
        return (await res.json()).data;
    };
    const statusById = (events) => Object.fromEntries(events.map(event => [event.id, event.myStatus]));

    const raiderEvents = await upcomingFor('raider');
    const raider = statusById(raiderEvents);
    assert.ok(!(EVENT_ID.PAST in raider), 'the past event is left out');
    assert.equal(raider[EVENT_ID.RUNNING], 'accepted', 'the running event stays');
    assert.equal(raider[EVENT_ID.OPEN], 'accepted');
    assert.equal(raider[EVENT_ID.ROLE], null);
    assert.equal(raider[SERIES_EVENT_IDS[0]], 'accepted', 'a series carries the status of its next date');
    const series = raiderEvents.find(event => event.id === SERIES_EVENT_IDS[0]);
    assert.deepEqual(series.seriesDates.map(date => date.id), SERIES_EVENT_IDS);

    const member = statusById(await upcomingFor('member'));
    assert.equal(member[EVENT_ID.FULL], 'waitlisted');
    assert.equal(member[EVENT_ID.FORM], 'pending');
    assert.equal(member[EVENT_ID.OPEN], null);

    assert.equal(statusById(await upcomingFor('newbie'))[EVENT_ID.BIG_FORM], 'guest');

    // Without the parameter the list stays as before, past events included
    const { data: all } = await (await (await loginAs('member')).request('/api/events?limit=500')).json();
    assert.ok(all.some(event => event.id === EVENT_ID.PAST));
    assert.ok(all.every(event => !('checkinCode' in event)));
});
```
In `test/seed.test.js`: `registrations: 32,` → `registrations: 34,`; am Ende von `'the seed covers the scenarios of the spec'` (vor der schließenden `});`) anhängen:
```js
    // The member persona waits for a place and for an approval (overview markers)
    const member = PERSONAS.find(persona => persona.id === 'member');
    const ofMember = (eventId) => registrations.find(registration => registration.eventId === eventId && registration.userId === member.userId);
    assert.equal(ofMember(EVENT_ID.FULL).status, 'waitlisted');
    assert.equal(ofMember(EVENT_ID.FORM).status, 'pending');
```

- [ ] **Step 2: Tests schlagen fehl**

Run: `npm test 2>&1 | grep -E "^not ok|# fail"`
Expected: `the overview gets only events …` (der vergangene Event ist enthalten), `seedIfEmpty fills an empty database` (32 statt 34) und `the seed covers the scenarios of the spec` schlagen fehl.

- [ ] **Step 3: API erweitern**

In `routes/events.js` Import ergänzen (nach `const { loadEventRoster, toPublicEvent, isEventVisibleTo } = require('../utils/eventUtils');`):
```js
const { isEventOver, myRegistrationStatus } = require('../utils/eventListing');
```
Den JSDoc-Kopf von `GET /` ersetzen:
```js
/**
 * GET /api/events — List all events (paginated)
 * Query params: ?status=active&category=tournament&search=raid&page=1&limit=20
 * ?upcoming=1 leaves out events that are over (the overview); every event
 * carries myStatus, the signed-in member's status (utils/eventListing.js).
 */
```
Nach dem Block `// Filter by status — …` (nach dessen `else { … }`) einfügen:
```js

        // Overview: leave out events that are over, before series are grouped,
        // so seriesDates only lists the dates still to come
        if (req.query.upcoming === '1') {
            const now = new Date();
            events = events.filter(e => !isEventOver(e, now));
        }
```
Den Block `// Attach participant counts to events` ersetzen:
```js
        // Attach participant counts and the member's own status to events
        const userId = req.session.user.id;
        events = events.map(e => withSlotSummary({
            ...e,
            currentParticipants: participantCounts[e.id] || 0,
            myStatus: myRegistrationStatus(registrationsByEvent[e.id] || [], userId)
        }, registrationsByEvent[e.id] || []));
```

- [ ] **Step 4: Toms Anmeldungen**

In `dev/seedData.js`, `buildRegistrations`: nach `entry('full-greta', …),` einfügen:
```js
        // Tom (member persona) waits for a place, so the overview shows him "Warteliste"
        entry('full-tom', EVENT_ID.FULL, tom, { status: 'waitlisted', createdAt: clock.offset(-6 * HOUR) }),
```
und nach `entry('form-felix', …),` einfügen:
```js
        // ... and waits for the tournament's approval ("Ausstehend")
        entry('form-tom', EVENT_ID.FORM, tom, { status: 'pending', formAnswers: tournamentAnswers('TomTom', 'Schaden'), createdAt: clock.offset(-1 * DAY) }),
```

- [ ] **Step 5: Tests grün**

Run: `npm test 2>&1 | tail -4`
Expected: `# fail 0`.
Run: `npm run test:e2e 2>&1 | tail -3`
Expected: `24 passed`.

- [ ] **Step 6: Wiki nachziehen**

`docs/wiki/modules/routes-events.md`, Zeile `| GET | \`/\` | user | …` ersetzen durch:
```
| GET | `/` | user | active events (`?status=` other than `active` needs admin → 403), `?upcoming=1` (overview: drops events whose end — `endDate`, else start + 2 h, `isEventOver` — has passed, before series are grouped), `?category=`, `?search=` (title/description), `?page`/`?limit` (default 20); adds `currentParticipants`, `myStatus` (`myRegistrationStatus`: own `accepted`/`pending`/`waitlisted`, `guest` in an accepted or pending registration of someone else, else `null`) and `slotSummary` for slot events; series collapsed to one representative with `seriesDates[]`; sorted by `startDate` |
```
Frontmatter `sources: [routes/events.js, utils/registrationService.js, utils/eventUtils.js]` → `sources: [routes/events.js, utils/registrationService.js, utils/eventUtils.js, utils/eventListing.js]`.
`docs/wiki/modules/dev-mock-mode.md`: `12 users, 32 registrations,` → `12 users, 34 registrations (Tom/\`member\`: waitlisted on the full event, pending at the tournament),`.
Run: `npm run wiki && npm test 2>&1 | tail -4` → `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add routes/events.js dev/seedData.js test/devServer.test.js test/seed.test.js docs/wiki
git commit -m "Let the event list drop past events and carry the own status

GET /api/events?upcoming=1 leaves out events that are over before
series are grouped, and every event now carries myStatus. The overview
needs both: no stale events at the top and a marker on the member's
own events. Tom gets a waitlist place and a pending request, so the
personas show every marker.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dummy-Banner

**Files:**
- Create: `data/d04/make-banners.js` (nicht im Repo), `dev/banners/{spieleabend,turnier,koop,raid,speedrun,retro,sommerfest,halloween,training}.svg`
- Modify: `server.js`, `dev/seedData.js`, `test/devServer.test.js`, `test/noMock.test.js`, `test/seed.test.js`, `docs/wiki/modules/dev-mock-mode.md`

**Interfaces:**
- Produces: im Mock-Modus `GET /dev-banners/<name>.svg`; jedes Dummy-Event hat `bannerUrl = ${BASE_URL}/dev-banners/<name>.svg`; der Workshop zeigt absichtlich auf `workshop.svg`, die es nicht gibt. Export `EVENT_BANNERS` aus `dev/seedData.js`.

- [ ] **Step 1: Failing tests**

`test/devServer.test.js`, nach `'seeded events are served'`:
```js
test('the dummy banners are served in mock mode', async () => {
    const member = await loginAs('member');
    const event = await (await member.request(`/api/events/${EVENT_ID.ROLE}`)).json();
    const { pathname } = new URL(event.bannerUrl);
    assert.equal(pathname, '/dev-banners/raid.svg');
    const res = await createClient(server.baseUrl).request(pathname);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^image\/svg\+xml/);
});
```
`test/noMock.test.js`, am Ende:
```js
test('without DEV_MOCK the dummy banners do not exist', async () => {
    // The SPA fallback answers with index.html, never with the image
    const res = await createClient(server.baseUrl).request('/dev-banners/raid.svg');
    assert.doesNotMatch(res.headers.get('content-type') || '', /svg/);
});
```
`test/seed.test.js`: oben `const fs = require('fs');` ergänzen (nach `const path = require('path');`); nach `'the seed covers the scenarios of the spec'` einfügen:
```js
test('every seeded event has a banner of dev/banners, the workshop a missing one', async () => {
    const events = (await getDocs(collection(db, 'events'))).docs.map(d => ({ id: d.id, ...d.data() }));
    assert.equal(events.length, EXPECTED_COUNTS.events);
    for (const event of events) {
        const match = event.bannerUrl.match(/^http:\/\/localhost:\d+\/dev-banners\/([a-z-]+\.svg)$/);
        assert.ok(match, `${event.id}: ${event.bannerUrl}`);
        const exists = fs.existsSync(path.join(__dirname, '..', 'dev', 'banners', match[1]));
        // The workshop's banner is missing on purpose: the overview shows its colour fallback
        assert.equal(exists, event.id !== EVENT_ID.BIG_FORM, event.id);
    }
});
```

- [ ] **Step 2: Tests schlagen fehl**

Run: `npm test 2>&1 | grep -E "^not ok|# fail"`
Expected: die drei neuen Tests schlagen fehl (`bannerUrl` leer bzw. `new URL('')` wirft).

- [ ] **Step 3: Banner erzeugen**

`data/d04/make-banners.js`:
```js
// Writes the dummy banners of the dev mock mode (2.5:1 SVGs, no emojis, no
// third-party images) to dev/banners/. Run once from the repo root:
// node data/d04/make-banners.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'dev', 'banners');
// file, title, subtitle, gradient from, gradient to
const BANNERS = [
    ['spieleabend', 'Spieleabend', 'Community', '#7c3aed', '#db2777'],
    ['turnier', 'Arena-Cup', 'Turnier', '#b45309', '#f59e0b'],
    ['koop', 'Koop-Abend', 'Fünf Plätze', '#6d28d9', '#be185d'],
    ['raid', 'Schattenfestung', 'Raid', '#052e16', '#16a34a'],
    ['speedrun', 'Speedrun-Marathon', 'Live im Stream', '#4c1d95', '#7c3aed'],
    ['retro', 'Retro-Abend', 'Klassiker', '#1e3a8a', '#0891b2'],
    ['sommerfest', 'Sommerfest', 'Community', '#9a3412', '#facc15'],
    ['halloween', 'Halloween', 'Special', '#1c1917', '#ea580c'],
    ['training', 'Training', 'Jeden Sonntag', '#0e7490', '#155e75']
];

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

fs.mkdirSync(OUT, { recursive: true });
for (const [file, title, subtitle, from, to] of BANNERS) {
    // Long titles get a smaller font so they stay inside the 1000 px width
    const size = Math.min(88, Math.floor(900 / (0.65 * title.length)));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 400" width="1000" height="400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
    <radialGradient id="glow" cx="0.8" cy="0.2" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1000" height="400" fill="url(#bg)"/>
  <rect width="1000" height="400" fill="url(#glow)"/>
  <circle cx="140" cy="330" r="160" fill="#ffffff" fill-opacity="0.06"/>
  <circle cx="900" cy="60" r="110" fill="#000000" fill-opacity="0.12"/>
  <text x="500" y="215" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${size}" font-weight="800" fill="#ffffff" letter-spacing="4">${escapeXml(title.toUpperCase())}</text>
  <text x="500" y="285" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="600" fill="#ffffff" fill-opacity="0.85" letter-spacing="6">${escapeXml(subtitle.toUpperCase())}</text>
</svg>
`;
    fs.writeFileSync(path.join(OUT, `${file}.svg`), svg);
}
console.log(`${BANNERS.length} banners in ${OUT}`);
```
Run: `node data/d04/make-banners.js`
Expected: `9 banners in …dev\banners`; `ls dev/banners` zeigt neun `.svg`, kein `workshop.svg`.

- [ ] **Step 4: Route nur im Mock-Modus**

In `server.js` nach `app.use(express.static(path.join(__dirname, 'public')));` einfügen:
```js
// Dev mock mode: banners of the dummy events (dev/banners, see dev/seedData.js)
if (IS_MOCK_MODE) app.use('/dev-banners', express.static(path.join(__dirname, 'dev', 'banners')));
```

- [ ] **Step 5: Banner in die Dummy-Events**

In `dev/seedData.js` nach `const CHECKIN_CODE = 'DEMO42';` einfügen:
```js

/**
 * Banner file of every dummy event (dev/banners/<name>.svg, served at
 * /dev-banners only in mock mode). The workshop's file does not exist on
 * purpose, so the overview shows its colour fallback.
 */
const EVENT_BANNERS = {
    [EVENT_ID.OPEN]: 'spieleabend',
    [EVENT_ID.FORM]: 'turnier',
    [EVENT_ID.FULL]: 'koop',
    [EVENT_ID.ROLE]: 'raid',
    [EVENT_ID.BIG_FORM]: 'workshop',
    [EVENT_ID.RUNNING]: 'speedrun',
    [EVENT_ID.PAST]: 'retro',
    [EVENT_ID.ARCHIVED]: 'sommerfest',
    [EVENT_ID.DRAFT]: 'halloween',
    ...Object.fromEntries(SERIES_EVENT_IDS.map(id => [id, 'training']))
};

/**
 * Absolute banner address; the mock mode sets BASE_URL to its own port.
 *
 * @param {string} name -> File name without .svg.
 * @returns {string} -> URL the browser can load.
 */
const bannerUrl = (name) => `${process.env.BASE_URL || 'http://localhost:3000'}/dev-banners/${name}.svg`;
```
In `buildEvents` direkt vor `return events;` einfügen:
```js
    for (const [id, name] of Object.entries(EVENT_BANNERS)) events[id].bannerUrl = bannerUrl(name);
```
Export ergänzen: `module.exports = { buildSeedData, EVENT_ID, SERIES_EVENT_IDS, CHECKIN_CODE, RAID_SLOT_ID, POLL_ID, EVENT_BANNERS };`

- [ ] **Step 6: Tests grün**

Run: `npm test 2>&1 | tail -4` → `# fail 0`.
Run: `npm run test:e2e 2>&1 | tail -3` → `24 passed` (die alten Karten zeigen jetzt Banner; der kaputte Workshop-Banner meldet nur „Failed to load resource“, das `watchErrors` ignoriert).

- [ ] **Step 7: Wiki nachziehen**

`docs/wiki/modules/dev-mock-mode.md`:
- Frontmatter `dev/seedData.js, dev/start.js` → `dev/seedData.js, dev/banners, dev/start.js`.
- `draft, 3-part weekly series), 12 users` → `draft, 3-part weekly series; each with an SVG banner from \`dev/banners/\` (\`EVENT_BANNERS\`), served at \`/dev-banners/\` only in mock mode, the workshop's file missing on purpose), 12 users`.
- `- Dates are relative to the first seed; after a few days the sample events are in the past → \`npm run dev:reset\`.` → `- Dates are relative to the first seed; after a few days the sample events are in the past → \`npm run dev:reset\` (a dev database seeded before D-04 also needs it once for the banners).`
Run: `npm run wiki && npm test 2>&1 | tail -4` → `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add dev/banners dev/seedData.js server.js test/devServer.test.js test/noMock.test.js test/seed.test.js docs/wiki
git commit -m "Give the dummy events banners served only in mock mode

In real use every event has a banner, and the new cards are built
around it. The dummy events get self-made 2.5:1 SVG banners from
dev/banners, which only the mock mode serves. The workshop points to a
missing file, so the colour fallback stays visible.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Karten als reine Funktionen, Datums-Kachel und Plätze-Balken

**Files:**
- Create: `public/js/events/cards.js`
- Modify: `public/css/components.css` (DATE TILE, CAPACITY), `public/css/style.css` (`.sg-capacity-sample`), `public/js/pages/debug-components.js`, `test/eventCards.test.js`, `test/cssRules.test.js`, `test/styleguide.test.js`, `e2e/styleguide.spec.js`
- Modify: `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/ops/testing.md`

**Interfaces:**
- Consumes: `escapeHtml`, `isValidBannerUrl` (`core/ui.js`), `getEventGradient(eventId)` (`events/detail.js`)
- Produces (ES-Exports von `events/cards.js`): `STATUS_CHIPS`, `eventEnd(event) → Date|null`, `isRunning(event, now) → boolean`, `relativeDay(date, now) → string`, `renderDateTile(event, now) → string`, `renderEventWhen(event, now) → string`, `renderCapacity(event) → string`, `renderStatusChip(myStatus) → string`, `bannerBackground(event) → string`, `renderEventCard(event, now) → string`, `renderEventCardSkeletons(count) → string`. CSS-Klassen `.date-tile` (`-weekday`, `-day`, `-month`, `.is-live`), `.capacity` (`.capacity-bar`, `.capacity-label`, `.is-low`, `.is-full`).

- [ ] **Step 1: Failing tests**

In `test/eventCards.test.js` am Dateiende anhängen:
```js
// "now" of the card tests: Saturday, 10 October 2026, 15:00 local time
const NOW = new Date(2026, 9, 10, 15, 0);
const at = (day, hour, minute = 0, month = 9) => new Date(2026, month, day, hour, minute).toISOString();
const EMOJI = /\p{Extended_Pictographic}/u;
const INLINE_HANDLER = /\son[a-z]+\s*=\s*["']/i;

test('the day of an event is said relative to today, in calendar days', async () => {
    const { app } = await loadFrontendApp({});
    const day = (iso, now = NOW) => app.relativeDay(new Date(iso), now);
    assert.equal(day(at(10, 23, 30)), 'Heute');
    assert.equal(day(at(11, 0, 30)), 'Morgen');
    assert.equal(day(at(12, 20)), 'in 2 Tagen');
    assert.equal(day(at(23, 19)), 'in 13 Tagen');
    assert.equal(day(at(24, 19)), 'in 2 Wochen');
    assert.equal(day(at(30, 19)), 'in 2 Wochen');
    assert.equal(day(at(31, 19)), 'in 3 Wochen');
    assert.equal(day(at(9, 19)), 'Gestern');
    assert.equal(day(at(7, 19)), 'vor 3 Tagen');
    // Clocks go back on 25 October: still two calendar days
    assert.equal(day(at(26, 12), new Date(2026, 9, 24, 12)), 'in 2 Tagen');
});

test('an event runs from its start to its end, without an end for two hours', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.isRunning({ startDate: at(10, 14, 30), endDate: at(10, 17) }, NOW), true);
    assert.equal(app.isRunning({ startDate: at(10, 13, 30) }, NOW), true);
    assert.equal(app.isRunning({ startDate: at(10, 12, 0) }, NOW), false);
    assert.equal(app.isRunning({ startDate: at(11, 19) }, NOW), false);
    assert.equal(app.isRunning({ startDate: '' }, NOW), false);
    assert.equal(app.isRunning({ startDate: 'kein Datum' }, NOW), false);
});

test('the date tile shows weekday, day and month, or LIVE while the event runs', async () => {
    const { app } = await loadFrontendApp({});
    const sunday = app.renderDateTile({ startDate: at(11, 19) }, NOW);
    assert.match(sunday, /class="date-tile"/);
    assert.match(sunday, /date-tile-weekday">So</);
    assert.match(sunday, /date-tile-day">11</);
    assert.match(sunday, /date-tile-month">Okt</);
    const live = app.renderDateTile({ startDate: at(10, 14, 30) }, NOW);
    assert.match(live, /class="date-tile is-live"/);
    assert.match(live, /date-tile-day">LIVE</);
    assert.match(app.renderDateTile({}, NOW), /date-tile-day">–</);
});

test('the time line says when the event starts', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.renderEventWhen({ startDate: at(10, 14, 30) }, NOW), '<p class="event-card-when is-live"><strong>Läuft gerade</strong> · seit 14:30</p>');
    assert.equal(app.renderEventWhen({ startDate: at(11, 19) }, NOW), '<p class="event-card-when"><strong>Morgen</strong> · 19:00</p>');
    assert.equal(app.renderEventWhen({ startDate: at(13, 20) }, NOW), '<p class="event-card-when"><strong>in 3 Tagen</strong> · 20:00</p>');
    assert.equal(app.renderEventWhen({ startDate: '' }, NOW), '<p class="event-card-when">Termin folgt</p>');
});

test('the capacity shows taken places, warns from 80 % and says when it is full', async () => {
    const { app } = await loadFrontendApp({});
    const capacity = (currentParticipants, maxParticipants) => app.renderCapacity({ currentParticipants, maxParticipants });
    assert.equal(capacity(3, 0), '<div class="capacity"><span class="capacity-label">Unbegrenzt</span></div>');
    assert.match(capacity(5, 20), /^<div class="capacity"><progress class="capacity-bar" max="20" value="5" aria-label="5 von 20 Plätzen belegt"><\/progress><span class="capacity-label">5\/20<\/span><\/div>$/);
    assert.match(capacity(7, 10), /class="capacity"[^]*7\/10/);
    assert.match(capacity(8, 10), /class="capacity is-low"[^]*Noch 2 Plätze/);
    assert.match(capacity(4, 5), /class="capacity is-low"[^]*Noch 1 Platz</);
    assert.match(capacity(5, 5), /class="capacity is-full"[^]*Ausgebucht/);
    // Overbooked by an admin: the bar stays at its end
    assert.match(capacity(7, 5), /class="capacity is-full"[^]*max="5" value="5"/);
    assert.match(capacity(undefined, 4), /value="0"[^]*0\/4/);
});

test('the own status becomes a chip with an icon, anything else none', async () => {
    const { app } = await loadFrontendApp({});
    const expected = {
        accepted: ['chip-success', 'bi-check-circle-fill', 'Angemeldet'],
        pending: ['chip-warning', 'bi-hourglass-split', 'Ausstehend'],
        waitlisted: ['chip-info', 'bi-list-ol', 'Warteliste'],
        guest: ['chip-accent', 'bi-person-plus', 'Als Gast']
    };
    for (const [status, [className, icon, label]] of Object.entries(expected)) {
        assert.equal(app.renderStatusChip(status), `<span class="chip chip-sm ${className}"><i class="bi ${icon}"></i>${label}</span>`);
    }
    for (const status of [null, undefined, '', 'rejected', 'cancelled', 'constructor', '__proto__', 'toString']) {
        assert.equal(app.renderStatusChip(status), '', String(status));
    }
});

test('the banner background uses the event colour, else the gradient of its id', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.bannerBackground({ id: 'a', accentColor: '#8b5cf6' }), 'linear-gradient(135deg, #8b5cf699 0%, #8b5cf6 100%)');
    assert.equal(app.bannerBackground({ id: 'a', accentColor: '#abc' }), 'linear-gradient(135deg, #aabbcc99 0%, #aabbcc 100%)');
    for (const accentColor of ['', 'red', 'red;background:url(x)', '#12345', undefined]) {
        assert.equal(app.bannerBackground({ id: 'ev-1', accentColor }), app.getEventGradient('ev-1'), String(accentColor));
    }
});

test('an event card links to the event and shows banner, date, time and facts', async () => {
    const { app } = await loadFrontendApp({});
    const html = app.renderEventCard({
        id: 'ev-1', title: 'Raid: Schattenfestung', description: 'Nur für das Raid-Team.', category: 'Raid',
        startDate: at(15, 20), bannerUrl: 'https://example.com/raid.png', accessMode: 'role-required',
        maxParticipants: 6, currentParticipants: 2, myStatus: 'waitlisted'
    }, NOW);
    assert.match(html, /^<a class="glass-card event-card" href="#event\/ev-1">/);
    assert.match(html, /<img class="event-card-banner" src="https:\/\/example\.com\/raid\.png" alt="" loading="lazy" data-fallback="hide">/);
    assert.match(html, /event-card-category"><span>Raid<\/span>/);
    assert.match(html, /date-tile-day">15</);
    assert.match(html, /<h3 class="event-card-title">Raid: Schattenfestung<\/h3>/);
    assert.match(html, /<strong>in 5 Tagen<\/strong> · 20:00/);
    assert.match(html, /Warteliste/);
    assert.match(html, /bi-lock"><\/i>Rolle nötig/);
    assert.match(html, /2\/6/);
    assert.doesNotMatch(html, /Nur für das Raid-Team/, 'no description on the card');
    assert.doesNotMatch(html, /Serie/);
});

test('a series card counts its dates; an open event without status shows no chip', async () => {
    const { app } = await loadFrontendApp({});
    const series = app.renderEventCard({ id: 's1', title: 'Training', seriesId: 'x', seriesDates: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], startDate: at(11, 19), accessMode: 'open', maxParticipants: 8, currentParticipants: 2, myStatus: null }, NOW);
    assert.match(series, /bi-arrow-repeat"><\/i>Serie · 3 Termine/);
    assert.doesNotMatch(series, /Rolle nötig|Angemeldet|Warteliste|Ausstehend|Als Gast/);
    const last = app.renderEventCard({ id: 's3', title: 'Training', seriesId: 'x', seriesDates: [{ id: 's3' }], startDate: at(11, 19) }, NOW);
    assert.match(last, /Serie · 1 Termin</);
});

test('event cards escape admin texts and drop unsafe banner addresses', async () => {
    const { app } = await loadFrontendApp({});
    const html = app.renderEventCard({
        id: 'ev"1', title: '<img src=x onerror=alert(1)>', category: '"><script>alert(1)</script>',
        bannerUrl: 'https://example.com/a.png" onerror="alert(1)', accentColor: 'red;background:url(x)',
        startDate: at(11, 19), maxParticipants: 0
    }, NOW);
    assert.doesNotMatch(html, INLINE_HANDLER);
    assert.doesNotMatch(html, /<img src=x|<script/);
    assert.match(html, /href="#event\/ev&quot;1"/);
    assert.match(html, /src="https:\/\/example\.com\/a\.png&quot; onerror=&quot;alert\(1\)"/);
    assert.doesNotMatch(html, /red;background/);
    for (const bannerUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '/relative.png', '']) {
        assert.doesNotMatch(app.renderEventCard({ id: 'b', title: 'B', bannerUrl, startDate: at(11, 19) }, NOW), /<img/, bannerUrl);
    }
});

test('cards and skeletons contain no emoji', async () => {
    const { app } = await loadFrontendApp({});
    const statuses = [null, ...Object.keys(app.STATUS_CHIPS)];
    for (const myStatus of statuses) {
        const html = app.renderEventCard({ id: 'e', title: 'Event', category: 'Gaming', seriesId: 's', seriesDates: [{ id: 'e' }], accessMode: 'role-required', startDate: at(10, 14, 30), maxParticipants: 5, currentParticipants: 5, myStatus }, NOW);
        assert.doesNotMatch(html, EMOJI, String(myStatus));
    }
    const skeletons = app.renderEventCardSkeletons(3);
    assert.equal(skeletons.match(/event-card-skeleton-media/g).length, 3);
    assert.match(skeletons, /aria-hidden="true"/);
    assert.doesNotMatch(skeletons, EMOJI);
});
```
In `test/cssRules.test.js` in `COMPONENT_SELECTORS` die letzte Zeile
```js
    '.avatar', '.avatar-sm', '.avatar-lg', '.avatar-xl', '.avatar-initials', '.avatar-stack', '.avatar-more'
```
ersetzen durch:
```js
    '.avatar', '.avatar-sm', '.avatar-lg', '.avatar-xl', '.avatar-initials', '.avatar-stack', '.avatar-more',
    '.date-tile', '.date-tile-weekday', '.date-tile-month', '.date-tile-day', '.date-tile.is-live',
    '.capacity', '.capacity-bar', '.capacity-label', '.capacity.is-low .capacity-label', '.capacity.is-full .capacity-label'
```
In `test/styleguide.test.js`: `const BLOCKS = ['button', 'card', 'chip', 'tabs', 'dialog', 'toast', 'empty-state', 'skeleton', 'avatar'];` → `const BLOCKS = ['button', 'card', 'chip', 'tabs', 'dialog', 'toast', 'empty-state', 'skeleton', 'avatar', 'date-tile', 'capacity'];`
In `e2e/styleguide.spec.js` dieselbe `BLOCKS`-Zeile ebenso ändern; den Kopfkommentar `tokens and the nine components` → `tokens and the components`; den Testnamen `'the styleguide shows the tokens and all nine components'` → `'the styleguide shows the tokens and all components'`.

- [ ] **Step 2: Tests schlagen fehl**

Run: `npm test 2>&1 | grep -E "^not ok|# fail"`
Expected: die neuen `eventCards`-Tests (`app.relativeDay is not a function` …), `components.css defines every component selector` und der Styleguide-Blocktest schlagen fehl.

- [ ] **Step 3: `events/cards.js`**

`public/js/events/cards.js`:
```js
/**
 * Cards of the event overview (#events): pure functions that turn an event
 * of GET /api/events into HTML. No DOM access, so the tests call them
 * directly and the styleguide shows the same markup. Styles: EVENT CARDS in
 * style.css, DATE TILE and CAPACITY in components.css.
 */
import { escapeHtml, isValidBannerUrl } from '../core/ui.js';
import { getEventGradient } from './detail.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Same rule as utils/eventListing.js on the server: without an end an event lasts two hours
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
// Share of taken places from which the card warns "Noch 2 Plätze"
const LOW_CAPACITY = 0.8;

/** Chip per own registration status (`myStatus` of GET /api/events). */
export const STATUS_CHIPS = {
    accepted: { label: 'Angemeldet', className: 'chip-success', icon: 'check-circle-fill' },
    pending: { label: 'Ausstehend', className: 'chip-warning', icon: 'hourglass-split' },
    waitlisted: { label: 'Warteliste', className: 'chip-info', icon: 'list-ol' },
    guest: { label: 'Als Gast', className: 'chip-accent', icon: 'person-plus' }
};

/**
 * Parse a stored date; older events use a space instead of the T.
 *
 * @param {string} value -> ISO date or empty.
 * @returns {Date|null} -> The date, or null.
 */
function parseDate(value) {
    if (!value) return null;
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
}

const formatTime = (date) => date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
// "Sa." / "Okt." -> "Sa" / "Okt"; the tile writes them in capitals via CSS
const shortName = (date, part) => date.toLocaleDateString('de-DE', { [part]: 'short' }).replace('.', '');

/**
 * End of an event.
 *
 * @param {Object} event -> Event with `startDate` and optional `endDate`.
 * @returns {Date|null} -> `endDate`, else start + 2 hours; null without a valid start.
 */
export function eventEnd(event) {
    const start = parseDate(event.startDate);
    if (!start) return null;
    return parseDate(event.endDate) || new Date(start.getTime() + DEFAULT_DURATION_MS);
}

/**
 * Whether an event is running at `now`.
 *
 * @param {Object} event -> Event.
 * @param {Date} now -> Reference time.
 * @returns {boolean} -> Start reached and end not yet passed.
 */
export function isRunning(event, now) {
    const start = parseDate(event.startDate);
    return !!start && start <= now && now <= eventEnd(event);
}

/**
 * Day of a date relative to today, counted in calendar days of the browser's time zone.
 *
 * @param {Date} date -> Start of the event.
 * @param {Date} now -> Reference time.
 * @returns {string} -> "Heute", "Morgen", "in 3 Tagen", "in 2 Wochen" (from 14 days), "Gestern", "vor 3 Tagen".
 */
export function relativeDay(date, now) {
    const startOfDay = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
    // Rounding absorbs the 23 or 25 hour days of the clock change
    const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
    if (days === 0) return 'Heute';
    if (days === 1) return 'Morgen';
    if (days === -1) return 'Gestern';
    if (days < 0) return `vor ${-days} Tagen`;
    if (days < 14) return `in ${days} Tagen`;
    return `in ${Math.floor(days / 7)} Wochen`;
}

/**
 * Date tile: weekday, day and month, or LIVE while the event runs.
 *
 * @param {Object} event -> Event.
 * @param {Date} now -> Reference time.
 * @returns {string} -> HTML of a .date-tile.
 */
export function renderDateTile(event, now) {
    const start = parseDate(event.startDate);
    if (!start) return '<div class="date-tile"><span class="date-tile-day">–</span></div>';
    const weekday = `<span class="date-tile-weekday">${shortName(start, 'weekday')}</span>`;
    if (isRunning(event, now)) return `<div class="date-tile is-live">${weekday}<span class="date-tile-day">LIVE</span></div>`;
    return `<div class="date-tile">${weekday}<span class="date-tile-day">${start.getDate()}</span><span class="date-tile-month">${shortName(start, 'month')}</span></div>`;
}

/**
 * Time line of a card.
 *
 * @param {Object} event -> Event.
 * @param {Date} now -> Reference time.
 * @returns {string} -> "Läuft gerade · seit 14:30", "Morgen · 19:00" … or "Termin folgt".
 */
export function renderEventWhen(event, now) {
    const start = parseDate(event.startDate);
    if (!start) return '<p class="event-card-when">Termin folgt</p>';
    if (isRunning(event, now)) return `<p class="event-card-when is-live"><strong>Läuft gerade</strong> · seit ${formatTime(start)}</p>`;
    return `<p class="event-card-when"><strong>${relativeDay(start, now)}</strong> · ${formatTime(start)}</p>`;
}

/**
 * Capacity bar with its label.
 *
 * @param {Object} event -> Event with `maxParticipants` and `currentParticipants`.
 * @returns {string} -> HTML of a .capacity; "Unbegrenzt" without a limit.
 */
export function renderCapacity(event) {
    const max = Math.max(0, Math.floor(Number(event.maxParticipants) || 0));
    if (max === 0) return '<div class="capacity"><span class="capacity-label">Unbegrenzt</span></div>';
    const taken = Math.max(0, Math.floor(Number(event.currentParticipants) || 0));
    const free = max - taken;
    let state = '';
    let label = `${taken}/${max}`;
    if (free <= 0) {
        state = ' is-full';
        label = 'Ausgebucht';
    } else if (taken / max >= LOW_CAPACITY) {
        state = ' is-low';
        label = `Noch ${free} ${free === 1 ? 'Platz' : 'Plätze'}`;
    }
    return `<div class="capacity${state}"><progress class="capacity-bar" max="${max}" value="${Math.min(taken, max)}" aria-label="${taken} von ${max} Plätzen belegt"></progress><span class="capacity-label">${label}</span></div>`;
}

/**
 * Chip for the member's own status.
 *
 * @param {string|null} myStatus -> `accepted`, `pending`, `waitlisted`, `guest` or anything else.
 * @returns {string} -> HTML of a chip, empty for every other value.
 */
export function renderStatusChip(myStatus) {
    if (typeof myStatus !== 'string' || !Object.hasOwn(STATUS_CHIPS, myStatus)) return '';
    const { label, className, icon } = STATUS_CHIPS[myStatus];
    return `<span class="chip chip-sm ${className}"><i class="bi bi-${icon}"></i>${label}</span>`;
}

/**
 * Background behind the banner: shown while it loads and when it fails.
 *
 * @param {Object} event -> Event with `id` and optional `accentColor`.
 * @returns {string} -> CSS gradient in the event colour, else the gradient of its id.
 */
export function bannerBackground(event) {
    const color = typeof event.accentColor === 'string' && HEX_COLOR.test(event.accentColor) ? event.accentColor : '';
    if (!color) return getEventGradient(event.id);
    const full = color.length === 4 ? `#${[...color.slice(1)].map(digit => digit + digit).join('')}` : color;
    return `linear-gradient(135deg, ${full}99 0%, ${full} 100%)`;
}

/**
 * One card of the overview: a link to the event page.
 *
 * @param {Object} event -> Event of GET /api/events (with `myStatus`, series with `seriesDates`).
 * @param {Date} now -> Reference time for "Heute" and "Läuft gerade".
 * @returns {string} -> HTML of an a.event-card; the media carries data-banner-bg for list.js.
 */
export function renderEventCard(event, now) {
    const banner = isValidBannerUrl(event.bannerUrl)
        ? `<img class="event-card-banner" src="${escapeHtml(event.bannerUrl)}" alt="" loading="lazy" data-fallback="hide">`
        : '';
    const category = event.category
        ? `<span class="chip chip-sm event-card-category"><span>${escapeHtml(String(event.category))}</span></span>`
        : '';
    const seriesSize = Array.isArray(event.seriesDates) ? event.seriesDates.length : 1;
    const facts = [
        renderStatusChip(event.myStatus),
        event.accessMode && event.accessMode !== 'open' ? '<span class="chip chip-sm"><i class="bi bi-lock"></i>Rolle nötig</span>' : '',
        event.seriesId ? `<span class="chip chip-sm"><i class="bi bi-arrow-repeat"></i>Serie · ${seriesSize} ${seriesSize === 1 ? 'Termin' : 'Termine'}</span>` : '',
        renderCapacity(event)
    ].join('');
    return `<a class="glass-card event-card" href="#event/${escapeHtml(String(event.id ?? ''))}">`
        + `<div class="event-card-media" data-banner-bg="${escapeHtml(bannerBackground(event))}">${banner}${category}</div>`
        + renderDateTile(event, now)
        + `<div class="event-card-body"><h3 class="event-card-title">${escapeHtml(String(event.title ?? ''))}</h3>${renderEventWhen(event, now)}<div class="event-card-facts">${facts}</div></div>`
        + '</a>';
}

/**
 * Placeholder cards while the overview loads.
 *
 * @param {number} count -> Number of cards.
 * @returns {string} -> HTML of `count` skeleton cards in the card layout.
 */
export function renderEventCardSkeletons(count) {
    const card = '<div class="glass-card event-card" aria-hidden="true">'
        + '<div class="skeleton event-card-skeleton-media"></div>'
        + '<div class="skeleton event-card-skeleton-date"></div>'
        + '<div class="event-card-body"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text is-short"></div></div>'
        + '</div>';
    return card.repeat(count);
}
```
In `public/js/main.js` ist kein Import nötig (die Styleguide-Seite und ab Task 6 `list.js` importieren das Modul).

- [ ] **Step 4: Komponenten-CSS**

In `public/css/components.css` den Kopfkommentar `/* Bootstrap bridge and the nine components.   */` → `/* Bootstrap bridge and the components.       */`; am Dateiende anhängen:
```css

/* ═══════════════════════════════════════════ */
/* DATE TILE                                   */
/* renderDateTile(event, now) in               */
/* events/cards.js; .is-live while it runs     */
/* ═══════════════════════════════════════════ */
.date-tile {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 3.25rem;
  min-height: 3.75rem;
  padding: var(--space-4) 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-tint-1);
  line-height: 1.15;
  text-align: center;
}

.date-tile-weekday,
.date-tile-month {
  font-size: var(--font-size-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.date-tile-weekday {
  color: var(--text-muted);
}

.date-tile-month {
  color: var(--text-secondary);
}

.date-tile-day {
  color: var(--text-primary);
  font-size: var(--font-size-xl);
  font-weight: 700;
}

.date-tile.is-live {
  border-color: var(--danger-border);
  background: var(--danger-bg);
}

/* Muted text has too little contrast on the red tint */
.date-tile.is-live .date-tile-weekday {
  color: var(--text-secondary);
}

.date-tile.is-live .date-tile-day {
  color: var(--danger);
  font-size: var(--font-size-sm);
  letter-spacing: 0.06em;
}

/* ═══════════════════════════════════════════ */
/* CAPACITY                                    */
/* renderCapacity(event) in events/cards.js:   */
/* <progress> + label; .is-low from 80 %,      */
/* .is-full when no place is left              */
/* ═══════════════════════════════════════════ */
.capacity {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

.capacity-bar {
  flex: 1 1 auto;
  min-width: 3rem;
  height: 0.25rem;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--bg-tint-2);
  overflow: hidden;
  appearance: none;
}

.capacity-bar::-webkit-progress-bar {
  background: var(--bg-tint-2);
}

.capacity-bar::-webkit-progress-value {
  border-radius: var(--radius-pill);
  background: var(--accent-fill);
}

.capacity-bar::-moz-progress-bar {
  border-radius: var(--radius-pill);
  background: var(--accent-fill);
}

.capacity-label {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.capacity.is-low .capacity-label {
  color: var(--warning);
  font-weight: 600;
}

.capacity.is-full .capacity-label {
  color: var(--danger);
  font-weight: 600;
}

.capacity.is-full .capacity-bar::-webkit-progress-value {
  background: var(--danger);
}

.capacity.is-full .capacity-bar::-moz-progress-bar {
  background: var(--danger);
}
```
In `public/css/style.css` direkt nach der Regel `.sg-samples { … }` einfügen:
```css

/* The capacity bar fills its row; a sample gets a fixed width */
.sg-capacity-sample {
  width: 100%;
  max-width: 16rem;
}
```

- [ ] **Step 5: Styleguide-Blöcke**

In `public/js/pages/debug-components.js`:
- Import ergänzen: `import { renderCapacity, renderDateTile } from '../events/cards.js';`
- vor `/**\n * Render the nine component blocks.` einfügen:
```js
function dateTileBlock() {
    // Fixed example dates; "now" is Saturday afternoon
    const now = new Date(2026, 9, 10, 15, 0);
    const at = (day, hour, minute = 0) => ({ startDate: new Date(2026, 9, day, hour, minute).toISOString() });
    return block('date-tile', 'Datums-Kachel', 'renderDateTile(event, now) → .date-tile, .is-live', [
        row('Kommend', renderDateTile(at(11, 19), now) + renderDateTile(at(15, 20), now) + renderDateTile(at(31, 18), now)),
        row('Läuft gerade', renderDateTile(at(10, 14, 30), now))
    ].join(''));
}

function capacityBlock() {
    const sample = (currentParticipants, maxParticipants) => `<div class="sg-capacity-sample">${renderCapacity({ currentParticipants, maxParticipants })}</div>`;
    return block('capacity', 'Plätze-Balken', 'renderCapacity(event) → .capacity, .is-low ab 80 %, .is-full', [
        row('Frei', sample(5, 20)),
        row('Fast voll', sample(8, 10)),
        row('Ausgebucht', sample(5, 5)),
        row('Unbegrenzt', sample(3, 0))
    ].join(''));
}

```
- JSDoc `Render the nine component blocks.` → `Render one block per component.`; in `renderDebugComponents` nach `avatarBlock()` ergänzen: `, dateTileBlock(), capacityBlock()`.
- Kopfkommentar der Datei bleibt.

- [ ] **Step 6: Tests grün**

Run: `npm test 2>&1 | tail -4` → `# fail 0`.
Run: `npm run test:e2e 2>&1 | tail -3` → `24 passed`.

- [ ] **Step 7: Wiki nachziehen**

`docs/wiki/modules/frontend-markup.md`:
- In der Tabelle „Stylesheets“: `BOOTSTRAP BRIDGE → BUTTON → DIALOG → TABS → TOAST → CARD → CHIP → SKELETON → EMPTY STATE → AVATAR` → `BOOTSTRAP BRIDGE → BUTTON → DIALOG → TABS → TOAST → CARD → CHIP → SKELETON → EMPTY STATE → AVATAR → DATE TILE → CAPACITY`.
- In der Komponenten-Tabelle nach der Avatar-Zeile:
```
| Date tile | `renderDateTile(event, now)` (`events/cards.js`) → `.date-tile` with `.date-tile-weekday`, `-day`, `-month`; `.is-live` shows "LIVE" in red while the event runs | – |
| Capacity | `renderCapacity(event)` → `.capacity` with a `<progress class="capacity-bar">` and `.capacity-label` ("5/20"); `.is-low` from 80 % ("Noch 2 Plätze"), `.is-full` ("Ausgebucht"); "Unbegrenzt" without a limit | – |
```
`docs/wiki/modules/frontend-app.md`: nach der Zeile `| \`events/list.js\` | …` einfügen:
```
| `events/cards.js` | overview cards, pure (no DOM) | `eventEnd`, `isRunning(event, now)` (end rule of `utils/eventListing.js`), `relativeDay(date, now)` ("Heute", "Morgen", "in 3 Tagen", "in 2 Wochen", "Gestern", "vor 3 Tagen"; calendar days), `renderDateTile`, `renderEventWhen`, `renderCapacity`, `renderStatusChip(myStatus)` (`STATUS_CHIPS`), `bannerBackground` (event colour, else `getEventGradient`), `renderEventCard(event, now)`, `renderEventCardSkeletons(count)` |
```
`docs/wiki/ops/testing.md`:
- `the styleguide renders the nine component blocks` → `the styleguide renders one block per component (eleven)`.
- in der `eventCards.test.js`-Zeile vor dem letzten ` |` ergänzen: `; \`events/cards.js\`: relative day (midnight, 13/14 days, clock change), running rule, date tile, time line, capacity (unlimited, 80 %, full, overbooked), status chips (unknown values give none), banner background, card content, escaping of admin texts, no emoji`.
- in der Zeile zu `e2e/styleguide.spec.js`: `all nine components` → `all components`.
Run: `npm run wiki && npm test 2>&1 | tail -4` → `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add public/js/events/cards.js public/css/components.css public/css/style.css public/js/pages/debug-components.js test/eventCards.test.js test/cssRules.test.js test/styleguide.test.js e2e/styleguide.spec.js docs/wiki
git commit -m "Add the event card, the date tile and the capacity bar

The new overview needs compact cards. They are pure functions in
events/cards.js, so tests and the styleguide use the same markup. The
date tile and the capacity bar go into the component library, because
the admin dashboard and the profile will reuse them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Kalender lädt selbst, Countdown zur Event-Seite

**Files:**
- Create: `public/js/events/calendar.js`, `test/eventCalendar.test.js`
- Modify: `public/js/events/list.js`, `public/js/events/detail.js`, `public/css/style.css` (`.calendar-day-more`), `test/actionAttributes.test.js`, `test/cssRules.test.js` (Obergrenze `style`-Attribute), `docs/wiki/modules/frontend-app.md`, `docs/wiki/ops/testing.md`

**Interfaces:**
- Produces (`events/calendar.js`): `CALENDAR_EVENTS_URL = '/api/events?limit=500'`, `calendarEvents` (null = nicht geladen), `calendarMonth`, `calendarYear`, `forgetCalendarEvents() → void`, `showCalendar() → Promise<void>`, `shiftCalendarMonth(delta) → void`, `calendarEntries(events) → Array<{ id, title, startDate }>`, `renderCalendar(events) → void`; Aktion `shiftCalendarMonth`.
- Produces (`events/detail.js`): `formatCountdown`, `renderCountdownHTML`, `startCountdown` (unverändert aus `list.js`).
- `events/list.js`: `switchView(view)` gibt bei `calendar` das Promise von `showCalendar()` zurück; `showEventsSection` ruft `forgetCalendarEvents()`.

- [ ] **Step 1: Failing tests**

`test/eventCalendar.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };
const CALENDAR_URL = '/api/events?limit=500';

// Days of the month shown first, so the test never depends on the date it runs
const today = new Date();
const inThisMonth = (day, hour = 19) => new Date(today.getFullYear(), today.getMonth(), day, hour).toISOString();

test('the calendar loads every event once and shows each series date', async () => {
    const events = [
        { id: 'past', title: 'Retro-Abend', startDate: inThisMonth(3) },
        { id: 's1', title: 'Training', seriesId: 'series', startDate: inThisMonth(15), seriesDates: [{ id: 's1', startDate: inThisMonth(15) }, { id: 's2', startDate: inThisMonth(22) }] }
    ];
    const { app, state, element, requests } = await loadFrontendApp({ [CALENDAR_URL]: { data: events, meta: {} } });
    state.currentUser = MEMBER;

    await app.showCalendar();
    const html = element('events-calendar').innerHTML;
    for (const route of ['event/past', 'event/s1', 'event/s2']) assert.ok(html.includes(`data-route="${route}"`), route);

    await app.showCalendar();
    assert.equal(requests.filter(request => request.url === CALENDAR_URL).length, 1, 'loaded once');
    app.forgetCalendarEvents();
    await app.showCalendar();
    assert.equal(requests.filter(request => request.url === CALENDAR_URL).length, 2, 'loaded again after forgetting');
});

test('a day with many events shows three and how many more', async () => {
    const events = [1, 2, 3, 4, 5].map(n => ({ id: `e${n}`, title: `Event ${n}`, startDate: inThisMonth(10, 10 + n) }));
    const { app, state, element } = await loadFrontendApp({ [CALENDAR_URL]: { data: events, meta: {} } });
    state.currentUser = MEMBER;
    await app.showCalendar();
    const html = element('events-calendar').innerHTML;
    assert.equal((html.match(/data-click="navigateTo"/g) || []).length, 3);
    assert.match(html, /<div class="calendar-day-event calendar-day-more">\+2 mehr<\/div>/);
    assert.doesNotMatch(html, /style="/);
});
```
In `test/actionAttributes.test.js`, Test `'the calendar arrows move one month in each direction'`: im Routen-Objekt die Zeile `'/api/events/categories': [],` ersetzen durch `'/api/events?limit=500': { data: [], meta: { total: 0, page: 1, limit: 500, totalPages: 0 } },`.

- [ ] **Step 2: Tests schlagen fehl**

Run: `npm test 2>&1 | grep -E "^not ok|# fail"`
Expected: beide Tests in `eventCalendar.test.js` (`app.showCalendar is not a function`).

- [ ] **Step 3: `events/calendar.js`**

`public/js/events/calendar.js`:
```js
/**
 * Calendar view of the event overview: loads every active event once (past
 * ones too, unlike the cards) and shows one month. A series shows each of
 * its dates on its own day.
 */
import { registerActions } from '../core/actions.js';
import { escapeHtml } from '../core/ui.js';

export const CALENDAR_EVENTS_URL = '/api/events?limit=500';

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MAX_EVENTS_PER_DAY = 3;

// null = not loaded since the overview was last opened
export let calendarEvents = null;

export let calendarMonth = new Date().getMonth();

export let calendarYear = new Date().getFullYear();

/**
 * Drop the loaded events, so the next showCalendar() asks the server again.
 * The overview calls it whenever it opens.
 *
 * @returns {void}
 */
export function forgetCalendarEvents() {
    calendarEvents = null;
}

/**
 * Load the events once and render the current month.
 *
 * @returns {Promise<void>}
 */
export async function showCalendar() {
    if (calendarEvents === null) {
        try {
            const res = await fetch(CALENDAR_EVENTS_URL);
            const result = await res.json();
            if (!res.ok || !Array.isArray(result.data)) throw new Error(result.error || 'Ungültige API-Antwort');
            calendarEvents = result.data;
        } catch (err) {
            console.error('Error loading calendar events:', err);
            renderCalendar([]);
            return;
        }
    }
    renderCalendar(calendarEvents);
}

/**
 * Show the previous or next month.
 *
 * @param {number} delta -> -1 or 1.
 * @returns {void}
 */
export function shiftCalendarMonth(delta) {
    calendarMonth += delta;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    renderCalendar(calendarEvents || []);
}

/**
 * One calendar entry per date: a series stands for all of its dates.
 *
 * @param {Array<Object>} events -> Events of GET /api/events.
 * @returns {Array<Object>} -> `{ id, title, startDate }` per date.
 */
export function calendarEntries(events) {
    return events.flatMap(event => (Array.isArray(event.seriesDates) && event.seriesDates.length > 0
        ? event.seriesDates.map(date => ({ id: date.id, title: event.title, startDate: date.startDate }))
        : [{ id: event.id, title: event.title, startDate: event.startDate }]));
}

/**
 * Render the month calendarMonth/calendarYear into #events-calendar.
 *
 * @param {Array<Object>} events -> Events of GET /api/events.
 * @returns {void}
 */
export function renderCalendar(events) {
    const container = document.getElementById('events-calendar');
    const today = new Date();
    const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const todayStr = dayKey(today);

    const eventsByDate = {};
    for (const entry of calendarEntries(events)) {
        if (!entry.startDate) continue;
        const key = dayKey(new Date(entry.startDate));
        (eventsByDate[key] ||= []).push(entry);
    }

    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    // getDay() counts from Sunday; the calendar starts on Monday
    const startDayOfWeek = (firstDay.getDay() + 6) % 7;
    const prevMonthDays = new Date(calendarYear, calendarMonth, 0).getDate();

    let html = `
    <div class="calendar-container">
      <div class="calendar-header">
        <button class="btn btn-sm btn-outline-light" data-click="shiftCalendarMonth" data-delta="-1">
          <i class="bi bi-chevron-left"></i>
        </button>
        <h4>${MONTH_NAMES[calendarMonth]} ${calendarYear}</h4>
        <button class="btn btn-sm btn-outline-light" data-click="shiftCalendarMonth" data-delta="1">
          <i class="bi bi-chevron-right"></i>
        </button>
      </div>
      <div class="calendar-grid">
    `;
    html += DAY_NAMES.map(name => `<div class="calendar-day-name">${name}</div>`).join('');

    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        html += `<div class="calendar-day other-month"><span class="day-number">${prevMonthDays - i}</span></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayEvents = eventsByDate[dateKey] || [];
        let eventsHtml = '';
        if (dayEvents.length > 0) {
            eventsHtml = '<div class="calendar-day-events">'
                + dayEvents.slice(0, MAX_EVENTS_PER_DAY).map(entry => `<div class="calendar-day-event" data-click="navigateTo" data-route="event/${escapeHtml(String(entry.id))}">${escapeHtml(String(entry.title ?? ''))}</div>`).join('')
                + (dayEvents.length > MAX_EVENTS_PER_DAY ? `<div class="calendar-day-event calendar-day-more">+${dayEvents.length - MAX_EVENTS_PER_DAY} mehr</div>` : '')
                + '</div>';
        }
        html += `<div class="calendar-day ${dateKey === todayStr ? 'today' : ''}">
            <span class="day-number">${day}</span>
            ${eventsHtml}
        </div>`;
    }

    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remainingCells; i++) {
        html += `<div class="calendar-day other-month"><span class="day-number">${i}</span></div>`;
    }

    html += '</div></div>';
    container.innerHTML = html;
}

registerActions({
    shiftCalendarMonth: (el) => shiftCalendarMonth(Number(el.dataset.delta))
});
```
In `public/css/style.css` direkt nach der Regel `.calendar-day-event { … }` einfügen:
```css

/* "+2 mehr": not a link, quieter than the events above it */
.calendar-day-more {
  opacity: 0.6;
  cursor: default;
}
```

- [ ] **Step 4: Countdown nach `detail.js`, Kalender aus `list.js`**

`public/js/events/detail.js`: die Zeile `import { startCountdown } from './list.js';` löschen. Nach `export function getEventGradient(eventId) { … }` diese drei Funktionen einfügen (wörtlich aus `list.js` übernommen):
```js

export function formatCountdown(targetDate) {
    const now = new Date();
    const target = new Date(targetDate);
    const diff = target - now;

    if (diff <= 0) return null;

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    return { days, hours, mins, secs };
}

export function renderCountdownHTML(cd) {
    if (!cd) return '<span class="countdown-expired"><i class="bi bi-clock-history me-1"></i>Event hat bereits begonnen</span>';
    return `
    <div class="countdown-item"><span class="countdown-value">${cd.days}</span><span class="countdown-label">Tage</span></div>
    <div class="countdown-item"><span class="countdown-value">${String(cd.hours).padStart(2, '0')}</span><span class="countdown-label">Std</span></div>
    <div class="countdown-item"><span class="countdown-value">${String(cd.mins).padStart(2, '0')}</span><span class="countdown-label">Min</span></div>
    <div class="countdown-item"><span class="countdown-value">${String(cd.secs).padStart(2, '0')}</span><span class="countdown-label">Sek</span></div>
  `;
}

export function startCountdown(element, targetDate) {
    let timer; // Declare first to avoid TDZ
    const update = () => {
        const cd = formatCountdown(targetDate);
        element.innerHTML = renderCountdownHTML(cd);
        if (!cd) {
            if (timer) clearInterval(timer);
            element.classList.remove('countdown-live');
            return false;
        }
        return true;
    };

    // Run once immediately
    if (update()) {
        timer = setInterval(update, 1000);
        state.countdownTimers.push(timer);
        return timer;
    }
}
```
`public/js/events/list.js`:
- Kopfkommentar → `Event overview: cards, categories, search, grid/calendar switch, series dates. The calendar lives in calendar.js, the countdown in detail.js.`
- Import `import { getEventGradient } from './detail.js';` → `import { getEventGradient, startCountdown } from './detail.js';` und darunter `import { forgetCalendarEvents, showCalendar } from './calendar.js';`
- Die Funktionen `formatCountdown`, `renderCountdownHTML`, `startCountdown` löschen.
- In `showEventsSection` direkt nach `section.style.display = 'block';` einfügen: `    forgetCalendarEvents();`
- `switchView` ersetzen:
```js
export async function switchView(view) {
    currentView = view;
    const gridBtn = document.getElementById('view-grid-btn');
    const calBtn = document.getElementById('view-calendar-btn');
    const grid = document.getElementById('events-grid');
    const calendar = document.getElementById('events-calendar');

    if (view === 'grid') {
        gridBtn.classList.add('active');
        calBtn.classList.remove('active');
        grid.style.display = '';
        calendar.style.display = 'none';
        return;
    }
    gridBtn.classList.remove('active');
    calBtn.classList.add('active');
    grid.style.display = 'none';
    calendar.style.display = '';
    await showCalendar();
}
```
- Alles ab `export let calendarMonth = …` bis einschließlich `renderCalendar` löschen (zieht nach `calendar.js`).
- In `registerActions` die Zeile `shiftCalendarMonth: (el) => shiftCalendarMonth(Number(el.dataset.delta))` löschen (Komma der Zeile davor entfernen).
- Prüfen: `grep -n "cachedEvents" public/js/events/list.js` → `cachedEvents` wird nur noch geschrieben; Zeile `cachedEvents = events;` und `export let cachedEvents = [];` löschen.

- [ ] **Step 5: Obergrenze der `style`-Attribute senken**

Das „+N mehr“ des Kalenders trug `style="opacity:0.6"` und nutzt jetzt `.calendar-day-more`.
Run: `node --experimental-vm-modules --test test/cssRules.test.js 2>&1 | grep -E "found [0-9]+ style"`
Expected: `found 122 style attributes`. In `test/cssRules.test.js` `const STYLE_ATTRIBUTE_BUDGET = 123;` → `const STYLE_ATTRIBUTE_BUDGET = 122;`.

- [ ] **Step 6: Tests grün**

Run: `npm test 2>&1 | tail -4` → `# fail 0` (der Import-Wächter aus D-01 meldet fehlende Importe, falls ein Name übersehen wurde).
Run: `npm run test:e2e 2>&1 | tail -3` → `24 passed`.
Run: `wc -l public/js/events/list.js` → unter 400.

- [ ] **Step 7: Wiki nachziehen**

`docs/wiki/modules/frontend-app.md`:
- Zeile `| \`events/list.js\` | overview | …` ersetzen durch:
```
| `events/list.js` | overview | `showEventsSection` (calls `forgetCalendarEvents`), `loadCategories`, `filterByCategory`, `debouncedSearch`, `switchView(view)` (calendar → `showCalendar`), `toggleSeriesDates`, `getParticipantWarningBadge`, `renderSlotChips` |
| `events/calendar.js` | calendar view of the overview | `showCalendar` (loads `CALENDAR_EVENTS_URL` = `/api/events?limit=500` once, past events included), `forgetCalendarEvents`, `calendarEntries` (one entry per series date), `renderCalendar`, `shiftCalendarMonth(delta)` |
```
- in der `events/detail.js`-Zeile nach `` `getEventGradient`, `` einfügen: `` `formatCountdown`, `renderCountdownHTML`, `startCountdown` (event page countdown), ``.
- im Absatz zu modul-lokalen Werten `` `activeCategory`, `cachedEvents`, `currentView`, `calendarMonth` `` → `` `activeCategory`, `currentView`, `calendarEvents`, `calendarMonth` ``.
`docs/wiki/ops/testing.md`: nach der `eventCards.test.js`-Zeile einfügen:
```
| `eventCalendar.test.js` | calendar view: loads `/api/events?limit=500` once (again after `forgetCalendarEvents`), every series date on its own day, three events per day plus "+N mehr" without a `style` attribute |
```
Run: `npm run wiki && npm test 2>&1 | tail -4` → `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add public/js/events/calendar.js public/js/events/list.js public/js/events/detail.js public/css/style.css test/eventCalendar.test.js test/actionAttributes.test.js test/cssRules.test.js docs/wiki
git commit -m "Let the calendar load its own events and move the countdown

The overview will only load upcoming events, but the calendar should
keep showing past ones, so it loads every event itself, once per visit.
Each series date now gets its own day. The countdown is only used by
the event page any more and moves there.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Übersicht neu

**Files:**
- Modify: `public/js/events/list.js` (neu geschrieben), `public/index.html` (Kopf der Übersicht), `public/css/style.css`, `routes/events.js` (`/categories` weg)
- Modify: `test/eventCards.test.js`, `test/actionAttributes.test.js`, `test/startup.test.js`, `test/devServer.test.js`, `test/cssRules.test.js`, `e2e/tour.spec.js`
- Modify: `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/routes-events.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/ops/testing.md`

**Interfaces:**
- Consumes: `renderEventCard`, `renderEventCardSkeletons` (Task 4); `showCalendar`, `forgetCalendarEvents` (Task 5); `emptyState` (`core/components.js`); `GET /api/events?upcoming=1` mit `myStatus` (Task 2)
- Produces (`events/list.js`): `UPCOMING_EVENTS_URL = '/api/events?upcoming=1&limit=100'`, `upcomingEvents`, `activeCategory`, `currentView`, `filterEvents(events, { category, search }) → Array`, `categoryCounts(events) → Array<{ name, count }>`, `renderOverview(now = new Date()) → void`, `filterByCategory(category)`, `resetEventFilters()`, `switchView(view) → Promise<void>`, `showEventsSection() → Promise<void>`; Aktionen `showEventsSection`, `filterByCategory`, `searchEvents`, `resetEventFilters`, `switchView`.

- [ ] **Step 1: Failing tests**

`test/eventCards.test.js`: oben nach den Konstanten ergänzen:
```js
const UPCOMING = '/api/events?upcoming=1&limit=100';
const page = (data) => ({ data, meta: { total: data.length, page: 1, limit: 100, totalPages: 1 } });
```
Den Test `'event cards in the overview show the preview, no Markdown'` ersetzen durch:
```js
test('the overview shows cards that link to the event, without the description', async () => {
    const { app, element, toasts, state, requests } = await loadFrontendApp({
        [UPCOMING]: page([
            event('game-night', GAME_NIGHT, { category: 'Gaming' }),
            event('raid', RAID, { category: 'Raid', seriesId: 'series-1', seriesDates: [{ id: 'raid', startDate: '2026-10-20T18:00:00.000Z' }, { id: 'raid-2', startDate: '2026-10-27T18:00:00.000Z' }] })
        ])
    });
    state.currentUser = ADMIN;
    await app.showEventsSection();

    const html = element('events-grid').innerHTML;
    assert.ok(html.includes('href="#event/game-night"'));
    assert.ok(html.includes('href="#event/raid"'));
    assert.ok(html.includes('Serie · 2 Termine'));
    assert.ok(!html.includes(GAME_NIGHT_PREVIEW), 'no description on the card');
    assert.deepEqual(requests.map(request => request.url), [UPCOMING]);
    assert.equal(element('events-empty').style.display, 'none');
    assert.deepEqual(toasts, []);
});
```
und am Dateiende anhängen:
```js
const overviewEvents = () => [
    event('a', 'Party-Games', { title: 'Spieleabend', category: 'Gaming' }),
    event('b', 'Koop', { title: 'Koop-Abend', category: 'Gaming' }),
    event('c', 'Bosse', { title: 'Schattenfestung', category: 'Raid' }),
    event('d', 'OBS', { title: 'Workshop', category: '' })
];
const links = (html) => [...html.matchAll(/href="#event\/([^"]+)"/g)].map(match => match[1]);

test('the category bar counts the upcoming events per category', async () => {
    const { app, element, state } = await loadFrontendApp({ [UPCOMING]: page(overviewEvents()) });
    state.currentUser = ADMIN;
    await app.showEventsSection();
    const bar = element('category-filter-bar').innerHTML;
    const chips = [...bar.matchAll(/data-category="([^"]*)">([^<]*) <span class="chip-count">(\d+)<\/span>/g)].map(match => [match[1], match[2], Number(match[3])]);
    assert.deepEqual(chips, [['', 'Alle', 4], ['Gaming', 'Gaming', 2], ['Raid', 'Raid', 1]]);
    assert.match(bar, /class="chip active" data-click="filterByCategory" data-category=""/);
});

test('search and category filter in the browser, without a new request', async () => {
    const { app, element, state, requests } = await loadFrontendApp({ [UPCOMING]: page(overviewEvents()) });
    state.currentUser = ADMIN;
    await app.showEventsSection();

    await app.runAction('filterByCategory', { dataset: { category: 'Gaming' } });
    assert.deepEqual(links(element('events-grid').innerHTML), ['a', 'b']);

    element('events-search').value = 'KOOP';
    await app.runAction('searchEvents', element('events-search'));
    assert.deepEqual(links(element('events-grid').innerHTML), ['b'], 'title, case-insensitive');

    element('events-search').value = 'obs';
    await app.runAction('filterByCategory', { dataset: { category: '' } });
    assert.deepEqual(links(element('events-grid').innerHTML), ['d'], 'description');

    element('events-search').value = 'raid';
    await app.runAction('searchEvents', element('events-search'));
    assert.deepEqual(links(element('events-grid').innerHTML), ['c'], 'category');

    assert.deepEqual(requests.map(request => request.url), [UPCOMING]);
});

test('no match offers to reset search and category', async () => {
    const { app, element, state } = await loadFrontendApp({ [UPCOMING]: page(overviewEvents()) });
    state.currentUser = ADMIN;
    await app.showEventsSection();
    await app.runAction('filterByCategory', { dataset: { category: 'Raid' } });
    element('events-search').value = 'nichts';
    await app.runAction('searchEvents', element('events-search'));

    assert.equal(element('events-grid').innerHTML, '');
    assert.equal(element('events-empty').style.display, 'block');
    assert.match(element('events-empty').innerHTML, /Keine Treffer/);
    assert.match(element('events-empty').innerHTML, /data-click="resetEventFilters"/);

    await app.runAction('resetEventFilters', {});
    assert.equal(element('events-search').value, '');
    assert.deepEqual(links(element('events-grid').innerHTML), ['a', 'b', 'c', 'd']);
    assert.equal(element('events-empty').style.display, 'none');
});

test('a chosen category without events any more falls back to all', async () => {
    let data = overviewEvents();
    const { app, element, state } = await loadFrontendApp({ [UPCOMING]: () => page(data) });
    state.currentUser = ADMIN;
    await app.showEventsSection();
    await app.runAction('filterByCategory', { dataset: { category: 'Raid' } });
    assert.deepEqual(links(element('events-grid').innerHTML), ['c']);

    data = overviewEvents().filter(entry => entry.category !== 'Raid');
    await app.showEventsSection();
    assert.deepEqual(links(element('events-grid').innerHTML), ['a', 'b', 'd']);
    assert.match(element('category-filter-bar').innerHTML, /class="chip active" data-click="filterByCategory" data-category=""/);
});

test('the overview says when there is nothing or when loading failed', async () => {
    const empty = await loadFrontendApp({ [UPCOMING]: page([]) });
    empty.state.currentUser = ADMIN;
    await empty.app.showEventsSection();
    assert.match(empty.element('events-empty').innerHTML, /Keine anstehenden Events/);
    assert.equal(empty.element('category-filter-bar').innerHTML, '');

    // Unknown URL -> 404 in the test harness
    const failed = await loadFrontendApp({});
    failed.state.currentUser = ADMIN;
    await failed.app.showEventsSection();
    assert.match(failed.element('events-empty').innerHTML, /Events konnten nicht geladen werden/);
    assert.match(failed.element('events-empty').innerHTML, /data-click="showEventsSection"/);
    assert.doesNotMatch(failed.element('events-empty').innerHTML, /Console/);
});
```
`test/actionAttributes.test.js`, den Test `'the overview opens events and filters categories through actions'` ersetzen durch:
```js
test('the overview links events and filters categories through actions', async () => {
    const solo = adminEvent('solo', { title: 'Solo', category: TRICKY_TEXT });
    const series = adminEvent('s1', { title: 'Serie', category: 'Training', seriesId: 'series-1', seriesDates: [{ id: 's1', startDate: '2026-10-20T18:00:00.000Z' }, { id: 's2', startDate: '2026-10-27T18:00:00.000Z' }] });
    const { app, state, element, requests } = await loadFrontendApp({
        '/api/events?upcoming=1&limit=100': { data: [solo, series], meta: { total: 2, page: 1, limit: 100, totalPages: 1 } }
    });
    state.currentUser = MEMBER;
    await app.showEventsSection();
    const grid = element('events-grid').innerHTML;
    const bar = element('category-filter-bar').innerHTML;
    assertNoInlineHandlers(grid);
    assertNoInlineHandlers(bar);
    assert.deepEqual(elementsWith(grid, 'href').map(link => link.attributes.href), ['#event/solo', '#event/s1']);

    const pill = actionTargets(bar, 'filterByCategory').find(target => target.attributes['data-category'] === TRICKY_TEXT);
    await app.runAction('filterByCategory', actionElement(pill));
    assert.deepEqual(elementsWith(element('events-grid').innerHTML, 'href').map(link => link.attributes.href), ['#event/solo'], 'filters by the exact category');
    assert.equal(requests.length, 1, 'filtering asks the server nothing');
});
```
Im Test `'the calendar arrows move one month in each direction'` die Zeile `'/api/events': { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } }` löschen (das Komma der Zeile davor ebenfalls).
`test/startup.test.js`, in `startupRoutes`: die Zeilen `'/api/events/categories': [],` und `'/api/events': { … },` ersetzen durch:
```js
    '/api/events?upcoming=1&limit=100': { data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 0 } },
```
`test/devServer.test.js`, Test `'the event API answers only logged-in users'`: `'/api/events', '/api/events/categories',` → `'/api/events',`; nach diesem Test einfügen:
```js
test('the category list of all events is gone', async () => {
    // It also showed the categories of drafts and archived events to members
    const res = await (await loginAs('member')).request('/api/events/categories');
    assert.equal(res.status, 404);
});
```
`test/cssRules.test.js`: in `MOVED` die letzte Zeile
```js
    '.skeleton', '.skeleton-text', '.skeleton-title', '.skeleton-img'
```
ersetzen durch:
```js
    '.skeleton', '.skeleton-text', '.skeleton-title', '.skeleton-img',
    // Old overview cards, dropped by D-04
    '.event-banner-placeholder', '.event-card-header-row', '.event-card-mini-progress', '.event-card-capacity-label',
    '.series-card', '.slot-chips', '.slot-chip', '.spots-warning', '.spots-full'
```
`e2e/tour.spec.js`: beide Selektoren `'#category-filter-bar .category-pill'` → `'#category-filter-bar .chip'`.

- [ ] **Step 2: Tests schlagen fehl**

Run: `npm test 2>&1 | grep -E "^not ok|# fail"`
Expected: die neuen Übersichts-Tests, der Action-Test, `the category list of all events is gone` (200 statt 404) und `style.css does not style moved component selectors again` schlagen fehl.

- [ ] **Step 3: `events/list.js` neu**

`public/js/events/list.js` vollständig ersetzen:
```js
/**
 * Event overview (#events): loads the upcoming events once, filters them by
 * category and search in the browser and renders the cards of cards.js.
 * The calendar view lives in calendar.js.
 */
import { registerActions } from '../core/actions.js';
import { emptyState } from '../core/components.js';
import { escapeHtml } from '../core/ui.js';
import { forgetCalendarEvents, showCalendar } from './calendar.js';
import { renderEventCard, renderEventCardSkeletons } from './cards.js';

export const UPCOMING_EVENTS_URL = '/api/events?upcoming=1&limit=100';

const SKELETON_CARDS = 6;
const RETRY_BUTTON = '<button type="button" class="btn btn-secondary btn-sm" data-click="showEventsSection">Erneut versuchen</button>';
const RESET_BUTTON = '<button type="button" class="btn btn-secondary btn-sm" data-click="resetEventFilters">Filter zurücksetzen</button>';

export let upcomingEvents = [];

export let activeCategory = '';

export let currentView = 'grid';

/**
 * Events that match the chosen category and the search text.
 *
 * @param {Array<Object>} events -> Upcoming events.
 * @param {Object} [filter] -> `{ category, search }`; empty values match everything.
 * @returns {Array<Object>} -> Matching events in their order; the search looks at title, description and category, case-insensitive.
 */
export function filterEvents(events, { category = '', search = '' } = {}) {
    const needle = search.trim().toLowerCase();
    return events.filter(event => (!category || event.category === category)
        && (!needle || [event.title, event.description, event.category].some(text => String(text ?? '').toLowerCase().includes(needle))));
}

/**
 * Number of events per category.
 *
 * @param {Array<Object>} events -> Upcoming events.
 * @returns {Array<{ name: string, count: number }>} -> Categories that have events, sorted by name; events without a category are left out.
 */
export function categoryCounts(events) {
    const counts = new Map();
    for (const event of events) {
        if (event.category) counts.set(event.category, (counts.get(event.category) || 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function searchText() {
    return document.getElementById('events-search')?.value?.trim() || '';
}

function renderCategoryBar() {
    const bar = document.getElementById('category-filter-bar');
    const counts = categoryCounts(upcomingEvents);
    // A category without upcoming events any more would leave an empty list without a chip to leave it
    if (activeCategory && !counts.some(entry => entry.name === activeCategory)) activeCategory = '';
    if (counts.length === 0) {
        bar.innerHTML = '';
        return;
    }
    const chip = (value, label, count) => `<button type="button" class="chip${activeCategory === value ? ' active' : ''}" data-click="filterByCategory" data-category="${escapeHtml(value)}">${escapeHtml(label)} <span class="chip-count">${count}</span></button>`;
    bar.innerHTML = [chip('', 'Alle', upcomingEvents.length), ...counts.map(entry => chip(entry.name, entry.name, entry.count))].join('');
}

/**
 * Set each card's own banner colour (data-banner-bg) as a CSS variable;
 * an inline style attribute would need the CSP's 'unsafe-inline'.
 *
 * @param {Element} grid -> #events-grid.
 * @returns {void}
 */
function applyBannerColors(grid) {
    grid.querySelectorAll('[data-banner-bg]').forEach(media => media.style.setProperty('--event-banner-bg', media.dataset.bannerBg));
}

/**
 * Render category bar and cards from the loaded events.
 *
 * @param {Date} [now] -> Reference time for "Heute" and "Läuft gerade".
 * @returns {void}
 */
export function renderOverview(now = new Date()) {
    const grid = document.getElementById('events-grid');
    const empty = document.getElementById('events-empty');
    renderCategoryBar();
    const visible = filterEvents(upcomingEvents, { category: activeCategory, search: searchText() });
    if (visible.length === 0) {
        grid.innerHTML = '';
        empty.innerHTML = upcomingEvents.length === 0
            ? emptyState({ icon: 'calendar-x', title: 'Keine anstehenden Events', text: 'Sobald ein Event geplant ist, erscheint es hier.' })
            : emptyState({ icon: 'search', title: 'Keine Treffer', text: 'Kein anstehendes Event passt zu Suche und Kategorie.', action: RESET_BUTTON });
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';
    grid.innerHTML = visible.map(event => renderEventCard(event, now)).join('');
    applyBannerColors(grid);
}

function showLoadError(status) {
    const empty = document.getElementById('events-empty');
    document.getElementById('events-grid').innerHTML = '';
    document.getElementById('category-filter-bar').innerHTML = '';
    empty.innerHTML = status === 429
        ? emptyState({ icon: 'clock-history', title: 'Zu viele Anfragen', text: 'Bitte warte einen Moment und versuche es dann erneut.', action: RETRY_BUTTON })
        : emptyState({ icon: 'exclamation-triangle', title: 'Events konnten nicht geladen werden', text: 'Bitte versuche es gleich noch einmal.', action: RETRY_BUTTON });
    empty.style.display = 'block';
}

/**
 * Open the overview: load the upcoming events once and render them.
 *
 * @returns {Promise<void>}
 */
export async function showEventsSection() {
    document.getElementById('events-section').style.display = 'block';
    forgetCalendarEvents();
    document.getElementById('events-empty').style.display = 'none';
    document.getElementById('events-grid').innerHTML = renderEventCardSkeletons(SKELETON_CARDS);

    try {
        const res = await fetch(UPCOMING_EVENTS_URL);
        if (!res.ok) {
            showLoadError(res.status);
            return;
        }
        const result = await res.json();
        if (!Array.isArray(result.data)) throw new Error('Ungültige API-Antwort');
        upcomingEvents = result.data;
    } catch (err) {
        console.error('Error loading events:', err);
        showLoadError(0);
        return;
    }

    renderOverview();
    gsap.fromTo('#events-grid .event-card', { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, stagger: 0.04, ease: 'power2.out' });
    if (currentView === 'calendar') await showCalendar();
}

/**
 * Show only one category ('' = all).
 *
 * @param {string} category -> Category text.
 * @returns {void}
 */
export function filterByCategory(category) {
    activeCategory = category;
    renderOverview();
}

/**
 * Clear search and category.
 *
 * @returns {void}
 */
export function resetEventFilters() {
    activeCategory = '';
    const search = document.getElementById('events-search');
    if (search) search.value = '';
    renderOverview();
}

/**
 * Switch between cards and calendar.
 *
 * @param {string} view -> "grid" or "calendar".
 * @returns {Promise<void>} -> Resolves once the calendar is rendered.
 */
export async function switchView(view) {
    currentView = view;
    const gridBtn = document.getElementById('view-grid-btn');
    const calBtn = document.getElementById('view-calendar-btn');
    const grid = document.getElementById('events-grid');
    const calendar = document.getElementById('events-calendar');

    if (view === 'grid') {
        gridBtn.classList.add('active');
        calBtn.classList.remove('active');
        grid.style.display = '';
        calendar.style.display = 'none';
        return;
    }
    gridBtn.classList.remove('active');
    calBtn.classList.add('active');
    grid.style.display = 'none';
    calendar.style.display = '';
    await showCalendar();
}

registerActions({
    showEventsSection: () => showEventsSection(),
    filterByCategory: (el) => filterByCategory(el.dataset.category),
    searchEvents: () => renderOverview(),
    resetEventFilters: () => resetEventFilters(),
    switchView: (el) => switchView(el.dataset.view)
});
```

- [ ] **Step 4: Kopf der Übersicht in `index.html`**

In `public/index.html` den Block von `<!-- Search & View Toggle -->` bis einschließlich des schließenden `</div>` von `id="events-empty"` ersetzen. Alt:
```html
        <!-- Search & View Toggle -->
        <div class="d-flex flex-wrap gap-3 align-items-center mb-3">
          <div class="flex-grow-1 position-relative">
            <i class="bi bi-search position-absolute"
              style="left:12px;top:50%;transform:translateY(-50%);color:var(--text-secondary);"></i>
            <input type="search" class="form-control" id="events-search" placeholder="Events durchsuchen..."
              style="padding-left:36px;" data-input="debouncedSearch">
          </div>
          <div class="btn-group" role="group">
            <button type="button" class="btn btn-outline-light btn-sm active" id="view-grid-btn"
              data-click="switchView" data-view="grid">
              <i class="bi bi-grid-3x3-gap"></i>
            </button>
            <button type="button" class="btn btn-outline-light btn-sm" id="view-calendar-btn"
              data-click="switchView" data-view="calendar">
              <i class="bi bi-calendar3"></i>
            </button>
          </div>
        </div>

        <!-- Category Filter -->
        <div class="category-filter-bar" id="category-filter-bar">
          <!-- Dynamically populated -->
        </div>
        <div class="row g-4" id="events-grid">
          <!-- Events render here -->
        </div>
        <div id="events-calendar" style="display:none;">
          <!-- Calendar renders here -->
        </div>
        <div id="events-empty" class="text-center py-5" style="display:none;">
          <i class="bi bi-calendar-x" style="font-size:3rem;color:var(--accent);"></i>
          <p class="text-secondary mt-3">Aktuell keine Events vorhanden.</p>
        </div>
```
Neu:
```html
        <!-- Search and view switch -->
        <div class="events-toolbar">
          <div class="events-search">
            <i class="bi bi-search events-search-icon" aria-hidden="true"></i>
            <input type="search" class="form-control" id="events-search" placeholder="Events durchsuchen …"
              aria-label="Events durchsuchen" data-input="searchEvents">
          </div>
          <div class="btn-group" role="group" aria-label="Ansicht">
            <button type="button" class="btn btn-outline-light btn-sm active" id="view-grid-btn"
              data-click="switchView" data-view="grid" title="Karten">
              <i class="bi bi-grid-3x3-gap"></i>
            </button>
            <button type="button" class="btn btn-outline-light btn-sm" id="view-calendar-btn"
              data-click="switchView" data-view="calendar" title="Kalender">
              <i class="bi bi-calendar3"></i>
            </button>
          </div>
        </div>

        <!-- Category chips with counts (events/list.js); one line, scrolls sideways on phones -->
        <div class="category-filter-bar" id="category-filter-bar" role="group" aria-label="Kategorien"></div>
        <!-- Cards (events/cards.js) -->
        <div class="event-grid" id="events-grid"></div>
        <div id="events-calendar" style="display:none;"></div>
        <!-- Empty, no match or load error (emptyState) -->
        <div id="events-empty" style="display:none;"></div>
```

- [ ] **Step 5: CSS der Übersicht**

In `public/css/style.css`:

(a) Den Block von `/* EVENT CARDS                                 */` bis zum Ende der Regel `.event-card p { … }` ersetzen. Alt (Kopf plus sechs Regeln):
```css
/* ═══════════════════════════════════════════ */
/* EVENT CARDS                                 */
/* ═══════════════════════════════════════════ */
.event-card {
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
```
… bis einschließlich
```css
.event-card p {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```
Neu:
```css
/* ═══════════════════════════════════════════ */
/* EVENT CARDS                                 */
/* Overview (#events), renderEventCard() in    */
/* events/cards.js: a row on phones, a tile    */
/* with the banner on top from 768 px          */
/* ═══════════════════════════════════════════ */
.events-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-12);
  margin-bottom: var(--space-12);
}

.events-search {
  position: relative;
  flex: 1 1 14rem;
}

.events-search-icon {
  position: absolute;
  top: 50%;
  left: var(--space-12);
  transform: translateY(-50%);
  color: var(--text-secondary);
  pointer-events: none;
}

.events-search .form-control {
  padding-left: 2.25rem;
}

.event-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-8);
}

.event-card {
  /* Behind the banner and instead of a broken one; list.js sets the event's own colour */
  --event-banner-bg: linear-gradient(135deg, var(--accent-dark), var(--accent));
  display: grid;
  grid-template-areas: "date body media";
  grid-template-columns: auto minmax(0, 1fr) 6.5rem;
  gap: var(--space-12);
  align-items: start;
  padding: var(--space-12);
  color: var(--text-primary);
  text-decoration: none;
}

/* The link colour of the Bootstrap bridge must not tint the whole card */
.event-card:hover {
  color: var(--text-primary);
}

.event-card > .date-tile,
.event-card-skeleton-date {
  grid-area: date;
}

.event-card-media,
.event-card-skeleton-media {
  grid-area: media;
  position: relative;
  align-self: stretch;
  min-height: 3.75rem;
  overflow: hidden;
  border-radius: var(--radius-sm);
}

.event-card-media {
  background: var(--event-banner-bg);
}

.event-card-banner {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Category on the banner: dark scrim, so it reads on every image */
.event-card-category {
  position: absolute;
  bottom: var(--space-4);
  left: var(--space-4);
  max-width: calc(100% - var(--space-8));
  border-color: var(--border-strong);
  background: var(--bg-scrim);
  color: var(--text-primary);
}

.event-card-category span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-card-body {
  grid-area: body;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.event-card-title {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--font-size-md);
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.event-card-when {
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-card-when strong {
  color: var(--text-primary);
  font-weight: 600;
}

.event-card-when.is-live strong {
  color: var(--danger);
}

.event-card-facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4) var(--space-8);
  margin-top: var(--space-4);
}

.event-card-facts .capacity {
  flex: 1 1 7rem;
}

.event-card-skeleton-date {
  width: 3.25rem;
  height: 3.75rem;
  border-radius: var(--radius-sm);
}

@media (min-width: 768px) {
  .event-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-16);
  }

  .event-card {
    grid-template-areas:
      "media media"
      "date body";
    grid-template-columns: auto minmax(0, 1fr);
    padding: 0 var(--space-12) var(--space-12);
    overflow: hidden;
  }

  .event-card-media,
  .event-card-skeleton-media {
    height: 7.5rem;
    margin: 0 calc(-1 * var(--space-12));
    border-radius: 0;
  }
}

@media (min-width: 1200px) {
  .event-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
```
(b) Die Regel `.series-card { cursor: default; }` samt Leerzeile löschen.
(c) Den Block CATEGORY PILLS ersetzen. Alt:
```css
/* ═══════════════════════════════════════════ */
/* CATEGORY PILLS                              */
/* ═══════════════════════════════════════════ */
.category-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}
```
Neu:
```css
/* ═══════════════════════════════════════════ */
/* CATEGORY PILLS                              */
/* Filter chips of the overview: one line that */
/* scrolls sideways on phones, wraps from 768  */
/* ═══════════════════════════════════════════ */
.category-filter-bar {
  display: flex;
  gap: var(--space-8);
  margin-bottom: var(--space-16);
  padding-bottom: var(--space-4);
  overflow-x: auto;
  scrollbar-width: none;
}

.category-filter-bar::-webkit-scrollbar {
  display: none;
}

.category-filter-bar .chip {
  flex: none;
}

.chip-count {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

@media (min-width: 768px) {
  .category-filter-bar {
    flex-wrap: wrap;
    overflow-x: visible;
  }
}
```
(d) Im Block RESPONSIVE in `@media (max-width: 480px)` die Regel `.category-filter-bar { gap: 0.3rem; }` samt Leerzeile löschen.
(e) Den Abschnitt `/* ─── Participant Warning Badges ─────────────── */` mit `.spots-warning`, `.spots-full` und `@keyframes pulse-warning` löschen (bis vor `/* ─── Calendar View ──────────────────────────── */`).
(f) Die beiden Blöcke `EVENT CARD — GRADIENT PLACEHOLDER` und `EVENT CARD — UPDATED LAYOUT` (`.event-banner-placeholder` bis `.event-card-capacity-label { … }`) löschen, bis vor `/* DEBUG / STYLING GUIDE */`.
(g) Die Regeln `.slot-chips`, `.slot-chip`, `.slot-chip.full` löschen (zwischen der `@media (max-width: 576px)`-Regel des Slot-Editors und `.slot-picker`).
Prüfen: `grep -n -E "series-card|spots-|slot-chip|event-banner-placeholder|event-card-(header|date|mini|capacity)|pulse-warning" public/css/style.css public/js -r` → keine Treffer.

- [ ] **Step 6: Endpunkt `/categories` entfernen**

In `routes/events.js` den Block von `/**\n * GET /api/events/categories — Get all unique categories` bis zum Ende seines Handlers (`});`) löschen. Prüfen: `grep -rn "events/categories" routes public test` → keine Treffer.

- [ ] **Step 7: Obergrenzen nachmessen**

Run: `node --experimental-vm-modules --test test/cssRules.test.js 2>&1 | grep -E "found [0-9]+"`
Expected: `found 116 style attributes …` und `found 30 !important …` (3 Attribute aus `index.html` und 3 aus dem alten `list.js` sind weg; die 6 `!important` der alten Plätze-Warnung ebenfalls). In `test/cssRules.test.js` `STYLE_ATTRIBUTE_BUDGET = 122` → `116`, `IMPORTANT_BUDGET = 36` → `30` (die gemessenen Werte eintragen, falls sie abweichen; größer als vorher dürfen sie nicht sein).

- [ ] **Step 8: Tests grün**

Run: `npm test 2>&1 | tail -4` → `# fail 0`.
Run: `npm run test:e2e 2>&1 | tail -3` → `24 passed`.
Run: `wc -l public/js/events/list.js` → unter 250.

- [ ] **Step 9: Wiki nachziehen**

`docs/wiki/modules/frontend-app.md`, Zeile `events/list.js` ersetzen:
```
| `events/list.js` | overview | `showEventsSection` (loads `UPCOMING_EVENTS_URL` = `/api/events?upcoming=1&limit=100` once, skeleton cards, load error/429 with "Erneut versuchen", calls `forgetCalendarEvents`), `renderOverview(now)`, `filterEvents(events, { category, search })` (title, description, category), `categoryCounts(events)`, `filterByCategory`, `resetEventFilters`, `switchView(view)`; actions `showEventsSection`, `filterByCategory`, `searchEvents`, `resetEventFilters`, `switchView`; the banner colour goes from `data-banner-bg` into `--event-banner-bg` via `style.setProperty` |
```
`docs/wiki/modules/frontend-markup.md`:
- In der Zeile „`style.css` blocks“: `EVENT CARDS (+ Event Series, Rendered Markdown) → COUNTDOWN → CATEGORY PILLS (filter bar)` → `EVENT CARDS (overview: toolbar, grid, card; + Event Series, Rendered Markdown) → COUNTDOWN (event page) → CATEGORY PILLS (filter chips, one line on phones)`; `→ EASYMDE CUSTOMIZATION → Participant Warning Badges → Calendar View` → `→ EASYMDE CUSTOMIZATION → Calendar View`; ` → LOCATION AUTOCOMPLETE → EVENT CARD (gradient placeholder, updated layout) → DEBUG / STYLING GUIDE` → ` → LOCATION AUTOCOMPLETE → DEBUG / STYLING GUIDE`.
- Unter `## Rules` nach dem Punkt „Hover feedback …“ ergänzen:
```
- The event overview card is a link (`a.glass-card.event-card`), not a `data-click` element: middle click opens a tab and the keyboard reaches it.
```
`docs/wiki/modules/routes-events.md`: die Zeile `| GET | \`/categories\` | user | sorted unique \`category\` values of ALL events |` löschen; im Abschnitt „Route order“ `` `/series/:seriesId`, `/categories` and `/form-options` `` → `` `/series/:seriesId` and `/form-options` ``.
`docs/wiki/reference/api-index.md`: die Zeile `| GET | \`/api/events/categories\` | U |` löschen.
`docs/wiki/ops/testing.md`: in der `eventCards.test.js`-Zeile `overview, admin and Discord import cards show no raw Markdown` → `admin and Discord import cards show no raw Markdown; the overview: cards link to the event without the description, one request, category bar with counts, search/category filter in the browser, reset, a vanished category falls back to all, empty and error states`.
Run: `npm run wiki && npm test 2>&1 | tail -4` → `# fail 0`.

- [ ] **Step 10: Browser-Sichtprüfung**

```bash
node data/d04/shots.js check
```
Expected: `mobile: < 2219 px, 7 cards` (halb so lang wie vorher), `desktop: … px, 7 cards`. `data/d04/check-mobile.png` und `check-desktop.png` ansehen: Zeilen mit Kachel links und Banner rechts, Workshop mit Farbverlauf statt Bild, „Läuft gerade“ oben, Desktop drei Spalten mit Banner oben, keine Emojis.

- [ ] **Step 11: Commit**

```bash
git add public/js/events/list.js public/index.html public/css/style.css routes/events.js test/eventCards.test.js test/actionAttributes.test.js test/startup.test.js test/devServer.test.js test/cssRules.test.js e2e/tour.spec.js docs/wiki
git commit -m "Rebuild the event overview around compact cards

On a phone the old cards fit one and a half events on a screen and
showed a past event at the top. The overview now loads the upcoming
events once, shows rows with date tile, banner, capacity and the own
status (tiles with the banner on top from 768 px) and filters category
and search in the browser. The category endpoint goes, because nothing
uses it and it showed categories of drafts to members.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Emoji-Regel und Obergrenze

**Files:**
- Modify: `test/cssRules.test.js`, `CLAUDE.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/ops/testing.md`

**Interfaces:**
- Produces: Konstante `EMOJI_BUDGET` in `test/cssRules.test.js`, die spätere Tickets senken.

- [ ] **Step 1: Test mit falscher Obergrenze**

In `test/cssRules.test.js` nach `const IMPORTANT_BUDGET = 30;` einfügen:
```js
// Emojis in index.html and the modules. Symbols are Bootstrap Icons (bi-*);
// lower the number when a page drops some, never raise it. Emojis that users
// type in (slot emojis) are data, not source, and do not count.
const EMOJI_BUDGET = 0;
const EMOJI = /\p{Extended_Pictographic}/gu;
```
und am Dateiende:
```js
test('the number of emojis in the frontend matches its budget', () => {
    const count = [INDEX_HTML, ...frontendSources().map(entry => entry.source)]
        .reduce((sum, source) => sum + (source.match(EMOJI) || []).length, 0);
    assert.equal(count, EMOJI_BUDGET, `found ${count} emojis; lower EMOJI_BUDGET if you removed some, otherwise use a Bootstrap icon (bi-*)`);
});
```

- [ ] **Step 2: Messen**

Run: `node --experimental-vm-modules --test test/cssRules.test.js 2>&1 | grep -E "found [0-9]+ emojis"`
Expected: `found 40 emojis` (Stand vor D-04; die neue Übersicht bringt keine). Ist die Zahl größer als 40, hat ein früherer Task eines eingeführt: `git diff main -- public | grep '^+' | grep -P '\p{Extended_Pictographic}'` und durch ein Icon ersetzen.

- [ ] **Step 3: Obergrenze eintragen**

`const EMOJI_BUDGET = 0;` → `const EMOJI_BUDGET = 40;`
Run: `npm test 2>&1 | tail -4` → `# fail 0`.

- [ ] **Step 4: Regel aufschreiben**

`CLAUDE.md`, Regel „**Styles:**“: am Ende des Punkts (nach `No new \`style="…"\` attributes.`) anhängen: ` Symbols are Bootstrap Icons (\`bi-*\`), never emojis (only emojis users type in, e.g. slot emojis); \`npm test\` counts them.`
`docs/wiki/modules/frontend-markup.md`, unter `## Rules` nach dem Punkt zu den `style`-Attributen:
```
- Symbols are Bootstrap Icons (`<i class="bi bi-…">`), never emojis; only emojis that users type in (slot emojis, Discord names) appear. `test/cssRules.test.js` counts the emojis left in `index.html` and `public/js` (budget, D-05 to D-08 lower it).
```
`docs/wiki/ops/testing.md`, in der `cssRules.test.js`-Zeile `budgets for \`style\` attributes and for \`!important\` in \`style.css\`` → `budgets for \`style\` attributes, for \`!important\` in \`style.css\` and for emojis in the frontend`.
Run: `npm run wiki && npm test 2>&1 | tail -4` → `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/cssRules.test.js CLAUDE.md docs/wiki
git commit -m "Write down that symbols are icons and count the emojis left

Emojis render differently on every system and clash with the icon
set. The rule was only implied so far; now CLAUDE.md and the wiki say
it, and a budget test keeps new emojis out while the page tickets
remove the remaining 40.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Browser-Test der Übersicht, Abschluss

**Files:**
- Create: `e2e/events.spec.js`, `data/d04/mr.md` (nicht im Repo)
- Modify: `docs/wiki/ops/testing.md`, ggf. `CLAUDE.md` (Zeilenzahlen)

- [ ] **Step 1: Browser-Test**

`e2e/events.spec.js`:
```js
/**
 * Event overview (D-04): compact rows on the phone, three columns on the
 * desktop, only upcoming events, banners with fallback, the own status per
 * persona. Seed data: dev/seedData.js (dev mock mode).
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs } = require('./helpers');

const cards = (page) => page.locator('#events-grid .event-card');
const card = (page, title) => cards(page).filter({ hasText: title });

test('the phone shows at least four events at once and nothing sticks out', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone layout');
    const errors = watchErrors(page);
    await loginAs(page, 'raider');
    await expect(cards(page).first()).toBeVisible();

    const height = page.viewportSize().height;
    const tops = await cards(page).evaluateAll(list => list.map(element => element.getBoundingClientRect().top));
    expect(tops.filter(top => top < height).length).toBeGreaterThanOrEqual(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // The category bar stays one line and scrolls sideways
    const bar = await page.locator('#category-filter-bar').evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, height: element.offsetHeight }));
    expect(bar.scrollWidth).toBeGreaterThan(bar.clientWidth);
    expect(bar.height).toBeLessThan(48);
    expect(errors).toEqual([]);
});

test('the desktop shows three columns with the banner on top', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
    await loginAs(page, 'raider');
    await expect(cards(page).first()).toBeVisible();
    const columns = await page.locator('#events-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(3);
    const first = cards(page).first();
    const media = await first.locator('.event-card-media').boundingBox();
    const tile = await first.locator('.date-tile').boundingBox();
    expect(media.y + media.height).toBeLessThanOrEqual(tile.y);
});

test('only upcoming events show, the running one first', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'raider');
    await expect(cards(page).first()).toContainText('Live: Speedrun-Marathon');
    await expect(cards(page).first()).toContainText('Läuft gerade');
    await expect(page.locator('#events-grid')).not.toContainText('Retro-Spieleabend');
    expect(errors).toEqual([]);
});

const MARKERS = [
    ['raider', 'Community-Spieleabend', 'Angemeldet'],
    ['member', 'Koop-Abend (5 Plätze)', 'Warteliste'],
    ['member', 'Turnier: Arena-Cup', 'Ausstehend'],
    ['newbie', 'Workshop: Streaming-Setup', 'Als Gast']
];
for (const [persona, title, marker] of MARKERS) {
    test(`${persona} sees "${marker}" on ${title}`, async ({ page }) => {
        await loginAs(page, persona);
        await expect(card(page, title)).toContainText(marker);
    });
}

test('banners load, a broken one gives way to the event colour', async ({ page }) => {
    await loginAs(page, 'raider');
    const banner = card(page, 'Community-Spieleabend').locator('img.event-card-banner');
    await banner.scrollIntoViewIfNeeded();
    await expect.poll(() => banner.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);

    const broken = card(page, 'Workshop: Streaming-Setup');
    await broken.scrollIntoViewIfNeeded();
    await expect(broken.locator('img.event-card-banner')).toHaveCSS('display', 'none');
    const background = await broken.locator('.event-card-media').evaluate(media => getComputedStyle(media).backgroundImage);
    expect(background).toContain('gradient');
});
```
Run: `npm run test:e2e 2>&1 | tail -3`
Expected: `38 passed` und `2 skipped`. Die neue Datei hat 8 Tests und läuft in beiden Projekten (16). Je Projekt wird der Layout-Test des anderen Geräts übersprungen (2). Das ergibt 24 bisherige + 14 neue = 38.

- [ ] **Step 2: Wiki nachziehen**

`docs/wiki/ops/testing.md`: Frontmatter-`sources` um `e2e/events.spec.js` ergänzen (nach `e2e/tour.spec.js`); nach dem Punkt zu `e2e/styleguide.spec.js` einfügen:
```
- `e2e/events.spec.js`: the event overview of D-04 — on 390 px at least four cards begin in the first screen, nothing reaches beyond the page width and the category bar scrolls sideways in one line; on 1440 px three columns with the banner above the date tile; the past event is missing and the running one comes first; each persona sees its marker (raider "Angemeldet", member "Warteliste" and "Ausstehend", newbie "Als Gast"); a banner loads and the workshop's missing one leaves the event colour.
```
Run: `npm run wiki && npm test 2>&1 | tail -4` → `# fail 0`.

- [ ] **Step 3: Zeilenzahlen in `CLAUDE.md`**

Run: `wc -l public/css/style.css public/css/components.css public/index.html`
Weicht eine Zahl um mehr als 50 von „Save tokens“ in `CLAUDE.md` ab (`style.css` ~3130, `components.css` ~670, `index.html` ~1920), die Zahl dort anpassen.

- [ ] **Step 4: Abschlusslauf und Nachher-Screenshots**

```bash
npm test 2>&1 | tail -6
npm run test:e2e 2>&1 | tail -3
node data/d04/shots.js after
```
Expected: `# fail 0`; Playwright ohne `failed`; `mobile: … px, 7 cards`, `desktop: … px, 7 cards`. Werte und Screenshots (`data/d04/before-*.png`, `after-*.png`) für die MR-Beschreibung festhalten. Danach `netstat -ano | grep -E ":(3123|3125) .*LISTEN"` → keine Ausgabe.

- [ ] **Step 5: Commit**

```bash
git add e2e/events.spec.js docs/wiki CLAUDE.md
git commit -m "Check the new overview in the browser on phone and desktop

The layout promises of D-04 only show in a real browser: four events
in the first phone screen, nothing sticking out, three columns on the
desktop, the banner fallback and every persona's marker.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: MR-Beschreibung vorbereiten**

`data/d04/mr.md` (Deutsch; Titel `D-04: Event-Übersicht neu`) mit den Abschnitten Problem / Ursache / Änderung / Verifikation, den Seitenlängen vorher/nachher aus Task 0 und Step 4, dem Hinweis „Bestehende Dev-Datenbank: einmal `npm run dev:reset`, damit die Dummy-Banner erscheinen“ und `Closes #53` am Ende. Hex-Farben nur in Backticks, kein `#<Zahl>` außer `#53`. Die Screenshots lädt der Nutzer beim Anlegen des MR hoch.
