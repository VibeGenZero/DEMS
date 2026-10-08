# DEMS – Dein Event-Management-System

Ein professionelles und benutzerfreundliches System zur Planung und Verwaltung von Community-Events mit nahtloser Discord-Integration.

Dieses Projekt wurde entwickelt, um Communities die Organisation von Veranstaltungen zu erleichtern – von der Erstellung über die Anmeldung bis hin zur automatisierten Kommunikation via Discord-Bot.

> DEMS ist ein unabhängiges Projekt und steht in keiner Verbindung zu Discord Inc. „Discord“ ist eine Marke von Discord Inc.

## 🚀 Funktionen

*   **Discord Integration**: Einfacher Login via Discord OAuth2 und automatische Synchronisation.
*   **Event-Management**: Administratoren können Events erstellen, bearbeiten und verwalten.
*   **Anmeldesystem**: Benutzer können sich mit wenigen Klicks für Events an- und abmelden.
*   **Benutzerprofile**: Persönliche Übersicht über teilgenommene Events und Statistiken.
*   **Automatisierung**: Der integrierte Discord-Bot sendet Benachrichtigungen und verwaltet Rollen.
*   **Modernes Design**: Ansprechende Benutzeroberfläche im Glassmorphism-Stil.

## 📣 Anmeldung direkt aus Discord

Jede Event-Ankündigung im Discord-Channel enthält zwei Buttons:

| Button | Verhalten |
| --- | --- |
| **Anmelden** | Prüft alle Bedingungen (Event aktiv, Wartungsmodus, keine Doppelanmeldung, Rollen-Requirement) und meldet direkt an. Freie Plätze entscheiden über sofortige Aufnahme, Bestätigungspflicht oder Warteliste. |
| **Zum Event** | Link zur Event-Seite im Web-Interface — immer vorhanden. |

**Events mit Formular:** Der Anmelden-Button öffnet ein Discord-Popup (Modal) mit den Formularfeldern des Events.
Jeder Feldtyp wird auf die passende Discord-Komponente abgebildet, die Eingaben werden übernommen und wie eine
Anmeldung über die Website gespeichert:

| Feldtyp | Web-Formular | Discord-Modal |
| --- | --- | --- |
| Text | Eingabefeld | Text Input (kurz) |
| Mehrzeiliger Text | Textarea | Text Input (Absatz) |
| Dropdown | Auswahlliste | String Select mit den konfigurierten Optionen |
| Checkbox | Checkbox | String Select mit Ja/Nein |
| Discord-Mitglied | Mitgliedersuche | User Select |
| Discord-Rolle | Rollenliste | Role Select |
| Discord-Channel | Channelliste | Channel Select |
| Mitglied oder Rolle | Kombinierte Suche | Mentionable Select |

Jedes Feld steht im Modal in einer Label-Komponente, sodass der Feldname und ein optionaler Hinweistext angezeigt
werden. Über dem Formular steht eine Text-Display-Komponente mit Titel, Termin und Teilnehmerzahl des Events.
Ausgewählte Mitglieder, Rollen und Channels werden als `@Name (ID)` bzw. `#Name (ID)` gespeichert — in Discord und
im Web identisch.

Discord erlaubt maximal fünf Felder pro Popup. Hat ein Event mehr Felder, entfällt der Anmelden-Button und
die Ankündigung verweist über den Link-Button auf die Website. Im Ankündigungs-Dialog der Admin-Oberfläche wird
vorab angezeigt, welche Buttons das Event bekommt.

Jede Anmeldung aus Discord erscheint sofort in der Web-Oberfläche. In der Anmeldungs-Übersicht und im CSV-Export
ist erkennbar, ob sie über Discord oder die Website erstellt wurde.

## 🛠️ Technologien

Das Projekt basiert auf einem modernen Tech-Stack:

*   **Backend**: Node.js, Express
*   **Datenbank**: Google Firebase (Firestore) – *optional*, mit automatischem SQLite-Fallback
*   **Bot-Integration**: Discord.js
*   **Frontend**: HTML5, CSS3, JavaScript (EJS Templating)

### 🗄️ Datenbank: Firebase oder SQLite

DEMS ist **nicht mehr zwingend von Firebase abhängig**. Beim Start entscheidet die App automatisch:

*   **Firebase Firestore** – wird genutzt, wenn alle `FIREBASE_*`-Werte in der `.env` gesetzt sind.
*   **Lokale SQLite-Datenbank** – wird automatisch als Fallback genutzt, wenn **keine** `FIREBASE_*`-Werte gesetzt sind. Es ist keine externe Datenbank nötig; die Daten liegen in einer Datei (Standard: `./data/dems.sqlite`, konfigurierbar über `SQLITE_PATH`).

> **Hinweis:** Auf Plattformen mit flüchtigem Dateisystem (z. B. Heroku, Railway ohne persistentes Volume) gehen SQLite-Daten bei einem Neustart verloren. Für dauerhafte Speicherung in der Cloud entweder Firebase verwenden oder ein persistentes Volume einbinden.

## 📦 Installation & Einrichtung

Folge diesen Schritten, um das Projekt lokal einzurichten:

