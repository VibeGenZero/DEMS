# Events nach dem Ende automatisch archivieren — Design Spec
**Datum:** 2026-10-17 · **Ticket:** W-01 (GitLab #65, Prio-Plan `2026-10-07-dems-3.0-prioplan.md`) · **Vorarbeit:** D-04 (`isEventOver`, Übersicht ohne beendete Events), D-07 (Admin-Tabelle mit Zustand „vorbei“) · **Folgeticket:** B-10 (Channels löschen, Event-Rolle entziehen)

## Überblick

Ein Event bleibt nach seinem Ende für immer `active`. Im Mock steht der „Retro-Spieleabend“ (Ende vor 7 Tagen) weiter als aktiv in der Datenbank.

- Die Übersicht blendet beendete Events seit D-04 schon aus (`isEventOver`: Ende = `endDate`, ohne Ende Start + 2 h). Dieser Teil des Befunds ist erledigt.
- Die Bot-Zentrale („Laufende Events“) zeigt jedes aktive Event und markiert es als „LIVE“, sobald der Start vorbei ist — auch eine Woche nach dem Ende.
- Anmelden geht, solange der Status `active` ist: Weder `registerUserForEvent` noch die Discord-Buttons prüfen Start oder Ende. Die Event-Seite zeigt Nicht-Angemeldeten nach dem Ende weiter Formular und Countdown.
- Archivieren gibt es nur von Hand („Archivieren“ / „Beenden“ im Dashboard).

**Ziel:** Ein Event ist nach seinem Ende überall als vorbei erkennbar, nimmt keine Anmeldungen mehr an und archiviert sich einen Tag später selbst.

**Erfolgskriterien**
- 24 h nach dem Ende hat ein aktives Event den Status `archived`, ohne dass ein Admin etwas tut; im Audit-Log steht ein Eintrag von „System“. Nach einer Server-Pause holt der Scheduler das beim Start nach.
- Ab dem Ende lehnen Website und Discord eine Anmeldung und einen Slot-Wechsel mit „Das Event ist schon vorbei.“ ab; neue oder aktualisierte Ankündigungen tragen keine Anmelde-Buttons.
- Die Bot-Zentrale zeigt unter „Laufende Events“ nur laufende und kommende Events; „LIVE“ steht nur zwischen Start und Ende.
- Die Event-Seite zeigt Nicht-Angemeldeten bei einem beendeten Event „Dieses Event ist vorbei.“ statt Formular und Countdown.
- `npm test` und `npm run test:e2e` sind grün; keine neue Abhängigkeit, keine neue Umgebungsvariable.

**Nicht im Umfang**
- Event-Channels löschen und die Event-Rolle entziehen (B-10).
- Eine einstellbare Wartezeit oder ein Aus-Schalter (bewusst fest 24 h).
- Anmeldeschluss vor dem Start (W-03).
- Das Admin-Dashboard und die Übersicht: Sie berücksichtigen das Ende schon (D-04, D-07).

## Teil 1 — Verhalten

### Ende
Das Ende eines Events ist `endDate`, ohne `endDate` Start + 2 h (`eventEndTime` in `utils/eventListing.js`, `DEFAULT_DURATION_MS`). Ein Event ohne lesbaren Start hat kein Ende: Es gilt nie als vorbei und wird nie archiviert. Ein `endDate` vor dem Start (Altdaten; der Validator lehnt das seit D-10 ab) zählt wie ein fehlendes, damit ein Event nie vor seinem Start als vorbei gilt.

### Ab dem Ende (Status noch `active`)
| Ort | Verhalten |
|---|---|
| Anmelden (Website, Discord-Button, Discord-Modal, mit Gästen) | 400 bzw. Discord-Antwort „Das Event ist schon vorbei.“ |
| Slot-Wechsel (`switchOwnSlot`) | dieselbe Antwort |
| Discord-Ankündigung | neue und aktualisierte Ankündigungen: nur noch „Zum Event“; ein alter Anmelde-Button antwortet mit dem Satz |
| Event-Seite, nicht angemeldet | Hinweis „Dieses Event ist vorbei.“ statt Anmeldebereich, kein Countdown |
| Event-Seite, angemeldet | wie bisher: Status, Check-in, Kommentare |
| Bot-Zentrale „Laufende Events“ | nicht mehr aufgeführt |
| Übersicht, Admin-Dashboard | unverändert (schon „vorbei“) |

Abmelden bleibt möglich (eine Abmeldung nach dem Ende stört niemanden).

### 24 h nach dem Ende
Der Scheduler setzt den Status auf `archived` (und `updatedAt`), schreibt `AUTO_ARCHIVE_EVENT` mit `adminId: 'system'` ins Audit-Log und stößt die Aktualisierung der gespeicherten Discord-Ankündigungen an (`notifyRegistrationsChanged`). Danach gilt für Mitglieder, was für jedes archivierte Event gilt: Die Event-Seite antwortet 404, die Zeile im Profil-Verlauf ist kein Link mehr.

- Nur `active` wird archiviert; Entwürfe, abgesagte und schon archivierte Events bleiben unberührt.
- Serien: jeder Termin für sich.
- `endDate` bleibt, wie es ist (anders als bei „Beenden“, das `endDate` auf jetzt setzt). Channels und Rolle bleiben (B-10).

### Audit-Log
Die Tabelle im Dashboard zeigt `adminId` gekürzt; für `system` steht dort „System“.

## Teil 2 — Technik

### `utils/eventArchive.js` (neu)
| Export | Inhalt |
|---|---|
| `ARCHIVE_DELAY_MS` | 24 h |
| `ARCHIVE_INTERVAL_MS` | 5 min |
| `isDueForArchive(event, now)` | rein: `status === 'active'`, Ende vorhanden und `now ≥ Ende + ARCHIVE_DELAY_MS` |
| `archiveEndedEvents({ now })` | liest die aktiven Events (`where('status', '==', 'active')`), archiviert jedes fällige wie in Teil 1, gibt die Zahl zurück; ein Fehler bei einem Event wird geloggt, die anderen laufen weiter; loggt `🗄️ Archived N ended event(s)` wenn N > 0 |
| `startArchiveScheduler()` / `stopArchiveScheduler()` | erster Lauf sofort (holt nach einer Pause nach), dann alle 5 min (`setInterval`, `unref`); wie `startPollScheduler` |

Datenzugriff nur über `firebaseAdmin.js`; Audit-Log über `addAuditLog` (`utils/eventUtils.js`). Gestartet in `server.js` direkt nach `startPollScheduler()`; läuft ohne Bot, also auch ohne Discord und im Mock.

### Anmeldung (`utils/registrationService.js`)
Neuer Fehler `REGISTRATION_ERROR.ENDED = 'event_ended'` (HTTP 400, „Das Event ist schon vorbei.“). `createRegistration` und `switchOwnSlot` prüfen ihn nach der Status-Prüfung mit `isEventOver(event, now)`. Website (`POST /api/events/:id/register`) und Discord laufen beide durch diese Funktionen und geben die Meldung so weiter, wie sie es heute mit den anderen Fehlern tun.

### Bot (`bot.js`)
- `canRegisterViaDiscord(event)` ist für beendete Events falsch → `buildEventComponents` baut nur den Link-Button.
- `getRunningEvents()` lässt beendete Events weg.

### Frontend
- `admin/bot-control.js`: „LIVE“ nur bei `isRunning(event, now)` (`events/cards.js`), „Bevorstehend“ bei einem Start in der Zukunft, sonst „Beendet“ (kommt nur vor, wenn ein Event zwischen Abruf und Anzeige endet; der Server filtert beendete Events).
- `events/detail.js`: beendetes Event (`eventEnd` aus `events/cards.js`) und nicht angemeldet → Hinweis „Dieses Event ist vorbei.“ in `#detail-register-area`, kein Countdown, kein Anmelde-Button in der Seitenleiste.
- `admin/dashboard.js`: `system` als „System“.

### Testdaten (`dev/seedData.js`)
Neues Event `EVENT_ID.ENDED = 'dev-event-ended'`, „Feierabend-Runde“: Start vor 6 h, Ende vor 3 h, aktiv, ohne Anmeldungen. Es zeigt im Mock den Zustand „vorbei, noch nicht archiviert“. Der „Retro-Spieleabend“ (Ende vor 7 Tagen) wird beim Serverstart archiviert — der Fall aus dem Ticket.

## Teil 3 — Tests und Verifikation

Test zuerst (rot), dann Umsetzung.

| Datei | Inhalt |
|---|---|
| `test/eventArchive.test.js` (neu) | `isDueForArchive`: Ende vor 24 h → ja, vor 23:59 h → nein; ohne `endDate` Start + 2 h + 24 h; `draft`, `cancelled`, `archived`, ohne Start, unlesbares Datum → nein. `archiveEndedEvents` mit eigener SQLite-Datei: archiviert genau die fälligen Events, je ein Audit-Eintrag von `system`, Rückgabe = Zahl, zweiter Lauf → 0 |
| `test/registrationService.test.js` | Anmelden (auch mit Gast) und `switchOwnSlot` nach dem Ende → `ENDED`, 400, Satz |
| `test/eventComponents.test.js` | beendetes Event: nur „Zum Event“ |
| `test/devServer.test.js` | nach dem Start ist `dev-event-past` archiviert (Audit-Eintrag `AUTO_ARCHIVE_EVENT`), ein Mitglied bekommt 404; `dev-event-ended` ist aktiv, Anmelden → 400 mit Satz; `/api/admin/bot/running-events` enthält keins von beiden. Tests, die `dev-event-past` als aktiv erwarten (Profil-Verlauf, Event-Liste ohne `upcoming`), werden angepasst |
| Frontend-Unit-Tests | Bot-Zentrale: „LIVE“ nur während des Events, beendete fehlen; Event-Seite: Hinweis statt Formular bei beendetem Event für Nicht-Angemeldete; Audit-Log „System“ |
| `test/seed.test.js` | neue Zahl der Events, `dev-event-ended` ist aktiv und vorbei |
| `e2e/events.spec.js` | `#event/dev-event-ended` zeigt „Dieses Event ist vorbei.“ und kein Anmeldeformular |
| `e2e/admin.spec.js` | im Tab „Aktiv“ steht die „Feierabend-Runde“ als „Vorbei“ mit „Archivieren“ (bisher der Retro-Spieleabend, der jetzt im Archiv steht); in der Bot-Zentrale steht kein beendetes Event |

Danach `npm test`, `npm run test:e2e` und ein Blick im Mock-Modus auf Bot-Zentrale, Event-Seite der Feierabend-Runde und das Audit-Log.

## Teil 4 — Doku

- `concepts/event-lifecycle.md`: Ende-Regel, Auto-Archiv nach 24 h, Anmeldung ab dem Ende zu.
- `concepts/reminders-presence.md`: Archiv-Scheduler neben Erinnerungs- und Abstimmungs-Scheduler; „Laufende Events“ ohne beendete.
- `concepts/registration-flow.md`: Fehler `ENDED`.
- `modules/utils.md`: `eventArchive.js`; `modules/server.md`: Scheduler-Start; `modules/routes-admin.md`: `running-events`; `modules/dev-mock-mode.md`: `dev-event-ended`; `ops/testing.md`.
- `npm run wiki`.

## Risiken

- **Erster Lauf beim Start:** Der Scheduler läuft nicht synchron vor `listen`. Server-Tests, die den archivierten Retro-Spieleabend erwarten, warten auf die Log-Zeile `Archived` (`server.waitForOutput`).
- **Lange Events ohne `endDate`:** Sie gelten nach 2 h als vorbei (wie heute in der Übersicht) und nehmen dann keine Anmeldungen mehr an; archiviert wird erst 24 h später, mitten im Spiel verschwindet also nichts.
- **Bestehende Daten:** Beim ersten Start nach dem Update archiviert der Scheduler alle aktiven Events, die vor mehr als 24 h geendet haben, auf einmal (je ein Audit-Eintrag). Das ist gewollt.
- **Discord-Buttons alter Ankündigungen** bleiben bis zum Archivieren sichtbar; ein Klick bekommt den Satz „Das Event ist schon vorbei.“.
