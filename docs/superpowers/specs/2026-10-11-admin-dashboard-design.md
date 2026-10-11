# Admin-Dashboard neu — Design Spec
**Datum:** 2026-10-11 · **Ticket:** D-07 (GitLab #56, Prio-Plan `2026-10-07-dems-3.0-prioplan.md`) · **Abhängig von:** D-02 (Tokens und Komponenten); nutzt D-04 (Zeitangaben, Plätze-Balken) und D-06 (Plätze-Satz)

## Überblick

Das Admin-Dashboard (`#admin`) zeigt jedes Event als Karte mit Banner, Beschreibungs-Vorschau, fünf Chips und bis zu neun Buttons: Anmeldungen, CSV, Ankündigen, Duplizieren, Bearbeiten, Sync, ein Status-Dropdown (mit Emojis), Löschen und je nach Status ▶ oder ■ ohne Beschriftung. Die Karten stehen in zwei Spalten, sortiert nach Anlagedatum, Entwürfe, aktive und archivierte Events gemischt. Mit den zehn Karten der Dummy-Daten ist die Seite bei 1440 px Breite 2964 px lang. Suche und Filter gibt es nicht. Wie viele Plätze belegt sind und ob Anfragen offen sind, steht nirgends; `GET /api/admin/all-events` liefert keine Zahlen. Sechs Aktionen fragen über das Browser-Fenster `confirm()` nach, „Löschen“ meldet auch dann Erfolg, wenn der Server einen Fehler zurückgibt.

D-07 ersetzt das Karten-Raster durch eine Tabelle mit Status-Tabs, Suche und Sortierung. Jede Zeile hat eine Hauptaktion und ein Menü.

**Ziel:** Ein Admin findet ein Event in Sekunden, sieht ohne Klick, wo Anfragen warten, und erreicht jede Aktion über Worte statt Symbole. Optimiert wird für den Desktop; auf dem Handy bleibt die Seite bedienbar.

**Erfolgskriterien**
- Bei 1440 px ist die Seite mit den Dummy-Daten höchstens halb so lang wie heute (2964 px).
- Jede Zeile hat genau eine Hauptaktion und ein Menü „Weitere Aktionen“. Jede Aktion ist beschriftet; der Menü-Button trägt ein `aria-label`.
- „Löschen“ steht nur im Menü und fragt über den DEMS-Dialog nach. In `admin/event-actions.js` gibt es kein `confirm(` mehr.
- Tab-Wechsel, Suche, Sortierung und das Aufklappen einer Serie lösen keine Anfrage aus.
- Die Zeile zeigt denselben Plätze-Satz wie Event-Seite und Discord; ein Event mit offenen Anfragen erkennt man an der Hauptaktion.
- Neue Oberfläche ohne Emojis und ohne neue `style`-Attribute; beide Obergrenzen in `test/cssRules.test.js` sinken.
- Kein Frontend-Modul über 500 Zeilen.
- `npm test` und `npm run test:e2e` sind grün; keine neue Abhängigkeit.

**Nicht im Umfang**
- Button „Absagen“: `PUT /api/admin/events/:id/cancel` (mit DM an alle Teilnehmer) existiert, hatte aber nie einen Button. Eigenes Ticket. Abgesagte Events erscheinen im Archiv.
- Audit-Log-Ansicht und System-Reset, inklusive der Browser-Rückfrage beim Reset; die sechs Statistik-Kacheln; die Buttons im Seitenkopf.
- Browser-Rückfragen in anderen Bereichen (Wartung, Kommentare, Abmelden, Profil).
- Assistent, Anmeldungen-Dialog und Ankündigen-Dialog.
- Sammelaktionen (W-08), Auswertungen (W-14), Event-Vorlagen (W-10), automatisches Archivieren (W-01).
- Statuswechsel für eine ganze Serie: „Archivieren“ und die anderen Statuswechsel gelten für einen Termin. Nur „Ganze Serie löschen“ wirkt auf alle.
- Archiv erst beim Öffnen laden: erst, wenn die Antwort zu groß wird (siehe Risiken).
- Neue Dummy-Daten.

**Entscheidungen (11.10.2026)**
1. Hauptaktion im Tab „Aktiv“ ist „Anmeldungen“, mit der Zahl offener Anfragen. Der Klick auf den Titel öffnet „Bearbeiten“.
2. Drei Tabs: Entwürfe · Aktiv · Archiv. In „Aktiv“ stehen vergangene Events unten mit Chip „Vorbei“; ihre Hauptaktion ist „Archivieren“.
3. Eine Serie ist eine aufklappbare Zeile; jeder Tab zeigt nur ihre Termine mit passendem Status.
4. Alle weiteren Aktionen stehen im Menü; Statuswechsel in Worten, passend zum Zustand. Rückfrage im DEMS-Dialog nur bei Löschen, Serie löschen, Jetzt beenden, Jetzt starten und In Discord eintragen.
5. Aufbau: Tabelle mit vier Spalten und zwei Textzeilen pro Event (Entwurf A).
6. Hauptaktion in „Entwürfe“ ist „Veröffentlichen“, im Archiv „Anmeldungen“. „Starten“ und „Status → Aktiv“ werden ein Eintrag; „Jetzt beenden“ gibt es nur, solange ein Event läuft.
7. Ansatz: Der Server liefert alle Events mit `places`; Tabs, Suche, Sortierung und Serien rechnet der Browser.

---

## Teil 1 — Daten und API

### `GET /api/admin/all-events`

Jedes Event bekommt zusätzlich `places`, dasselbe Objekt wie in `GET /api/events`:

| Feld | Inhalt |
|---|---|
| `taken`, `capacity`, `guests`, `pending`, `waitlist` | Zahlen aus `summarizePlaces` |
| `text` | „6 von 20 Plätzen belegt (inkl. 2 Gäste, 1 Anfrage offen)“ |
| `waitlistText` | „3 auf der Warteliste“ oder leer |

Der Endpunkt liest dafür die Sammlung `registrations` einmal und gruppiert sie im Speicher nach `eventId` (keine Abfrage pro Event). Reihenfolge (`createdAt` absteigend) und alle übrigen Felder bleiben; die Antwort ist weiter eine Liste.

### `utils/capacity.js`

Neu: `describePlaces(registrations, maxParticipants)` → `{ ...summarizePlaces(…), text, waitlistText }`. `routes/events.js` (`withPlaces`) und `routes/admin.js` nutzen dieselbe Funktion.

### Unverändert

`PUT /events/:id/status`, `POST /events/:id/start`, `POST /events/:id/end`, `POST /events/:id/duplicate`, `DELETE /events/:id`, `DELETE /events/series/:seriesId`, `POST /events/:id/sync-discord`, `GET /events/:id/registrations/export`.

---

## Teil 2 — Regeln der Tabelle

Diese Regeln stehen als reine Funktionen in `admin/event-rows.js` (Teil 5).

### Tab und Zustand eines Events

| `status` | Tab | Zustand |
|---|---|---|
| `draft` | Entwürfe | `draft` |
| `active` oder leer, Ende noch nicht erreicht oder kein Termin | Aktiv | `upcoming`, während der Laufzeit `running` |
| `active` oder leer, Ende vorbei | Aktiv | `past` |
| `archived`, `cancelled`, alles andere | Archiv | `archived` |

Laufzeit und Ende folgen `isRunning` und `eventEnd` aus `events/cards.js` (Ende = `endDate`, sonst Start + 2 Stunden).

### Zeilen

- Ein Event ohne `seriesId` ist eine Zeile.
- Events mit derselben `seriesId` bilden je Tab **eine Serien-Zeile** aus den Terminen, die in diesen Tab gehören. Sie steht für einen Termin: den ersten, der noch nicht vorbei ist, sonst den letzten (Regel wie `pickSeriesRepresentative`). Datum, Plätze, Zustand und Aktionen der Zeile sind die dieses Termins.
- Hat die Serie im Tab mindestens zwei Termine, ist die Zeile aufklappbar. Aufgeklappt folgt je Termin eine Unterzeile, aufsteigend nach Datum, beschriftet „Termin 2 von 3“ (Position und Anzahl in der ganzen Serie, über alle Tabs). Die Unterzeilen zeigen alle Termine des Tabs, auch während einer Suche, und folgen keiner Spalten-Sortierung.
- Der Chip nennt die Termine im Tab: „Serie · 3 Termine“, bei einem „Serie · 1 Termin“.
- Haben andere Termine der Serien-Zeile offene Anfragen, zeigt sie zusätzlich „2 Anfragen offen in weiteren Terminen“.

### Suche

Die Eingabe wird getrimmt und ohne Rücksicht auf Groß-/Kleinschreibung in Titel und Kategorie gesucht. Eine Serien-Zeile passt, wenn einer ihrer Termine im Tab passt. Die Zahlen in den Tabs zählen die Zeilen nach der Suche; ohne Suche alle Zeilen des Tabs.

### Sortierung

| Spalte | Schlüssel |
|---|---|
| Event | Titel, alphabetisch nach deutscher Sortierung, Groß-/Kleinschreibung egal |
| Termin | Start der Zeile; Zeilen ohne Termin stehen in beiden Richtungen am Ende |
| Plätze | `places.taken` |

- Ein Klick auf eine Spalte sortiert aufsteigend, der nächste Klick auf dieselbe Spalte dreht um. Bei Gleichstand entscheidet der Termin, dann der Titel.
- Standard: Entwürfe und Aktiv nach Termin aufsteigend, Archiv nach Termin absteigend.
- Im Tab „Aktiv“ bilden die Zeilen im Zustand `past` eine zweite Gruppe unter allen anderen; sortiert wird innerhalb der Gruppen.
- Jeder Tab merkt sich seine Sortierung, solange die Seite offen ist. Tab, Suche und aufgeklappte Serien ebenso; nach dem Neuladen der Seite gilt wieder „Aktiv“ ohne Suche.

### Aktionen je Zustand

| Zustand | Hauptaktion | Status-Einträge im Menü |
|---|---|---|
| `draft` | Veröffentlichen | Archivieren; ohne `startDate` zusätzlich „Jetzt starten …“ |
| `upcoming` | Anmeldungen | Zurück in Entwürfe · Archivieren |
| `running` | Anmeldungen | Jetzt beenden … · Zurück in Entwürfe |
| `past` | Archivieren | Zurück in Entwürfe |
| `archived` | Anmeldungen | Wieder aktivieren · Zurück in Entwürfe |

Hat ein Event offene Anfragen (`places.pending > 0`) und ist „Anmeldungen“ seine Hauptaktion, heißt sie „Anmeldungen · 2 offen“ und ist als Primär-Button hervorgehoben.

**Menü, von oben nach unten**

| Gruppe | Einträge |
|---|---|
| 1 | „Anmeldungen“ (nur wenn es nicht die Hauptaktion ist) · Bearbeiten · Ankündigen · Duplizieren · CSV-Export · „In Discord eintragen …“ (nur ohne `discordScheduledEventId`) |
| 2, Überschrift „Status“ | Einträge aus der Tabelle oben |
| 3, abgesetzt und rot | „Löschen …“; bei einem Termin einer Serie „Termin löschen …“; in der Serien-Zeile zusätzlich „Ganze Serie löschen …“ |

Einträge, die einen Dialog mit Rückfrage öffnen, enden auf „…“. Unterzeilen einer Serie haben dieselbe Hauptaktion und dasselbe Menü wie ein einzelnes Event, ohne „Ganze Serie löschen …“.

### Aufrufe, Rückfragen und Meldungen

| Aktion | Aufruf | Rückfrage (Button) | Toast bei Erfolg |
|---|---|---|---|
| Veröffentlichen, Wieder aktivieren | `PUT …/status` `active` | – | „Event ist jetzt aktiv.“ |
| Zurück in Entwürfe | `PUT …/status` `draft` | – | „Event liegt jetzt in den Entwürfen.“ |
| Archivieren | `PUT …/status` `archived` | – | „Event archiviert.“ |
| Jetzt starten | `POST …/start` | „„Titel“ jetzt starten? Das Event wird veröffentlicht, als Start wird jetzt eingetragen.“ (Starten) | „Event gestartet.“ |
| Jetzt beenden | `POST …/end` | „„Titel“ jetzt beenden? Das Event wird archiviert, als Ende wird jetzt eingetragen.“ Mit `autoCreateChannels` zusätzlich: „Die Event-Channels werden gelöscht.“ (Beenden, rot) | „Event beendet.“ |
| Duplizieren | `POST …/duplicate` | – | „Kopie liegt in den Entwürfen: Titel (Kopie)“; die Tabelle wechselt in „Entwürfe“ |
| CSV-Export | öffnet den Export in neuem Tab | – | – |
| In Discord eintragen | `POST …/sync-discord` | „„Titel“ als geplantes Event in Discord eintragen?“ (Eintragen) | „Event in Discord eingetragen.“ |
| Löschen, Termin löschen | `DELETE …/events/:id` | „„Titel“ löschen? Alle Anmeldungen werden mitgelöscht.“ (Löschen, rot) | „Event gelöscht.“ |
| Ganze Serie löschen | `DELETE …/events/series/:seriesId` | „Ganze Serie „Titel“ löschen? Alle 3 Termine und ihre Anmeldungen werden gelöscht.“ (Serie löschen, rot) | „Serie gelöscht (3 Termine).“ |

- „Titel“ ist bei einem Termin einer Serie „Titel · Mo., 19. Okt.“; dieselbe Beschriftung bekommt der Anmeldungen-Dialog, damit man den Termin erkennt.
- Die Zahl im Serien-Dialog ist die Anzahl aller Termine der Serie, nicht nur der im Tab.
- Antwortet der Server mit einem Fehler, zeigt ein Toast dessen Meldung (`error`), sonst einen allgemeinen Text; die Tabelle bleibt, wie sie ist. Das gilt neu auch für „Löschen“ und „Serie löschen“.
- Nach einer erfolgreichen Aktion laden Tabelle und Statistik neu. Tab, Suche, Sortierung und aufgeklappte Serien bleiben.
- „Veröffentlichen“ lässt einen leeren Termin leer, wie bisher „Status → Aktiv“. „Jetzt starten“ trägt den Start ein und ersetzt den ▶-Button für spontane Events.

---

## Teil 3 — Aufbau und Aussehen

### Seite

Seitenkopf und `#admin-stats` bleiben. `#admin-events-grid` wird ersetzt durch:

| Element | Inhalt |
|---|---|
| `.admin-events-toolbar` | Tabs `#admin-events-tabs` (`.nav.nav-pills`, Buttons mit `data-click="switchAdminTab"`, Zähler als `.chip.chip-sm`, `aria-selected`) und das Suchfeld `#admin-events-search` (`type="search"`, `data-input="searchAdminEvents"`, Platzhalter „Titel oder Kategorie suchen …“, Lupe wie in der Event-Übersicht) |
| `#admin-events-table` | Tabelle, Platzhalter oder Leerzustand |

### Spalten

| Spalte | Inhalt |
|---|---|
| Event | Titel als Button (`data-click="editEvent"`), dahinter Chips: „Serie · 3 Termine“ (`bi-arrow-repeat`), „Vorbei“, „Abgesagt“ (`.chip-danger`, bei `status: cancelled`). Zweite Zeile: Kategorie · Zugang („Offen“ / „Rolle nötig“) · Bestätigung („Sofort bestätigt“ / „Freigabe durch Admin“). Serien-Zeile: davor der Aufklapp-Button (`bi-chevron-right` / `bi-chevron-down`, `aria-expanded`). Unterzeile: „Termin 2 von 3“ und die Chips „Vorbei“ / „Abgesagt“, ohne Titel und zweite Zeile. |
| Termin | „Mo., 12. Okt. · 19:00“, mit Jahr, wenn es nicht das laufende ist. Zweite Zeile: `relativeDay` („Heute“, „in 3 Tagen“, „vor 7 Tagen“). Läuft das Event: Chip „Läuft gerade“ (`.chip-danger`, `bi-broadcast`) und „seit 16:09“. Ohne Termin: „Kein Termin“. |
| Plätze | Balken (`.capacity-meter`, nur mit Begrenzung), darunter `places.text`, darunter `places.waitlistText`. Serien-Zeile mit offenen Anfragen in ihren anderen Terminen: zusätzlich „2 Anfragen offen in weiteren Terminen“ in `--warning`. |
| Aktionen | Hauptaktion (`.btn.btn-sm`, `.btn-secondary`, mit offenen Anfragen `.btn-primary`) und der Menü-Button (`bi-three-dots`, `aria-label="Weitere Aktionen für „Titel“"`). |

Icons der Aktionen: Anmeldungen `bi-list-check`, Veröffentlichen `bi-send`, Archivieren `bi-archive`, Bearbeiten `bi-pencil`, Ankündigen `bi-megaphone`, Duplizieren `bi-copy`, CSV-Export `bi-download`, In Discord eintragen `bi-discord`, Jetzt starten `bi-play-fill`, Jetzt beenden `bi-stop-fill`, Zurück in Entwürfe `bi-file-earmark`, Wieder aktivieren `bi-arrow-counterclockwise`, Löschen `bi-trash`.

Zeilen und Unterzeilen im Zustand `past` sind gedämpft. Werte im Markup gehen durch `escapeHtml`; Aktionsnamen stehen wörtlich im Markup, IDs und Titel in `data-*`-Attributen.

### Leer, Laden, Fehler

| Fall | Anzeige |
|---|---|
| erstes Laden | Platzhalter-Zeilen (Skeleton) in Tabellenform |
| Neuladen nach einer Aktion | die alte Tabelle bleibt stehen, bis die neue da ist (kein Flackern) |
| Tab ohne Events | `emptyState`: „Keine Entwürfe“ / „Keine aktiven Events“ / „Das Archiv ist leer“ |
| Suche ohne Treffer im Tab | `emptyState`: „Keine Treffer“ mit Hinweis auf die Zahlen der anderen Tabs und Button „Suche zurücksetzen“ |
| Fehler beim Laden | `emptyState` mit Button „Erneut versuchen“ |

### Breiten

| Breite | Anordnung |
|---|---|
| ab 768 px | Tabelle mit vier Spalten; der Titel bricht um, bevor die Aktionen verrutschen. Kein waagrecht scrollender Rahmen, damit das Menü nie abgeschnitten wird. |
| unter 768 px | Die Spaltenköpfe sind nur für Screenreader da; jede Zeile ist ein Block mit Event, Termin, Plätze und Aktionen untereinander. Es gilt die Standard-Sortierung. |

### Komponenten

Neu in `components.css` und im Styleguide (`#debug`), mit Tokens aus `tokens.css`:

| Komponente | Klassen |
|---|---|
| Tabelle | `.data-table` (echtes `<table>`), Spaltenkopf-Button `.data-table-sort` mit `aria-sort` am `<th>` und Pfeil (`bi-arrow-up` / `bi-arrow-down`, unsortiert `bi-arrow-down-up`), Zellen-Zweitzeile `.data-table-meta`, Titel-Button `.data-table-title`, Aktions-Zelle `.data-table-actions`, Zeilen `.is-sub` (Unterzeile) und `.is-muted`; Block-Darstellung unter 768 px. W-08 nutzt sie für die Anmeldeliste. |
| Menü | Das Bootstrap-Dropdown (`.dropdown-menu`, `.dropdown-item`, `.dropdown-header`, `.dropdown-divider`) mit Tokens; `.dropdown-item.is-danger` für den roten Eintrag. Das Danger-Zone-Menü im Seitenkopf verliert `dropdown-menu-dark` und sieht damit gleich aus. |

Tabs, Chips, Buttons, Leerzustand, Skeleton und Plätze-Balken kommen unverändert aus D-02 und D-04.

### Entfällt

- Stile `.admin-event-card`, `.admin-actions`, `.status-dropdown`, `.series-admin-date-item`, `.series-admin-card` und alles Weitere, das nur die Admin-Karten nutzten.
- Die drei Emojis im Status-Menü und die zwei `style`-Attribute der Karten.
- `renderSkeletonEvents` in `core/ui.js` samt seinem Test in `test/components.test.js`: Nur die Admin-Karten nutzten die Funktion; die Platzhalter-Zeilen der Tabelle baut `admin/event-table.js`.
- In der Liste: Banner, Beschreibungs-Vorschau, Anzahl der Formularfelder, Erinnerungen, Status-Badge. Alles steht im Bearbeiten-Dialog; den Status zeigt der Tab.

---

## Teil 4 — Bestätigungsdialog

`showConfirmDialog(message, confirmLabel = 'Bestätigen', { danger = true } = {})` in `core/ui.js`: Mit `danger: false` ist der Bestätigen-Button ein Primär-Button statt rot („Jetzt starten“, „In Discord eintragen“). Bestehende Aufrufe ändern sich nicht.

---

## Teil 5 — Module

| Modul | Inhalt |
|---|---|
| `admin/event-rows.js` (neu) | Reine Regeln ohne HTML und ohne DOM: Tab und Zustand eines Events, Zeilen je Tab mit Serien, Suche, Sortierung, Tab-Zahlen, Hauptaktion und Menü-Einträge je Zustand (Teil 2) |
| `admin/event-table.js` (neu) | Reine Funktionen, die aus den Zeilen HTML bauen: Tabs, Tabelle, Zeile, Menü, Platzhalter, Leerzustände (Teil 3) |
| `admin/dashboard.js` | Lädt die Events, hält Tab, Suche, Sortierung und aufgeklappte Serien, rendert in `#admin-events-tabs` und `#admin-events-table`; Aktionen `switchAdminTab`, `searchAdminEvents`, `sortAdminEvents`, `toggleAdminSeries`, `resetAdminSearch`. Statistik, Audit-Log und Reset bleiben. |
| `admin/event-actions.js` | Rückfragen über `showConfirmDialog`, Meldungen aus Teil 2, Prüfung der Server-Antwort beim Löschen, Tab-Wechsel nach dem Duplizieren. `startEvent` bleibt für „Jetzt starten“. |
| `core/ui.js` | Option `danger` (Teil 4) |
| `events/cards.js` | neuer Export `eventStart(event)` (Start als `Date` oder `null`); liefert außerdem `eventEnd`, `isRunning`, `relativeDay` |

`event-rows.js` kennt kein HTML, `event-table.js` keine Regeln: Die Tabelle fragt für jede Zeile die Aktionen bei `event-rows.js` ab und setzt sie in Buttons um.

---

## Teil 6 — Tests und Verifikation

Alle Tests entstehen vor dem Code (`node:test`).

| Datei | Prüft |
|---|---|
| `test/capacity.test.js` | `describePlaces`: Zahlen wie `summarizePlaces`, `text` und `waitlistText` |
| `test/devServer.test.js` | `all-events` trägt `places` bei jedem Event; bei aktiven Events gleich wie in `GET /api/events/:id`; Entwurf und archiviertes Event haben ebenfalls `places` |
| `test/adminEventRows.test.js` (neu) | Tab und Zustand für jeden Status inklusive `cancelled`, leer und laufend/vorbei; Serien je Tab, Vertreter, Nummerierung, Serie mit einem Termin im Tab; Suche und Tab-Zahlen; Sortierung je Spalte und Richtung, Vergangenes unten, ohne Termin am Ende, Standard je Tab; Hauptaktion und Menü für jeden Zustand, mit und ohne `startDate`, mit und ohne `discordScheduledEventId`, in Serie und Serien-Zeile |
| `test/adminEventTable.test.js` (neu) | Markup: genau eine Hauptaktion und ein Menü je Zeile, „Anmeldungen · 2 offen“ als Primär-Button, Menü-Gruppen in der Reihenfolge, „Löschen“ nur im Menü, Escaping von Titel und Kategorie, `data-*`-Attribute, `aria-sort`, `aria-expanded`, keine Emojis. Verhalten: Tab-Wechsel, Suche, Sortieren und Aufklappen ohne neuen `fetch`; Leerzustände; Neuladen behält Tab und Suche |
| `test/adminEventActions.test.js` (neu) | Jede Rückfrage läuft über den Dialog mit Titel und passendem Button; Abbrechen schickt nichts; Fehlerantwort beim Löschen zeigt die Meldung des Servers; nach dem Duplizieren steht der Tab auf „Entwürfe“; im Quelltext von `event-actions.js` kein `confirm(` |
| `test/eventCards.test.js`, `test/actionAttributes.test.js`, `test/eventForm.test.js` | Die Prüfungen der Admin-Karten ziehen in die neuen Tests um oder entfallen mit Vorschau und Erinnerungs-Chip |
| `test/cssRules.test.js`, `test/styleguide.test.js` | neue Komponenten-Selektoren und Styleguide-Blöcke; Obergrenzen für Emojis und `style`-Attribute sinken |
| `e2e/admin.spec.js` (neu) | Tabs mit Zahlen, Suche mit Trefferzahlen, Sortieren, Serie auf- und zuklappen, Menü öffnet und liegt ganz im Fenster, Entwurf veröffentlichen landet in „Aktiv“, Löschen mit Abbrechen und mit Bestätigen, abgesagtes Event mit Chip im Archiv, 390 px ohne waagrechtes Scrollen |
| `e2e/tour.spec.js` | Selektoren an die Tabelle angepasst |

**Vorher-Nachher:** Screenshots bei 390 und 1440 px und die Seitenlänge vorher/nachher kommen in die Merge-Request-Beschreibung. Im Mock-Modus wird jede Aktion der Tabelle einmal im Browser ausgeführt.

---

## Teil 7 — Doku

| Stelle | Änderung |
|---|---|
| `docs/wiki/modules/routes-admin.md` | `places` in `all-events` |
| `docs/wiki/modules/utils.md` | `describePlaces` |
| `docs/wiki/concepts/event-lifecycle.md` | welche Aktion der Tabelle welchen Übergang auslöst |
| `docs/wiki/modules/frontend-app.md` | `admin/event-rows.js`, `admin/event-table.js`, geänderte `dashboard.js` und `event-actions.js`, `showConfirmDialog` |
| `docs/wiki/modules/frontend-markup.md` | Komponenten Tabelle und Menü; Markup des Admin-Bereichs |
| `docs/wiki/howto/add-event-field.md` | Schritt „anzeigen“: Tabelle statt Karte |
| `docs/wiki/ops/testing.md` | neue Tests |
| `docs/wiki/index.md`, `graph.json` | neue Dateien; `npm run wiki` |

---

## Risiken

| Risiko | Umgang |
|---|---|
| Die Antwort wächst mit dem Archiv, und das Dashboard liest die Anmeldungen jetzt zweimal (Statistik und Liste). | Für Discord-Communities auf Jahre unkritisch. Wird es eng: Archiv erst beim Öffnen des Tabs laden, ohne die Tabelle zu ändern. |
| Admins suchen die Buttons ▶ und ■. | Die Einträge heißen „Veröffentlichen“, „Jetzt starten …“ und „Jetzt beenden …“; die Merge-Request-Beschreibung nennt die Zuordnung alt → neu. |
| Zwischen 768 und 1000 px wird die Tabelle eng. | Titel und Plätze-Satz brechen um; im Browser bei 800 px geprüft. |
| Bestehende Tests hängen an den Admin-Karten. | Sie werden im selben Commit umgezogen; der Rundgang läuft auf beiden Viewports. |
| Die globalen Menü-Stile ändern das Danger-Zone-Menü. | Gewollt; im Browser geprüft und im Styleguide gezeigt. |
