# Dev-Mock-Modus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run dev:mock` (lokal) bzw. `docker compose -f compose.dev.yaml up` startet DEMS ohne Discord, OAuth und Firebase – mit Persona-Login, simuliertem Discord-Server und Dummy-Daten in einer eigenen SQLite-Datei.

**Architecture:** Ein einziger Schalter `DEV_MOCK=true` (gesetzt von `dev/start.js`) lässt `dev/mockMode.js` die Umgebung erzwingen, bevor `firebaseAdmin.js` und `bot.js` sie lesen. `bot.js` überschreibt im Mock-Modus per `Object.assign` nur die Discord-Funktionen mit `dev/mockBot.js`. `dev/devAuth.js` hängt sich vor den echten Auth-Router, und `dev/seed.js` befüllt die Dev-Datenbank über die bestehende Firestore-kompatible API.

**Tech Stack:** Node.js ≥ 22, Express 5, better-sqlite3 (über `db/sqliteAdapter.js`), discord.js 14, `node:test` (eingebaut), nodemon, Docker / Compose.

**Spec:** `docs/superpowers/specs/2026-09-29-dev-mock-mode-design.md`

**Branch:** `feature/dev-mock-mode` (bereits angelegt, enthält den Spec-Commit)

## Global Constraints

- Keine neuen npm-Abhängigkeiten. Tests laufen mit dem eingebauten `node:test` / `node:assert/strict`.
- Aktivierung nur über `DEV_MOCK=true`. Bei `DEV_MOCK=true` + `NODE_ENV=production` beendet sich der Prozess mit Exit-Code 1 und der Meldung `❌ DEV_MOCK=true ist in Produktion (NODE_ENV=production) nicht erlaubt. Server wird nicht gestartet.`
- Dev-Datenbank: `DEV_SQLITE_PATH` falls gesetzt, sonst `<projekt>/data/dems.dev.sqlite` (absoluter Pfad).
- Defaults im Mock-Modus (nur wenn nicht gesetzt): `SESSION_SECRET=dems-dev-mock-secret`, `ADMIN_RESET_PASSWORD=dev`.
- Konsolen-Präfix für simulierte Discord-Aktionen: `[MOCK-DISCORD]`.
- Check-in-Code des laufenden Beispiel-Events: `DEMO42`.
- Das Frontend (`public/`) bleibt unverändert.
- Nutzertexte auf Deutsch; Code-Kommentare auf Englisch im Stil von `bot.js` (JSDoc, `->`).
- Commit-Messages: englischer Imperativ-Satz wie in der bestehenden Historie, mit Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Der Produktions-Stage `runtime` im Dockerfile bleibt der Standard-Build-Target.

## Review Focus

1. **Echte Zugangsdaten in der `.env` bei `npm run dev:mock`**: Weder Discord noch Firebase darf angesprochen werden, die Mock-Werte gewinnen. → Test in Task 2 (`forces the mock environment and ignores real credentials`).
2. **`DEV_MOCK=true` in einer Produktionsumgebung** (z. B. kopierte `.env` im Prod-Container): Der Start muss abbrechen, auch über den Einstieg `dev/start.js` und im Produktions-Image. → Tests in Task 2 und Task 5, Docker-Prüfung in Task 6.
3. **Seed- oder Reset-Code ohne Mock-Modus geladen**: Darf nie eine echte Datenbank befüllen oder leeren. → Test in Task 4 (`the seed refuses to run outside the dev mock mode`).
4. **Häufiges Neuladen beim Entwickeln**: Der Mock-Modus darf nicht in die Rate-Limits (30 bzw. 200 Requests / 15 min) laufen. → Test in Task 5 (`the rate limiters do not get in the way`).
5. **Persona-Wechsel im selben Browser**: Der neue Login ersetzt den alten Session-User vollständig, keine übrig gebliebenen Admin-Rechte. → Test in Task 5 (`a second login in the same browser replaces the persona`).

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `db/sqliteAdapter.js` | (ändern) `doc()` akzeptiert eine Collection-Referenz |
| `dev/mockGuild.js` | Statische Daten des Mock-Servers: Server, Rollen, Channels, Scheduled Events, Personas, weitere Mitglieder |
| `dev/mockMode.js` | Schalter `IS_MOCK_MODE`, Produktionssperre, erzwungene Umgebung |
| `dev/mockBot.js` | Mock-Versionen der Discord-Funktionen aus `bot.js` |
| `dev/seedData.js` | Reiner Datensatz `buildSeedData(now)` |
| `dev/seed.js` | `seedIfEmpty()`, `resetAndSeed()` |
| `dev/devAuth.js` | Persona-Auswahlseite und Login |
| `dev/start.js` | Einstieg `npm run dev:mock` |
| `dev/reset.js` | Einstieg `npm run dev:reset` |
| `bot.js` | (ändern) Mock-Override am Dateiende |
| `server.js` | (ändern) `mockMode` laden, Rate-Limits im Mock-Modus aus, `devAuth` einhängen |
| `test/helpers.js` | Test-Hilfen: Temp-Verzeichnisse, Kindprozesse, Server-Start, Cookie-Client |
| `test/*.test.js` | Tests pro Baustein |
| `Dockerfile`, `compose.dev.yaml`, `compose.yaml`, `.dockerignore` | Docker-Dev |
| `package.json`, `README.md`, `.env.example` | Skripte und Doku |

---

### Task 1: Test-Runner und Bugfix `doc(collectionRef, id)` im SQLite-Adapter

**Files:**
- Modify: `package.json` (Skript `test`)
- Modify: `db/sqliteAdapter.js:157-159` (Funktion `doc`)
- Test: `test/sqliteAdapter.test.js`

**Interfaces:**
- Consumes: —
- Produces: `npm test` führt alle `test/**/*.test.js` aus. `doc(collectionRef, id?)` liefert `{ __type: 'doc', collection: collectionRef.collection, id }`.

- [ ] **Step 1: Test-Skript in `package.json` ergänzen**

Im Block `"scripts"` nach `"dev"` einfügen:

```json
    "test": "node --test \"test/**/*.test.js\""
```

Der `scripts`-Block sieht danach so aus:

```json
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "node --test \"test/**/*.test.js\""
  },
```

- [ ] **Step 2: Failing Test schreiben**

Datei `test/sqliteAdapter.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The adapter opens its database on require -> point it to a temp file first
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dems-adapter-'));
process.env.SQLITE_PATH = path.join(tmpDir, 'adapter.sqlite');

const { db, collection, doc, getDoc, setDoc, updateDoc } = require('../db/sqliteAdapter');

test('doc() accepts a collection reference as first argument', async () => {
    await setDoc(doc(db, 'events', 'evt-1'), { title: 'Original' });

    const events = collection(db, 'events');
    const snap = await getDoc(doc(events, 'evt-1'));
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().title, 'Original');

    await updateDoc(doc(events, 'evt-1'), { title: 'Updated' });
    const updated = await getDoc(doc(db, 'events', 'evt-1'));
    assert.equal(updated.data().title, 'Updated');
});

test('doc() with only a collection reference generates an ID in that collection', () => {
    const ref = doc(collection(db, 'events'));
    assert.equal(ref.collection, 'events');
    assert.equal(typeof ref.id, 'string');
    assert.equal(ref.id.length, 20);
});
```

- [ ] **Step 3: Test ausführen, er muss fehlschlagen**

Run: `node --test test/sqliteAdapter.test.js`
Expected: FAIL. Der erste Test scheitert an `assert.equal(snap.exists(), true)`, der zweite an `ref.collection` (`undefined !== 'events'`).

- [ ] **Step 4: `doc()` im Adapter korrigieren**

In `db/sqliteAdapter.js` die bestehende Funktion

```js
function doc(_db, name, id) {
  return { __type: 'doc', collection: name, id: id != null ? String(id) : generateId() };
}
```

ersetzen durch:

```js
function doc(parent, name, id) {
  // Firestore also accepts doc(collectionRef, id) -> the collection name then
  // comes from the reference and the second argument is the document ID.
  if (parent && parent.__type === 'collection') {
    [name, id] = [parent.collection, name];
  }
  return { __type: 'doc', collection: name, id: id != null ? String(id) : generateId() };
}
```

- [ ] **Step 5: Tests ausführen, sie müssen grün sein**

Run: `npm test`
Expected: PASS, `# pass 2`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json db/sqliteAdapter.js test/sqliteAdapter.test.js
git commit -m "Support doc(collectionRef, id) in the SQLite adapter

Starting and ending an event called doc(col, id), which the adapter
treated as a collection named after the event ID -> both actions
always answered 404 on SQLite. Also adds npm test (node:test).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Mock-Server-Daten und Mock-Schalter mit Produktionssperre

**Files:**
- Create: `dev/mockGuild.js`
- Create: `dev/mockMode.js`
- Create: `test/helpers.js`
- Test: `test/mockMode.test.js`

**Interfaces:**
- Consumes: —
- Produces:
  - `dev/mockGuild.js` exportiert `GUILD` (`{ id, name, memberCount }`), `ROLE_ID` (`ADMIN, MODERATOR, MEMBER, RAID_TEAM, VIP, BOT`), `ROLES` (`[{ id, name, color: number, managed }]`), `CHANNEL_ID` (`GENERAL, ANNOUNCEMENTS, EVENTS, LOBBY, EVENT_VOICE, STAGE, FORUM, MOD_INTERNAL`), `CHANNELS` (`[{ id, name, type: 'text'|'voice', isPublic }]`), `PERSONAS` (`[{ id, userId, username, displayName, roles, description, isNewcomer }]`), `MEMBERS` (`[{ userId, username, displayName, roles }]`), `findMember(userId) -> persona|member|null`, `defaultAvatar(userId) -> string`, `buildScheduledEvents(now: Date) -> Array`.
  - `dev/mockMode.js` exportiert `{ IS_MOCK_MODE: boolean, MOCK_GUILD }`.
  - `test/helpers.js` exportiert `REPO_ROOT`, `createTempDir(prefix)`, `repoPath(relativePath)`, `cleanEnv(env)`, `runNode(code, env) -> spawnSync-Ergebnis`, `parseLastLine(output)`.

- [ ] **Step 1: Test-Helfer anlegen**

Datei `test/helpers.js`:

```js
/**
 * Shared helpers for the node:test suites.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// Variables that would leak the developer's own setup into a test process
const LEAKING_PREFIXES = ['DISCORD_', 'FIREBASE_', 'DEV_'];
const LEAKING_KEYS = ['NODE_ENV', 'SQLITE_PATH', 'SESSION_SECRET', 'ADMIN_RESET_PASSWORD', 'PORT', 'BASE_URL', 'DEBUG_MODE'];

/**
 * Create an empty temporary directory.
 *
 * @param {string} prefix -> Name part of the directory.
 * @returns {string} -> Absolute path of the new directory.
 */
function createTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `dems-${prefix}-`));
}

/**
 * Absolute path inside the repository as a JavaScript string literal,
 * ready to be embedded in a snippet passed to runNode().
 *
 * @param {string} relativePath -> Path relative to the repository root.
 * @returns {string} -> Quoted absolute path.
 */
function repoPath(relativePath) {
    return JSON.stringify(path.join(REPO_ROOT, relativePath));
}

/**
 * Copy of process.env without DEMS settings, merged with `env`.
 *
 * @param {Object} env -> Variables the test wants to set.
 * @returns {Object} -> Environment for a child process.
 */
function cleanEnv(env = {}) {
    const base = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !LEAKING_KEYS.includes(key) && !LEAKING_PREFIXES.some(prefix => key.startsWith(prefix))));
    return { ...base, ...env };
}

/**
 * Run a JavaScript snippet in a fresh Node process.
 *
 * The process runs in an empty temp directory, so dotenv finds no .env file
 * and the developer's own configuration cannot influence the result.
 *
 * @param {string} code -> JavaScript to run with `node -e`.
 * @param {Object} env -> Variables to set for the process.
 * @returns {Object} -> spawnSync result with `status`, `stdout`, `stderr`.
 */
function runNode(code, env = {}) {
    return spawnSync(process.execPath, ['-e', code], {
        cwd: createTempDir('run'),
        env: cleanEnv(env),
        encoding: 'utf8',
        timeout: 30000
    });
}

/**
 * Parse the last line of a process output as JSON.
 *
 * @param {string} output -> stdout of a process.
 * @returns {*} -> Parsed value.
 */
function parseLastLine(output) {
    return JSON.parse(output.trim().split('\n').pop());
}

module.exports = { REPO_ROOT, createTempDir, repoPath, cleanEnv, runNode, parseLastLine };
```

- [ ] **Step 2: Failing Tests schreiben**

Datei `test/mockMode.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { repoPath, runNode, parseLastLine } = require('./helpers');
const { GUILD, ROLE_ID, CHANNEL_ID } = require('../dev/mockGuild');

// Prints IS_MOCK_MODE and the variables mockMode.js is responsible for
const PRINT_ENV = `
    const { IS_MOCK_MODE } = require(${repoPath('dev/mockMode')});
    const keys = ['SQLITE_PATH', 'FIREBASE_API_KEY', 'FIREBASE_APP_ID', 'DISCORD_BOT_TOKEN',
        'DISCORD_GUILD_ID', 'DISCORD_ADMIN_ROLE_ID', 'DISCORD_ANNOUNCE_CHANNEL_ID',
        'DISCORD_EVENT_CATEGORY_ID', 'BASE_URL', 'SESSION_SECRET', 'ADMIN_RESET_PASSWORD'];
    console.log(JSON.stringify({ IS_MOCK_MODE, env: Object.fromEntries(keys.map(k => [k, process.env[k]])) }));