### 1. Voraussetzungen
Stelle sicher, dass du folgende Tools installiert hast:
*   [Node.js](https://nodejs.org/) (Version 22 oder höher) – oder nur [Docker](https://docs.docker.com/get-docker/), siehe unten
*   Optional: ein Firebase-Projekt (sonst wird SQLite genutzt)
*   Eine Discord-Applikation im [Developer Portal](https://discord.com/developers/applications)

### 2. Installation
Klonen das Repository und installiere die Abhängigkeiten:

```bash
git clone https://github.com/DEIN-USERNAME/DEMS.git
cd DEMS
npm install
```

### 3. Konfiguration
Erstelle eine `.env` Datei im Hauptverzeichnis und fülle sie mit deinen Daten:

```env
# Discord Konfiguration
DISCORD_CLIENT_ID=deine_client_id
DISCORD_CLIENT_SECRET=dein_client_secret
DISCORD_BOT_TOKEN=dein_bot_token
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback

# Firebase Konfiguration
FIREBASE_API_KEY=dein_api_key
FIREBASE_AUTH_DOMAIN=dein_project.firebaseapp.com
FIREBASE_PROJECT_ID=dein_project_id
...
```

### 4. Starten
Starte den Server im Entwicklungsmodus:

```bash
npm run dev
```

Der Server läuft nun unter `http://localhost:3000`.

## 🧪 Dev-Modus mit Dummy-Daten

Zum Entwickeln und Ausprobieren ohne Discord-Token, OAuth und Firebase:

```bash
npm install
npm run dev:mock
```

*   Öffne `http://localhost:3000` und klicke auf „Mit Discord anmelden“. Statt Discord erscheint eine Auswahl von Test-Personas: **Admin**, **Mitglied mit Rolle „Raid-Team“**, **Mitglied ohne Rollen** und ein **Neuling** (erster Login).
*   Die Daten liegen in `data/dems.dev.sqlite`, getrennt von der normalen Datenbank. Beim ersten Start wird sie mit Beispiel-Events (Formular, Warteliste, Rollen-Event, laufendes Event, Serie, Entwurf, Archiv), Anmeldungen, Kommentaren, Audit-Log und Einstellungen gefüllt. Eigene Änderungen bleiben über Neustarts erhalten.
*   `npm run dev:reset` setzt die Dev-Datenbank auf den Ausgangszustand zurück (geht auch bei laufendem Server).
*   Alle Termine sind relativ zum Zeitpunkt des ersten Seedens. Nach ein paar Tagen liegen die Beispiel-Events in der Vergangenheit und das „laufende“ Event (Check-in `DEMO42`) läuft nur ca. 2,5 Stunden lang — `npm run dev:reset` setzt alle Termine wieder relativ zu jetzt.
*   Discord ist simuliert: Rollen, Channels und Scheduled Events kommen von einem Fake-Server, DMs, Ankündigungen und Rollenvergaben erscheinen als `[MOCK-DISCORD]` in der Konsole.
*   Check-in-Code des laufenden Beispiel-Events: `DEMO42`. Admin-Reset-Passwort (Panic-Mode, System-Reset): `dev`, sofern in der `.env` nichts anderes steht.
*   Eine `.env` ist nicht nötig. Vorhandene Discord- und Firebase-Werte werden im Dev-Modus ignoriert.
*   Der Dev-Modus lässt sich nicht in Produktion aktivieren: mit `NODE_ENV=production` bricht der Start ab.

### Dev-Modus mit Docker

```bash
docker compose -f compose.dev.yaml up --build
```

*   Der Code wird in den Container gemountet, Änderungen starten den Server automatisch neu (Frontend-Dateien unter `public/` brauchen nur einen Browser-Reload).
*   Die Dev-Datenbank liegt im Volume `dems-dev-data`. Zurücksetzen: `docker compose -f compose.dev.yaml exec dems-dev npm run dev:reset`.
*   Nach Änderungen an den Abhängigkeiten: `docker compose -f compose.dev.yaml up --build -V` (erneuert `node_modules` im Container).
*   Anderer Host-Port: `DEMS_DEV_PORT` in der `.env`.

Tests: `npm test`

## 🐳 Docker

Voraussetzung ist nur Docker (inkl. Compose). Die Konfiguration kommt wie oben aus der `.env`.

```bash
cp .env.example .env   # ausfüllen, mindestens SESSION_SECRET
docker compose up -d --build
docker compose logs -f dems
```

*   Die App läuft unter `http://localhost:3000`. Einen anderen Host-Port setzt du über `DEMS_PORT` in der `.env`.
*   Die SQLite-Datenbank liegt im Volume `dems-data` (`/app/data` im Container) und überlebt Rebuilds und Updates.
*   Der Container hat einen Healthcheck auf `GET /healthz` (`docker compose ps` zeigt den Status).
*   Stoppen mit `docker compose down` – die Daten bleiben erhalten. `docker compose down -v` löscht auch das Volume.
*   Update: `git pull && docker compose up -d --build`.

Ohne Compose:

```bash
docker build -t dems .
docker run -d --init --env-file .env -e PORT=3000 -e SQLITE_PATH=/app/data/dems.sqlite \
  -p 3000:3000 -v dems-data:/app/data --name dems dems
```

## 🤝 Mitwirken

Beiträge sind willkommen! Fühle dich frei, Issues zu eröffnen oder Pull Requests einzureichen, um das Projekt zu verbessern.

## 📝 Lizenz & Credits

Entwickelt von **Mori Takahashi** (Lyonel Berzen).
Dieses Projekt ist unter der MIT Lizenz veröffentlicht.
