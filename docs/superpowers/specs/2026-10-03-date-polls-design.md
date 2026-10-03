# Terminabstimmung — Design Spec
**Datum:** 2026-10-03

## Überblick

Admins schlagen für ein geplantes Event mehrere Termine vor. Mitglieder stimmen pro Termin mit **✅ passt** oder **🤔 wenn nötig** ab — auf der Website oder direkt in Discord. Die Discord-Nachricht zeigt den Zwischenstand live. Nach Ende der Abstimmung wählt der Admin den Termin, erstellt daraus mit dem bestehenden Event-Wizard ein Event, und alle Abstimmenden bekommen eine DM mit Anmelde-Link.

**Ziel:** Communities finden Termine in DEMS statt über externe Doodle-Links oder Discord-Umfragen, die niemand auswertet — und am Ende steht direkt ein fertiges Event.

**Erfolgskriterien**
- Ein Admin legt eine Abstimmung mit 2–10 Terminen an, optional mit Deadline und Rollen-Beschränkung, und postet sie in Discord.
- Mitglieder stimmen im Web (Umschalter pro Termin) und in Discord (Button → zwei vorausgefüllte Mehrfachauswahlen) ab; beide Wege landen in denselben Daten, erneutes Abstimmen überschreibt.
- Die Discord-Nachricht zeigt pro Termin ✅/🤔-Anzahl und Namen und ist spätestens ~2 s nach einer Stimme aktuell.
- Nach der Deadline werden keine Stimmen mehr angenommen; die Abstimmung wird automatisch geschlossen und der Ersteller per DM informiert.
- „Event erstellen“ öffnet den Event-Wizard vorausgefüllt; nach dem Speichern ist die Abstimmung entschieden, alle Abstimmenden haben eine DM mit Link, die Discord-Nachricht zeigt das Ergebnis.

**Teilprojekt:** Teil 2 des Feature-Updates (nach den Rollen-Slots, Spec `2026-10-02-role-slots-design.md`). Branch `feature/date-polls` zweigt von `feature/role-slots` ab.

---

## Teil 1 — Datenmodell

### `polls` (Auto-ID)

| Feld | Typ | Bedeutung |
|---|---|---|
| `title` | string, 1–200 | |
| `description` | string, ≤ 5000, Markdown | |
| `options` | `[{ id, startDate, endDate }]` | 2–10 Termine; `id` 8 Hex-Zeichen, stabil; `endDate` ISO oder `''` |
| `deadline` | ISO oder `''` | leer = keine automatische Schließung |
| `status` | `open` \| `closed` \| `decided` | |
| `accessMode` | `open` \| `role-required` | wie bei Events |
| `requiredRoles` | role id[] | nur bei `role-required` |
| `winnerOptionId`, `eventId` | string oder `''` | gesetzt bei `decided` |
| `announcements` | `[{ channelId, messageId }]` | max. 5, neueste zuletzt |
| `createdBy`, `createdAt`, `updatedAt`, `closedAt` | | `closedAt` beim Schließen |

### `pollVotes` (ID = `<pollId>_<userId>`)

`{ pollId, userId, userName, yes: optionId[], maybe: optionId[], updatedAt }` — genau eine Stimme pro Person und Abstimmung; erneutes Abstimmen überschreibt (`setDoc`). Eine Stimme ohne `yes` und `maybe` wird gelöscht (die Person zählt dann nicht als abstimmend).

### Validierung — `normalizePollInput(raw, existingPoll, votes)`

- `title` getrimmt 1–200 Zeichen, `description` ≤ 5000.
- `options`: 2–10 Einträge; `startDate` gültiges Datum; beim Anlegen und für neue Termine in der Zukunft; `endDate` leer oder nach `startDate`; keine zwei Termine mit gleichem `startDate`. IDs nur übernommen, wenn sie zur Abstimmung gehören, sonst neu erzeugt.
- Beim Bearbeiten: ein Termin, der Stimmen hat (`yes` oder `maybe`), darf nicht entfernt werden → „Der Termin am Sa, 11.10. · 20:00 hat bereits Stimmen.“ Bestehende Termine dürfen nicht verschoben werden (gleiche ID, anderes `startDate` → Fehler „Termine mit Stimmen können nicht verschoben werden.“, sofern Stimmen existieren).
- `deadline` leer oder gültiges Datum; beim Anlegen in der Zukunft.
- `accessMode`/`requiredRoles` wie bei Events.
- Bearbeiten nur im Status `open`.
- Fehler → `{ error }` mit deutscher Meldung.

