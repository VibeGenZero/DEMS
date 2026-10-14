# Event-Assistent mit Vorschau — Design Spec
**Datum:** 2026-10-14 · **Ticket:** D-10 (GitLab #59, Prio-Plan `2026-10-07-dems-3.0-prioplan.md`) · **Abhängig von:** D-04 (Event-Karte `renderEventCard`); nutzt D-02 (Tokens, Tabs) und D-09 (`avatar()`)

## Überblick

Der Event-Assistent (`#eventModal`, `public/js/admin/wizard.js`) führt Admins in fünf Schritten durch ein Event: Grundlagen, Datum & Zeit, Teilnehmer, Formular, Erweitert.

- Die einzige Vorschau ist das Banner-Bild in Schritt 1. Wie die Karte in der Event-Übersicht oder die Ankündigung in Discord aussieht, sieht der Admin erst nach dem Speichern bzw. Ankündigen.
- Geprüft wird im Browser nur der Titel (Schritt 1 blockiert „Weiter“). Alles andere prüft der Server beim Speichern: ein Toast mit allen Fehlern hintereinander, der Assistent bleibt auf Schritt 5 stehen.
- Manches wird still verworfen: Formularfelder ohne Label (`getFormFieldsFromBuilder` filtert sie), Erinnerungen, die keine Zahl sind (`normalizeReminderHours`), eine Serie ohne „Wiederholen bis“ (wird als einzelnes Event angelegt).
- Ein aktives Event darf ohne Startdatum gespeichert werden; Karte und Discord zeigen dann „Termin folgt“ bzw. „TBA“, Erinnerungen laufen nicht.
- Die Labels des Assistenten tragen sieben Emojis (Banner, zweimal Datum, Wiederholung, Erinnerung, Kanäle, Bot-Nachrichten).

**Ziel:** Admins sehen vor dem Speichern, wie das Event bei Mitgliedern ankommt — als Karte in der Event-Übersicht und als Ankündigung in Discord — und Fehler fallen in dem Schritt auf, in dem sie entstehen. Optimiert wird für den Desktop.

**Erfolgskriterien**
- In jedem Schritt zeigt der Umschalter „Vorschau“ die Karte (`renderEventCard`) und die Discord-Ankündigung für die ungespeicherten Eingaben. Die Discord-Nachricht baut der Server mit denselben Funktionen wie „Ankündigen“; Karte und Nachricht nennen dieselben Platzzahlen.
- „Weiter“ verlässt einen Schritt mit Fehlern nicht; das Feld ist rot und nennt den Fehler auf Deutsch. „Speichern“ sendet nichts, solange ein Schritt Fehler hat, und springt zum ersten.
- Kein Weg erzeugt mehr ein aktives Event ohne Startdatum: Assistent, `POST`/`PUT /api/admin/events` und `PUT /api/admin/events/:id/status` lehnen es ab. Entwürfe dürfen ohne Datum gespeichert werden.
- Leere Formularfelder, unlesbare Erinnerungen und Serien ohne Ende werden gemeldet statt still verworfen.
- Im Assistenten stehen keine Emojis mehr; das Budget in `test/cssRules.test.js` sinkt von 30 auf 23.
- Kein Frontend-Modul über 500 Zeilen, keine neue Abhängigkeit; `npm test` und `npm run test:e2e` sind grün.

**Nicht im Umfang**
- Live-Aktualisierung beim Tippen: Die Vorschau entsteht beim Umschalten (gewählte Variante B; Formular und Vorschau sind nie gleichzeitig sichtbar).
- Event-Vorlagen (W-10), Kanalwahl pro Event (B-11), das neue Discord-Nachrichten-Layout (B-05), eine Vorschau im Dialog „Ankündigen“.
- Ein Start in der Vergangenheit ist kein Fehler (vergangene Events werden nachbearbeitet).
- Bestehende aktive Events ohne Startdatum bleiben, wie sie sind; erst wer sie im Assistenten speichert, muss ein Datum setzen oder „Entwurf“ wählen.
- Das Handy: Der Assistent bleibt dort bedienbar wie heute, wird aber nicht eigens gestaltet.

## Teil 1 — Bedienung

### Umschalter
- Rechts in der Zeile der Schritt-Punkte steht `nav nav-pills` mit zwei Buttons „Bearbeiten“ und „Vorschau“ (`data-click="setWizardMode"`, `data-mode="edit|preview"`, `aria-selected`). Auf schmalen Bildschirmen bricht er unter die Punkte um.
- „Vorschau“ blendet die Seite des aktuellen Schritts aus und zeigt `#wizard-preview`; „Bearbeiten“ kehrt zur selben Seite zurück. Öffnen des Assistenten (`showCreateEventModal`, `editEvent`) stellt immer „Bearbeiten“ ein und löscht alle Fehlermarken.

### Vorschau-Ansicht (`#wizard-preview`)
Zwei Blöcke untereinander, jeweils mit `.section-label`:
1. **„In der Event-Übersicht“** — `renderEventCard(draftEvent, now)` in der Breite einer Übersichtskarte. Der Block ist `inert`: Die Karte ist ein Link auf `#event/…`, ein Klick darf das Fenster nicht verlassen.
2. **„In Discord“** — die Ankündigung im Discord-Look (Teil 4), ebenfalls `inert` (Links und Buttons der Nachricht tun nichts).

Ablauf beim Umschalten:
- Die Karte steht sofort da, aus dem Entwurf (`previewEventOf`, siehe Teil 5) mit 0 belegten Plätzen, bis die Antwort die echten Zahlen bringt.
- Der Discord-Block zeigt ein Skeleton, der Browser schickt den Entwurf an `POST /api/admin/events/preview` (Teil 3). Mit der Antwort erscheinen Nachricht und — in der Karte — die `places` der Antwort.
- Schlägt die Anfrage fehl: im Discord-Block „Discord-Vorschau gerade nicht verfügbar.“ (`.text-body-tertiary`), die Karte bleibt.
- Eine Antwort, die erst nach dem Zurückschalten oder nach einer neueren Anfrage eintrifft, wird verworfen (Zähler wie `pollVoteSequence`).
- Ein neues Event zeigt die Nachricht wie direkt nach dem Ankündigen (leere Aufstellung), ein bestehendes mit seinen aktuellen Anmeldungen.

### Navigation
- Die Fußleiste bleibt in beiden Modi gleich. „Zurück“, „Weiter“ und die Schritt-Punkte schalten auf „Bearbeiten“ und wechseln dann den Schritt; „Weiter“ prüft dabei wie im Bearbeiten-Modus, „Zurück“ und die Punkte springen ohne Prüfung.
- „Speichern“ (Schritt 5) funktioniert auch aus der Vorschau.

### Pflichtfelder
- Titel: `*` wie heute.
- Startdatum: `*` (`#event-start-required`), sichtbar genau dann, wenn `#event-status` auf „Aktiv“ steht; `data-change="updateStartRequired"` am Status-Feld schaltet es um.

### Fehler zeigen
- Prüft der Assistent einen Schritt, bekommt jedes fehlerhafte Feld `.is-invalid` und darunter seinen Satz in einer `.invalid-feedback` (Bootstrap); der Fokus geht auf das erste Feld. Bei Gruppen ohne eigenes Eingabefeld (Rollen-Checkboxen) steht der Satz unter der Gruppe.
- Der Schritt-Punkt eines geprüften Schritts mit Fehlern bekommt `.has-error` (Blase in `--danger`); besteht der Schritt die nächste Prüfung, verschwindet die Marke.
- Ändert der Admin ein markiertes Feld (`input`/`change`), verschwindet dessen Marke; geprüft wird erst wieder bei „Weiter“ oder „Speichern“.
- „Weiter“ prüft den aktuellen Schritt; mit Fehlern bleibt der Assistent stehen. Die Schritt-Punkte springen ohne Prüfung.
- „Speichern“ prüft alle fünf Schritte, markiert jeden fehlerhaften Punkt und zeigt den ersten fehlerhaften Schritt im Bearbeiten-Modus; dann geht keine Anfrage raus.

### Symbole statt Emojis
Banner `bi-image`, Start- und Enddatum `bi-calendar-event`, Wiederholung `bi-arrow-repeat`, Erinnerungen `bi-alarm`, Kanäle `bi-headset`, Bot-Nachrichten `bi-robot`.

## Teil 2 — Prüfungen

`checkWizardStep(step, draft)` in `public/js/admin/wizard-checks.js` ist eine reine Funktion: Sie bekommt die Schrittnummer und den Entwurf aus `collectEventDraft()` und gibt `[{ field, message }]` zurück (leer = in Ordnung). `field` ist ein Schlüssel, den `wizard.js` einem Element zuordnet: `title`, `bannerUrl`, `startDate`, `endDate`, `recurringUntil`, `maxParticipants`, `reminderHours`, `requiredRoles`, `slots.<i>.name`, `slots.<i>.capacity`, `formFields.<i>.label`, `formFields.<i>.options`.

| Schritt | Feld | Fehler | Satz |
|---|---|---|---|
| 1 | `title` | leer oder nur Leerzeichen | „Bitte einen Titel eingeben.“ |
| 1 | `bannerUrl` | gesetzt, aber nicht `http://`/`https://` | „Die Banner-URL muss mit http:// oder https:// beginnen.“ |
| 2 | `startDate` | Status „Aktiv“ ohne Start | „Aktive Events brauchen ein Startdatum.“ |
| 2 | `endDate` | Ende vor Start | „Das Ende liegt vor dem Start.“ |
| 2 | `recurringUntil` | Serie ohne Datum | „Bis wann soll sich das Event wiederholen?“ |
| 2 | `startDate` | Serie ohne Start | „Eine Serie braucht ein Startdatum.“ |
| 2 | `recurringUntil` | Tag vor dem Starttag | „„Wiederholen bis“ liegt vor dem Start.“ |
| 3 | `maxParticipants` | keine ganze Zahl ≥ 0 (nur ohne Slots) | „Bitte eine ganze Zahl ab 0 eingeben.“ |
| 3 | `reminderHours` | ein Eintrag ist keine Zahl > 0 | „„24h“ ist keine Stundenzahl.“ (der erste unlesbare Eintrag) |
| 3 | `requiredRoles` | Zugang „Rollen-Requirement“ ohne Rolle | „Wähle mindestens eine Rolle.“ |
| 3 | `slots.<i>.name` | leer oder länger als `SLOT_NAME_MAX_LENGTH` | „Jeder Slot braucht einen Namen mit 1–30 Zeichen.“ |
| 3 | `slots.<i>.name` | Name doppelt (ohne Groß/Klein) | „Slot-Name „Tank“ ist doppelt vergeben.“ |
| 3 | `slots.<i>.capacity` | keine ganze Zahl im erlaubten Bereich | „Slot „Tank“ braucht 1–100 Plätze.“ |
| 4 | `formFields.<i>.label` | leer | „Jedes Feld braucht ein Label.“ |
| 4 | `formFields.<i>.label` | doppelt (ohne Groß/Klein, getrimmt) | „Das Label „Discord-Name“ gibt es schon. Antworten werden nach dem Label gespeichert.“ |
| 4 | `formFields.<i>.options` | Auswahlfeld ohne Option | „Ein Auswahlfeld braucht mindestens eine Option.“ |
| 5 | – | – | – |

Die Slot-Sätze und Grenzen sind dieselben wie in `normalizeSlots` (`utils/slotService.js`); die Grenzen stehen im Frontend schon in `admin/wizard-builders.js` oder kommen als Konstanten dazu. Ein Test vergleicht die Sätze mit dem Server.

### Server
- `validateEvent` (`middleware/validators.js`, für `POST /events` und `PUT /events/:id`): Mit dem wirksamen Status `req.body.status || 'active'` gilt „Aktive Events brauchen ein Startdatum.“; sind Start und Ende gesetzt und liegt das Ende davor: „Das Ende liegt vor dem Start.“ Beide Sätze landen wie die übrigen in der gemeinsamen Fehlermeldung.
- `PUT /events/:id/status`: Wechselt ein Event ohne `startDate` auf `active`, antwortet die Route 400 mit „Aktive Events brauchen ein Startdatum.“ Das Dashboard zeigt den Satz schon heute als Toast (`sendAdminAction`).
- `POST /events/:id/start` setzt fehlende Startdaten weiter auf „jetzt“ und ist nicht betroffen.

## Teil 3 — Endpunkt `POST /api/admin/events/preview`

- In `routes/admin.js` oberhalb der `/events/:id/…`-Routen; dort gelten schon `requireAdmin` und die CSRF-Prüfung.
- **Eingabe:** der Entwurf aus `collectEventDraft()` (dieselben Felder wie beim Speichern), beim Bearbeiten zusätzlich `id`.
- **Kein `validateEvent`:** Ein halbfertiger Entwurf (ohne Titel, ohne Datum) muss sich anzeigen lassen.
- **Aufbereitung** in `utils/eventPreview.js` (neu, ohne Datenbank): `buildPreviewEvent(body)` gibt die Felder zurück, die Karte und Ankündigung brauchen — `title`, `description`, `startDate`, `endDate`, `bannerUrl` (nur als http(s)-URL, sonst wirft discord.js), `category`, `status` (Standard `active`), `accessMode` (Standard `open`), `allowGuests`, `formFields` (nur mit Label), `accentColor`, `slots` und `maxParticipants` — mit denselben Regeln wie `POST /events`: Slots über `normalizeSlots` (bei einem Fehler: keine Slots), `maxParticipants` als Slot-Summe bzw. Zahl, Gäste bei Slot-Events aus. Strings werden auf ihre Länge begrenzt wie im Validator (Titel 200, Beschreibung 5000).
- **Aufstellung:** ohne `id` `buildRoster(previewEvent, [])`, mit `id` `loadEventRoster(id, previewEvent)`.
- **Antwort 200:**
  ```json
  {
    "embed": { "title": "…", "description": "…", "color": 9133302, "fields": [], "image": { "url": "…" }, "footer": { "text": "…" }, "timestamp": "…" },
    "components": [{ "type": 1, "components": [{ "type": 2, "style": 3, "label": "Tank", "emoji": { "name": "🛡️" }, "custom_id": "…" }] }],
    "places": { "taken": 0, "capacity": 6, "text": "0 von 6 Plätzen belegt", "…": "…" },
    "bot": { "name": "DEMS Bot", "avatarUrl": "https://cdn.discordapp.com/…" }
  }
  ```
  `embed` und `components` sind `toJSON()` von `buildEventEmbed(previewEvent, buildEventUrl(id || 'vorschau'), roster)` und `buildEventComponents(previewEvent, id || 'vorschau', roster)`; `places` ist `roster.places`; `bot` kommt aus `getBotStatus()` (Name ohne `#0000`, ohne Bot „DEMS“ und `null`).
- **Fehler:** 500 mit `{ error: 'Vorschau konnte nicht erstellt werden.' }`.
- Speichert nichts, schreibt kein Audit-Log, sendet nichts an Discord. `bot.js` bekommt keine neue Funktion (`buildEventEmbed`, `buildEventComponents` und `getBotStatus` sind schon exportiert und haben ihr Mock-Gegenstück).

## Teil 4 — Discord-Darstellung

`renderDiscordMessage(preview, now)` in `public/js/admin/discord-preview.js` (neu, rein, ohne DOM) gibt das HTML einer Discord-Nachricht zurück; alle Texte laufen durch `escapeHtml`, Beschreibung und Feldwerte durch `renderMarkdownSafe`.

- **Kopf:** `avatar({ url: bot.avatarUrl, name: bot.name })`, der Name fett, eine Plakette „APP“, die Uhrzeit „Heute um 18:00“ aus `now`.
- **Embed** (`.discord-embed`): links eine 4-px-Leiste in `embed.color` (Zahl → `#rrggbb`, gesetzt über `data-style-border-color` und `applyStyleData`), Titel, Beschreibung, Felder, Bild, Fußzeile.
  - Felder: `inline: true` stehen bis zu drei nebeneinander, andere über die ganze Breite (CSS-Grid mit drei Spalten).
  - Bild: `<img>` über die Embed-Breite, `data-fallback="hide"`.
  - Fußzeile: `footer.text` und „Heute um 18:00“ aus `timestamp`.
- **Buttons:** je `components`-Zeile eine Reihe; Stil 1 Blau, 2 Grau, 3 Grün, 4 Rot, 5 (Link) Grau mit `bi-box-arrow-up-right`; vor dem Label das Emoji aus `emoji.name` (Daten vom Server).
- **Farben** als neue Tokens in `tokens.css`: `--discord-bg`, `--discord-embed-bg`, `--discord-text`, `--discord-heading`, `--discord-muted`, `--discord-link`, `--discord-button-secondary`, `--discord-button-success`, `--discord-button-danger`; „APP“-Plakette und blaue Buttons nutzen die vorhandenen `--discord`/`--on-discord`, Schrift auf Buttons `--on-discord`. Werte nach Discords dunklem Design; jedes Text/Fläche-Paar erreicht 4,5:1, sonst wird der Ton leicht angepasst.
- **Stile** in einem neuen Block „DISCORD PREVIEW“ in `style.css` (`.discord-message`, `-header`, `-app-tag`, `.discord-embed`, `-title`, `-description`, `-fields`, `-field`, `-image`, `-footer`, `.discord-buttons`, `.discord-button` mit `.is-primary/-secondary/-success/-danger/-link`) und „WIZARD PREVIEW“ (`.wizard-mode`, `#wizard-preview`, `.wizard-preview-card`, `.wizard-step-item.has-error`). Nur Tokens, keine `style`-Attribute.

## Teil 5 — Module

| Modul | Inhalt |
|---|---|
| `admin/wizard.js` | wie heute; neu `collectEventDraft()` (aus `saveEvent` herausgelöst, auch für die Vorschau), `setWizardMode(mode)`, `updateStartRequired`, „Weiter“ und „Speichern“ mit Prüfung |
| `admin/wizard-marks.js` (neu) | `showStepErrors(step, errors)` (Marken setzen und löschen, roter Schritt-Punkt), `clearAllMarks()`, das Löschen einer Marke beim Ändern des Felds |
| `admin/wizard-location.js` (neu) | die Ort-Autovervollständigung aus `wizard.js` (`loadChannelsForAutocomplete`, `handleLocationInput`, `selectLocationChannel`), damit `wizard.js` unter 500 Zeilen bleibt |
| `admin/wizard-checks.js` (neu) | `checkWizardStep(step, draft)`, `WIZARD_MESSAGES` (die Sätze aus Teil 2); rein |
| `admin/wizard-preview.js` (neu) | `renderWizardPreview(draft, editId)` (Karte sofort, Anfrage, Discord-Block), `cancelWizardPreview()`, `previewEventOf(draft, editId, places)` (Entwurf → Event-Objekt für `renderEventCard`) |
| `admin/discord-preview.js` (neu) | `renderDiscordMessage(preview, now)`; rein |
| `utils/eventPreview.js` (neu) | `buildPreviewEvent(body)`; rein |

`collectEventDraft()` liefert dieselben Felder wie heute der Körper von `saveEvent` (inklusive `fromPoll`), Formularfelder aber ungefiltert, damit leere Labels gemeldet werden können; `saveEvent` entfernt vor dem Senden nichts mehr, weil die Prüfung leere Labels schon abfängt. Die Erinnerungen bleiben der Text aus dem Feld; die Prüfung liest ihn mit derselben Trennung wie `reminderHoursOf`.

## Teil 6 — Tests und Verifikation

Test zuerst (rot), dann Umsetzung.

| Datei | Inhalt |
|---|---|
| `test/devServer.test.js` | Vorschau als Admin: Titel „🎉 …“, Datum- und Plätze-Feld, Slot-Buttons, `places`, `bot`; ein Entwurf ohne Titel und Datum geht; Mitglied 403; ohne CSRF-Token abgelehnt; die Zahl der Events ändert sich nicht; ein bestehendes Event (`dev-event-full`) zählt seine Anmeldungen. Server-Regeln: aktiv ohne Start 400 mit dem Satz, Entwurf ohne Start 200, Ende vor Start 400, `PUT /events/:id/status` auf aktiv ohne Start 400, mit Start 200. |
| `test/eventPreview.test.js` (neu) | `buildPreviewEvent`: Standardwerte, Slot-Summe, ungültige Slots fallen weg, Gäste bei Slots aus, Längen begrenzt |
| `test/wizardChecks.test.js` (neu) | jede Zeile der Tabelle aus Teil 2 mit gutem und schlechtem Wert; die Slot-Sätze gleichen denen von `normalizeSlots` |
| `test/discordPreview.test.js` (neu) | Kopf mit Avatar und Bot-Name, Farbe als `#rrggbb`, Felder inline/ganze Breite, Bild mit Fallback, Buttons nach Stil mit Emoji, Link-Button mit Symbol, Escaping in Titel, Feldern und Labels, kein `style=` |
| `test/wizardFlow.test.js` (neu, `loadFrontendApp`) | „Weiter“ ohne Titel bleibt auf Schritt 1 und markiert; aktiver Status ohne Start blockiert Schritt 2, Entwurf nicht; `*` am Start folgt dem Status; „Speichern“ ohne Startdatum springt zu Schritt 2, markiert den Punkt und sendet nichts; „Vorschau“ sendet den Entwurf mit CSRF an `/api/admin/events/preview`, zeigt Karte und Nachricht; Fehlerantwort zeigt den Hinweis; eine späte Antwort wird verworfen; „Weiter“ aus der Vorschau schaltet auf „Bearbeiten“ |
| `test/designTokens.test.js` | die Discord-Paare erreichen 4,5:1 |
| `test/cssRules.test.js` | `EMOJI_BUDGET` 30 → 23; neue Klassen in der Liste der bekannten Komponenten, falls der Test das verlangt |
| `e2e/wizard.spec.js` (neu) | Admin legt ein Event an: „Weiter“ ohne Titel bleibt stehen und zeigt den Satz; mit Titel weiter; Status „Aktiv“ ohne Datum blockiert Schritt 2; Datum setzen; Slot-Vorlage MMO-Raid; Vorschau zeigt Karte mit Titel und Discord-Nachricht mit Titel und drei Slot-Buttons; „Speichern“ aus der Vorschau legt das Event an; ein zweites Event mit leerem Formularfeld und ohne Datum springt beim Speichern zu Schritt 2 und markiert die Punkte 2 und 4 |
| `e2e/tour.spec.js`, `e2e/csp.spec.js` | klicken heute durch den Assistenten; sie wählen ein Startdatum bzw. den Status „Entwurf“, wo die Prüfung das verlangt |

Danach: `npm test`, `npm run test:e2e`, Blick im Mock-Modus (Desktop 1440 px) auf alle fünf Schritte in beiden Modi, eine Fehlermarke pro Schritt und die Vorschau eines Slot-Events, eines Events mit Banner und eines Entwurfs.

## Teil 7 — Doku

- `docs/wiki/modules/frontend-app.md`: neue Module und Funktionen aus Teil 5.
- `docs/wiki/modules/frontend-markup.md`: Umschalter, `#wizard-preview`, `#event-start-required`, Blöcke „DISCORD PREVIEW“ und „WIZARD PREVIEW“, Discord-Tokens.
- `docs/wiki/modules/routes-admin.md` und `docs/wiki/reference/api-index.md`: `POST /api/admin/events/preview`; die Startdatum-Regel bei `POST`/`PUT /events` und `/status`.
- `docs/wiki/modules/utils.md`: `utils/eventPreview.js`.
- `docs/wiki/concepts/event-lifecycle.md`: aktive Events brauchen ein Startdatum; Prüfung pro Schritt und Vorschau im Assistenten.
- `docs/wiki/howto/add-event-field.md`: Feld in `collectEventDraft()`, bei Bedarf eine Regel in `checkWizardStep`, Anzeige in `buildPreviewEvent`, wenn Karte oder Ankündigung es zeigen.
- `docs/wiki/ops/testing.md`: neue Testdateien.
- `npm run wiki`.

## Risiken

- **Bestehende Tests mit aktiven Events ohne Startdatum:** `devServer.test.js` und andere Suiten legen Events per `POST` an, teils ohne Datum. Sie bekommen ein Datum oder den Status „Entwurf“. Der Seed hat für jedes aktive Event ein Datum (geprüft: keines ohne).
- **`PUT /events/:id` ohne `status`:** Der Validator nimmt dann „aktiv“ an. Einziger Aufrufer ist der Assistent, und der sendet den Status immer (geprüft).
- **Discord-Markdown ≠ marked:** Die Vorschau nähert Discord an (fett, kursiv, Links, Listen). Überschriften und Spoiler sehen anders aus; die Nachricht selbst bleibt die echte.
- **Bot offline oder ohne Avatar:** Kopf zeigt „DEMS“ mit Initialen-Kachel.
- **Embed-Leiste:** `applyStyleData` kennt `data-style-border-color` schon; das Embed hat nur links einen Rand, also färbt es genau die Leiste.
- **Modulgröße:** `wizard.js` hat heute 476 Zeilen; Marken und Ort-Autovervollständigung ziehen deshalb in eigene Module.
