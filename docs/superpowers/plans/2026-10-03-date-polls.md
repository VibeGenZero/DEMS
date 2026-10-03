# Terminabstimmung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins schlagen Termine vor, Mitglieder stimmen mit „✅ passt“ / „🤔 wenn nötig“ im Web und in Discord ab, die Discord-Nachricht zeigt den Stand live, und der gewählte Termin wird mit einem Klick zum Event — inklusive DM an alle Abstimmenden.

**Architecture:** Reine Regeln in `utils/pollService.js`, Datenbank-Abläufe (unter der bestehenden Sperre mit Schlüssel `poll:<id>`) in `utils/pollStore.js`. Discord-Bausteine und Interaktionen in `bot.js` (Mock-Zwillinge in `dev/mockBot.js`), Live-Aktualisierung über eine zweite Instanz des Bündlers aus `utils/announcementRefresh.js`. Mitglieder-API in `routes/polls.js`, Admin-API in `routes/admin.js`; das Frontend bekommt eine Übersicht, eine Detailseite und Admin-Dialoge.

**Tech Stack:** Node.js ≥ 22, Express 5, discord.js 14, Firestore-API über `firebaseAdmin.js` (SQLite im Dev-Modus), `node:test`, Vanilla-JS-SPA ohne Build, Flatpickr.

**Spec:** `docs/superpowers/specs/2026-10-03-date-polls-design.md`

**Branch:** `feature/date-polls` (von `feature/role-slots`, enthält den Spec-Commit)

## Global Constraints

- Keine neuen npm-Abhängigkeiten. Tests mit `node:test` + `node:assert/strict`, Testfirst (TDD).
- Datenzugriff nur über `firebaseAdmin.js`; filtern/sortieren im Speicher, kein `limit`, Datumswerte als ISO-Strings.
- Alles, was Nutzer sehen, auf Deutsch; Code, Kommentare, Commits, Wiki auf Englisch; Kommentarstil wie `bot.js` (JSDoc, `->`).
- Jeder Route-Handler mit eigenem `try/catch` → `res.status(x).json({ error: '<Deutsch>' })`; Admin-Mutationen rufen `addAuditLog(...)`.
- Neue Discord-Aufrufe nur in exportierten `bot.js`-Helfern mit `if (!isReady) return <neutral>` + `try/catch` und Mock-Zwilling in `dev/mockBot.js`; `flags: MessageFlags.Ephemeral` nur beim ersten Antworten (`reply`/`deferReply`), nie bei `editReply`.
- Interaktionen bestätigen zuerst (`deferReply` / `deferUpdate`), dann `editReply` — Discords 3-Sekunden-Frist.
- Frontend: globale Funktionen für Inline-`onclick`, IDs über `data-*`-Attribute, jeder Wert durch `escapeHtml`, Markdown nur über `renderMarkdownSafe`, `showToast(msg, 'success'|'danger'|'warning'|'info')`, schreibende Requests mit `X-CSRF-TOKEN: csrfToken`, Bestätigungen per Bootstrap-Modal (kein `confirm()`).
- Grenzen: **2–10** Termine, Titel **1–200**, Beschreibung **≤ 5000**, im Embed höchstens **5** Namen pro Termin, Beschreibung im Embed **≤ 1000** Zeichen, höchstens **5** gespeicherte Discord-Nachrichten pro Abstimmung, Debounce **2000 ms**, Scheduler-Intervall **5 min**.
- IDs: Abstimmungs-Termine 8 Hex-Zeichen; Stimmen-Dokument `<pollId>_<userId>`; Sperr-Schlüssel `poll:<pollId>`.
- Commits: englischer Imperativ-Betreff, Begründung im Body, am Ende `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` und `Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7`.
- Große Dateien (`public/js/app.js`, `public/css/style.css`, `bot.js`, `public/index.html`, `routes/admin.js`) nie ganz lesen: mit `grep -n` springen. Die Arbeitsdateien haben CRLF-Zeilenenden — Ersetzungen müssen das berücksichtigen.

## Review Focus

1. **Stimme trifft auf Schließen/Deadline** (Admin schließt, während jemand in Discord klickt; Deadline läuft während der Auswahl ab): Die Stimme wird abgelehnt, nicht still gespeichert. → Task 3, Test `a vote that arrives while the poll is closing is refused`.
2. **Bearbeiten nach Stimmen** (Termin mit Stimmen entfernen oder verschieben): abgelehnt, sonst stimmen Leute für eine Uhrzeit, die es nicht mehr gibt. → Task 1 (`normalizePollInput`), Task 5, Test `a date with votes cannot be removed`.
3. **Discord: Termin von „passt“ nach „wenn nötig“ umsetzen**: Die zuletzt geänderte Auswahl gewinnt (der Termin wandert), statt still bei „passt“ zu bleiben. → Task 6, Test `moving a date to "wenn nötig" removes it from "passt"`.
4. **Doppelt entscheiden** (zweiter Klick auf „Event erstellen“, zwei Admins gleichzeitig): Die zweite Entscheidung wird vor dem Anlegen des Events abgelehnt. → Task 4, Test `a poll can only be turned into an event once`.
5. **Ohne Rolle / Wartung** (Web und Discord): Abstimmen wird mit klarer Meldung verweigert. → Task 5 (`role-restricted polls refuse other members`), Task 6 (`the vote button refuses members without the role`).

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `utils/pollService.js` | **neu** — reine Regeln: Eingabe prüfen, Stimme bereinigen, offen?, Auszählung, Favorit, Rolle, Terminformat |
| `utils/pollStore.js` | **neu** — laden, abstimmen, schließen, entscheiden, löschen, Stimmen eines Users löschen, Scheduler |
| `utils/eventUrl.js` | `buildPollUrl` |
| `utils/announcementRefresh.js` | `notifyPollChanged`, `flushPollRefreshes` |
| `bot.js` | `buildPollEmbed`, `buildPollComponents`, `buildPollVoteReply`, `refreshPollMessages`, `markPollMessagesDeleted`, `editStoredMessages`, Abstimm-Handler, Dispatcher, `replyWithFailure(text)` |
| `dev/mockBot.js` | Mocks `refreshPollMessages`, `markPollMessagesDeleted` |
| `routes/polls.js` | **neu** — Mitglieder-API |
| `routes/admin.js` | Admin-API, `fromPoll` in `POST /events`, `sourcePollId`, Reset-Ziele |
| `routes/user.js` | Account-Löschung löscht Stimmen |
| `server.js` | Router, Scheduler |
| `dev/seedData.js`, `dev/seed.js` | Seed-Abstimmungen |
| `public/index.html`, `public/js/app.js`, `public/css/style.css` | Navigation, Übersicht, Detail, Admin-Dialoge |
| `test/helpers.js` | gemeinsames `createFakeInteraction` |
| `test/pollService.test.js`, `test/pollStore.test.js`, `test/pollComponents.test.js`, `test/pollInteractions.test.js` | **neu** |
| `test/devServer.test.js`, `test/seed.test.js`, `test/slotInteractions.test.js` | erweitert/angepasst |
| `docs/wiki/**`, `updates.json`, `package*.json` | Doku, Release 2.7.0 |

Abweichungen von der Spec (bewusst, klein):
- **Discord-Auswahl:** Die zuletzt geänderte Liste gewinnt — wer einen Termin in „wenn nötig“ auswählt, nimmt ihn aus „passt“ heraus (und umgekehrt). Die Spec-Regel „steht in beiden → passt“ gilt weiter für die API (`normalizeVote`), wird in Discord aber nie erreicht.
- `sourcePollId` wird in `PUT /events/:id` aus dem gespeicherten Event übernommen (das Frontend schickt es nicht mit), statt aus dem Body.
- Die Schleife „gespeicherte Discord-Nachrichten bearbeiten“ wird aus `refreshEventAnnouncements` in `editStoredMessages` herausgezogen und für Abstimmungen wiederverwendet.
- Das Test-Double für Discord-Interaktionen wandert aus `test/slotInteractions.test.js` nach `test/helpers.js` (`createFakeInteraction`) und kann jetzt auch Auswahlmenüs.
- Discord-Abstimmende bekommen wie bei Anmeldungen ein Nutzerprofil (`ensureUserProfile`), damit sie im Web mit Avatar erscheinen.

---
### Task 1: Abstimmungsregeln (`utils/pollService.js`)

**Files:**
- Create: `utils/pollService.js`
- Test: `test/pollService.test.js`

**Interfaces:**
- Consumes: —
- Produces:
  - `POLL_STATUS = { OPEN: 'open', CLOSED: 'closed', DECIDED: 'decided' }`, `MIN_OPTIONS = 2`, `MAX_OPTIONS = 10`
  - `normalizePollInput(raw, existingPoll = null, votes = [], now = new Date()): { poll: { title, description, options, deadline, accessMode, requiredRoles } } | { error }`
  - `normalizeVote(options, raw): { yes: string[], maybe: string[] }`
  - `isPollOpen(poll, now = new Date()): boolean`
  - `canVote(poll, userRoles): boolean`
  - `tallyPoll(poll, votes, usersById = {}): { voterCount, options: [{ optionId, startDate, endDate, yes, maybe, yesVoters: [{ displayName, avatar }], maybeVoters }] }`
  - `rankOptions(tally): Array<tally option>`, `getFavoriteOptionId(tally): string|null`
  - `formatPollOption(option): string` (z. B. `So, 11.10. · 20:00–22:00`)
  - `effectivePollStatus(poll, now = new Date()): 'open'|'closed'|'decided'` (offen mit abgelaufener Deadline → `closed`)

- [ ] **Step 1: Write the failing tests** — `test/pollService.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    POLL_STATUS, normalizePollInput, normalizeVote, isPollOpen, canVote, tallyPoll,
    rankOptions, getFavoriteOptionId, formatPollOption, effectivePollStatus
} = require('../utils/pollService');

const NOW = new Date('2026-10-03T10:00:00.000Z');
const A = { id: 'aaaaaaaa', startDate: '2026-10-11T18:00:00.000Z', endDate: '2026-10-11T20:00:00.000Z' };
const B = { id: 'bbbbbbbb', startDate: '2026-10-12T16:00:00.000Z', endDate: '' };
const C = { id: 'cccccccc', startDate: '2026-10-17T18:00:00.000Z', endDate: '' };
const POLL = { title: 'Raid', status: 'open', deadline: '', accessMode: 'open', requiredRoles: [], options: [A, B, C] };

const input = (fields = {}) => ({
    title: 'Raid-Termin', description: 'Wann passt es?',
    options: [{ startDate: B.startDate }, { startDate: A.startDate, endDate: A.endDate }],
    deadline: '2026-10-09T16:00:00.000Z', ...fields
});

test('a new poll is trimmed, sorted by date and gets option IDs', () => {
    const { poll, error } = normalizePollInput(input({ title: '  Raid-Termin  ' }), null, [], NOW);
    assert.equal(error, undefined);
    assert.equal(poll.title, 'Raid-Termin');
    assert.deepEqual(poll.options.map(o => o.startDate), [A.startDate, B.startDate]);
    assert.ok(poll.options.every(o => /^[0-9a-f]{8}$/.test(o.id)));
    assert.equal(poll.options[0].endDate, A.endDate);
    assert.equal(poll.options[1].endDate, '');
    assert.equal(poll.deadline, '2026-10-09T16:00:00.000Z');
    assert.equal(poll.accessMode, 'open');
});

test('invalid polls are refused with a German message', () => {
    const cases = [
        [input({ title: ' ' }), 'Titel ist erforderlich (max. 200 Zeichen).'],
        [input({ description: 'x'.repeat(5001) }), 'Beschreibung darf maximal 5000 Zeichen lang sein.'],
        [input({ options: [{ startDate: A.startDate }] }), 'Eine Abstimmung braucht 2–10 Termine.'],
        [input({ options: Array.from({ length: 11 }, (_, i) => ({ startDate: `2026-11-${String(i + 1).padStart(2, '0')}T18:00:00.000Z` })) }), 'Eine Abstimmung braucht 2–10 Termine.'],
        [input({ options: [{ startDate: 'kein Datum' }, { startDate: B.startDate }] }), 'Jeder Termin braucht ein gültiges Datum.'],
        [input({ options: [{ startDate: A.startDate, endDate: A.startDate }, { startDate: B.startDate }] }), 'Das Ende eines Termins muss nach dem Beginn liegen.'],
        [input({ options: [{ startDate: '2026-10-01T18:00:00.000Z' }, { startDate: B.startDate }] }), 'Neue oder verschobene Termine müssen in der Zukunft liegen.'],
        [input({ options: [{ startDate: A.startDate }, { startDate: A.startDate }] }), 'Zwei Termine haben denselben Beginn.'],
        [input({ deadline: 'morgen' }), 'Die Deadline ist kein gültiges Datum.'],
        [input({ deadline: '2026-10-02T10:00:00.000Z' }), 'Die Deadline muss in der Zukunft liegen.'],
        [input({ accessMode: 'role-required', requiredRoles: [] }), 'Bitte wähle mindestens eine Rolle aus.']
    ];
    for (const [raw, message] of cases) {
        assert.deepEqual(normalizePollInput(raw, null, [], NOW), { error: message });
    }
});

test('editing keeps option IDs and only allows open polls', () => {
    const raw = { title: 'Raid', options: [A, B, { startDate: '2026-10-20T18:00:00.000Z' }] };
    const { poll } = normalizePollInput(raw, POLL, [], NOW);
    assert.deepEqual(poll.options.map(o => o.id).slice(0, 2), [A.id, B.id]);
    assert.match(poll.options[2].id, /^[0-9a-f]{8}$/);

    assert.deepEqual(
        normalizePollInput(raw, { ...POLL, status: 'closed' }, [], NOW),
        { error: 'Nur offene Abstimmungen können bearbeitet werden.' }
    );
});

test('a date with votes cannot be removed or moved', () => {
    const votes = [{ userId: 'u1', yes: [A.id], maybe: [] }];
    assert.deepEqual(
        normalizePollInput({ title: 'Raid', options: [B, C] }, POLL, votes, NOW),
        { error: 'Der Termin am So, 11.10. · 20:00–22:00 hat bereits Stimmen.' }
    );
    assert.deepEqual(
        normalizePollInput({ title: 'Raid', options: [{ ...A, startDate: '2026-10-11T19:00:00.000Z' }, B] }, POLL, votes, NOW),
        { error: 'Termine mit Stimmen können nicht verschoben werden.' }
    );
    // Without votes both is fine
    assert.equal(normalizePollInput({ title: 'Raid', options: [B, C] }, POLL, [], NOW).error, undefined);
});

test('a vote keeps known dates in date order and "passt" wins over "wenn nötig"', () => {
    assert.deepEqual(
        normalizeVote(POLL.options, { yes: [C.id, 'unknown', A.id, A.id], maybe: [A.id, B.id] }),
        { yes: [A.id, C.id], maybe: [B.id] }
    );
    assert.deepEqual(normalizeVote(POLL.options, null), { yes: [], maybe: [] });
});

test('a poll is open until it is closed or the deadline passes', () => {
    assert.equal(isPollOpen(POLL, NOW), true);
    assert.equal(isPollOpen({ ...POLL, deadline: '2026-10-03T09:00:00.000Z' }, NOW), false);
    assert.equal(isPollOpen({ ...POLL, deadline: '2026-10-03T11:00:00.000Z' }, NOW), true);
    assert.equal(isPollOpen({ ...POLL, status: 'closed' }, NOW), false);
    assert.equal(effectivePollStatus({ ...POLL, deadline: '2026-10-03T09:00:00.000Z' }, NOW), POLL_STATUS.CLOSED);
    assert.equal(effectivePollStatus({ ...POLL, status: 'decided' }, NOW), POLL_STATUS.DECIDED);
    assert.equal(effectivePollStatus(POLL, NOW), POLL_STATUS.OPEN);
});

test('role-restricted polls need one of the roles', () => {
    const restricted = { ...POLL, accessMode: 'role-required', requiredRoles: ['raid'] };
    assert.equal(canVote(restricted, ['member']), false);
    assert.equal(canVote(restricted, ['member', 'raid']), true);
    assert.equal(canVote(POLL, []), true);
});

test('the tally counts votes per date and the favorite wins by passt, then wenn nötig, then date', () => {
    const votes = [
        { userId: 'u1', userName: 'Ana', yes: [A.id, B.id], maybe: [], updatedAt: '1' },
        { userId: 'u2', userName: 'Ben', yes: [B.id], maybe: [A.id], updatedAt: '2' },
        { userId: 'u3', userName: 'Cem', yes: [A.id], maybe: [], updatedAt: '3' }
    ];
    const tally = tallyPoll(POLL, votes, { u1: { displayName: 'Anna', avatar: 'https://cdn.example/a.png' } });

    assert.equal(tally.voterCount, 3);
    assert.deepEqual(tally.options.map(o => [o.yes, o.maybe]), [[2, 1], [2, 0], [0, 0]]);
    assert.deepEqual(tally.options[0].yesVoters, [
        { displayName: 'Anna', avatar: 'https://cdn.example/a.png' },
        { displayName: 'Cem', avatar: '' }
    ]);
    assert.deepEqual(tally.options[0].maybeVoters.map(v => v.displayName), ['Ben']);
    assert.deepEqual(rankOptions(tally).map(o => o.optionId), [A.id, B.id, C.id]);
    assert.equal(getFavoriteOptionId(tally), A.id);
    assert.equal(getFavoriteOptionId(tallyPoll(POLL, [])), null);
});

test('dates are formatted in German with the event time zone', () => {
    assert.equal(formatPollOption(A), 'So, 11.10. · 20:00–22:00');
    assert.equal(formatPollOption(B), 'Mo, 12.10. · 18:00');
    assert.equal(formatPollOption({ startDate: A.startDate, endDate: '2026-10-12T08:00:00.000Z' }), 'So, 11.10. · 20:00 – 12.10. 10:00');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pollService.test.js`
Expected: FAIL with `Cannot find module '../utils/pollService'`.

- [ ] **Step 3: Implement `utils/pollService.js`**

