# Rollen-Slots — Design Spec
**Datum:** 2026-10-02

## Überblick

Events können **Rollen-Slots** bekommen, z. B. 🛡️ Tank 2 · 💚 Heiler 3 · ⚔️ Schaden 10. Jeder Slot hat eine eigene Kapazität. Mitglieder melden sich mit einer **Hauptrolle** und optional mit **Ausweichrollen** an — im Web oder in Discord über **einen Button pro Slot**. Die Discord-Ankündigung zeigt die Aufstellung und **aktualisiert sich live** bei jeder Änderung.

**Ziel:** Gaming-Communities (Raids, Turniere, Koop-Abende) können Aufstellungen in DEMS planen, statt die Rolle nur als Freitext-Formularfeld abzufragen.

**Erfolgskriterien**
- Ein Admin legt im Wizard Slots an (frei oder per Vorlage „MMO-Raid“); `maxParticipants` ergibt sich aus der Summe.
- Wer sich für einen vollen Slot anmeldet, landet automatisch in der ersten freien Ausweichrolle, sonst auf der Warteliste.
- Wird ein Platz frei, rückt die älteste passende Person von der Warteliste nach — auch bei Events mit Gästen ohne Überbuchung (behebt known-issue #6).
- Zwei gleichzeitige Anmeldungen auf den letzten Platz eines Slots ergeben genau eine Zusage.
- Die Discord-Ankündigung zeigt pro Slot `belegt/Kapazität` mit Namen und ist spätestens ~2 s nach einer Änderung aktuell.
- Mitglieder können in Web und Discord selbst in einen freien Slot wechseln oder sich abmelden.
- Events ohne Slots verhalten sich exakt wie bisher (bis auf die live aktualisierte Teilnehmerzahl im Embed).

**Teilprojekt:** Dies ist Teil 1 des Feature-Updates 2.6. Teil 2 (Terminabstimmung) bekommt eine eigene Spec.

---

## Teil 1 — Datenmodell

### `events` — neue Felder

| Feld | Typ | Bedeutung |
|---|---|---|
| `slots` | `[{ id, name, emoji, capacity }]` | leer oder fehlend = normales Event |
| `announcements` | `[{ channelId, messageId }]` | gespeicherte Discord-Ankündigungen für das Live-Embed |

- Bei Slot-Events gilt beim Speichern `maxParticipants = Σ capacity` und `allowGuests = false` (serverseitig erzwungen).
- `id`: 8 Zeichen aus `crypto.randomUUID()`, stabil über Bearbeitungen hinweg.

### `registrations` — neue Felder

| Feld | Typ | Bedeutung |
|---|---|---|
| `slotId` | string \| null | Slot, den die Person **tatsächlich** belegt; `null` auf der Warteliste |
| `preferredSlotId` | string | gewählte Hauptrolle |
| `altSlotIds` | string[] | Ausweichrollen, sortiert in Slot-Reihenfolge des Events |

„Ausweich“ heißt: `slotId !== preferredSlotId`. Die Felder existieren nur bei Anmeldungen zu Slot-Events.

### Validierung — `normalizeSlots(rawSlots, existingSlots)`

- höchstens **10** Slots, mindestens 1 (sonst wird das Feld als „keine Slots“ gespeichert)
- `name`: getrimmt, 1–30 Zeichen, eindeutig (case-insensitive)
- `emoji`: leer oder genau **ein Unicode-Emoji** (Regex mit `\p{Extended_Pictographic}`); andere Werte → Fehler. Discord lehnt Buttons mit ungültigem Emoji samt ganzer Nachricht ab. Custom-Discord-Emojis (`<:name:id>`) sind nicht im Scope.
- `capacity`: Ganzzahl 1–100
- `id`: übernommen, wenn sie einer bestehenden Slot-ID des Events entspricht, sonst neu erzeugt
- Fehler → `{ error }` mit deutscher Meldung, z. B. „Slot-Name „Tank“ ist doppelt vergeben.“

---

## Teil 2 — Regeln (`utils/slotService.js`, reine Funktionen)

Alle Funktionen sind ohne Datenbank testbar.

| Funktion | Verhalten |
|---|---|
| `normalizeSlots(rawSlots, existingSlots)` | siehe oben; liefert `{ slots }` oder `{ error }` |
| `countSlotOccupancy(slots, registrations)` | `{ [slotId]: n }` über Anmeldungen mit Status `pending` oder `accepted` |
| `pickSlot(slots, occupancy, preferredSlotId, altSlotIds)` | Hauptrolle frei → diese; sonst erste freie Ausweichrolle (Slot-Reihenfolge); sonst `null` |
| `pickWaitlistPromotions(slots, occupancy, waitlisted)` | geht die Warteliste nach `createdAt` (älteste zuerst) durch und vergibt jedem, für den `pickSlot` einen Slot findet, diesen Slot; aktualisiert die Belegung dabei; liefert `[{ registrationId, slotId }]` |
| `buildRoster(slots, registrations, users?)` | `{ slots: [{ id, name, emoji, capacity, taken, members: [{ userId, displayName, avatar, pending, isAlt }] }], waitlist: [{ userId, displayName, preferredSlotId, altSlotIds }] }` |
| `validateSlotChange(oldSlots, newSlots, occupancy, hasRegistrations)` | Fehler, wenn ein Slot mit Anmeldungen entfernt wird oder ein Event mit Anmeldungen von „ohne“ zu „mit“ Slots wechselt |

### Anmeldung (`registerUserForEvent`)

Neue Prüfung nach den Formularfeldern, nur bei Slot-Events:
- `slotId` (gewünschte Hauptrolle) muss eine Slot-ID des Events sein → sonst `invalid_slot` (400, „Bitte wähle einen gültigen Slot.“).
- `altSlotIds`: unbekannte IDs und die Hauptrolle werden verworfen, Rest in Slot-Reihenfolge sortiert.
- Gäste bei Slot-Events → `guests_not_allowed`.
- `pickSlot(...)` → Slot gefunden: Status `accepted`/`pending` nach `approvalMode`; kein Slot: `waitlisted`, `slotId: null`.
- Erfolgsantwort enthält zusätzlich `slotId` und `isAlt`, damit Web und Discord „als 💚 Heiler eingeplant (🛡️ Tank war voll)“ anzeigen können.

### Nachrücken (`promoteFromWaitlist`, neu geschrieben)

- **Slot-Events:** Belegung zählen → `pickWaitlistPromotions` → jede Anmeldung bekommt `slotId` + Status (`accepted` bei `instant`, sonst `pending`), DM mit Slot-Namen („🎉 Ein Platz wurde frei! Du rückst als 💚 Heiler nach.“), Rolle bei `accepted`.
- **Normale Events (Fix known-issue #6):** Belegung inkl. bestätigter und ausstehender Gäste (gleiche Zählung wie `countOccupiedSlots`). Die Warteliste wird älteste zuerst durchlaufen; jede Anmeldung, deren `1 + Gäste` noch passt, rückt nach. Es können mehrere Personen in einem Durchlauf nachrücken (z. B. nach Erhöhung der Kapazität).
- Kein automatisches Zurücksetzen von der Ausweich- in die Hauptrolle.

### Selbst wechseln

- Nur in einen Slot mit freiem Platz; sonst 409 „Dieser Slot ist bereits voll.“
- Setzt `slotId` und `preferredSlotId` auf den Ziel-Slot, entfernt ihn aus `altSlotIds`.
- Steht die Person auf der Warteliste und der Ziel-Slot ist frei, bekommt sie ihn (Status nach `approvalMode`).
- Danach Nachrücken für den freigewordenen Slot.

### Admin verschiebt

- In jeden Slot, auch in volle → Slot ist danach überbucht (`taken > capacity`), in überbuchte Slots rückt niemand nach.
- Ändert nur `slotId`, `preferredSlotId` bleibt (die Person erscheint dann ggf. als „Ausweich“).
- Danach Nachrücken für den freigewordenen Slot.

### Admin-Statuswechsel (`PUT /api/admin/registrations/:id/status`)

- → `accepted` bei einer Anmeldung ohne `slotId` (Warteliste/abgelehnt): `pickSlot`; findet sich nichts, bekommt sie ihre Hauptrolle (überbucht) und die Antwort enthält `warning: 'Slot „Tank“ ist jetzt überbucht.'`.
- → `waitlisted`: `slotId: null`, kein automatisches Nachrücken (wie bisher).
- → `rejected`: wie bisher inkl. Nachrücken.

### Event bearbeiten

- Slot mit Anmeldungen entfernen → 400 „Slot „Tank“ hat noch 2 Anmeldungen – bitte zuerst verschieben.“
- Normales Event mit Anmeldungen → Slot-Event: 400 „Slots können nur aktiviert werden, solange es keine Anmeldungen gibt.“
- Slot-Event → normales Event: erlaubt, Slot-Felder der Anmeldungen werden ignoriert.
- Kapazität unter Belegung: erlaubt (überbucht, niemand wird entfernt).
- Kapazität erhöht / Slot hinzugefügt: danach Nachrücken.

### Gleichzeitigkeit — `utils/eventLock.js`

`withEventLock(eventId, fn)` serialisiert alle Abläufe pro Event über eine Promise-Kette im Speicher (DEMS ist ein einzelner Prozess). Gesperrt werden: Anmelden, Selbst-Wechsel, Admin-Verschieben, Admin-Statuswechsel, Nachrücken. Die Sperre ist **nicht reentrant**: `promoteFromWaitlist` sperrt selbst; Abläufe, die bereits die Sperre halten, rufen die interne Variante `promoteFromWaitlistLocked` auf. Ein Fehler in `fn` gibt die Sperre frei.

### Abmelden — `unregisterUserFromEvent({ eventId, userId })`

Neu in `utils/registrationService.js`, ersetzt die doppelte Logik in `DELETE /api/events/:id/register` und `/unregister` und wird vom neuen Discord-Button genutzt: Anmeldung löschen, bei `accepted` Rolle **und** Event-Channel-Zugang entfernen (bisher fehlte Letzteres bei `/unregister`), bei `accepted`/`pending` Nachrücken, danach `notifyRegistrationsChanged`. Rückgabe `{ ok, error? }`.

---

## Teil 3 — Discord (`bot.js` + `dev/mockBot.js`)

### Buttons (`buildEventComponents`)

- **Slot-Events:** statt „Anmelden“ ein Button pro Slot, Custom-ID `event_slot:<eventId>:<slotId>`, Label `Tank` bzw. `Tank (voll)`, Emoji aus dem Slot, Stil `Primary` (frei) / `Secondary` (voll). Volle Slots bleiben klickbar (Ausweichrolle/Warteliste).
- Maximal 5 Buttons pro Zeile; der Link-Button „Zum Event“ folgt nach dem letzten Slot (10 Slots → 3 Zeilen).
- Ist das Event nicht `active` oder passt das Formular nicht in ein Modal, gibt es nur den Link-Button (wie heute).
- `canRegisterViaDiscord`: bei Slot-Events höchstens **4** Formularfelder (die Ausweichrollen-Auswahl belegt eine Modal-Komponente), bei Events mit genau einem Slot weiterhin 5.

### Klick auf einen Slot-Button (`handleEventSlotButton`)

1. Event laden, dann die eigene Anmeldung suchen. Existiert sie → Schritt 3. Sonst `checkRegistrationConditions` unverändert (Wartung, Status, Rolle) → bei Fehler ephemerale Meldung.
2. **Nicht angemeldet:** Modal `event_slot_modal:<eventId>:<slotId>` mit
   - Multi-Select „Ausweichrollen (optional)“ (`alt_slots`, min 0, max = Anzahl anderer Slots, Optionen = alle anderen Slots), nur wenn das Event mehr als einen Slot hat,
   - danach die Formularfelder wie im bisherigen Modal (Intro-Text nur, wenn Platz ist).
   - Kein Modal, wenn es weder Ausweichrollen noch Formularfelder gibt → direkte Anmeldung.
   - Absenden → `handleEventSlotModal` → `completeDiscordRegistration` mit `slotId`/`altSlotIds`.
   - Antwort-Embed (ephemeral) nennt den Slot: „✅ Du bist als 💚 Heiler eingeplant (🛡️ Tank war voll).“ bzw. Warteliste.
3. **Bereits angemeldet:** ephemerale Antwort „Du bist als 💚 Heiler eingeplant.“ (bzw. „…stehst auf der Warteliste.“) mit Buttons
   - `[Zu 🛡️ Tank wechseln]` → `slot_switch:<eventId>:<slotId>` — nur wenn der geklickte Slot nicht der eigene ist und Platz hat,
   - `[Abmelden]` → `slot_leave:<eventId>` (Stil `Danger`).
   - Beide Handler prüfen erneut (Platz kann inzwischen weg sein) und antworten per `interaction.update`.

### Live-Embed

- `sendChannelMessage` gibt `{ channelId, messageId }` statt `true` zurück (bestehende `if (success)`-Aufrufer bleiben korrekt); Mock analog mit Fake-IDs.
- `POST /api/admin/events/:id/announce` hängt das Ergebnis an `event.announcements` an.
- `buildEventEmbed(event, registrationLink, roster)` — `roster` optional:
  - **Slot-Events:** pro Slot ein Inline-Feld `🛡️ Tank 2/2 ✅` (✅ wenn voll, `⚠️` wenn überbucht), Wert: bis zu 5 Namen (`escapeMarkdown`), dann „+N“; leer → „— frei —“. Danach Feld `⏳ Warteliste` mit Anzahl, falls > 0. Das Feld „👥 Teilnehmer“ zeigt `belegt/Σ`.
  - **Normale Events:** „👥 Teilnehmer“ zeigt `belegt/max` bzw. `belegt (unbegrenzt)` statt „Max. N“.
  - Ohne `roster` bleibt das bisherige Verhalten (z. B. `/events`).
- Neuer exportierter Helper `refreshEventAnnouncements(eventId)`: Guard `if (!isReady) return false`, lädt Event + Anmeldungen, baut Embed und Buttons neu, `message.edit(...)` für jede gespeicherte Ankündigung. Discord-Fehler 10008/10003 (Nachricht/Channel unbekannt) → Eintrag aus `announcements` entfernen; andere Fehler → `console.error`. Mock-Zwilling loggt nur.

### Auslöser — `utils/announcementRefresh.js`

`notifyRegistrationsChanged(eventId)` bündelt Aufrufe pro Event (2 s Trailing-Debounce, Timer im Speicher) und ruft dann `refreshEventAnnouncements(eventId)` auf. Fehler werden geloggt, nie geworfen. Für Tests: `flushAnnouncementRefreshes()` führt anstehende Aktualisierungen sofort aus.

Aufgerufen nach: Anmeldung (Web/Discord), Abmeldung (alle Wege), Selbst-Wechsel, Admin-Verschieben, Admin-Statuswechsel, Nachrücken, Account-Löschung (für jedes betroffene Event, dort zusätzlich Nachrücken), sowie nach `PUT /events/:id`, `/status`, `/cancel`, `/start`, `/end` (damit Buttons bei inaktiven Events verschwinden).

### DMs und Templates

- Nachrück- und Bestätigungs-DMs bei Slot-Events nennen den Slot.
- Neue Template-Variablen `{slot.name}`, `{slot.emoji}` (leer bei normalen Events) in `buildTemplateVars`. `PUT /api/admin/registrations/:id/status` nutzt künftig dieselbe Funktion (exportiert) statt seiner Kopie.
- Die Variablen erscheinen in der Hilfe des Template-Dialogs.

---

## Teil 4 — API

| Methode & Pfad | Guard | Änderung |
|---|---|---|
| `POST /api/admin/events` | A | `slots` in der Whitelist → `normalizeSlots`; setzt `maxParticipants`, `allowGuests: false`; Serien-Instanzen erhalten dieselben Slots |
| `PUT /api/admin/events/:id` | A | `slots` in der Whitelist → `normalizeSlots` + `validateSlotChange`; danach Nachrücken + `notifyRegistrationsChanged`; `announcements` wird nie aus dem Body übernommen |
| `POST /api/admin/events/:id/duplicate` | A | `announcements: []` zurücksetzen (bisher kopiert `...original` alles) |
| `POST /api/admin/events/:id/announce` | A | speichert `{ channelId, messageId }` in `announcements`, sendet Embed mit Roster |
| `POST /api/events/:id/register` | U | Body zusätzlich `slotId`, `altSlotIds` |
| `PUT /api/events/:id/register/slot` | U | **neu**, Body `{ slotId }`, Selbst-Wechsel; 404 ohne Anmeldung, 400 bei Event ohne Slots/ungültigem Slot, 409 wenn voll |
| `PUT /api/admin/registrations/:id/slot` | A | **neu**, Body `{ slotId }`, Admin-Verschieben; Audit `MOVE_REGISTRATION_SLOT`; Antwort mit `warning` bei Überbuchung |
| `PUT /api/admin/registrations/:id/status` | A | Slot-Vergabe wie in Teil 2; Antwort ggf. mit `warning` |
| `GET /api/events/:id/participants` | U | bei Slot-Events zusätzlich `slots` und `waitlist` aus `buildRoster` (Nutzerprofile einmal per `getDocs(collection(db, 'users'))` laden, im Speicher zuordnen) |
| `GET /api/events/:id/my-registration` | U | enthält `slotId`, `preferredSlotId`, `altSlotIds` |
| `GET /api/events`, `/series/:seriesId`, `/:id` | — | zusätzlich `slotSummary: [{ id, name, emoji, capacity, taken }]` bei Slot-Events, berechnet im selben Durchlauf wie `currentParticipants` |
| `GET /api/admin/events/:id/registrations` | A | enthält die Slot-Felder |
| `GET /api/admin/events/:id/registrations/export` | A | neue CSV-Spalten „Slot“, „Wunschrolle“ |

Alle Routen: eigenes `try/catch`, deutsche `{ error }`-Meldungen. `checkinCode` bleibt aus allen neuen Antworten draußen.

---

## Teil 5 — Weboberfläche (`public/js/app.js`, `index.html`, `style.css`)

### Wizard, Schritt 3 „Teilnehmer“

- Schalter „Rollen-Slots verwenden“ → Slot-Editor: Zeilen mit Emoji (schmales Feld), Name, Plätze, Entfernen-Button; Buttons „+ Slot“ (bis 10) und „Vorlage: MMO-Raid“ (🛡️ Tank 2, 💚 Heiler 3, ⚔️ Schaden 10).
- Aktiv: „Max. Teilnehmer“ gesperrt mit Live-Summe; Gäste-Schalter aus und gesperrt, Hinweis „Bei Slot-Events nicht verfügbar“.
- `editEvent` füllt den Editor, `saveEvent` sendet `slots` (Funktion `getSlotsFromEditor`). Serverfehler (z. B. Slot mit Anmeldungen entfernt) als Toast.

### Event-Karten

Kompakte Chips aus `slotSummary`: `🛡️ voll · 💚 2 frei · ⚔️ 3 frei`.

### Event-Detailseite — Sektion „Aufstellung“

Ersetzt bei Slot-Events die Teilnehmer-Avatare (`loadDetailParticipants` verzweigt auf `renderRoster`):
- eine Spalte/Karte pro Slot mit Kopf `🛡️ Tank 2/2`, Füllbalken, Mitgliedern (Avatar + Name, ⏳ bei `pending`, Badge „Ausweich“ bei `isAlt`), freie Plätze als gestrichelte Platzhalter, überbuchte Slots rot markiert;
- darunter „Warteliste“ mit Namen und gewünschten Rollen (Emojis).
- Responsiv: Spalten umbrechen auf schmalen Bildschirmen.

### Anmeldung in der Seitenleiste

- Slot-Karten zur Auswahl der Hauptrolle (Emoji, Name, `taken/capacity`); volle Slots ausgegraut, aber wählbar, mit Hinweis „voll – Ausweich/Warteliste“.
- Chips „Ausweichrollen“ (Mehrfachauswahl, alle Slots außer der Hauptrolle).
- Gäste-Bereich bei Slot-Events ausgeblendet.
- `submitRegistration` sendet `slotId`, `altSlotIds`; Toast nennt den vergebenen Slot.

### Eigene Anmeldung

„Du bist als 💚 Heiler eingeplant“ (bzw. Warteliste), Dropdown „Slot wechseln“ mit nur freien Slots (`switchMySlot`), Abmelden wie bisher.

### Admin-Tabelle der Anmeldungen

Spalte „Slot“ mit Dropdown (alle Slots) → `moveRegistrationSlot`; `warning` aus der Antwort als `showToast(…, 'warning')`.

### Template-Dialog

Hilfetext um `{slot.name}`, `{slot.emoji}` ergänzen.

Alle Werte mit `escapeHtml`, alle Texte deutsch, neue Funktionen global (inline `onclick`). CSS in einem neuen Abschnitt „ROLE SLOTS“ in `style.css`.

---

## Teil 6 — Dev-Mock-Modus

- `dev/seedData.js`: Das Event „Raid: Schattenfestung“ bekommt Slots (🛡️ Tank 2, 💚 Heiler 3, ⚔️ Schaden 10); das Dropdown „Bevorzugte Rolle“ entfällt bei diesem Event. Seed-Anmeldungen bekommen passende Slot-Felder: Tank voll, ein Mitglied als Ausweich, eine Person auf der Warteliste.
- `dev/mockBot.js`: Mock für `refreshEventAnnouncements`; `sendChannelMessage` liefert Fake-IDs.

---

## Teil 7 — Tests (TDD, `node:test` + `node:assert/strict`)

| Datei | Inhalt |
|---|---|
| `test/slotService.test.js` (neu) | `normalizeSlots` (Limits, Emoji-Prüfung, ID-Stabilität, doppelte Namen), `countSlotOccupancy`, `pickSlot` (Haupt → Ausweich → null), `pickWaitlistPromotions` (älteste passende zuerst, mehrere auf einmal, überbuchte Slots), `buildRoster`, `validateSlotChange` |
| `test/eventLock.test.js` (neu) | Serialisierung pro Event, Parallelität über Events, Freigabe nach Fehler |
| `test/announcementRefresh.test.js` (neu) | Debounce bündelt Aufrufe, `flushAnnouncementRefreshes`, Fehler werden nicht geworfen |
| `test/eventComponents.test.js` (neu) | Slot-Buttons, max. 5 pro Zeile, „(voll)“, Link-Button zuletzt, inaktive Events; Embed-Felder inkl. „+N“ und Markdown-Escape |
| `test/devServer.test.js` | Personas: Anmeldung in vollen Slot → Ausweichrolle; ohne freie Ausweichrolle → Warteliste; Selbst-Wechsel (frei/voll); Admin verschiebt (inkl. `warning`); Abmeldung → passende Person rückt nach; zwei parallele Anmeldungen auf den letzten Platz; Slot mit Anmeldungen entfernen → 400; Duplizieren setzt `announcements` zurück; normales Event mit Gästen wird beim Nachrücken nicht überbucht (#6) |

---

## Teil 8 — Wiki & Release

- Neuer Knoten `docs/wiki/concepts/role-slots.md` (Regeln, Datenfelder, Discord-Ablauf, Gotchas).
- Aktualisieren: `data-model`, `registration-flow`, `discord-integration`, `bot`, `frontend-app`, `routes-events`, `routes-admin`, `api-index`, `utils`, `dev-mock-mode`, `index.md` (Knotenliste, Datei-Tabelle).
- `known-issues`: #6 entfernen.
- `npm run wiki`, `npm test` grün.
- `updates.json` → Version **2.6.0** mit Einträgen „🛡️ Rollen-Slots“, „🔄 Live-Ankündigungen“, „↔️ Slot wechseln & Abmelden in Discord“.
- Branch `feature/role-slots`, PR auf Deutsch (Problem / Ursache / Änderung / Verifikation).

---

## Datei-Änderungen

| Datei | Änderung |
|---|---|
| `utils/slotService.js` | **neu** — reine Slot-Logik |
| `utils/eventLock.js` | **neu** — Sperre pro Event |
| `utils/announcementRefresh.js` | **neu** — `notifyRegistrationsChanged`, Debounce |
| `utils/registrationService.js` | Slot-Vergabe, Sperre, `unregisterUserFromEvent`, `buildTemplateVars` exportiert mit Slot-Variablen, neuer Fehlercode `invalid_slot` |
| `utils/eventUtils.js` | `promoteFromWaitlist` neu (Slots, Gäste-Fix, mehrere Nachrücker, Sperre) |
| `bot.js` | Slot-Buttons, Slot-Modal, Wechsel/Abmelde-Buttons, Embed mit Roster, `refreshEventAnnouncements`, `sendChannelMessage`-Rückgabe, `/unregister` über `unregisterUserFromEvent` |
| `dev/mockBot.js` | Mock `refreshEventAnnouncements`, Fake-IDs |
| `routes/events.js` | `register` (Slot-Felder), `register/slot` (neu), `participants`, `my-registration`, `slotSummary`, Abmeldung über Service |
| `routes/admin.js` | Whitelists, Validierung, Duplizieren, Ankündigen, Statuswechsel, `registrations/:id/slot` (neu), Export, Auslöser |
| `routes/user.js` | Account-Löschung: Nachrücken + Auslöser je Event |
| `public/js/app.js`, `public/index.html`, `public/css/style.css` | UI aus Teil 5 |
| `dev/seedData.js` | Raid-Event mit Slots |
| `test/*` | siehe Teil 7 |
| `docs/wiki/*`, `updates.json` | siehe Teil 8 |

---

## Nicht im Scope

- Gäste bei Slot-Events
- Drag & Drop in der Aufstellung
- Automatisches Zurücksetzen von der Ausweich- in die Hauptrolle
- Discord-Rollen-Voraussetzungen pro Slot (z. B. nur „Raidleiter“ darf Slot X)
- Custom-Discord-Emojis als Slot-Emoji
- Global gespeicherte Slot-Vorlagen (nur die eingebaute Vorlage „MMO-Raid“)
- Ankündigungen gelöschter Events bearbeiten (hängt an known-issue #4)
- Terminabstimmung (eigene Spec, Teil 2 des Updates)
