# Dev-Mock-Modus — Design Spec
**Datum:** 2026-09-29

## Überblick

Der Dev-Mock-Modus startet DEMS lokal oder per Docker **ohne Discord-Token, ohne OAuth und ohne Firebase**. Die App läuft auf einer eigenen SQLite-Datenbank mit Dummy-Daten, der Login erfolgt über eine Persona-Auswahl und alle Discord-Aufrufe gehen an einen simulierten Server.

**Ziel:** UI und Features lokal durchklicken und entwickeln — aus Admin- und Nutzersicht — ohne echte Zugangsdaten.

**Erfolgskriterien**
- `npm run dev:mock` startet die App auf `http://localhost:3000`, ohne dass eine `.env` existieren muss.
- Ein Klick auf „Mit Discord anmelden“ führt zur Persona-Auswahl; jede Persona landet eingeloggt in der App.
- Events, Anmeldungen, Kommentare, Audit-Log und Bot-Zentrale zeigen realistische Daten.
- Rollen-Picker, Channel-Auswahl und Discord-Event-Import liefern Daten.
- Es geht kein Request an die Discord-API oder an Firebase.
- Der Modus kann in Produktion nicht aktiviert werden.

---

## Teil 1 — Aktivierung & Sicherheit (`dev/mockMode.js`)

Einziger Schalter ist `DEV_MOCK=true`. Das Modul wird von `server.js` direkt nach `dotenv` und von `dev/start.js` geladen und ist idempotent.

Beim Laden mit `DEV_MOCK=true`:

1. **Produktionssperre:** Ist `NODE_ENV=production`, gibt das Modul einen Fehler aus und beendet den Prozess mit Exit-Code 1. Das Produktions-Image setzt immer `NODE_ENV=production` — der Fake-Login kann dort nie aktiv werden.
2. **`.env` laden** (`dotenv`, `quiet: true`), damit Werte wie `PORT`, `TIMEZONE`, `DEBUG_MODE`, `SERVER_NAME` weiter aus der `.env` kommen.
3. **Erzwungene Werte** (überschreiben die `.env`):

| Variable | Wert im Mock-Modus |
|---|---|
| `SQLITE_PATH` | `DEV_SQLITE_PATH` falls gesetzt, sonst `<projekt>/data/dems.dev.sqlite` |
| `FIREBASE_*` (alle 6) | leer → SQLite wird genutzt |
| `DISCORD_BOT_TOKEN` | leer → echter Bot loggt sich nie ein |
| `DISCORD_GUILD_ID` | ID des Mock-Servers |
| `DISCORD_ADMIN_ROLE_ID` | ID der Mock-Rolle „Admin“ |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | ID des Mock-Channels `#ankündigungen` |
| `DISCORD_EVENT_CATEGORY_ID` | leer |
| `BASE_URL` | `http://localhost:<PORT>` |

4. **Defaults** (nur wenn nicht gesetzt): `SESSION_SECRET=dems-dev-mock-secret`, `ADMIN_RESET_PASSWORD=dev` (damit Panic-Mode und System-Reset im Dev testbar sind).
5. Eine deutlich sichtbare Startmeldung: `🧪 DEV-MOCK-MODUS aktiv — kein Discord, kein Firebase, DB: <pfad>`.

Export: `{ IS_MOCK_MODE, MOCK_GUILD }`, wobei `MOCK_GUILD` die Konstanten aus `dev/mockGuild.js` sind.

---

## Teil 2 — Einstieg & Skripte

| Skript | Befehl | Zweck |
|---|---|---|
| `dev:mock` | `nodemon dev/start.js` | Dev-Modus mit Auto-Reload |
| `dev:reset` | `node dev/reset.js` | Dev-DB leeren und neu seeden |
| `test` | `node --test "test/**/*.test.js"` | Tests |

**`dev/start.js`:** setzt `DEV_MOCK=true`, lädt `dev/mockMode`, führt `seedIfEmpty()` aus und lädt danach `server.js`.

**`dev/reset.js`:** setzt `DEV_MOCK=true`, lädt `dev/mockMode`, führt `resetAndSeed()` aus. Funktioniert auch, während der Server läuft (SQLite im WAL-Modus, Löschen über die Adapter-API statt Datei löschen).

