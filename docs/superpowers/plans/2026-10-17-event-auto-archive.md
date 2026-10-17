# Events nach dem Ende automatisch archivieren Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Event nimmt ab seinem Ende keine Anmeldungen mehr an, erscheint nicht mehr als laufend und archiviert sich 24 h nach dem Ende selbst (W-01).

**Architecture:** Eine reine Regel `isDueForArchive` und ein Scheduler `archiveEndedEvents` in `utils/eventArchive.js`, gestartet von `server.js` neben dem Abstimmungs-Scheduler. Anmeldung (Web und Discord) prüft das Ende in `utils/registrationService.js` bzw. `bot.js`; Bot-Zentrale, Event-Seite und Audit-Log zeigen den Zustand im Frontend.

**Tech Stack:** Node ≥ 22, Express 5, discord.js 14, SQLite-Adapter über `firebaseAdmin.js`, native ES-Module, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-event-auto-archive-design.md`

## Global Constraints

- Ende = `endDate`, ohne (gültiges) `endDate` Start + 2 h (`eventEndTime`, `DEFAULT_DURATION_MS`); ohne gültigen Start kein Ende.
- Archivieren genau 24 h nach dem Ende (`ARCHIVE_DELAY_MS = 24 * 60 * 60 * 1000`), Prüfung alle 5 min, erster Lauf sofort beim Start.
- Fehlersatz überall: „Das Event ist schon vorbei.“ (HTTP 400, Code `event_ended`).
- Audit-Aktion `AUTO_ARCHIVE_EVENT`, `adminId: 'system'`; das Dashboard zeigt „System“.
- Hinweis auf der Event-Seite: „Dieses Event ist vorbei.“
- Keine neue Abhängigkeit, keine neue Umgebungsvariable; Datenzugriff nur über `firebaseAdmin.js`; Nutzertexte Deutsch, Code/Kommentare/Commits Englisch.
- Channels löschen und Event-Rolle entziehen gehören nicht hierher (B-10).
- Test zuerst (rot), dann Code; `npm test` und am Ende `npm run test:e2e` grün; Wiki im selben Branch, danach `npm run wiki`.

## Review Focus

- Altdaten mit `endDate` vor dem Start (heute vom Validator abgelehnt, aber gespeichert möglich): Das Event darf weder vor seinem Start als „vorbei“ gelten noch archiviert werden → `eventEndTime`/`eventEnd` ignorieren ein solches Enddatum (Task 1).
- Anmelden eine Minute vor dem Ende (Event läuft) geht, eine Minute danach nicht (Task 2).
- Eine Serie: ein beendeter Termin wird archiviert, der nächste bleibt aktiv (Task 1).
- Ein leerer Datenbestand oder nur Events ohne Start: Der Scheduler läuft ohne Fehler und meldet 0 (Task 1).
- Ein alter Slot-Button einer Discord-Ankündigung, nach dem Ende geklickt, antwortet mit dem Satz statt ein Formular zu öffnen (Task 2). Das Absenden eines vor dem Ende geöffneten Modals nimmt denselben Weg (Schritt 3), lässt sich mit dem Fake-Interaction-Gerüst aber nicht nachstellen.

---

### Vorbereitung: Spec und Plan committen

- [ ] **Schritt 1:**

```bash
git add docs/superpowers/specs/2026-10-17-event-auto-archive-design.md docs/superpowers/plans/2026-10-17-event-auto-archive.md
git commit -m "Plan the automatic archive of ended events

