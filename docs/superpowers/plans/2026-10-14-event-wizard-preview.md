# Event-Assistent mit Vorschau Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Event-Assistent prüft jeden Schritt, bevor er weitergeht, und zeigt per Umschalter „Bearbeiten · Vorschau“ die Event-Karte und die Discord-Ankündigung der ungespeicherten Eingaben (D-10).

**Architecture:** Reine Prüfregeln (`admin/wizard-checks.js`) und ein reiner Discord-Zeichner (`admin/discord-preview.js`) im Frontend; `admin/wizard-marks.js` zeigt die Fehler an den Feldern, `admin/wizard-preview.js` zeichnet Karte und Nachricht. Die Nachricht baut der Server mit denselben Funktionen wie „Ankündigen“ (`POST /api/admin/events/preview`, Aufbereitung in `utils/eventPreview.js`). Der Server lehnt aktive Events ohne Startdatum und Enden vor dem Start ab.

**Tech Stack:** Node ≥ 22, Express 5, discord.js-Builder (`EmbedBuilder`, `ButtonBuilder` → `toJSON()`), native ES-Module ohne Build, Bootstrap 5, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-event-wizard-preview-design.md`

## Global Constraints

- Keine neue Abhängigkeit, kein Build-Schritt.
- Alles, was Nutzer sehen (UI, `{ error }` der API), auf Deutsch; Code, Kommentare, Commits und Wiki auf Englisch.
- Datenzugriff nur über `firebaseAdmin.js`; jede Route hat ihr eigenes `try/catch` und antwortet `res.status(x).json({ error: '<Deutsch>' })`.
- Frontend: keine Inline-Handler, keine `style`-Attribute, keine `<style>`-Elemente; Aktionen über `data-click`/`data-change` + `registerActions`; eingesetzte Werte durch `escapeHtml`, Markdown nur über `renderMarkdownSafe`.
- Farben, Schriftgrößen, Abstände, Radien nur als Tokens aus `public/css/tokens.css`; Symbole sind Bootstrap Icons (`bi-*`), keine Emojis im Frontend-Quelltext (`EMOJI_BUDGET` sinkt von 30 auf 23).
- Kein Frontend-Modul über 500 Zeilen.
- Test zuerst (rot), dann Code; `npm test` (~15 s) und am Ende `npm run test:e2e` (~45 s) grün.
- Fehlersätze genau wie in der Spec, Teil 2.
- Wiki im selben Branch nachziehen, danach `npm run wiki`.
- Commit-Nachrichten Englisch, Imperativ, Begründung im Text; `#<Zahl>` nur für GitLab-Issues.

## Review Focus

- Eine Banner-URL, die mit `https://` beginnt, aber keine URL ist (`https://`): Die Vorschau antwortet trotzdem, nur ohne Bild (discord.js wirft sonst in `setImage`). → Test in Task 2.
- Zwei schnelle Klicks auf „Vorschau“ oder Zurückschalten während des Ladens: Es erscheint nur die neueste Antwort, nie eine veraltete. → Test in Task 6.
- Erinnerungen mit überzähligen Trennern oder Leerzeichen (`24, 1,`, ` 24 ; 1 `) sind in Ordnung; `24h` und `0` werden gemeldet. → Test in Task 3.
- Labels, die sich nur in Groß-/Kleinschreibung oder Leerzeichen unterscheiden (`Discord-Name`, ` discord-name `), gelten als doppelt. → Test in Task 3.
- Vorschau eines bestehenden Slot-Events, nachdem ein Slot mit Anmeldungen entfernt wurde: Der Server antwortet trotzdem und zählt die Anmeldungen. → Test in Task 2.

---

### Vorbereitung: Spec und Plan committen

- [ ] **Schritt 1:** Spec und Plan als ersten Commit des Tickets einchecken.

```bash
git add docs/superpowers/specs/2026-10-14-event-wizard-preview-design.md docs/superpowers/plans/2026-10-14-event-wizard-preview.md
git commit -m "Plan the event wizard with checks per step and a preview

The wizard only previews the banner and checks only the title; everything
else fails as one toast after saving. D-10 adds a switch between editing
and a preview of the overview card and the Discord announcement, checks
each step before it moves on, and makes the server refuse active events
without a start date."
```

---

### Task 1: Server — Startdatum für aktive Events, Ende nicht vor dem Start

**Files:**
- Modify: `middleware/validators.js` (in `validateEvent`, nach der Status-Prüfung)
- Modify: `routes/admin.js` (`router.put('/events/:id/status', …)`, um Zeile 351)
- Test: `test/devServer.test.js` (neue Tests; `createSlotEvent` und „invalid slots …“ bekommen ein Startdatum)
- Modify: `e2e/admin.spec.js:35-39` (`createEvent` legt Entwürfe mit Startdatum an, sonst scheitert „a draft is published …“)

**Interfaces:**
- Produces: `POST`/`PUT /api/admin/events` antworten 400 mit „Aktive Events brauchen ein Startdatum.“ bzw. „Das Ende liegt vor dem Start.“ (in der gemeinsamen, mit Leerzeichen verbundenen Fehlermeldung); `PUT /api/admin/events/:id/status` antwortet 400 mit „Aktive Events brauchen ein Startdatum.“

- [ ] **Schritt 1: Failing Tests schreiben** — in `test/devServer.test.js` direkt nach dem Test `'events with an unsafe banner URL or colour are refused'` einfügen:

```js
test('an active event needs a start date, a draft does not', async () => {
    const admin = await loginAs('admin');
    const active = await admin.send('POST', '/api/admin/events', { title: 'Ohne Datum', status: 'active' });
    assert.equal(active.status, 400);
    assert.equal((await active.json()).error, 'Aktive Events brauchen ein Startdatum.');
    // Without a status the event becomes active, so it needs a date as well
    assert.equal((await admin.send('POST', '/api/admin/events', { title: 'Ohne Status' })).status, 400);

    const draft = await admin.send('POST', '/api/admin/events', { title: 'Entwurf ohne Datum', status: 'draft' });
    assert.equal(draft.status, 200);
    const { id } = await draft.json();

    const edited = await admin.send('PUT', `/api/admin/events/${id}`, { title: 'Entwurf ohne Datum', status: 'active' });
    assert.equal(edited.status, 400);
    assert.equal((await edited.json()).error, 'Aktive Events brauchen ein Startdatum.');

    const published = await admin.send('PUT', `/api/admin/events/${id}/status`, { status: 'active' });
    assert.equal(published.status, 400);
    assert.equal((await published.json()).error, 'Aktive Events brauchen ein Startdatum.');

    const dated = await admin.send('PUT', `/api/admin/events/${id}`, { title: 'Entwurf ohne Datum', status: 'draft', startDate: '2026-12-01T18:00:00.000Z' });
    assert.equal(dated.status, 200);
    assert.equal((await admin.send('PUT', `/api/admin/events/${id}/status`, { status: 'active' })).status, 200);
});

test('an event cannot end before it starts', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Rückwärts', status: 'draft', startDate: '2026-12-01T18:00:00.000Z', endDate: '2026-12-01T17:00:00.000Z'
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Das Ende liegt vor dem Start.');
});
```

- [ ] **Schritt 2: Tests laufen lassen, sie schlagen fehl**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test --test-name-pattern="start date|end before" test/devServer.test.js`
Expected: FAIL — `active.status` ist 200 statt 400.

- [ ] **Schritt 3: Validator erweitern** — in `middleware/validators.js` direkt nach dem Block `// status must be valid enum … }` einfügen:

```js
    // Members plan by the start date; reminders and the overview need it too (D-10)
    const { startDate, endDate } = req.body;
    if ((status || 'active') === 'active' && !startDate) {
        errors.push('Aktive Events brauchen ein Startdatum.');
    }
    if (startDate && endDate && new Date(endDate).getTime() < new Date(startDate).getTime()) {
        errors.push('Das Ende liegt vor dem Start.');
    }
```

- [ ] **Schritt 4: Status-Route absichern** — in `routes/admin.js`, `router.put('/events/:id/status', …)`, direkt nach `const oldEvent = eventSnap.exists() ? eventSnap.data() : {};`:

```js
        // Members plan by the start date -> an event without one stays a draft (D-10)
        if (status === 'active' && !oldEvent.startDate) {
            return res.status(400).json({ error: 'Aktive Events brauchen ein Startdatum.' });
        }
```

- [ ] **Schritt 5: Bestehende Tests mit aktiven Events ohne Datum anpassen**

In `test/devServer.test.js`, `createSlotEvent`:

```js
async function createSlotEvent(admin, title, slots, fields = {}) {
    const res = await admin.send('POST', '/api/admin/events', {
        title, status: 'active', accessMode: 'open', approvalMode: 'instant', startDate: '2026-12-01T18:00:00.000Z', slots, ...fields
    });
```

Im Test `'invalid slots are rejected with a German message'` den Körper ergänzen:

```js
    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Kaputte Slots', status: 'active', startDate: '2026-12-01T18:00:00.000Z', slots: [{ name: 'Tank', emoji: ':shield:', capacity: 1 }]
    });
```

In `e2e/admin.spec.js`, `createEvent`:

```js
    const created = await adminRequest(page, 'POST', '/api/admin/events', {
        title, status: 'draft', accessMode: 'open', approvalMode: 'instant', startDate: new Date(Date.now() + 7 * 86_400_000).toISOString(), ...fields
    });
```

- [ ] **Schritt 6: Ganze Suite laufen lassen**

Run: `npm test`
Expected: PASS. Scheitert ein weiterer Test mit „Aktive Events brauchen ein Startdatum.“, bekommt sein `POST`-Körper `startDate: '2026-12-01T18:00:00.000Z'` (die Suche nach `status: 'active'` in `test/` hat beim Planen nur die beiden Stellen aus Schritt 5 gefunden).

- [ ] **Schritt 7: Commit**

```bash
git add middleware/validators.js routes/admin.js test/devServer.test.js e2e/admin.spec.js
git commit -m "Refuse active events without a start date

An active event without a date showed \"Termin folgt\" on its card and
\"TBA\" in Discord, and its reminders never ran. Creating, editing and
publishing now need a start date for active events; drafts may wait for
one. An end before the start is refused as well."
```

---

### Task 2: Vorschau-Endpunkt

**Files:**
- Create: `utils/eventPreview.js`
- Modify: `routes/admin.js` (Importe oben; neue Route direkt vor dem JSDoc-Kommentar von `PUT /api/admin/events/:id`)
- Test: `test/eventPreview.test.js` (neu), `test/devServer.test.js`

**Interfaces:**
- Consumes: `normalizeSlots(rawSlots)`, `sumCapacity(slots)`, `buildRoster(event, registrations)` aus `utils/slotService.js`; `loadEventRoster(eventId, event)` aus `utils/eventUtils.js`; `formatPlaces(places)`, `formatWaitlist(count)` aus `utils/capacity.js`; `buildEventEmbed`, `buildEventComponents`, `getBotStatus` aus `bot.js`; `buildEventUrl(id)`.
- Produces: `buildPreviewEvent(body) → { title, description, startDate, endDate, bannerUrl, category, status, accessMode, allowGuests, formFields, accentColor, slots, maxParticipants }`; `POST /api/admin/events/preview` → `200 { embed, components, places: { taken, capacity, guests, pending, waitlist, text, waitlistText }, bot: { name, avatarUrl } }` oder `500 { error: 'Vorschau konnte nicht erstellt werden.' }`.