`;

test('refuses to load in production', () => {
    const result = runNode(`require(${repoPath('dev/mockMode')})`, { DEV_MOCK: 'true', NODE_ENV: 'production' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DEV_MOCK=true ist in Produktion \(NODE_ENV=production\) nicht erlaubt/);
});

test('forces the mock environment and ignores real credentials', () => {
    const result = runNode(PRINT_ENV, {
        DEV_MOCK: 'true',
        PORT: '4321',
        FIREBASE_API_KEY: 'real-key',
        FIREBASE_APP_ID: 'real-app',
        DISCORD_BOT_TOKEN: 'real-token',
        DISCORD_GUILD_ID: '999',
        DISCORD_EVENT_CATEGORY_ID: '888'
    });
    assert.equal(result.status, 0, result.stderr);

    const { IS_MOCK_MODE, env } = parseLastLine(result.stdout);
    assert.equal(IS_MOCK_MODE, true);
    assert.ok(path.isAbsolute(env.SQLITE_PATH));
    assert.ok(env.SQLITE_PATH.endsWith(path.join('data', 'dems.dev.sqlite')));
    assert.equal(env.FIREBASE_API_KEY, '');
    assert.equal(env.FIREBASE_APP_ID, '');
    assert.equal(env.DISCORD_BOT_TOKEN, '');
    assert.equal(env.DISCORD_GUILD_ID, GUILD.id);
    assert.equal(env.DISCORD_ADMIN_ROLE_ID, ROLE_ID.ADMIN);
    assert.equal(env.DISCORD_ANNOUNCE_CHANNEL_ID, CHANNEL_ID.ANNOUNCEMENTS);
    assert.equal(env.DISCORD_EVENT_CATEGORY_ID, '');
    assert.equal(env.BASE_URL, 'http://localhost:4321');
    assert.equal(env.SESSION_SECRET, 'dems-dev-mock-secret');
    assert.equal(env.ADMIN_RESET_PASSWORD, 'dev');
});

test('keeps an own session secret, reset password and dev database path', () => {
    const customDb = path.join(os.tmpdir(), 'dems-custom-dev.sqlite');
    const result = runNode(PRINT_ENV, {
        DEV_MOCK: 'true',
        DEV_SQLITE_PATH: customDb,
        SESSION_SECRET: 'my-secret',
        ADMIN_RESET_PASSWORD: 'my-password'
    });
    assert.equal(result.status, 0, result.stderr);

    const { env } = parseLastLine(result.stdout);
    assert.equal(env.SQLITE_PATH, customDb);
    assert.equal(env.SESSION_SECRET, 'my-secret');
    assert.equal(env.ADMIN_RESET_PASSWORD, 'my-password');
});

test('changes nothing without DEV_MOCK', () => {
    const result = runNode(PRINT_ENV, { FIREBASE_API_KEY: 'real-key', DISCORD_GUILD_ID: '999' });
    assert.equal(result.status, 0, result.stderr);

    const { IS_MOCK_MODE, env } = parseLastLine(result.stdout);
    assert.equal(IS_MOCK_MODE, false);
    assert.equal(env.FIREBASE_API_KEY, 'real-key');
    assert.equal(env.DISCORD_GUILD_ID, '999');
    assert.equal(env.SQLITE_PATH, undefined);
});
```

- [ ] **Step 3: Tests ausführen, sie müssen fehlschlagen**

Run: `node --test test/mockMode.test.js`
Expected: FAIL mit `Cannot find module '../dev/mockGuild'`.

- [ ] **Step 4: `dev/mockGuild.js` anlegen**

```js
/**
 * The simulated Discord server of the dev mock mode.
 *
 * All IDs look like Discord snowflakes (18 digits), so code that works with
 * them - e.g. the avatar fallback `parseInt(id) % 5` - behaves like with real
 * data. The personas are the accounts offered on the dev login page, the
 * members fill participant lists and the guest search.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const GUILD = { id: '100000000000000000', name: 'DEMS Dev Server', memberCount: 42 };

const ROLE_ID = {
    ADMIN: '110000000000000001',
    MODERATOR: '110000000000000002',
    MEMBER: '110000000000000003',
    RAID_TEAM: '110000000000000004',
    VIP: '110000000000000005',
    BOT: '110000000000000006'
};

// Highest position first, like getGuildRoles() returns them
const ROLES = [
    { id: ROLE_ID.BOT, name: 'DEMS Bot', color: 0x5865f2, managed: true },
    { id: ROLE_ID.ADMIN, name: 'Admin', color: 0xef4444, managed: false },
    { id: ROLE_ID.MODERATOR, name: 'Moderator', color: 0xf59e0b, managed: false },
    { id: ROLE_ID.RAID_TEAM, name: 'Raid-Team', color: 0x22c55e, managed: false },
    { id: ROLE_ID.VIP, name: 'VIP', color: 0xa855f7, managed: false },
    { id: ROLE_ID.MEMBER, name: 'Mitglied', color: 0x3b82f6, managed: false }
];

const CHANNEL_ID = {
    GENERAL: '120000000000000001',
    ANNOUNCEMENTS: '120000000000000002',
    EVENTS: '120000000000000003',
    LOBBY: '120000000000000004',
    EVENT_VOICE: '120000000000000005',
    STAGE: '120000000000000006',
    FORUM: '120000000000000007',
    MOD_INTERNAL: '120000000000000008'
};

// `type` uses the simplified format of bot.js ('text' | 'voice');
// `isPublic` decides whether getPublicGuildChannels() offers the channel
const CHANNELS = [
    { id: CHANNEL_ID.GENERAL, name: 'allgemein', type: 'text', isPublic: true },
    { id: CHANNEL_ID.ANNOUNCEMENTS, name: 'ankündigungen', type: 'text', isPublic: true },
    { id: CHANNEL_ID.EVENTS, name: 'events', type: 'text', isPublic: true },
    { id: CHANNEL_ID.LOBBY, name: 'Lobby', type: 'voice', isPublic: true },
    { id: CHANNEL_ID.EVENT_VOICE, name: 'Event-Voice', type: 'voice', isPublic: true },
    { id: CHANNEL_ID.STAGE, name: 'Bühne', type: 'voice', isPublic: true },
    { id: CHANNEL_ID.FORUM, name: 'forum', type: 'text', isPublic: true },
    { id: CHANNEL_ID.MOD_INTERNAL, name: 'mod-intern', type: 'text', isPublic: false }
];

// Accounts offered on the dev login page
const PERSONAS = [
    {
        id: 'admin', userId: '200000000000000001', username: 'mori', displayName: 'Mori (Admin)',
        roles: [ROLE_ID.ADMIN, ROLE_ID.MEMBER], description: 'Admin-Bereich, Bot-Zentrale, Wartung', isNewcomer: false
    },
    {
        id: 'raider', userId: '200000000000000002', username: 'lena', displayName: 'Lena',
        roles: [ROLE_ID.MEMBER, ROLE_ID.RAID_TEAM], description: 'Mitglied mit Rolle Raid-Team', isNewcomer: false
    },
    {
        id: 'member', userId: '200000000000000003', username: 'tom', displayName: 'Tom',
        roles: [ROLE_ID.MEMBER], description: 'Mitglied ohne Sonderrollen', isNewcomer: false
    },
    {
        id: 'newbie', userId: '200000000000000004', username: 'neo', displayName: 'Neo (Neuling)',
        roles: [], description: 'Erster Login, noch kein Profil', isNewcomer: true
    }
];

// Further members of the mock server -> participants, commenters, guests
const MEMBERS = [
    { userId: '200000000000000011', username: 'kira', displayName: 'Kira', roles: [ROLE_ID.MEMBER, ROLE_ID.RAID_TEAM] },
    { userId: '200000000000000012', username: 'jonas', displayName: 'Jonas', roles: [ROLE_ID.MEMBER] },
    { userId: '200000000000000013', username: 'aylin', displayName: 'Aylin', roles: [ROLE_ID.MEMBER, ROLE_ID.VIP] },
    { userId: '200000000000000014', username: 'ben', displayName: 'Ben', roles: [ROLE_ID.MEMBER, ROLE_ID.RAID_TEAM] },
    { userId: '200000000000000015', username: 'chiara', displayName: 'Chiara', roles: [ROLE_ID.MEMBER, ROLE_ID.MODERATOR] },
    { userId: '200000000000000016', username: 'dennis', displayName: 'Dennis', roles: [ROLE_ID.MEMBER] },
    { userId: '200000000000000017', username: 'elif', displayName: 'Elif', roles: [ROLE_ID.MEMBER] },
    { userId: '200000000000000018', username: 'felix', displayName: 'Felix', roles: [ROLE_ID.MEMBER, ROLE_ID.RAID_TEAM] },
    { userId: '200000000000000019', username: 'greta', displayName: 'Greta', roles: [ROLE_ID.MEMBER] }
];

/**
 * Find a persona or member of the mock server.
 *
 * @param {string} userId -> Discord user ID.
 * @returns {Object|null} -> Persona or member, null when unknown.
 */
function findMember(userId) {
    return [...PERSONAS, ...MEMBERS].find(member => member.userId === userId) || null;
}

/**
 * Discord's default avatar for a user without an own avatar.
 *
 * @param {string} userId -> Numeric Discord user ID.
 * @returns {string} -> URL of the default avatar.
 */
function defaultAvatar(userId) {
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) % 5n)}.png`;
}

/**
 * Scheduled events offered by the Discord import of the admin area.
 *
 * @param {Date} now -> Reference time, the events lie in the future of it.
 * @returns {Array<Object>} -> Events in the format of getGuildScheduledEvents().
 */
function buildScheduledEvents(now) {
    const scheduled = (id, name, description, inDays, durationHours, location) => {
        const start = now.getTime() + inDays * DAY;
        return {
            id,
            name,
            description,
            scheduledStartTimestamp: start,
            scheduledEndTimestamp: start + durationHours * HOUR,
            image: null,
            location,
            url: `https://discord.com/events/${GUILD.id}/${id}`
        };
    };

    return [
        scheduled('130000000000000001', 'Community-Quiz', 'Quizabend mit Preisen für die besten drei Teams.', 4, 2, 'Discord'),
        scheduled('130000000000000002', 'Turnier-Qualifikation', 'Qualifikationsrunde für das Herbstturnier.', 12, 4, 'Event-Voice')
    ];
}

module.exports = {
    GUILD,
    ROLE_ID,
    ROLES,
    CHANNEL_ID,
    CHANNELS,
    PERSONAS,
    MEMBERS,
    findMember,
    defaultAvatar,
    buildScheduledEvents
};
```

- [ ] **Step 5: `dev/mockMode.js` anlegen**

```js
/**
 * Switch of the dev mock mode.
 *
 * With DEV_MOCK=true DEMS runs without Discord, OAuth and Firebase: a local
 * SQLite file, a simulated Discord server and a persona login. Loading this
 * module forces the environment into that state -> it has to be required
 * before firebaseAdmin.js and bot.js read the environment.
 *
 * The mode refuses to run with NODE_ENV=production, because the persona login
 * would let anybody sign in as admin.
 */
const path = require('path');
require('dotenv').config({ quiet: true });
const MOCK_GUILD = require('./mockGuild');

const IS_MOCK_MODE = process.env.DEV_MOCK === 'true';

const DEFAULT_DEV_DB = path.join(__dirname, '..', 'data', 'dems.dev.sqlite');
const FIREBASE_KEYS = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID'
];

/**
 * Force the environment of the mock mode, overriding values from .env.
 */
function applyMockEnvironment() {
    const env = process.env;

    if (env.NODE_ENV === 'production') {
        console.error('❌ DEV_MOCK=true ist in Produktion (NODE_ENV=production) nicht erlaubt. Server wird nicht gestartet.');
        process.exit(1);
    }

    env.SQLITE_PATH = env.DEV_SQLITE_PATH || DEFAULT_DEV_DB;
    FIREBASE_KEYS.forEach(key => { env[key] = ''; });
    env.DISCORD_BOT_TOKEN = '';
    env.DISCORD_GUILD_ID = MOCK_GUILD.GUILD.id;
    env.DISCORD_ADMIN_ROLE_ID = MOCK_GUILD.ROLE_ID.ADMIN;
    env.DISCORD_ANNOUNCE_CHANNEL_ID = MOCK_GUILD.CHANNEL_ID.ANNOUNCEMENTS;
    env.DISCORD_EVENT_CATEGORY_ID = '';
    env.BASE_URL = `http://localhost:${env.PORT || 3000}`;

    if (!env.SESSION_SECRET) env.SESSION_SECRET = 'dems-dev-mock-secret';
    if (!env.ADMIN_RESET_PASSWORD) env.ADMIN_RESET_PASSWORD = 'dev';

    console.log(`🧪 DEV-MOCK-MODUS aktiv — kein Discord, kein Firebase, DB: ${env.SQLITE_PATH}`);
}

if (IS_MOCK_MODE) applyMockEnvironment();

module.exports = { IS_MOCK_MODE, MOCK_GUILD };
```

- [ ] **Step 6: Tests ausführen, sie müssen grün sein**

Run: `node --test test/mockMode.test.js`
Expected: PASS, `# pass 4`, `# fail 0`.

- [ ] **Step 7: Gesamte Suite ausführen**

Run: `npm test`
Expected: PASS, `# pass 6`, `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add dev/mockGuild.js dev/mockMode.js test/helpers.js test/mockMode.test.js
git commit -m "Add the dev mock mode switch and the simulated Discord server data

DEV_MOCK=true forces a separate SQLite file, blanks Firebase and the bot
token and points all Discord IDs at the mock server. It refuses to run
with NODE_ENV=production.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Simulierter Discord-Bot

**Files:**
- Create: `dev/mockBot.js`
- Modify: `bot.js:8` (Import vor `firebaseAdmin`) und Dateiende nach `module.exports`
- Modify: `docs/superpowers/specs/2026-09-29-dev-mock-mode-design.md` (Teil 4, Zeile „Lebenszyklus“)
- Test: `test/mockBot.test.js`

**Interfaces:**
- Consumes: `dev/mockMode.js` → `IS_MOCK_MODE`; `dev/mockGuild.js` → `GUILD, ROLES, CHANNELS, buildScheduledEvents, findMember`; `firebaseAdmin.js` → `db, doc, getDoc, updateDoc`; `test/helpers.js` → `createTempDir`.
- Produces: Im Mock-Modus liefern die `bot.js`-Exporte `startBot, getGuildName, getGuildRoles, getGuildChannels, getPublicGuildChannels, getGuildScheduledEvents, getUserRoles, isGuildMember, getBotStatus, sendDM, sendChannelMessage, sendGuestInvitation, assignRole, removeRole, createEventChannels, addParticipantToEventChannels, removeParticipantFromEventChannels, deleteEventChannels, createScheduledEvent` die Mock-Versionen mit identischen Signaturen und Rückgabeformaten. `stopBot` bleibt echt (räumt die Scheduler-Intervalle auf; der Client ist nie eingeloggt).

- [ ] **Step 1: Failing Tests schreiben**

Datei `test/mockBot.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('mock-bot');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'bot.sqlite');