---

## Teil 2 — Regeln (`utils/pollService.js`, reine Funktionen)

| Funktion | Verhalten |
|---|---|
| `normalizePollInput(raw, existingPoll = null, votes = [])` | siehe oben → `{ poll }` oder `{ error }` |
| `normalizeVote(options, raw)` | unbekannte IDs raus, Duplikate raus; Termin in `yes` und `maybe` → nur `yes`; Reihenfolge = Terminreihenfolge → `{ yes, maybe }` |
| `isPollOpen(poll, now = new Date())` | `status === 'open'` und (keine Deadline oder `now < deadline`) |
| `tallyPoll(poll, votes, usersById = {})` | pro Termin `{ optionId, startDate, endDate, yes, maybe, yesVoters: [{ displayName, avatar }], maybeVoters: [...] }`, plus `voterCount` |
| `rankOptions(tally)` | absteigend nach `yes`, dann `maybe`, dann früherer Termin; `favoriteOptionId` = erster Eintrag, `null` wenn niemand abgestimmt hat |
| `canVote(poll, userRoles)` | Rollen-Prüfung wie bei Events |
| `formatPollOption(option)` | „Sa, 11.10. · 20:00“ (+ „–22:00“ bei `endDate` am selben Tag), Zeitzone `TIMEZONE` |

---

## Teil 3 — Datenbank-Abläufe (`utils/pollStore.js`)

Alle schreibenden Abläufe pro Abstimmung laufen unter `withEventLock('poll:' + pollId, …)` (bestehende Sperre aus `utils/eventLock.js`, Schlüssel mit Präfix).

| Funktion | Verhalten |
|---|---|
| `loadPoll(pollId)` | `{ id, ...data }` oder `null` |
| `loadPollVotes(pollId)` | alle Stimmen |
| `savePollVote({ pollId, user, yes, maybe })` | unter Sperre: Abstimmung laden → nicht offen → `poll_closed` (400 „Die Abstimmung ist beendet.“); Rolle fehlt → `missing_role` (403 „Du hast nicht die erforderliche Rolle für diese Abstimmung.“); `normalizeVote`; leer → Stimme löschen, sonst `setDoc`. Danach `notifyPollChanged(pollId)`. Rückgabe `{ ok, vote }` |
| `closePoll(pollId, { byDeadline })` | unter Sperre: nur `open` → `closed`, `closedAt`; bei `byDeadline` DM an `createdBy` mit Favorit und Link; `notifyPollChanged` |
| `decidePoll({ pollId, optionId, eventId })` | unter Sperre: Abstimmung existiert, Termin existiert, Status ≠ `decided` → `decided`, `winnerOptionId`, `eventId`, `closedAt` (falls leer); danach (außerhalb der Sperre) DM an jede Person mit Stimme; `notifyPollChanged` |
| `closeExpiredPolls(now)` | alle `open`-Abstimmungen mit abgelaufener Deadline → `closePoll(id, { byDeadline: true })` |
| `deletePoll(pollId)` | Stimmen + Abstimmung löschen (Batch); vorher Discord-Nachrichten auf „🗑️ Abstimmung gelöscht“ setzen (`markPollMessagesDeleted`) |
| `deleteUserPollVotes(userId)` | für Account-Löschung: alle Stimmen der Person löschen, betroffene Abstimmungen `notifyPollChanged` |
| `startPollScheduler()` / `stopPollScheduler()` | eigenes Intervall (5 min, `unref`), unabhängig von der Bot-Einstellung `reminderEnabled`; ruft `closeExpiredPolls` |

