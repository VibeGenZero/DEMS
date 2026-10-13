# Profil neu: „Meine Events“ zuerst — Design Spec
**Datum:** 2026-10-13 · **Ticket:** D-08 (GitLab #57, Prio-Plan `2026-10-07-dems-3.0-prioplan.md`) · **Abhängig von:** D-02 (Tokens und Komponenten); nutzt D-04 (Datums-Kachel, Zeitzeile, Status-Chips, Balken) und D-07 (Bestätigungsdialog)

## Überblick

Die Profilseite (`#profile`) zeigt von oben nach unten: Kopf mit Avatar, Name und Discord-ID, vier Statistik-Kacheln, acht Badge-Karten, die Liste „Meine Registrierungen“ und die Account-Einstellungen. Im Mock-Modus beginnt die Liste bei Lena (1440 px) erst bei 1043 px, bei Tom auf dem Handy (390 px) erst nach rund 1600 px.

- Die Kacheln stehen treppenförmig versetzt: Die Einflug-Animation (GSAP) und der CSS-Übergang der Kacheln arbeiten gegeneinander.
- Die Liste zeigt das Anmeldedatum statt des Event-Datums und sortiert danach. Kommendes und Vergangenes stehen gemischt; zwei Termine der Serie „Wöchentliches Training“ sind nicht zu unterscheiden.
- Slot und offener Check-in fehlen in der Liste. Die Status-Pillen tragen Emojis.
- Die Badge-Karten brechen 7 + 1 um. „Newcomer“ hat kein Symbol, weil es `bi-seedling` in Bootstrap Icons nicht gibt.
- `GET /api/user/profile` hängt an jede Anmeldung das ganze Event (Beschreibung, Formularfelder, Bot-Texte).

D-08 baut die Seite in zwei Spalten neu: links „Kommende Events“ und „Verlauf“, rechts Profilkarte, Badges und Einstellungen.

**Ziel:** Wer sein Profil öffnet, sieht zuerst, wo er als Nächstes dabei ist: Event-Datum, Status, Slot und ob er einchecken kann. Optimiert wird für den Desktop; auf dem Handy bleibt die Seite ohne Querscrollen bedienbar.

**Erfolgskriterien**
- Bei 1440 × 900 px liegt die erste Zeile unter „Kommende Events“ im ersten Bildschirm. Bei 390 px steht „Kommende Events“ vor den Badges, und die Seite scrollt nicht waagrecht.
- Jede Zeile zeigt das Event-Datum. „Kommende Events“ ist nach Start sortiert, „Verlauf“ mit dem jüngsten zuerst.
- Slot, Status und Check-in stehen in der Zeile; der Button „Einchecken“ erscheint genau dann, wenn ein Check-in möglich ist.
- Die Antwort von `GET /api/user/profile` enthält je Event nur die acht Felder aus Teil 1, also weder `description` noch `formFields` noch `checkinCode`.
- Im Profil stehen keine Emojis außer denen, die Admins als Slot-Emoji eingegeben haben; die Obergrenze in `test/cssRules.test.js` sinkt.
- In `pages/profile.js` gibt es weder `confirm(` noch `gsap`.
- Kein Frontend-Modul über 500 Zeilen. `npm test` und `npm run test:e2e` sind grün; keine neue Abhängigkeit.

**Nicht im Umfang**
- Gast-Teilnahmen im Profil (Events, zu denen jemand anderes einen mitnimmt). Sie stehen weiter nur in der Event-Übersicht.
- Die Badge-Regeln und was als Teilnahme zählt: „Teilnahmen“ ist wie bei den Badges die Zahl der angenommenen Anmeldungen, auch für kommende Events.
- An-, Abmelden oder Einchecken direkt im Profil; der Check-in-Abschnitt der Event-Seite.
- Avatar-Fallback an anderen Stellen (D-09), Benachrichtigungs-Einstellungen (W-16), helles Farbschema (D-15).
- Die Browser-Rückfragen in Wartung, Kommentaren und beim Abmelden.
- Die Info-Seite „Deine gespeicherten Daten“ und `GET /api/user/registrations`.

**Entscheidungen (13.10.2026)**
1. Im Profil stehen nur eigene Anmeldungen.
2. Aufbau in zwei Spalten: links die Events, rechts Profilkarte, Badges, Einstellungen. Auf dem Handy eine Spalte.
3. Zeile wie die Karten der Event-Übersicht: Datums-Kachel, Titel, Zeitzeile, Chips unter dem Titel; rechts der Button „Einchecken“ oder ein Pfeil.
4. Badges als Liste mit Symbol, Name, Regel und Fortschritt.
5. Der Server trennt und sortiert; `GET /api/user/profile` liefert `upcoming` und `history` statt `registrations`.
6. Die ganze Zeile ist der Link zur Event-Seite. Abgelehnte Anmeldungen bleiben bis zum Termin unter „Kommende Events“ stehen, blasser.
7. Statt der Statistik-Kacheln stehen drei Zahlen in der Profilkarte; die Discord-ID steht nur noch im Debug-Panel.

---

## Teil 1 — Daten und API

### `GET /api/user/profile`

Antwort: `{ user, upcoming, history, stats, badges, unlockedBadges, totalBadges }`. Das Feld `registrations` entfällt. `user`, `stats`, `unlockedBadges` und `totalBadges` bleiben unverändert.

Ein Eintrag in `upcoming` und `history`:

| Feld | Inhalt |
|---|---|
| `id` | ID der Anmeldung |
| `status` | `accepted`, `pending`, `waitlisted` oder `rejected` |
| `checkedIn` | `true` oder `false` |
| `createdAt` | Anmeldedatum (ISO) |
| `slot` | `{ name, emoji, wish }` oder `null` (siehe unten) |
| `event` | `{ id, title, startDate, endDate, status, category, location, checkinEnabled }`; in `history` `null`, wenn das Event gelöscht ist |

- `event.location` ist der Text des Orts (`location.text`) oder `''`.
- `event.checkinEnabled` ist `true`, wenn der Check-in eingeschaltet ist und ein Code erzeugt wurde (dann nimmt `POST /api/events/:id/checkin` einen Code an), sonst `false`. Den Code selbst gibt die Antwort nie heraus.
- `slot`: Hat die Anmeldung einen Slot (`slotId`), stehen dessen Name und Emoji mit `wish: false` drin. Hat sie keinen, ist aber `pending` oder `waitlisted` und nennt einen Wunsch-Slot (`preferredSlotId`), steht der mit `wish: true` drin. Sonst `null`, auch wenn es den Slot im Event nicht mehr gibt.

### Trennen und sortieren

| Liste | Enthält | Reihenfolge |
|---|---|---|
| `history` | Event gelöscht, Status `cancelled` oder `archived`, oder das Event ist vorbei (`isEventOver`: Ende erreicht, ohne Ende Start + 2 Stunden) | absteigend nach Event-Start; ohne Event oder ohne Start nach `createdAt` der Anmeldung |
| `upcoming` | alles andere, also auch laufende Events, Events ohne Termin und Entwürfe | aufsteigend nach Event-Start; Events ohne Start am Ende; bei gleichem Start nach `createdAt` |

Die Anmeldung zählt in jeder Liste mit jedem Status, auch `rejected`.

### `utils/profileEvents.js` (neu)

Reine Funktionen ohne Datenbankzugriff:

- `buildProfileEvents(registrations, eventsById, now = new Date())` → `{ upcoming, history }`. `registrations` sind die Anmeldungen mit `id`, `eventsById` eine `Map` von Event-ID auf die Event-Daten.
- `toProfileEntry(registration, event)` → ein Eintrag wie oben.

Die Regel „vorbei“ kommt aus `utils/eventListing.js` (`isEventOver`), der Slot aus `utils/slotService.js` (`getSlots`, `findSlot`). `utils/eventListing.js` exportiert dafür zusätzlich `parseDate`.

### `routes/user.js`

`GET /profile` lädt Anmeldungen und Events wie bisher, rechnet `stats` und `badges` unverändert und ruft `buildProfileEvents` für die beiden Listen. Einzige Änderung an den Badges: „Newcomer“ bekommt das Symbol `bi-flower1`.

### Unverändert

`GET /api/user/registrations`, `GET/PUT /api/user/settings`, `DELETE /api/user/account`, `GET /api/user/search`.

---

## Teil 2 — Regeln der Seite

### Zeile unter „Kommende Events“

Datums-Kachel, Titel, Zeitzeile, Chips. Die Zeitzeile lautet wie in der Event-Übersicht („in 3 Tagen · 19:00“, „Läuft gerade · seit 14:30“, „Termin folgt“), dahinter der Ort, wenn es einen gibt („· Lobby“).

| Anmeldung | Chips | Rechts |
|---|---|---|
| angenommen | „Angemeldet“ | Pfeil |
| angenommen, eingecheckt | „Eingecheckt“ | Pfeil |
| angenommen, nicht eingecheckt, `checkinEnabled` | „Angemeldet“ | Button „Einchecken“ |
| ausstehend | „Ausstehend“ | Pfeil |
| Warteliste | „Warteliste“ | Pfeil |
| abgelehnt | „Abgelehnt“; die Zeile ist blasser | Pfeil |

Hinter dem Status-Chip steht der Slot-Chip: „🛡️ Tank“, bei `wish` „Wunsch: 🛡️ Tank“. Bei abgelehnten Anmeldungen entfällt er.

### Zeile im „Verlauf“

Datum („06. Okt. 2026“), Titel, ein Chip. Der erste zutreffende Fall gilt:

| Fall | Chip |
|---|---|
| Event gelöscht | Titel „Gelöschtes Event“, Datum = Anmeldedatum; Chip nach dem Status der Anmeldung (die folgenden Zeilen ohne „Abgesagt“) |
| Event abgesagt | „Abgesagt“ |
| angenommen und eingecheckt | „Eingecheckt“ (Erfolgsfarbe) |
| angenommen | „Teilgenommen“ |
| abgelehnt | „Abgelehnt“ |
| Warteliste | „Warteliste“ |
| ausstehend | „Nicht bestätigt“ |

Außer „Eingecheckt“ sind die Chips im Verlauf neutral.

### Links

In beiden Listen ist die ganze Zeile ein Link auf `#event/<id>`; der Button „Einchecken“ gehört zu diesem Link und führt damit auf die Event-Seite, wo der Code eingegeben wird. Kann der Nutzer die Event-Seite nicht öffnen (`canOpenEvent`: Entwurf oder Archiv für Mitglieder, gelöschtes Event), ist die Zeile kein Link und hat weder Pfeil noch Button. Zeilen im Verlauf haben nie einen Pfeil.

### Verlauf nachladen

Der Verlauf zeigt fünf Zeilen. „Weitere anzeigen“ zeigt je fünf mehr und verschwindet, wenn alle da sind. Das Nachladen löst keine Anfrage aus.

### Leer, Laden, Fehler

| Zustand | Anzeige |
|---|---|
| Laden | drei Platzhalter-Zeilen links, Platzhalter in Profilkarte und Badges |
| keine kommenden Events | Leerzustand „Noch nichts geplant“ mit „Melde dich für ein Event an, dann steht es hier.“ und dem Button „Events ansehen“ (`#events`) |
| kein Verlauf | Überschrift und Liste „Verlauf“ entfallen |
| Fehler (Netz oder Antwort ohne 2xx) | links der Leerzustand „Profil konnte nicht geladen werden“ mit Button „Erneut versuchen“; Profilkarte aus den Sitzungsdaten, Badges leer |

### Rechte Spalte

- **Profilkarte:** Avatar (`avatar()` in Größe `lg`, mit Initialen-Fallback), Anzeigename, `@name`. Darunter drei Zahlen: „Anmeldungen“ (`stats.total`), „Teilnahmen“ (`stats.accepted`), „Check-ins“ (`stats.checkedIn`). Die Zahlen stehen sofort da, ohne Hochzählen.
- **Badges:** Überschrift mit „4 von 8“. Eine Zeile je Badge: Symbol, Name, Regel (`description`). Erreichte Badges stehen zuerst, in der Reihenfolge der API; ihr Symbol trägt die Badge-Farbe. Offene Badges sind gedämpft und zeigen einen Balken, wenn sie `progress` haben.
- **Einstellungen:** „Einladungen erhalten“ und „Account löschen“ wie heute. „Account löschen“ fragt einmal über `showConfirmDialog` („Account und alle Anmeldungen dauerhaft löschen? Das lässt sich nicht rückgängig machen.“, Button „Account löschen“).

---

## Teil 3 — Aufbau und Aussehen

### Seite

Unter der Überschrift „Mein Profil“ steht ein Raster mit vier Bereichen:

| Breite | Anordnung |
|---|---|
| ab 992 px | zwei Spalten: links die Events (`minmax(0, 1fr)`), rechts 20 rem mit Profilkarte, Badges und Einstellungen untereinander |
| unter 992 px | eine Spalte: Profilkarte → Events → Badges → Einstellungen |

Das Debug-Panel (nur mit `DEBUG_MODE`) bleibt unter dem Raster in voller Breite.

### Markup

| Element | Inhalt |
|---|---|
| `#profile-card` | Profilkarte |
| `#profile-upcoming` | Zeilen „Kommende Events“; die Überschrift trägt die Anzahl (`#profile-upcoming-count`) |
| `#profile-history-block` | Überschrift mit Anzahl (`#profile-history-count`) und `#profile-history`; versteckt ohne Verlauf |
| `#profile-history-more` | Button „Weitere anzeigen“ (`data-click="showMoreProfileHistory"`) |
| `#profile-badges`, `#profile-badge-count` | Badge-Liste (`<ul>`) und „4 von 8“ |
| `#account-settings-card` | Einstellungen (IDs der Schalter bleiben); der Button heißt in der schmalen Spalte „Löschen“, der Dialog „Account löschen“ |

`#profile-header`, `#profile-header-card`, `#profile-stats`, `#profile-registrations`, `#profile-empty` und `#profile-load-more-wrapper` entfallen.

### Stile

Der Block „PROFILE SECTION“ in `style.css` wird ersetzt, nur mit Tokens aus `tokens.css`:

| Klasse | Zweck |
|---|---|
| `.profile-layout` und vier Bereichs-Klassen | das Raster |
| `.profile-card`, `.profile-numbers` | Profilkarte und die drei Zahlen |
| `.profile-event` (Link oder `div`), `.profile-event-body`, `.profile-event-title`, `.profile-event-facts`, `.profile-event-action`, `.is-muted` | Zeile unter „Kommende Events“ |
| `.profile-history-row` | Zeile im Verlauf |
| `.badge-list`, `.badge-row`, `.badge-row-icon`, `.is-locked` | Badge-Liste |

Aus den Komponenten kommen unverändert: `.glass-card`, `.date-tile`, `.chip` mit seinen Farben, `.btn`, `.avatar`, `.empty-state`, `.skeleton` und der Balken `.capacity-meter` (`<progress>`) für den Badge-Fortschritt. Die Badge-Farbe setzt `applyStyleData` über `data-style-color`. Es kommt keine neue Komponente dazu, also auch kein neuer Styleguide-Block.

### Entfällt

- Stile `.profile-header`, `.profile-avatar`, `.profile-name`, `.profile-meta`, `.profile-stats-grid`, `.profile-stat-card`, `.profile-stat-skeleton`, `.profile-badges-grid`, `.profile-badge-*`, `@keyframes badgePulse`, `.profile-reg-card`, `.profile-reg-info` und ihre Regeln im Block „RESPONSIVE“. `.stat-card` bleibt, das Admin-Dashboard nutzt sie.
- Alle GSAP-Aufrufe im Profil (Zähler, Einflug von Kacheln, Badges, Zeilen und Kopf).
- Die Emojis in den Status-Pillen, im Titel des Debug-Panels und in der Meldung zum Verbose-Logging.
- Die Discord-ID im Kopf.

---

## Teil 4 — Module

| Modul | Inhalt |
|---|---|
| `utils/profileEvents.js` (neu) | Trennen, Sortieren, Eintrag bauen (Teil 1) |
| `routes/user.js` | `/profile` nutzt `buildProfileEvents`; Newcomer-Symbol |
| `pages/profile-view.js` (neu) | Reine Funktionen ohne DOM-Zugriff, die HTML bauen: `renderProfileCard(user, stats)`, `renderUpcomingRow(entry, now, canOpen)`, `renderHistoryRow(entry, canOpen)`, `renderBadgeList(badges)`, Platzhalter. Alle Werte gehen durch `escapeHtml`. |
| `pages/profile.js` | Lädt das Profil, füllt die Bereiche, hält die Zahl sichtbarer Verlaufs-Zeilen; Aktionen `showMoreProfileHistory` und `reloadProfile`; `deleteUserAccount` über `showConfirmDialog`. `canOpenEvent`, Einstellungen, Debug-Panel und der Dialog zum ersten Login bleiben. |
| `events/cards.js` | `renderEventWhen(event, now, place = '')` hängt den Ort an die Zeitzeile; `renderDateTile`, `renderStatusChip` und `eventStart` werden wiederverwendet |
| `public/index.html` | Profil-Abschnitt nach Teil 3; Debug-Panel ohne Emoji |
| `pages/debug.js` | Der Styleguide zeigt unter „Bestand“ die neue Profil-Zeile und die Badge-Liste statt der Muster `.profile-reg-card` und `.profile-badge-card` (mit Emoji) |
| `public/css/style.css` | Block „PROFILE SECTION“ neu |

`profile-view.js` kennt weder `fetch` noch das DOM; `profile.js` baut kein HTML für Zeilen.

---

## Teil 5 — Dummy-Daten

Heute hat keine Persona einen Slot, eine Ablehnung oder ein abgesagtes Event. `dev/seedData.js` bekommt:

| Neu | Zeigt im Profil |
|---|---|
| Mori (Admin) ist im Raid mit Slot „Schaden“ angenommen | Slot-Chip |
| Tom ist beim „Workshop: Streaming-Setup“ abgelehnt | blasse Zeile „Abgelehnt“ unter „Kommende Events“ |
| Event „LAN-Abend“ (vor 14 Tagen, Status `cancelled`), Lena und Tom angenommen | „Abgesagt“ im Verlauf |

Schon abgedeckt: Tom mit Warteliste (Koop-Abend), Ausstehend (Turnier) und offenem Check-in (Speedrun); Lena eingecheckt im laufenden Event und mit zwei Terminen der Serie; beide mit „Retro-Spieleabend“ (eingecheckt) und dem archivierten „Sommerfest“ im Verlauf; Neo ohne Anmeldung.

Zahlen in bestehenden Tests, die sich dadurch verschieben (Anmeldungen im Raid und im Workshop, Zahl der Events im Admin-Archiv), werden angepasst.

---

## Teil 6 — Tests und Verifikation

Alle Tests entstehen vor dem Code (`node:test`).

| Datei | Prüft |
|---|---|
| `test/profileEvents.test.js` (neu) | mit festem `now`: laufendes Event und Event ohne Termin in `upcoming`, beendetes in `history`; `cancelled`, `archived` und gelöschtes Event in `history`; beide Sortierungen inklusive „ohne Start am Ende“ und gelöschtem Event nach `createdAt`; `slot` für genommenen Slot, Wunsch-Slot bei `pending` und `waitlisted`, `null` bei unbekanntem Slot und bei `rejected` mit Wunsch; `event` hat genau die acht Felder, `location` als Text, `checkinEnabled` als Boolean |
| `test/devServer.test.js` | Tom: `upcoming` in der Reihenfolge Speedrun (angenommen, `checkinEnabled`, nicht eingecheckt), Koop-Abend (Warteliste), Turnier (ausstehend), Workshop (abgelehnt); `history` in der Reihenfolge Retro-Spieleabend (eingecheckt), LAN-Abend (abgesagt), Sommerfest. Mori: Raid mit `slot.name` „Schaden“. Neo: beide Listen leer. Die Antwort hat kein `registrations`, kein Event trägt `description`, `formFields` oder `checkinCode`. |
| `test/profileView.test.js` (neu; ersetzt `test/profileRegistrations.test.js`) | Zeile je Zustand aus Teil 2; „Einchecken“ nur im dritten Fall; Slot- und Wunsch-Chip; Verlauf-Chip für jeden Fall; Link auf `#event/<id>` oder kein Link (Mitglied und archiviertes Event, Admin und archiviertes Event, gelöschtes Event); Escaping von Titel, Ort, Slot-Name und Badge-Texten; Badge-Liste: erreichte zuerst, Balken nur mit `progress`; Profilkarte mit den drei Zahlen; keine Emojis im Markup |
| `test/profileView.test.js` (Verhalten über `loadFrontendApp`) | Seite füllt alle Bereiche; „Weitere anzeigen“ zeigt fünf mehr ohne neuen `fetch` und verschwindet am Ende; ohne Verlauf ist der Block versteckt; Leerzustand ohne kommende Events; Fehlerantwort zeigt „Erneut versuchen“; „Account löschen“ fragt über den Dialog, Abbrechen schickt nichts; im Quelltext von `pages/profile.js` kein `confirm(` und kein `gsap` |
| `test/seed.test.js` | die drei neuen Dummy-Einträge; angepasste Zahlen |
| `test/vendorAssets.test.js` | jedes Badge-Symbol (`bi-*` in `routes/user.js`) steht in `public/vendor/bootstrap-icons/bootstrap-icons.css` |
| `test/cssRules.test.js` | Emoji-Obergrenze sinkt von 37 auf 30, die für `!important` in `style.css` von 30 auf 29 |
| `e2e/profile.spec.js` (neu) | Desktop: Events links neben der Profilkarte, erste Zeile im ersten Bildschirm. Handy: eine Spalte, kein waagrechtes Scrollen. Tom: „Einchecken“ führt auf die Event-Seite des Speedrun-Marathons. Lena: zwei Zeilen „Wöchentliches Training“ mit verschiedenen Daten. |
| `e2e/csp.spec.js`, `e2e/tour.spec.js` | Selektoren an das neue Markup angepasst |

**Vorher-Nachher:** Screenshots bei 390 und 1440 px für Lena und Tom kommen in die Merge-Request-Beschreibung. Im Mock-Modus wird die Seite mit allen vier Personas im Browser geöffnet.

---

## Teil 7 — Doku

| Stelle | Änderung |
|---|---|
| `docs/wiki/modules/routes-user.md` | Antwort von `/profile` mit `upcoming` und `history`, Regeln zum Trennen, Newcomer-Symbol |
| `docs/wiki/modules/utils.md` | `utils/profileEvents.js` |
| `docs/wiki/modules/frontend-app.md` | `pages/profile-view.js`, geändertes `pages/profile.js` |
| `docs/wiki/modules/frontend-markup.md` | Markup und Stil-Block des Profils; neue Emoji-Obergrenze |
| `docs/wiki/modules/dev-mock-mode.md`, `docs/wiki/ops/testing.md` | neue Dummy-Einträge, neue Tests |
| `docs/wiki/index.md`, `graph.json` | neue Dateien; `npm run wiki` |

---

## Risiken

| Risiko | Umgang |
|---|---|
| Die Antwort von `/profile` ändert ihre Form. | Nur `pages/profile.js` liest sie; die Info-Seite nutzt `/api/user/registrations`, das bleibt. |
| Die neuen Dummy-Einträge verschieben Zahlen in bestehenden Tests und im Rundgang. | Die betroffenen Tests werden im selben Commit angepasst; der Rundgang läuft auf beiden Viewports. |
| „Teilnahmen“ zählt auch angenommene Anmeldungen für kommende Events. | So zählen heute auch die Badges („7 Events teilgenommen“); beides gemeinsam zu ändern ist ein eigenes Ticket. |
| Zwischen 992 und 1100 px wird die linke Spalte schmal. | Der Titel bricht um, die Zeitzeile kürzt wie in der Event-Übersicht mit Auslassungspunkten, Chips laufen in die nächste Zeile; im Browser bei 1000 px geprüft. |
| D-14 nennt das Badge-Raster „7 + 1“. | Mit der Liste gibt es das Raster nicht mehr; der Punkt in D-14 entfällt und wird in der Merge-Request-Beschreibung genannt. |