Ended events stay active forever: the bot control center calls them LIVE
a week later and members can still register. W-01 closes registration
at the end and archives events 24 hours after it."
```

---

### Task 1: Ende-Regel und Archiv-Scheduler

**Files:**
- Modify: `utils/eventListing.js` (`eventEndTime`), `public/js/events/cards.js` (`eventEnd`)
- Create: `utils/eventArchive.js`
- Test: `test/eventListing.test.js`, `test/eventCards.test.js`, `test/eventArchive.test.js` (neu)

**Interfaces:**
- Consumes: `eventEndTime(event)` aus `utils/eventListing.js`; `addAuditLog(action, adminId, details, targetId)` aus `utils/eventUtils.js`; `notifyRegistrationsChanged(eventId)` aus `utils/announcementRefresh.js`; `db, collection, query, where, getDocs, doc, updateDoc` aus `firebaseAdmin.js`.
- Produces: `ARCHIVE_DELAY_MS`, `ARCHIVE_INTERVAL_MS`, `isDueForArchive(event: Object, now: Date): boolean`, `archiveEndedEvents({ now?: Date }): Promise<number>`, `startArchiveScheduler(): void`, `stopArchiveScheduler(): void` — alle aus `utils/eventArchive.js`.

- [ ] **Schritt 1: Failing Tests**

`test/eventListing.test.js` — neuer Test `'an end before the start counts as missing'`:
`eventEndTime({ startDate: '2026-10-10T18:00:00.000Z', endDate: '2026-10-09T23:00:00.000Z' }).toISOString()` → `'2026-10-10T20:00:00.000Z'`; `isEventOver({ startDate: '2026-10-20T18:00:00.000Z', endDate: '2026-10-01T18:00:00.000Z' }, new Date('2026-10-15T12:00:00Z'))` → `false`.

`test/eventCards.test.js` — derselbe Fall für `app.eventEnd` (Muster der Datei; Ergebnis Start + 2 h).

`test/eventArchive.test.js` (neu; Kopf wie `test/registrationService.test.js`: eigene `DEV_SQLITE_PATH`, `DEV_MOCK=true`, `after` → `bot.client.destroy()`; Events per `setDoc(doc(db, 'events', id), …)`):
- `'an active event is due 24 hours after its end'`: `NOW = 2026-10-17T12:00Z`; Ende vor 24 h → `true`; Ende vor 23 h 59 min → `false`; ohne `endDate`: Start vor 26 h → `true`, Start vor 25 h 59 min → `false`.
- `'only active events with a start can be due'`: je `status: 'draft' | 'cancelled' | 'archived'` mit altem Ende → `false`; ohne `startDate` → `false`; `startDate: 'kaputt'` → `false`.
- `'the scheduler archives the due events once and logs each one'`: drei Events anlegen — fällig (Ende vor 2 Tagen), Ende vor 1 h, Serie mit zwei Terminen (erster fällig, zweiter in einer Woche, gleiche `seriesId`); `await archiveEndedEvents({ now: NOW })` → `2`; Status: fällige `archived`, die anderen `active`; `auditLogs` enthält genau zwei Einträge mit `action === 'AUTO_ARCHIVE_EVENT'`, `adminId === 'system'`, `targetId` = jeweilige ID; zweiter Lauf → `0`.
- `'the scheduler runs on an empty or dateless set'`: nur ein aktives Event ohne `startDate` → `archiveEndedEvents({ now: NOW })` → `0`, Status bleibt `active`.

- [ ] **Schritt 2: Rot**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/eventListing.test.js test/eventCards.test.js test/eventArchive.test.js`
Expected: FAIL (Ende vor dem Start wird benutzt; `Cannot find module '../utils/eventArchive'`).

- [ ] **Schritt 3: Umsetzung**

- `eventEndTime` und `eventEnd`: ein `endDate` vor dem Start zählt wie ein fehlendes (Start + `DEFAULT_DURATION_MS`); JSDoc entsprechend.
- `utils/eventArchive.js`: Kopf-Kommentar wie in der Spec, Teil 2. `isDueForArchive` = `status === 'active'` && `eventEndTime(event)` && `now >= end + ARCHIVE_DELAY_MS`. `archiveEndedEvents` liest `query(collection(db, 'events'), where('status', '==', 'active'))`, für jedes fällige Event in eigenem `try/catch`: `updateDoc(…, { status: 'archived', updatedAt: now.toISOString() })`, `addAuditLog('AUTO_ARCHIVE_EVENT', 'system', \`Archived "${title}" 24 hours after its end\`, id)`, `notifyRegistrationsChanged(id)`; Fehler pro Event mit `console.error('Auto archive failed for', id, err.message)`; bei Zahl > 0 `console.log(\`🗄️ Archived ${count} ended event(s)\`)`. `startArchiveScheduler` wie `startPollScheduler` (erst `stopArchiveScheduler()`, dann sofort `archiveEndedEvents().catch(…)`, dann `setInterval` mit `unref`, Log `🗄️ Archive scheduler started (checks every 5 min)`).