**Vorab-Prüfung für die Umwandlung:** `validateDecision({ pollId, optionId })` → `{ ok, poll, option }` oder Fehler (404 „Abstimmung nicht gefunden“, 400 „Termin nicht gefunden“, 400 „Diese Abstimmung ist bereits entschieden.“). Wird in `POST /api/admin/events` **vor** dem Anlegen aufgerufen.

**DM-Texte**
- Entscheidung, je nach eigener Stimme für den gewählten Termin:
  - ✅: „📅 Der Termin für **<Titel>** steht: **<Termin>**. Du hattest ✅ *passt* angegeben – jetzt anmelden: <Event-Link>“
  - 🤔: „… Du hattest 🤔 *wenn nötig* angegeben – jetzt anmelden: <Link>“
  - keine: „… Er passt dir leider nicht – vielleicht klappt es trotzdem? <Link>“
- Deadline-Ende an Ersteller: „🗳️ Die Abstimmung **<Titel>** ist beendet. Favorit: **<Termin>** (✅ n · 🤔 m). Jetzt Event erstellen: <Abstimmungs-Link>“; ohne Stimmen: „… ist beendet – leider hat niemand abgestimmt.“

**Links:** `buildPollUrl(pollId)` in `utils/eventUrl.js` → `<BASE_URL>/#poll/<id>`.

---

## Teil 4 — Discord (`bot.js` + `dev/mockBot.js`)

### Nachricht

- `buildPollEmbed(poll, tally)`:
  - offen: Titel „📅 <Titel>“, Beschreibung (gekürzt auf 1000 Zeichen), pro Termin ein Feld (Name: `formatPollOption`, mit „🏆 “ vor dem Favoriten; Wert: „✅ n · 🤔 m“ + Zeile mit bis zu 5 ✅-Namen (`escapeMarkdown`), dann „+N“; ohne Stimmen „— noch keine Stimmen —“), Footer „⏰ Abstimmung bis <Deadline> · <n> Stimmen“ bzw. „Abstimmung offen · <n> Stimmen“.
  - `closed`: Titel „🔒 Abstimmung beendet: <Titel>“, Felder wie oben.
  - `decided`: Titel „✅ Termin steht: <Titel>“, Beschreibung „**<gewählter Termin>**“, Felder wie oben, Gewinner mit „✅ “ statt „🏆 “.
- `buildPollComponents(poll)`: offen → `[🗳️ Abstimmen]` (`poll_vote:<pollId>`, Primary) + `[🔗 Im Web ansehen]` (Link `buildPollUrl`); `closed` → nur Link; `decided` → `[🔗 Zum Event]` (Link `buildEventUrl(eventId)`).
- `POST /api/admin/polls/:id/announce` → `sendChannelMessage(DISCORD_ANNOUNCE_CHANNEL_ID, embed, { text, roleIds, pingEveryone, components })`, speichert `{ channelId, messageId }` (max. 5).

### Abstimmen

- `poll_vote:<pollId>` → `deferReply` (ephemeral) → Abstimmung offen? Wartung (`isRegistrationBlocked`)? Rolle (`resolveInteractionRoles`)? → bei Fehler `editReply` mit Meldung; sonst `editReply(buildPollVoteReply(poll, vote))`.
- `buildPollVoteReply(poll, vote, statusLine?)`: Inhalt „Wähle deine Termine – Änderungen werden sofort gespeichert.“ (+ Statuszeile), zwei Zeilen mit je einem `StringSelectMenu`:
  - `poll_yes:<pollId>`: Platzhalter „✅ Passt mir …“, min 0, max = Anzahl Termine, Optionen = Termine (`formatPollOption`), `default` = in `vote.yes`.
  - `poll_maybe:<pollId>`: Platzhalter „🤔 Wenn nötig …“, analog mit `vote.maybe`.
- Auswahl geändert (`poll_yes` / `poll_maybe`) → `deferUpdate` → bisherige Stimme laden, die geänderte Liste ersetzen (die andere bleibt) → `savePollVote` → `editReply(buildPollVoteReply(poll, savedVote, 'Gespeichert: 2× passt, 1× wenn nötig.'))`; bei Fehler `editReply` mit Meldung ohne Komponenten.
- Dispatcher: neuer Zweig für String-Selects (`interaction.isStringSelectMenu()`), Buttons `poll_vote:*` im Button-Zweig; Fehler → `replyWithFailure` (Text „❌ Fehler bei der Abstimmung.“ — Funktion bekommt einen optionalen Text).