const bot = require('../bot');
const { GUILD, ROLE_ID, CHANNEL_ID, PERSONAS } = require('../dev/mockGuild');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');

const raider = PERSONAS.find(persona => persona.id === 'raider');

after(async () => {
    await bot.client.destroy();
});

test('bot.js answers with the mock server when DEV_MOCK=true', async () => {
    assert.equal(await bot.getGuildName(GUILD.id), 'DEMS Dev Server');
    const roles = await bot.getGuildRoles(GUILD.id);
    assert.ok(roles.some(role => role.id === ROLE_ID.RAID_TEAM && role.name === 'Raid-Team'));
    assert.ok(roles.some(role => role.managed));
});

test('only public channels are offered to members', async () => {
    const all = await bot.getGuildChannels(GUILD.id);
    const publicChannels = await bot.getPublicGuildChannels(GUILD.id);

    assert.ok(all.some(channel => channel.id === CHANNEL_ID.MOD_INTERNAL));
    assert.ok(!publicChannels.some(channel => channel.id === CHANNEL_ID.MOD_INTERNAL));
    assert.ok(all.every(channel => ['text', 'voice'].includes(channel.type)));

    const names = publicChannels.map(channel => channel.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('scheduled events for the import lie in the future', async () => {
    const events = await bot.getGuildScheduledEvents(GUILD.id);
    assert.equal(events.length, 2);
    assert.ok(events.every(event => event.name && event.scheduledStartTimestamp > Date.now()));
});

test('member roles come from the persona', async () => {
    const roles = await bot.getUserRoles(raider.userId, GUILD.id);
    assert.deepEqual(roles.map(role => role.id).sort(), [...raider.roles].sort());
    assert.ok(roles.every(role => /^#[0-9a-f]{6}$/.test(role.color)));
    assert.equal(await bot.isGuildMember(raider.userId, GUILD.id), true);
    assert.equal(await bot.isGuildMember('1', GUILD.id), false);
});

test('messages are logged and reported as sent', async () => {
    const event = { title: 'Mock-Test', status: 'active', startDate: new Date().toISOString() };

    assert.equal(await bot.startBot(''), true);
    assert.equal(await bot.sendDM(raider.userId, 'Hallo Lena'), true);
    assert.equal(await bot.sendChannelMessage(CHANNEL_ID.ANNOUNCEMENTS, bot.buildEventEmbed(event), {
        text: 'Neues Event!',
        roleIds: [ROLE_ID.RAID_TEAM],
        components: bot.buildEventComponents(event, 'evt-mock')
    }), true);
    assert.equal(await bot.sendGuestInvitation(raider.userId, { id: '1', displayName: 'Tom' }, { id: 'evt-mock', title: 'Mock-Test' }, 'reg-1'), true);
    assert.equal(await bot.assignRole(raider.userId, ROLE_ID.VIP, GUILD.id), true);
    assert.equal(await bot.removeRole(raider.userId, ROLE_ID.VIP, GUILD.id), true);
    assert.match(await bot.createScheduledEvent(event), /^\d{18}$/);

    const status = bot.getBotStatus();
    assert.equal(status.online, true);
    assert.equal(status.guildName, GUILD.name);
    assert.equal(status.dmsSent, 2);
});

test('event channels are simulated and stored on the event', async () => {
    const eventRef = doc(db, 'events', 'evt-channels');
    await setDoc(eventRef, { title: 'Channel-Test', channelConfig: { type: 'both' } });

    const created = await bot.createEventChannels({ id: 'evt-channels', title: 'Channel-Test', channelConfig: { type: 'both' } });
    assert.match(created.voiceId, /^\d{18}$/);
    assert.match(created.textId, /^\d{18}$/);
    assert.equal((await getDoc(eventRef)).data().discordTextChannelId, created.textId);

    const stored = { id: 'evt-channels', ...(await getDoc(eventRef)).data() };
    assert.equal(await bot.addParticipantToEventChannels(stored, raider.userId), true);
    assert.equal(await bot.removeParticipantFromEventChannels(stored, raider.userId), true);

    assert.equal(await bot.deleteEventChannels('evt-channels'), true);
    assert.equal((await getDoc(eventRef)).data().discordChannelId, null);
    assert.equal(await bot.deleteEventChannels('evt-channels'), false);
});
```

- [ ] **Step 2: Tests ausführen, sie müssen fehlschlagen**

Run: `node --test test/mockBot.test.js`
Expected: FAIL. Der erste Test scheitert, weil `getGuildName` `''` liefert (der echte Bot ist nicht eingeloggt).

- [ ] **Step 3: `dev/mockBot.js` anlegen**

```js
/**
 * Simulated versions of every bot.js function that talks to Discord.
 *
 * bot.js merges these exports over its own ones when DEV_MOCK=true. The
 * routes then read roles, channels and scheduled events of the mock server
 * (dev/mockGuild.js), and everything that would be sent to Discord is
 * printed to the console with the [MOCK-DISCORD] prefix instead.
 */
const crypto = require('crypto');
const { db, doc, getDoc, updateDoc } = require('../firebaseAdmin');
const { GUILD, ROLES, CHANNELS, buildScheduledEvents, findMember } = require('./mockGuild');

const LOG_PREFIX = '\x1b[35m[MOCK-DISCORD]\x1b[0m';
const startedAt = new Date();
let dmsSent = 0;

/**
 * Print a simulated Discord action.
 *
 * @param {string} action -> What would have happened in Discord.
 * @param {*} [details] -> Payload that would have been sent.
 */
function mockLog(action, details) {
    if (details === undefined) {
        console.log(`${LOG_PREFIX} ${action}`);
    } else {
        console.log(`${LOG_PREFIX} ${action}`, details);
    }
}

/**
 * Convert a discord.js builder (embed, action row) into its API payload.
 *
 * @param {*} value -> Builder or plain value.
 * @returns {*} -> JSON payload, or the value itself when it is no builder.
 */
function toPayload(value) {
    if (!value || typeof value.toJSON !== 'function') return value;
    try {
        return value.toJSON();
    } catch (err) {
        return `[ungültige Komponente: ${err.message}]`;
    }
}

/** Readable name of a user for the log. */
function describeUser(userId) {
    const member = findMember(userId);
    return member ? `${member.displayName} (${userId})` : userId;
}

/** Readable name of a role for the log. */
function describeRole(roleId) {
    const role = ROLES.find(r => r.id === roleId);
    return role ? `@${role.name}` : roleId;
}

/** Readable name of a channel for the log. */
function describeChannel(channelId) {
    const channel = CHANNELS.find(c => c.id === channelId);
    return channel ? `#${channel.name}` : channelId;
}

/** Random 18 digit ID for channels and events created by the mock. */
function fakeSnowflake() {
    return `9${Date.now()}${String(crypto.randomInt(10000)).padStart(4, '0')}`;
}

/**
 * Channels in the format of bot.js -> `{ id, name, type }`, sorted by name.
 *
 * @param {Function} filter -> Decides which mock channels are listed.
 * @returns {Array<Object>} -> Matching channels.
 */
function listChannels(filter) {
    return CHANNELS
        .filter(filter)
        .map(({ id, name, type }) => ({ id, name, type }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Lifecycle ────────────────────────────────────────────────────────────

async function startBot() {
    mockLog(`Bot simuliert — verbunden mit "${GUILD.name}"`);
    return true;
}

// ── Reading ──────────────────────────────────────────────────────────────

async function getGuildName() {
    return GUILD.name;
}

async function getGuildRoles() {
    return ROLES.map(role => ({ ...role }));
}

async function getGuildChannels() {
    return listChannels(() => true);
}

async function getPublicGuildChannels() {
    return listChannels(channel => channel.isPublic);
}

async function getGuildScheduledEvents() {
    return buildScheduledEvents(new Date());
}

async function getUserRoles(userId) {
    const member = findMember(userId);
    if (!member) return [];
    return ROLES
        .filter(role => member.roles.includes(role.id))
        .map(role => ({ id: role.id, name: role.name, color: `#${role.color.toString(16).padStart(6, '0')}` }));
}

async function isGuildMember(userId) {
    return !!findMember(userId);
}

function getBotStatus() {
    return {
        online: true,
        username: 'DEMS Bot (Mock)#0000',
        avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
        uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
        startedAt: startedAt.toISOString(),
        ping: 42,
        guildName: GUILD.name,
        guildMemberCount: GUILD.memberCount,
        guildId: GUILD.id,
        dmsSent,
        commandsProcessed: 0,
        reminderSchedulerActive: true,
        presenceAutoUpdate: false
    };
}

// ── Sending ──────────────────────────────────────────────────────────────

async function sendDM(userId, message) {
    dmsSent++;
    const payload = typeof message === 'string'
        ? message
        : {
            ...message,
            embeds: (message.embeds || []).map(toPayload),
            components: (message.components || []).map(toPayload)
        };
    mockLog(`DM an ${describeUser(userId)}`, payload);
    return true;
}

async function sendChannelMessage(channelId, embed, options = {}) {
    mockLog(`Nachricht in ${describeChannel(channelId)}`, {
        text: options.text || '',
        roleIds: (options.roleIds || []).map(describeRole),
        pingEveryone: !!options.pingEveryone,
        embed: toPayload(embed),
        components: (options.components || []).map(toPayload)
    });
    return true;
}

async function sendGuestInvitation(guestUserId, registrant, event, registrationId) {
    dmsSent++;
    mockLog(`Gäste-Einladung an ${describeUser(guestUserId)}`, {
        from: registrant.displayName,
        event: event.title,
        registrationId
    });
    return true;
}

async function assignRole(userId, roleId) {
    mockLog(`Rolle ${describeRole(roleId)} an ${describeUser(userId)} vergeben`);
    return true;
}

async function removeRole(userId, roleId) {
    mockLog(`Rolle ${describeRole(roleId)} von ${describeUser(userId)} entfernt`);
    return true;
}

// ── Channels & scheduled events ─────────────────────────────────────────

async function createEventChannels(event) {
    if (event.discordChannelId || event.discordTextChannelId) {
        return { voiceId: event.discordChannelId, textId: event.discordTextChannelId };
    }

    const type = (event.channelConfig && event.channelConfig.type) || 'voice';
    const voiceId = type === 'voice' || type === 'both' ? fakeSnowflake() : null;
    const textId = type === 'text' || type === 'both' ? fakeSnowflake() : null;

    await updateDoc(doc(db, 'events', event.id), { discordChannelId: voiceId, discordTextChannelId: textId });
    mockLog(`Event-Channels für "${event.title}" erstellt`, { voiceId, textId });
    return { voiceId, textId };
}

async function addParticipantToEventChannels(event, userId) {
    if (!event.discordChannelId && !event.discordTextChannelId) return false;
    mockLog(`${describeUser(userId)} zu den Channels von "${event.title}" hinzugefügt`);
    return true;
}

async function removeParticipantFromEventChannels(event, userId) {
    if (!event.discordChannelId && !event.discordTextChannelId) return false;
    mockLog(`${describeUser(userId)} aus den Channels von "${event.title}" entfernt`);
    return true;
}

async function deleteEventChannels(eventId) {
    const snap = await getDoc(doc(db, 'events', eventId));
    if (!snap.exists()) return false;

    const event = snap.data();
    if (!event.discordChannelId && !event.discordTextChannelId) return false;

    await updateDoc(doc(db, 'events', eventId), { discordChannelId: null, discordTextChannelId: null });
    mockLog(`Event-Channels für "${event.title}" gelöscht`);
    return true;
}

async function createScheduledEvent(event) {
    const id = fakeSnowflake();
    mockLog(`Scheduled Event "${event.title}" erstellt`, { id, startDate: event.startDate, endDate: event.endDate });
    return id;
}

module.exports = {
    startBot,
    getGuildName,
    getGuildRoles,
    getGuildChannels,
    getPublicGuildChannels,
    getGuildScheduledEvents,
    getUserRoles,
    isGuildMember,
    getBotStatus,
    sendDM,
    sendChannelMessage,
    sendGuestInvitation,
    assignRole,
    removeRole,
    createEventChannels,
    addParticipantToEventChannels,
    removeParticipantFromEventChannels,
    deleteEventChannels,
    createScheduledEvent
};
```

- [ ] **Step 4: `bot.js` einhängen**

In `bot.js` **vor** der Zeile

```js
const { db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy } = require('./firebaseAdmin');
```

einfügen:

```js
// Loaded before firebaseAdmin.js so the mock environment is in place even
// when bot.js is required without server.js (e.g. in tests)
const { IS_MOCK_MODE } = require('./dev/mockMode');
```

Und ganz am Dateiende, nach dem schließenden `};` von `module.exports = { ... };`, anfügen:

```js

// Dev mock mode: every call that would reach Discord goes to the simulated
// server instead (see dev/mockBot.js)
if (IS_MOCK_MODE) Object.assign(module.exports, require('./dev/mockBot'));
```

- [ ] **Step 5: Tests ausführen, sie müssen grün sein**

Run: `node --test test/mockBot.test.js`
Expected: PASS, `# pass 6`, `# fail 0`. In der Ausgabe stehen `[MOCK-DISCORD]`-Zeilen.

- [ ] **Step 6: Spec an `stopBot` anpassen**

In `docs/superpowers/specs/2026-09-29-dev-mock-mode-design.md`, Teil 4, die Tabellenzeile

```
| Lebenszyklus | `startBot`, `stopBot` | loggen nur, `startBot` liefert `true` |
```

ersetzen durch:

```
| Lebenszyklus | `startBot` | loggt nur, liefert `true`. `stopBot` bleibt echt: es räumt die Scheduler-Intervalle auf, der Client ist nie eingeloggt |
```

- [ ] **Step 7: Gesamte Suite ausführen**

Run: `npm test`
Expected: PASS, `# pass 12`, `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add dev/mockBot.js bot.js test/mockBot.test.js docs/superpowers/specs/2026-09-29-dev-mock-mode-design.md
git commit -m "Simulate the Discord bot in the dev mock mode

bot.js swaps every function that talks to Discord for dev/mockBot.js.
Roles, channels and scheduled events come from the mock server; DMs,
announcements, role changes and channel creation are logged with the
[MOCK-DISCORD] prefix instead of being sent.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Dummy-Daten, Seed und Reset

**Files:**
- Create: `dev/seedData.js`
- Create: `dev/seed.js`
- Create: `dev/reset.js`
- Modify: `package.json` (Skript `dev:reset`)
- Test: `test/seed.test.js`

**Interfaces:**
- Consumes: `dev/mockGuild.js` → `PERSONAS, MEMBERS, ROLE_ID, CHANNEL_ID, defaultAvatar`; `utils/formFields.js` → `FORM_FIELD_TYPE, formatEntityAnswer`; `dev/mockMode.js` → `IS_MOCK_MODE`; `firebaseAdmin.js` → `db, collection, doc, getDoc, getDocs, writeBatch, setDoc`; `test/helpers.js` → `createTempDir, repoPath, runNode`.
- Produces:
  - `dev/seedData.js` exportiert `buildSeedData(now: Date) -> { [collection]: { [id]: data } }`, `EVENT_ID` (`OPEN, FORM, FULL, ROLE, BIG_FORM, RUNNING, PAST, ARCHIVED, DRAFT`), `SERIES_EVENT_IDS` (3 IDs), `CHECKIN_CODE` (`'DEMO42'`).
  - `dev/seed.js` exportiert `seedIfEmpty(now?) -> Promise<counts|null>`, `resetAndSeed(now?) -> Promise<counts>`, `SEED_COLLECTIONS`. `counts` = `{ events: 12, users: 12, registrations: 32, comments: 6, auditLogs: 10, botMessages: 1, botSettings: 1, maintenanceSettings: 1 }`. Das Laden von `dev/seed.js` ohne `DEV_MOCK=true` wirft einen Fehler.

- [ ] **Step 1: Failing Tests schreiben**

Datei `test/seed.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, repoPath, runNode } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('seed');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'seed.sqlite');

const { seedIfEmpty, resetAndSeed } = require('../dev/seed');
const { EVENT_ID, SERIES_EVENT_IDS, CHECKIN_CODE } = require('../dev/seedData');
const { PERSONAS } = require('../dev/mockGuild');
const { db, collection, doc, getDoc, getDocs, setDoc } = require('../firebaseAdmin');

const EXPECTED_COUNTS = {
    events: 12,
    users: 12,
    registrations: 32,
    comments: 6,
    auditLogs: 10,
    botMessages: 1,
    botSettings: 1,
    maintenanceSettings: 1
};

async function countDocs(name) {
    return (await getDocs(collection(db, name))).size;
}

async function getEvent(id) {
    return (await getDoc(doc(db, 'events', id))).data();
}

async function registrationsOf(eventId) {
    const snapshot = await getDocs(collection(db, 'registrations'));
    return snapshot.docs.map(d => d.data()).filter(registration => registration.eventId === eventId);
}

test('seedIfEmpty fills an empty database', async () => {
    assert.deepEqual(await seedIfEmpty(), EXPECTED_COUNTS);
    for (const [name, expected] of Object.entries(EXPECTED_COUNTS)) {
        assert.equal(await countDocs(name), expected, name);
    }
});

test('seedIfEmpty does not seed twice', async () => {
    assert.equal(await seedIfEmpty(), null);
    assert.equal(await countDocs('events'), EXPECTED_COUNTS.events);
    assert.equal(await countDocs('registrations'), EXPECTED_COUNTS.registrations);
});

test('the seed covers the scenarios of the spec', async () => {
    const now = new Date();

    assert.equal((await getEvent(EVENT_ID.FORM)).formFields.length, 5);
    assert.equal((await getEvent(EVENT_ID.FORM)).approvalMode, 'manual');
    assert.equal((await getEvent(EVENT_ID.BIG_FORM)).formFields.length, 7);
    assert.equal((await getEvent(EVENT_ID.ROLE)).accessMode, 'role-required');
    assert.equal((await getEvent(EVENT_ID.ARCHIVED)).status, 'archived');
    assert.equal((await getEvent(EVENT_ID.DRAFT)).status, 'draft');

    const running = await getEvent(EVENT_ID.RUNNING);
    assert.equal(running.checkinEnabled, true);
    assert.equal(running.checkinCode, CHECKIN_CODE);
    assert.ok(new Date(running.startDate) < now && new Date(running.endDate) > now);

    assert.ok(new Date((await getEvent(EVENT_ID.PAST)).endDate) < now);
    assert.ok(new Date((await getEvent(EVENT_ID.OPEN)).startDate) > now);

    const series = await Promise.all(SERIES_EVENT_IDS.map(getEvent));
    assert.ok(series[0].seriesId && series.every(event => event.seriesId === series[0].seriesId));

    const registrations = (await getDocs(collection(db, 'registrations'))).docs.map(d => d.data());
    for (const status of ['accepted', 'pending', 'waitlisted', 'rejected']) {
        assert.ok(registrations.some(registration => registration.status === status), status);
    }
    assert.ok(registrations.some(registration => registration.source === 'discord'));
    assert.ok(registrations.some(registration => registration.guests.length > 0));
    assert.ok(registrations.some(registration => registration.pendingGuests.length > 0));
    assert.ok(registrations.some(registration => registration.checkedIn));
});

test('the full event is exactly full', async () => {
    const full = await getEvent(EVENT_ID.FULL);
    const registrations = await registrationsOf(EVENT_ID.FULL);
    const occupied = registrations.filter(registration => ['accepted', 'pending'].includes(registration.status)).length;
    assert.equal(occupied, full.maxParticipants);
    assert.ok(registrations.some(registration => registration.status === 'waitlisted'));
});

test('the newcomer persona has no profile yet', async () => {
    const newcomer = PERSONAS.find(persona => persona.isNewcomer);
    assert.equal((await getDoc(doc(db, 'users', newcomer.userId))).exists(), false);
    for (const persona of PERSONAS.filter(p => !p.isNewcomer)) {
        assert.equal((await getDoc(doc(db, 'users', persona.userId))).exists(), true, persona.id);
    }
});

test('resetAndSeed removes own changes and restores the seed', async () => {
    await setDoc(doc(db, 'events', 'my-own-event'), { title: 'Eigenes Event', status: 'active' });
    await setDoc(doc(db, 'events', EVENT_ID.OPEN), { title: 'Überschrieben' });

    assert.deepEqual(await resetAndSeed(), EXPECTED_COUNTS);

    assert.equal((await getDoc(doc(db, 'events', 'my-own-event'))).exists(), false);
    assert.equal((await getEvent(EVENT_ID.OPEN)).title, 'Community-Spieleabend');
    assert.equal(await countDocs('events'), EXPECTED_COUNTS.events);
    assert.equal((await getDoc(doc(db, 'devMeta', 'seed'))).exists(), true);
});

test('the seed refuses to run outside the dev mock mode', () => {
    const result = runNode(`require(${repoPath('dev/seed')})`, { SQLITE_PATH: path.join(tmpDir, 'real.sqlite') });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /nur im Dev-Mock-Modus/);
});
```

- [ ] **Step 2: Tests ausführen, sie müssen fehlschlagen**

Run: `node --test test/seed.test.js`
Expected: FAIL mit `Cannot find module '../dev/seed'`.

- [ ] **Step 3: `dev/seedData.js` anlegen**

```js
/**
 * Dummy data of the dev mock mode.
 *
 * buildSeedData(now) returns every document as { collection: { id: data } }.
 * All dates are relative to `now`, so the events never go stale, and every
 * document has a fixed ID, so seeding is repeatable and links stay stable.
 */
const { PERSONAS, MEMBERS, ROLE_ID, CHANNEL_ID, defaultAvatar } = require('./mockGuild');
const { FORM_FIELD_TYPE, formatEntityAnswer } = require('../utils/formFields');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const EVENT_ID = {
    OPEN: 'dev-event-open',
    FORM: 'dev-event-form',
    FULL: 'dev-event-full',
    ROLE: 'dev-event-role',
    BIG_FORM: 'dev-event-bigform',
    RUNNING: 'dev-event-running',
    PAST: 'dev-event-past',
    ARCHIVED: 'dev-event-archived',
    DRAFT: 'dev-event-draft'
};
const SERIES_ID = 'dev-series-training';
const SERIES_EVENT_IDS = ['dev-event-series-1', 'dev-event-series-2', 'dev-event-series-3'];

/** Check-in code of the running event. */
const CHECKIN_CODE = 'DEMO42';

// Everybody on the mock server, addressable by username (people.lena, ...)
const people = Object.fromEntries([...PERSONAS, ...MEMBERS].map(person => [person.username, person]));

// Five fields -> still fits into a Discord modal
const TOURNAMENT_FORM = [
    { label: 'Ingame-Name', type: FORM_FIELD_TYPE.TEXT, required: true, description: 'So wie er im Spiel angezeigt wird' },
    { label: 'Bevorzugte Rolle', type: FORM_FIELD_TYPE.DROPDOWN, required: true, options: ['Tank', 'Heiler', 'Schaden'] },
    { label: 'Regeln gelesen', type: FORM_FIELD_TYPE.CHECKBOX, required: true, description: 'Bestätige, dass du das Regelwerk kennst' },
    { label: 'Team-Rolle', type: FORM_FIELD_TYPE.ROLE, required: false },
    { label: 'Wunsch-Channel', type: FORM_FIELD_TYPE.CHANNEL, required: false }
];

// Seven fields -> too big for Discord, registration only on the website
const WORKSHOP_FORM = [
    { label: 'Name', type: FORM_FIELD_TYPE.TEXT, required: true },
    { label: 'Streaming-Erfahrung', type: FORM_FIELD_TYPE.DROPDOWN, required: true, options: ['Keine', 'Etwas', 'Viel'] },
    { label: 'Deine Ausrüstung', type: FORM_FIELD_TYPE.TEXTAREA, required: false, description: 'Kamera, Mikrofon, Software …' },
    { label: 'Welche Plattform nutzt du?', type: FORM_FIELD_TYPE.TEXT, required: false },
    { label: 'Mentor-Wunsch', type: FORM_FIELD_TYPE.USER, required: false },
    { label: 'Ansprechpartner', type: FORM_FIELD_TYPE.MENTIONABLE, required: false },
    { label: 'Aufzeichnung erlaubt', type: FORM_FIELD_TYPE.CHECKBOX, required: true }
];

/**
 * Date helpers bound to one reference time.
 *
 * @param {Date} now -> Reference time of the seed.
 * @returns {{ offset: Function, slot: Function }} -> Date helpers.
 */
function createClock(now) {
    return {
        /** ISO date `ms` milliseconds from now (negative = in the past). */
        offset: (ms) => new Date(now.getTime() + ms).toISOString(),
        /** ISO date of the full hour `hour` on the day `days` from now. */
        slot: (days, hour) => {
            const date = new Date(now.getTime() + days * DAY);
            date.setHours(hour, 0, 0, 0);
            return date.toISOString();
        }
    };
}

/**
 * Event document with every field the admin form writes.
 *
 * @param {Object} clock -> Result of createClock().
 * @param {Object} fields -> Fields that differ from the defaults.
 * @returns {Object} -> Event document.
 */
function buildEvent(clock, fields) {
    return {
        title: '',
        description: '',
        maxParticipants: 0,
        accessMode: 'open',
        requiredRoles: [],
        approvalMode: 'instant',
        assignRoleId: '',
        formFields: [],
        startDate: '',
        endDate: '',
        bannerUrl: '',
        category: '',
        status: 'active',
        reminderHours: [],
        checkinMessage: '',
        customBotMessages: {},
        autoCreateChannels: false,
        channelConfig: {},
        allowGuests: true,
        accentColor: '',
        location: null,
        eventStartNotificationSent: false,
        recurring: false,
        recurringInterval: '',
        recurringUntil: '',
        createdAt: clock.offset(-14 * DAY),
        createdBy: people.mori.userId,
        ...fields
    };
}

function buildEvents(clock) {
    const events = {
        [EVENT_ID.OPEN]: buildEvent(clock, {
            title: 'Community-Spieleabend',
            description: 'Gemütlicher Abend mit Party-Games — jeder ist willkommen!\n\n**Ablauf**\n- 19:00 Treffen in der Lobby\n- 19:15 erste Runde\n- ab 21:00 freies Spielen',
            maxParticipants: 20,
            startDate: clock.slot(3, 19),
            endDate: clock.slot(3, 22),
            category: 'Gaming',
            accentColor: '#8b5cf6',
            reminderHours: [{ hours: 24, sent: false }, { hours: 1, sent: false }],
            location: { text: 'Lobby', channelId: CHANNEL_ID.LOBBY, channelType: 'voice' }
        }),
        [EVENT_ID.FORM]: buildEvent(clock, {
            title: 'Turnier: Arena-Cup',
            description: 'Solo-Turnier im K.-o.-System. Anmeldungen werden von der Turnierleitung bestätigt.',
            maxParticipants: 16,
            approvalMode: 'manual',
            formFields: TOURNAMENT_FORM,
            allowGuests: false,
            startDate: clock.slot(7, 18),
            endDate: clock.slot(7, 23),
            category: 'Turnier',
            accentColor: '#f59e0b',
            createdAt: clock.offset(-13 * DAY)
        }),
        [EVENT_ID.FULL]: buildEvent(clock, {
            title: 'Koop-Abend (5 Plätze)',
            description: 'Kleine Runde mit nur fünf Plätzen — wer zu spät kommt, landet auf der Warteliste.',
            maxParticipants: 5,
            startDate: clock.slot(2, 20),
            endDate: clock.slot(2, 23),
            category: 'Gaming'
        }),
        [EVENT_ID.ROLE]: buildEvent(clock, {
            title: 'Raid: Schattenfestung',
            description: 'Nur für Mitglieder mit der Rolle **Raid-Team**.',
            maxParticipants: 10,
            accessMode: 'role-required',
            requiredRoles: [ROLE_ID.RAID_TEAM],
            startDate: clock.slot(5, 20),
            endDate: clock.slot(5, 23),
            category: 'Raid',
            accentColor: '#22c55e',
            location: { text: 'Event-Voice', channelId: CHANNEL_ID.EVENT_VOICE, channelType: 'voice' }
        }),
        [EVENT_ID.BIG_FORM]: buildEvent(clock, {
            title: 'Workshop: Streaming-Setup',
            description: 'Wir richten gemeinsam OBS ein. Das Formular ist zu groß für Discord — Anmeldung nur über die Website.',
            approvalMode: 'manual',
            formFields: WORKSHOP_FORM,
            startDate: clock.slot(10, 18),
            endDate: clock.slot(10, 20),
            category: 'Workshop'
        }),
        [EVENT_ID.RUNNING]: buildEvent(clock, {
            title: 'Live: Speedrun-Marathon',
            description: 'Läuft gerade! Check-in mit dem Code aus dem Stream.',
            maxParticipants: 30,
            startDate: clock.offset(-30 * MINUTE),
            endDate: clock.offset(2 * HOUR),
            category: 'Gaming',
            checkinEnabled: true,
            checkinCode: CHECKIN_CODE,
            checkinMessage: 'Schön, dass du da bist! Viel Spaß beim Marathon.',
            eventStartNotificationSent: true
        }),
        [EVENT_ID.PAST]: buildEvent(clock, {
            title: 'Retro-Spieleabend',
            description: 'Klassiker aus den 90ern.',
            maxParticipants: 12,
            startDate: clock.slot(-7, 19),
            endDate: clock.slot(-7, 22),
            category: 'Gaming',
            reminderHours: [{ hours: 24, sent: true }],
            checkinEnabled: true,
            checkinCode: '481516',
            eventStartNotificationSent: true,
            createdAt: clock.offset(-21 * DAY)
        }),
        [EVENT_ID.ARCHIVED]: buildEvent(clock, {
            title: 'Sommerfest',
            description: 'Unser großes Sommerfest mit Turnier und Verlosung.',
            maxParticipants: 50,
            status: 'archived',
            startDate: clock.slot(-60, 16),
            endDate: clock.slot(-60, 23),
            category: 'Community',
            eventStartNotificationSent: true,
            createdAt: clock.offset(-90 * DAY)
        }),
        [EVENT_ID.DRAFT]: buildEvent(clock, {
            title: 'Entwurf: Halloween-Special',
            description: 'Noch in Planung — Details folgen.',
            status: 'draft',
            startDate: clock.slot(30, 20),
            endDate: clock.slot(30, 23),
            category: 'Community',
            createdAt: clock.offset(-2 * DAY)
        })
    };

    const recurringUntil = clock.slot(15, 19).substring(0, 10);
    SERIES_EVENT_IDS.forEach((id, index) => {
        events[id] = buildEvent(clock, {
            title: 'Wöchentliches Training',
            description: 'Jede Woche zur gleichen Zeit: Aufwärmen, Taktik, Trainingsspiele.',
            maxParticipants: 8,
            startDate: clock.slot(1 + index * 7, 19),
            endDate: clock.slot(1 + index * 7, 21),
            category: 'Training',
            seriesId: SERIES_ID,
            recurring: true,
            recurringInterval: 'weekly',
            recurringUntil,
            createdAt: clock.offset(-10 * DAY)
        });
    });

    return events;
}

function buildUsers(clock) {
    const seeded = [...PERSONAS.filter(persona => !persona.isNewcomer), ...MEMBERS];
    return Object.fromEntries(seeded.map(person => [person.userId, {
        id: person.userId,
        username: person.username,
        displayName: person.displayName,
        avatar: defaultAvatar(person.userId),
        // Dennis turned invitations off -> he must not show up in the guest search
        acceptInvitations: person.username !== 'dennis',
        createdAt: clock.offset(-30 * DAY),
        updatedAt: clock.offset(-30 * DAY)
    }]));
}

/**
 * Registration document in the format of utils/registrationService.js.
 */
function buildRegistration(clock, eventId, person, fields = {}) {
    return {
        eventId,
        userId: person.userId,
        userName: person.displayName,
        status: 'accepted',
        formAnswers: {},
        guests: [],
        pendingGuests: [],
        source: 'web',
        createdAt: clock.offset(-3 * DAY),
        ...fields
    };
}

function buildRegistrations(clock) {
    const { lena, tom, kira, jonas, aylin, ben, chiara, dennis, elif, felix, greta } = people;
    const entry = (key, eventId, person, fields) => [`dev-reg-${key}`, buildRegistration(clock, eventId, person, fields)];
    const checkedIn = (checkedInAt) => ({ checkedIn: true, checkedInAt });
    const tournamentAnswers = (name, role, teamRole = '', channel = '') => ({
        'Ingame-Name': name,
        'Bevorzugte Rolle': role,
        'Regeln gelesen': true,
        'Team-Rolle': teamRole,
        'Wunsch-Channel': channel
    });

    return Object.fromEntries([
        // Open event -> Tom is deliberately not registered, so he can try it
        entry('open-lena', EVENT_ID.OPEN, lena, { createdAt: clock.offset(-5 * DAY) }),
        entry('open-kira', EVENT_ID.OPEN, kira, { source: 'discord', createdAt: clock.offset(-4 * DAY) }),
        entry('open-jonas', EVENT_ID.OPEN, jonas, { guests: [greta.userId] }),
        entry('open-aylin', EVENT_ID.OPEN, aylin, {
            pendingGuests: [{ userId: elif.userId, displayName: elif.displayName, avatar: defaultAvatar(elif.userId), status: 'pending' }],
            createdAt: clock.offset(-1 * DAY)
        }),

        // Tournament with form -> one request per status, Lena can fill in the form herself
        entry('form-kira', EVENT_ID.FORM, kira, {
            status: 'pending',
            formAnswers: tournamentAnswers('KiraX', 'Heiler',
                formatEntityAnswer(FORM_FIELD_TYPE.ROLE, 'Raid-Team', ROLE_ID.RAID_TEAM),
                formatEntityAnswer(FORM_FIELD_TYPE.CHANNEL, 'Event-Voice', CHANNEL_ID.EVENT_VOICE)),
            createdAt: clock.offset(-2 * DAY)
        }),
        entry('form-ben', EVENT_ID.FORM, ben, { source: 'discord', formAnswers: tournamentAnswers('BenTheTank', 'Tank'), createdAt: clock.offset(-4 * DAY) }),
        entry('form-felix', EVENT_ID.FORM, felix, { status: 'rejected', formAnswers: tournamentAnswers('Felix99', 'Schaden'), createdAt: clock.offset(-6 * DAY) }),

        // Full event -> five accepted, two on the waitlist
        entry('full-lena', EVENT_ID.FULL, lena, { createdAt: clock.offset(-6 * DAY) }),
        entry('full-kira', EVENT_ID.FULL, kira, { createdAt: clock.offset(-5 * DAY) }),
        entry('full-jonas', EVENT_ID.FULL, jonas, { createdAt: clock.offset(-5 * DAY) }),
        entry('full-aylin', EVENT_ID.FULL, aylin, { source: 'discord', createdAt: clock.offset(-4 * DAY) }),
        entry('full-dennis', EVENT_ID.FULL, dennis, { createdAt: clock.offset(-3 * DAY) }),
        entry('full-elif', EVENT_ID.FULL, elif, { status: 'waitlisted', createdAt: clock.offset(-1 * DAY) }),
        entry('full-greta', EVENT_ID.FULL, greta, { status: 'waitlisted', createdAt: clock.offset(-12 * HOUR) }),

        // Role event -> Raid-Team members only
        entry('role-ben', EVENT_ID.ROLE, ben),
        entry('role-felix', EVENT_ID.ROLE, felix),
        entry('role-kira', EVENT_ID.ROLE, kira, { source: 'discord' }),

        // Workshop -> web-only form
        entry('bigform-chiara', EVENT_ID.BIG_FORM, chiara, {
            status: 'pending',
            formAnswers: {
                'Name': 'Chiara',
                'Streaming-Erfahrung': 'Etwas',
                'Deine Ausrüstung': 'Webcam, USB-Mikrofon, OBS',
                'Welche Plattform nutzt du?': 'Twitch',
                'Mentor-Wunsch': formatEntityAnswer(FORM_FIELD_TYPE.USER, aylin.displayName, aylin.userId),
                'Ansprechpartner': '',
                'Aufzeichnung erlaubt': true
            }
        }),

        // Running event -> Tom is not checked in yet and can use CHECKIN_CODE
        entry('running-tom', EVENT_ID.RUNNING, tom),
        entry('running-lena', EVENT_ID.RUNNING, lena, checkedIn(clock.offset(-20 * MINUTE))),
        entry('running-kira', EVENT_ID.RUNNING, kira, checkedIn(clock.offset(-15 * MINUTE))),
        entry('running-jonas', EVENT_ID.RUNNING, jonas),

        // Past event with check-ins
        entry('past-lena', EVENT_ID.PAST, lena, checkedIn(clock.slot(-7, 19))),
        entry('past-tom', EVENT_ID.PAST, tom, checkedIn(clock.slot(-7, 19))),
        entry('past-aylin', EVENT_ID.PAST, aylin, checkedIn(clock.slot(-7, 19))),
        entry('past-jonas', EVENT_ID.PAST, jonas),

        // Archived event
        entry('archived-lena', EVENT_ID.ARCHIVED, lena, { createdAt: clock.offset(-70 * DAY) }),
        entry('archived-tom', EVENT_ID.ARCHIVED, tom, { createdAt: clock.offset(-70 * DAY) }),
        entry('archived-kira', EVENT_ID.ARCHIVED, kira, { createdAt: clock.offset(-68 * DAY) }),

        // Series
        entry('series1-lena', SERIES_EVENT_IDS[0], lena),
        entry('series1-ben', SERIES_EVENT_IDS[0], ben),
        entry('series2-lena', SERIES_EVENT_IDS[1], lena)
    ]);
}

function buildComments(clock) {
    const { mori, lena, kira, jonas, ben } = people;
    const comment = (person, eventId, text, createdAt, replyTo = null) => ({
        eventId,
        userId: person.userId,
        userName: person.displayName,
        userAvatar: defaultAvatar(person.userId),
        text,
        isAdmin: person === mori,
        replyTo,
        createdAt
    });

    return {
        'dev-comment-open-1': comment(kira, EVENT_ID.OPEN, 'Freu mich schon! Wer bringt die Snacks mit? 🍕', clock.offset(-2 * DAY)),
        'dev-comment-open-2': comment(jonas, EVENT_ID.OPEN, 'Ich bring Chips mit 🍿', clock.offset(-2 * DAY + 2 * HOUR), 'dev-comment-open-1'),
        'dev-comment-open-3': comment(mori, EVENT_ID.OPEN, 'Start ist pünktlich um 19 Uhr, die Lobby ist 15 Minuten vorher offen.', clock.offset(-1 * DAY)),
        'dev-comment-form-1': comment(ben, EVENT_ID.FORM, 'Darf man als Duo antreten oder nur solo?', clock.offset(-3 * DAY)),
        'dev-comment-form-2': comment(mori, EVENT_ID.FORM, 'Nur solo — die Paarungen werden am Turniertag ausgelost.', clock.offset(-3 * DAY + 3 * HOUR), 'dev-comment-form-1'),
        'dev-comment-running-1': comment(lena, EVENT_ID.RUNNING, 'Stream läuft, kommt rein!', clock.offset(-10 * MINUTE))
    };
}

function buildAuditLogs(clock) {
    const entry = (action, details, targetId, daysAgo) => ({
        action,
        adminId: people.mori.userId,
        details,
        targetId,
        timestamp: clock.offset(-daysAgo * DAY)
    });

    return {
        'dev-audit-01': entry('CREATE_EVENT', 'Created event "Community-Spieleabend"', EVENT_ID.OPEN, 14),
        'dev-audit-02': entry('CREATE_EVENT', 'Created event "Turnier: Arena-Cup"', EVENT_ID.FORM, 13),
        'dev-audit-03': entry('UPDATE_EVENT', 'Updated event "Turnier: Arena-Cup"', EVENT_ID.FORM, 12),
        'dev-audit-04': entry('UPDATE_EVENT_STATUS', 'Changed status to archived', EVENT_ID.ARCHIVED, 55),
        'dev-audit-05': entry('UPDATE_REGISTRATION_STATUS', 'Set status to accepted for user Ben', 'dev-reg-form-ben', 3),
        'dev-audit-06': entry('UPDATE_REGISTRATION_STATUS', 'Set status to rejected for user Felix', 'dev-reg-form-felix', 5),
        'dev-audit-07': entry('EXPORT_REGISTRATIONS', `Exported registrations for event ${EVENT_ID.PAST}`, EVENT_ID.PAST, 6),
        'dev-audit-08': entry('UPDATE_TEMPLATES', 'Updated bot message templates', null, 20),
        'dev-audit-09': entry('UPDATE_BOT_SETTINGS', 'Bot-Zentrale Einstellungen aktualisiert', null, 20),
        'dev-audit-10': entry('UPDATE_MAINTENANCE', 'Wartungseinstellungen aktualisiert', null, 15)
    };
}

function buildSettings(clock) {
    return {
        botMessages: {
            templates: {
                registration: '📋 Hey {user.name}, deine Anfrage für **{event.title}** ist eingegangen. Wir melden uns!',
                accepted: '✅ {user.mention}, du bist bei **{event.title}** dabei! Alle Infos: {event.url}',
                rejected: '❌ Leider hat es für **{event.title}** diesmal nicht geklappt.'
            }
        },
        botSettings: {
            config: {
                statusType: 'online',
                activityType: 'WATCHING',
                activityText: '{events.count} Events | Nächstes: {events.next}',
                dmNotifications: true,
                reminderEnabled: true,
                eventStartNotifications: true,
                autoChannelCreation: true,
                autoUpdatePresence: false,
                autoStatusCalendarEvents: false,
                announceChannel: CHANNEL_ID.ANNOUNCEMENTS,
                welcomeMessage: '',
                updatedAt: clock.offset(-20 * DAY)
            }
        },
        maintenanceSettings: {
            config: {
                warningEnabled: false,
                warningText: '',
                loginDisabled: false,
                registrationDisabled: false,
                plannedMaintenance: false,
                plannedMaintenanceStart: '',
                plannedMaintenanceEnd: '',
                plannedMaintenanceText: '',
                panicMode: false,
                panicActivatedAt: '',
                panicActivatedBy: '',
                updatedAt: clock.offset(-15 * DAY),
                updatedBy: people.mori.userId
            }
        }
    };
}

/**
 * Build the complete dummy data set.
 *
 * @param {Date} [now] -> Reference time; all dates are relative to it.
 * @returns {Object} -> `{ [collection]: { [documentId]: data } }`.
 */
function buildSeedData(now = new Date()) {
    const clock = createClock(now);
    return {
        events: buildEvents(clock),
        users: buildUsers(clock),
        registrations: buildRegistrations(clock),
        comments: buildComments(clock),
        auditLogs: buildAuditLogs(clock),
        ...buildSettings(clock)
    };
}

module.exports = { buildSeedData, EVENT_ID, SERIES_EVENT_IDS, CHECKIN_CODE };
```

- [ ] **Step 4: `dev/seed.js` anlegen**

```js
/**
 * Seeding of the dev mock database.
 *
 * Refuses to load outside the dev mock mode, so the dummy data can never be
 * written into - and a reset never wipe - a real database.
 */
const { IS_MOCK_MODE } = require('./mockMode');

if (!IS_MOCK_MODE) {
    throw new Error('dev/seed.js darf nur im Dev-Mock-Modus (DEV_MOCK=true) geladen werden.');
}

const { db, collection, doc, getDoc, getDocs, writeBatch } = require('../firebaseAdmin');
const { buildSeedData } = require('./seedData');

/** Every collection the seed writes -> wiped completely by resetAndSeed(). */
const SEED_COLLECTIONS = [
    'events',
    'registrations',
    'users',
    'comments',
    'auditLogs',
    'botMessages',
    'botSettings',
    'maintenanceSettings',
    'devMeta'
];

// Marker document -> its existence means the database was seeded
const MARKER_COLLECTION = 'devMeta';
const MARKER_ID = 'seed';

/**
 * Queue all seed documents plus the marker on a write batch.
 *
 * @param {Object} batch -> Result of writeBatch(db).
 * @param {Date} now -> Reference time of the seed.
 * @returns {Object} -> Number of documents per collection (without the marker).
 */
function addSeedToBatch(batch, now) {
    const counts = {};
    for (const [name, documents] of Object.entries(buildSeedData(now))) {
        counts[name] = 0;
        for (const [id, data] of Object.entries(documents)) {
            batch.set(doc(db, name, id), data);
            counts[name]++;
        }
    }
    batch.set(doc(db, MARKER_COLLECTION, MARKER_ID), { seededAt: now.toISOString() });
    return counts;
}

/**
 * Seed the database unless it was seeded before.
 *
 * @param {Date} [now] -> Reference time of the seed.
 * @returns {Promise<Object|null>} -> Counts per collection, null when nothing was written.
 */
async function seedIfEmpty(now = new Date()) {
    const marker = await getDoc(doc(db, MARKER_COLLECTION, MARKER_ID));
    if (marker.exists()) {
        console.log('🌱 Dev-Daten vorhanden — neu anlegen mit: npm run dev:reset');
        return null;
    }

    const batch = writeBatch(db);
    const counts = addSeedToBatch(batch, now);
    await batch.commit();
    console.log('🌱 Dev-Daten angelegt:', counts);
    return counts;
}

/**
 * Wipe every seed collection and write the seed again, in one transaction.
 *
 * @param {Date} [now] -> Reference time of the seed.
 * @returns {Promise<Object>} -> Counts per collection.
 */
async function resetAndSeed(now = new Date()) {
    const batch = writeBatch(db);
    for (const name of SEED_COLLECTIONS) {
        const snapshot = await getDocs(collection(db, name));
        snapshot.forEach(document => batch.delete(document.ref));
    }
    const counts = addSeedToBatch(batch, now);
    await batch.commit();
    return counts;
}

module.exports = { seedIfEmpty, resetAndSeed, SEED_COLLECTIONS };
```

- [ ] **Step 5: Tests ausführen, sie müssen grün sein**

Run: `node --test test/seed.test.js`
Expected: PASS, `# pass 7`, `# fail 0`.

- [ ] **Step 6: `dev/reset.js` anlegen**

```js
/**
 * Entry point of `npm run dev:reset`: wipes the dev database and seeds it
 * again. Works while the dev server is running (SQLite in WAL mode).
 */
process.env.DEV_MOCK = 'true';
require('./mockMode');
const { resetAndSeed } = require('./seed');

resetAndSeed()
    .then((counts) => {
        console.log('✅ Dev-Datenbank zurückgesetzt:', counts);
    })
    .catch((err) => {
        console.error('❌ Reset fehlgeschlagen:', err);
        process.exit(1);
    });
```

- [ ] **Step 7: Skript `dev:reset` in `package.json` ergänzen**

Der `scripts`-Block sieht danach so aus:

```json
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "dev:reset": "node dev/reset.js",
    "test": "node --test \"test/**/*.test.js\""
  },
```

- [ ] **Step 8: Reset manuell prüfen**

Run: `npm run dev:reset`
Expected: Ausgabe enthält `🧪 DEV-MOCK-MODUS aktiv` mit Pfad `...data\dems.dev.sqlite` (bzw. `/data/dems.dev.sqlite`) und `✅ Dev-Datenbank zurückgesetzt: { events: 12, users: 12, registrations: 32, ... }`. Die Datei `data/dems.dev.sqlite` existiert (sie ist über `data/` in `.gitignore` ausgeschlossen, `git status` zeigt sie nicht).

- [ ] **Step 9: Gesamte Suite ausführen**

Run: `npm test`
Expected: PASS, `# pass 19`, `# fail 0`.

- [ ] **Step 10: Commit**

```bash
git add dev/seedData.js dev/seed.js dev/reset.js package.json test/seed.test.js
git commit -m "Add dummy data and a reset for the dev mock database

Twelve events covering every scenario (form, waitlist, role event,
running event with check-in DEMO42, past, archived, draft, series),
users, registrations in all states, comments, audit log and settings.
All dates are relative to now; seeding only happens once, npm run
dev:reset restores the initial state.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Persona-Login, Server-Anbindung und `npm run dev:mock`

**Files:**
- Create: `dev/devAuth.js`
- Create: `dev/start.js`
- Modify: `server.js` (nach `require('dotenv')`, beide Rate-Limiter, Routen-Block)
- Modify: `package.json` (Skript `dev:mock`, `nodemonConfig`)
- Modify: `test/helpers.js` (komplett ersetzen, erweitert um Server-Helfer)
- Modify: `test/mockMode.test.js` (ein Test ergänzen)
- Modify: `README.md`, `.env.example`
- Modify: `docs/superpowers/specs/2026-09-29-dev-mock-mode-design.md` (Rate-Limits)
- Test: `test/devServer.test.js`, `test/noMock.test.js`

**Interfaces:**
- Consumes: `dev/mockMode.js` → `IS_MOCK_MODE`; `dev/mockGuild.js` → `PERSONAS, ROLE_ID, defaultAvatar`; `dev/seed.js` → `seedIfEmpty`; `dev/seedData.js` → `EVENT_ID, CHECKIN_CODE`; `firebaseAdmin.js` → `db, doc, getDoc, setDoc`.
- Produces:
  - Routen im Mock-Modus: `GET /auth/discord` → 302 `/auth/dev-login`; `GET /auth/dev-login` → HTML; `GET /auth/dev-login/:personaId` → 302 `/#events` (oder `/?error=panic_mode`, `/?error=maintenance_login_disabled`, `/?error=server_error`), unbekannte Persona → 404.
  - Session-User: `{ id, username, displayName, avatar, roles, isAdmin, isNewUser }`.
  - `test/helpers.js` exportiert zusätzlich `startServer(entry, env) -> Promise<{ baseUrl, output(), waitForOutput(text), stop() }>` und `createClient(baseUrl) -> { request(path, options), send(method, path, body) }`.

- [ ] **Step 1: `test/helpers.js` um Server-Helfer erweitern**

Datei `test/helpers.js` komplett ersetzen durch:

```js
/**
 * Shared helpers for the node:test suites.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// Variables that would leak the developer's own setup into a test process
const LEAKING_PREFIXES = ['DISCORD_', 'FIREBASE_', 'DEV_'];
const LEAKING_KEYS = ['NODE_ENV', 'SQLITE_PATH', 'SESSION_SECRET', 'ADMIN_RESET_PASSWORD', 'PORT', 'BASE_URL', 'DEBUG_MODE'];

const SERVER_START_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 100;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Create an empty temporary directory.
 *
 * @param {string} prefix -> Name part of the directory.
 * @returns {string} -> Absolute path of the new directory.
 */
function createTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `dems-${prefix}-`));
}

/**
 * Absolute path inside the repository as a JavaScript string literal,
 * ready to be embedded in a snippet passed to runNode().
 *
 * @param {string} relativePath -> Path relative to the repository root.
 * @returns {string} -> Quoted absolute path.
 */
function repoPath(relativePath) {
    return JSON.stringify(path.join(REPO_ROOT, relativePath));
}

/**
 * Copy of process.env without DEMS settings, merged with `env`.
 *
 * @param {Object} env -> Variables the test wants to set.
 * @returns {Object} -> Environment for a child process.
 */
function cleanEnv(env = {}) {
    const base = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !LEAKING_KEYS.includes(key) && !LEAKING_PREFIXES.some(prefix => key.startsWith(prefix))));
    return { ...base, ...env };
}

/**
 * Run a JavaScript snippet in a fresh Node process.
 *
 * The process runs in an empty temp directory, so dotenv finds no .env file
 * and the developer's own configuration cannot influence the result.
 *
 * @param {string} code -> JavaScript to run with `node -e`.
 * @param {Object} env -> Variables to set for the process.
 * @returns {Object} -> spawnSync result with `status`, `stdout`, `stderr`.
 */
function runNode(code, env = {}) {
    return spawnSync(process.execPath, ['-e', code], {
        cwd: createTempDir('run'),
        env: cleanEnv(env),
        encoding: 'utf8',
        timeout: 30000
    });
}

/**
 * Parse the last line of a process output as JSON.
 *
 * @param {string} output -> stdout of a process.
 * @returns {*} -> Parsed value.
 */
function parseLastLine(output) {
    return JSON.parse(output.trim().split('\n').pop());
}

/**
 * Ask the OS for a free TCP port.
 *
 * @returns {Promise<number>} -> Port number.
 */
function getFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

/**
 * Start server.js or dev/start.js as a child process.
 *
 * Resolves once GET /healthz answers. Like runNode(), the process runs in an
 * empty temp directory so a local .env cannot interfere.
 *
 * @param {string} entry -> Entry file relative to the repository root.
 * @param {Object} env -> Extra environment variables.
 * @returns {Promise<Object>} -> `{ baseUrl, output(), waitForOutput(text), stop() }`.
 */
async function startServer(entry, env = {}) {
    const port = await getFreePort();
    const child = spawn(process.execPath, [path.join(REPO_ROOT, entry)], {
        cwd: createTempDir('server'),
        env: cleanEnv({ PORT: String(port), ...env })
    });

    let output = '';
    let exitCode = null;
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('exit', code => { exitCode = code; });

    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    for (;;) {
        if (exitCode !== null) {
            throw new Error(`Server beendet mit Code ${exitCode}:\n${output}`);
        }
        if (Date.now() > deadline) {
            child.kill();
            throw new Error(`Server nicht erreichbar:\n${output}`);
        }
        try {
            if ((await fetch(`${baseUrl}/healthz`)).ok) break;
        } catch {
            // not listening yet
        }
        await sleep(POLL_INTERVAL_MS);
    }

    return {
        baseUrl,
        output: () => output,
        async waitForOutput(text, timeoutMs = 3000) {
            const waitUntil = Date.now() + timeoutMs;
            while (!output.includes(text)) {
                if (Date.now() > waitUntil) {
                    throw new Error(`"${text}" nicht in der Server-Ausgabe:\n${output}`);
                }
                await sleep(50);
            }
        },
        stop: () => new Promise(resolve => {
            if (exitCode !== null) return resolve();
            child.once('exit', () => resolve());
            child.kill();
        })
    };
}

/**
 * Minimal HTTP client with a cookie jar -> behaves like one browser.
 *
 * @param {string} baseUrl -> Base URL of the server.
 * @returns {Object} -> `{ request(path, options), send(method, path, body) }`.
 */
function createClient(baseUrl) {
    const cookies = new Map();

    async function request(pathname, options = {}) {
        const headers = { ...(options.headers || {}) };
        if (cookies.size > 0) {
            headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
        }
        const res = await fetch(baseUrl + pathname, { redirect: 'manual', ...options, headers });
        for (const setCookie of res.headers.getSetCookie()) {
            const [pair] = setCookie.split(';');
            const separator = pair.indexOf('=');
            cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
        return res;
    }

    /** Send a JSON request carrying the CSRF token of the current session. */
    async function send(method, pathname, body) {
        const { token } = await (await request('/api/csrf-token')).json();
        return request(pathname, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    }

    return { request, send };
}

module.exports = {
    REPO_ROOT,
    createTempDir,
    repoPath,
    cleanEnv,
    runNode,
    parseLastLine,
    startServer,
    createClient
};
```

- [ ] **Step 2: Failing Tests schreiben (Mock-Server)**

Datei `test/devServer.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');
const { PERSONAS, ROLE_ID } = require('../dev/mockGuild');
const { EVENT_ID, CHECKIN_CODE } = require('../dev/seedData');

let server;

before(async () => {
    server = await startServer('dev/start.js', {
        DEV_SQLITE_PATH: path.join(createTempDir('dev-server'), 'dev.sqlite')
    });
});

after(() => server.stop());

const personaById = (id) => PERSONAS.find(persona => persona.id === id);

async function loginAs(personaId, client = createClient(server.baseUrl)) {
    const res = await client.request(`/auth/dev-login/${personaId}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/#events');
    return client;
}

async function currentUser(client) {
    return (await client.request('/auth/me')).json();
}

test('the login button leads to the persona page', async () => {
    const client = createClient(server.baseUrl);

    const redirect = await client.request('/auth/discord');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/auth/dev-login');

    const page = await client.request('/auth/dev-login');
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const persona of PERSONAS) {
        assert.ok(html.includes(`/auth/dev-login/${persona.id}`), persona.id);
    }
});

test('the admin persona gets into the admin area', async () => {
    const client = await loginAs('admin');
    const me = await currentUser(client);
    assert.equal(me.id, personaById('admin').userId);
    assert.equal(me.isAdmin, true);
    assert.equal((await client.request('/api/admin/stats')).status, 200);
});

test('the member persona is refused by the admin area', async () => {
    const client = await loginAs('member');
    assert.equal((await currentUser(client)).isAdmin, false);
    assert.equal((await client.request('/api/admin/stats')).status, 403);
});

test('the raider persona carries the Raid-Team role', async () => {
    const me = await currentUser(await loginAs('raider'));
    assert.ok(me.roles.includes(ROLE_ID.RAID_TEAM));
    assert.equal(me.isAdmin, false);
});

test('the newbie persona is a new user on the first login only', async () => {
    const first = await loginAs('newbie');
    assert.equal((await currentUser(first)).isNewUser, true);
    assert.equal((await currentUser(first)).isNewUser, false);

    const second = await loginAs('newbie');
    assert.equal((await currentUser(second)).isNewUser, false);
});

test('a second login in the same browser replaces the persona', async () => {
    const client = await loginAs('admin');
    await loginAs('member', client);

    const me = await currentUser(client);
    assert.equal(me.id, personaById('member').userId);
    assert.equal(me.isAdmin, false);
    assert.equal((await client.request('/api/admin/stats')).status, 403);
});

test('an unknown persona is rejected', async () => {
    const client = createClient(server.baseUrl);
    assert.equal((await client.request('/auth/dev-login/nobody')).status, 404);
    assert.equal(await currentUser(client), null);
});

test('seeded events are served', async () => {
    const res = await createClient(server.baseUrl).request('/api/events');
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.ok(data.some(event => event.id === EVENT_ID.OPEN));
    assert.ok(!data.some(event => event.id === EVENT_ID.DRAFT));
});

test('the routes read the mock Discord server', async () => {
    const admin = await loginAs('admin');
    const roles = await (await admin.request('/api/admin/roles')).json();
    assert.ok(roles.some(role => role.name === 'Raid-Team'));
    const channels = await (await admin.request('/api/admin/channels')).json();
    assert.ok(channels.some(channel => channel.name === 'mod-intern'));
    assert.equal((await (await admin.request('/api/admin/bot/status')).json()).online, true);

    const member = await loginAs('member');
    const options = await (await member.request('/api/events/form-options')).json();
    assert.ok(options.roles.some(role => role.name === 'Raid-Team'));
    assert.ok(!options.roles.some(role => role.name === 'DEMS Bot'));
    assert.ok(!options.channels.some(channel => channel.name === 'mod-intern'));
});

test('announcing an event is logged instead of sent to Discord', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.OPEN}/announce`, { text: 'Heute Abend geht es los!' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).success, true);
    await server.waitForOutput('Heute Abend geht es los!');
    assert.ok(server.output().includes('[MOCK-DISCORD]'));
});

test('starting a draft event works on SQLite', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.DRAFT}/start`);
    assert.equal(res.status, 200);

    const events = await (await admin.request('/api/admin/all-events')).json();
    assert.equal(events.find(event => event.id === EVENT_ID.DRAFT).status, 'active');
});