- [ ] **Schritt 1: Failing Unit-Tests** — `test/eventPreview.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPreviewEvent } = require('../utils/eventPreview');

test('the preview event takes the defaults of a new event', () => {
    assert.deepEqual(buildPreviewEvent({ title: 'Raidnacht' }), {
        title: 'Raidnacht', description: '', startDate: '', endDate: '', bannerUrl: '', category: '',
        status: 'active', accessMode: 'open', allowGuests: true, formFields: [], accentColor: '', slots: [], maxParticipants: 0
    });
    assert.equal(buildPreviewEvent().title, '');
});

test('slots set the places and switch guests off; broken slots are left out', () => {
    const withSlots = buildPreviewEvent({ title: 'Raid', maxParticipants: '50', allowGuests: true, slots: [{ name: 'Tank', emoji: '🛡️', capacity: 2 }, { name: 'Heiler', capacity: 3 }] });
    assert.equal(withSlots.maxParticipants, 5);
    assert.equal(withSlots.allowGuests, false);
    assert.deepEqual(withSlots.slots.map(slot => [slot.name, slot.capacity]), [['Tank', 2], ['Heiler', 3]]);

    const broken = buildPreviewEvent({ title: 'Raid', maxParticipants: '12', slots: [{ name: '', capacity: 2 }] });
    assert.deepEqual([broken.slots, broken.maxParticipants, broken.allowGuests], [[], 12, true]);
});

test('only values the Discord builders accept reach them', () => {
    const event = buildPreviewEvent({
        title: 'x'.repeat(300), description: 'y'.repeat(6000), accentColor: 'red', status: 'kaputt',
        accessMode: 'role-required', maxParticipants: '-3', category: 42,
        formFields: [{ label: '' }, { label: 'Name', type: 'text' }, null, 'Feld']
    });
    assert.equal(event.title.length, 200);
    assert.equal(event.description.length, 5000);
    assert.deepEqual([event.accentColor, event.status, event.accessMode, event.maxParticipants, event.category], ['', 'active', 'role-required', 0, '']);
    assert.deepEqual(event.formFields, [{ label: 'Name', type: 'text' }]);
    // discord.js refuses an image that is no http(s) URL
    for (const bannerUrl of ['https://', 'javascript:alert(1)', 'ftp://example.com/a.png', 'banner.png']) {
        assert.equal(buildPreviewEvent({ bannerUrl }).bannerUrl, '', bannerUrl);
    }
    assert.equal(buildPreviewEvent({ bannerUrl: 'https://example.com/raid.png' }).bannerUrl, 'https://example.com/raid.png');
});
```

- [ ] **Schritt 2: Failing Server-Tests** — in `test/devServer.test.js` nach den Tests aus Task 1:

```js
test('the wizard preview builds the Discord announcement of an unsaved event and stores nothing', async () => {
    const admin = await loginAs('admin');
    const countEvents = async () => (await (await admin.request('/api/admin/all-events')).json()).length;
    const before = await countEvents();
    const res = await admin.send('POST', '/api/admin/events/preview', {
        title: 'Vorschau-Raid', description: 'Bringt Tränke mit.', status: 'active', startDate: '2026-12-01T18:00:00.000Z',
        accessMode: 'open', slots: [{ name: 'Tank', emoji: '🛡️', capacity: 2 }, { name: 'Heiler', emoji: '💚', capacity: 3 }]
    });
    assert.equal(res.status, 200);
    const preview = await res.json();
    assert.equal(preview.embed.title, '🎉 Vorschau-Raid');
    assert.equal(preview.embed.description, 'Bringt Tränke mit.');
    assert.match(preview.embed.fields[0].name, /Datum$/);
    assert.match(preview.embed.fields[1].name, /Plätze$/);
    assert.equal(preview.embed.fields[1].value, '0 von 5 Plätzen belegt');
    assert.deepEqual(preview.components.flatMap(row => row.components).map(button => button.label), ['Tank', 'Heiler', 'Zum Event']);
    assert.equal(preview.places.text, '0 von 5 Plätzen belegt');
    assert.deepEqual(preview.bot, { name: 'DEMS Bot (Mock)', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png' });
    assert.equal(await countEvents(), before);
});

test('a half-done draft can be previewed; members and requests without a token cannot', async () => {
    const admin = await loginAs('admin');
    const draft = await admin.send('POST', '/api/admin/events/preview', { bannerUrl: 'https://' });
    assert.equal(draft.status, 200);
    const body = await draft.json();
    assert.equal(body.embed.image, undefined);
    assert.equal(body.places.text, '0 Plätze belegt');

    const member = await loginAs('member');
    assert.equal((await member.send('POST', '/api/admin/events/preview', { title: 'x' })).status, 403);
    const noToken = await admin.request('/api/admin/events/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' })
    });
    assert.equal(noToken.status, 403);
});

test('the preview of a saved event counts its registrations, also after a slot was removed', async () => {
    const admin = await loginAs('admin');
    const full = await (await admin.request(`/api/events/${EVENT_ID.FULL}`)).json();
    const res = await admin.send('POST', '/api/admin/events/preview', { ...full, id: EVENT_ID.FULL });
    assert.equal(res.status, 200);
    const preview = await res.json();
    assert.equal(preview.places.taken, 5);
    assert.match(preview.places.text, /^5 von 5 Plätzen belegt/);

    const raid = await (await admin.request(`/api/events/${EVENT_ID.ROLE}`)).json();
    const fewer = await admin.send('POST', '/api/admin/events/preview', { ...raid, id: EVENT_ID.ROLE, slots: raid.slots.slice(1) });
    assert.equal(fewer.status, 200);
    assert.ok((await fewer.json()).places.taken >= 1);
});
```

- [ ] **Schritt 3: Tests laufen lassen, sie schlagen fehl**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/eventPreview.test.js`
Expected: FAIL mit `Cannot find module '../utils/eventPreview'`.
Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test --test-name-pattern="preview" test/devServer.test.js`
Expected: FAIL — Status 404 statt 200.

- [ ] **Schritt 4: `utils/eventPreview.js` anlegen**

```js
/**
 * Unsaved event for the wizard preview (POST /api/admin/events/preview): the
 * fields the overview card and the Discord announcement show, with the
 * defaults of POST /api/admin/events. Pure, no database.
 */
const { normalizeSlots, sumCapacity } = require('./slotService');

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;
const STATUSES = ['draft', 'active', 'archived', 'cancelled'];
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

const textOf = (value, max = 2000) => (typeof value === 'string' ? value.slice(0, max) : '');

/**
 * Banner address the embed may show: discord.js refuses everything that is no http(s) URL.
 *
 * @param {*} value -> Banner URL from the wizard.
 * @returns {string} -> The URL, or '' when it is none.
 */
function bannerOf(value) {
    const url = textOf(value).trim();
    if (!url) return '';
    try {
        return ['http:', 'https:'].includes(new URL(url).protocol) ? url : '';
    } catch {
        return '';
    }
}

/**
 * Event as the preview builders need it.
 *
 * @param {Object} [body] -> Draft of collectEventDraft() (public/js/admin/wizard.js), may be incomplete.
 * @returns {Object} -> `{ title, description, startDate, endDate, bannerUrl, category, status, accessMode, allowGuests, formFields, accentColor, slots, maxParticipants }`; broken slots are left out (the wizard reports them).
 */
function buildPreviewEvent(body = {}) {
    const slotResult = normalizeSlots(body.slots);
    const slots = slotResult.error ? [] : slotResult.slots;
    return {
        title: textOf(body.title, TITLE_MAX),
        description: textOf(body.description, DESCRIPTION_MAX),
        startDate: textOf(body.startDate, 40),
        endDate: textOf(body.endDate, 40),
        bannerUrl: bannerOf(body.bannerUrl),
        category: textOf(body.category, 100),
        status: STATUSES.includes(body.status) ? body.status : 'active',
        accessMode: body.accessMode === 'role-required' ? 'role-required' : 'open',
        allowGuests: slots.length > 0 ? false : body.allowGuests !== false,
        formFields: Array.isArray(body.formFields)
            ? body.formFields.filter(field => field && typeof field === 'object' && typeof field.label === 'string' && field.label.trim())
            : [],
        accentColor: typeof body.accentColor === 'string' && HEX_COLOR.test(body.accentColor) ? body.accentColor : '',
        slots,
        maxParticipants: slots.length > 0 ? sumCapacity(slots) : Math.max(0, parseInt(body.maxParticipants, 10) || 0)
    };
}

module.exports = { buildPreviewEvent };
```

- [ ] **Schritt 5: Route anlegen** — in `routes/admin.js` die Importe ändern:

```js
const { describePlaces, formatPlaces, formatWaitlist } = require('../utils/capacity');
const { getSlots, findSlot, formatSlotLabel, normalizeSlots, sumCapacity, resolveAcceptanceSlot, buildRoster } = require('../utils/slotService');
const { buildPreviewEvent } = require('../utils/eventPreview');
```

und direkt vor dem JSDoc-Kommentar `/** PUT /api/admin/events/:id …` einfügen:

```js
/**
 * POST /api/admin/events/preview — Discord announcement and places of an
 * unsaved event for the wizard preview; built like "Ankündigen", stores nothing
 */
router.post('/events/preview', async (req, res) => {
    try {
        const id = typeof req.body.id === 'string' ? req.body.id : '';
        const event = buildPreviewEvent(req.body);
        // A new event shows the message as right after announcing it: nobody registered yet
        const roster = id ? await loadEventRoster(id, event) : buildRoster(event, []);
        const linkId = id || 'vorschau';
        const bot = getBotStatus() || {};
        res.json({
            embed: buildEventEmbed(event, buildEventUrl(linkId), roster).toJSON(),
            components: buildEventComponents(event, linkId, roster).map(row => row.toJSON()),
            places: { ...roster.places, text: formatPlaces(roster.places), waitlistText: formatWaitlist(roster.places.waitlist) },
            bot: { name: String(bot.username || 'DEMS').replace(/#\d+$/, ''), avatarUrl: bot.avatarUrl || null }
        });
    } catch (err) {
        console.error('Event preview error:', err);
        res.status(500).json({ error: 'Vorschau konnte nicht erstellt werden.' });
    }
});
```

- [ ] **Schritt 6: Tests laufen lassen, sie bestehen**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/eventPreview.test.js` und `… --test-name-pattern="preview" test/devServer.test.js`
Expected: PASS. Stimmt `'0 Plätze belegt'` nicht, gibt `formatPlaces` für unbegrenzte Events einen anderen Satz zurück: den Wert aus `utils/capacity.js` (`formatPlaces`) übernehmen, nicht den Code ändern.

- [ ] **Schritt 7: `npm test`, dann Commit**

```bash
git add utils/eventPreview.js routes/admin.js test/eventPreview.test.js test/devServer.test.js
git commit -m "Build the Discord announcement of an unsaved event for a preview

The wizard is to show the announcement before anything is saved. The new
admin route runs the same embed and button builders as \"Ankündigen\" on
the draft and returns their JSON with the places and the bot's name and
avatar; a draft may be incomplete, and nothing is stored or sent."
```

---

### Task 3: Prüfregeln des Assistenten

**Files:**
- Create: `public/js/admin/wizard-checks.js`
- Test: `test/wizardChecks.test.js` (neu)

**Interfaces:**
- Produces:
  - `SLOT_NAME_MAX_LENGTH = 30`, `SLOT_CAPACITY_MIN = 1`, `SLOT_CAPACITY_MAX = 100`
  - `STEP_FIELDS: { 1: ['title','bannerUrl'], 2: ['startDate','endDate','recurringUntil'], 3: ['maxParticipants','reminderHours','requiredRoles','slots'], 4: ['formFields'], 5: [] }`
  - `WIZARD_MESSAGES` (Sätze; Funktionen für Sätze mit Namen)
  - `checkWizardStep(step: number, draft: Object) → Array<{ field: string, message: string }>`; `draft` hat die Form von `collectEventDraft()` (Task 5): `title`, `bannerUrl`, `startDate` (ISO oder `''`), `endDate`, `status`, `recurring` (bool), `recurringUntil` (`YYYY-MM-DD` oder `''`), `maxParticipants` (Text), `reminderHours` (Text), `accessMode`, `requiredRoles` (Array), `slots` (`[{ name, emoji, capacity }]`), `formFields` (`[{ label, type, required, options? }]`)

- [ ] **Schritt 1: Failing Tests** — `test/wizardChecks.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');
const { normalizeSlots } = require('../utils/slotService');

const FILE = path.join(REPO_ROOT, 'public', 'js', 'admin', 'wizard-checks.js');
const load = async () => (await loadFrontendModules(FILE, vm.createContext({}))).get('wizard-checks.js');

// A draft as collectEventDraft() returns it, everything valid
const draft = (fields = {}) => ({
    title: 'Raidnacht', description: '', bannerUrl: '', startDate: '2026-12-01T18:00:00.000Z', endDate: '2026-12-01T21:00:00.000Z',
    maxParticipants: '0', category: '', accessMode: 'open', approvalMode: 'manual', status: 'active', reminderHours: '24, 1',
    assignRoleId: '', requiredRoles: [], formFields: [], recurring: false, recurringInterval: 'weekly', recurringUntil: '',
    slots: [], ...fields
});

/** checkWizardStep with plain results: the module runs in its own realm, whose arrays deepEqual would not accept. */
async function checker() {
    const { checkWizardStep } = await load();
    return (step, fields) => JSON.parse(JSON.stringify(checkWizardStep(step, draft(fields))));
}