### Live-Aktualisierung

- `utils/announcementRefresh.js`: zweite Instanz `notifyPollChanged(pollId)` / `flushPollRefreshes()` mit `refresh = bot.refreshPollMessages`.
- `refreshPollMessages(pollId)` (exportiert, `isReady`-Guard, Mock-Zwilling): Abstimmung + Stimmen laden, Embed + Komponenten neu bauen, jede gespeicherte Nachricht bearbeiten; `isGoneDiscordError` → Eintrag entfernen.
- `markPollMessagesDeleted(poll)` (exportiert, Mock-Zwilling): Nachrichten auf ein Embed „🗑️ Abstimmung gelöscht“ ohne Buttons setzen.

---

## Teil 5 — API

### `/api/polls` (neuer Router `routes/polls.js`, alle `requireAuth`)

| Methode & Pfad | Verhalten |
|---|---|
| `GET /api/polls` | alle Abstimmungen, sortiert: `open` (nach Deadline, ohne Deadline zuletzt), dann `closed`/`decided` (neueste zuerst); je Eintrag `{ id, title, status, deadline, optionCount, voterCount, favorite: { optionId, startDate, yes, maybe } \| null, myVoteStatus: 'voted' \| 'open', canVote, eventId }` |
| `GET /api/polls/:id` | Abstimmung ohne `announcements`, mit `tally` (inkl. Namen/Avatare), `favoriteOptionId`, `myVote` (`{ yes, maybe }` oder leer), `canVote`, `isOpen` |
| `PUT /api/polls/:id/vote` | `checkRegistrationAllowed`; Body `{ yes, maybe }` → `savePollVote` → Antwort wie `GET /api/polls/:id` |

### `/api/admin/polls` (in `routes/admin.js`)

| Methode & Pfad | Verhalten | Audit |
|---|---|---|
| `POST /api/admin/polls` | `normalizePollInput` → anlegen (`status: 'open'`) | `CREATE_POLL` |
| `PUT /api/admin/polls/:id` | nur `open`; `normalizePollInput(raw, existing, votes)` → speichern; danach `notifyPollChanged` | `UPDATE_POLL` |
| `POST /api/admin/polls/:id/close` | `closePoll` | `CLOSE_POLL` |
| `POST /api/admin/polls/:id/announce` | posten, Nachricht speichern | `ANNOUNCE_POLL` |
| `DELETE /api/admin/polls/:id` | `deletePoll` | `DELETE_POLL` |
| `POST /api/admin/events` (bestehend) | optionaler Body `fromPoll: { pollId, optionId }` → `validateDecision` vor dem Anlegen; nach dem Anlegen `decidePoll({ pollId, optionId, eventId })` (bei einer Serie: erste Instanz); Event bekommt `sourcePollId` | zusätzlich `DECIDE_POLL` |

Weitere Anpassungen:
- `DELETE /api/user/account` → `deleteUserPollVotes(userId)`.
- `DELETE /api/admin/reset` → neues Ziel `polls` (leert `polls` und `pollVotes`), Checkbox „Abstimmungen“ im Reset-Dialog.
- `server.js` → `startPollScheduler()` nach `startReminderScheduler()`; `gracefulShutdown` → `stopPollScheduler()`.
- `sourcePollId` in beiden Whitelists (`POST`/`PUT /events`), nur informativ.

Alle Routen: eigenes `try/catch`, deutsche `{ error }`-Meldungen; mutierende Routen über das bestehende CSRF-Middleware.

---

## Teil 6 — Weboberfläche

### Navigation & Router

- Menüpunkt „Abstimmungen“ (`#polls`) nach „Events“, nur eingeloggt; Zähler-Badge = Anzahl offener Abstimmungen mit `canVote && myVoteStatus === 'open'` (beim Login und nach jeder eigenen Stimme neu geladen).
- Router: `#polls` → `showPollsSection()`, `#poll/<id>` → `showPollDetail(id)`; `rememberPendingRoute` merkt sich auch `poll/<id>` (Discord-Link vor dem Login).