test('the member persona can check in to the running event', async () => {
    const member = await loginAs('member');
    const wrong = await member.send('POST', `/api/events/${EVENT_ID.RUNNING}/checkin`, { code: '000000' });
    assert.equal(wrong.status, 400);

    const right = await member.send('POST', `/api/events/${EVENT_ID.RUNNING}/checkin`, { code: CHECKIN_CODE });
    assert.equal(right.status, 200);
    assert.equal((await right.json()).success, true);
});

test('the rate limiters do not get in the way during development', async () => {
    const client = createClient(server.baseUrl);
    for (let i = 0; i < 40; i++) {
        assert.equal((await client.request('/auth/me')).status, 200, `request ${i + 1}`);
    }
});

test('members are locked out while login is disabled, admins are not', async () => {
    const admin = await loginAs('admin');
    const enable = await admin.send('PUT', '/api/admin/maintenance', { loginDisabled: true });
    assert.equal(enable.status, 200);

    try {
        const member = await createClient(server.baseUrl).request('/auth/dev-login/member');
        assert.equal(member.headers.get('location'), '/?error=maintenance_login_disabled');
        await loginAs('admin');
    } finally {
        await admin.send('PUT', '/api/admin/maintenance', { loginDisabled: false });
    }
});
```

- [ ] **Step 3: Failing Tests schreiben (ohne Mock-Modus)**

Datei `test/noMock.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