- [ ] **Schritt 4: Grün**, dann `npm test` (die übrigen Suiten bleiben grün; der Scheduler läuft hier noch nirgends).

- [ ] **Schritt 5: Commit**

```bash
git add utils/eventListing.js public/js/events/cards.js utils/eventArchive.js test/eventListing.test.js test/eventCards.test.js test/eventArchive.test.js
git commit -m "Archive active events 24 hours after their end

A scheduler module finds active events whose end lies more than a day
back, archives them and logs each one as done by the system; the
announcements are refreshed so their buttons go away. An end date before
the start no longer counts, so such an event cannot end before it begins."
```

---

### Task 2: Anmeldung schließt mit dem Ende

**Files:**
- Modify: `utils/registrationService.js` (`REGISTRATION_ERROR`, `ERROR_HTTP_STATUS`, `createRegistration`, `switchOwnSlot`)
- Modify: `bot.js` (`canRegisterViaDiscord`, `checkRegistrationConditions`, die beiden Modal-Handler mit `canRegisterViaDiscord`-Schutz, `getRunningEvents`)
- Test: `test/registrationService.test.js`, `test/eventComponents.test.js`, `test/slotInteractions.test.js`

**Interfaces:**
- Consumes: `isEventOver(event, now)` aus `utils/eventListing.js` (`bot.js` importiert es schon).
- Produces: `REGISTRATION_ERROR.ENDED = 'event_ended'` (HTTP 400, Text „Das Event ist schon vorbei.“); `canRegisterViaDiscord(event)` ist für beendete Events `false`; `getRunningEvents()` ohne beendete Events.

- [ ] **Schritt 1: Failing Tests**

`test/registrationService.test.js`:
- `'registration and slot switch close when the event is over'`: Event mit `startDate` vor 3 h, `endDate` vor 1 min → `register(id, 'Ende')` liefert `{ ok: false, code: 'event_ended', httpStatus: 400, error: 'Das Event ist schon vorbei.' }` (prüfen mit `assert.deepEqual` auf diese vier Felder); mit `guests: [{ id: 'g1', displayName: 'Gast' }]` derselbe Fehler; Slot-Event mit bestehender Anmeldung (per `setDoc` in `registrations`, Status `accepted`, `slotId: 'tank'`) und Ende vor 1 min → `switchOwnSlot({ eventId, userId, slotId: 'heal' })` → derselbe Fehler.
- `'a running event still takes registrations up to its end'`: Start vor 1 h, `endDate` in 1 min → `register` → `ok: true`.

`test/eventComponents.test.js`:
- `'an ended event keeps only the link button'`: `slotEvent({ startDate: <vor 3 h>, endDate: <vor 1 h> })` → `buttonsOf(bot.buildEventComponents(event, 'evt9'))` ergibt eine Zeile mit genau einem Button `'Zum Event'`.

`test/slotInteractions.test.js`:
- `'a slot button of an ended event answers that it is over'`: Slot-Event mit Ende vor 1 h anlegen, `createFakeInteraction({ kind: 'button', customId: 'event_slot:<id>:tank', userId: 'int-user-9' })`, `dispatchInteraction` → die Antwort (`reply` oder `editReply`) enthält `'Das Event ist schon vorbei.'`.

- [ ] **Schritt 2: Rot** — `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/registrationService.test.js test/eventComponents.test.js test/slotInteractions.test.js` → die neuen Tests schlagen fehl (Anmeldung gelingt, Slot-Buttons vorhanden).

- [ ] **Schritt 3: Umsetzung**