### Übersicht `#polls`

Karten für offene Abstimmungen (Titel, „n Termine“, Countdown bis Deadline bzw. „ohne Deadline“, Favorit mit ✅/🤔, Badge „✓ Abgestimmt“ / „Noch nicht abgestimmt“ / „Nur für Rolle …“). Darunter einklappbar „Abgeschlossen“ (Status-Badge, bei `decided` Link „Zum Event“). Leerer Zustand: „Gerade läuft keine Abstimmung.“

### Detailseite `#poll/<id>`

- Kopf: Titel, Beschreibung (`renderMarkdownSafe`), Deadline-Countdown, Banner bei `closed` („🔒 Abstimmung beendet“) bzw. `decided` („✅ Termin steht: <Termin>“ + Button „Zum Event“).
- Pro Termin eine Zeile: Datum/Uhrzeit, gestapelter Balken (✅ voll, 🤔 hell) relativ zur Anzahl Abstimmender, Zahlen, Avatar-Stapel (aufklappbar mit Namen getrennt nach ✅/🤔), 🏆 beim Favoriten.
- Eigene Stimme: Segment-Umschalter `[✅ passt] [🤔 wenn nötig] [— passt nicht]` pro Zeile; jeder Klick → `PUT /api/polls/:id/vote` mit der kompletten eigenen Stimme → Antwort rendert die Seite neu; Fehler → Toast. Ohne Recht/geschlossen: Umschalter ausgeblendet, Hinweis.
- Admin-Leiste (nur Admins): „In Discord posten“, „Bearbeiten“ (nur offen), „Abstimmung beenden“ (nur offen), „Event erstellen“ (nicht bei `decided`), „Löschen“.

### Admin

- Admin-Bereich: Karte „Abstimmungen“ mit „Neue Abstimmung“ und Link zur Übersicht.
- Dialog „Abstimmung anlegen/bearbeiten“: Titel, Beschreibung, Terminliste (Zeilen mit Flatpickr Start + optional Ende, Entfernen-Button, „+ Termin“ bis 10), Deadline (Flatpickr, optional), Zugang (offen / Rollen-Checkboxen wie im Wizard). Serverfehler als Toast.
- Dialog „In Discord posten“: optionaler Text, Rollen-Pings, `@everyone`-Schalter.
- „Event erstellen“: Auswahl-Dialog mit allen Terminen (Radio, Favorit vorausgewählt, ✅/🤔 daneben) → `showCreateEventModal()` mit Vorbelegung (Titel, Beschreibung, Start/Ende aus dem Termin) und gemerktem `fromPoll`; `saveEvent` schickt `fromPoll` mit; nach Erfolg Navigation zur Abstimmung.
- Löschen und Beenden mit Bestätigungsdialog (Bootstrap-Modal, kein `confirm()`).

Alle Werte mit `escapeHtml`, alle Texte deutsch, neue Funktionen global; CSS-Abschnitt „DATE POLLS“.

---

## Teil 7 — Dev-Mock-Modus

- `dev/seedData.js`: offene Abstimmung „Termin für den Herbst-Raid“ (3 Termine in 7–12 Tagen, Deadline in 3 Tagen, Rolle Raid-Team, Stimmen von Ben, Kira und Felix; Lena (Raider-Persona) hat noch nicht abgestimmt und kann es selbst ausprobieren) und eine entschiedene Abstimmung „Sommerfest-Termin“, verknüpft mit dem Event „Sommerfest“. Konstanten `POLL_ID`.
- `dev/mockBot.js`: Mocks für `refreshPollMessages` und `markPollMessagesDeleted`.

---

## Teil 8 — Tests (TDD)

