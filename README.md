# Discord Event Management System (DEMS)

Ein professionelles und benutzerfreundliches System zur Planung und Verwaltung von Community-Events mit nahtloser Discord-Integration.

Dieses Projekt wurde entwickelt, um Communities die Organisation von Veranstaltungen zu erleichtern – von der Erstellung über die Anmeldung bis hin zur automatisierten Kommunikation via Discord-Bot.

## 🚀 Funktionen

*   **Discord Integration**: Einfacher Login via Discord OAuth2 und automatische Synchronisation.
*   **Event-Management**: Administratoren können Events erstellen, bearbeiten und verwalten.
*   **Anmeldesystem**: Benutzer können sich mit wenigen Klicks für Events an- und abmelden.
*   **Benutzerprofile**: Persönliche Übersicht über teilgenommene Events und Statistiken.
*   **Automatisierung**: Der integrierte Discord-Bot sendet Benachrichtigungen und verwaltet Rollen.
*   **Modernes Design**: Ansprechende Benutzeroberfläche im Glassmorphism-Stil.

## 🛠️ Technologien

Das Projekt basiert auf einem modernen Tech-Stack:

*   **Backend**: Node.js, Express
*   **Datenbank**: Google Firebase (Firestore)
*   **Bot-Integration**: Discord.js
*   **Frontend**: HTML5, CSS3, JavaScript (EJS Templating)

## 📦 Installation & Einrichtung

Folge diesen Schritten, um das Projekt lokal einzurichten:

### 1. Voraussetzungen
Stelle sicher, dass du folgende Tools installiert hast:
*   [Node.js](https://nodejs.org/) (Version 16 oder höher)
*   Ein Firebase-Projekt
*   Eine Discord-Applikation im [Developer Portal](https://discord.com/developers/applications)

### 2. Installation
Klonen das Repository und installiere die Abhängigkeiten:

```bash
git clone https://github.com/DEIN-USERNAME/Discord-Event-Management-System.git
cd Discord-Event-Management-System
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

## 🤝 Mitwirken

Beiträge sind willkommen! Fühle dich frei, Issues zu eröffnen oder Pull Requests einzureichen, um das Projekt zu verbessern.

## 📝 Lizenz & Credits

Entwickelt von **Mori Takahashi** (Lyonel Berzen).
Dieses Projekt ist unter der MIT Lizenz veröffentlicht.