`package.json` bekommt eine `nodemonConfig`, die `data/`, `public/`, `docs/`, `landing/` und `test/` ignoriert — Frontend-Dateien werden ohnehin pro Request von der Platte gelesen, ein Neustart ist dafür unnötig.

---

## Teil 3 — Fake-Login (`dev/devAuth.js`)

Express-Router, der in `server.js` **nur im Mock-Modus** vor dem echten Auth-Router unter `/auth` eingehängt wird.

| Route | Verhalten |
|---|---|
| `GET /auth/discord` | Redirect auf `/auth/dev-login` (fängt die bestehenden Login-Buttons ab, das Frontend bleibt unverändert) |
| `GET /auth/dev-login` | Server-gerenderte HTML-Seite mit den Personas als Links |
| `GET /auth/dev-login/:personaId` | Loggt die Persona ein, Redirect auf `/#events` |

Der Login verhält sich wie der echte OAuth-Callback (`routes/auth.js`):
- `isAdmin` = Persona-Rollen enthalten `DISCORD_ADMIN_ROLE_ID`.
- Wartungsmodus wird geprüft: Panic-Mode oder „Login gesperrt“ blockiert Nicht-Admins mit denselben Redirects (`/?error=panic_mode`, `/?error=maintenance_login_disabled`).
- User-Dokument in `users` anlegen bzw. aktualisieren; `isNewUser` ist `true`, wenn es noch nicht existierte.
- Session: `{ id, username, displayName, avatar, roles, isAdmin, isNewUser }`.
- Unbekannte Persona-ID → 404.

**Personas**

| ID | Name | Rollen | Zweck |
|---|---|---|---|
| `admin` | Mori (Admin) | Admin, Mitglied | Admin-Bereich, Bot-Zentrale, Wartung |
| `raider` | Lena | Mitglied, Raid-Team | darf Rollen-Events beitreten |
| `member` | Tom | Mitglied | normaler Nutzer, scheitert an Rollen-Events |
| `newbie` | Neo (Neuling) | — | erster Login (`isNewUser`), nicht vorab in `users` geseedet |

Ohne Mock-Modus existieren die Routen nicht: `/auth/discord` leitet wie bisher zu Discord weiter.

---

## Teil 4 — Fake-Discord-Server (`dev/mockGuild.js`, `dev/mockBot.js`)

**`dev/mockGuild.js`** — statische Daten, feste Snowflake-artige IDs:
- Server: „DEMS Dev Server“
- Rollen: Admin, Moderator, Mitglied, Raid-Team, VIP, „DEMS Bot“ (`managed: true`)
- Channels: `#allgemein`, `#ankündigungen`, `#events` (Text), `Lobby`, `Event-Voice` (Voice), `Bühne` (Stage), `#forum` (Forum), `#mod-intern` (Text, **nicht öffentlich**)
- Scheduled Events: 2 Stück für den Import
- Personas (siehe Teil 3)

**`dev/mockBot.js`** — überschreibt in `bot.js` nur die Funktionen, die mit Discord sprechen. Einbindung am Ende von `bot.js`:

```js
if (IS_MOCK_MODE) Object.assign(module.exports, require('./dev/mockBot'));
```

Da alle Aufrufer die Exporte erst nach vollständigem Laden von `bot.js` destrukturieren, erhalten sie die Mock-Versionen. Reine Logik (`parseTemplate`, `buildEventEmbed`, `buildEventComponents`, `canRegisterViaDiscord`, `getBotSettings`, `saveBotSettings`, `getRunningEvents`, `startReminderScheduler`) bleibt echt.

| Gruppe | Funktionen | Mock-Verhalten |
|---|---|---|
| Lebenszyklus | `startBot` | loggt nur, liefert `true`. `stopBot` bleibt echt: es räumt die Scheduler-Intervalle auf, der Client ist nie eingeloggt |
| Lesen | `getGuildName`, `getGuildRoles`, `getGuildChannels`, `getPublicGuildChannels`, `getGuildScheduledEvents`, `getUserRoles`, `isGuildMember`, `getBotStatus` | Daten aus `mockGuild`, im Format der echten Funktionen; `getPublicGuildChannels` filtert `#mod-intern` heraus |
| Schreiben | `sendDM`, `sendChannelMessage`, `sendGuestInvitation`, `assignRole`, `removeRole`, `createEventChannels`, `addParticipantToEventChannels`, `removeParticipantFromEventChannels`, `deleteEventChannels`, `createScheduledEvent` | Konsolen-Log mit Präfix `[MOCK-DISCORD]` und Inhalt (Embeds als JSON), Rückgabewert wie im Erfolgsfall; `createEventChannels` speichert Fake-Channel-IDs am Event |