let server;

before(async () => {
    server = await startServer('server.js', {
        SESSION_SECRET: 'no-mock-test-secret',
        SQLITE_PATH: path.join(createTempDir('no-mock'), 'db.sqlite'),
        DISCORD_CLIENT_ID: '123'
    });
});

after(() => server.stop());

test('without DEV_MOCK the login button still goes to Discord', async () => {
    const res = await createClient(server.baseUrl).request('/auth/discord');
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^https:\/\/discord\.com\/api\/oauth2\/authorize\?client_id=123/);
});

test('without DEV_MOCK the persona login does not exist', async () => {
    const client = createClient(server.baseUrl);
    await client.request('/auth/dev-login/admin');
    assert.equal(await (await client.request('/auth/me')).json(), null);
});
```

- [ ] **Step 4: Test für den Einstieg `dev/start.js` ergänzen**

Am Ende von `test/mockMode.test.js` anfügen:

```js
test('dev/start.js refuses to start in production', () => {
    const result = runNode(`require(${repoPath('dev/start.js')})`, { NODE_ENV: 'production' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DEV_MOCK=true ist in Produktion \(NODE_ENV=production\) nicht erlaubt/);
});
```

- [ ] **Step 5: Tests ausführen, sie müssen fehlschlagen**

Run: `node --test test/devServer.test.js test/noMock.test.js test/mockMode.test.js`
Expected: FAIL. `devServer.test.js` scheitert im `before` mit `Server beendet mit Code 1` (`Cannot find module ... dev/start.js`), der neue Test in `mockMode.test.js` scheitert an der fehlenden Meldung. `noMock.test.js` ist bereits grün (Absicherung des Ist-Zustands).

- [ ] **Step 6: `dev/devAuth.js` anlegen**

```js
/**
 * Persona login of the dev mock mode.
 *
 * Mounted in front of routes/auth.js only when DEV_MOCK=true. It replaces the
 * Discord OAuth2 round trip with a page listing the mock personas and creates
 * exactly the session the real OAuth2 callback creates.
 */
const express = require('express');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const { PERSONAS, defaultAvatar } = require('./mockGuild');

const router = express.Router();

/**
 * Escape text for use inside HTML.
 *
 * @param {string} value -> Raw text.
 * @returns {string} -> HTML-safe text.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Render the persona selection page.
 *
 * @returns {string} -> Complete HTML document.
 */
function renderPersonaPage() {
    const personas = PERSONAS.map(persona => `
        <a class="persona" href="/auth/dev-login/${encodeURIComponent(persona.id)}">
            <img src="${escapeHtml(defaultAvatar(persona.userId))}" alt="" width="48" height="48">
            <span>
                <strong>${escapeHtml(persona.displayName)}</strong>
                <small>${escapeHtml(persona.description)}</small>
            </span>
        </a>`).join('');

    return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DEMS Dev-Login</title>
<style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f0f1a; color: #e5e7eb; font-family: system-ui, sans-serif; }
    main { width: min(420px, calc(100% - 32px)); }
    h1 { font-size: 1.4rem; margin: 0 0 4px; }
    p { margin: 0 0 20px; color: #9ca3af; }
    .persona { display: flex; gap: 14px; align-items: center; padding: 12px 14px; margin-bottom: 10px; border-radius: 12px; background: #1c1c2e; border: 1px solid #2e2e48; color: inherit; text-decoration: none; }
    .persona:hover { border-color: #8b5cf6; }
    .persona img { border-radius: 50%; }
    .persona span { display: grid; gap: 2px; }
    small { color: #9ca3af; }
</style>
</head>
<body>
<main>
    <h1>🧪 Dev-Login</h1>
    <p>Mock-Modus — wähle, als wer du dich anmelden willst.</p>
    ${personas}
</main>
</body>
</html>`;
}

/**
 * Read the maintenance settings the same way routes/auth.js does.
 *
 * @returns {Promise<Object|null>} -> Settings, null when none are stored.
 */
async function getMaintenanceSettings() {
    try {
        const snap = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        return snap.exists() ? snap.data() : null;
    } catch {
        return null;
    }
}

/**
 * Create or refresh the users document of a persona.
 *
 * @param {Object} persona -> Persona from dev/mockGuild.js.
 * @param {string} avatar -> Avatar URL to store.
 * @returns {Promise<boolean>} -> True when the profile was created just now.
 */
async function upsertUserProfile(persona, avatar) {
    const userRef = doc(db, 'users', persona.userId);
    const snap = await getDoc(userRef);
    const now = new Date().toISOString();
    const profile = {
        id: persona.userId,
        username: persona.username,
        displayName: persona.displayName,
        avatar,
        updatedAt: now
    };

    if (!snap.exists()) {
        await setDoc(userRef, { ...profile, acceptInvitations: true, createdAt: now });
        return true;
    }
    await setDoc(userRef, { ...snap.data(), ...profile });
    return false;
}

/**
 * GET /auth/discord — the existing login buttons land on the persona page
 */
router.get('/discord', (req, res) => {
    res.redirect('/auth/dev-login');
});

/**
 * GET /auth/dev-login — persona selection
 */
router.get('/dev-login', (req, res) => {
    res.type('html').send(renderPersonaPage());
});

/**
 * GET /auth/dev-login/:personaId — sign in as a persona
 */
router.get('/dev-login/:personaId', async (req, res) => {
    const persona = PERSONAS.find(p => p.id === req.params.personaId);
    if (!persona) {
        return res.status(404).type('text').send('Unbekannte Persona.');
    }

    try {
        const isAdmin = persona.roles.includes(process.env.DISCORD_ADMIN_ROLE_ID);

        // Same maintenance rules as the real OAuth2 callback
        const maintenance = await getMaintenanceSettings();
        if (maintenance && !isAdmin) {
            if (maintenance.panicMode) return res.redirect('/?error=panic_mode');
            if (maintenance.loginDisabled) return res.redirect('/?error=maintenance_login_disabled');
        }

        const avatar = defaultAvatar(persona.userId);
        const isNewUser = await upsertUserProfile(persona, avatar);

        req.session.user = {
            id: persona.userId,
            username: persona.username,
            displayName: persona.displayName,
            avatar,
            roles: [...persona.roles],
            isAdmin,
            isNewUser
        };

        console.log(`🧪 Dev-Login als ${persona.displayName}`);
        res.redirect('/#events');
    } catch (err) {
        console.error('Dev login error:', err);
        res.redirect('/?error=server_error');
    }
});

module.exports = router;
```

- [ ] **Step 7: `dev/start.js` anlegen**

```js
/**
 * Entry point of the dev mock mode (`npm run dev:mock`).
 *
 * Forces the mock environment, seeds the dev database on the first start and
 * then starts the regular server.
 */
process.env.DEV_MOCK = 'true';
require('./mockMode');
const { seedIfEmpty } = require('./seed');

seedIfEmpty()
    .then(() => require('../server'))
    .catch((err) => {
        console.error('❌ Dev-Seed fehlgeschlagen:', err);
        process.exit(1);
    });
```

- [ ] **Step 8: `server.js` anbinden**

a) Direkt nach der Zeile `require('dotenv').config({ quiet: true });` einfügen:

```js
// Dev mock mode (DEV_MOCK=true) -> has to adjust the environment before
// firebaseAdmin.js and bot.js read it (see dev/mockMode.js)
const { IS_MOCK_MODE } = require('./dev/mockMode');
```

b) Im `apiLimiter` nach `legacyHeaders: false` ergänzen, sodass der Block so aussieht:

```js
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    message: { error: 'Zu viele Anfragen. Bitte versuche es später erneut.' },
    standardHeaders: true,
    legacyHeaders: false,
    // Dev mock mode: frequent reloads while developing must not hit the limit
    skip: () => IS_MOCK_MODE
});
```

c) Den `authLimiter` ersetzen durch:

```js
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Zu viele Login-Versuche.' },
    skip: () => IS_MOCK_MODE
});
```

d) Die Zeile

```js
app.use('/auth', require('./routes/auth'));
```

ersetzen durch:

```js
// Dev mock mode: persona login instead of Discord OAuth2 (see dev/devAuth.js)
if (IS_MOCK_MODE) app.use('/auth', require('./dev/devAuth'));
app.use('/auth', require('./routes/auth'));
```

- [ ] **Step 9: `package.json` ergänzen**

`scripts` und `nodemonConfig` sehen danach so aus (`nodemonConfig` als neuer Top-Level-Schlüssel nach `devDependencies`):

```json
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "dev:mock": "nodemon dev/start.js",
    "dev:reset": "node dev/reset.js",
    "test": "node --test \"test/**/*.test.js\""
  },
```

```json
  "nodemonConfig": {
    "ignore": ["data/**", "public/**", "docs/**", "landing/**", "test/**"]
  }
```

- [ ] **Step 10: Tests ausführen, sie müssen grün sein**

Run: `node --test test/devServer.test.js test/noMock.test.js test/mockMode.test.js`
Expected: PASS, `# pass 21`, `# fail 0` (14 + 2 + 5).

- [ ] **Step 11: Gesamte Suite ausführen**

Run: `npm test`
Expected: PASS, `# pass 36`, `# fail 0`.

- [ ] **Step 12: Manuell prüfen**

Run: `npm run dev:mock` (im Hintergrund oder zweitem Terminal)
Expected in der Ausgabe:
- `🧪 DEV-MOCK-MODUS aktiv — kein Discord, kein Firebase, DB: ...dems.dev.sqlite`
- `🌱 Dev-Daten vorhanden — neu anlegen mit: npm run dev:reset` (aus Task 4 geseedet) oder `🌱 Dev-Daten angelegt: {...}`
- `[MOCK-DISCORD] Bot simuliert — verbunden mit "DEMS Dev Server"`
- `🌐 DEMS Server running at http://localhost:3000`

Dann `http://localhost:3000/auth/discord` im Browser öffnen → Persona-Seite. „Mori (Admin)“ anklicken → Event-Liste mit Community-Spieleabend, Koop-Abend, Live: Speedrun-Marathon usw., Admin-Tab sichtbar. Eine Datei unter `public/` speichern → **kein** Neustart; `server.js` speichern → `[nodemon] restarting due to changes...`. Prozess danach beenden.

- [ ] **Step 13: `.env.example` ergänzen**

Am Dateiende anfügen:

```
# Dev-Mock-Modus: DEMS ohne Discord/Firebase mit Dummy-Daten (npm run dev:mock)
# npm run dev:mock setzt DEV_MOCK selbst — hier nur eintragen, wenn du den Modus
# auch mit "npm run dev" willst. Niemals in Produktion: mit NODE_ENV=production
# startet der Server dann nicht.
# DEV_MOCK=true
# Optional: eigener Pfad für die Dev-Datenbank (Standard: ./data/dems.dev.sqlite)
# DEV_SQLITE_PATH=
```

- [ ] **Step 14: README ergänzen**

In `README.md` vor der Überschrift `## 🐳 Docker` einfügen:

````markdown
## 🧪 Dev-Modus mit Dummy-Daten

Zum Entwickeln und Ausprobieren ohne Discord-Token, OAuth und Firebase:

```bash
npm install
npm run dev:mock
```

*   Öffne `http://localhost:3000` und klicke auf „Mit Discord anmelden“. Statt Discord erscheint eine Auswahl von Test-Personas: **Admin**, **Mitglied mit Rolle „Raid-Team“**, **Mitglied ohne Rollen** und ein **Neuling** (erster Login).
*   Die Daten liegen in `data/dems.dev.sqlite`, getrennt von der normalen Datenbank. Beim ersten Start wird sie mit Beispiel-Events (Formular, Warteliste, Rollen-Event, laufendes Event, Serie, Entwurf, Archiv), Anmeldungen, Kommentaren, Audit-Log und Einstellungen gefüllt. Eigene Änderungen bleiben über Neustarts erhalten.
*   `npm run dev:reset` setzt die Dev-Datenbank auf den Ausgangszustand zurück (geht auch bei laufendem Server).
*   Discord ist simuliert: Rollen, Channels und Scheduled Events kommen von einem Fake-Server, DMs, Ankündigungen und Rollenvergaben erscheinen als `[MOCK-DISCORD]` in der Konsole.
*   Check-in-Code des laufenden Beispiel-Events: `DEMO42`. Admin-Reset-Passwort (Panic-Mode, System-Reset): `dev`, sofern in der `.env` nichts anderes steht.
*   Eine `.env` ist nicht nötig. Vorhandene Discord- und Firebase-Werte werden im Dev-Modus ignoriert.
*   Der Dev-Modus lässt sich nicht in Produktion aktivieren: mit `NODE_ENV=production` bricht der Start ab.

Tests: `npm test`
````

- [ ] **Step 15: Spec um die Rate-Limits ergänzen**

In `docs/superpowers/specs/2026-09-29-dev-mock-mode-design.md`, Teil 3, nach dem Absatz „Ohne Mock-Modus existieren die Routen nicht: …“ anfügen:

```markdown
Die Rate-Limits für `/api/` und `/auth/` sind im Mock-Modus abgeschaltet (`skip`), sonst führen häufige Reloads beim Entwickeln des Frontends nach 30 Aufrufen von `/auth/me` zu HTTP 429.
```

und in der Tabelle „Datei-Änderungen“ die Zeile für `server.js` ersetzen durch:

```
| `server.js` | `mockMode` laden, Rate-Limits im Mock-Modus aus, `devAuth` im Mock-Modus einhängen |
```

- [ ] **Step 16: Commit**

```bash
git add dev/devAuth.js dev/start.js server.js package.json test/helpers.js test/mockMode.test.js test/devServer.test.js test/noMock.test.js README.md .env.example docs/superpowers/specs/2026-09-29-dev-mock-mode-design.md
git commit -m "Add the persona login and npm run dev:mock

In the dev mock mode the Discord login buttons lead to a persona page
(admin, Raid-Team member, member, newcomer) that creates the same
session as the OAuth2 callback and respects the maintenance mode.
dev/start.js seeds the dev database on the first start; the rate
limiters are skipped so frequent reloads do not end in HTTP 429.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docker-Dev

**Files:**
- Modify: `Dockerfile` (komplett ersetzen)
- Modify: `compose.yaml` (`build` mit explizitem `target`)
- Create: `compose.dev.yaml`
- Modify: `.dockerignore` (`test/`)
- Modify: `README.md` (Abschnitt Dev-Modus)
- Modify: `.env.example` (`DEMS_DEV_PORT`)

**Interfaces:**
- Consumes: `dev/start.js`, `npm run dev:reset`, `nodemonConfig` aus Task 5.
- Produces: Build-Target `dev` (alle Abhängigkeiten, `NODE_ENV=development`, `CMD npx nodemon --legacy-watch dev/start.js`); Target `runtime` bleibt letzter Stage und Standard. `docker compose -f compose.dev.yaml up --build` startet den Dev-Modus mit Code-Mount auf `${DEMS_DEV_PORT:-3000}`.

- [ ] **Step 1: Prüfen, dass Docker läuft**

Run: `docker info --format '{{.ServerVersion}}'`
Expected: eine Versionsnummer. Falls nicht: Docker Desktop starten und warten.

- [ ] **Step 2: `Dockerfile` ersetzen**

```dockerfile
# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

# ── Build base: Node + build tools ──────────────────────────────────────
# better-sqlite3 ships prebuilt binaries for linux x64/arm64. The build tools
# are only a fallback for platforms without a prebuild and never reach the
# production image.
FROM node:${NODE_VERSION}-bookworm-slim AS build-base
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# ── Stage: production dependencies ──────────────────────────────────────
FROM build-base AS deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ── Stage: dev mock mode (compose.dev.yaml) ─────────────────────────────
# All dependencies incl. nodemon. compose.dev.yaml mounts the source over
# /app; the copy below only makes the image usable on its own.
FROM build-base AS dev
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY . .
ENV NODE_ENV=development \
    PORT=3000
EXPOSE 3000
# Polling watcher: changes on Windows/macOS bind mounts send no inotify events
CMD ["npx", "nodemon", "--legacy-watch", "dev/start.js"]

# ── Stage: production runtime (default target, keep it last) ────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    SQLITE_PATH=/app/data/dems.sqlite

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# SQLite data lives on a volume so it survives container rebuilds
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Run node directly (not via npm) so SIGTERM reaches the graceful shutdown handler
CMD ["node", "server.js"]
```

- [ ] **Step 3: `compose.yaml` auf explizites Target umstellen**

Die Zeile

```yaml
    build: .
```

ersetzen durch:

```yaml
    build:
      context: .
      target: runtime
```

- [ ] **Step 4: `compose.dev.yaml` anlegen**

```yaml
# Dev mock mode: no Discord, no Firebase, dummy data, auto-reload.
# Start: docker compose -f compose.dev.yaml up --build
services:
  dems-dev:
    build:
      context: .
      target: dev
    image: dems:dev
    init: true
    env_file:
      - path: .env
        required: false
    environment:
      NODE_ENV: development
      PORT: 3000
    ports:
      - "${DEMS_DEV_PORT:-3000}:3000"
    volumes:
      - .:/app
      # Keep the Linux node_modules of the image instead of the host's
      - /app/node_modules
      - dems-dev-data:/app/data

volumes:
  dems-dev-data:
```

- [ ] **Step 5: `.dockerignore` ergänzen**

Im Block `# Not needed at runtime` nach `docs/` eine Zeile einfügen:

```
test/
```

- [ ] **Step 6: Produktions-Image prüfen (Standard-Target, Sperre)**

Run:
```bash
docker build -t dems:prod-check .
docker image inspect dems:prod-check --format '{{json .Config.Cmd}} {{.Config.User}}'
docker run --rm -e DEV_MOCK=true -e SESSION_SECRET=x dems:prod-check; echo "exit: $?"
```
Expected: `["node","server.js"] node`, danach die Meldung `❌ DEV_MOCK=true ist in Produktion (NODE_ENV=production) nicht erlaubt. Server wird nicht gestartet.` und `exit: 1`.

- [ ] **Step 7: Dev-Container starten und prüfen**

Run:
```bash
docker compose -f compose.dev.yaml up -d --build
for i in $(seq 1 60); do curl -fsS http://localhost:3000/healthz && break; sleep 2; done
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/auth/discord
curl -s http://localhost:3000/auth/dev-login | grep -c "/auth/dev-login/"
docker compose -f compose.dev.yaml logs dems-dev | grep -E "DEV-MOCK-MODUS|Dev-Daten|MOCK-DISCORD"
```
Expected: `{"status":"ok"}`, `302 http://localhost:3000/auth/dev-login`, `4`, und Log-Zeilen mit `DEV-MOCK-MODUS aktiv ... /app/data/dems.dev.sqlite`, `🌱 Dev-Daten angelegt`, `[MOCK-DISCORD] Bot simuliert`.

- [ ] **Step 8: Auto-Reload und Reset im Container prüfen**

Run (PowerShell auf Windows, Bash analog mit `touch server.js`):
```powershell
(Get-Item server.js).LastWriteTime = Get-Date
Start-Sleep 5
docker compose -f compose.dev.yaml logs --since 30s dems-dev | Select-String "restarting due to changes"
docker compose -f compose.dev.yaml exec dems-dev npm run dev:reset
```
Expected: eine Zeile `[nodemon] restarting due to changes...`, danach `✅ Dev-Datenbank zurückgesetzt: { events: 12, ... }`.

- [ ] **Step 9: Aufräumen**

Run:
```bash
docker compose -f compose.dev.yaml down -v
docker rmi dems:prod-check dems:dev
```
Expected: Container, Volume `..._dems-dev-data` und beide Images entfernt.

- [ ] **Step 10: README um Docker-Dev ergänzen**

In `README.md` im Abschnitt `## 🧪 Dev-Modus mit Dummy-Daten` direkt vor der Zeile `Tests: \`npm test\`` einfügen:

````markdown
### Dev-Modus mit Docker

```bash
docker compose -f compose.dev.yaml up --build
```

*   Der Code wird in den Container gemountet, Änderungen starten den Server automatisch neu (Frontend-Dateien unter `public/` brauchen nur einen Browser-Reload).
*   Die Dev-Datenbank liegt im Volume `dems-dev-data`. Zurücksetzen: `docker compose -f compose.dev.yaml exec dems-dev npm run dev:reset`.
*   Nach Änderungen an den Abhängigkeiten: `docker compose -f compose.dev.yaml up --build -V` (erneuert `node_modules` im Container).
*   Anderer Host-Port: `DEMS_DEV_PORT` in der `.env`.

````

- [ ] **Step 11: `.env.example` um `DEMS_DEV_PORT` ergänzen**

Am Dateiende anfügen:

```
# Docker-Dev: Port auf dem Host (compose.dev.yaml)
# DEMS_DEV_PORT=3000
```

- [ ] **Step 12: Gesamte Suite ausführen**

Run: `npm test`
Expected: PASS, `# pass 36`, `# fail 0`.

- [ ] **Step 13: Commit**

```bash
git add Dockerfile compose.yaml compose.dev.yaml .dockerignore README.md .env.example
git commit -m "Run the dev mock mode in Docker

New dev stage with all dependencies and nodemon in polling mode;
compose.dev.yaml mounts the source, keeps the Linux node_modules in the
container and stores the dev database on its own volume. The production
runtime stays the default target.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