- `registrationService`: `ENDED` in beiden Tabellen; `createRegistration` und `switchOwnSlot` prüfen direkt nach der Status-Prüfung `isEventOver(event, new Date())` → `buildFailure(REGISTRATION_ERROR.ENDED, 'Das Event ist schon vorbei.')`.
- `bot.js`: `canRegisterViaDiscord` zusätzlich `!isEventOver(event)`; `checkRegistrationConditions` nach der Status-Prüfung `if (isEventOver(event)) return 'Das Event ist schon vorbei.';`; in den beiden Modal-Handlern (Formular und Slot) vor dem `canRegisterViaDiscord`-Schutz `if (isEventOver(event))` → ephemere Antwort mit dem Satz; `getRunningEvents` überspringt `isEventOver(event)`.

- [ ] **Schritt 4: Grün**, dann `npm test`. Bestehende Tests, deren Events ein Start in der Vergangenheit ohne Ende haben und sich trotzdem anmelden, bekommen ein Start in der Zukunft (keine solchen beim Planen gefunden; `test/registrationService.test.js` legt Events ohne `startDate` an).

- [ ] **Schritt 5: Commit**

```bash
git add utils/registrationService.js bot.js test/registrationService.test.js test/eventComponents.test.js test/slotInteractions.test.js
git commit -m "Close registration when an event is over

Nothing checked the end: members could register on the website or
through an old Discord button long after the event. Registering and
switching slots now answer that the event is over, announcements of an
ended event keep only the link button, and the running events of the
bot control center leave ended events out."
```

---

### Task 3: Scheduler im Server, Testdaten, Server-Tests

**Files:**
- Modify: `server.js` (Start nach `startPollScheduler()`, Stopp im Graceful Shutdown, falls dort `stopPollScheduler` steht)
- Modify: `dev/seedData.js` (`EVENT_ID.ENDED = 'dev-event-ended'`, Event „Feierabend-Runde“)
- Test: `test/devServer.test.js`, `test/seed.test.js`

**Interfaces:**
- Consumes: `startArchiveScheduler`, `stopArchiveScheduler` (Task 1); `ENDED`-Fehler (Task 2).
- Produces: `EVENT_ID.ENDED` (`dev-event-ended`): Titel „Feierabend-Runde“, Start `clock.offset(-6 * HOUR)`, Ende `clock.offset(-3 * HOUR)`, `status: 'active'`, Kategorie „Community“, `maxParticipants: 8`, keine Anmeldungen.

- [ ] **Schritt 1: Failing Tests**

`test/seed.test.js`: Zähler `events: 14`; `'the ended event is active and over'`: `dev-event-ended` hat `status: 'active'` und `endDate` < jetzt.

`test/devServer.test.js` (neue Tests; vor der ersten Prüfung `await server.waitForOutput('Archived 1 ended event(s)')`):
- `'the scheduler archives an event a day after its end and logs it'`: Admin-`/api/admin/all-events` → `dev-event-past` hat `status: 'archived'`, `dev-event-ended` `active`; `/api/admin/audit-log?limit=100` enthält `{ action: 'AUTO_ARCHIVE_EVENT', adminId: 'system', targetId: 'dev-event-past' }`; Mitglied `GET /api/events/dev-event-past` → 404.
- `'an ended event takes no registration'`: Mitglied `POST /api/events/dev-event-ended/register {}` → 400, `error === 'Das Event ist schon vorbei.'`.
- `'the running events of the bot control center leave ended events out'`: `/api/admin/bot/running-events` enthält weder `dev-event-past` noch `dev-event-ended`, aber `dev-event-running`.

Bestehende Erwartungen anpassen: Profil-Verlauf `[EVENT_ID.PAST, 'archived', true]`; der Mitglieder-Check „Without the parameter the list stays as before, past events included“ prüft `EVENT_ID.ENDED` statt `EVENT_ID.PAST`; beide warten vorher ebenfalls auf die Log-Zeile.

- [ ] **Schritt 2: Rot** — `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/seed.test.js test/devServer.test.js` → neue Tests rot (kein Scheduler, kein `dev-event-ended`).

- [ ] **Schritt 3: Umsetzung** — Scheduler in `server.js` starten (und beim Herunterfahren stoppen, wie der Abstimmungs-Scheduler); Seed-Event ergänzen (`EVENT_ID` exportiert es mit).

- [ ] **Schritt 4: Grün**, dann `npm test` komplett.