```js
/**
 * Date polls -> pure rules.
 *
 * Validation of the admin input, cleaning of votes, the tally and the
 * favorite. Every function works on plain data, so the rules are tested
 * without a database.
 */
const crypto = require('crypto');

/** Poll lifecycle. */
const POLL_STATUS = { OPEN: 'open', CLOSED: 'closed', DECIDED: 'decided' };

/** Limits of the poll editor. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 5000;
const OPTION_ID_LENGTH = 8;

const TIMEZONE = process.env.TIMEZONE || 'Europe/Berlin';

/**
 * Parse a date value.
 *
 * @param {*} value -> ISO string or anything else.
 * @returns {Date|null} -> The date, or null when it is not a valid date.
 */
function parseDate(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Create an option ID that is not used yet.
 *
 * @param {Set<string>} taken -> IDs already in use.
 * @returns {string} -> New 8 character hex ID.
 */
function generateOptionId(taken) {
    let id;
    do {
        id = crypto.randomUUID().replace(/-/g, '').slice(0, OPTION_ID_LENGTH);
    } while (taken.has(id));
    return id;
}

/**
 * Date parts in the event time zone.
 *
 * @param {Date} date -> The date.
 * @param {Object} options -> Intl.DateTimeFormat options.
 * @returns {Object} -> Parts keyed by type (weekday, day, month, hour, minute).
 */
function dateParts(date, options) {
    const formatter = new Intl.DateTimeFormat('de-DE', { ...options, timeZone: TIMEZONE, hourCycle: 'h23' });
    return Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
}

/**
 * Readable date of a poll option, e.g. "So, 11.10. · 20:00–22:00".
 *
 * @param {Object} option -> `{ startDate, endDate }`.
 * @returns {string} -> German label in the event time zone.
 */
function formatPollOption(option) {
    const start = dateParts(new Date(option.startDate), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    let label = `${start.weekday.replace('.', '')}, ${start.day}.${start.month}. · ${start.hour}:${start.minute}`;
    if (option.endDate) {
        const end = dateParts(new Date(option.endDate), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        label += end.day === start.day && end.month === start.month
            ? `–${end.hour}:${end.minute}`
            : ` – ${end.day}.${end.month}. ${end.hour}:${end.minute}`;
    }
    return label;
}

/**
 * Validate and clean the poll sent by the admin form.
 *
 * Options that already exist keep their ID. An option with votes may not
 * be removed or moved -> people voted for exactly that date.
 *
 * @param {Object} raw -> Request body.
 * @param {Object|null} [existingPoll] -> The stored poll when editing.
 * @param {Array<Object>} [votes] -> Stored votes of the poll when editing.
 * @param {Date} [now] -> Reference time.
 * @returns {{ poll: Object } | { error: string }} -> Clean fields or a German error message.
 */
function normalizePollInput(raw, existingPoll = null, votes = [], now = new Date()) {
    if (existingPoll && existingPoll.status !== POLL_STATUS.OPEN) {
        return { error: 'Nur offene Abstimmungen können bearbeitet werden.' };
    }
    const body = raw || {};

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > TITLE_MAX_LENGTH) return { error: 'Titel ist erforderlich (max. 200 Zeichen).' };
    const description = typeof body.description === 'string' ? body.description : '';
    if (description.length > DESCRIPTION_MAX_LENGTH) return { error: 'Beschreibung darf maximal 5000 Zeichen lang sein.' };

    const rawOptions = Array.isArray(body.options) ? body.options : [];
    if (rawOptions.length < MIN_OPTIONS || rawOptions.length > MAX_OPTIONS) {
        return { error: 'Eine Abstimmung braucht 2–10 Termine.' };
    }

    const existingOptions = existingPoll ? existingPoll.options : [];
    const existingById = new Map(existingOptions.map(option => [option.id, option]));
    const votedIds = new Set(votes.flatMap(vote => [...(vote.yes || []), ...(vote.maybe || [])]));
    const takenIds = new Set(existingById.keys());
    const usedIds = new Set();
    const usedStarts = new Set();
    const options = [];

    for (const rawOption of rawOptions) {
        const start = parseDate(rawOption && rawOption.startDate);
        if (!start) return { error: 'Jeder Termin braucht ein gültiges Datum.' };
        const end = rawOption.endDate ? parseDate(rawOption.endDate) : null;
        if (rawOption.endDate && (!end || end <= start)) {
            return { error: 'Das Ende eines Termins muss nach dem Beginn liegen.' };
        }

        const startIso = start.toISOString();
        const known = typeof rawOption.id === 'string' && existingById.has(rawOption.id) && !usedIds.has(rawOption.id)
            ? existingById.get(rawOption.id)
            : null;
        const moved = !known || known.startDate !== startIso;
        if (known && moved && votedIds.has(known.id)) {
            return { error: 'Termine mit Stimmen können nicht verschoben werden.' };
        }
        if (moved && start <= now) return { error: 'Neue oder verschobene Termine müssen in der Zukunft liegen.' };
        if (usedStarts.has(startIso)) return { error: 'Zwei Termine haben denselben Beginn.' };
        usedStarts.add(startIso);

        const id = known ? known.id : generateOptionId(takenIds);
        takenIds.add(id);
        usedIds.add(id);
        options.push({ id, startDate: startIso, endDate: end ? end.toISOString() : '' });
    }

    for (const old of existingOptions) {
        if (!usedIds.has(old.id) && votedIds.has(old.id)) {
            return { error: `Der Termin am ${formatPollOption(old)} hat bereits Stimmen.` };
        }
    }
    options.sort((a, b) => a.startDate.localeCompare(b.startDate));

    let deadline = '';
    if (body.deadline) {
        const parsed = parseDate(body.deadline);
        if (!parsed) return { error: 'Die Deadline ist kein gültiges Datum.' };
        if (!existingPoll && parsed <= now) return { error: 'Die Deadline muss in der Zukunft liegen.' };
        deadline = parsed.toISOString();
    }

    const accessMode = body.accessMode === 'role-required' ? 'role-required' : 'open';
    const requiredRoles = accessMode === 'role-required' && Array.isArray(body.requiredRoles)
        ? body.requiredRoles.filter(roleId => typeof roleId === 'string' && roleId)
        : [];
    if (accessMode === 'role-required' && requiredRoles.length === 0) {
        return { error: 'Bitte wähle mindestens eine Rolle aus.' };
    }

    return { poll: { title, description, options, deadline, accessMode, requiredRoles } };
}

/**
 * Clean a vote: known dates only, in date order; "passt" wins over "wenn nötig".
 *
 * @param {Array<Object>} options -> Options of the poll.
 * @param {*} raw -> `{ yes, maybe }` from the request.
 * @returns {{ yes: string[], maybe: string[] }} -> Clean vote.
 */
function normalizeVote(options, raw) {
    const yes = new Set(raw && Array.isArray(raw.yes) ? raw.yes : []);
    const maybe = new Set(raw && Array.isArray(raw.maybe) ? raw.maybe : []);
    const ids = options.map(option => option.id);
    return {
        yes: ids.filter(id => yes.has(id)),
        maybe: ids.filter(id => maybe.has(id) && !yes.has(id))
    };
}

/**
 * Whether votes are still accepted.
 *
 * @param {Object} poll -> The poll.
 * @param {Date} [now] -> Reference time.
 * @returns {boolean} -> True while open and before the deadline.
 */
function isPollOpen(poll, now = new Date()) {
    if (!poll || poll.status !== POLL_STATUS.OPEN) return false;
    return !poll.deadline || now < new Date(poll.deadline);
}

/**
 * Status as members see it -> an open poll past its deadline counts as closed.
 *
 * @param {Object} poll -> The poll.
 * @param {Date} [now] -> Reference time.
 * @returns {string} -> One of POLL_STATUS.
 */
function effectivePollStatus(poll, now = new Date()) {
    if (poll.status === POLL_STATUS.OPEN && !isPollOpen(poll, now)) return POLL_STATUS.CLOSED;
    return poll.status;
}

/**
 * Whether a member with these roles may vote.
 *
 * @param {Object} poll -> The poll.
 * @param {string[]} userRoles -> Discord role IDs of the member.
 * @returns {boolean} -> True when the poll is open to everyone or a role matches.
 */
function canVote(poll, userRoles) {
    if (poll.accessMode !== 'role-required' || !Array.isArray(poll.requiredRoles) || poll.requiredRoles.length === 0) return true;
    const roles = Array.isArray(userRoles) ? userRoles : [];
    return poll.requiredRoles.some(roleId => roles.includes(roleId));
}

/**
 * Count the votes per date.
 *
 * @param {Object} poll -> The poll.
 * @param {Array<Object>} votes -> Stored votes.
 * @param {Object} [usersById] -> Profiles for names and avatars.
 * @returns {Object} -> `{ voterCount, options: [...] }` in option order.
 */
function tallyPoll(poll, votes, usersById = {}) {
    const ordered = [...votes].sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
    const describe = (vote) => {
        const profile = usersById[vote.userId] || {};
        return { displayName: profile.displayName || vote.userName || 'Unbekannt', avatar: profile.avatar || '' };
    };
    return {
        voterCount: votes.length,
        options: poll.options.map(option => {
            const yesVoters = ordered.filter(vote => (vote.yes || []).includes(option.id)).map(describe);
            const maybeVoters = ordered.filter(vote => (vote.maybe || []).includes(option.id)).map(describe);
            return {
                optionId: option.id,
                startDate: option.startDate,
                endDate: option.endDate || '',
                yes: yesVoters.length,
                maybe: maybeVoters.length,
                yesVoters,
                maybeVoters
            };
        })
    };
}

/**
 * Options from best to worst: most "passt", then most "wenn nötig", then earliest.
 *
 * @param {Object} tally -> Result of tallyPoll().
 * @returns {Array<Object>} -> Ranked tally options.
 */
function rankOptions(tally) {
    return [...tally.options].sort((a, b) =>
        b.yes - a.yes || b.maybe - a.maybe || a.startDate.localeCompare(b.startDate));
}

/**
 * The current favorite.
 *
 * @param {Object} tally -> Result of tallyPoll().
 * @returns {string|null} -> Option ID, or null while nobody voted for anything.
 */
function getFavoriteOptionId(tally) {
    const [best] = rankOptions(tally);
    return best && best.yes + best.maybe > 0 ? best.optionId : null;
}

module.exports = {
    POLL_STATUS,
    MIN_OPTIONS,
    MAX_OPTIONS,
    normalizePollInput,
    normalizeVote,
    isPollOpen,
    effectivePollStatus,
    canVote,
    tallyPoll,
    rankOptions,
    getFavoriteOptionId,
    formatPollOption
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/pollService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add utils/pollService.js test/pollService.test.js
git commit -m "Add the date poll rules" -m "Poll validation, vote cleaning, the tally and the favorite are pure functions so the web, Discord and the scheduler share one set of rules." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 2: Discord-Nachricht und Live-Aktualisierung der Abstimmung

**Files:**
- Create: `utils/pollStore.js` (erst die Lade-Funktionen)
- Modify: `utils/eventUrl.js`, `utils/announcementRefresh.js`, `bot.js`, `dev/mockBot.js`
- Test: `test/pollComponents.test.js` (neu)

**Interfaces:**
- Consumes: Task 1 (`tallyPoll`, `getFavoriteOptionId`, `formatPollOption`, `isPollOpen`)
- Produces:
  - `buildPollUrl(pollId): string` → `<BASE_URL>/#poll/<id>`
  - `pollStore.loadPoll(pollId): Promise<Object|null>`, `pollStore.loadPollVotes(pollId): Promise<Array>`, `pollStore.loadUserVote(pollId, userId): Promise<{ yes, maybe }>`
  - `notifyPollChanged(pollId)`, `flushPollRefreshes()`
  - `bot.buildPollEmbed(poll, tally)`, `bot.buildPollComponents(poll)`, `bot.buildPollVoteReply(poll, vote, statusLine = '')` → `{ content, components }`
  - `bot.refreshPollMessages(pollId): Promise<boolean>`, `bot.markPollMessagesDeleted(poll): Promise<boolean>` (beide mit Mock)
  - Custom-IDs: `poll_vote:<pollId>`, `poll_yes:<pollId>`, `poll_maybe:<pollId>`
  - interner Helfer `editStoredMessages(announcements, payload): Promise<Array>` (gibt die noch existierenden Nachrichten zurück)

- [ ] **Step 1: Write the failing tests** — `test/pollComponents.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('poll-components');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'poll-components.sqlite');

const bot = require('../bot');
const { db, doc, setDoc } = require('../firebaseAdmin');
const { tallyPoll } = require('../utils/pollService');
const { buildPollUrl } = require('../utils/eventUrl');
const { CHANNEL_ID } = require('../dev/mockGuild');

after(async () => {
    await bot.client.destroy();
});

const A = { id: 'aaaaaaaa', startDate: '2026-10-11T18:00:00.000Z', endDate: '' };
const B = { id: 'bbbbbbbb', startDate: '2026-10-12T16:00:00.000Z', endDate: '' };
const poll = (fields = {}) => ({
    id: 'p1', title: 'Raid-Termin', description: 'Wann passt es?', status: 'open', deadline: '',
    accessMode: 'open', requiredRoles: [], options: [A, B], winnerOptionId: '', eventId: '', ...fields
});
const votes = ['Ana', 'Ben', 'Cem', 'Dan', 'Eva', '*Fee*'].map((name, i) => ({
    userId: `u${i}`, userName: name, yes: [A.id], maybe: i === 0 ? [B.id] : [], updatedAt: String(i)
}));
const fieldsOf = (embed) => embed.toJSON().fields;

async function captureLogs(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.map(String).join(' '));
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines.join('\n');
}

test('poll links open the poll page', () => {
    assert.ok(buildPollUrl('p1').endsWith('/#poll/p1'));
});

test('the open poll embed shows counts, names and the favorite', () => {
    const embed = bot.buildPollEmbed(poll({ deadline: '2026-10-09T16:00:00.000Z' }), tallyPoll(poll(), votes)).toJSON();
    assert.equal(embed.title, '📅 Raid-Termin');
    assert.equal(embed.description, 'Wann passt es?');
    assert.deepEqual(fieldsOf(bot.buildPollEmbed(poll(), tallyPoll(poll(), votes))).map(f => f.name), [
        '🏆 So, 11.10. · 20:00',
        'Mo, 12.10. · 18:00'
    ]);
    const [first, second] = embed.fields;
    assert.equal(first.value, '✅ 6 · 🤔 0\nAna, Ben, Cem, Dan, Eva, +1');
    assert.equal(second.value, '✅ 0 · 🤔 1\n🤔 nur „wenn nötig“');
    assert.equal(embed.footer.text, '⏰ Abstimmung bis Fr, 09.10. · 18:00 · 6 Stimmen');
});

test('names are escaped and empty dates say so', () => {
    const escaped = bot.buildPollEmbed(poll(), tallyPoll(poll(), [votes[5]])).toJSON();
    assert.equal(escaped.fields[0].value, '✅ 1 · 🤔 0\n\\*Fee\\*');
    const empty = bot.buildPollEmbed(poll(), tallyPoll(poll(), [])).toJSON();
    assert.equal(empty.fields[1].value, '✅ 0 · 🤔 0\n— noch keine Stimmen —');
    assert.equal(empty.footer.text, 'Abstimmung offen · 0 Stimmen');
});

test('closed and decided polls change title and buttons', () => {
    const closed = bot.buildPollEmbed(poll({ status: 'closed' }), tallyPoll(poll(), votes)).toJSON();
    assert.equal(closed.title, '🔒 Abstimmung beendet: Raid-Termin');
    assert.equal(closed.footer.text, 'Abstimmung beendet · 6 Stimmen');

    const decided = bot.buildPollEmbed(poll({ status: 'decided', winnerOptionId: B.id, eventId: 'e1' }), tallyPoll(poll(), votes)).toJSON();
    assert.equal(decided.title, '✅ Termin steht: Raid-Termin');
    assert.equal(decided.description, '**Mo, 12.10. · 18:00**');
    assert.equal(decided.fields[1].name, '✅ Mo, 12.10. · 18:00');
});

test('the buttons follow the poll status', () => {
    const buttons = (fields) => bot.buildPollComponents(poll(fields)).flatMap(row => row.toJSON().components);
    const open = buttons({});
    assert.deepEqual(open.map(b => b.label), ['Abstimmen', 'Im Web ansehen']);
    assert.equal(open[0].custom_id, 'poll_vote:p1');
    assert.ok(open[1].url.endsWith('/#poll/p1'));

    assert.deepEqual(buttons({ status: 'closed' }).map(b => b.label), ['Im Web ansehen']);
    assert.deepEqual(buttons({ deadline: '2020-01-01T00:00:00.000Z' }).map(b => b.label), ['Im Web ansehen']);

    const decided = buttons({ status: 'decided', eventId: 'e1' });
    assert.deepEqual(decided.map(b => b.label), ['Zum Event']);
    assert.ok(decided[0].url.endsWith('/#event/e1'));
});

test('the vote answer holds two prefilled selects', () => {
    const reply = bot.buildPollVoteReply(poll(), { yes: [A.id], maybe: [B.id] }, '💾 Gespeichert.');
    assert.equal(reply.flags, undefined);
    assert.ok(reply.content.includes('**Raid-Termin**'));
    assert.ok(reply.content.endsWith('💾 Gespeichert.'));
    const [yes, maybe] = reply.components.map(row => row.toJSON().components[0]);
    assert.equal(yes.custom_id, 'poll_yes:p1');
    assert.equal(maybe.custom_id, 'poll_maybe:p1');
    assert.equal(yes.min_values, 0);
    assert.equal(yes.max_values, 2);
    assert.deepEqual(yes.options.map(o => [o.value, o.default]), [[A.id, true], [B.id, false]]);
    assert.deepEqual(maybe.options.map(o => [o.value, o.default]), [[A.id, false], [B.id, true]]);
    assert.equal(yes.options[0].label, 'So, 11.10. · 20:00');
});

test('posted poll messages are refreshed through the mock', async () => {
    const { id: _id, ...stored } = poll();
    await setDoc(doc(db, 'polls', 'p-refresh'), { ...stored, announcements: [] });
    assert.equal(await bot.refreshPollMessages('p-refresh'), false);

    await setDoc(doc(db, 'polls', 'p-refresh'), {
        ...stored, announcements: [{ channelId: CHANNEL_ID.ANNOUNCEMENTS, messageId: '1' }]
    });
    let refreshed;
    const output = await captureLogs(async () => { refreshed = await bot.refreshPollMessages('p-refresh'); });
    assert.equal(refreshed, true);
    assert.ok(output.includes('Abstimmung "Raid-Termin" aktualisiert'));

    let marked;
    const deletedOutput = await captureLogs(async () => {
        marked = await bot.markPollMessagesDeleted({ title: 'Raid-Termin', announcements: [{ channelId: CHANNEL_ID.ANNOUNCEMENTS, messageId: '1' }] });
    });
    assert.equal(marked, true);
    assert.ok(deletedOutput.includes('Abstimmung "Raid-Termin" als gelöscht markiert'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pollComponents.test.js`
Expected: FAIL (`buildPollUrl is not a function`, `bot.buildPollEmbed is not a function`).

- [ ] **Step 3: Links und Bündler**

`utils/eventUrl.js` — vor `module.exports` einfügen und exportieren (`module.exports = { buildEventUrl, buildPollUrl };`):

```js
/**
 * Build the absolute URL of a poll page.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {string} -> URL that opens the poll in the web interface.
 */
function buildPollUrl(pollId) {
    const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
    return `${baseUrl}/#poll/${pollId}`;
}
```

`utils/announcementRefresh.js` — nach `defaultRefresher` einfügen und in `module.exports` aufnehmen (`notifyPollChanged: pollRefresher.notify, flushPollRefreshes: pollRefresher.flush`):

```js
// Posted poll messages are kept up to date the same way
const pollRefresher = createAnnouncementRefresher({
    refresh: (pollId) => require('../bot').refreshPollMessages(pollId)
});
```

- [ ] **Step 4: Lade-Funktionen — `utils/pollStore.js` anlegen**

```js
/**
 * Date polls -> database flows.
 *
 * Everything that writes a poll or a vote runs under the per-event lock
 * with the key "poll:<id>", so a vote never slips past a closing poll.
 */
const { db, collection, doc, getDoc, getDocs, query, where } = require('../firebaseAdmin');

/** Document ID of a vote -> one vote per member and poll. */
function voteDocId(pollId, userId) {
    return `${pollId}_${userId}`;
}

/**
 * Load a poll.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<Object|null>} -> `{ id, ...data }` or null.
 */