**Bewusste Einschränkung:** Der Reminder-Scheduler ruft innerhalb von `bot.js` das echte `sendDM` auf und meldet dort nur „Bot not ready“. Reminder-DMs werden im Mock-Modus nicht simuliert.

---

## Teil 5 — Dummy-Daten (`dev/seedData.js`, `dev/seed.js`)

**`dev/seedData.js`** baut den Datensatz als Funktion `buildSeedData(now)`. Alle Zeitangaben sind relativ zu `now`, damit Events nie veralten. Alle Dokumente haben feste IDs (z. B. `dev-event-open`) → Seeden ist idempotent, Links bleiben stabil.

| Collection | Inhalt |
|---|---|
| `events` | offenes Event mit Sofort-Annahme (in 3 Tagen) · Event mit manueller Freigabe und Formular mit 5 Feldern (Text, Dropdown, Checkbox, Rolle, Channel) · volles Event (max. 5) mit Warteliste · Rollen-Event (nur Raid-Team) · Event mit 7 Formularfeldern (nur über die Website) · laufendes Event mit Check-in (`checkinEnabled`, Code `DEMO42`) · vergangenes Event mit eingecheckten Teilnehmern · archiviertes Event · Entwurf · wöchentliche Serie mit 3 Terminen (`seriesId`) |
| `users` | 3 Personas (ohne Neuling) + 9 weitere Mitglieder |
| `registrations` | alle Status (`accepted`, `pending`, `waitlisted`, `rejected`), Quellen `web` und `discord`, mit Formularantworten, Gästen und offenen Gäste-Einladungen |
| `comments` | Kommentare mit Antworten (`replyTo`) und Admin-Kommentar |
| `auditLogs` | 10 Einträge der üblichen Aktionen (Event erstellt/aktualisiert, Status geändert, Anmeldung angenommen/abgelehnt, Export, Templates, Bot-Einstellungen, Wartung) |
| `botMessages/templates` | Vorlagen `registration`, `accepted`, `rejected` |
| `botSettings/config` | Standard-Einstellungen, Ankündigungs-Channel = Mock-Channel |
| `maintenanceSettings/config` | alles aus |
| `devMeta/seed` | Marker `{ seededAt }` |

**`dev/seed.js`**
- `seedIfEmpty()` — seedet nur, wenn `devMeta/seed` fehlt. Eigene Änderungen bleiben über Neustarts erhalten.
- `resetAndSeed()` — löscht alle Dokumente der Collections aus `SEED_COLLECTIONS` (die Tabelle oben) und seedet neu.
- Beide laufen über die Firestore-kompatible API aus `firebaseAdmin.js` (im Mock-Modus = SQLite).

---

## Teil 6 — Docker-Dev

**`Dockerfile`** — neue Stages, der Produktions-Stage `runtime` bleibt der letzte und damit der Standard-Build:

```
build-base  → node:24-bookworm-slim + python3/make/g++
deps        → build-base, npm ci --omit=dev          (für runtime)
dev         → build-base, npm ci (inkl. devDependencies), COPY . .,
              NODE_ENV=development, CMD nodemon --legacy-watch dev/start.js
runtime     → wie bisher
```

**`compose.dev.yaml`** (eigenständig, Start mit `docker compose -f compose.dev.yaml up --build`):
- `build.target: dev`, `init: true`
- `env_file: .env` mit `required: false` — eine `.env` ist optional
- `environment: NODE_ENV=development, PORT=3000`
- Port `${DEMS_DEV_PORT:-3000}:3000`
- Volumes: `.:/app` (Code-Mount), anonymes Volume `/app/node_modules` (Linux-Build von better-sqlite3 bleibt im Container), `dems-dev-data:/app/data`
- `--legacy-watch` (Polling), weil Dateiänderungen von Windows-Bind-Mounts kein inotify-Event im Container auslösen