- [ ] **Schritt 5: Commit**

```bash
git add server.js dev/seedData.js test/devServer.test.js test/seed.test.js
git commit -m "Start the archive scheduler with the server

The scheduler runs once at start, so events that ended during a pause
are archived right away, then every five minutes. Mock mode gets an
event that ended three hours ago to show the state between the end and
the archive; the week-old retro evening is archived at start."
```

---

### Task 4: Bot-Zentrale, Event-Seite und Audit-Log

**Files:**
- Modify: `public/js/admin/bot-control.js` (`loadBotRunningEvents`), `public/js/events/detail.js` (Countdown, Anmeldebereich), `public/js/admin/dashboard.js` (`loadAuditLog`)
- Test: `test/eventEndViews.test.js` (neu, `loadFrontendApp`)

**Interfaces:**
- Consumes: `isRunning(event, now)`, `eventEnd(event)` aus `events/cards.js` (für `detail.js` entsteht ein Import-Kreis `cards.js ↔ detail.js`; er ist unkritisch, weil beide Seiten die Funktionen erst beim Aufruf nutzen).
- Produces: Anzeige-Zustände „LIVE“ (läuft), „Bevorstehend“ (Start in der Zukunft), „Beendet“ (vorbei; vom Server eigentlich gefiltert); `#detail-register-area` mit „Dieses Event ist vorbei.“; Audit-Zeile „System“.

- [ ] **Schritt 1: Failing Tests** (`test/eventEndViews.test.js`)
- `'the bot control center calls only a running event LIVE'`: Route `/api/admin/bot/running-events` → drei Events (läuft: Start −30 min, Ende +2 h; kommt: Start +1 Tag; vorbei: Start −5 h, Ende −2 h); `await app.loadBotRunningEvents()` → `#bot-running-events` enthält genau einmal `live-indicator`, einmal `upcoming-indicator` und einmal den Text „Beendet“.
- `'an ended event page tells a visitor that it is over'`: Routes wie in `test/actionAttributes.test.js` (`eventRoutes`) mit `startDate` −6 h, `endDate` −3 h, `my-registration` `{ registered: false }`; `state.currentUser` = Mitglied; `await app.showEventDetail('ev')` + `settle()` → `element('detail-register-area').innerHTML` enthält „Dieses Event ist vorbei.“ und keine `<form`; `isHidden(element('detail-countdown-area'))`.
- `'a registered member still sees the status of an ended event'`: wie oben, `my-registration` `{ registered: true, status: 'accepted' }` → `isHidden(element('detail-registered'))` ist `false`.
- `'the audit log names the system'`: Route `/api/admin/audit-log?limit=100` → `{ data: [{ action: 'AUTO_ARCHIVE_EVENT', adminId: 'system', details: 'x', timestamp: <ISO> }], meta: { totalPages: 1 } }`; `await app.loadAuditLog()` → `#audit-log-entries` enthält `>System<` und nicht `system…`.

- [ ] **Schritt 2: Rot** — `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/eventEndViews.test.js`.

- [ ] **Schritt 3: Umsetzung**
- `bot-control.js`: drei Zustände per `isRunning` / Start > jetzt / sonst; „Beendet“ als `<span class="upcoming-indicator"><i class="bi bi-flag me-1"></i>Beendet</span>` (bestehende Klasse, kein neues CSS).
- `detail.js`: Countdown nur, wenn das Event nicht vorbei ist; nach dem Zweig für Angemeldete: ist `eventEnd(event) < new Date()`, dann `#detail-register-area` zeigen mit `<p class="text-secondary mb-0"><i class="bi bi-flag me-2"></i>Dieses Event ist vorbei.</p>`, `renderSidebarAction('none')`, Teilnehmer und Kommentare laden wie für andere Besucher, kein Formular. `detail.js` bleibt unter 500 Zeilen (vorher 492).
- `dashboard.js`: `adminId === 'system'` → „System“, sonst wie bisher gekürzt.

- [ ] **Schritt 4: Grün**, dann `npm test`.

- [ ] **Schritt 5: Commit**