test('a valid draft passes every step', async () => {
    const check = await checker();
    for (const step of [1, 2, 3, 4, 5]) assert.deepEqual(check(step), [], `step ${step}`);
});

test('step 1 wants a title and an http(s) banner', async () => {
    const check = await checker();
    assert.deepEqual(check(1, { title: '   ' }), [{ field: 'title', message: 'Bitte einen Titel eingeben.' }]);
    assert.deepEqual(check(1, { bannerUrl: 'ftp://example.com/a.png' }), [{ field: 'bannerUrl', message: 'Die Banner-URL muss mit http:// oder https:// beginnen.' }]);
    assert.deepEqual(check(1, { bannerUrl: 'HTTPS://example.com/a.png' }), []);
});

test('step 2: an active event needs a start, a draft does not; the end cannot come first', async () => {
    const check = await checker();
    assert.deepEqual(check(2, { startDate: '', endDate: '' }), [{ field: 'startDate', message: 'Aktive Events brauchen ein Startdatum.' }]);
    assert.deepEqual(check(2, { status: 'draft', startDate: '', endDate: '' }), []);
    assert.deepEqual(check(2, { endDate: '2026-12-01T17:00:00.000Z' }), [{ field: 'endDate', message: 'Das Ende liegt vor dem Start.' }]);
    // A start in the past is fine: admins edit past events too
    assert.deepEqual(check(2, { startDate: '2020-01-01T18:00:00.000Z', endDate: '' }), []);
});

test('step 2: a series needs a start and an end of the repetition after it', async () => {
    const check = await checker();
    assert.deepEqual(check(2, { recurring: true }), [{ field: 'recurringUntil', message: 'Bis wann soll sich das Event wiederholen?' }]);
    assert.deepEqual(check(2, { recurring: true, recurringUntil: '2026-11-30' }), [{ field: 'recurringUntil', message: '„Wiederholen bis“ liegt vor dem Start.' }]);
    // Same day as the start: the server includes the whole last day
    assert.deepEqual(check(2, { recurring: true, recurringUntil: '2026-12-01' }), []);
    assert.deepEqual(check(2, { status: 'draft', recurring: true, recurringUntil: '2026-12-31', startDate: '', endDate: '' }), [{ field: 'startDate', message: 'Eine Serie braucht ein Startdatum.' }]);
});

test('step 3: places, reminders and the roles of a role event', async () => {
    const check = await checker();
    for (const max of ['-1', '2.5', 'zehn']) {
        assert.deepEqual(check(3, { maxParticipants: max }), [{ field: 'maxParticipants', message: 'Bitte eine ganze Zahl ab 0 eingeben.' }], max);
    }
    assert.deepEqual(check(3, { maxParticipants: '' }), []);
    for (const reminders of ['24, 1,', ' 24 ; 1 ', '', '0.5']) assert.deepEqual(check(3, { reminderHours: reminders }), [], reminders);
    assert.deepEqual(check(3, { reminderHours: '24, 24h, 0' }), [{ field: 'reminderHours', message: '„24h“ ist keine Stundenzahl.' }]);
    assert.deepEqual(check(3, { reminderHours: '0' }), [{ field: 'reminderHours', message: '„0“ ist keine Stundenzahl.' }]);
    assert.deepEqual(check(3, { accessMode: 'role-required' }), [{ field: 'requiredRoles', message: 'Wähle mindestens eine Rolle.' }]);
    assert.deepEqual(check(3, { accessMode: 'role-required', requiredRoles: ['r1'] }), []);
});

test('step 3: slots need a unique name and 1–100 places; the place field is ignored then', async () => {
    const check = await checker();
    const slot = (name, capacity = 2) => ({ name, emoji: '', capacity });
    assert.deepEqual(check(3, { maxParticipants: 'egal', slots: [slot('Tank'), slot('Heiler')] }), []);
    assert.deepEqual(check(3, { slots: [slot('Tank'), slot('')] }), [{ field: 'slots.1.name', message: 'Jeder Slot braucht einen Namen mit 1–30 Zeichen.' }]);
    assert.deepEqual(check(3, { slots: [slot('Tank'), slot(' tank ')] }), [{ field: 'slots.1.name', message: 'Slot-Name „tank“ ist doppelt vergeben.' }]);
    assert.deepEqual(check(3, { slots: [slot('Tank', 0), slot('Heiler', 101)] }), [
        { field: 'slots.0.capacity', message: 'Slot „Tank“ braucht 1–100 Plätze.' },
        { field: 'slots.1.capacity', message: 'Slot „Heiler“ braucht 1–100 Plätze.' }
    ]);
    assert.deepEqual(check(3, { slots: [slot('x'.repeat(31))] }).map(error => error.field), ['slots.0.name']);
});

test('the slot sentences are the ones of the server', async () => {
    const check = await checker();
    const cases = [
        [{ name: '', capacity: 1 }],
        [{ name: 'Tank', capacity: 1 }, { name: 'tank', capacity: 1 }],
        [{ name: 'Tank', capacity: 0 }]
    ];
    for (const slots of cases) assert.equal(check(3, { slots })[0].message, normalizeSlots(slots).error, JSON.stringify(slots));
});

test('step 4: every field has a label of its own and a choice field has options', async () => {
    const check = await checker();
    const field = (label, extra = {}) => ({ label, type: 'text', required: false, ...extra });
    assert.deepEqual(check(4, { formFields: [field('Name'), field('')] }), [{ field: 'formFields.1.label', message: 'Jedes Feld braucht ein Label.' }]);
    assert.deepEqual(check(4, { formFields: [field('Discord-Name'), field(' discord-name ')] }), [
        { field: 'formFields.1.label', message: 'Das Label „discord-name“ gibt es schon. Antworten werden nach dem Label gespeichert.' }
    ]);
    assert.deepEqual(check(4, { formFields: [field('Klasse', { type: 'dropdown', options: [] })] }), [{ field: 'formFields.0.options', message: 'Ein Auswahlfeld braucht mindestens eine Option.' }]);
    assert.deepEqual(check(4, { formFields: [field('Klasse', { type: 'dropdown', options: ['Magier'] })] }), []);
});

test('step 5 has nothing to check, and every step names its fields', async () => {
    const check = await checker();
    const { STEP_FIELDS } = await load();
    assert.deepEqual(check(5, { title: '' }), []);
    assert.deepEqual(JSON.parse(JSON.stringify(STEP_FIELDS)), {
        1: ['title', 'bannerUrl'], 2: ['startDate', 'endDate', 'recurringUntil'],
        3: ['maxParticipants', 'reminderHours', 'requiredRoles', 'slots'], 4: ['formFields'], 5: []
    });
});
```

- [ ] **Schritt 2: Tests laufen lassen, sie schlagen fehl**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/wizardChecks.test.js`
Expected: FAIL mit `ENOENT … wizard-checks.js`.

- [ ] **Schritt 3: `public/js/admin/wizard-checks.js` anlegen**

```js
/**
 * Rules of the event wizard, step by step. Pure: gets the draft of
 * collectEventDraft() (admin/wizard.js) and returns the problems as
 * [{ field, message }]; admin/wizard-marks.js shows them at the fields.
 * Slot limits and sentences mirror normalizeSlots in utils/slotService.js.
 */

export const SLOT_NAME_MAX_LENGTH = 30;
export const SLOT_CAPACITY_MIN = 1;
export const SLOT_CAPACITY_MAX = 100;

// Field keys per step; "slots" and "formFields" stand for all rows of their builder
export const STEP_FIELDS = {
    1: ['title', 'bannerUrl'],
    2: ['startDate', 'endDate', 'recurringUntil'],
    3: ['maxParticipants', 'reminderHours', 'requiredRoles', 'slots'],
    4: ['formFields'],
    5: []
};

export const WIZARD_MESSAGES = {
    title: 'Bitte einen Titel eingeben.',
    bannerUrl: 'Die Banner-URL muss mit http:// oder https:// beginnen.',
    startRequired: 'Aktive Events brauchen ein Startdatum.',
    endBeforeStart: 'Das Ende liegt vor dem Start.',
    recurringUntil: 'Bis wann soll sich das Event wiederholen?',
    recurringStart: 'Eine Serie braucht ein Startdatum.',
    recurringUntilBeforeStart: '„Wiederholen bis“ liegt vor dem Start.',
    maxParticipants: 'Bitte eine ganze Zahl ab 0 eingeben.',
    reminder: (entry) => `„${entry}“ ist keine Stundenzahl.`,
    requiredRoles: 'Wähle mindestens eine Rolle.',
    slotName: `Jeder Slot braucht einen Namen mit 1–${SLOT_NAME_MAX_LENGTH} Zeichen.`,
    slotNameTaken: (name) => `Slot-Name „${name}“ ist doppelt vergeben.`,
    slotCapacity: (name) => `Slot „${name}“ braucht ${SLOT_CAPACITY_MIN}–${SLOT_CAPACITY_MAX} Plätze.`,
    fieldLabel: 'Jedes Feld braucht ein Label.',
    fieldLabelTaken: (label) => `Das Label „${label}“ gibt es schon. Antworten werden nach dem Label gespeichert.`,
    fieldOptions: 'Ein Auswahlfeld braucht mindestens eine Option.'
};

const HTTP_URL = /^https?:\/\//i;
const WHOLE_NUMBER = /^\d+$/;

/**
 * Date of an ISO string.
 *
 * @param {string} value -> ISO date or ''.
 * @returns {Date|null} -> The date, null when there is none.
 */
function dateOf(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function checkBasics(draft, add) {
    if (!String(draft.title ?? '').trim()) add('title', WIZARD_MESSAGES.title);
    const banner = String(draft.bannerUrl ?? '').trim();
    if (banner && !HTTP_URL.test(banner)) add('bannerUrl', WIZARD_MESSAGES.bannerUrl);
}

function checkDates(draft, add) {
    const start = dateOf(draft.startDate);
    const end = dateOf(draft.endDate);
    if (draft.status === 'active' && !start) add('startDate', WIZARD_MESSAGES.startRequired);
    if (start && end && end < start) add('endDate', WIZARD_MESSAGES.endBeforeStart);
    if (!draft.recurring) return;
    if (!start && draft.status !== 'active') add('startDate', WIZARD_MESSAGES.recurringStart);
    const until = String(draft.recurringUntil ?? '');
    if (!until) add('recurringUntil', WIZARD_MESSAGES.recurringUntil);
    // The server compares the UTC day of each start with this date
    else if (start && until < start.toISOString().slice(0, 10)) add('recurringUntil', WIZARD_MESSAGES.recurringUntilBeforeStart);
}

function checkSlots(slots, add) {
    const names = new Set();
    slots.forEach((slot, index) => {
        const name = String(slot?.name ?? '').trim();
        if (!name || name.length > SLOT_NAME_MAX_LENGTH) {
            add(`slots.${index}.name`, WIZARD_MESSAGES.slotName);
            return;
        }
        if (names.has(name.toLowerCase())) {
            add(`slots.${index}.name`, WIZARD_MESSAGES.slotNameTaken(name));
            return;
        }
        names.add(name.toLowerCase());
        const capacity = Number(slot.capacity);
        if (!Number.isInteger(capacity) || capacity < SLOT_CAPACITY_MIN || capacity > SLOT_CAPACITY_MAX) {
            add(`slots.${index}.capacity`, WIZARD_MESSAGES.slotCapacity(name));
        }
    });
}

function checkParticipants(draft, add) {
    const slots = Array.isArray(draft.slots) ? draft.slots : [];
    const max = String(draft.maxParticipants ?? '').trim();
    // With slots the places are the sum of the slots; the field is locked then
    if (slots.length === 0 && max && !WHOLE_NUMBER.test(max)) add('maxParticipants', WIZARD_MESSAGES.maxParticipants);
    const unreadable = String(draft.reminderHours ?? '').split(/[\s,;]+/).filter(Boolean)
        .find(entry => !(Number(entry) > 0));
    if (unreadable !== undefined) add('reminderHours', WIZARD_MESSAGES.reminder(unreadable));
    if (draft.accessMode === 'role-required' && !(Array.isArray(draft.requiredRoles) && draft.requiredRoles.length > 0)) {
        add('requiredRoles', WIZARD_MESSAGES.requiredRoles);
    }
    checkSlots(slots, add);
}

function checkFormFields(draft, add) {
    const labels = new Set();
    (Array.isArray(draft.formFields) ? draft.formFields : []).forEach((field, index) => {
        const label = String(field?.label ?? '').trim();
        if (!label) {
            add(`formFields.${index}.label`, WIZARD_MESSAGES.fieldLabel);
            return;
        }
        // Answers are stored by label -> two fields with one label overwrite each other
        if (labels.has(label.toLowerCase())) add(`formFields.${index}.label`, WIZARD_MESSAGES.fieldLabelTaken(label));
        labels.add(label.toLowerCase());
        if (field.type === 'dropdown' && !(Array.isArray(field.options) && field.options.length > 0)) {
            add(`formFields.${index}.options`, WIZARD_MESSAGES.fieldOptions);
        }
    });
}

const STEP_CHECKS = { 1: checkBasics, 2: checkDates, 3: checkParticipants, 4: checkFormFields };

/**
 * Problems of one wizard step.
 *
 * @param {number} step -> 1–5.
 * @param {Object} draft -> Input of collectEventDraft().
 * @returns {Array<{field: string, message: string}>} -> One entry per problem in the order of the form; empty when the step is fine.
 */
export function checkWizardStep(step, draft) {
    const errors = [];
    const check = STEP_CHECKS[step];
    if (check) check(draft || {}, (field, message) => errors.push({ field, message }));
    return errors;
}
```