| Datei | Inhalt |
|---|---|
| `test/pollService.test.js` (neu) | `normalizePollInput` (Grenzen, Datum, Duplikate, Termine mit Stimmen nicht entfernbar/verschiebbar, nur `open` bearbeitbar), `normalizeVote`, `isPollOpen` (Deadline), `tallyPoll`, `rankOptions` (Gleichstand, keine Stimmen), `canVote`, `formatPollOption` |
| `test/pollStore.test.js` (neu, Mock-Modus) | Stimme speichern/überschreiben/leere Stimme löscht; Stimme nach Deadline/Schließen abgelehnt; Stimme während `closePoll` (Sperre) abgelehnt; `decidePoll` setzt Felder und schickt DMs je Stimmart; `closeExpiredPolls` schließt nur abgelaufene; `deletePoll` löscht Stimmen; `deleteUserPollVotes` |
| `test/pollComponents.test.js` (neu, Mock-Modus) | Embed offen/beendet/entschieden (Favorit 🏆, Namen +N, Escape), Buttons je Status, `buildPollVoteReply` (Defaults, max-Werte, Custom-IDs) |
| `test/pollInteractions.test.js` (neu, Mock-Modus) | `poll_vote` → `deferReply` + Auswahl-Antwort; `poll_yes`-Auswahl → `deferUpdate` + gespeichert + neu aufgebaut; geschlossene Abstimmung → Meldung |
| `test/devServer.test.js` | anlegen (Admin), im Web abstimmen (Raider), Rollen-Sperre (Member ohne Raid-Team → 403), Deadline vorbei → 400, Termin mit Stimmen entfernen → 400, `POST /events` mit `fromPoll` → Abstimmung `decided` + Mock-DMs im Log, doppelte Entscheidung → 400, löschen |
| `test/seed.test.js` | Seed enthält offene und entschiedene Abstimmung; Zählungen angepasst |

---

## Teil 9 — Wiki & Release

- Neue Knoten `docs/wiki/concepts/date-polls.md` und `docs/wiki/modules/routes-polls.md`.
- Aktualisieren: `data-model`, `api-index`, `routes-admin`, `routes-user`, `server`, `bot`, `discord-integration`, `frontend-app`, `frontend-markup`, `dev-mock-mode`, `utils`, `index.md`; `npm run wiki`.
- `updates.json` → **2.7.0** mit „🗳️ Terminabstimmungen“ (Abstimmen im Web und in Discord, Live-Zwischenstand) und „📅 Vom Termin zum Event“ (Event mit einem Klick, DM mit Anmelde-Link).
- Branch `feature/date-polls` (von `feature/role-slots`), PR auf Deutsch gegen `main`, sobald #35 gemergt ist.

---

## Datei-Änderungen

| Datei | Änderung |
|---|---|
| `utils/pollService.js` | **neu** — reine Regeln |
| `utils/pollStore.js` | **neu** — Datenbank-Abläufe, Scheduler |
| `utils/eventUrl.js` | `buildPollUrl` |
| `utils/announcementRefresh.js` | `notifyPollChanged`, `flushPollRefreshes` |
| `routes/polls.js` | **neu** — Mitglieder-API |
| `routes/admin.js` | Admin-API für Abstimmungen, `fromPoll` in `POST /events`, `sourcePollId`, Reset-Ziel |
| `routes/user.js` | Account-Löschung löscht Stimmen |
| `server.js` | Router mounten, Scheduler starten/stoppen |
| `bot.js` | Embed, Komponenten, Abstimm-Antwort, Dispatcher, `refreshPollMessages`, `markPollMessagesDeleted`, `replyWithFailure(text)` |
| `dev/mockBot.js`, `dev/seedData.js` | Mocks, Seed |
| `public/index.html`, `public/js/app.js`, `public/css/style.css` | Navigation, Übersicht, Detailseite, Admin-Dialoge, Wizard-Vorbelegung |
| `test/*` | siehe Teil 8 |
| `docs/wiki/*`, `updates.json`, `package.json` | siehe Teil 9 |

---

## Nicht im Scope

- Terminvorschläge durch Mitglieder
- Anonyme Abstimmungen
- Wiederkehrende Abstimmungen / Abstimmungsvorlagen
- Slash-Befehl `/umfrage`
- Erinnerungs-DMs an Nicht-Abstimmende
- Native Discord-Umfragen (Discord Polls API)
- Wiedereröffnen geschlossener oder entschiedener Abstimmungen
- Automatische Anmeldung der Abstimmenden