```bash
git add public/js/admin/bot-control.js public/js/events/detail.js public/js/admin/dashboard.js test/eventEndViews.test.js
git commit -m "Show ended events as over in the bot control center and on their page

The bot control center called every started event LIVE; it now says
LIVE only while an event runs. The page of an ended event tells visitors
that it is over instead of offering the form and a countdown, and the
audit log names the system for automatic archives."
```

---

### Task 5: Browsertests und Sichtprüfung

**Files:**
- Modify: `e2e/events.spec.js`, `e2e/admin.spec.js`

- [ ] **Schritt 1: Tests**
- `e2e/events.spec.js`, neuer Test `'an ended event says so and offers no registration'` (Mitglied `member`): `page.goto('/#event/dev-event-ended')` → `#detail-register-area` enthält „Dieses Event ist vorbei.“; `#detail-register-area form` hat Anzahl 0; `#detail-countdown-area` ist unsichtbar.
- `e2e/admin.spec.js`, Test `'the tabs sort the events by status'`: Zeile „Feierabend-Runde“ statt „Retro-Spieleabend“ (enthält „Vorbei“, Hauptaktion „Archivieren“); im Tab „Archiv“ steht zusätzlich „Retro-Spieleabend“.
- `e2e/admin.spec.js`, neuer Test `'the bot control center lists no ended event'` (Admin, Desktop): Navigation zu „Bot-Zentrale“ → `#bot-running-events` enthält „Live: Speedrun-Marathon“ mit `.live-indicator`, aber weder „Retro-Spieleabend“ noch „Feierabend-Runde“.

- [ ] **Schritt 2: Laufen lassen** — `npx playwright test e2e/events.spec.js e2e/admin.spec.js`, dann `npm run test:e2e` → alles grün.

- [ ] **Schritt 3: Sichtprüfung** im Mock-Modus (Scratch-Datenbank, Server per PID beenden): Bot-Zentrale, Event-Seite der Feierabend-Runde als Mitglied, Audit-Log mit „System“, Archiv-Tab mit dem Retro-Spieleabend. Auffälligkeiten mit einem Test festhalten und beheben.

- [ ] **Schritt 4: Commit**

```bash
git add e2e/events.spec.js e2e/admin.spec.js
git commit -m "Check ended events in the browser

The browser tests open the page of an event that ended three hours ago
and the bot control center, and expect the retro evening in the archive
now that the scheduler archives it at start."
```

---

### Task 6: Wiki

**Files:** die Knoten aus Spec, Teil 4; `docs/wiki/graph.json` (generiert)

- [ ] **Schritt 1:** Knoten anpassen (Englisch, Tabellenformat der Seite):
  - `concepts/event-lifecycle.md`: Ende-Regel (auch: Ende vor dem Start zählt nicht), Anmeldung ab dem Ende zu, Auto-Archiv 24 h nach dem Ende mit `AUTO_ARCHIVE_EVENT` von `system`; Zeile „Archive (automatic)“ in der Status-Tabelle.
  - `concepts/reminders-presence.md`: Archiv-Scheduler (Start in `server.js`, sofort und alle 5 min, unabhängig vom Bot); Bot-Zentrale: `running-events` ohne beendete, „LIVE“ nur zwischen Start und Ende.
  - `concepts/registration-flow.md`: Fehler `ENDED` für Anmelden und Slot-Wechsel; Discord-Antwort.
  - `modules/utils.md`: Abschnitt `utils/eventArchive.js (scheduler)`; `eventListing.js` (Ende vor Start).
  - `modules/server.md`: Scheduler-Start; `modules/routes-admin.md`: `running-events` ohne beendete; `modules/dev-mock-mode.md`: `dev-event-ended`; `modules/frontend-app.md`: `bot-control.js`, `detail.js`, `dashboard.js`; `ops/testing.md`: `eventArchive`, `eventEndViews` und die neuen Fälle.
- [ ] **Schritt 2:** `npm run wiki`, `npm test`, `npm run test:e2e` → grün.
- [ ] **Schritt 3: Commit**

```bash
git add docs/wiki
git commit -m "Describe the automatic archive and the end rule in the wiki"
```