- [ ] **Schritt 4: Tests laufen lassen, sie bestehen**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/wizardChecks.test.js`
Expected: PASS (9 Tests).

- [ ] **Schritt 5: Commit**

```bash
git add public/js/admin/wizard-checks.js test/wizardChecks.test.js
git commit -m "Add the rules of the event wizard as a pure module

Each step of the wizard gets its own list of problems with the sentence
to show at the field. Empty form labels, unreadable reminders and series
without an end were dropped silently so far; the slot sentences are the
server's, a test keeps them equal."
```

---

### Task 4: Discord-Darstellung

**Files:**
- Create: `public/js/admin/discord-preview.js`
- Modify: `public/css/tokens.css` (nach `--on-discord`), `public/css/style.css` (neuer Block nach „EVENT WIZARD STEPPER“)
- Test: `test/discordPreview.test.js` (neu), `test/designTokens.test.js` (`FILLS`, neuer Test)

**Interfaces:**
- Consumes: `escapeHtml`, `renderMarkdownSafe` aus `core/ui.js`; `avatar({ url, name })` aus `core/components.js`; Antwort von `POST /api/admin/events/preview` (Task 2).
- Produces: `discordColor(value) → '#rrggbb' | ''`, `discordTime(value, now) → 'Heute um 18:05' | '01.12.2026 18:05' | ''`, `renderDiscordMessage(preview, now) → string` (HTML eines `div.discord-message`).

- [ ] **Schritt 1: Failing Tests** — `test/discordPreview.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

const FILE = path.join(REPO_ROOT, 'public', 'js', 'admin', 'discord-preview.js');
const NOW = new Date(2026, 9, 14, 18, 5);
// marked wraps the text in a paragraph; sanitizing is tested with ui.js
const load = async () => (await loadFrontendModules(FILE, vm.createContext({
    marked: { parse: (text) => `<p>${text}</p>` },
    DOMPurify: { sanitize: (html) => html }
}))).get('discord-preview.js');

const PREVIEW = {
    embed: {
        title: '🎉 Raidnacht', description: 'Bringt **Tränke** mit.', color: 0x8b5cf6,
        fields: [
            { name: '🗓️ Datum', value: '1.12.2026, 19:00:00', inline: true },
            { name: '👥 Plätze', value: '0 von 6 Plätzen belegt', inline: true },
            { name: '📋 Anmeldung', value: '[Hier anmelden](http://localhost:3000/#event/vorschau)', inline: false }
        ],
        image: { url: 'https://example.com/raid.png' },
        footer: { text: 'DEMS — Event Management' },
        timestamp: new Date(2026, 9, 14, 18, 0).toISOString()
    },
    components: [{
        type: 1, components: [
            { type: 2, style: 1, label: 'Tank', emoji: { name: '🛡️' }, custom_id: 'slot:vorschau:tank' },
            { type: 2, style: 2, label: 'Heiler (voll)', emoji: { name: '💚' }, custom_id: 'slot:vorschau:heal' },
            { type: 2, style: 5, label: 'Zum Event', emoji: { name: '🔗' }, url: 'http://localhost:3000/#event/vorschau' }
        ]
    }],
    bot: { name: 'DEMS Bot', avatarUrl: 'https://cdn.example/bot.png' }
};

test('the head shows the bot with its avatar, the APP tag and the time', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage(PREVIEW, NOW);
    assert.match(html, /^<div class="discord-message"><img class="avatar" src="https:\/\/cdn\.example\/bot\.png" alt="DEMS Bot"/);
    assert.ok(html.includes('<span class="discord-message-author">DEMS Bot</span><span class="discord-app-tag">APP</span><span class="discord-message-time">Heute um 18:05</span>'), html);
});

test('the embed carries colour, title, description, fields, image and footer', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage(PREVIEW, NOW);
    assert.ok(html.includes('<div class="discord-embed" data-style-border-color="#8b5cf6">'), html);
    assert.ok(html.includes('<div class="discord-embed-title">🎉 Raidnacht</div>'));
    assert.ok(html.includes('<div class="discord-embed-description"><p>Bringt **Tränke** mit.</p></div>'));
    assert.equal((html.match(/class="discord-field"/g) || []).length, 2);
    assert.equal((html.match(/class="discord-field is-wide"/g) || []).length, 1);
    assert.ok(html.includes('<img class="discord-embed-image" src="https://example.com/raid.png" alt="" data-fallback="hide">'));
    assert.ok(html.includes('<div class="discord-embed-footer">DEMS — Event Management • Heute um 18:00</div>'));
});

test('buttons keep their Discord style, the emoji and a link symbol', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage(PREVIEW, NOW);
    assert.ok(html.includes('<span class="discord-button is-primary"><span class="discord-button-emoji">🛡️</span>Tank</span>'));
    assert.ok(html.includes('<span class="discord-button is-secondary"><span class="discord-button-emoji">💚</span>Heiler (voll)</span>'));
    assert.ok(html.includes('<span class="discord-button is-link"><span class="discord-button-emoji">🔗</span>Zum Event<i class="bi bi-box-arrow-up-right"></i></span>'));
});

test('texts from admins and Discord are escaped', async () => {
    const { renderDiscordMessage } = await load();
    const evil = '<img src=x onerror=alert(1)>';
    const html = renderDiscordMessage({
        embed: { title: evil, fields: [{ name: evil, value: 'x', inline: true }], footer: { text: evil } },
        components: [{ type: 1, components: [{ type: 2, style: 1, label: evil, emoji: { name: evil } }] }],
        bot: { name: evil }
    }, NOW);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /\sstyle=/);
});

test('missing or odd data still gives a message', async () => {
    const { renderDiscordMessage, discordColor, discordTime } = await load();
    const html = renderDiscordMessage({}, NOW);
    assert.ok(html.includes('<span class="discord-message-author">DEMS</span>'));
    assert.ok(html.includes('<div class="discord-embed">'));
    assert.doesNotMatch(html, /discord-embed-title|discord-buttons|discord-embed-footer/);
    assert.deepEqual([discordColor(0), discordColor(0x22c55e), discordColor(-1), discordColor('x'), discordColor(2 ** 24)], ['#000000', '#22c55e', '', '', '']);
    assert.equal(discordTime('kein Datum', NOW), '');
    assert.match(discordTime(new Date(2026, 11, 1, 19, 0).toISOString(), NOW), /^01\.12\.2026 19:00$/);
});
```

In `test/designTokens.test.js` `FILLS` ändern und einen Test anhängen:

```js
    '--on-discord': ['--discord', '--discord-hover', '--discord-button-secondary', '--discord-button-success', '--discord-button-danger']
```

```js
test('the Discord preview reaches AA contrast on both Discord surfaces', async () => {
    const { color, ratio } = await loadPalette();
    const failures = [];
    for (const background of ['--discord-bg', '--discord-embed-bg']) {
        for (const text of ['--discord-text', '--discord-heading', '--discord-muted', '--discord-link']) {
            failures.push(...tooLow(`${text} on ${background}`, ratio(text, color(background)), AA_TEXT));
        }
    }
    assert.deepEqual(failures, []);
});
```

- [ ] **Schritt 2: Tests laufen lassen, sie schlagen fehl**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/discordPreview.test.js test/designTokens.test.js`
Expected: FAIL (`ENOENT … discord-preview.js`; `--discord-button-secondary is not a plain colour`).

- [ ] **Schritt 3: Tokens** — in `public/css/tokens.css` nach `--on-discord: #ffffff;`:

```css

  /* Discord look of the wizard preview (dark Discord design) */
  --discord-bg: #313338;
  --discord-embed-bg: #2b2d31;
  --discord-text: #dbdee1;
  --discord-heading: #f2f3f5;
  --discord-muted: #9ba1ab;
  --discord-link: #00a8fc;
  --discord-button-secondary: #4e5058;
  --discord-button-success: #248046;
  --discord-button-danger: #da373c;
```

- [ ] **Schritt 4: `public/js/admin/discord-preview.js` anlegen**