Nach Abhängigkeits-Änderungen: `docker compose -f compose.dev.yaml up --build -V` (erneuert das `node_modules`-Volume).
Reset im Container: `docker compose -f compose.dev.yaml exec dems-dev npm run dev:reset`.

---

## Teil 7 — Bugfix im SQLite-Adapter

`doc()` in `db/sqliteAdapter.js` akzeptiert nur `doc(db, name, id)`. `routes/admin.js` ruft beim Starten und Beenden eines Events `doc(collectionRef, id)` auf, was Firestore unterstützt. Der Adapter behandelt die Event-ID dann als Collection-Namen → „Event starten/beenden“ liefert im SQLite-Modus immer 404.

Fix: `doc()` erkennt eine Collection-Referenz als erstes Argument (`__type === 'collection'`) und nimmt deren Namen, das zweite Argument ist dann die ID.

---

## Teil 8 — Tests

Neue Test-Infrastruktur mit dem eingebauten `node:test` (keine neue Abhängigkeit). Server-Tests starten `server.js` bzw. `dev/start.js` als Kindprozess mit temporärer SQLite-Datei (`DEV_SQLITE_PATH` / `SQLITE_PATH` im Temp-Verzeichnis).

| Test | Prüft |
|---|---|
| Produktionssperre | `DEV_MOCK=true` + `NODE_ENV=production` → Exit-Code 1 |
| Kein Dev-Login ohne Mock | `/auth/discord` leitet zu discord.com weiter; `/auth/dev-login/admin` setzt keine Session |
| Persona-Login | Admin → `GET /api/admin/stats` 200; Mitglied → 403; Neuling → `isNewUser: true` beim ersten `/auth/me` |
| Wartungsmodus | bei `loginDisabled` wird Mitglied abgewiesen, Admin nicht |
| Seed | `seedIfEmpty()` zweimal → gleiche Dokumentzahl; Events der Tabelle vorhanden |
| Reset | eigenes Dokument anlegen → `resetAndSeed()` → weg, Seed-Daten wieder da |
| Mock-Bot | Rollen/Channels/Scheduled Events geliefert; `#mod-intern` nicht in `getPublicGuildChannels`; `sendDM` liefert `true` |
| Adapter-Bugfix | `doc(collection(db, 'events'), id)` liest/schreibt das richtige Dokument |

---

## Datei-Änderungen

| Datei | Änderung |
|---|---|
| `dev/mockMode.js` | neu — Schalter, Produktionssperre, erzwungene Werte |
| `dev/mockGuild.js` | neu — Mock-Server, Rollen, Channels, Scheduled Events, Personas |
| `dev/mockBot.js` | neu — Mock-Versionen der Discord-Funktionen |
| `dev/devAuth.js` | neu — Persona-Auswahl und Login |
| `dev/seedData.js` | neu — Dummy-Datensatz |
| `dev/seed.js` | neu — `seedIfEmpty`, `resetAndSeed` |
| `dev/start.js`, `dev/reset.js` | neu — Einstiegspunkte |
| `test/*.test.js` | neu — Tests |
| `compose.dev.yaml` | neu |
| `server.js` | `mockMode` laden, `devAuth` im Mock-Modus einhängen |
| `bot.js` | Mock-Override am Dateiende |
| `db/sqliteAdapter.js` | `doc()` mit Collection-Referenz |
| `Dockerfile` | Stages `build-base` und `dev` |
| `package.json` | Skripte `dev:mock`, `dev:reset`, `test`; `nodemonConfig` |
| `README.md`, `.env.example` | Dev-Modus dokumentieren (`DEV_MOCK`, `DEV_SQLITE_PATH`, `DEMS_DEV_PORT`) |

---

## Nicht im Scope

- Simulierte Reminder-DMs des Schedulers
- UI-Anzeige im Frontend, dass der Mock-Modus aktiv ist
- Simulierte Discord-Interaktionen (Buttons, Modals, Slash-Commands)
- Mock-Modus mit Firebase statt SQLite
