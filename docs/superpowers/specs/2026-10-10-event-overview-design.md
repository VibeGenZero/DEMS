# Event-Übersicht neu — Design Spec
**Datum:** 2026-10-10 · **Ticket:** D-04 (GitLab #53, Prio-Plan `2026-10-07-dems-3.0-prioplan.md`) · **Abhängig von:** D-02 (Tokens und Komponenten), F-16 (Browser-Tests)

## Überblick

Die Event-Übersicht (`#events`) zeigt jedes Event als große Karte mit 160-px-Banner bzw. Platzhalter, Beschreibung, Countdown und bis zu sechs Chips. Auf einem 390-px-Handy ist eine Karte rund 550 px hoch; die acht aktiven Dummy-Events ergeben 4438 px Seitenlänge, im ersten Bildschirm steht gut eine Karte. Ein vergangenes, noch aktives Event („Retro-Spieleabend“, vor 7 Tagen) steht ganz oben mit „Event hat bereits begonnen“, weil die API nur nach Status filtert und aufsteigend sortiert. Ob man selbst angemeldet ist, zeigt die Karte nicht; die API liefert es nicht mit. Die Kategorie-Leiste lädt alle Kategorien aller Events (auch von Entwürfen und Archiv) über einen eigenen Endpunkt; jede Suche und jeder Kategorie-Klick schickt eine neue Anfrage. `events/list.js` hat 521 Zeilen.

D-04 baut die Übersicht neu: kompakte Karten mit Datums-Kachel, Banner, Plätze-Balken und eigenem Status; nur kommende und laufende Events; Filter und Suche im Browser.

**Ziel:** Auf dem Handy sieht man viele Events auf einen Blick und erkennt sofort, wann sie sind, wie voll sie sind und ob man dabei ist. Im echten Einsatz hat jedes Event ein Banner; es bleibt sichtbar.

**Erfolgskriterien**
- Bei 390 px Breite beginnen mindestens 4 Karten im ersten Bildschirm (844 px); die Seite scrollt nicht waagrecht.
- Bei 1440 px stehen die Karten in drei Spalten, das Banner oben.
- Vergangene Events fehlen in der Übersicht; ein laufendes Event steht oben mit „Läuft gerade“.
- Eigene Events tragen „Angemeldet“, „Ausstehend“, „Warteliste“ oder „Als Gast“.
- Kategorie-Filter und Suche lösen keine neue Anfrage aus; die Leiste zeigt nur Kategorien mit kommenden Events.
- Neue Oberfläche ohne Emojis und ohne neue `style`-Attribute.
- `events/list.js` hat höchstens 500 Zeilen.
- `npm test` und `npm run test:e2e` sind grün; keine neue Abhängigkeit.

**Nicht im Umfang**
- Event-Seite (D-05), Admin-Dashboard (D-07), Profil (D-08), Avatare (D-09), Assistent-Vorschau (D-10).
- Kategorien mit eigener Farbe und eigenem Symbol (W-13); Banner-Upload (W-12).
- `prefers-reduced-motion`, Fokusrahmen (D-03); helles Schema (D-15); übrige `style`-Attribute (D-16).
- Kalenderansicht neu gestalten; sie lädt nur ihre Daten selbst.
- „Weitere laden“: Die Übersicht zeigt bis zu 100 kommende Events.

**Entscheidungen (10.10.2026)**
1. Vergangene Events fallen aus der Übersicht; laufende bleiben oben. Alte Events findet man im Kalender und im Profil.
2. Handy: Zeile mit Datums-Kachel links, Text, Banner-Vorschau rechts (breit, 104 × 60). Desktop: Kacheln mit Banner oben, drei Spalten. Ein Markup, das CSS stellt um.
3. Serie: eine Karte für den nächsten Termin mit „Serie · N Termine“; die Event-Seite listet alle Termine.
4. Auf der Karte bleibt nur, was über „Kann ich mitmachen?“ entscheidet: „Rolle nötig“ und der Plätze-Stand. Beschreibung, Instant/Manuell und Rollen-Chips stehen nur auf der Event-Seite.
5. Markierungen: Angemeldet, Ausstehend, Warteliste, Als Gast; abgelehnt und abgemeldet ohne Markierung.
6. Ansatz: Der Server filtert kommende Events (`?upcoming=1`) und liefert `myStatus`; Kategorie und Suche filtern im Browser.
7. Symbole sind Bootstrap Icons, nie Emojis (neue Regel, gilt fürs ganze Frontend).

---

## Teil 1 — Daten und API

### Laufzeit eines Events

Ein Event ist vorbei, wenn sein Ende vor jetzt liegt. Ende ist `endDate`, ohne `endDate` der Start plus 2 Stunden — dieselbe Regel wie der Bot-Status. Ein Event ohne `startDate` gilt als kommend.

Das neue reine Modul `utils/eventListing.js` (ohne Datenbank und Bot, damit `bot.js` es ohne Kreisbezug laden kann) bekommt `eventEndTime(event)`, `isEventOver(event, now)` und `myRegistrationStatus(registrations, userId)` (Regel für `myStatus`, siehe unten); `bot.js` (Auto-Status) nutzt `isEventOver` statt seiner eigenen Rechnung.

### `GET /api/events`

| Ergänzung | Verhalten |
|---|---|
| `?upcoming=1` | Entfernt Events mit `isEventOver(event, now)`, **bevor** Serien zusammengefasst werden. `seriesDates` enthält dadurch nur kommende Termine; eine ganz vergangene Serie verschwindet. Ohne den Parameter bleibt alles wie heute. |
| `myStatus` (jedes Event) | Für den eingeloggten Nutzer aus den Anmeldungen, die der Endpunkt ohnehin liest: eigene Anmeldung mit `accepted`, `pending` oder `waitlisted` → dieser Wert; sonst Gast (`guests` enthält die eigene ID) in einer Anmeldung mit `accepted` oder `pending` → `guest`; sonst `null`. `rejected` und `cancelled` ergeben `null`. Bei einer Serie gilt der Status des Termins, der die Serie vertritt. |

Sortierung bleibt aufsteigend nach `startDate`; laufende Events stehen dadurch oben. Die Antwort enthält keine weiteren Felder; `checkinCode` bleibt ausgeblendet (`toPublicEvent`).

### Entfällt

`GET /api/events/categories`. Die Übersicht bildet die Leiste aus den geladenen Events; der Endpunkt zeigte Mitgliedern zudem Kategorien von Entwürfen und Archiv.

### Aufrufe im Browser

| Ansicht | Anfrage |
|---|---|
| Karten | einmal `/api/events?upcoming=1&limit=100` beim Öffnen der Übersicht |
| Kalender | beim ersten Umschalten einmal `/api/events?limit=500` (auch vergangene Events); das Ergebnis bleibt für das Blättern zwischen Monaten |

---

## Teil 2 — Karte und Layout

### Markup

Jede Karte ist ein Link: `<a class="glass-card event-card" href="#event/<id>">`. Damit greift die Hover-Regel aus D-02 (nur klickbare Karten), Mittelklick öffnet einen Tab, die Tastatur erreicht die Karte. Teile: Banner (`.event-card-media`), Datums-Kachel, Titel, Zeitangabe, Fakten-Zeile.

### Anordnung

| Breite | Anordnung |
|---|---|
| unter 768 px | eine Spalte; Zeile: Datums-Kachel · Text · Banner 104 × 60 rechts |
| ab 768 px | zwei Spalten; Kachel: Banner oben (volle Breite, ca. 118 px hoch), darunter Datums-Kachel und Text |
| ab 1200 px | drei Spalten |

Die Umstellung macht CSS (Grid-Bereiche), das Markup ist für alle Breiten gleich.

### Inhalt

| Teil | Inhalt |
|---|---|
| Banner | `<img>` mit `object-fit: cover` und `loading="lazy"`; darauf ein Chip mit der Kategorie. Fehlt das Bild oder lädt es nicht, zeigt die Fläche einen Verlauf in `accentColor`, sonst den heutigen Verlauf aus der Event-ID (`getEventGradient`). Die Farbe setzt JS per `style.setProperty('--event-accent', …)`. |
| Datums-Kachel | Wochentag, Tag, Monat (`SO / 11 / OKT`); läuft das Event, steht „LIVE“ in `--danger` auf `--danger-bg`. |
| Titel | höchstens zwei Zeilen, danach „…“. |
| Zeitangabe | „Läuft gerade · seit 14:56“, „Heute · 19:00“, „Morgen · 19:00“, „in 3 Tagen · 20:00“ (2–13 Tage), „in 2 Wochen · 18:00“ (ab 14 Tagen, abgerundet). Gezählt werden Kalendertage in der Zeitzone des Browsers. |
| Fakten-Zeile | eigener Status-Chip; „Rolle nötig“, wenn `accessMode` nicht `open` ist; „Serie · N Termine“; Plätze. Bricht bei Platzmangel um. |

| Status | Chip | Icon |
|---|---|---|
| `accepted` | „Angemeldet“, `.chip-success` | `bi-check-circle-fill` |
| `pending` | „Ausstehend“, `.chip-warning` | `bi-hourglass-split` |
| `waitlisted` | „Warteliste“, `.chip-info` | `bi-list-ol` |
| `guest` | „Als Gast“, `.chip-accent` | `bi-person-plus` |

„Rolle nötig“ nutzt `bi-lock`, „Serie“ `bi-arrow-repeat`.

**Plätze:** Mit `maxParticipants > 0` ein Balken und „5/20“; ab 80 % Belegung „Noch 2 Plätze“ in `--warning`; voll „Ausgebucht“ in `--danger` mit rotem Balken. Ohne Begrenzung nur „Unbegrenzt“, kein Balken.

### Kopf der Seite

Titel, Suchfeld und Ansicht-Umschalter bleiben. Die Kategorie-Leiste besteht aus `button.chip` mit Anzahl („Gaming 3“), „Alle“ zuerst, gewählt mit `.active`; sie bleibt einzeilig und lässt sich auf dem Handy seitlich wischen. Die `style`-Attribute im Kopf der Übersicht werden Klassen.

### Leer, Laden, Fehler

| Fall | Anzeige |
|---|---|
| keine kommenden Events | `emptyState`: „Keine anstehenden Events“ |
| Suche/Kategorie ohne Treffer | `emptyState`: „Keine Treffer“, Button „Filter zurücksetzen“ |
| Laden | Skeleton in Zeilen- bzw. Kachelform |
| Fehler (auch 429) | Hinweis mit Button „Erneut versuchen“; die Meldung „Check Console“ entfällt |

### Komponenten

Neu in `components.css` und im Styleguide (`#sg-date-tile`, `#sg-capacity`), damit D-07 und D-08 sie wiederverwenden:

| Komponente | Klassen |
|---|---|
| Datums-Kachel | `.date-tile` mit `.date-tile-weekday`, `-day`, `-month`; `.is-live` |
| Plätze-Balken | `.capacity` mit `.capacity-bar`, `.capacity-label`; `.is-low` (ab 80 %), `.is-full` |

Die Event-Karte selbst ersetzt den Block EVENT CARDS in `style.css`; COUNTDOWN und die Serien-Kartenregeln der Übersicht entfallen dort, soweit die Event-Seite sie nicht nutzt.

---

## Teil 3 — Module und Verhalten

| Modul | Inhalt |
|---|---|
| `events/cards.js` (neu) | reine Funktionen ohne DOM: `eventEnd(event)`, `isRunning(event, now)`, `relativeDay(date, now)`, `renderDateTile(event, now)`, `renderCapacity(event)`, `renderStatusChip(myStatus)`, `renderEventCard(event, now)` |
| `events/list.js` | `showEventsSection` (lädt kommende Events), Filter nach Kategorie und Suche im Browser, Kategorie-Leiste mit Anzahl, Leerzustände, Banner-Farben und Bild-Fallback, Ansicht-Umschalter |
| `events/calendar.js` (neu) | `renderCalendar`, `shiftCalendarMonth`, Laden aller Events beim ersten Umschalten |
| `events/detail.js` | übernimmt `formatCountdown`, `renderCountdownHTML`, `startCountdown` (nur noch die Event-Seite nutzt sie) |

- `cards.js` rechnet die Laufzeit-Regel aus Teil 1 nach; beide Stellen verweisen im Kommentar aufeinander.
- Werte im Markup gehen durch `escapeHtml`; Aktionsnamen stehen wörtlich im Markup (Regel aus D-01). Banner-Adressen nur über `isValidBannerUrl`.
- Suche und Kategorie filtern die geladene Liste sofort. Die Suche prüft wie bisher Titel und Beschreibung, dazu die Kategorie; Groß-/Kleinschreibung egal. „Filter zurücksetzen“ leert beide.
- „Läuft gerade“ und die Zeitangabe werden beim Rendern berechnet. Auf der Übersicht laufen keine Intervalle mehr.
- Die Einblend-Animation (GSAP) bleibt, kürzer.

---

## Teil 4 — Dummy-Daten

- **Banner:** Jedes Dummy-Event bekommt ein selbst gemachtes SVG-Banner im Format 2,5:1 aus `dev/banners/` (keine Emojis, keine fremden Bilder). Nur im Mock-Modus liefert der Server sie unter `/dev-banners/<name>.svg` aus; die Events zeigen per `BASE_URL` darauf. Genau ein Event (Workshop) bekommt eine Banner-Adresse, die nicht lädt, damit der Farb-Ersatz zu sehen ist.
- **Markierungen:** Tom (`member`) bekommt eine Anmeldung auf der Warteliste (Koop-Abend) und eine ausstehende Anfrage (Turnier). Mit Lena (`raider`, angemeldet) und Neo (`newbie`, Gast bei Chiara) zeigen die Personas alle vier Markierungen. Tests, die Anzahlen dieser Events prüfen, werden angepasst.

---

## Teil 5 — Tests und Verifikation

Alle Tests entstehen vor dem Code (`node:test`).

| Datei | Prüft |
|---|---|
| `test/devServer.test.js` | `?upcoming=1` ohne „Retro-Spieleabend“, mit „Live: Speedrun-Marathon“; `seriesDates` nur kommend; `myStatus` je Persona (`accepted`, `pending`, `waitlisted`, `guest`, `null`, abgelehnt → `null`); `/api/events/categories` → 404; `/dev-banners/<name>.svg` liefert ein SVG |
| `test/noMock.test.js` | ohne `DEV_MOCK` gibt es `/dev-banners/…` nicht |
| `test/eventListing.test.js` (neu) | `eventEndTime`, `isEventOver` mit und ohne `endDate`, ohne `startDate`; `myRegistrationStatus` für jeden Status, Gast, abgelehnten Gastgeber und ohne Anmeldung |
| `test/eventCards.test.js` | `cards.js`: `relativeDay` an Mitternacht und bei 13/14 Tagen, `isRunning`, Status-Chips, Plätze (unbegrenzt, 80 %, voll), Escaping von Titel/Kategorie/Banner-Adresse, keine Emojis; Übersicht: Filter und Suche ohne neuen `fetch`, Leiste mit Anzahl, Leerzustände, Kalender lädt einmal. Der bisherige Test „overview shows the preview“ entfällt mit der Beschreibung. |
| `test/cssRules.test.js` | Obergrenze für Emojis in `index.html` und `public/js` (heute 40, darf nur sinken); `style`-Obergrenze sinkt um die entfernten Attribute |
| `test/styleguide.test.js` | Blöcke `sg-date-tile` und `sg-capacity` |
| `e2e/events.spec.js` (neu) | 390 px: mindestens 4 Karten beginnen im ersten Bildschirm, kein waagrechtes Scrollen, Kategorie-Leiste seitlich scrollbar; 1440 px: drei Spalten; vergangenes Event fehlt; Lena sieht „Angemeldet“, Tom „Warteliste“ und „Ausstehend“, Neo „Als Gast“ |
| `e2e/tour.spec.js` | Selektoren an die neue Leiste und Karte angepasst |

**Vorher-Nachher:** Screenshots bei 390 und 1440 px und die Seitenlänge vorher/nachher kommen in die Merge-Request-Beschreibung.

---

## Teil 6 — Doku

| Stelle | Änderung |
|---|---|
| `docs/wiki/modules/frontend-app.md` | `events/cards.js`, `events/calendar.js`, geänderte `events/list.js` und `events/detail.js` |
| `docs/wiki/modules/frontend-markup.md` | Event-Karte, `.date-tile`, `.capacity`; Regel „Symbole sind Bootstrap Icons, nie Emojis (außer von Nutzern eingegebene)“ |
| `docs/wiki/modules/routes-events.md`, `docs/wiki/reference/api-index.md` | `upcoming`, `myStatus`; `categories` entfällt |
| `docs/wiki/modules/utils.md`, `docs/wiki/concepts/reminders-presence.md` | `utils/eventListing.js`; Auto-Status nutzt `isEventOver` |
| `docs/wiki/modules/dev-mock-mode.md`, `docs/wiki/ops/testing.md` | Banner, neue Anmeldungen, neue Tests |
| `CLAUDE.md` | Emoji-Regel unter „Styles“ |
| `docs/wiki/index.md`, `graph.json` | neue Dateien; `npm run wiki` |

---

## Risiken

| Risiko | Umgang |
|---|---|
| Mehr als 100 kommende Events: der Rest fehlt. | Für Discord-Communities unrealistisch (Serien zählen als ein Event); bei Bedarf „Weitere laden“ als eigenes Ticket. |
| Banner-Motive mit Text werden auf dem Handy beschnitten. | Breites Vorschaubild zeigt rund zwei Drittel; auf der Event-Seite ist das Banner vollständig. |
| Zeitzone des Browsers weicht von der Community ab. | Zeitangaben sind ohnehin lokal (`toLocaleString`); „Heute“ folgt derselben Uhr. |
| Geänderte Dummy-Anmeldungen brechen bestehende Tests. | Betroffene Tests werden im selben Commit angepasst; der Rundgang läuft auf beiden Viewports. |