```js
/**
 * Discord look of an event announcement: draws the JSON of
 * POST /api/admin/events/preview (embed and button rows of discord.js).
 * Pure: no DOM, no fetch. Styles: block "DISCORD PREVIEW" in style.css.
 */
import { escapeHtml, renderMarkdownSafe } from '../core/ui.js';
import { avatar } from '../core/components.js';

// discord.js ButtonStyle -> class; 5 is a link button
const BUTTON_STYLES = { 1: 'is-primary', 2: 'is-secondary', 3: 'is-success', 4: 'is-danger', 5: 'is-link' };
const LINK_STYLE = 5;

/**
 * Colour of an embed.
 *
 * @param {number} value -> Colour as discord.js stores it (0xRRGGBB).
 * @returns {string} -> '#rrggbb', '' for anything else.
 */
export function discordColor(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) return '';
    return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * Time as Discord shows it next to a message.
 *
 * @param {string|null} value -> ISO date; null for "now".
 * @param {Date} now -> Reference time.
 * @returns {string} -> "Heute um 18:05", another day "01.12.2026 18:05", '' for an unreadable date.
 */
export function discordTime(value, now) {
    const date = value ? new Date(value) : now;
    if (Number.isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === now.toDateString()) return `Heute um ${time}`;
    return `${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${time}`;
}

function renderField(field) {
    const className = field?.inline ? 'discord-field' : 'discord-field is-wide';
    return `<div class="${className}"><div class="discord-field-name">${escapeHtml(String(field?.name ?? ''))}</div>`
        + `<div class="discord-field-value">${renderMarkdownSafe(String(field?.value ?? ''))}</div></div>`;
}

function renderButton(button) {
    const style = BUTTON_STYLES[button?.style] || 'is-secondary';
    const emoji = button?.emoji?.name ? `<span class="discord-button-emoji">${escapeHtml(String(button.emoji.name))}</span>` : '';
    const link = button?.style === LINK_STYLE ? '<i class="bi bi-box-arrow-up-right"></i>' : '';
    return `<span class="discord-button ${style}">${emoji}${escapeHtml(String(button?.label ?? ''))}${link}</span>`;
}

function renderEmbed(embed, footer) {
    const color = discordColor(embed.color);
    const fields = Array.isArray(embed.fields) && embed.fields.length > 0
        ? `<div class="discord-embed-fields">${embed.fields.map(renderField).join('')}</div>`
        : '';
    const image = embed.image?.url
        ? `<img class="discord-embed-image" src="${escapeHtml(String(embed.image.url))}" alt="" data-fallback="hide">`
        : '';
    return `<div class="discord-embed"${color ? ` data-style-border-color="${color}"` : ''}>`
        + (embed.title ? `<div class="discord-embed-title">${escapeHtml(String(embed.title))}</div>` : '')
        + (embed.description ? `<div class="discord-embed-description">${renderMarkdownSafe(String(embed.description))}</div>` : '')
        + fields + image + footer + '</div>';
}

/**
 * One Discord message with its embed and button rows.
 *
 * @param {Object} preview -> `{ embed, components, bot: { name, avatarUrl } }` of the preview route.
 * @param {Date} now -> Reference time for "Heute um …".
 * @returns {string} -> HTML of a div.discord-message; the embed colour sits in data-style-border-color (applyStyleData).
 */
export function renderDiscordMessage(preview, now) {
    const embed = preview?.embed || {};
    const botName = String(preview?.bot?.name || 'DEMS');
    const footerParts = [embed.footer?.text, embed.timestamp ? discordTime(embed.timestamp, now) : '']
        .filter(Boolean)
        .map(part => escapeHtml(String(part)));
    const footer = footerParts.length > 0 ? `<div class="discord-embed-footer">${footerParts.join(' • ')}</div>` : '';
    const rows = (Array.isArray(preview?.components) ? preview.components : [])
        .map(row => `<div class="discord-buttons">${(Array.isArray(row?.components) ? row.components : []).map(renderButton).join('')}</div>`)
        .join('');
    return '<div class="discord-message">'
        + avatar({ url: preview?.bot?.avatarUrl, name: botName })
        + '<div class="discord-message-body">'
        + `<div class="discord-message-header"><span class="discord-message-author">${escapeHtml(botName)}</span>`
        + `<span class="discord-app-tag">APP</span><span class="discord-message-time">${escapeHtml(discordTime(null, now))}</span></div>`
        + renderEmbed(embed, footer) + rows
        + '</div></div>';
}
```

- [ ] **Schritt 5: Stile** — in `public/css/style.css` nach dem `@media (max-width: 576px) { … }` des Blocks „EVENT WIZARD STEPPER“ einfügen:

```css
/* ═══════════════════════════════════════════ */
/* DISCORD PREVIEW                             */
/* renderDiscordMessage() in                   */
/* admin/discord-preview.js                    */
/* ═══════════════════════════════════════════ */
.discord-message {
  display: flex;
  gap: var(--space-12);
  padding: var(--space-12) var(--space-16);
  border-radius: var(--radius);
  background: var(--discord-bg);
  color: var(--discord-text);
  font-size: var(--font-size-sm);
}

.discord-message-body {
  flex: 1;
  min-width: 0;
}

.discord-message-header {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-bottom: var(--space-4);
}

.discord-message-author {
  color: var(--discord-heading);
  font-weight: 600;
}

.discord-app-tag {
  padding: 0 var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--discord);
  color: var(--on-discord);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.discord-message-time {
  color: var(--discord-muted);
  font-size: var(--font-size-xs);
}

/* Only the left edge is drawn; applyStyleData colours it (data-style-border-color) */
.discord-embed {
  max-width: 32rem;
  padding: var(--space-8) var(--space-16) var(--space-16) var(--space-12);
  border: 0 solid var(--discord-muted);
  border-left-width: 4px;
  border-radius: var(--radius-sm);
  background: var(--discord-embed-bg);
}

.discord-embed a {
  color: var(--discord-link);
}

.discord-embed-title {
  margin-bottom: var(--space-8);
  color: var(--discord-heading);
  font-weight: 700;
}

.discord-embed-description p:last-child,
.discord-field-value p {
  margin-bottom: 0;
}

.discord-embed-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-8);
  margin-top: var(--space-8);
}

.discord-field.is-wide {
  grid-column: 1 / -1;
}

.discord-field-name {
  color: var(--discord-heading);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.discord-embed-image {
  display: block;
  max-width: 100%;
  margin-top: var(--space-12);
  border-radius: var(--radius-sm);
}

.discord-embed-footer {
  margin-top: var(--space-8);
  color: var(--discord-muted);
  font-size: var(--font-size-xs);
}

.discord-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
  margin-top: var(--space-8);
}

.discord-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-16);
  border-radius: var(--radius-sm);
  color: var(--on-discord);
  font-weight: 500;
}

.discord-button.is-primary {
  background: var(--discord);
}

.discord-button.is-secondary,
.discord-button.is-link {
  background: var(--discord-button-secondary);
}

.discord-button.is-success {
  background: var(--discord-button-success);
}

.discord-button.is-danger {
  background: var(--discord-button-danger);
}
```

- [ ] **Schritt 6: Tests laufen lassen, sie bestehen**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/discordPreview.test.js test/designTokens.test.js test/cssRules.test.js`
Expected: PASS. Fällt ein Kontrast-Paar durch, den betroffenen `--discord-*`-Ton in `tokens.css` leicht aufhellen (Text) bzw. abdunkeln (Fläche), bis 4,5:1 erreicht ist.

- [ ] **Schritt 7: Commit**

```bash
git add public/js/admin/discord-preview.js public/css/tokens.css public/css/style.css test/discordPreview.test.js test/designTokens.test.js
git commit -m "Draw a Discord message from the embed JSON of the bot

The wizard preview shows the announcement the server builds. The drawing
follows Discord's dark design with its own colour tokens, all of them at
AA contrast, and escapes every text it gets."
```

---

### Task 5: Der Assistent prüft jeden Schritt

**Files:**
- Create: `public/js/admin/wizard-marks.js`, `public/js/admin/wizard-location.js`
- Modify: `public/js/admin/wizard.js` (Ort-Autovervollständigung raus; `collectEventDraft`, `updateStartRequired`, `wizardNext`, `saveEvent`, `showCreateEventModal`, `editEvent`, Aktionen)
- Modify: `public/js/admin/wizard-builders.js` (`getFormFieldsFromBuilder` ohne Filter)
- Modify: `public/js/main.js` (Import `./admin/wizard-location.js`)
- Modify: `public/index.html` (Feedback-Elemente, Sternchen, Icons statt Emojis, `data-change` am Status)
- Modify: `public/css/style.css` (`.wizard-step-item.has-error`)
- Modify: `test/cssRules.test.js` (`EMOJI_BUDGET = 23`)
- Modify: `e2e/csp.spec.js` (Status „Entwurf“ vor dem zweiten „Weiter“)
- Test: `test/wizardFlow.test.js` (neu)

**Interfaces:**
- Consumes: `checkWizardStep`, `STEP_FIELDS` (Task 3).
- Produces:
  - `collectEventDraft() → Object` (die Felder des bisherigen `saveEvent`-Körpers; `formFields` ungefiltert)
  - `updateStartRequired() → void`
  - `showStepErrors(step, errors) → Element|null` (erstes markiertes Eingabefeld), `clearAllMarks() → void`
  - Feedback-Elemente: `#event-title-feedback`, `#event-banner-url-feedback`, `#event-start-date-feedback`, `#event-end-date-feedback`, `#event-recurring-until-feedback`, `#event-max-feedback`, `#event-reminder-feedback`, `#role-checkboxes-feedback`, `#slot-editor-feedback`, `#form-fields-feedback`; `#event-start-required`

- [ ] **Schritt 1: Failing Tests** — `test/wizardFlow.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

/** Open the wizard for a new event as an admin; routes are added to the role list. */
async function openWizard(routes = {}) {
    const frontend = await loadFrontendApp({ '/api/admin/roles': [], ...routes });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.showCreateEventModal();
    return frontend;
}

const stepOf = (element) => element('wizard-step-counter').textContent;

test('"Weiter" without a title stays on step 1 and says why', async () => {
    const { app, element } = await openWizard();
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 1 von 5');
    assert.ok(element('event-title').classList.contains('is-invalid'));
    assert.equal(element('event-title-feedback').textContent, 'Bitte einen Titel eingeben.');
    assert.ok(element('event-title-feedback').classList.contains('d-block'));
    assert.ok(element('wstep-1').classList.contains('has-error'));

    element('event-title').value = 'Raidnacht';
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 2 von 5');
    assert.equal(element('event-title').classList.contains('is-invalid'), false);
    assert.equal(element('event-title-feedback').classList.contains('d-block'), false);
    assert.equal(element('wstep-1').classList.contains('has-error'), false);
});

test('an active event needs a start date before step 3, a draft does not', async () => {
    const { app, element, state } = await openWizard();
    element('event-title').value = 'Raidnacht';
    app.wizardNext();
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 2 von 5');
    assert.equal(element('event-start-date-feedback').textContent, 'Aktive Events brauchen ein Startdatum.');
    assert.equal(isHidden(element('event-start-required')), false);

    element('event-status').value = 'draft';
    app.updateStartRequired();
    assert.ok(isHidden(element('event-start-required')));
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 3 von 5');

    element('event-status').value = 'active';
    app.updateStartRequired();
    assert.equal(isHidden(element('event-start-required')), false);
    state.startDatePicker.selectedDates = [new Date('2026-12-01T18:00:00.000Z')];
    app.wizardBack();
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 3 von 5');
});

test('"Speichern" checks every step, shows the first one with problems and sends nothing', async () => {
    const { app, element, requests } = await openWizard({ '/api/admin/events': { id: 'neu' } });
    element('event-title').value = 'Raidnacht';
    element('event-max').value = '-2';
    app.wizardGoTo(5);
    await app.saveEvent();
    assert.equal(stepOf(element), 'Schritt 2 von 5');
    assert.ok(element('wstep-2').classList.contains('has-error'));
    assert.ok(element('wstep-3').classList.contains('has-error'));
    assert.equal(element('event-max-feedback').textContent, 'Bitte eine ganze Zahl ab 0 eingeben.');
    assert.equal(element('wstep-1').classList.contains('has-error'), false);
    assert.equal(requests.some(request => request.url === '/api/admin/events'), false);
});

test('a valid draft is sent with all its fields', async () => {
    const { app, element, requests } = await openWizard({ '/api/admin/events': { id: 'neu' } });
    element('event-title').value = 'Raidnacht';
    element('event-status').value = 'draft';
    element('event-reminder').value = '24, 1';
    app.wizardGoTo(5);
    await app.saveEvent();
    const sent = requests.find(request => request.url === '/api/admin/events');
    assert.equal(sent.method, 'POST');
    const body = JSON.parse(sent.body);
    assert.deepEqual([body.title, body.status, body.reminderHours, body.startDate, body.formFields], ['Raidnacht', 'draft', '24, 1', '', []]);
});

test('opening the wizard again clears the marks of the last attempt', async () => {
    const { app, element } = await openWizard();
    app.wizardNext();
    assert.ok(element('wstep-1').classList.contains('has-error'));
    await app.showCreateEventModal();
    assert.equal(element('wstep-1').classList.contains('has-error'), false);
    assert.equal(element('event-title-feedback').textContent, '');
});
```

- [ ] **Schritt 2: Tests laufen lassen, sie schlagen fehl**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/wizardFlow.test.js`
Expected: FAIL — `element('event-title-feedback')` ist `null` bzw. `app.updateStartRequired is not a function`.

- [ ] **Schritt 3: Ort-Autovervollständigung auslagern** — `public/js/admin/wizard-location.js` anlegen. Die Funktionen `_cachedChannels`, `loadChannelsForAutocomplete`, `handleLocationInput`, `selectLocationChannel` (heute `wizard.js` Zeilen 12–66) unverändert hierher verschieben und aus `wizard.js` löschen; dazu Kopf und Aktionen:

```js
/**
 * Location field of the event wizard: suggestions of Discord channels
 * while typing "#…". Split from wizard.js to keep it small.
 */
import { registerActions } from '../core/actions.js';
import { escapeHtml } from '../core/ui.js';

// … _cachedChannels, loadChannelsForAutocomplete, handleLocationInput, selectLocationChannel (moved unchanged) …

registerActions({
    handleLocationInput: () => handleLocationInput(),
    selectLocationChannel: (el) => selectLocationChannel(el.dataset.channelId, el.dataset.channelName, el.dataset.channelType)
});
```

In `wizard.js` die beiden Einträge `handleLocationInput` und `selectLocationChannel` aus `registerActions` entfernen. In `public/js/main.js` nach `import './admin/wizard-builders.js';` einfügen: `import './admin/wizard-location.js';`

- [ ] **Schritt 4: `public/js/admin/wizard-marks.js` anlegen**

```js
/**
 * Error marks of the event wizard: the field turns red (.is-invalid), its
 * sentence shows in the matching .invalid-feedback (.d-block) and the step
 * dot turns red (.has-error). The rules live in wizard-checks.js.
 */
import { STEP_FIELDS } from './wizard-checks.js';

// Field key of checkWizardStep -> id of its input; the sentence goes into "<id>-feedback"
const FIELD_INPUTS = {
    title: 'event-title',
    bannerUrl: 'event-banner-url',
    startDate: 'event-start-date',
    endDate: 'event-end-date',
    recurringUntil: 'event-recurring-until',
    maxParticipants: 'event-max',
    reminderHours: 'event-reminder',
    requiredRoles: 'role-checkboxes'
};

// The rows of the two builders share one sentence below their list
const GROUPS = {
    slots: { list: 'slot-editor-rows', row: '.slot-editor-row', inputs: { name: '.slot-name-input', capacity: '.slot-capacity-input' }, feedback: 'slot-editor-feedback' },
    formFields: { list: 'form-fields-builder', row: '.form-field-row', inputs: { label: '.ff-label', options: '.ff-options' }, feedback: 'form-fields-feedback' }
};

function hideFeedback(feedback) {
    if (!feedback) return;
    feedback.textContent = '';
    feedback.classList.remove('d-block');
}

function targetOf(field) {
    const [key, index, part] = field.split('.');
    const group = GROUPS[key];
    if (!group) {
        return { input: document.getElementById(FIELD_INPUTS[key]), feedback: document.getElementById(`${FIELD_INPUTS[key]}-feedback`) };
    }
    const row = document.querySelectorAll(`#${group.list} ${group.row}`)[Number(index)];
    return { input: row ? row.querySelector(group.inputs[part]) : null, feedback: document.getElementById(group.feedback) };
}

function clearField(key) {
    const group = GROUPS[key];
    if (!group) {
        document.getElementById(FIELD_INPUTS[key])?.classList.remove('is-invalid');
        hideFeedback(document.getElementById(`${FIELD_INPUTS[key]}-feedback`));
        return;
    }
    document.querySelectorAll(`#${group.list} .is-invalid`).forEach(input => input.classList.remove('is-invalid'));
    hideFeedback(document.getElementById(group.feedback));
}

/**
 * Show the problems of one step; marks of that step from an earlier check go away.
 *
 * @param {number} step -> 1–5.
 * @param {Array<{field: string, message: string}>} errors -> Result of checkWizardStep().
 * @returns {Element|null} -> First marked input, for the focus.
 */
export function showStepErrors(step, errors) {
    (STEP_FIELDS[step] || []).forEach(clearField);
    let first = null;
    for (const { field, message } of errors) {
        const { input, feedback } = targetOf(field);
        if (input) input.classList.add('is-invalid');
        // One sentence per feedback: the first problem wins
        if (feedback && !feedback.textContent) {
            feedback.textContent = message;
            feedback.classList.add('d-block');
        }
        first = first || input;
    }
    document.getElementById(`wstep-${step}`)?.classList.toggle('has-error', errors.length > 0);
    return first;
}

// A changed field loses its mark at once; the step dot waits for the next check
function clearMarkOf(target) {
    const marked = typeof target?.closest === 'function' ? target.closest('.is-invalid') : null;
    if (!marked) return;
    marked.classList.remove('is-invalid');
    const group = Object.values(GROUPS).find(entry => marked.closest(`#${entry.list}`));
    if (!group) hideFeedback(document.getElementById(`${marked.id}-feedback`));
    else if (!document.getElementById(group.list)?.querySelector('.is-invalid')) hideFeedback(document.getElementById(group.feedback));
}

// Modules run no code on import (test/frontendModules.test.js) -> the form starts listening when the wizard first opens
let listening = false;

function listenForChanges() {
    if (listening) return;
    listening = true;
    const form = document.getElementById('event-form');
    form.addEventListener('input', (event) => clearMarkOf(event.target));
    form.addEventListener('change', (event) => clearMarkOf(event.target));
}

/**
 * Remove every mark; called when the wizard opens.
 *
 * @returns {void}
 */
export function clearAllMarks() {
    listenForChanges();
    for (const step of Object.keys(STEP_FIELDS)) showStepErrors(Number(step), []);
}
```

- [ ] **Schritt 5: `wizard.js` umbauen**

Importe ergänzen:

```js
import { checkWizardStep } from './wizard-checks.js';
import { clearAllMarks, showStepErrors } from './wizard-marks.js';
```

`wizardNext` ersetzen:

```js
export function wizardNext() {
    const errors = checkWizardStep(currentWizardStep, collectEventDraft());
    const first = showStepErrors(currentWizardStep, errors);
    if (errors.length > 0) {
        first?.focus();
        return;
    }
    if (currentWizardStep < WIZARD_TOTAL_STEPS) {
        wizardGoTo(currentWizardStep + 1);
    }
}
```

Nach `wizardBack` einfügen:

```js
/**
 * Show the star at the start date while the status is "Aktiv": drafts may wait for a date.
 *
 * @returns {void}
 */
export function updateStartRequired() {
    toggleElement(document.getElementById('event-start-required'), document.getElementById('event-status').value === 'active');
}
```

In `showCreateEventModal` vor `// Reset wizard to step 1` / `wizardGoTo(1);` einfügen:

```js
    clearAllMarks();
    updateStartRequired();
```

In `editEvent` dieselben zwei Zeilen vor `// Reset wizard to step 1` / `wizardGoTo(1);` einfügen.

`saveEvent` ersetzen durch `collectEventDraft` + neues `saveEvent`:

```js
/**
 * Input of the wizard as POST/PUT /api/admin/events expects it; also the draft of the checks and the preview.
 *
 * @returns {Object} -> Event fields; form fields unfiltered, so empty labels can be reported.
 */
export function collectEventDraft() {
    return {
        // … the fields of the object literal `const data = { title: …, location: (() => { … })(), }` of the old saveEvent (wizard.js lines 350–393 before this task), moved unchanged …
    };
}

export async function saveEvent() {
    const draft = collectEventDraft();
    // Every step is checked and marked; the first one with problems is shown, nothing is sent
    let firstStep = 0;
    let firstInput = null;
    for (let step = 1; step <= WIZARD_TOTAL_STEPS; step++) {
        const errors = checkWizardStep(step, draft);
        const input = showStepErrors(step, errors);
        if (errors.length > 0 && !firstStep) {
            firstStep = step;
            firstInput = input;
        }
    }
    if (firstStep) {
        wizardGoTo(firstStep);
        firstInput?.focus();
        return;
    }

    const editId = document.getElementById('event-edit-id').value;
    try {
        // … the old try block from `const url = editId ? …` to the last `showToast(err.error || 'Fehler', 'danger');` (lines 396–426 before this task), unchanged except `body: JSON.stringify(draft)` …
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}
```

`registerActions` ergänzen: `updateStartRequired: () => updateStartRequired()`.

- [ ] **Schritt 6: Formularfelder ungefiltert** — in `public/js/admin/wizard-builders.js` am Ende von `getFormFieldsFromBuilder` `.filter(f => f.label);` durch `;` ersetzen und davor den Kommentar setzen:

```js
    // Empty labels stay in: the wizard check reports them (wizard-checks.js)
```

- [ ] **Schritt 7: Markup** — in `public/index.html` im Assistenten:

Titel:

```html
              <div class="mb-3">
                <label class="form-label" for="event-title">Titel <span class="text-danger">*</span></label>
                <input type="text" class="form-control" id="event-title" maxlength="200" placeholder="Event-Name">
                <div class="invalid-feedback" id="event-title-feedback"></div>
              </div>
```

Banner (Label und Feedback):

```html
                <label class="form-label" for="event-banner-url"><i class="bi bi-image me-1"></i>Banner-URL</label>
                <input type="url" class="form-control" id="event-banner-url"
                  placeholder="https://example.com/banner.jpg">
                <div class="invalid-feedback" id="event-banner-url-feedback"></div>
```

Start- und Enddatum:

```html
                <div class="col-md-6">
                  <label class="form-label" for="event-start-date"><i class="bi bi-calendar-event me-1"></i>Startdatum <span class="text-danger" id="event-start-required">*</span></label>
                  <input type="text" class="form-control" id="event-start-date" placeholder="Datum & Uhrzeit wählen"
                    readonly>
                  <div class="invalid-feedback" id="event-start-date-feedback"></div>
                </div>
                <div class="col-md-6">
                  <label class="form-label" for="event-end-date"><i class="bi bi-calendar-event me-1"></i>Enddatum</label>
                  <input type="text" class="form-control" id="event-end-date" placeholder="Datum & Uhrzeit wählen"
                    readonly>
                  <div class="invalid-feedback" id="event-end-date-feedback"></div>
                </div>
```

Status: `<select class="form-select" id="event-status" data-change="updateStartRequired">`

Wiederholung: Label `<label class="form-check-label" for="event-recurring"><i class="bi bi-arrow-repeat me-1"></i>Wiederkehrendes Event</label>`; nach `<input type="date" class="form-control" id="event-recurring-until">` die Zeile `<div class="invalid-feedback" id="event-recurring-until-feedback"></div>`.

Schritt 3: nach `#event-max` (vor dem `<small>`) `<div class="invalid-feedback" id="event-max-feedback"></div>`; Erinnerungs-Label `<label class="form-label" for="event-reminder"><i class="bi bi-alarm me-1"></i>Erinnerungen (Stunden vor Start)</label>` und nach dem Eingabefeld `<div class="invalid-feedback" id="event-reminder-feedback"></div>`; nach `<div id="slot-editor-rows" class="slot-editor-rows"></div>` die Zeile `<div class="invalid-feedback" id="slot-editor-feedback"></div>`; nach dem schließenden `</div>` von `#role-checkboxes` die Zeile `<div class="invalid-feedback" id="role-checkboxes-feedback"></div>`.

Schritt 4: nach `<div id="form-fields-builder">…</div>` die Zeile `<div class="invalid-feedback" id="form-fields-feedback"></div>`.

Schritt 5: `🎧 Auto-Voice/Text Channels generieren` → `<i class="bi bi-headset me-1"></i>Auto-Voice/Text Channels generieren`; `🤖 Eigene Bot-Nachrichten` → `<i class="bi bi-robot me-1"></i>Eigene Bot-Nachrichten`.

- [ ] **Schritt 8: Stil des roten Schritt-Punkts** — in `public/css/style.css` nach `.wizard-step-item.completed + .wizard-step-connector { … }`:

```css
/* A checked step with problems (admin/wizard-marks.js); wins over active and completed */
.wizard-step-item.has-error .wizard-step-bubble {
  background: var(--danger-fill);
  border-color: var(--danger-fill);
  color: var(--on-danger);
  box-shadow: none;
}
```

- [ ] **Schritt 9: Budget und Browsertest anpassen** — `test/cssRules.test.js`: `const EMOJI_BUDGET = 23;`. In `e2e/csp.spec.js` vor dem zweiten `await page.locator('#wizard-btn-next').click();` (nach dem Schließen des Kalenders) einfügen:

```js
    // An active event needs a start date; a draft may go on without one
    await page.locator('#event-status').selectOption('draft');
```

- [ ] **Schritt 10: Tests laufen lassen, sie bestehen**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/wizardFlow.test.js`, dann `npm test`
Expected: PASS. `wc -l public/js/admin/wizard.js` unter 500.

- [ ] **Schritt 11: Commit**

```bash
git add public/js/admin/wizard.js public/js/admin/wizard-marks.js public/js/admin/wizard-location.js public/js/admin/wizard-builders.js public/js/main.js public/index.html public/css/style.css test/wizardFlow.test.js test/cssRules.test.js e2e/csp.spec.js
git commit -m "Check every wizard step before moving on

Only the title was checked in the browser; everything else failed as one
toast after saving, with the wizard stuck on the last step. \"Weiter\" now
checks its step and marks the fields with their sentence, a step with
problems gets a red dot, and \"Speichern\" shows the first step that is not
ready instead of sending. The start date carries a star while the status
is active. The location suggestions moved into their own module to keep
wizard.js small, and the labels use icons instead of emojis."
```

---

### Task 6: Vorschau im Assistenten

**Files:**
- Create: `public/js/admin/wizard-preview.js`
- Modify: `public/js/admin/wizard.js` (`setWizardMode`, `showPreviewArea`, `wizardGoTo`, `wizardNext`, Aktion)
- Modify: `public/js/events/list.js` (`applyBannerColors` exportieren)
- Modify: `public/index.html` (Umschalter, `#wizard-preview`)
- Modify: `public/css/style.css` (Block „WIZARD PREVIEW“)
- Test: `test/wizardFlow.test.js`

**Interfaces:**
- Consumes: `renderEventCard(event, now)` (`events/cards.js`), `applyBannerColors(container)` (`events/list.js`), `renderDiscordMessage(preview, now)` (Task 4), `applyStyleData`, `state.csrfToken`, `collectEventDraft()` (Task 5), Route aus Task 2.
- Produces: `previewEventOf(draft, editId, places) → Object`, `renderWizardPreview(draft, editId, now?) → Promise<void>`, `cancelWizardPreview() → void`, `setWizardMode(mode) → Promise<void>`; Markup `#wizard-mode-edit`, `#wizard-mode-preview`, `#wizard-preview`, `#wizard-preview-card`, `#wizard-preview-discord`.

- [ ] **Schritt 1: Failing Tests** — an `test/wizardFlow.test.js` anhängen:

```js
const PREVIEW = {
    embed: { title: '🎉 Raidnacht', description: 'Bringt Tränke mit.', color: 0x8b5cf6, fields: [{ name: 'Datum', value: 'TBA', inline: true }], footer: { text: 'DEMS — Event Management' } },
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Zum Event', url: 'http://localhost:3000/#event/vorschau' }] }],
    places: { taken: 2, capacity: 6, guests: 0, pending: 0, waitlist: 0, text: '2 von 6 Plätzen belegt', waitlistText: '' },
    bot: { name: 'DEMS Bot', avatarUrl: null }
};

test('the preview shows the card at once and the Discord message of the server', async () => {
    const { app, element, requests } = await openWizard({ '/api/admin/events/preview': PREVIEW });
    element('event-title').value = 'Raidnacht';
    await app.setWizardMode('preview');
    assert.ok(isHidden(element('wizard-page-1')));
    assert.equal(isHidden(element('wizard-preview')), false);
    assert.ok(element('wizard-mode-preview').classList.contains('active'));
    assert.equal(element('wizard-mode-edit').classList.contains('active'), false);

    const call = requests.find(request => request.url === '/api/admin/events/preview');
    assert.equal(call.method, 'POST');
    assert.equal(call.headers['X-CSRF-TOKEN'], 'test-token');
    assert.equal(JSON.parse(call.body).title, 'Raidnacht');
    assert.equal(JSON.parse(call.body).id, undefined);

    assert.ok(element('wizard-preview-card').innerHTML.includes('<h3 class="event-card-title">Raidnacht</h3>'));
    assert.ok(element('wizard-preview-card').innerHTML.includes('2 von 6 belegt'));
    assert.ok(element('wizard-preview-discord').innerHTML.includes('<div class="discord-embed-title">🎉 Raidnacht</div>'));
});

test('a failed preview keeps the card and says so', async () => {
    const { app, element } = await openWizard();
    element('event-title').value = 'Raidnacht';
    await app.setWizardMode('preview');
    assert.ok(element('wizard-preview-card').innerHTML.includes('Raidnacht'));
    assert.equal(element('wizard-preview-discord').innerHTML, '<p class="text-body-tertiary small mb-0">Discord-Vorschau gerade nicht verfügbar.</p>');
});

test('an answer that arrives after switching back is dropped', async () => {
    let answer;
    const late = new Promise(resolve => { answer = resolve; });
    const { app, element } = await openWizard({ '/api/admin/events/preview': () => late });
    element('event-title').value = 'Raidnacht';
    const pending = app.setWizardMode('preview');
    await app.setWizardMode('edit');
    answer(PREVIEW);
    await pending;
    assert.doesNotMatch(element('wizard-preview-discord').innerHTML, /discord-embed/);
    assert.equal(isHidden(element('wizard-page-1')), false);
    assert.ok(isHidden(element('wizard-preview')));
});

test('only the newest of two quick previews is shown', async () => {
    const answers = [];
    const { app, element } = await openWizard({ '/api/admin/events/preview': () => new Promise(resolve => answers.push(resolve)) });
    element('event-title').value = 'Raidnacht';
    const first = app.setWizardMode('preview');
    const second = app.setWizardMode('preview');
    answers[1]({ ...PREVIEW, embed: { ...PREVIEW.embed, title: 'Zweite Fassung' } });
    await second;
    answers[0](PREVIEW);
    await first;
    assert.ok(element('wizard-preview-discord').innerHTML.includes('Zweite Fassung'));
    assert.doesNotMatch(element('wizard-preview-discord').innerHTML, /🎉 Raidnacht/);
});

test('"Weiter" from the preview edits the next step, or the marked one', async () => {
    const { app, element } = await openWizard({ '/api/admin/events/preview': PREVIEW });
    await app.setWizardMode('preview');
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 1 von 5');
    assert.ok(isHidden(element('wizard-preview')));
    assert.equal(isHidden(element('wizard-page-1')), false);
    assert.ok(element('event-title').classList.contains('is-invalid'));

    element('event-title').value = 'Raidnacht';
    await app.setWizardMode('preview');
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 2 von 5');
    assert.ok(isHidden(element('wizard-preview')));
    assert.equal(isHidden(element('wizard-page-2')), false);
    assert.ok(element('wizard-mode-edit').classList.contains('active'));
});
```

- [ ] **Schritt 2: Tests laufen lassen, sie schlagen fehl**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/wizardFlow.test.js`
Expected: FAIL — `app.setWizardMode is not a function`.

- [ ] **Schritt 3: `applyBannerColors` exportieren** — in `public/js/events/list.js` `function applyBannerColors(grid)` → `export function applyBannerColors(grid)`; im JSDoc `@param {Element} grid -> #events-grid.` → `@param {Element} grid -> Container with cards (#events-grid, the wizard preview).`

- [ ] **Schritt 4: `public/js/admin/wizard-preview.js` anlegen**

```js
/**
 * Preview of the event wizard: the overview card and the Discord
 * announcement of the unsaved input. The card is drawn at once; the
 * announcement comes from POST /api/admin/events/preview, which uses the
 * builders of "Ankündigen".
 */
import { state } from '../core/state.js';
import { applyStyleData } from '../core/ui.js';
import { renderEventCard } from '../events/cards.js';
import { applyBannerColors } from '../events/list.js';
import { renderDiscordMessage } from './discord-preview.js';

const DISCORD_LOADING = '<div class="discord-message" aria-hidden="true"><div class="skeleton skeleton-avatar"></div>'
    + '<div class="discord-message-body"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text is-short"></div></div></div>';
const DISCORD_UNAVAILABLE = '<p class="text-body-tertiary small mb-0">Discord-Vorschau gerade nicht verfügbar.</p>';

// Counts the previews; an answer for an older one is dropped
let previewSequence = 0;

/**
 * Event object of the draft for renderEventCard().
 *
 * @param {Object} draft -> Input of collectEventDraft().
 * @param {string} editId -> Id of the edited event, '' for a new one.
 * @param {Object|null} places -> Places of the preview answer; null while it loads.
 * @returns {Object} -> Event with the fields the card reads.
 */
export function previewEventOf(draft, editId, places) {
    const slots = Array.isArray(draft.slots) ? draft.slots : [];
    const draftCapacity = slots.length > 0
        ? slots.reduce((sum, slot) => sum + Math.max(0, Number(slot.capacity) || 0), 0)
        : Math.max(0, parseInt(draft.maxParticipants, 10) || 0);
    return {
        id: editId || 'vorschau',
        title: draft.title,
        bannerUrl: draft.bannerUrl,
        accentColor: draft.accentColor,
        category: draft.category,
        startDate: draft.startDate,
        endDate: draft.endDate,
        accessMode: draft.accessMode,
        maxParticipants: places ? places.capacity : draftCapacity,
        ...(places ? { places } : {})
    };
}

/**
 * Drop the answer of a preview that is still loading.
 *
 * @returns {void}
 */
export function cancelWizardPreview() {
    previewSequence++;
}

/**
 * Draw the card at once, then ask the server for the Discord message.
 *
 * @param {Object} draft -> Input of collectEventDraft().
 * @param {string} editId -> Id of the edited event, '' for a new one.
 * @param {Date} [now] -> Reference time for the card and the message.
 * @returns {Promise<void>} -> Resolves when the message is drawn, dropped or replaced by the unavailable hint.
 */
export async function renderWizardPreview(draft, editId, now = new Date()) {
    const sequence = ++previewSequence;
    const cardEl = document.getElementById('wizard-preview-card');
    const discordEl = document.getElementById('wizard-preview-discord');
    const drawCard = (places) => {
        cardEl.innerHTML = renderEventCard(previewEventOf(draft, editId, places), now);
        applyBannerColors(cardEl);
    };
    drawCard(null);
    discordEl.innerHTML = DISCORD_LOADING;
    try {
        const res = await fetch('/api/admin/events/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ ...draft, id: editId || undefined })
        });
        const preview = await res.json();
        if (sequence !== previewSequence) return;
        if (!res.ok) throw new Error(preview.error);
        drawCard(preview.places);
        discordEl.innerHTML = renderDiscordMessage(preview, now);
        applyStyleData(discordEl);
    } catch {
        if (sequence === previewSequence) discordEl.innerHTML = DISCORD_UNAVAILABLE;
    }
}
```

- [ ] **Schritt 5: `wizard.js` erweitern**

Import:

```js
import { cancelWizardPreview, renderWizardPreview } from './wizard-preview.js';
```

Nach `export const WIZARD_TOTAL_STEPS = 5;`:

```js
// Preview area and the two switch buttons; leaving the preview drops a pending answer
function showPreviewArea(visible) {
    if (!visible) cancelWizardPreview();
    toggleElement(document.getElementById('wizard-preview'), visible);
    for (const mode of ['edit', 'preview']) {
        const button = document.getElementById(`wizard-mode-${mode}`);
        const active = (mode === 'preview') === visible;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
    }
}

/**
 * Switch between editing the current step and the preview of the whole input.
 *
 * @param {string} mode -> "edit" or "preview".
 * @returns {Promise<void>} -> Resolves when the preview is drawn (at once for "edit").
 */
export function setWizardMode(mode) {
    const preview = mode === 'preview';
    showPreviewArea(preview);
    toggleElement(document.getElementById(`wizard-page-${currentWizardStep}`), !preview);
    if (!preview) return Promise.resolve();
    return renderWizardPreview(collectEventDraft(), document.getElementById('event-edit-id').value);
}
```

In `wizardGoTo(step)` als erste Zeile: `showPreviewArea(false);`

In `wizardNext` im Block `if (errors.length > 0) {` als erste Zeile:

```js
        // The marks need the step in view; from the preview it goes back to editing
        setWizardMode('edit');
```

`registerActions` ergänzen: `setWizardMode: (el) => setWizardMode(el.dataset.mode)`.

- [ ] **Schritt 6: Markup** — in `public/index.html`:

```html
        <!-- Wizard Step Indicator -->
        <div class="px-4 pt-3">
          <div class="wizard-nav">
```

wird zu

```html
        <!-- Wizard Step Indicator and the switch between editing and preview -->
        <div class="px-4 pt-3 wizard-head">
          <div class="wizard-nav">
```

und direkt nach dem schließenden `</div>` von `.wizard-nav` (vor dem schließenden `</div>` von `.wizard-head`):

```html
          <div class="nav nav-pills wizard-mode" role="tablist" aria-label="Ansicht des Assistenten">
            <button type="button" class="nav-link active" id="wizard-mode-edit" role="tab" aria-selected="true"
              data-click="setWizardMode" data-mode="edit"><i class="bi bi-pencil me-1"></i>Bearbeiten</button>
            <button type="button" class="nav-link" id="wizard-mode-preview" role="tab" aria-selected="false"
              data-click="setWizardMode" data-mode="preview"><i class="bi bi-eye me-1"></i>Vorschau</button>
          </div>
```

Direkt nach `</form>` im `.modal-body`:

```html
          <!-- Preview of the unsaved input (admin/wizard-preview.js); inert: its links lead nowhere -->
          <div class="is-hidden" id="wizard-preview">
            <section class="wizard-preview-block">
              <h6 class="section-label mb-2">In der Event-Übersicht</h6>
              <div class="wizard-preview-card" id="wizard-preview-card" inert></div>
            </section>
            <section class="wizard-preview-block">
              <h6 class="section-label mb-2">In Discord</h6>
              <div id="wizard-preview-discord" inert></div>
            </section>
          </div>
```

- [ ] **Schritt 7: Stile** — in `public/css/style.css` nach dem Block „DISCORD PREVIEW“:

```css
/* ═══════════════════════════════════════════ */
/* WIZARD PREVIEW                              */
/* setWizardMode() in admin/wizard.js,         */
/* renderWizardPreview() in wizard-preview.js  */
/* ═══════════════════════════════════════════ */
.wizard-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-16);
}

.wizard-head .wizard-nav {
  flex: 1 1 24rem;
}

.wizard-mode {
  flex: none;
}

.wizard-preview-block + .wizard-preview-block {
  margin-top: var(--space-24);
}

.wizard-preview-card {
  max-width: 22rem;
}
```

- [ ] **Schritt 8: Tests laufen lassen, sie bestehen**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/wizardFlow.test.js`, dann `npm test`
Expected: PASS (10 Tests in `wizardFlow.test.js`; die Wächter für Aktionen und Inline-Stile bleiben grün).

- [ ] **Schritt 9: Commit**

```bash
git add public/js/admin/wizard-preview.js public/js/admin/wizard.js public/js/events/list.js public/index.html public/css/style.css test/wizardFlow.test.js
git commit -m "Preview the overview card and the Discord announcement in the wizard

A switch above the steps replaces the form with a preview of the unsaved
input: the card as members see it in the overview, drawn at once, and the
Discord announcement the server builds like \"Ankündigen\". Both show the
same places; an answer that arrives after switching back is dropped, and
a failed request leaves the card with a short hint."
```

---

### Task 7: Browsertest und Sichtprüfung

**Files:**
- Create: `e2e/wizard.spec.js`

**Interfaces:**
- Consumes: alles aus Task 1–6; `watchErrors`, `loginAs`, `navigate`, `waitForDialog` aus `e2e/helpers.js`.

- [ ] **Schritt 1: Test schreiben** — `e2e/wizard.spec.js`:

```js
/**
 * Event wizard of D-10: every step is checked before "Weiter", and a
 * switch shows the overview card and the Discord announcement of the
 * unsaved input. Seed data: dev/seedData.js (dev mock mode).
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, navigate, waitForDialog } = require('./helpers');

async function openWizard(page) {
    await navigate(page, 'admin');
    await page.locator('[data-click="showCreateEventModal"]').first().click();
    await waitForDialog(page, '#eventModal');
}

test('an admin builds a raid step by step, checks the preview and saves from it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the wizard is the same on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openWizard(page);

    // Step 1 wants a title
    await page.locator('#wizard-btn-next').click();
    await expect(page.locator('#event-title-feedback')).toHaveText('Bitte einen Titel eingeben.');
    await expect(page.locator('#wstep-1')).toHaveClass(/has-error/);
    await page.locator('#event-title').fill('E2E-Raidnacht');
    await expect(page.locator('#event-title')).not.toHaveClass(/is-invalid/);
    await page.locator('#wizard-btn-next').click();

    // Step 2: an active event needs a start date
    await expect(page.locator('#wizard-page-2')).toBeVisible();
    await expect(page.locator('#event-start-required')).toBeVisible();
    await page.locator('#wizard-btn-next').click();
    await expect(page.locator('#event-start-date-feedback')).toHaveText('Aktive Events brauchen ein Startdatum.');
    await page.locator('#event-start-date').evaluate(input => input._flatpickr.setDate(new Date(Date.now() + 7 * 86_400_000), true));
    await page.locator('#wizard-btn-next').click();

    // Step 3: the raid preset gives three slots
    await expect(page.locator('#wizard-page-3')).toBeVisible();
    await page.locator('#event-use-slots').check();
    await page.locator('[data-click="applySlotPreset"]').click();

    // The preview shows the unsaved input
    await page.locator('#wizard-mode-preview').click();
    await expect(page.locator('#wizard-page-3')).toBeHidden();
    await expect(page.locator('#wizard-preview-card .event-card-title')).toHaveText('E2E-Raidnacht');
    await expect(page.locator('#wizard-preview-card .capacity-text')).toHaveText('0 von 15 belegt');
    await expect(page.locator('#wizard-preview-discord .discord-embed-title')).toHaveText('🎉 E2E-Raidnacht');
    await expect(page.locator('#wizard-preview-discord .discord-button')).toHaveText([/Tank/, /Heiler/, /Schaden/, /Zum Event/]);

    // Save straight from the preview of the last step
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="5"]').click();
    await expect(page.locator('#wizard-page-5')).toBeVisible();
    await page.locator('#wizard-mode-preview').click();
    await expect(page.locator('#wizard-preview')).toBeVisible();
    await page.locator('#wizard-btn-save').click();
    await expect(page.locator('#eventModal')).toBeHidden();
    await expect(page.locator('#toast-message')).toHaveText('Event erstellt!');
    expect(errors).toEqual([]);
});

test('"Speichern" shows the first step with problems and marks every such step', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the wizard is the same on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openWizard(page);
    await page.locator('#event-title').fill('E2E-Lückentext');
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="4"]').click();
    await page.locator('#wizard-page-4 [data-click="addFormField"]').click();
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="5"]').click();
    await page.locator('#wizard-btn-save').click();

    await expect(page.locator('#wizard-page-2')).toBeVisible();
    await expect(page.locator('#event-start-date-feedback')).toHaveText('Aktive Events brauchen ein Startdatum.');
    await expect(page.locator('#wstep-2')).toHaveClass(/has-error/);
    await expect(page.locator('#wstep-4')).toHaveClass(/has-error/);
    await expect(page.locator('#wstep-1')).not.toHaveClass(/has-error/);
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="4"]').click();
    await expect(page.locator('#form-fields-feedback')).toHaveText('Jedes Feld braucht ein Label.');
    await expect(page.locator('#form-fields-builder .ff-label')).toHaveClass(/is-invalid/);
    await page.locator('#eventModal [data-bs-dismiss="modal"]').first().click();
    await expect(page.locator('#eventModal')).toBeHidden();
    expect(errors).toEqual([]);
});
```

- [ ] **Schritt 2: Laufen lassen**

Run: `npx playwright test e2e/wizard.spec.js --project=desktop`
Expected: PASS (2 Tests). Weicht `0 von 15 belegt` ab, den Text aus `renderCapacity` (`events/cards.js`) übernehmen.

- [ ] **Schritt 3: Ganze Browser-Suite**

Run: `npm run test:e2e`
Expected: alle bestanden (vorher 82 + 2 neue, Rest übersprungen).

- [ ] **Schritt 4: Sichtprüfung** — Mock-Server mit Scratch-Datenbank (`PORT=3124 DEV_SQLITE_PATH=<scratchpad>/d10.sqlite node dev/start.js`, später per PID beenden), als Admin bei 1440 px: alle fünf Schritte in „Bearbeiten“ und „Vorschau“, eine Fehlermarke pro Schritt (Titel leer, aktiv ohne Datum, Rollen-Requirement ohne Rolle, leeres Formularfeld), Vorschau eines Slot-Events, eines Events mit Banner (`/dev-banners/raid.svg`) und eines Entwurfs (kein „Anmelden“-Button), dazu „Bearbeiten“ eines bestehenden Events (Plätze stimmen mit der Übersicht). Screenshots nach `data/d10/` (git-ignoriert). Auffälligkeiten mit einem Test festhalten und beheben, bevor es weitergeht.

- [ ] **Schritt 5: Commit**

```bash
git add e2e/wizard.spec.js
git commit -m "Walk through the wizard checks and the preview in the browser

The unit tests cannot see whether the marks show next to the right field
or whether the preview really draws the card and the Discord message. The
new spec builds a raid step by step, saves it from the preview, and checks
that saving a half-done event lands on the first step with problems."
```

---

### Task 8: Wiki und Abschluss

**Files:**
- Modify: `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/modules/utils.md`, `docs/wiki/concepts/event-lifecycle.md`, `docs/wiki/howto/add-event-field.md`, `docs/wiki/ops/testing.md`
- Generated: `docs/wiki/graph.json`

- [ ] **Schritt 1: Knoten anpassen** (Englisch; Tabellenformat der jeweiligen Seite beibehalten)
  - `frontend-app.md`, Modultabelle: Zeile `admin/wizard.js` → `showCreateEventModal`, `editEvent`, `collectEventDraft` (input as POST/PUT expect it, form fields unfiltered), `saveEvent` (checks every step, shows the first with problems, sends nothing then), `setWizardMode(mode)` (edit/preview), `updateStartRequired`, `reminderHoursOf`, `wizardGoTo`, `wizardNext` (checks its step), `wizardBack`, `updateBannerPreview`, `loadRoles`, `populateRoles`, `getSelectedRoles`. Neue Zeilen: `admin/wizard-checks.js` | rules of the wizard, pure | `checkWizardStep(step, draft)` → `[{ field, message }]`, `STEP_FIELDS`, `WIZARD_MESSAGES`, slot limits (mirror `normalizeSlots`) — `admin/wizard-marks.js` | error marks | `showStepErrors(step, errors)` (`.is-invalid`, sentence in `#<input>-feedback` with `.d-block`, red step dot `.has-error`), `clearAllMarks()`; a changed field loses its mark — `admin/wizard-location.js` | location field | `loadChannelsForAutocomplete`, `handleLocationInput`, `selectLocationChannel` — `admin/wizard-preview.js` | wizard preview | `renderWizardPreview(draft, editId)` (card at once, Discord message from `POST /api/admin/events/preview`, late answers dropped), `cancelWizardPreview`, `previewEventOf` — `admin/discord-preview.js` | Discord look, pure | `renderDiscordMessage(preview, now)`, `discordColor`, `discordTime`. In der Zeile von `events/list.js` `applyBannerColors` ergänzen. Den Satz unter „Actions“ mit `data-fallback` unverändert lassen.
  - `frontend-markup.md`: Zeile „Modals“/Assistent um `.wizard-head` mit `#wizard-mode-edit`/`#wizard-mode-preview` (pills), `#wizard-preview` (`#wizard-preview-card`, `#wizard-preview-discord`, both `inert`), `#event-start-required`, die zehn `*-feedback`-Elemente ergänzen; Tabelle „Stylesheets“, `style.css`: Blöcke „DISCORD PREVIEW“ und „WIZARD PREVIEW“; Token-Tabelle: Zeile „Discord preview“ mit `--discord-bg`, `--discord-embed-bg`, `--discord-text`, `--discord-heading`, `--discord-muted`, `--discord-link`, `--discord-button-secondary/-success/-danger` (AA on both Discord surfaces, `test/designTokens.test.js`).
  - `routes-admin.md`: neue Zeile `| POST | `/events/preview` | wizard preview of an unsaved event: `buildPreviewEvent(body)` (no `validateEvent`, broken slots left out), roster empty for a new event or `loadEventRoster(id, event)`; returns `{ embed, components, places, bot }` from `buildEventEmbed`/`buildEventComponents` (`toJSON()`) and `getBotStatus`; stores nothing | — |`; Zeilen `POST /events` und `PUT /events/:id`: „`validateEvent` (active events need `startDate`; `endDate` not before `startDate`)“; Zeile `PUT /events/:id/status`: „activating an event without `startDate` → 400“.
  - `api-index.md`: `| POST | `/api/admin/events`, `/events/preview` |`.
  - `utils.md`: neuer Abschnitt `## utils/eventPreview.js (pure)` — „`buildPreviewEvent(body)` → the fields card and announcement need (`title` ≤ 200, `description` ≤ 5000, `bannerUrl` only as http(s) URL, `status`/`accessMode` defaults, slots via `normalizeSlots` or none, `maxParticipants` = slot sum, guests off with slots). Used by `POST /api/admin/events/preview`.“; `sources` um `utils/eventPreview.js` ergänzen.
  - `event-lifecycle.md`: unter der Tabelle „Active events need a `startDate` (create, edit, publish through `/status`); drafts may wait for one. The wizard checks each step before „Weiter“ and previews the overview card and the Discord announcement (D-10).“
  - `add-event-field.md`, Zeile 5: „`collectEventDraft()`: put it into the draft (saved and previewed); a rule in `checkWizardStep` (`admin/wizard-checks.js`) if it can be wrong; `buildPreviewEvent` (`utils/eventPreview.js`) if the card or the announcement show it“.
  - `testing.md`: `sources` um `e2e/wizard.spec.js`, `test/eventPreview.test.js`, `test/wizardChecks.test.js`, `test/discordPreview.test.js`, `test/wizardFlow.test.js` ergänzen; Tabellenzeilen für die vier Unit-Testdateien (Inhalt wie Spec Teil 6) und eine Zeile `- `e2e/wizard.spec.js`: …` unter den Browsertests; die Zeilen `devServer.test.js` (preview route, start date rule) und `designTokens.test.js` (Discord pairs) ergänzen.

- [ ] **Schritt 2: Graph erzeugen und alles prüfen**

Run: `npm run wiki`, `npm test`, `npm run test:e2e`
Expected: alle grün.

- [ ] **Schritt 3: Commit**

```bash
git add docs/wiki
git commit -m "Describe the wizard checks, the preview and the start date rule in the wiki

The wizard nodes, the admin routes, the event lifecycle and the testing
page name the new modules, the preview route and the rule that active
events need a start date."
```