async function loadPoll(pollId) {
    if (!pollId) return null;
    const snap = await getDoc(doc(db, 'polls', pollId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Load every vote of a poll.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<Array<Object>>} -> Votes with their `id`.
 */
async function loadPollVotes(pollId) {
    const snap = await getDocs(query(collection(db, 'pollVotes'), where('pollId', '==', pollId)));
    return snap.docs.map(voteDoc => ({ id: voteDoc.id, ...voteDoc.data() }));
}

/**
 * Load the vote of one member.
 *
 * @param {string} pollId -> The poll document ID.
 * @param {string} userId -> Discord user ID.
 * @returns {Promise<{ yes: string[], maybe: string[] }>} -> The vote, empty when there is none.
 */
async function loadUserVote(pollId, userId) {
    const snap = await getDoc(doc(db, 'pollVotes', voteDocId(pollId, userId)));
    if (!snap.exists()) return { yes: [], maybe: [] };
    const data = snap.data();
    return { yes: data.yes || [], maybe: data.maybe || [] };
}

module.exports = { voteDocId, loadPoll, loadPollVotes, loadUserVote };
```

- [ ] **Step 5: Bausteine in `bot.js`**

1. Imports ergänzen (nach dem `slotService`-Import):
   ```js
   const { tallyPoll, getFavoriteOptionId, formatPollOption, isPollOpen, canVote } = require('./utils/pollService');
   ```
   und den `eventUrl`-Import auf `const { buildEventUrl, buildPollUrl } = require('./utils/eventUrl');` ändern.
2. Konstanten nach `ROSTER_NAMES_MAX` ergänzen:
   ```js
   const POLL_VOTE_PREFIX = 'poll_vote';
   const POLL_YES_PREFIX = 'poll_yes';
   const POLL_MAYBE_PREFIX = 'poll_maybe';
   // Names listed per date in the poll embed
   const POLL_NAMES_MAX = 5;
   const POLL_DESCRIPTION_MAX_LENGTH = 1000;
   ```
3. In `refreshEventAnnouncements` die `for`-Schleife über `announcements` durch `const kept = await editStoredMessages(announcements, { embeds: [embed], components });` ersetzen und **vor** `refreshEventAnnouncements` einfügen:

```js
/**
 * Edit every stored Discord message with the same payload.
 *
 * @param {Array<Object>} announcements -> `[{ channelId, messageId }]`.
 * @param {Object} payload -> Message edit payload.
 * @returns {Promise<Array<Object>>} -> The announcements that still exist.
 */
async function editStoredMessages(announcements, payload) {
    const kept = [];
    for (const announcement of announcements) {
        try {
            const channel = await client.channels.fetch(announcement.channelId);
            const message = await channel.messages.fetch(announcement.messageId);
            await message.edit(payload);
            kept.push(announcement);
        } catch (err) {
            if (isGoneDiscordError(err)) continue;
            console.error('Failed to edit a stored message:', err.message);
            kept.push(announcement);
        }
    }
    return kept;
}
```

4. Nach `refreshEventAnnouncements` einfügen:

```js
/**
 * Build the embed of a date poll.
 *
 * @param {Object} poll -> The poll with its `id`.
 * @param {Object} tally -> Result of tallyPoll().
 * @returns {EmbedBuilder} -> The embed.
 */
function buildPollEmbed(poll, tally) {
    const decided = poll.status === 'decided';
    const closed = !decided && !isPollOpen(poll);
    let title = `📅 ${poll.title}`;
    if (decided) title = `✅ Termin steht: ${poll.title}`;
    else if (closed) title = `🔒 Abstimmung beendet: ${poll.title}`;

    const embed = new EmbedBuilder()
        .setColor(decided ? 0x22c55e : 0x8b5cf6)
        .setTitle(title.substring(0, 256));

    const winner = decided ? poll.options.find(option => option.id === poll.winnerOptionId) : null;
    const description = winner
        ? `**${formatPollOption(winner)}**`
        : (poll.description || '').substring(0, POLL_DESCRIPTION_MAX_LENGTH);
    if (description) embed.setDescription(description);

    const highlightId = decided ? poll.winnerOptionId : getFavoriteOptionId(tally);
    tally.options.forEach(entry => {
        const option = poll.options.find(candidate => candidate.id === entry.optionId);
        let marker = '';
        if (entry.optionId === highlightId) marker = decided ? '✅ ' : '🏆 ';
        embed.addFields({ name: `${marker}${formatPollOption(option)}`, value: `✅ ${entry.yes} · 🤔 ${entry.maybe}\n${formatPollVoters(entry)}`, inline: false });
    });

    const votes = `${tally.voterCount} ${tally.voterCount === 1 ? 'Stimme' : 'Stimmen'}`;
    let footer = `Abstimmung beendet · ${votes}`;
    if (!decided && !closed) {
        footer = poll.deadline
            ? `⏰ Abstimmung bis ${formatPollOption({ startDate: poll.deadline })} · ${votes}`
            : `Abstimmung offen · ${votes}`;
    }
    embed.setFooter({ text: footer });
    return embed;
}

/**
 * Second line of a poll field: the first "passt" names.
 *
 * @param {Object} entry -> Tally option.
 * @returns {string} -> Names, escaped for Discord markdown.
 */
function formatPollVoters(entry) {
    if (entry.yes + entry.maybe === 0) return '— noch keine Stimmen —';
    if (entry.yes === 0) return '🤔 nur „wenn nötig“';
    const names = entry.yesVoters.slice(0, POLL_NAMES_MAX).map(voter => escapeMarkdown(voter.displayName));
    const hidden = entry.yesVoters.length - POLL_NAMES_MAX;
    return hidden > 0 ? `${names.join(', ')}, +${hidden}` : names.join(', ');
}

/**
 * Buttons below a poll message.
 *
 * @param {Object} poll -> The poll with its `id`.
 * @returns {ActionRowBuilder[]} -> One row.
 */
function buildPollComponents(poll) {
    const row = new ActionRowBuilder();
    if (poll.status === 'decided' && poll.eventId) {
        row.addComponents(
            new ButtonBuilder().setLabel('Zum Event').setStyle(ButtonStyle.Link).setURL(buildEventUrl(poll.eventId)).setEmoji('🔗')
        );
        return [row];
    }
    if (isPollOpen(poll)) {
        row.addComponents(
            new ButtonBuilder().setCustomId(`${POLL_VOTE_PREFIX}:${poll.id}`).setLabel('Abstimmen').setStyle(ButtonStyle.Primary).setEmoji('🗳️')
        );
    }
    row.addComponents(
        new ButtonBuilder().setLabel('Im Web ansehen').setStyle(ButtonStyle.Link).setURL(buildPollUrl(poll.id)).setEmoji('🔗')
    );
    return [row];
}

/**
 * Ephemeral voting answer with two prefilled selects.
 *
 * @param {Object} poll -> The poll with its `id`.
 * @param {{ yes: string[], maybe: string[] }} vote -> The member's current vote.
 * @param {string} [statusLine] -> Extra line, e.g. the saved confirmation.
 * @returns {Object} -> `{ content, components }` for reply/editReply.
 */
function buildPollVoteReply(poll, vote, statusLine = '') {
    const select = (prefix, placeholder, selected) => new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${prefix}:${poll.id}`)
            .setPlaceholder(placeholder)
            .setMinValues(0)
            .setMaxValues(poll.options.length)
            .addOptions(poll.options.map(option => ({
                label: formatPollOption(option).substring(0, SELECT_OPTION_LABEL_MAX_LENGTH),
                value: option.id,
                default: selected.includes(option.id)
            })))
    );
    const lines = [`🗳️ **${poll.title}**`, 'Wähle deine Termine – Änderungen werden sofort gespeichert.'];
    if (statusLine) lines.push(statusLine);
    return {
        content: lines.join('\n'),
        components: [
            select(POLL_YES_PREFIX, '✅ Passt mir …', vote.yes || []),
            select(POLL_MAYBE_PREFIX, '🤔 Wenn nötig …', vote.maybe || [])
        ]
    };
}

/**
 * Re-render every posted message of a poll.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<boolean>} -> True when messages were processed.
 */
async function refreshPollMessages(pollId) {
    if (!isReady) return false;
    try {
        const { loadPoll, loadPollVotes } = require('./utils/pollStore');
        const poll = await loadPoll(pollId);
        if (!poll) return false;
        const announcements = Array.isArray(poll.announcements) ? poll.announcements : [];
        if (announcements.length === 0) return false;

        const tally = tallyPoll(poll, await loadPollVotes(pollId));
        const kept = await editStoredMessages(announcements, {
            embeds: [buildPollEmbed(poll, tally)],
            components: buildPollComponents(poll)
        });
        if (kept.length !== announcements.length) {
            await updateDoc(doc(db, 'polls', pollId), { announcements: kept });
        }
        return true;
    } catch (err) {
        console.error('refreshPollMessages failed:', err.message);
        return false;
    }
}

/**
 * Turn the posted messages of a deleted poll into a short notice.
 *
 * @param {Object} poll -> The poll that is being deleted.
 * @returns {Promise<boolean>} -> True when messages were processed.
 */
async function markPollMessagesDeleted(poll) {
    if (!isReady) return false;
    try {
        const announcements = Array.isArray(poll.announcements) ? poll.announcements : [];
        if (announcements.length === 0) return false;
        const embed = new EmbedBuilder()
            .setColor(0x6b7280)
            .setTitle(`🗑️ Abstimmung gelöscht: ${poll.title}`.substring(0, 256))
            .setDescription('Diese Abstimmung wurde von einem Admin gelöscht.');
        await editStoredMessages(announcements, { embeds: [embed], components: [] });
        return true;
    } catch (err) {
        console.error('markPollMessagesDeleted failed:', err.message);
        return false;
    }
}
```

5. `module.exports` ergänzen: `buildPollEmbed, buildPollComponents, buildPollVoteReply, refreshPollMessages, markPollMessagesDeleted`.

- [ ] **Step 6: Mocks in `dev/mockBot.js`** — nach `refreshEventAnnouncements` einfügen und exportieren:

```js
async function refreshPollMessages(pollId) {
    const { loadPoll, loadPollVotes } = require('../utils/pollStore');
    const poll = await loadPoll(pollId);
    if (!poll) return false;
    const announcements = Array.isArray(poll.announcements) ? poll.announcements : [];
    if (announcements.length === 0) return false;

    // Required lazily -> bot.js merges this module into its own exports
    const { buildPollEmbed, buildPollComponents } = require('../bot');
    const { tallyPoll } = require('../utils/pollService');
    const tally = tallyPoll(poll, await loadPollVotes(pollId));
    mockLog(`Abstimmung "${poll.title}" aktualisiert (${announcements.length}×)`, {
        embed: toPayload(buildPollEmbed(poll, tally)),
        components: buildPollComponents(poll).map(toPayload)
    });
    return true;
}

async function markPollMessagesDeleted(poll) {
    const announcements = Array.isArray(poll.announcements) ? poll.announcements : [];
    if (announcements.length === 0) return false;
    mockLog(`Abstimmung "${poll.title}" als gelöscht markiert (${announcements.length}×)`);
    return true;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/pollComponents.test.js test/mockBot.test.js test/eventComponents.test.js && npm test`
Expected: PASS (die bestehenden Live-Ankündigungs-Tests laufen über `editStoredMessages` weiter).

- [ ] **Step 8: Commit**

```bash
git add utils/eventUrl.js utils/announcementRefresh.js utils/pollStore.js bot.js dev/mockBot.js test/pollComponents.test.js
git commit -m "Render date polls in Discord and keep their messages live" -m "A poll message shows the tally per date with names and the favorite and changes with the poll status; posted messages are edited through the same debounced refresher as event announcements." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 3: Abstimmen, Schließen, Entscheiden, Löschen (`utils/pollStore.js`)

**Files:**
- Modify: `utils/pollStore.js`
- Test: `test/pollStore.test.js` (neu)

**Interfaces:**
- Consumes: Task 1 (`normalizeVote`, `isPollOpen`, `canVote`, `tallyPoll`, `getFavoriteOptionId`, `formatPollOption`), Task 2 (`loadPoll`, `loadPollVotes`, `notifyPollChanged`, `buildPollUrl`, `bot.markPollMessagesDeleted`), `withEventLock`, `bot.sendDM`, `buildEventUrl`
- Produces:
  - `POLL_ERROR` und Fehlerobjekte `{ ok: false, code, httpStatus, error }`
  - `savePollVote({ pollId, user: { id, displayName, roles }, yes, maybe, now })` → `{ ok: true, vote }`
  - `closePoll(pollId, { byDeadline = false, now } = {})` → `{ ok: true, poll, changed }`
  - `validateDecision({ pollId, optionId })` → `{ ok: true, poll, option }`
  - `decidePoll({ pollId, optionId, eventId, now })` → `{ ok: true, poll, notified }`
  - `updatePoll(pollId, raw, now)` → `{ ok: true, poll }` (Bearbeiten unter Sperre)
  - `closeExpiredPolls(now)` → Anzahl geschlossener Abstimmungen
  - `deletePoll(pollId)` → `{ ok: true }`
  - `deleteUserPollVotes(userId)` → Anzahl gelöschter Stimmen
  - `startPollScheduler()`, `stopPollScheduler()`

- [ ] **Step 1: Write the failing tests** — `test/pollStore.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('poll-store');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'poll-store.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const {
    loadPoll, loadPollVotes, loadUserVote, savePollVote, closePoll, validateDecision, decidePoll,
    updatePoll, closeExpiredPolls, deletePoll, deleteUserPollVotes
} = require('../utils/pollStore');

after(async () => {
    await bot.client.destroy();
});

const A = { id: 'aaaaaaaa', startDate: '2026-12-11T18:00:00.000Z', endDate: '' };
const B = { id: 'bbbbbbbb', startDate: '2026-12-12T16:00:00.000Z', endDate: '' };
let counter = 0;

async function createPoll(fields = {}) {
    const id = `store-poll-${++counter}`;
    await setDoc(doc(db, 'polls', id), {
        title: `Abstimmung ${counter}`, description: '', status: 'open', deadline: '',
        accessMode: 'open', requiredRoles: [], options: [A, B], winnerOptionId: '', eventId: '',
        announcements: [], createdBy: 'store-admin', createdAt: '2026-10-01T00:00:00.000Z', ...fields
    });
    return id;
}

const user = (name, roles = []) => ({ id: `store-user-${name}`, displayName: name, roles });

async function captureLogs(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.map(String).join(' '));
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines.join('\n');
}

test('a vote is stored, overwritten and removed when empty', async () => {
    const pollId = await createPoll();
    const first = await savePollVote({ pollId, user: user('Ana'), yes: [A.id, 'x'], maybe: [A.id, B.id] });
    assert.deepEqual(first, { ok: true, vote: { yes: [A.id], maybe: [B.id] } });
    assert.deepEqual(await loadUserVote(pollId, user('Ana').id), { yes: [A.id], maybe: [B.id] });

    await savePollVote({ pollId, user: user('Ana'), yes: [B.id], maybe: [] });
    assert.deepEqual(await loadUserVote(pollId, user('Ana').id), { yes: [B.id], maybe: [] });
    assert.equal((await loadPollVotes(pollId)).length, 1);

    await savePollVote({ pollId, user: user('Ana'), yes: [], maybe: [] });
    assert.equal((await loadPollVotes(pollId)).length, 0);
});

test('closed, expired, role-restricted and missing polls refuse votes', async () => {
    const closed = await createPoll({ status: 'closed' });
    const expired = await createPoll({ deadline: '2026-01-01T00:00:00.000Z' });
    const restricted = await createPoll({ accessMode: 'role-required', requiredRoles: ['raid'] });

    const vote = (pollId, voter = user('Ben')) => savePollVote({ pollId, user: voter, yes: [A.id] });
    assert.deepEqual(await vote(closed), { ok: false, code: 'poll_closed', httpStatus: 400, error: 'Die Abstimmung ist beendet.' });
    assert.equal((await vote(expired)).code, 'poll_closed');
    assert.deepEqual(await vote(restricted), { ok: false, code: 'missing_role', httpStatus: 403, error: 'Du hast nicht die erforderliche Rolle für diese Abstimmung.' });
    assert.equal((await vote(restricted, user('Ben', ['raid']))).ok, true);
    assert.deepEqual(await vote('does-not-exist'), { ok: false, code: 'poll_not_found', httpStatus: 404, error: 'Abstimmung nicht gefunden' });
});

test('a vote that arrives while the poll is closing is refused', async () => {
    const pollId = await createPoll();
    const [closing, voting] = await Promise.all([
        closePoll(pollId),
        savePollVote({ pollId, user: user('Cem'), yes: [A.id] })
    ]);
    assert.equal(closing.changed, true);
    assert.equal(voting.code, 'poll_closed');
    assert.equal((await loadPoll(pollId)).status, 'closed');
});

test('closing by deadline tells the creator about the favorite', async () => {
    const pollId = await createPoll({ deadline: '2026-01-01T00:00:00.000Z', title: 'Herbst-Raid' });
    await setDoc(doc(db, 'pollVotes', `${pollId}_v1`), { pollId, userId: 'v1', userName: 'Ana', yes: [B.id], maybe: [], updatedAt: '1' });

    let closedCount;
    const output = await captureLogs(async () => { closedCount = await closeExpiredPolls(new Date('2026-10-03T00:00:00.000Z')); });
    assert.ok(closedCount >= 1);
    assert.equal((await loadPoll(pollId)).status, 'closed');
    assert.ok(output.includes('Die Abstimmung **Herbst-Raid** ist beendet. Favorit: **Sa, 12.12. · 17:00** (✅ 1 · 🤔 0)'));

    const open = await createPoll();
    await closeExpiredPolls(new Date('2026-10-03T00:00:00.000Z'));
    assert.equal((await loadPoll(open)).status, 'open');
});

test('a poll can only be decided once and voters get a DM', async () => {
    const pollId = await createPoll({ title: 'Raid' });
    await savePollVote({ pollId, user: user('Dan'), yes: [A.id] });
    await savePollVote({ pollId, user: user('Eva'), maybe: [A.id] });
    await savePollVote({ pollId, user: user('Fin'), yes: [B.id] });

    assert.deepEqual(await validateDecision({ pollId, optionId: 'nope' }), { ok: false, code: 'option_not_found', httpStatus: 400, error: 'Termin nicht gefunden' });

    let result;
    const output = await captureLogs(async () => { result = await decidePoll({ pollId, optionId: A.id, eventId: 'event-1' }); });
    assert.equal(result.ok, true);
    assert.equal(result.notified, 3);
    const stored = await loadPoll(pollId);
    assert.deepEqual([stored.status, stored.winnerOptionId, stored.eventId], ['decided', A.id, 'event-1']);
    assert.ok(output.includes('Du hattest ✅ *passt* angegeben – jetzt anmelden:'));
    assert.ok(output.includes('Du hattest 🤔 *wenn nötig* angegeben – jetzt anmelden:'));
    assert.ok(output.includes('Er passt dir leider nicht – vielleicht klappt es trotzdem?'));

    assert.equal((await validateDecision({ pollId, optionId: A.id })).error, 'Diese Abstimmung ist bereits entschieden.');
    assert.equal((await decidePoll({ pollId, optionId: A.id, eventId: 'event-2' })).ok, false);
    assert.equal((await validateDecision({ pollId: 'nope', optionId: A.id })).httpStatus, 404);
});

test('editing a poll keeps voted dates', async () => {
    const pollId = await createPoll();
    await savePollVote({ pollId, user: user('Gus'), yes: [A.id] });
    const refused = await updatePoll(pollId, { title: 'Neu', options: [B, { startDate: '2026-12-20T18:00:00.000Z' }] });
    assert.equal(refused.ok, false);
    assert.equal(refused.httpStatus, 400);
    assert.match(refused.error, /hat bereits Stimmen/);

    const saved = await updatePoll(pollId, { title: 'Neu', options: [A, B, { startDate: '2026-12-20T18:00:00.000Z' }] });
    assert.equal(saved.ok, true);
    assert.equal((await loadPoll(pollId)).options.length, 3);
    assert.equal((await loadPoll(pollId)).title, 'Neu');
});

test('deleting a poll removes its votes, deleting an account removes the own votes', async () => {
    const pollId = await createPoll();
    await savePollVote({ pollId, user: user('Hal'), yes: [A.id] });
    assert.deepEqual(await deletePoll(pollId), { ok: true });
    assert.equal(await loadPoll(pollId), null);
    assert.equal((await loadPollVotes(pollId)).length, 0);
    assert.equal((await deletePoll(pollId)).httpStatus, 404);

    const other = await createPoll();
    await savePollVote({ pollId: other, user: user('Ida'), yes: [A.id] });
    assert.equal(await deleteUserPollVotes(user('Ida').id), 1);
    assert.equal((await getDoc(doc(db, 'pollVotes', `${other}_${user('Ida').id}`))).exists(), false);
});
```

Hinweis zur erwarteten Zeit: `2026-12-12T16:00:00.000Z` ist in Berlin (MEZ, UTC+1) 17:00 — deshalb „Sa, 12.12. · 17:00“.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pollStore.test.js`
Expected: FAIL (`savePollVote is not a function`).

- [ ] **Step 3: Implement** — `utils/pollStore.js` vollständig ersetzen:

```js
/**
 * Date polls -> database flows.
 *
 * Everything that writes a poll or a vote runs under the per-event lock
 * with the key "poll:<id>", so a vote never slips past a closing poll.
 * DMs and message refreshes run after the lock is released.
 */
const { db, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, writeBatch } = require('../firebaseAdmin');
const { sendDM, markPollMessagesDeleted } = require('../bot');
const { withEventLock } = require('./eventLock');
const { notifyPollChanged } = require('./announcementRefresh');
const { buildEventUrl, buildPollUrl } = require('./eventUrl');
const {
    POLL_STATUS, normalizePollInput, normalizeVote, isPollOpen, canVote, tallyPoll, getFavoriteOptionId, formatPollOption
} = require('./pollService');

/** Machine readable failure codes. */
const POLL_ERROR = {
    NOT_FOUND: 'poll_not_found',
    CLOSED: 'poll_closed',
    MISSING_ROLE: 'missing_role',
    OPTION_NOT_FOUND: 'option_not_found',
    ALREADY_DECIDED: 'already_decided',
    INVALID: 'invalid_poll'
};

/** HTTP status codes of the failure codes. */
const POLL_ERROR_HTTP_STATUS = {
    [POLL_ERROR.NOT_FOUND]: 404,
    [POLL_ERROR.CLOSED]: 400,
    [POLL_ERROR.MISSING_ROLE]: 403,
    [POLL_ERROR.OPTION_NOT_FOUND]: 400,
    [POLL_ERROR.ALREADY_DECIDED]: 400,
    [POLL_ERROR.INVALID]: 400
};

/** Interval of the deadline check. */
const POLL_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
let pollSchedulerTimer = null;

/**
 * Build a normalized failure result.
 *
 * @param {string} code -> One of POLL_ERROR.
 * @param {string} error -> German message.
 * @returns {Object} -> `{ ok: false, code, httpStatus, error }`.
 */
function pollFailure(code, error) {
    return { ok: false, code, httpStatus: POLL_ERROR_HTTP_STATUS[code] || 400, error };
}

/** Lock key of a poll -> shares the lock map with events without clashing. */
function lockKey(pollId) {
    return `poll:${pollId}`;
}

/** Document ID of a vote -> one vote per member and poll. */
function voteDocId(pollId, userId) {
    return `${pollId}_${userId}`;
}

/**
 * Load a poll.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<Object|null>} -> `{ id, ...data }` or null.
 */
async function loadPoll(pollId) {
    if (!pollId) return null;
    const snap = await getDoc(doc(db, 'polls', pollId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Load every vote of a poll.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<Array<Object>>} -> Votes with their `id`.
 */
async function loadPollVotes(pollId) {
    const snap = await getDocs(query(collection(db, 'pollVotes'), where('pollId', '==', pollId)));
    return snap.docs.map(voteDoc => ({ id: voteDoc.id, ...voteDoc.data() }));
}

/**
 * Load the vote of one member.
 *
 * @param {string} pollId -> The poll document ID.
 * @param {string} userId -> Discord user ID.
 * @returns {Promise<{ yes: string[], maybe: string[] }>} -> The vote, empty when there is none.
 */
async function loadUserVote(pollId, userId) {
    const snap = await getDoc(doc(db, 'pollVotes', voteDocId(pollId, userId)));
    if (!snap.exists()) return { yes: [], maybe: [] };
    const data = snap.data();
    return { yes: data.yes || [], maybe: data.maybe || [] };
}

/**
 * Store, overwrite or remove the vote of a member.
 *
 * @param {Object} params -> Vote input.
 * @param {string} params.pollId -> The poll document ID.
 * @param {Object} params.user -> `{ id, displayName, roles }`.
 * @param {string[]} [params.yes] -> Dates that fit.
 * @param {string[]} [params.maybe] -> Dates that fit if needed.
 * @param {Date} [params.now] -> Reference time.
 * @returns {Promise<Object>} -> `{ ok: true, vote }` or a failure.
 */
async function savePollVote({ pollId, user, yes = [], maybe = [], now = new Date() }) {
    const outcome = await withEventLock(lockKey(pollId), async () => {
        const poll = await loadPoll(pollId);
        if (!poll) return pollFailure(POLL_ERROR.NOT_FOUND, 'Abstimmung nicht gefunden');
        if (!isPollOpen(poll, now)) return pollFailure(POLL_ERROR.CLOSED, 'Die Abstimmung ist beendet.');
        if (!canVote(poll, user.roles || [])) {
            return pollFailure(POLL_ERROR.MISSING_ROLE, 'Du hast nicht die erforderliche Rolle für diese Abstimmung.');
        }

        const vote = normalizeVote(poll.options, { yes, maybe });
        const voteRef = doc(db, 'pollVotes', voteDocId(pollId, user.id));
        if (vote.yes.length === 0 && vote.maybe.length === 0) {
            await deleteDoc(voteRef);
        } else {
            await setDoc(voteRef, { pollId, userId: user.id, userName: user.displayName, ...vote, updatedAt: now.toISOString() });
        }
        return { ok: true, vote };
    });
    if (outcome.ok) notifyPollChanged(pollId);
    return outcome;
}

/**
 * Validate and store an edited poll.
 *
 * @param {string} pollId -> The poll document ID.
 * @param {Object} raw -> Request body.
 * @param {Date} [now] -> Reference time.
 * @returns {Promise<Object>} -> `{ ok: true, poll }` or a failure.
 */
async function updatePoll(pollId, raw, now = new Date()) {
    const outcome = await withEventLock(lockKey(pollId), async () => {
        const poll = await loadPoll(pollId);
        if (!poll) return pollFailure(POLL_ERROR.NOT_FOUND, 'Abstimmung nicht gefunden');
        const result = normalizePollInput(raw, poll, await loadPollVotes(pollId), now);
        if (result.error) return pollFailure(POLL_ERROR.INVALID, result.error);
        const update = { ...result.poll, updatedAt: now.toISOString() };
        await updateDoc(doc(db, 'polls', pollId), update);
        return { ok: true, poll: { ...poll, ...update } };
    });
    if (outcome.ok) notifyPollChanged(pollId);
    return outcome;
}

/**
 * Close a poll. Already closed or decided polls stay as they are.
 *
 * @param {string} pollId -> The poll document ID.
 * @param {Object} [options] -> Close options.
 * @param {boolean} [options.byDeadline] -> Closed by the scheduler -> the creator gets a DM.
 * @param {Date} [options.now] -> Reference time.
 * @returns {Promise<Object>} -> `{ ok: true, poll, changed }` or a failure.
 */
async function closePoll(pollId, { byDeadline = false, now = new Date() } = {}) {
    const outcome = await withEventLock(lockKey(pollId), async () => {
        const poll = await loadPoll(pollId);
        if (!poll) return pollFailure(POLL_ERROR.NOT_FOUND, 'Abstimmung nicht gefunden');
        if (poll.status !== POLL_STATUS.OPEN) return { ok: true, poll, changed: false };
        const update = { status: POLL_STATUS.CLOSED, closedAt: now.toISOString(), updatedAt: now.toISOString() };
        await updateDoc(doc(db, 'polls', pollId), update);
        return { ok: true, poll: { ...poll, ...update }, changed: true };
    });
    if (!outcome.ok || !outcome.changed) return outcome;

    if (byDeadline && outcome.poll.createdBy) {
        await notifyCreatorAboutEnd(outcome.poll);
    }
    notifyPollChanged(pollId);
    return outcome;
}

/**
 * DM to the creator when the deadline closed a poll.
 *
 * @param {Object} poll -> The closed poll.
 * @returns {Promise<void>}
 */
async function notifyCreatorAboutEnd(poll) {
    try {
        const tally = tallyPoll(poll, await loadPollVotes(poll.id));
        const favoriteId = getFavoriteOptionId(tally);
        const link = buildPollUrl(poll.id);
        if (!favoriteId) {
            await sendDM(poll.createdBy, `🗳️ Die Abstimmung **${poll.title}** ist beendet – leider hat niemand abgestimmt. ${link}`);
            return;
        }
        const favorite = tally.options.find(entry => entry.optionId === favoriteId);
        const option = poll.options.find(entry => entry.id === favoriteId);
        await sendDM(poll.createdBy,
            `🗳️ Die Abstimmung **${poll.title}** ist beendet. Favorit: **${formatPollOption(option)}** (✅ ${favorite.yes} · 🤔 ${favorite.maybe}). Jetzt Event erstellen: ${link}`
        );
    } catch (err) {
        console.error('Poll end notification failed:', err.message);
    }
}

/**
 * Check that a poll can be turned into an event with this date.
 *
 * @param {Object} params -> `{ pollId, optionId }`.
 * @returns {Promise<Object>} -> `{ ok: true, poll, option }` or a failure.
 */
async function validateDecision({ pollId, optionId }) {
    const poll = await loadPoll(pollId);
    if (!poll) return pollFailure(POLL_ERROR.NOT_FOUND, 'Abstimmung nicht gefunden');
    if (poll.status === POLL_STATUS.DECIDED) return pollFailure(POLL_ERROR.ALREADY_DECIDED, 'Diese Abstimmung ist bereits entschieden.');
    const option = poll.options.find(entry => entry.id === optionId);
    if (!option) return pollFailure(POLL_ERROR.OPTION_NOT_FOUND, 'Termin nicht gefunden');
    return { ok: true, poll, option };
}

/**
 * Mark a poll as decided and tell every voter.
 *
 * @param {Object} params -> Decision input.
 * @param {string} params.pollId -> The poll document ID.
 * @param {string} params.optionId -> The chosen date.
 * @param {string} params.eventId -> The event created from the date.
 * @param {Date} [params.now] -> Reference time.
 * @returns {Promise<Object>} -> `{ ok: true, poll, notified }` or a failure.
 */
async function decidePoll({ pollId, optionId, eventId, now = new Date() }) {
    const outcome = await withEventLock(lockKey(pollId), async () => {
        const check = await validateDecision({ pollId, optionId });
        if (!check.ok) return check;
        const update = {
            status: POLL_STATUS.DECIDED,
            winnerOptionId: optionId,
            eventId,
            closedAt: check.poll.closedAt || now.toISOString(),
            updatedAt: now.toISOString()
        };
        await updateDoc(doc(db, 'polls', pollId), update);
        return { ok: true, poll: { ...check.poll, ...update }, option: check.option };
    });
    if (!outcome.ok) return outcome;

    const votes = await loadPollVotes(pollId);
    const date = formatPollOption(outcome.option);
    const link = buildEventUrl(eventId);
    for (const vote of votes) {
        let detail = `Er passt dir leider nicht – vielleicht klappt es trotzdem? ${link}`;
        if ((vote.yes || []).includes(optionId)) detail = `Du hattest ✅ *passt* angegeben – jetzt anmelden: ${link}`;
        else if ((vote.maybe || []).includes(optionId)) detail = `Du hattest 🤔 *wenn nötig* angegeben – jetzt anmelden: ${link}`;
        try {
            await sendDM(vote.userId, `📅 Der Termin für **${outcome.poll.title}** steht: **${date}**. ${detail}`);
        } catch (err) {
            console.error('Poll decision DM failed:', err.message);
        }
    }
    notifyPollChanged(pollId);
    return { ok: true, poll: outcome.poll, notified: votes.length };
}

/**
 * Close every open poll whose deadline has passed.
 *
 * @param {Date} [now] -> Reference time.
 * @returns {Promise<number>} -> Number of polls closed now.
 */
async function closeExpiredPolls(now = new Date()) {
    const snap = await getDocs(query(collection(db, 'polls'), where('status', '==', POLL_STATUS.OPEN)));
    let closed = 0;
    for (const pollDoc of snap.docs) {
        const poll = pollDoc.data();
        if (!poll.deadline || new Date(poll.deadline) > now) continue;
        const result = await closePoll(pollDoc.id, { byDeadline: true, now });
        if (result.ok && result.changed) closed += 1;
    }
    return closed;
}

/**
 * Delete a poll with its votes; posted messages become a short notice.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<Object>} -> `{ ok: true }` or a failure.
 */
async function deletePoll(pollId) {
    const poll = await loadPoll(pollId);
    if (!poll) return pollFailure(POLL_ERROR.NOT_FOUND, 'Abstimmung nicht gefunden');
    await markPollMessagesDeleted(poll);

    return withEventLock(lockKey(pollId), async () => {
        const batch = writeBatch(db);
        for (const vote of await loadPollVotes(pollId)) {
            batch.delete(doc(db, 'pollVotes', vote.id));
        }
        batch.delete(doc(db, 'polls', pollId));
        await batch.commit();
        return { ok: true };
    });
}

/**
 * Delete every vote of a member (account deletion).
 *
 * @param {string} userId -> Discord user ID.
 * @returns {Promise<number>} -> Number of deleted votes.
 */
async function deleteUserPollVotes(userId) {
    const snap = await getDocs(query(collection(db, 'pollVotes'), where('userId', '==', userId)));
    if (snap.empty) return 0;
    const batch = writeBatch(db);
    const pollIds = new Set();
    snap.docs.forEach(voteDoc => {
        batch.delete(voteDoc.ref);
        pollIds.add(voteDoc.data().pollId);
    });
    await batch.commit();
    pollIds.forEach(pollId => notifyPollChanged(pollId));
    return snap.size;
}

/**
 * Start the deadline check (independent of the bot's reminder setting).
 *
 * @returns {void}
 */
function startPollScheduler() {
    stopPollScheduler();
    pollSchedulerTimer = setInterval(() => {
        closeExpiredPolls().catch(err => console.error('Poll scheduler failed:', err.message));
    }, POLL_SCHEDULER_INTERVAL_MS);
    if (typeof pollSchedulerTimer.unref === 'function') pollSchedulerTimer.unref();
    console.log('🗳️ Poll scheduler started (checks every 5 min)');
}

/**
 * Stop the deadline check.
 *
 * @returns {void}
 */
function stopPollScheduler() {
    if (pollSchedulerTimer) clearInterval(pollSchedulerTimer);
    pollSchedulerTimer = null;
}

module.exports = {
    POLL_ERROR,
    voteDocId,
    loadPoll,
    loadPollVotes,
    loadUserVote,
    savePollVote,
    updatePoll,
    closePoll,
    validateDecision,
    decidePoll,
    closeExpiredPolls,
    deletePoll,
    deleteUserPollVotes,
    startPollScheduler,
    stopPollScheduler
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/pollStore.test.js && npm test`
Expected: PASS. Falls der Test zur Deadline-DM an der Uhrzeit scheitert: Die Erwartung „Sa, 12.12. · 17:00“ setzt `TIMEZONE` = Europe/Berlin (Default) voraus — die Testumgebung löscht `TIMEZONE` nicht; ist sie lokal gesetzt, den Test mit `TIMEZONE=Europe/Berlin` laufen lassen.

- [ ] **Step 5: Commit**

```bash
git add utils/pollStore.js test/pollStore.test.js
git commit -m "Vote, close, decide and delete date polls" -m "All writes run under the per-poll lock so a vote never slips past a closing poll; deciding tells every voter by DM with a text that matches their vote, and the deadline scheduler runs independent of the reminder setting." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---
### Task 4: Admin-API für Abstimmungen und „Event aus Abstimmung“

**Files:**
- Modify: `routes/admin.js` (neue Routen `/polls…`, `POST /events` mit `fromPoll`, `sourcePollId`, Reset-Ziele)
- Test: `test/devServer.test.js`

**Interfaces:**
- Consumes: Task 1 (`normalizePollInput`, `tallyPoll`), Task 2 (`buildPollEmbed`, `buildPollComponents`), Task 3 (`loadPoll`, `loadPollVotes`, `updatePoll`, `closePoll`, `validateDecision`, `decidePoll`, `deletePoll`)
- Produces:
  - `POST /api/admin/polls` → `{ id, ...poll }` (`CREATE_POLL`)
  - `PUT /api/admin/polls/:id` → `{ id, ...poll }` (`UPDATE_POLL`)
  - `POST /api/admin/polls/:id/close` → `{ success: true }` (`CLOSE_POLL`)
  - `POST /api/admin/polls/:id/announce` → `{ success: true, message }` (`ANNOUNCE_POLL`)
  - `DELETE /api/admin/polls/:id` → `{ success: true }` (`DELETE_POLL`)
  - `POST /api/admin/events` Body-Feld `fromPoll: { pollId, optionId }` → Event mit `sourcePollId`, Abstimmung `decided` (`DECIDE_POLL`)
  - Test-Helfer `futureDate(days, hour)` und `createPollViaApi(admin, title, fields)` in `test/devServer.test.js` (Task 5 nutzt sie)

- [ ] **Step 1: Write the failing tests** — in `test/devServer.test.js` **vor** dem Kommentar `// Keep this test last -> it deletes the newbie persona's account` einfügen:

```js
// ── Date polls ──────────────────────────────────────────────────────────

/** ISO date `days` from now at `hour` UTC. */
function futureDate(days, hour = 18) {
    const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
}

/** Create a date poll with two dates; returns the API response. */
async function createPollViaApi(admin, title, fields = {}) {
    const res = await admin.send('POST', '/api/admin/polls', {
        title, description: 'Wann passt es euch?',
        options: [{ startDate: futureDate(8) }, { startDate: futureDate(9) }],
        ...fields
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
}

test('admins create date polls', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Neue Abstimmung');
    assert.equal(poll.status, 'open');
    assert.equal(poll.options.length, 2);
    assert.ok(poll.options.every(option => /^[0-9a-f]{8}$/.test(option.id)));
    assert.equal(poll.createdBy, personaById('admin').userId);
});

test('invalid date polls are refused with a German message', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/polls', { title: 'Zu wenig', options: [{ startDate: futureDate(8) }] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Eine Abstimmung braucht 2–10 Termine.');
});

test('posting a poll to Discord is logged', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Poster-Abstimmung');
    const res = await admin.send('POST', `/api/admin/polls/${poll.id}/announce`, { text: 'Stimmt ab, Leute!' });
    assert.equal(res.status, 200);
    await server.waitForOutput('Stimmt ab, Leute!');
});

test('a poll can only be turned into an event once', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Event-Abstimmung');
    const [first] = poll.options;
    const body = { title: 'Aus der Abstimmung', status: 'active', startDate: first.startDate, fromPoll: { pollId: poll.id, optionId: first.id } };

    const created = await admin.send('POST', '/api/admin/events', body);
    assert.equal(created.status, 200);
    assert.equal((await created.json()).sourcePollId, poll.id);

    const again = await admin.send('POST', '/api/admin/events', body);
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, 'Diese Abstimmung ist bereits entschieden.');

    const other = await createPollViaApi(admin, 'Falscher Termin');
    const wrong = await admin.send('POST', '/api/admin/events', { ...body, fromPoll: { pollId: other.id, optionId: 'nope' } });
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error, 'Termin nicht gefunden');
});

test('admins close and delete polls', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Weg damit');
    assert.equal((await admin.send('POST', `/api/admin/polls/${poll.id}/close`)).status, 200);
    assert.equal((await admin.send('DELETE', `/api/admin/polls/${poll.id}`)).status, 200);
    assert.equal((await admin.send('DELETE', `/api/admin/polls/${poll.id}`)).status, 404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/devServer.test.js`
Expected: FAIL (`/api/admin/polls` → 404).

- [ ] **Step 3: Implement in `routes/admin.js`**

Imports ergänzen (`bot`-Import um `buildPollEmbed, buildPollComponents` erweitern):

```js
const { normalizePollInput, tallyPoll } = require('../utils/pollService');
const {
    loadPoll, loadPollVotes, updatePoll, closePoll, validateDecision, decidePoll, deletePoll
} = require('../utils/pollStore');
```

Nach `const MAX_TRACKED_ANNOUNCEMENTS = 5;` einfügen:

```js
/**
 * Mark the source poll as decided after an event was created from it.
 *
 * The event already exists at this point -> a failure is only logged.
 *
 * @param {Object|null} fromPoll -> `{ pollId, optionId }` from the request.
 * @param {string} eventId -> The created event (first instance of a series).
 * @param {string} adminId -> Admin who created the event.
 * @returns {Promise<void>}
 */
async function finishPollDecision(fromPoll, eventId, adminId) {
    if (!fromPoll || !eventId) return;
    const result = await decidePoll({ pollId: fromPoll.pollId, optionId: fromPoll.optionId, eventId });
    if (result.ok) {
        await addAuditLog('DECIDE_POLL', adminId, `Decided poll "${result.poll.title}" -> event ${eventId}`, fromPoll.pollId);
    } else {
        console.error('Poll decision after event creation failed:', result.error);
    }
}
```

`POST /events` — direkt nach `const { slots } = slotResult;`:

```js
        // An event can be created from a date poll -> check the poll before anything is written
        const fromPoll = req.body.fromPoll && typeof req.body.fromPoll === 'object' ? req.body.fromPoll : null;
        if (fromPoll) {
            const check = await validateDecision({ pollId: fromPoll.pollId, optionId: fromPoll.optionId });
            if (!check.ok) {
                return res.status(check.httpStatus).json({ error: check.error });
            }
        }
```

In `baseEvent` (Kontext `            slots,\n            accentColor: accentColor || '',\n            location: location || null,\n            eventStartNotificationSent: false,`) nach `slots,` ergänzen: `            sourcePollId: fromPoll ? String(fromPoll.pollId) : '',`.

Im Serien-Zweig vor `res.json({ count: createdEvents.length, events: createdEvents });`: `await finishPollDecision(fromPoll, createdEvents[0]?.id, req.session.user.id);`
Im Einzel-Zweig vor `res.json({ id: ref.id, ...baseEvent });`: `await finishPollDecision(fromPoll, ref.id, req.session.user.id);`

`PUT /events/:id` — `(slots) => ({` im `saveEventWithSlots`-Aufruf zu `(slots, oldEvent) => ({` ändern und im Objekt (Kontext `            slots,\n            accentColor: accentColor || '',\n            location: location || null,\n            recurring: !!req.body.recurring,`) nach `slots,` ergänzen: `            sourcePollId: oldEvent.sourcePollId || '',`.

`DELETE /reset` — im `collections`-Objekt nach `auditLogs: 'auditLogs'` ergänzen: `,\n            polls: 'polls',\n            pollVotes: 'pollVotes'`.

Vor `/**\n * GET /api/admin/bot-messages` einfügen:

```js
// ═══════════════════════════════════════════════
// DATE POLLS
// ═══════════════════════════════════════════════

/**
 * POST /api/admin/polls — Create a date poll
 */
router.post('/polls', async (req, res) => {
    try {
        const result = normalizePollInput(req.body);
        if (result.error) {
            return res.status(400).json({ error: result.error });
        }
        const now = new Date().toISOString();
        const poll = {
            ...result.poll,
            status: 'open',
            winnerOptionId: '',
            eventId: '',
            announcements: [],
            createdBy: req.session.user.id,
            createdAt: now,
            updatedAt: now,
            closedAt: ''
        };
        const ref = await addDoc(collection(db, 'polls'), poll);
        await addAuditLog('CREATE_POLL', req.session.user.id, `Created poll "${poll.title}"`, ref.id);
        res.json({ id: ref.id, ...poll });
    } catch (err) {
        console.error('Create poll error:', err);
        res.status(500).json({ error: 'Fehler beim Erstellen der Abstimmung' });
    }
});

/**
 * PUT /api/admin/polls/:id — Edit an open date poll
 */
router.put('/polls/:id', async (req, res) => {
    try {
        const result = await updatePoll(req.params.id, req.body);
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        await addAuditLog('UPDATE_POLL', req.session.user.id, `Updated poll "${result.poll.title}"`, req.params.id);
        res.json(result.poll);
    } catch (err) {
        console.error('Update poll error:', err);
        res.status(500).json({ error: 'Fehler beim Speichern der Abstimmung' });
    }
});

/**
 * POST /api/admin/polls/:id/close — Close a date poll
 */
router.post('/polls/:id/close', async (req, res) => {
    try {
        const result = await closePoll(req.params.id);
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        await addAuditLog('CLOSE_POLL', req.session.user.id, `Closed poll "${result.poll.title}"`, req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Close poll error:', err);
        res.status(500).json({ error: 'Fehler beim Beenden der Abstimmung' });
    }
});

/**
 * POST /api/admin/polls/:id/announce — Post a date poll to the announcement channel
 */
router.post('/polls/:id/announce', async (req, res) => {
    try {
        const channelId = process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
        if (!channelId) {
            return res.status(400).json({ error: 'DISCORD_ANNOUNCE_CHANNEL_ID nicht konfiguriert in .env' });
        }
        const poll = await loadPoll(req.params.id);
        if (!poll) {
            return res.status(404).json({ error: 'Abstimmung nicht gefunden' });
        }

        const { text, roleIds, pingEveryone } = req.body;
        const tally = tallyPoll(poll, await loadPollVotes(poll.id));
        const sent = await sendChannelMessage(channelId, buildPollEmbed(poll, tally), {
            text: text || '',
            roleIds: Array.isArray(roleIds) ? roleIds : [],
            pingEveryone: !!pingEveryone,
            components: buildPollComponents(poll)
        });
        if (!sent) {
            return res.status(500).json({ error: 'Konnte nicht in den Channel posten.' });
        }

        const announcements = [
            ...(Array.isArray(poll.announcements) ? poll.announcements : []),
            { channelId: sent.channelId, messageId: sent.messageId }
        ].slice(-MAX_TRACKED_ANNOUNCEMENTS);
        await updateDoc(doc(db, 'polls', poll.id), { announcements });
        await addAuditLog('ANNOUNCE_POLL', req.session.user.id, `Announced poll "${poll.title}"`, poll.id);
        res.json({ success: true, message: 'Abstimmung im Discord-Channel gepostet!' });
    } catch (err) {
        console.error('Announce poll error:', err);
        res.status(500).json({ error: 'Fehler beim Posten der Abstimmung' });
    }
});

/**
 * DELETE /api/admin/polls/:id — Delete a date poll with its votes
 */
router.delete('/polls/:id', async (req, res) => {
    try {
        const poll = await loadPoll(req.params.id);
        const result = await deletePoll(req.params.id);
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        await addAuditLog('DELETE_POLL', req.session.user.id, `Deleted poll "${poll ? poll.title : req.params.id}"`, req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete poll error:', err);
        res.status(500).json({ error: 'Fehler beim Löschen der Abstimmung' });
    }
});
```

(Den Anker `/**\n * GET /api/admin/bot-messages` mit `grep -n "GET /api/admin/bot-messages" routes/admin.js` prüfen; falls der Kommentar anders lautet, direkt vor `router.get('/bot-messages'` einfügen.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/devServer.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/admin.js test/devServer.test.js
git commit -m "Let admins manage date polls and create events from them" -m "Admins create, edit, close, post and delete polls; creating an event with fromPoll checks the poll first and then decides it, so a poll cannot be turned into two events." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 5: Mitglieder-API, Server-Anbindung, Account-Löschung

**Files:**
- Create: `routes/polls.js`
- Modify: `server.js`, `routes/user.js`
- Test: `test/devServer.test.js`

**Interfaces:**
- Consumes: Task 1, Task 3 (`loadPoll`, `loadPollVotes`, `savePollVote`, `deleteUserPollVotes`, `startPollScheduler`, `stopPollScheduler`), Task 4 (`createPollViaApi`, `futureDate`)
- Produces:
  - `GET /api/polls` → `[{ id, title, status, deadline, optionCount, voterCount, favorite, myVoteStatus, canVote, eventId, createdAt }]`
  - `GET /api/polls/:id` → `{ ...poll ohne announcements, status (effektiv), tally, favoriteOptionId, myVote, canVote, isOpen }`
  - `PUT /api/polls/:id/vote` Body `{ yes, maybe }` → wie `GET /api/polls/:id`

- [ ] **Step 1: Write the failing tests** — in `test/devServer.test.js` **vor** dem Kommentar `// Keep this test last -> it deletes the newbie persona's account` einfügen:

```js
test('members vote on the web and see the tally', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Web-Abstimmung');
    const [first, second] = poll.options;
    const raider = await loginAs('raider');
    const member = await loginAs('member');

    const res = await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [first.id], maybe: [second.id] });
    assert.equal(res.status, 200);
    const voted = await res.json();
    assert.deepEqual(voted.myVote, { yes: [first.id], maybe: [second.id] });
    assert.deepEqual(voted.tally.options.map(o => [o.yes, o.maybe]), [[1, 0], [0, 1]]);
    assert.equal(voted.tally.options[0].yesVoters[0].displayName, personaById('raider').displayName);
    assert.equal(voted.favoriteOptionId, first.id);
    assert.equal(voted.announcements, undefined);

    const memberList = await (await member.request('/api/polls')).json();
    const entry = memberList.find(item => item.id === poll.id);
    assert.deepEqual([entry.myVoteStatus, entry.canVote, entry.voterCount, entry.status], ['open', true, 1, 'open']);
    const raiderList = await (await raider.request('/api/polls')).json();
    assert.equal(raiderList.find(item => item.id === poll.id).myVoteStatus, 'voted');
});

test('role-restricted polls refuse other members', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Raid-Abstimmung', { accessMode: 'role-required', requiredRoles: [ROLE_ID.RAID_TEAM] });
    const member = await loginAs('member');
    const refused = await member.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).error, 'Du hast nicht die erforderliche Rolle für diese Abstimmung.');
    assert.equal((await (await member.request(`/api/polls/${poll.id}`)).json()).canVote, false);

    const raider = await loginAs('raider');
    assert.equal((await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] })).status, 200);
});

test('closed polls refuse votes', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Geschlossene Abstimmung');
    await admin.send('POST', `/api/admin/polls/${poll.id}/close`);
    const raider = await loginAs('raider');
    const res = await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Die Abstimmung ist beendet.');
    assert.equal((await raider.request('/api/polls/does-not-exist')).status, 404);
});

test('a date with votes cannot be removed', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Bearbeiten-Abstimmung');
    const raider = await loginAs('raider');
    await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });

    const res = await admin.send('PUT', `/api/admin/polls/${poll.id}`, {
        title: poll.title, options: [poll.options[1], { startDate: futureDate(10) }]
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /hat bereits Stimmen/);
});

test('a vote refreshes the posted poll message', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Live-Abstimmung');
    await admin.send('POST', `/api/admin/polls/${poll.id}/announce`, {});
    const raider = await loginAs('raider');
    await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    await server.waitForOutput('Abstimmung "Live-Abstimmung" aktualisiert', 6000);
});

test('deciding a poll tells the voters by DM', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'DM-Abstimmung');
    const raider = await loginAs('raider');
    await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });

    const res = await admin.send('POST', '/api/admin/events', {
        title: 'DM-Event', status: 'active', startDate: poll.options[0].startDate,
        fromPoll: { pollId: poll.id, optionId: poll.options[0].id }
    });
    const event = await res.json();
    await server.waitForOutput('Der Termin für **DM-Abstimmung** steht');

    const decided = await (await raider.request(`/api/polls/${poll.id}`)).json();
    assert.deepEqual([decided.status, decided.eventId, decided.winnerOptionId], ['decided', event.id, poll.options[0].id]);
});

test('deleting an account removes the own poll votes', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Konto-Abstimmung');
    const newbie = await loginAs('newbie');
    await newbie.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    assert.equal((await (await admin.request(`/api/polls/${poll.id}`)).json()).tally.voterCount, 1);

    assert.equal((await newbie.send('DELETE', '/api/user/account')).status, 200);
    assert.equal((await (await admin.request(`/api/polls/${poll.id}`)).json()).tally.voterCount, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/devServer.test.js`
Expected: FAIL (`/api/polls…` → 404).

- [ ] **Step 3: `routes/polls.js` anlegen**

```js
const express = require('express');
const router = express.Router();
const { db, collection, getDocs } = require('../firebaseAdmin');
const { requireAuth } = require('../middleware/auth');
const { checkRegistrationAllowed } = require('../middleware/maintenance');
const {
    tallyPoll, getFavoriteOptionId, isPollOpen, effectivePollStatus, canVote, normalizeVote
} = require('../utils/pollService');
const { loadPoll, loadPollVotes, savePollVote } = require('../utils/pollStore');
const { debugLog } = require('../utils/debugLog');

// Every poll route needs a logged-in member
router.use(requireAuth);

/**
 * Profiles keyed by user ID for names and avatars in the tally.
 *
 * @returns {Promise<Object>} -> `{ [userId]: profile }`.
 */
async function loadUsersById() {
    const usersById = {};
    (await getDocs(collection(db, 'users'))).forEach(userDoc => { usersById[userDoc.id] = userDoc.data(); });
    return usersById;
}

/**
 * Poll as the event page needs it.
 *
 * @param {Object} poll -> The poll with its `id`.
 * @param {Array<Object>} votes -> Votes of the poll.
 * @param {Object} user -> Session user.
 * @param {Object} usersById -> Profiles for names and avatars.
 * @returns {Object} -> Response body.
 */
function buildPollResponse(poll, votes, user, usersById) {
    const tally = tallyPoll(poll, votes, usersById);
    const own = votes.find(vote => vote.userId === user.id);
    const { announcements, ...publicPoll } = poll;
    return {
        ...publicPoll,
        status: effectivePollStatus(poll),
        tally,
        favoriteOptionId: getFavoriteOptionId(tally),
        myVote: own ? normalizeVote(poll.options, own) : { yes: [], maybe: [] },
        canVote: canVote(poll, user.roles || []),
        isOpen: isPollOpen(poll)
    };
}

/**
 * Sort comparator -> open polls by deadline (without deadline last), then the rest newest first.
 */
function byPollOrder(a, b) {
    const aOpen = a.status === 'open';
    const bOpen = b.status === 'open';
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen) {
        if (!a.deadline !== !b.deadline) return a.deadline ? -1 : 1;
        return (a.deadline || '').localeCompare(b.deadline || '');
    }
    return (b.createdAt || '').localeCompare(a.createdAt || '');
}

/**
 * GET /api/polls — All polls with the own vote status
 */
router.get('/', async (req, res) => {
    try {
        const user = req.session.user;
        const votesByPoll = {};
        (await getDocs(collection(db, 'pollVotes'))).forEach(voteDoc => {
            const vote = voteDoc.data();
            (votesByPoll[vote.pollId] ||= []).push(vote);
        });

        const polls = (await getDocs(collection(db, 'polls'))).docs.map(pollDoc => {
            const poll = { id: pollDoc.id, ...pollDoc.data() };
            const votes = votesByPoll[poll.id] || [];
            const tally = tallyPoll(poll, votes);
            const favoriteId = getFavoriteOptionId(tally);
            const favorite = favoriteId ? tally.options.find(entry => entry.optionId === favoriteId) : null;
            return {
                id: poll.id,
                title: poll.title,
                status: effectivePollStatus(poll),
                deadline: poll.deadline || '',
                optionCount: poll.options.length,
                voterCount: tally.voterCount,
                favorite: favorite ? { optionId: favorite.optionId, startDate: favorite.startDate, endDate: favorite.endDate, yes: favorite.yes, maybe: favorite.maybe } : null,
                myVoteStatus: votes.some(vote => vote.userId === user.id) ? 'voted' : 'open',
                canVote: canVote(poll, user.roles || []),
                eventId: poll.eventId || '',
                createdAt: poll.createdAt || ''
            };
        });

        polls.sort(byPollOrder);
        res.json(polls);
    } catch (err) {
        console.error('List polls error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Abstimmungen' });
    }
});

/**
 * GET /api/polls/:id — One poll with tally and own vote
 */
router.get('/:id', async (req, res) => {
    try {
        const poll = await loadPoll(req.params.id);
        if (!poll) {
            return res.status(404).json({ error: 'Abstimmung nicht gefunden' });
        }
        const votes = await loadPollVotes(poll.id);
        res.json(buildPollResponse(poll, votes, req.session.user, await loadUsersById()));
    } catch (err) {
        console.error('Get poll error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Abstimmung' });
    }
});

/**
 * PUT /api/polls/:id/vote — Store the own vote
 */
router.put('/:id/vote', checkRegistrationAllowed, async (req, res) => {
    try {
        const user = req.session.user;
        const result = await savePollVote({
            pollId: req.params.id,
            user: { id: user.id, displayName: user.displayName, roles: user.roles },
            yes: Array.isArray(req.body.yes) ? req.body.yes : [],
            maybe: Array.isArray(req.body.maybe) ? req.body.maybe : []
        });
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        debugLog('polls.vote', { pollId: req.params.id, userId: user.id });

        const poll = await loadPoll(req.params.id);
        const votes = await loadPollVotes(req.params.id);
        res.json(buildPollResponse(poll, votes, user, await loadUsersById()));
    } catch (err) {
        console.error('Poll vote error:', err);
        res.status(500).json({ error: 'Fehler beim Abstimmen' });
    }
});

module.exports = router;
```

- [ ] **Step 4: `server.js` und `routes/user.js`**

`server.js`:
- Nach `const { startBot, startReminderScheduler, stopBot, getGuildName } = require('./bot');`: `const { startPollScheduler, stopPollScheduler } = require('./utils/pollStore');`
- Nach `app.use('/api/events', require('./routes/events'));`: `app.use('/api/polls', require('./routes/polls'));`
- Nach `startReminderScheduler();`: `startPollScheduler();`
- In `gracefulShutdown` nach `stopBot();`: `stopPollScheduler();`

`routes/user.js`:
- Import: `const { deleteUserPollVotes } = require('../utils/pollStore');`
- In `DELETE /account` direkt vor `// Destroy session`:

```js
        // Votes of date polls belong to the account as well
        try {
            await deleteUserPollVotes(userId);
        } catch (pollErr) {
            console.error('Deleting poll votes failed:', pollErr.message);
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/devServer.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add routes/polls.js server.js routes/user.js test/devServer.test.js
git commit -m "Let members vote on date polls through the API" -m "Members list polls with their own vote status, see the tally with names and vote with passt/wenn nötig; the deadline scheduler starts with the server and deleted accounts take their votes with them." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 6: Abstimmen in Discord

**Files:**
- Modify: `bot.js`, `test/helpers.js`, `test/slotInteractions.test.js`
- Test: `test/pollInteractions.test.js` (neu)

**Interfaces:**
- Consumes: Task 1 (`isPollOpen`, `canVote`), Task 2 (`buildPollVoteReply`, Präfixe), Task 3 (`loadPoll`, `loadUserVote`, `savePollVote`)
- Produces: interne Handler `handlePollVoteButton(interaction, pollId)`, `handlePollVoteSelect(interaction, pollId, kind)`; `replyWithFailure(interaction, content = '❌ Fehler bei der Anmeldung.')`; Test-Helfer `createFakeInteraction(options)` und `dispatchInteraction(client, interaction)` in `test/helpers.js`

- [ ] **Step 1: Test-Double teilen** — in `test/helpers.js` vor `module.exports` einfügen und beide Funktionen exportieren:

```js
/**
 * Discord interaction double that records every answer in call order.
 * `answered` resolves with the first answer that is not a defer.
 *
 * @param {Object} options -> `{ kind: 'button'|'select'|'command', customId, userId, commandName, eventOption, values, roles }`.
 * @returns {Object} -> The fake interaction.
 */
function createFakeInteraction({ kind, customId, userId, commandName, eventOption, values = [], roles = null }) {
    const calls = [];
    let resolveAnswered;
    const answered = new Promise(resolve => { resolveAnswered = resolve; });
    const interaction = {
        customId, commandName, values, calls, answered,
        user: { id: userId, username: userId, globalName: userId },
        member: roles ? { roles, displayName: userId } : null,
        deferred: false,
        replied: false,
        options: { getString: () => eventOption },
        isAutocomplete: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => kind === 'select',
        isButton: () => kind === 'button',
        isChatInputCommand: () => kind === 'command',
        async deferUpdate() { calls.push(['deferUpdate']); interaction.deferred = true; },
        async deferReply(payload) { calls.push(['deferReply', payload]); interaction.deferred = true; },
        async update(payload) { calls.push(['update', payload]); interaction.replied = true; resolveAnswered(); },
        async reply(payload) { calls.push(['reply', payload]); interaction.replied = true; resolveAnswered(); },
        async editReply(payload) { calls.push(['editReply', payload]); resolveAnswered(); }
    };
    return interaction;
}

/**
 * Emit an interaction on the bot client and wait for its first answer.
 *
 * @param {Object} client -> The discord.js client of bot.js.
 * @param {Object} interaction -> Result of createFakeInteraction().
 * @param {number} [timeoutMs] -> Give up after this time.
 * @returns {Promise<void>}
 */
async function dispatchInteraction(client, interaction, timeoutMs = 3000) {
    client.emit('interactionCreate', interaction);
    await Promise.race([
        interaction.answered,
        new Promise((_, reject) => setTimeout(() => reject(new Error('no answer')), timeoutMs))
    ]);
}
```

In `test/slotInteractions.test.js`: die lokale Funktion `fakeInteraction` (inkl. JSDoc) und die lokale Funktion `dispatch` löschen; `require('./helpers')` zu `const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');` ändern; alle Aufrufe `fakeInteraction(` → `createFakeInteraction(` und `dispatch(interaction)` → `dispatchInteraction(bot.client, interaction)`.

Run: `node --test test/slotInteractions.test.js`
Expected: PASS (reiner Umzug, 4/4).

- [ ] **Step 2: Write the failing tests** — `test/pollInteractions.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('poll-interactions');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'poll-interactions.sqlite');

const bot = require('../bot');
const { db, doc, setDoc } = require('../firebaseAdmin');
const { loadUserVote } = require('../utils/pollStore');

after(async () => {
    await bot.client.destroy();
});

const A = { id: 'aaaaaaaa', startDate: '2026-12-11T18:00:00.000Z', endDate: '' };
const B = { id: 'bbbbbbbb', startDate: '2026-12-12T18:00:00.000Z', endDate: '' };
const EPHEMERAL = 64;

async function seedPoll(id, fields = {}) {
    await setDoc(doc(db, 'polls', id), {
        title: 'Discord-Abstimmung', description: '', status: 'open', deadline: '', accessMode: 'open',
        requiredRoles: [], options: [A, B], winnerOptionId: '', eventId: '', announcements: [], createdBy: 'x', ...fields
    });
}

async function seedVote(pollId, userId, yes, maybe = []) {
    await setDoc(doc(db, 'pollVotes', `${pollId}_${userId}`), { pollId, userId, userName: userId, yes, maybe, updatedAt: '1' });
}

test('the vote button answers with two prefilled selects', async () => {
    await seedPoll('ip-1');
    await seedVote('ip-1', 'ip-user-1', [A.id]);

    const interaction = createFakeInteraction({ kind: 'button', customId: 'poll_vote:ip-1', userId: 'ip-user-1' });
    await dispatchInteraction(bot.client, interaction);

    assert.deepEqual(interaction.calls.map(([name]) => name), ['deferReply', 'editReply']);
    assert.equal(interaction.calls[0][1].flags, EPHEMERAL);
    const [yes, maybe] = interaction.calls[1][1].components.map(row => row.toJSON().components[0]);
    assert.equal(yes.custom_id, 'poll_yes:ip-1');
    assert.equal(maybe.custom_id, 'poll_maybe:ip-1');
    assert.deepEqual(yes.options.map(o => o.default), [true, false]);
});

test('moving a date to "wenn nötig" removes it from "passt"', async () => {
    await seedPoll('ip-2');
    await seedVote('ip-2', 'ip-user-2', [A.id, B.id]);

    const interaction = createFakeInteraction({ kind: 'select', customId: 'poll_maybe:ip-2', userId: 'ip-user-2', values: [A.id] });
    await dispatchInteraction(bot.client, interaction);

    assert.deepEqual(interaction.calls.map(([name]) => name), ['deferUpdate', 'editReply']);
    assert.ok(interaction.calls[1][1].content.includes('Gespeichert: 1× passt, 1× wenn nötig.'));
    assert.deepEqual(await loadUserVote('ip-2', 'ip-user-2'), { yes: [B.id], maybe: [A.id] });
});

test('closed polls answer with a notice', async () => {
    await seedPoll('ip-3', { status: 'closed' });
    const button = createFakeInteraction({ kind: 'button', customId: 'poll_vote:ip-3', userId: 'ip-user-3' });
    await dispatchInteraction(bot.client, button);
    assert.equal(button.calls[1][1].content, '🔒 Die Abstimmung ist beendet.');

    const select = createFakeInteraction({ kind: 'select', customId: 'poll_yes:ip-3', userId: 'ip-user-3', values: [A.id] });
    await dispatchInteraction(bot.client, select);
    assert.deepEqual(select.calls[1][1], { content: '❌ Die Abstimmung ist beendet.', components: [] });
});

test('the vote button refuses members without the role', async () => {
    await seedPoll('ip-4', { accessMode: 'role-required', requiredRoles: ['raid'] });
    const interaction = createFakeInteraction({ kind: 'button', customId: 'poll_vote:ip-4', userId: 'ip-user-4', roles: ['other'] });
    await dispatchInteraction(bot.client, interaction);
    assert.equal(interaction.calls[1][1].content, '❌ Du hast nicht die erforderliche Rolle für diese Abstimmung.');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/pollInteractions.test.js`
Expected: FAIL (`no answer` — der Dispatcher kennt `poll_vote` nicht; Auswahlmenüs werden nicht behandelt).

- [ ] **Step 4: Implement in `bot.js`**

1. `replyWithFailure` erweitern:

```js
async function replyWithFailure(interaction, content = '❌ Fehler bei der Anmeldung.') {
```

(und die Zeile `const content = '❌ Fehler bei der Anmeldung.';` entfernen; JSDoc um `@param {string} [content] -> Error text.` ergänzen).

2. Nach `handleSlotLeaveButton` einfügen:

```js
/**
 * Handle "Abstimmen" below a poll message.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<void>}
 */
async function handlePollVoteButton(interaction, pollId) {
    // Acknowledge first -> loading the poll and the roles can take a moment
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { loadPoll, loadUserVote } = require('./utils/pollStore');
    const poll = await loadPoll(pollId);
    if (!poll) {
        return interaction.editReply({ content: '❌ Diese Abstimmung gibt es nicht mehr.' });
    }
    if (!isPollOpen(poll)) {
        return interaction.editReply({ content: '🔒 Die Abstimmung ist beendet.' });
    }
    if (await isRegistrationBlocked()) {
        return interaction.editReply({ content: '❌ Abstimmungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.' });
    }
    const roleIds = await resolveInteractionRoles(interaction);
    if (!canVote(poll, roleIds)) {
        return interaction.editReply({ content: '❌ Du hast nicht die erforderliche Rolle für diese Abstimmung.' });
    }
    const vote = await loadUserVote(pollId, interaction.user.id);
    await interaction.editReply(buildPollVoteReply(poll, vote));
}

/**
 * Handle a change in one of the two vote selects.
 *
 * The changed list wins: a date picked as "wenn nötig" leaves "passt" and
 * the other way round.
 *
 * @param {import('discord.js').StringSelectMenuInteraction} interaction -> The select interaction.
 * @param {string} pollId -> The poll document ID.
 * @param {'yes'|'maybe'} kind -> Which list was changed.
 * @returns {Promise<void>}
 */
async function handlePollVoteSelect(interaction, pollId, kind) {
    await interaction.deferUpdate();
    if (await isRegistrationBlocked()) {
        return interaction.editReply({ content: '❌ Abstimmungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.', components: [] });
    }
    const { loadPoll, loadUserVote, savePollVote } = require('./utils/pollStore');
    const current = await loadUserVote(pollId, interaction.user.id);
    const picked = Array.isArray(interaction.values) ? interaction.values : [];
    const next = kind === 'yes'
        ? { yes: picked, maybe: current.maybe.filter(id => !picked.includes(id)) }
        : { yes: current.yes.filter(id => !picked.includes(id)), maybe: picked };

    const roleIds = await resolveInteractionRoles(interaction);
    const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
    const result = await savePollVote({
        pollId,
        user: { id: interaction.user.id, displayName, roles: roleIds },
        yes: next.yes,
        maybe: next.maybe
    });
    if (!result.ok) {
        return interaction.editReply({ content: `❌ ${result.error}`, components: [] });
    }

    // Discord voters show up with name and avatar on the website
    await ensureUserProfile(interaction.user, displayName);
    const poll = await loadPoll(pollId);
    const status = `💾 Gespeichert: ${result.vote.yes.length}× passt, ${result.vote.maybe.length}× wenn nötig.`;
    await interaction.editReply(buildPollVoteReply(poll, result.vote, status));
}
```

3. Dispatcher — direkt vor `    if (interaction.isButton()) {` einfügen:

```js
    // Vote selects in the ephemeral answer of a poll
    if (interaction.isStringSelectMenu()) {
        const [selectAction, selectPollId] = interaction.customId.split(':');
        if ([POLL_YES_PREFIX, POLL_MAYBE_PREFIX].includes(selectAction) && selectPollId) {
            try {
                await handlePollVoteSelect(interaction, selectPollId, selectAction === POLL_YES_PREFIX ? 'yes' : 'maybe');
            } catch (err) {
                console.error('Poll vote select error:', err);
                await replyWithFailure(interaction, '❌ Fehler bei der Abstimmung.');
            }
        }
        return;
    }
```

Im Button-Zweig direkt nach der Zeile `const [buttonAction, buttonEventId, buttonSlotId] = interaction.customId.split(':');`:

```js
        if (buttonAction === POLL_VOTE_PREFIX && buttonEventId) {
            try {
                await handlePollVoteButton(interaction, buttonEventId);
            } catch (err) {
                console.error('Poll vote button error:', err);
                await replyWithFailure(interaction, '❌ Fehler bei der Abstimmung.');
            }
            return;
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/pollInteractions.test.js test/slotInteractions.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bot.js test/helpers.js test/slotInteractions.test.js test/pollInteractions.test.js
git commit -m "Vote on date polls from Discord" -m "The vote button answers privately with two prefilled selects; every change is saved at once, the changed list wins so a date can move from passt to wenn nötig, and closed polls or missing roles get a clear answer." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---
### Task 7: Dev-Mock-Daten — Abstimmungen im Seed

**Files:**
- Modify: `dev/seedData.js`, `dev/seed.js`
- Test: `test/seed.test.js`

**Interfaces:**
- Consumes: Datenmodell aus Task 3
- Produces: `POLL_ID = { OPEN: 'dev-poll-raid', DECIDED: 'dev-poll-summer' }`; offene Abstimmung „Termin für den Herbst-Raid“ (Rolle Raid-Team, Termine `raid-a/b/c`, Stimmen Ben/Kira/Felix, Favorit `raid-a`), entschiedene Abstimmung „Sommerfest-Termin“ (verknüpft mit `EVENT_ID.ARCHIVED`, Stimmen Lena/Tom). `polls: 2`, `pollVotes: 5`.

- [ ] **Step 1: Write the failing test** — in `test/seed.test.js` `EXPECTED_COUNTS` um `polls: 2,` und `pollVotes: 5` ergänzen, den Import auf `const { EVENT_ID, SERIES_EVENT_IDS, CHECKIN_CODE, POLL_ID } = require('../dev/seedData');` erweitern und nach `the raid event has a line-up …` einfügen:

```js
test('the seed has an open poll for the raiders and a decided one', async () => {
    const open = (await getDoc(doc(db, 'polls', POLL_ID.OPEN))).data();
    assert.equal(open.status, 'open');
    assert.equal(open.options.length, 3);
    assert.ok(new Date(open.deadline) > new Date());
    const raider = PERSONAS.find(persona => persona.id === 'raider');
    assert.equal((await getDoc(doc(db, 'pollVotes', `${POLL_ID.OPEN}_${raider.userId}`))).exists(), false);

    const decided = (await getDoc(doc(db, 'polls', POLL_ID.DECIDED))).data();
    assert.deepEqual([decided.status, decided.eventId], ['decided', EVENT_ID.ARCHIVED]);
    assert.equal((await getEvent(EVENT_ID.ARCHIVED)).sourcePollId, POLL_ID.DECIDED);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/seed.test.js`
Expected: FAIL (`EXPECTED_COUNTS` ohne Polls, `POLL_ID` undefined).

- [ ] **Step 3: Implement**

`dev/seed.js`: in `SEED_COLLECTIONS` nach `'auditLogs',` ergänzen: `'polls',\n    'pollVotes',`.

`dev/seedData.js`:
- Nach `RAID_SLOT_ID` einfügen:

```js
/** Date polls of the seed. */
const POLL_ID = { OPEN: 'dev-poll-raid', DECIDED: 'dev-poll-summer' };
```

- Im Event `[EVENT_ID.ARCHIVED]` nach `category: 'Community',` ergänzen: `sourcePollId: POLL_ID.DECIDED,`
- Vor `function buildSeedData` einfügen:

```js
function buildPolls(clock) {
    const base = {
        description: '',
        accessMode: 'open',
        requiredRoles: [],
        winnerOptionId: '',
        eventId: '',
        announcements: [],
        createdBy: people.mori.userId
    };
    return {
        // Open -> the raider persona (Lena) has not voted yet and can try it
        [POLL_ID.OPEN]: {
            ...base,
            title: 'Termin für den Herbst-Raid',
            description: 'Wann habt ihr Zeit für **Schattenfestung (heroisch)**?',
            status: 'open',
            accessMode: 'role-required',
            requiredRoles: [ROLE_ID.RAID_TEAM],
            options: [
                { id: 'raid-a', startDate: clock.slot(7, 20), endDate: clock.slot(7, 23) },
                { id: 'raid-b', startDate: clock.slot(9, 19), endDate: '' },
                { id: 'raid-c', startDate: clock.slot(12, 20), endDate: '' }
            ],
            deadline: clock.offset(3 * DAY),
            createdAt: clock.offset(-2 * DAY),
            updatedAt: clock.offset(-2 * DAY),
            closedAt: ''
        },
        // Decided -> led to the archived summer party
        [POLL_ID.DECIDED]: {
            ...base,
            title: 'Sommerfest-Termin',
            status: 'decided',
            options: [
                { id: 'summer-1', startDate: clock.slot(-60, 16), endDate: clock.slot(-60, 23) },
                { id: 'summer-2', startDate: clock.slot(-59, 16), endDate: '' }
            ],
            deadline: '',
            winnerOptionId: 'summer-1',
            eventId: EVENT_ID.ARCHIVED,
            createdAt: clock.offset(-95 * DAY),
            updatedAt: clock.offset(-90 * DAY),
            closedAt: clock.offset(-90 * DAY)
        }
    };
}

function buildPollVotes(clock) {
    const { ben, kira, felix, lena, tom } = people;
    const vote = (pollId, person, yes, maybe, daysAgo) => [`${pollId}_${person.userId}`, {
        pollId, userId: person.userId, userName: person.displayName, yes, maybe, updatedAt: clock.offset(-daysAgo * DAY)
    }];
    return Object.fromEntries([
        vote(POLL_ID.OPEN, ben, ['raid-a', 'raid-b'], [], 2),
        vote(POLL_ID.OPEN, kira, ['raid-a'], ['raid-c'], 1),
        vote(POLL_ID.OPEN, felix, ['raid-b'], ['raid-a'], 1),
        vote(POLL_ID.DECIDED, lena, ['summer-1'], [], 93),
        vote(POLL_ID.DECIDED, tom, [], ['summer-1'], 92)
    ]);
}
```

- In `buildSeedData` nach `auditLogs: buildAuditLogs(clock),` ergänzen: `polls: buildPolls(clock),\n        pollVotes: buildPollVotes(clock),`
- `module.exports` um `POLL_ID` erweitern.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/seed.test.js test/devServer.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dev/seedData.js dev/seed.js test/seed.test.js
git commit -m "Seed an open and a decided date poll" -m "npm run dev:mock should show the feature right away: the raid team has an open poll the raider persona can vote on, and the summer party shows where a decided poll leads." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 8: Frontend — Navigation, Übersicht, Detailseite und Abstimmen

**Files:**
- Modify: `public/index.html`, `public/js/app.js`, `public/css/style.css`

**Interfaces:**
- Consumes: `GET /api/polls`, `GET /api/polls/:id`, `PUT /api/polls/:id/vote` (Task 5); `renderRosterAvatar` (aus den Rollen-Slots)
- Produces: globale Funktionen `formatPollDate(iso)`, `formatPollOptionLabel(option)`, `refreshPollBadge()`, `showPollsSection()`, `renderPollCard(poll)`, `showPollDetail(pollId)`, `renderPollDetail(poll)`, `renderPollOptionRow(poll, entry)`, `setPollVote(optionId, state)`; Global `currentPoll`; Container `#poll-admin-bar` (Task 9 füllt ihn)

Kein automatisierter UI-Test; Verifikation im Mock-Modus.

- [ ] **Step 1: Markup in `public/index.html`**

Navigation — direkt nach dem `<li>` mit `href="#events"` (das mit `</li>` nach „Events“ endet) einfügen:

```html
            <li class="nav-item" id="nav-polls" style="display:none;">
              <a class="nav-link" href="#polls" data-section="polls-section">
                <i class="bi bi-ui-checks-grid me-1"></i>Abstimmungen
                <span class="badge rounded-pill text-bg-danger ms-1" id="nav-polls-badge" style="display:none;"></span>
              </a>
            </li>
```

Direkt vor `<section id="profile-section"` einfügen:

```html
    <!-- Date polls -->
    <section id="polls-section" class="app-section" style="display:none;">
      <div class="container section-container">
        <div class="section-header d-flex justify-content-between align-items-center flex-wrap gap-3" id="polls-header">
          <div>
            <h2><i class="bi bi-ui-checks-grid me-2"></i>Abstimmungen</h2>
            <p class="text-secondary mb-0">Stimme ab, wann die nächsten Events stattfinden.</p>
          </div>
        </div>
        <div id="polls-open" class="row g-4"></div>
        <details class="mt-4" id="polls-closed-wrapper">
          <summary class="text-secondary">Abgeschlossen</summary>
          <div id="polls-closed" class="row g-4 mt-1"></div>
        </details>
      </div>
    </section>

    <section id="poll-detail-section" class="app-section" style="display:none;">
      <div class="container section-container">
        <a href="#polls" class="text-secondary small"><i class="bi bi-arrow-left me-1"></i>Zurück zu den Abstimmungen</a>
        <div id="poll-detail" class="mt-3"></div>
      </div>
    </section>
```

- [ ] **Step 2: Router und Login in `public/js/app.js`**

- `showLoggedIn`: nach `document.getElementById('nav-profile').style.display = 'block';` ergänzen:
  ```js
      document.getElementById('nav-polls').style.display = 'block';
      refreshPollBadge();
  ```
- `showLoggedOut`: nach `document.getElementById('nav-profile').style.display = 'none';` ergänzen: `document.getElementById('nav-polls').style.display = 'none';`
- `handleRoute`: `if (route === 'event' && param) rememberPendingRoute(hash);` → `if ((route === 'event' || route === 'poll') && param) rememberPendingRoute(hash);`; im `switch` nach dem Fall `'event'` ergänzen:
  ```js
          case 'polls':
              showPollsSection();
              break;
          case 'poll':
              showPollDetail(param);
              break;
  ```

- [ ] **Step 3: Abschnitt „Date Polls“** — direkt vor `// ─── Check-in System ─────────────────────────────` einfügen:

```js
// ─── Date Polls ──────────────────────────────────
let currentPoll = null;

function formatPollDate(isoDate) {
    const date = new Date(isoDate);
    const day = date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.,', ',');
    const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `${day} · ${time}`;
}

function formatPollOptionLabel(option) {
    let label = formatPollDate(option.startDate);
    if (option.endDate) {
        const end = new Date(option.endDate);
        const sameDay = new Date(option.startDate).toDateString() === end.toDateString();
        label += sameDay
            ? `–${end.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
            : ` – ${formatPollDate(option.endDate)}`;
    }
    return label;
}

async function refreshPollBadge() {
    const badge = document.getElementById('nav-polls-badge');
    if (!badge || !currentUser) return;
    try {
        const res = await fetch('/api/polls');
        if (!res.ok) return;
        const polls = await res.json();
        const pending = polls.filter(poll => poll.status === 'open' && poll.canVote && poll.myVoteStatus === 'open').length;
        badge.textContent = pending;
        badge.style.display = pending > 0 ? 'inline-block' : 'none';
    } catch { /* non-fatal */ }
}

async function showPollsSection() {
    document.getElementById('polls-section').style.display = 'block';
    const createBtn = document.getElementById('polls-create-btn');
    if (createBtn) createBtn.style.display = currentUser && currentUser.isAdmin ? '' : 'none';

    const openGrid = document.getElementById('polls-open');
    const closedGrid = document.getElementById('polls-closed');
    openGrid.innerHTML = '<div class="col-12 text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div></div>';
    try {
        const res = await fetch('/api/polls');
        if (!res.ok) throw new Error('load failed');
        const polls = await res.json();
        const open = polls.filter(poll => poll.status === 'open');
        const done = polls.filter(poll => poll.status !== 'open');
        openGrid.innerHTML = open.length
            ? open.map(renderPollCard).join('')
            : '<div class="col-12"><div class="glass-card p-4 text-center text-secondary">Gerade läuft keine Abstimmung.</div></div>';
        closedGrid.innerHTML = done.map(renderPollCard).join('');
        document.getElementById('polls-closed-wrapper').style.display = done.length ? '' : 'none';
        refreshPollBadge();
    } catch {
        openGrid.innerHTML = '<div class="col-12 text-danger">Abstimmungen konnten nicht geladen werden.</div>';
    }
}

function renderPollCard(poll) {
    const statusBadges = {
        open: '<span class="badge-pill status-accepted">Offen</span>',
        closed: '<span class="badge-pill">Beendet</span>',
        decided: '<span class="badge-pill status-accepted">Entschieden</span>'
    };
    let voteBadge = '';
    if (poll.status === 'open') {
        if (!poll.canVote) {
            voteBadge = '<span class="badge-pill"><i class="bi bi-lock"></i>Nur für bestimmte Rollen</span>';
        } else if (poll.myVoteStatus === 'voted') {
            voteBadge = '<span class="badge-pill status-accepted"><i class="bi bi-check2"></i>Abgestimmt</span>';
        } else {
            voteBadge = '<span class="badge-pill status-pending"><i class="bi bi-hourglass-split"></i>Noch nicht abgestimmt</span>';
        }
    }
    const favorite = poll.favorite
        ? `<div class="poll-card-favorite">🏆 ${escapeHtml(formatPollOptionLabel(poll.favorite))} <span class="text-secondary">✅ ${poll.favorite.yes} · 🤔 ${poll.favorite.maybe}</span></div>`
        : '<div class="poll-card-favorite text-secondary">Noch keine Stimmen</div>';
    let deadline = '';
    if (poll.status === 'open') deadline = poll.deadline ? ` · bis ${escapeHtml(formatPollDate(poll.deadline))}` : ' · ohne Deadline';
    return `
        <div class="col-md-6 col-lg-4">
            <a class="poll-card glass-card" href="#poll/${escapeHtml(poll.id)}">
                <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                    <h5 class="mb-0">${escapeHtml(poll.title)}</h5>${statusBadges[poll.status] || ''}
                </div>
                <div class="text-secondary small mb-2"><i class="bi bi-calendar3 me-1"></i>${poll.optionCount} Termine · ${poll.voterCount} ${poll.voterCount === 1 ? 'Stimme' : 'Stimmen'}${deadline}</div>
                ${favorite}
                <div class="mt-2">${voteBadge}</div>
            </a>
        </div>`;
}

async function showPollDetail(pollId) {
    document.getElementById('poll-detail-section').style.display = 'block';
    const container = document.getElementById('poll-detail');
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-secondary"></div></div>';
    try {
        const res = await fetch(`/api/polls/${encodeURIComponent(pollId)}`);
        if (!res.ok) throw new Error('not found');
        currentPoll = await res.json();
        renderPollDetail(currentPoll);
    } catch {
        showToast('Abstimmung nicht gefunden.', 'danger');
        navigateTo('polls');
    }
}

function renderPollDetail(poll) {
    const container = document.getElementById('poll-detail');
    const winner = poll.options.find(option => option.id === poll.winnerOptionId);
    let banner = '';
    if (poll.status === 'decided' && winner) {
        banner = `<div class="poll-banner poll-banner-decided"><div><strong>✅ Termin steht:</strong> ${escapeHtml(formatPollOptionLabel(winner))}</div>${poll.eventId ? `<a class="btn btn-sm btn-accent" href="#event/${escapeHtml(poll.eventId)}">Zum Event</a>` : ''}</div>`;
    } else if (poll.status === 'closed') {
        banner = '<div class="poll-banner"><strong>🔒 Abstimmung beendet</strong></div>';
    } else if (!poll.canVote) {
        banner = '<div class="poll-banner"><i class="bi bi-lock me-1"></i>Nur Mitglieder mit der erforderlichen Rolle können abstimmen.</div>';
    }
    const voters = poll.tally.voterCount;
    const deadline = poll.deadline
        ? `<span><i class="bi bi-alarm me-1"></i>${poll.status === 'open' ? 'Abstimmung bis' : 'Deadline'} ${escapeHtml(formatPollDate(poll.deadline))}</span>`
        : '';
    container.innerHTML = `
        <div class="glass-card p-4 mb-4">
            <h2 class="mb-2">${escapeHtml(poll.title)}</h2>
            <div class="text-secondary small d-flex flex-wrap gap-3 mb-3">${deadline}<span><i class="bi bi-people me-1"></i>${voters} ${voters === 1 ? 'Stimme' : 'Stimmen'}</span></div>
            ${poll.description ? `<div class="markdown-body mb-3">${renderMarkdownSafe(poll.description)}</div>` : ''}
            ${banner}
            <div id="poll-admin-bar"></div>
        </div>
        <div class="poll-options">${poll.tally.options.map(entry => renderPollOptionRow(poll, entry)).join('')}</div>`;
}

function renderPollOptionRow(poll, entry) {
    const option = poll.options.find(candidate => candidate.id === entry.optionId);
    const total = Math.max(poll.tally.voterCount, 1);
    const isWinner = poll.status === 'decided' && entry.optionId === poll.winnerOptionId;
    const isFavorite = poll.status !== 'decided' && entry.optionId === poll.favoriteOptionId;
    let myState = 'no';
    if (poll.myVote.yes.includes(entry.optionId)) myState = 'yes';
    else if (poll.myVote.maybe.includes(entry.optionId)) myState = 'maybe';

    const avatars = [...entry.yesVoters, ...entry.maybeVoters].slice(0, 8).map(renderRosterAvatar).join('');
    const names = (list) => list.map(voter => escapeHtml(voter.displayName)).join(', ') || '—';
    const toggle = poll.isOpen && poll.canVote ? `
        <div class="btn-group btn-group-sm poll-vote-toggle" role="group" aria-label="Deine Stimme">
            ${[['yes', '✅ passt'], ['maybe', '🤔 wenn nötig'], ['no', '— passt nicht']].map(([state, label]) => `
                <button type="button" class="btn ${myState === state ? 'btn-accent' : 'btn-outline-light'}" data-option-id="${escapeHtml(entry.optionId)}" data-state="${state}" onclick="setPollVote(this.dataset.optionId, this.dataset.state)">${label}</button>`).join('')}
        </div>` : '';
    let marker = '';
    if (isWinner) marker = '✅ ';
    else if (isFavorite) marker = '🏆 ';

    return `
        <div class="poll-option glass-card${isWinner || isFavorite ? ' highlight' : ''}">
            <div class="poll-option-head">
                <span class="poll-option-date">${marker}${escapeHtml(formatPollOptionLabel(option))}</span>
                <span class="poll-option-count">✅ ${entry.yes} · 🤔 ${entry.maybe}</span>
            </div>
            <div class="poll-bar">
                <div class="poll-bar-yes" style="width:${Math.round((entry.yes / total) * 100)}%"></div>
                <div class="poll-bar-maybe" style="width:${Math.round((entry.maybe / total) * 100)}%"></div>
            </div>
            <div class="poll-option-foot">
                <div class="poll-voters">${avatars}</div>
                ${toggle}
            </div>
            ${entry.yes + entry.maybe > 0 ? `<details class="poll-voter-names"><summary>Namen anzeigen</summary><div>✅ ${names(entry.yesVoters)}</div><div>🤔 ${names(entry.maybeVoters)}</div></details>` : ''}
        </div>`;
}

async function setPollVote(optionId, state) {
    if (!currentPoll) return;
    const yes = currentPoll.myVote.yes.filter(id => id !== optionId);
    const maybe = currentPoll.myVote.maybe.filter(id => id !== optionId);
    if (state === 'yes') yes.push(optionId);
    if (state === 'maybe') maybe.push(optionId);
    try {
        const res = await fetch(`/api/polls/${encodeURIComponent(currentPoll.id)}/vote`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
            body: JSON.stringify({ yes, maybe })
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Stimme konnte nicht gespeichert werden.', 'danger');
            return;
        }
        currentPoll = result;
        renderPollDetail(currentPoll);
        refreshPollBadge();
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}
```

- [ ] **Step 4: CSS** — am Ende von `public/css/style.css` anhängen:

```css
/* ============================================ */
/* DATE POLLS                                   */
/* ============================================ */
.poll-card {
  display: block;
  height: 100%;
  padding: 1.25rem;
  color: var(--text-primary);
  text-decoration: none;
  transition: var(--transition);
}

.poll-card:hover {
  color: var(--text-primary);
  border-color: var(--border-accent);
  transform: translateY(-2px);
}

.poll-card-favorite {
  font-size: 0.9rem;
}

.poll-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.03);
  margin-bottom: 0.75rem;
}

.poll-banner-decided {
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.08);
}

.poll-options {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.poll-option {
  padding: 1rem 1.25rem;
}

.poll-option.highlight {
  border-color: var(--border-accent);
  box-shadow: var(--shadow-glow);
}

.poll-option-head {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.poll-option-count {
  color: var(--text-secondary);
  font-weight: 500;
  white-space: nowrap;
}

.poll-bar {
  display: flex;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
}

.poll-bar-yes {
  background: var(--success);
}

.poll-bar-maybe {
  background: rgba(234, 179, 8, 0.7);
}

.poll-option-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.poll-voters {
  display: flex;
  gap: 0.25rem;
  min-height: 1.75rem;
}

.poll-voter-names {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.poll-voter-names summary {
  cursor: pointer;
}

@media (max-width: 576px) {
  .poll-vote-toggle {
    width: 100%;
  }

  .poll-vote-toggle .btn {
    flex: 1;
  }
}
```

- [ ] **Step 5: Manuell prüfen**

Run: `npm run dev:reset && npm run dev:mock` (Port 3000), dann im Browser `http://localhost:3000/auth/dev-login/raider`.
Expected:
- Navigation zeigt „Abstimmungen“ mit Badge `1` (Herbst-Raid, Lena hat noch nicht abgestimmt).
- `#polls`: Karte „Termin für den Herbst-Raid“ mit „Noch nicht abgestimmt“, Favorit 🏆 (raid-a) mit ✅ 2 · 🤔 1; unter „Abgeschlossen“ der „Sommerfest-Termin“ (Entschieden).
- Detailseite: drei Zeilen mit Balken und Avataren; Umschalter „✅ passt“ beim ersten Termin → Zahl wird ✅ 3, Badge verschwindet; „🤔 wenn nötig“ beim selben Termin → ✅ 2 · 🤔 2.
- Als Persona „Member“ (Tom, ohne Raid-Team): Banner „Nur Mitglieder mit der erforderlichen Rolle …“, kein Umschalter, kein Badge.
- Sommerfest-Termin: Banner „✅ Termin steht“ mit Button „Zum Event“.
- Konsole ohne Fehler; bei ~400 px Breite füllt der Umschalter die Zeilenbreite.

Zusätzlich: `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/app.js public/css/style.css
git commit -m "Show date polls on the website and let members vote" -m "Members find open polls in the navigation with a badge for the ones they still have to answer, see the tally with names per date and vote per date with one click." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 9: Frontend — Admin-Dialoge und „Event erstellen“

**Files:**
- Modify: `public/index.html`, `public/js/app.js`, `public/css/style.css`

**Interfaces:**
- Consumes: Admin-API (Task 4), `currentPoll`, `renderPollDetail`, `formatPollOptionLabel` (Task 8), Event-Wizard (`showCreateEventModal`, `editEvent`, `saveEvent`, `wizardGoTo`, `startDatePicker`, `endDatePicker`, `descriptionEditor`, `cachedRoles`)
- Produces: globale Funktionen `showConfirmDialog(message, confirmLabel)`, `renderPollRoleCheckboxes(selected, containerId)`, `togglePollRoles()`, `showPollEditor(pollId)`, `addPollOptionRow(option)`, `collectPollEditor()`, `savePoll()`, `renderPollAdminBar(poll)`, `showPollAnnounceDialog(pollId)`, `sendPollAnnouncement()`, `closePollFromUi(pollId)`, `deletePollFromUi(pollId)`, `showPollDecideDialog(pollId)`, `startEventFromPoll()`; Global `pendingPollDecision`, `pollDeadlinePicker`

- [ ] **Step 1: Markup in `public/index.html`**

Im Kopf von `#polls-section` (`<div class="section-header … id="polls-header">`) nach dem inneren `</div>` mit Überschrift und Untertitel einfügen:

```html
          <button class="btn btn-accent" id="polls-create-btn" style="display:none;" onclick="showPollEditor()">
            <i class="bi bi-plus-circle me-1"></i>Neue Abstimmung
          </button>
```

Im Admin-Dashboard direkt nach dem Button „Neues Event“ (`onclick="showCreateEventModal()"` … `</button>`):

```html
            <a class="btn btn-outline-light" href="#polls">
              <i class="bi bi-ui-checks-grid me-1"></i>Abstimmungen
            </a>
```

Im Reset-Dialog nach dem Block mit `id="reset-auditLogs"`:

```html
            <div class="form-check">
              <input class="form-check-input" type="checkbox" value="polls" id="reset-polls">
              <label class="form-check-label" for="reset-polls">Alle Abstimmungen löschen</label>
            </div>
```

Direkt vor `<section id="info-section"` einfügen:

```html
  <!-- Date poll editor -->
  <div class="modal fade" id="pollEditorModal" tabindex="-1">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content glass-modal">
        <div class="modal-header border-0">
          <h5 class="modal-title" id="poll-editor-title">Neue Abstimmung</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="poll-edit-id">
          <div class="mb-3">
            <label class="form-label" for="poll-title">Titel</label>
            <input type="text" class="form-control" id="poll-title" maxlength="200" placeholder="z. B. Termin für den Herbst-Raid">
          </div>
          <div class="mb-3">
            <label class="form-label" for="poll-description">Beschreibung</label>
            <textarea class="form-control" id="poll-description" rows="3" maxlength="5000" placeholder="Worum geht es? (Markdown möglich)"></textarea>
          </div>
          <label class="form-label">Termine</label>
          <div id="poll-option-rows" class="poll-option-rows"></div>
          <button type="button" class="btn btn-sm btn-outline-light mt-2" onclick="addPollOptionRow()"><i class="bi bi-plus-lg me-1"></i>Termin</button>
          <small class="text-muted d-block mt-1">2–10 Termine. Termine mit Stimmen können nicht mehr entfernt oder verschoben werden.</small>
          <div class="row g-3 mt-2">
            <div class="col-md-6">
              <label class="form-label" for="poll-deadline">Deadline (optional)</label>
              <input type="text" class="form-control" id="poll-deadline" placeholder="Ohne Deadline">
            </div>
            <div class="col-md-6">
              <label class="form-label" for="poll-access">Wer darf abstimmen?</label>
              <select class="form-select" id="poll-access" onchange="togglePollRoles()">
                <option value="open">Alle Mitglieder</option>
                <option value="role-required">Nur bestimmte Rollen</option>
              </select>
            </div>
          </div>
          <div id="poll-role-area" class="mt-3" style="display:none;">
            <div id="poll-role-checkboxes" class="d-flex flex-wrap gap-2"></div>
          </div>
        </div>
        <div class="modal-footer border-0">
          <button type="button" class="btn btn-outline-light" data-bs-dismiss="modal">Abbrechen</button>
          <button type="button" class="btn btn-accent" onclick="savePoll()">Speichern</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Post a date poll to Discord -->
  <div class="modal fade" id="pollAnnounceModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content glass-modal">
        <div class="modal-header border-0">
          <h5 class="modal-title"><i class="bi bi-discord me-2"></i>In Discord posten</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="poll-announce-id">
          <label class="form-label" for="poll-announce-text">Text über der Abstimmung (optional)</label>
          <textarea class="form-control mb-3" id="poll-announce-text" rows="2" maxlength="1500" placeholder="z. B. Stimmt bis Freitag ab!"></textarea>
          <label class="form-label">Rollen erwähnen</label>
          <div id="poll-announce-roles" class="d-flex flex-wrap gap-2 mb-3"></div>
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" id="poll-announce-everyone">
            <label class="form-check-label" for="poll-announce-everyone">@everyone erwähnen</label>
          </div>
        </div>
        <div class="modal-footer border-0">
          <button type="button" class="btn btn-outline-light" data-bs-dismiss="modal">Abbrechen</button>
          <button type="button" class="btn btn-accent" onclick="sendPollAnnouncement()">Posten</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Choose the date for the event -->
  <div class="modal fade" id="pollDecideModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content glass-modal">
        <div class="modal-header border-0">
          <h5 class="modal-title"><i class="bi bi-calendar-plus me-2"></i>Termin für das Event wählen</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div id="poll-decide-options" class="d-flex flex-column gap-2"></div>
          <small class="text-muted d-block mt-2">Danach öffnet sich der Event-Wizard mit diesem Termin. Alle Abstimmenden bekommen nach dem Speichern eine DM.</small>
        </div>
        <div class="modal-footer border-0">
          <button type="button" class="btn btn-outline-light" data-bs-dismiss="modal">Abbrechen</button>
          <button type="button" class="btn btn-accent" onclick="startEventFromPoll()">Weiter zum Event</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Generic confirmation -->
  <div class="modal fade" id="confirmModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content glass-modal">
        <div class="modal-body pt-4">
          <p id="confirm-modal-text" class="mb-0"></p>
        </div>
        <div class="modal-footer border-0">
          <button type="button" class="btn btn-outline-light" data-bs-dismiss="modal">Abbrechen</button>
          <button type="button" class="btn btn-danger" id="confirm-modal-ok">Bestätigen</button>
        </div>
      </div>
    </div>
  </div>

```

- [ ] **Step 2: Logik in `public/js/app.js`** — direkt nach `setPollVote` (Ende des Abschnitts „Date Polls“) einfügen:

```js
// ─── Date Polls (admin) ──────────────────────────
let pendingPollDecision = null;
let pollDeadlinePicker = null;
const POLL_PICKER_CONFIG = { enableTime: true, dateFormat: 'Y-m-d H:i', time_24hr: true, locale: 'de' };

function showConfirmDialog(message, confirmLabel = 'Bestätigen') {
    return new Promise(resolve => {
        const modalEl = document.getElementById('confirmModal');
        const confirmBtn = document.getElementById('confirm-modal-ok');
        document.getElementById('confirm-modal-text').textContent = message;
        confirmBtn.textContent = confirmLabel;
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        let confirmed = false;
        confirmBtn.onclick = () => { confirmed = true; modal.hide(); };
        modalEl.addEventListener('hidden.bs.modal', () => resolve(confirmed), { once: true });
        modal.show();
    });
}

async function renderPollRoleCheckboxes(selected, containerId = 'poll-role-checkboxes') {
    if (!cachedRoles.length) {
        try {
            cachedRoles = await (await fetch('/api/admin/roles')).json();
        } catch {
            cachedRoles = [];
        }
    }
    document.getElementById(containerId).innerHTML = cachedRoles.map(role => `
        <label class="badge-pill" style="cursor:pointer;border-color:${escapeHtml(role.color || '')}">
            <input type="checkbox" value="${escapeHtml(role.id)}"${selected.includes(role.id) ? ' checked' : ''} style="margin-right:4px;"> ${escapeHtml(role.name)}
        </label>`).join('');
}

function togglePollRoles() {
    const restricted = document.getElementById('poll-access').value === 'role-required';
    document.getElementById('poll-role-area').style.display = restricted ? 'block' : 'none';
}

async function showPollEditor(pollId = null) {
    let poll = null;
    if (pollId) {
        poll = currentPoll && currentPoll.id === pollId
            ? currentPoll
            : await (await fetch(`/api/polls/${encodeURIComponent(pollId)}`)).json();
    }
    document.getElementById('poll-edit-id').value = pollId || '';
    document.getElementById('poll-editor-title').textContent = pollId ? 'Abstimmung bearbeiten' : 'Neue Abstimmung';
    document.getElementById('poll-title').value = poll ? poll.title : '';
    document.getElementById('poll-description').value = poll ? poll.description || '' : '';
    document.getElementById('poll-access').value = poll ? poll.accessMode : 'open';
    await renderPollRoleCheckboxes(poll ? poll.requiredRoles || [] : []);
    togglePollRoles();

    document.getElementById('poll-option-rows').innerHTML = '';
    (poll ? poll.options : [{}, {}]).forEach(option => addPollOptionRow(option));

    if (!pollDeadlinePicker) pollDeadlinePicker = flatpickr('#poll-deadline', POLL_PICKER_CONFIG);
    pollDeadlinePicker.clear();
    if (poll && poll.deadline) pollDeadlinePicker.setDate(new Date(poll.deadline));

    bootstrap.Modal.getOrCreateInstance(document.getElementById('pollEditorModal')).show();
}

function addPollOptionRow(option = {}) {
    const rows = document.getElementById('poll-option-rows');
    if (rows.querySelectorAll('.poll-option-row').length >= 10) {
        showToast('Es sind höchstens 10 Termine möglich.', 'warning');
        return;
    }
    const row = document.createElement('div');
    row.className = 'poll-option-row';
    row.dataset.optionId = option.id || '';
    row.innerHTML = `
        <input type="text" class="form-control poll-option-start" placeholder="Beginn" aria-label="Beginn">
        <input type="text" class="form-control poll-option-end" placeholder="Ende (optional)" aria-label="Ende">
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.poll-option-row').remove()" title="Termin entfernen"><i class="bi bi-trash"></i></button>`;
    rows.appendChild(row);
    const startPicker = flatpickr(row.querySelector('.poll-option-start'), POLL_PICKER_CONFIG);
    const endPicker = flatpickr(row.querySelector('.poll-option-end'), POLL_PICKER_CONFIG);
    if (option.startDate) startPicker.setDate(new Date(option.startDate));
    if (option.endDate) endPicker.setDate(new Date(option.endDate));
}

function collectPollEditor() {
    const options = [...document.querySelectorAll('#poll-option-rows .poll-option-row')].map(row => {
        const start = row.querySelector('.poll-option-start')._flatpickr.selectedDates[0];
        const end = row.querySelector('.poll-option-end')._flatpickr.selectedDates[0];
        return {
            id: row.dataset.optionId || undefined,
            startDate: start ? start.toISOString() : '',
            endDate: end ? end.toISOString() : ''
        };
    });
    const deadline = pollDeadlinePicker && pollDeadlinePicker.selectedDates[0];
    const accessMode = document.getElementById('poll-access').value;
    return {
        title: document.getElementById('poll-title').value,
        description: document.getElementById('poll-description').value,
        options,
        deadline: deadline ? deadline.toISOString() : '',
        accessMode,
        requiredRoles: accessMode === 'role-required'
            ? [...document.querySelectorAll('#poll-role-checkboxes input:checked')].map(cb => cb.value)
            : []
    };
}

async function savePoll() {
    const pollId = document.getElementById('poll-edit-id').value;
    try {
        const res = await fetch(pollId ? `/api/admin/polls/${encodeURIComponent(pollId)}` : '/api/admin/polls', {
            method: pollId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
            body: JSON.stringify(collectPollEditor())
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Abstimmung konnte nicht gespeichert werden.', 'danger');
            return;
        }
        bootstrap.Modal.getInstance(document.getElementById('pollEditorModal')).hide();
        showToast(pollId ? 'Abstimmung gespeichert!' : 'Abstimmung erstellt!', 'success');
        if (pollId) {
            showPollDetail(result.id);
        } else {
            navigateTo(`poll/${result.id}`);
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

function renderPollAdminBar(poll) {
    const bar = document.getElementById('poll-admin-bar');
    if (!bar) return;
    if (!currentUser || !currentUser.isAdmin) {
        bar.innerHTML = '';
        return;
    }
    const id = escapeHtml(poll.id);
    const button = (cls, handler, icon, label) =>
        `<button class="btn btn-sm ${cls}" data-poll-id="${id}" onclick="${handler}(this.dataset.pollId)"><i class="bi ${icon} me-1"></i>${label}</button>`;
    const buttons = [button('btn-outline-light', 'showPollAnnounceDialog', 'bi-discord', 'In Discord posten')];
    if (poll.status === 'open') {
        buttons.push(button('btn-outline-light', 'showPollEditor', 'bi-pencil', 'Bearbeiten'));
        buttons.push(button('btn-outline-light', 'closePollFromUi', 'bi-lock', 'Abstimmung beenden'));
    }
    if (poll.status !== 'decided') {
        buttons.push(button('btn-accent', 'showPollDecideDialog', 'bi-calendar-plus', 'Event erstellen'));
    }
    buttons.push(button('btn-outline-danger', 'deletePollFromUi', 'bi-trash', 'Löschen'));
    bar.innerHTML = `<div class="poll-admin-bar">${buttons.join('')}</div>`;
}

async function showPollAnnounceDialog(pollId) {
    document.getElementById('poll-announce-id').value = pollId;
    document.getElementById('poll-announce-text').value = '';
    document.getElementById('poll-announce-everyone').checked = false;
    await renderPollRoleCheckboxes([], 'poll-announce-roles');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('pollAnnounceModal')).show();
}

async function sendPollAnnouncement() {
    const pollId = document.getElementById('poll-announce-id').value;
    try {
        const res = await fetch(`/api/admin/polls/${encodeURIComponent(pollId)}/announce`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
            body: JSON.stringify({
                text: document.getElementById('poll-announce-text').value,
                roleIds: [...document.querySelectorAll('#poll-announce-roles input:checked')].map(cb => cb.value),
                pingEveryone: document.getElementById('poll-announce-everyone').checked
            })
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Abstimmung konnte nicht gepostet werden.', 'danger');
            return;
        }
        bootstrap.Modal.getInstance(document.getElementById('pollAnnounceModal')).hide();
        showToast(result.message || 'Gepostet!', 'success');
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

async function closePollFromUi(pollId) {
    if (!await showConfirmDialog('Abstimmung jetzt beenden? Danach sind keine Stimmen mehr möglich.', 'Beenden')) return;
    try {
        const res = await fetch(`/api/admin/polls/${encodeURIComponent(pollId)}/close`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': csrfToken }
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Abstimmung konnte nicht beendet werden.', 'danger');
            return;
        }
        showToast('Abstimmung beendet.', 'success');
        showPollDetail(pollId);
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

async function deletePollFromUi(pollId) {
    if (!await showConfirmDialog('Abstimmung mit allen Stimmen löschen? Das lässt sich nicht rückgängig machen.', 'Löschen')) return;
    try {
        const res = await fetch(`/api/admin/polls/${encodeURIComponent(pollId)}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': csrfToken }
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Abstimmung konnte nicht gelöscht werden.', 'danger');
            return;
        }
        showToast('Abstimmung gelöscht.', 'success');
        navigateTo('polls');
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

function showPollDecideDialog(pollId) {
    const poll = currentPoll;
    if (!poll || poll.id !== pollId) return;
    const preselected = poll.favoriteOptionId || poll.options[0].id;
    document.getElementById('poll-decide-options').innerHTML = poll.tally.options.map(entry => {
        const option = poll.options.find(candidate => candidate.id === entry.optionId);
        return `
            <label class="poll-decide-option">
                <input class="form-check-input me-2" type="radio" name="poll-decide" value="${escapeHtml(entry.optionId)}"${entry.optionId === preselected ? ' checked' : ''}>
                <span>${escapeHtml(formatPollOptionLabel(option))}</span>
                <span class="text-secondary ms-auto">✅ ${entry.yes} · 🤔 ${entry.maybe}</span>
            </label>`;
    }).join('');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('pollDecideModal')).show();
}

async function startEventFromPoll() {
    const poll = currentPoll;
    const selected = document.querySelector('input[name="poll-decide"]:checked');
    if (!poll || !selected) return;
    const option = poll.options.find(candidate => candidate.id === selected.value);
    bootstrap.Modal.getInstance(document.getElementById('pollDecideModal')).hide();

    await showCreateEventModal();
    document.getElementById('event-title').value = poll.title;
    if (descriptionEditor) descriptionEditor.value(poll.description || '');
    // The date pickers are created when step 2 is shown for the first time
    wizardGoTo(2);
    startDatePicker.setDate(new Date(option.startDate));
    if (option.endDate) endDatePicker.setDate(new Date(option.endDate));
    wizardGoTo(1);

    pendingPollDecision = { pollId: poll.id, optionId: option.id };
    showToast('Termin übernommen – richte das Event ein und speichere es.', 'info');
}
```

Bestehende Funktionen anpassen:
- `renderPollDetail`: als letzte Zeile der Funktion `renderPollAdminBar(poll);` ergänzen.
- `showCreateEventModal`: als erste Zeile im Funktionskörper `pendingPollDecision = null;`.
- `editEvent`: als erste Zeile im Funktionskörper `pendingPollDecision = null;`.
- `saveEvent`: im `data`-Objekt nach `slots: getSlotsFromEditor(),` ergänzen: `fromPoll: pendingPollDecision || undefined,`; im Erfolgszweig nach `loadAdminStats();` ergänzen:
  ```js
              if (!editId && pendingPollDecision) {
                  const decidedPollId = pendingPollDecision.pollId;
                  pendingPollDecision = null;
                  showToast('Abstimmung entschieden – alle Abstimmenden bekommen eine DM.', 'success');
                  navigateTo(`poll/${decidedPollId}`);
              }
  ```
- `performSystemReset`: nach `if (document.getElementById('reset-auditLogs').checked) targets.push('auditLogs');` ergänzen: `if (document.getElementById('reset-polls').checked) targets.push('polls', 'pollVotes');`

- [ ] **Step 3: CSS** — an den Abschnitt „DATE POLLS“ anhängen:

```css
.poll-admin-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.poll-option-rows {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.poll-option-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 0.5rem;
  align-items: center;
}

@media (max-width: 576px) {
  .poll-option-row {
    grid-template-columns: 1fr auto;
  }

  .poll-option-row .poll-option-end {
    grid-column: 1 / 2;
  }
}

.poll-decide-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
}

.poll-decide-option:has(input:checked) {
  border-color: var(--accent);
  background: rgba(139, 92, 246, 0.1);
}
```

- [ ] **Step 4: Manuell prüfen**

Run: `npm run dev:reset && npm run dev:mock`, Persona „Admin“.
Expected:
- `#polls` zeigt „Neue Abstimmung“; Admin-Dashboard hat den Button „Abstimmungen“.
- „Neue Abstimmung“: zwei leere Terminzeilen; ohne Termine speichern → Toast „Jeder Termin braucht ein gültiges Datum.“; mit zwei Terminen, Deadline und „Nur bestimmte Rollen“ + Raid-Team → gespeichert, Detailseite öffnet sich mit Admin-Leiste.
- „Bearbeiten“ beim Herbst-Raid: ersten Termin entfernen → Toast „… hat bereits Stimmen.“
- „In Discord posten“ mit Text → Toast „Abstimmung im Discord-Channel gepostet!“; Server-Log zeigt `[MOCK-DISCORD] Nachricht in #ankündigungen`.
- „Event erstellen“ beim Herbst-Raid: Favorit vorausgewählt → „Weiter zum Event“ öffnet den Wizard mit Titel, Beschreibung und Datum (Schritt 2 zeigt den Termin); speichern → Toast „Abstimmung entschieden …“, Detailseite zeigt „✅ Termin steht“ + „Zum Event“; Server-Log zeigt drei DMs „Der Termin für **Termin für den Herbst-Raid** steht“.
- „Abstimmung beenden“ und „Löschen“ fragen per Dialog nach (kein Browser-`confirm`), „Abbrechen“ ändert nichts.
- Reset-Dialog hat „Alle Abstimmungen löschen“.

Zusätzlich: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/app.js public/css/style.css
git commit -m "Let admins create, post and decide date polls on the website" -m "Admins manage polls in dialogs, post them to Discord and turn the chosen date into an event through the prefilled event wizard; destructive actions ask in a modal instead of the browser confirm." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 10: Wiki, What's New und Release 2.7.0

**Files:**
- Create: `docs/wiki/concepts/date-polls.md`, `docs/wiki/modules/routes-polls.md`
- Modify: `docs/wiki/concepts/data-model.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/routes-user.md`, `docs/wiki/modules/server.md`, `docs/wiki/modules/bot.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/dev-mock-mode.md`, `docs/wiki/modules/utils.md`, `docs/wiki/index.md`, `docs/wiki/graph.json` (generiert), `updates.json`, `package.json`, `package-lock.json`

**Interfaces:** Doku aller vorherigen Tasks.

- [ ] **Step 1: Neuer Knoten `docs/wiki/concepts/date-polls.md`**

```markdown
---
id: date-polls
title: Date polls — finding a date with "passt" / "wenn nötig"
type: concept
tags: [polls, voting, dates, doodle, discord, scheduler, events]
sources: [utils/pollService.js, utils/pollStore.js, routes/polls.js, routes/admin.js, bot.js, public/js/app.js]
depends_on: [data-model]
see_also: [routes-polls, discord-integration, event-lifecycle, role-slots]
---
# Date polls — finding a date with "passt" / "wenn nötig"

> TL;DR: Admins propose 2–10 dates (`polls`), members vote per date with "passt" or "wenn nötig" on the web or through a Discord button with two prefilled selects (`pollVotes`, one document per member). The posted Discord message shows the tally live. A scheduler closes polls after their deadline and DMs the creator; "Event erstellen" opens the event wizard prefilled and `POST /api/admin/events` with `fromPoll` decides the poll and DMs every voter.

## Data

- `polls`: `title`, `description`, `options: [{ id, startDate, endDate }]`, `deadline`, `status: open|closed|decided`, `accessMode`/`requiredRoles`, `winnerOptionId`, `eventId`, `announcements`, `createdBy`, `createdAt`, `updatedAt`, `closedAt`.
- `pollVotes` (ID `<pollId>_<userId>`): `{ pollId, userId, userName, yes: optionId[], maybe: optionId[], updatedAt }`; an empty vote is deleted.

## Rules (`utils/pollService.js`, pure)

| Function | Rule |
|---|---|
| `normalizePollInput` | 2–10 dates, new or moved dates in the future, no duplicates; dates with votes may not be removed or moved; only open polls can be edited |
| `normalizeVote` | known dates only, date order; "passt" wins if a date is in both lists |
| `isPollOpen` / `effectivePollStatus` | open = status `open` and before the deadline; members see an expired open poll as `closed` |
| `tallyPoll` / `getFavoriteOptionId` | counts and names per date; favorite = most "passt", then "wenn nötig", then earliest |

## Flows (`utils/pollStore.js`)

All writes run under `withEventLock('poll:<id>')`: `savePollVote`, `updatePoll`, `closePoll`, `decidePoll`, `deletePoll`. DMs and `notifyPollChanged` run after the lock. `startPollScheduler` (5 min, independent of the bot's reminder setting) calls `closeExpiredPolls`. Account deletion calls `deleteUserPollVotes`.

## Discord

`buildPollEmbed` / `buildPollComponents` (🏆 favorite, up to 5 names per date, status-dependent title and buttons). `poll_vote:<id>` → `deferReply` → `buildPollVoteReply` with `poll_yes:<id>` / `poll_maybe:<id>` selects; a change → `deferUpdate`, the changed list wins (a date picked as "wenn nötig" leaves "passt"), saved at once. `refreshPollMessages` edits posted messages; a deleted poll's messages become "🗑️ Abstimmung gelöscht" (`markPollMessagesDeleted`).

## Gotchas

- Voting is blocked during maintenance/panic like registrations (`checkRegistrationAllowed`, `isRegistrationBlocked`).
- Deciding is validated before the event is created; a poll can only be decided once.
- Polls cannot be reopened.
```

- [ ] **Step 2: Neuer Knoten `docs/wiki/modules/routes-polls.md`**

```markdown
---
id: routes-polls
title: routes/polls.js — member API for date polls
type: module
tags: [api, polls, voting]
sources: [routes/polls.js]
part_of: [architecture]
depends_on: [middleware, data-layer]
see_also: [date-polls, api-index]
---
# routes/polls.js — member API for date polls

> TL;DR: Mounted at `/api/polls`, every route needs a logged-in member. Lists polls with the own vote status, returns one poll with tally and own vote, and stores a vote (`PUT /:id/vote`, blocked during maintenance). Admin routes for polls live in `routes/admin.js`.

| Method | Path | Behaviour |
|---|---|---|
| GET | `/` | all polls: open first (by deadline), then closed/decided newest first; `{ id, title, status, deadline, optionCount, voterCount, favorite, myVoteStatus, canVote, eventId, createdAt }` |
| GET | `/:id` | poll without `announcements`, effective `status`, `tally` (names/avatars), `favoriteOptionId`, `myVote`, `canVote`, `isOpen`; 404 when missing |
| PUT | `/:id/vote` | `checkRegistrationAllowed`; body `{ yes, maybe }` → `savePollVote` → same shape as `GET /:id`; 400 closed, 403 role, 404 missing |
```

- [ ] **Step 3: Bestehende Knoten aktualisieren**

- `data-model.md`: im TL;DR „Nine schemaless collections“ → „Eleven schemaless collections“ und `polls`, `pollVotes` nennen; im Mermaid-Diagramm `polls ||--o{ pollVotes : "pollId"` und `events ||--o| polls : "sourcePollId"`; Abschnitt „## polls (auto id) / pollVotes“ mit den Feldern aus `date-polls`; Event-Tabelle um `sourcePollId` (Poll, aus dem das Event entstand); Audit-Actions um `CREATE_POLL`, `UPDATE_POLL`, `CLOSE_POLL`, `ANNOUNCE_POLL`, `DELETE_POLL`, `DECIDE_POLL`.
- `api-index.md`: neuer Abschnitt `## /api/polls — [routes-polls](../modules/routes-polls.md)` mit den drei Routen (Guard U, `PUT` + Wartungs-Gate); Admin-Tabelle um `GET/POST`-Zeilen: `POST /api/admin/polls`, `PUT /api/admin/polls/:id`, `POST /api/admin/polls/:id/close`, `/polls/:id/announce`, `DELETE /api/admin/polls/:id`.
- `routes-admin.md`: Tabelle um die fünf Poll-Routen (mit Audit-Actions) und den Zusatz bei `POST /events` („optional `fromPoll: { pollId, optionId }` → `validateDecision` before, `decidePoll` after creation, event gets `sourcePollId`“); Reset-Zeile: Ziele um `polls`, `pollVotes`.
- `routes-user.md`: `DELETE /account` löscht zusätzlich die Abstimmungs-Stimmen (`deleteUserPollVotes`).
- `server.js`-Knoten `server.md`: Router `/api/polls`, `startPollScheduler()` beim Start, `stopPollScheduler()` im Shutdown.
- `bot.md`: Funktionsliste um `buildPollEmbed`, `formatPollVoters`, `buildPollComponents`, `buildPollVoteReply`, `refreshPollMessages`, `markPollMessagesDeleted`, `editStoredMessages`, `handlePollVoteButton`, `handlePollVoteSelect`; Custom-IDs `poll_vote:<pollId>`, `poll_yes:<pollId>`, `poll_maybe:<pollId>`; Exports ergänzen; Hinweis, dass String-Selects außerhalb von Modals im Dispatcher vor den Buttons behandelt werden.
- `discord-integration.md`: Feature-Zeile „Date polls“ (Embed + Abstimmen-Button + private Auswahl, Live-Aktualisierung, gelöscht-Hinweis) mit Link auf [date-polls](date-polls.md).
- `frontend-app.md`: Router-Tabelle um `#polls` → `showPollsSection()` und `#poll/<id>` → `showPollDetail(id)` (Pending-Route auch für `poll/<id>`); Funktions-Tabelle um Zeilen „Date polls“ (`formatPollDate`, `formatPollOptionLabel`, `refreshPollBadge`, `showPollsSection`, `renderPollCard`, `showPollDetail`, `renderPollDetail`, `renderPollOptionRow`, `setPollVote`) und „Date polls (admin)“ (`showConfirmDialog`, `renderPollRoleCheckboxes`, `togglePollRoles`, `showPollEditor`, `addPollOptionRow`, `collectPollEditor`, `savePoll`, `renderPollAdminBar`, `showPollAnnounceDialog`, `sendPollAnnouncement`, `closePollFromUi`, `deletePollFromUi`, `showPollDecideDialog`, `startEventFromPoll`); Globals `currentPoll`, `pendingPollDecision`, `pollDeadlinePicker`.
- `frontend-markup.md`: Sektionen `#polls-section`, `#poll-detail-section`, Nav-Eintrag `#nav-polls` mit Badge, Modals `#pollEditorModal`, `#pollAnnounceModal`, `#pollDecideModal`, `#confirmModal`, CSS-Abschnitt „DATE POLLS“.
- `dev-mock-mode.md`: Seed-Abstimmungen (`POLL_ID`), Mocks `refreshPollMessages` / `markPollMessagesDeleted` (Log „Abstimmung "…" aktualisiert“).
- `utils.md`: Module `pollService.js`, `pollStore.js` mit je einer Zeile; `eventUrl.js` um `buildPollUrl`; `announcementRefresh.js` um `notifyPollChanged`/`flushPollRefreshes`; `sources` um die beiden neuen Dateien.
- `index.md`: Knotenliste „concept“ um `[date-polls](concepts/date-polls.md)`, „module“ um `[routes-polls](modules/routes-polls.md)`; Task-Tabelle „date polls, voting on dates | date-polls, routes-polls, discord-integration“; Datei-Tabelle `utils/pollService.js`, `utils/pollStore.js` → date-polls, utils; `routes/polls.js` → routes-polls, date-polls.

- [ ] **Step 4: Graph erzeugen und prüfen**

Run: `npm run wiki && npm test`
Expected: `graph.json` aktualisiert, alle Tests PASS (inkl. `test/wiki.test.js`).

- [ ] **Step 5: What's New und Version** — `updates.json` ersetzen durch:

```json
{
    "version": "2.7.0",
    "date": "2026-10-03",
    "news": [
        {
            "title": "🗳️ Terminabstimmungen",
            "content": "Admins schlagen mehrere Termine vor, ihr stimmt pro Termin mit „passt“ oder „wenn nötig“ ab – auf der Website unter „Abstimmungen“ oder direkt in Discord. Die Discord-Nachricht zeigt den Zwischenstand live."
        },
        {
            "title": "📅 Vom Termin zum Event",
            "content": "Steht der Termin fest, wird daraus mit einem Klick ein Event. Alle, die abgestimmt haben, bekommen eine DM mit dem Link zur Anmeldung."
        }
    ]
}
```

Run: `npm version 2.7.0 --no-git-tag-version`
Expected: `package.json` und `package-lock.json` zeigen `2.7.0`.

- [ ] **Step 6: Gesamtprüfung**

Run: `npm test` → PASS. Danach `npm run dev:reset && npm run dev:mock` und die Abläufe aus Task 8 und 9 einmal durchklicken; Server-Log zeigt die Mock-Aktualisierung „Abstimmung "…" aktualisiert“ nach einer Stimme auf einer geposteten Abstimmung; „What's New“ zeigt 2.7.0.

- [ ] **Step 7: Commit**

```bash
git add docs/wiki updates.json package.json package-lock.json
git commit -m "Document date polls and release 2.7.0" -m "The wiki describes the poll rules, flows, API and Discord interactions, and the What's New dialog tells members how to vote and how a poll becomes an event." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

## Abschluss

Nach Task 10: `superpowers:finishing-a-development-branch` — PR auf Deutsch (Problem / Ursache / Änderung / Verifikation) gegen `main`, sobald #35 (Rollen-Slots) gemergt ist; bis dahin gegen `feature/role-slots` oder als Entwurf. Unter „Verifikation“ festhalten, ob die Discord-Abstimmung auf einem echten Test-Server geprüft wurde.
