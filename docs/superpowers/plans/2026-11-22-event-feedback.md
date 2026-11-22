# Event-Feedback Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the official plugin „Event-Feedback“: after an event ends, members who took part rate it (1–5 stars + optional comment) within 7 days; admins see averages, response rates and comments without names. Then release DEMS 3.5.0 with SDK 1.1, „Badges“ and „Event-Feedback“.

**Architecture:** One folder `plugins/event-feedback/`. `rules.js` is pure (window, eligibility, validation, summaries, texts). `server.js` wires the member and admin routes, the hooks `event.ended`/`event.deleted` and the DMs, using only SDK 1.1 `ctx`. The browser side is `client.js` with pure markup in `assets/view.js` and styles in `client.css`, one member page with an admin switch, like „Event einreichen“.

**Tech Stack:** Plugin SDK 1.1, Node built-ins only, ES module client, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-event-feedback-design.md`. Branch `feature/event-feedback` (from `feature/plugin-sdk-1.1` after #164); PR into `feature/plugin-sdk-1.1`, then Task 4 releases from there.

## Global Constraints

- Official plugin rules (`test/pluginClientGuards.test.js`): Node built-ins and own files only; client imports only `./assets/<name>.js`; actions via `ui.actions.register` (`p:event-feedback:<name>`); no inline handlers or styles; tokens only in `client.css`; Bootstrap Icons only, no emojis.
- All user-facing text German; code and comments English; escape every interpolated value with `ui.helpers.escapeHtml`.
- Event end = `endDate`, else start + 2 h; status `cancelled` or `draft` never takes feedback. Window = end … end + 7 days.
- Eligible = own registration `accepted`, and `checkedIn === true` when the event has `checkinEnabled`. Guest places never.
- Answer: `rating` integer 1–5 (required), `comment` trimmed ≤ 1000 characters (optional); one per member and event (`answers/<eventId>_<userId>`, reserved `userId`).
- Admin answers never contain user ids, names or answer times.
- German copy fixed by the spec, verbatim: „Für dieses Event kannst du kein Feedback geben.“, „Bitte vergib 1 bis 5 Sterne.“, „Der Kommentar darf höchstens 1000 Zeichen lang sein.“, „Die Feedback-Zeit für dieses Event ist vorbei.“, DM „Wie war **<Titel>**? Gib dem Team kurz Feedback – das dauert nur ein paar Sekunden.“ + button „Feedback geben“, toast „Danke für dein Feedback!“.
- Commit messages: English imperative + why, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; wiki updated in the same commit as behaviour, then `npm run wiki`.

## Review Focus

1. A member who was not at the event (rejected, waitlisted, a guest, or not checked in although the event used check-in) opens the DM link of someone else → 403 on GET and PUT, never an answer stored — pinned in Task 2.
2. An answer sent after the 7 days → 409 and the stored answer unchanged; GET still shows it read-only (`editable: false`) — pinned in Task 2.
3. An event archived, reopened and archived again asks nobody a second time — pinned in Task 2.
4. No admin answer contains a member id, a name or a time, also not inside comments' objects — pinned in Task 2 by scanning the JSON for every persona id.
5. With „Keine Feedback-Anfragen per DM senden“ on, ending an event sends no DM but records the request, so switching DMs on later sends nothing for old events — pinned in Task 2.

---

### Task 1: Pure rules (`rules.js`)

**Files:**
- Create: `plugins/event-feedback/rules.js`
- Test: `test/eventFeedbackRules.test.js`

**Interfaces:**
- Produces:
  - `WINDOW_DAYS = 7`, `COMMENT_MAX = 1000`, `ERRORS` (the German strings of the Global Constraints, keys `notEligible`, `rating`, `comment`, `closed`)
  - `eventEnd(event)` → `Date|null` (`endDate` if valid and not before start, else start + 2 h; null without a valid start)
  - `feedbackWindow(event)` → `{ opensAt: Date, closesAt: Date } | null` (null for `cancelled`/`draft` or no end)
  - `isOpen(event, now)` → boolean (`opensAt <= now <= closesAt`)
  - `isEligible(event, registration)` → boolean
  - `validateAnswer(input)` → `{ ok: true, value: { rating, comment } } | { ok: false, error }`
  - `answerId(eventId, userId)` → `` `${eventId}_${userId}` ``
  - `summarize(answers)` → `{ count, average: number|null (one decimal), distribution: [n1, n2, n3, n4, n5] }`
  - `toEventView(event)` → `{ id, title, startDate, category }`
  - `requestDm(event)` → the DM text, Discord markdown in the title escaped (`\ * _ ~ \` |`)

- [ ] **Step 1: Write the failing tests**

```js
test('the window runs from the end until 7 days later; cancelled and draft events have none', () => {
    const event = { startDate: '2026-11-20T18:00:00.000Z', endDate: '2026-11-20T21:00:00.000Z', status: 'archived' };
    assert.deepEqual(feedbackWindow(event), { opensAt: new Date('2026-11-20T21:00:00.000Z'), closesAt: new Date('2026-11-27T21:00:00.000Z') });
    assert.equal(eventEnd({ startDate: '2026-11-20T18:00:00.000Z' }).toISOString(), '2026-11-20T20:00:00.000Z');
    assert.equal(eventEnd({ startDate: '2026-11-20T18:00:00.000Z', endDate: '2026-11-20T17:00:00.000Z' }).toISOString(), '2026-11-20T20:00:00.000Z');
    assert.equal(isOpen(event, new Date('2026-11-20T20:59:00.000Z')), false);
    assert.equal(isOpen(event, new Date('2026-11-27T21:00:00.000Z')), true);
    assert.equal(isOpen(event, new Date('2026-11-27T21:01:00.000Z')), false);
    for (const status of ['cancelled', 'draft']) assert.equal(feedbackWindow({ ...event, status }), null);
    assert.equal(feedbackWindow({ status: 'archived' }), null);
});

test('eligible: accepted, and checked in when the event uses check-in', () => {
    assert.equal(isEligible({}, { status: 'accepted', checkedIn: false }), true);
    assert.equal(isEligible({ checkinEnabled: true }, { status: 'accepted', checkedIn: false }), false);
    assert.equal(isEligible({ checkinEnabled: true }, { status: 'accepted', checkedIn: true }), true);
    for (const status of ['pending', 'waitlisted', 'offered', 'tentative', 'rejected']) {
        assert.equal(isEligible({}, { status, checkedIn: true }), false, status);
    }
    assert.equal(isEligible({}, null), false);
});

test('validateAnswer', () => {
    assert.deepEqual(validateAnswer({ rating: 4, comment: '  Gut  ' }), { ok: true, value: { rating: 4, comment: 'Gut' } });
    assert.deepEqual(validateAnswer({ rating: 5 }), { ok: true, value: { rating: 5, comment: '' } });
    for (const rating of [0, 6, 2.5, '4', null]) assert.deepEqual(validateAnswer({ rating }), { ok: false, error: 'Bitte vergib 1 bis 5 Sterne.' });
    assert.deepEqual(validateAnswer({ rating: 3, comment: 'x'.repeat(1001) }), { ok: false, error: 'Der Kommentar darf höchstens 1000 Zeichen lang sein.' });
    assert.deepEqual(validateAnswer({ rating: 3, comment: 7 }), { ok: false, error: 'Der Kommentar darf höchstens 1000 Zeichen lang sein.' });
    assert.deepEqual(validateAnswer(null), { ok: false, error: 'Bitte vergib 1 bis 5 Sterne.' });
});

test('summarize rounds to one decimal and counts each star', () => {
    assert.deepEqual(summarize([]), { count: 0, average: null, distribution: [0, 0, 0, 0, 0] });
    assert.deepEqual(summarize([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), { count: 3, average: 4.3, distribution: [0, 0, 0, 2, 1] });
});

test('requestDm escapes markdown in the title', () => {
    assert.equal(requestDm({ title: 'Raid_Abend *' }), 'Wie war **Raid\\_Abend \\***? Gib dem Team kurz Feedback – das dauert nur ein paar Sekunden.');
});
```

- [ ] **Step 2: Run** `node --test test/eventFeedbackRules.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** `plugins/event-feedback/rules.js` (CommonJS, no requires).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `Add the rules of the Event-Feedback plugin`

---

### Task 2: Manifest, routes, hooks, seed

**Files:**
- Create: `plugins/event-feedback/plugin.json` (exactly the spec's manifest, `"author": "DEMS"`, `"server": "server.js"`, `"client": "client.js"`), `plugins/event-feedback/server.js`, a stub `plugins/event-feedback/client.js` (`export function register(ui) { void ui; }`, filled in Task 3)
- Modify: `dev/seedData.js` (`buildPluginSeedData` + `'event-feedback'`), `test/seed.test.js` (counts + a seed test), `test/adminPlugins.test.js` and `test/pluginServer.test.js` (official plugin lists: `event-feedback` sorts after `custom-design`, before `event-submissions`)
- Test: `test/eventFeedbackServer.test.js` (setup like `test/badgesServer.test.js`: own SQLite path, `startPluginServer({ DEV_SQLITE_PATH }, { seed: false })`, `store()` to write events/registrations in-process)

**Interfaces:**
- Consumes: Task 1; SDK `ctx.events.list/get`, `ctx.registrations.list`, `ctx.discord.sendDM`, `ctx.settings.get`, `ctx.siteUrl`, `ctx.hooks.on('event.ended'|'event.deleted')`.
- Produces: the routes of the spec's table, exactly; collections `answers`, `requests`; seed: one archived seed event that ended yesterday with answers of Lena (5, „Super Orga!“) and Mori (4, no comment) and Tom eligible without an answer (`requests/<eventId>` stored), ids prefixed `dev-feedback-`.

- [ ] **Step 1: Write the failing server tests** (each writes its own events into the DB; `ended(daysAgo, fields)` helper writes an `archived` event that ended `daysAgo` days ago, `reg(eventId, personaId, fields)` an accepted registration)

```js
test('a member who took part rates within the window, changes the answer, and sees it in /mine', async () => {
    // event ended 1 day ago; Tom accepted → GET /events/:id/mine { event, editable: true, answer: null }
    // PUT { rating: 4, comment: ' Gut ' } → stored; PUT { rating: 5 } → replaced; GET /mine done[0] = { event, rating: 5, comment: '', editable: true }
});
test('not eligible: rejected, waitlisted, not checked in although check-in was used, no registration → 403 on GET and PUT', async () => {
    // body { error: 'Für dieses Event kannst du kein Feedback geben.' }; nothing stored (admin summary count 0)
});
test('after 7 days the answer is read-only and a change is refused with 409', async () => {
    // answer stored via store() for an event that ended 8 days ago → GET editable false with the answer; PUT → 409 'Die Feedback-Zeit für dieses Event ist vorbei.'
});
test('invalid answers are refused in German', async () => { /* rating 0 → 400 'Bitte vergib 1 bis 5 Sterne.', comment 1001 → 400 comment text */ });
test('ending an event DMs every eligible member once, also when it is archived again', async () => {
    // active event (category, checkinEnabled false) with Tom + Lena accepted, Neo waitlisted; POST …/end
    // → server.output() +2 'DM an' lines containing 'Wie war **…**?' and 'Feedback geben'; Neo none
    // PUT …/status active, POST …/end → no new DM line
});
test('with DMs switched off the request is recorded and nothing is sent later', async () => {
    // PUT /api/admin/plugins/event-feedback/settings { values: { noDm: true } }; end an event → 0 DM lines;
    // switch noDm false; end another event → DMs only for that one; reset noDm afterwards
});
test('the admin summary shows averages, rates and comments without ids, names or times', async () => {
    // 3 answers (5 'Top', 4, 2 'Zu spät') of 4 eligible → /summary entry { count 3, eligible 4, average 3.7 }, categories entry;
    // /events/:id/summary distribution [0,1,0,1,1], comments [{ rating: 2, comment: 'Zu spät' }, { rating: 5, comment: 'Top' }];
    // for every persona: JSON.stringify(both answers) does not include persona.userId nor persona.displayName; no 'At"' keys
});
test('members get 403 on the admin routes; deleting an event deletes its answers', async () => { /* … */ });
test('the open list counts events in the window the member may still rate', async () => {
    // two ended events (1 and 10 days ago) with Tom eligible → /mine open has only the recent one
});
```

- [ ] **Step 2: Run** `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/eventFeedbackServer.test.js` → FAIL (plugin not found). Then prove the RED step: every test fails, none errors on setup.
- [ ] **Step 3: Implement** `plugin.json`, `server.js` (member routes compute eligibility live from `ctx.registrations.list({ eventId, userId })` and `ctx.events.get`; `/summary` reads events, registrations and answers once each and slices the newest 100 ended events in memory; hooks: `event.ended` stores `requests/<eventId>` first, returns when one exists, then sends DMs fire-and-forget unless `noDm === true`; `event.deleted` removes `answers` where `eventId` and the request), the stub client, the seed, the pinned lists.
- [ ] **Step 4: Run** the new suite plus `test/seed.test.js test/adminPlugins.test.js test/pluginServer.test.js test/pluginClientGuards.test.js` → PASS; then `npm test` → PASS.
- [ ] **Step 5: Commit** — `Add the Event-Feedback plugin with its routes and DMs`

---

### Task 3: Page (member form, own answers, admin summary)

**Files:**
- Modify: `plugins/event-feedback/client.js`
- Create: `plugins/event-feedback/assets/view.js`, `plugins/event-feedback/client.css`
- Test: `test/eventFeedbackView.test.js` (harness like `test/badgesView.test.js`; remember: fake DOM — `innerHTML` only per element, `document.querySelector` returns a dummy, put `id` after `data-*` attributes in a tag, timers need `{ timers: true }` + `advance`)
- Wiki: `docs/wiki/concepts/plugin-sdk.md` (reference plugins row + a short „Event-Feedback“ paragraph: rules, data, hooks, routes, anonymity limit), `docs/wiki/modules/dev-mock-mode.md` (seed)

**Interfaces:**
- Consumes: Task 2 routes.
- Produces (pure, `assets/view.js`, `helpers` last): `renderStars(rating, { input })` (5 buttons `data-click="p:event-feedback:pickStar" data-rating="n"` with `aria-pressed` and „1 Stern“ … „5 Sterne“ when `input`, else read-only icons `bi-star-fill`/`bi-star` with `aria-label` „4 von 5 Sternen“), `renderForm(entry, helpers)` (`#ef-comment` textarea maxlength 1000, button `#ef-send` „Feedback senden“ / „Feedback ändern“; read-only text „Die Feedback-Zeit für dieses Event ist vorbei.“ when not editable), `renderMine(mine, helpers)` („Offen“ cards with link `#p/event-feedback/<id>`, „Deine Bewertungen“; empty states „Gerade wartet kein Event auf dein Feedback.“), `renderSummary(summary, helpers, { openId, detail })` (category chips, event rows „★ 4,3“ and „9 von 12 (75 %)“, inline detail with star bars via `data-style-width` and comments), `renderAdminSwitch(tab)` (pills „Auswertung“ / „Mein Feedback“).
- `client.js`: `ui.addPage({ access: 'member', title: 'Feedback', tab: { label: 'Feedback', icon: 'bi-chat-heart' }, render(container, param) })`; tab badge = `open.length` from `/mine` (after register and after each answer); actions `pickStar`, `sendAnswer`, `showTab`, `openEvent`; toast „Danke für dein Feedback!“; errors as `danger` toasts.

- [ ] **Step 1: Write the failing view and client tests**

```js
test('stars as input carry aria-pressed and German labels; read-only stars say n von 5', async () => { /* … */ });
test('the form escapes the title, prefills an answer and turns read-only outside the window', async () => { /* … */ });
test('the admin summary shows average with a comma, the rate and comments without names', async () => {
    // average 4.3 → '★ 4,3'; eligible 12 count 9 → '9 von 12 (75 %)'; eligible 0 → no rate; hostile comment escaped
});
test('client: a member opens #p/event-feedback/<id>, picks 4 stars, writes a comment and sends', async () => {
    // PUT body { rating: 4, comment: 'Gut' }; toast 'Danke für dein Feedback!'; tab badge refreshed from /mine
});
test('client: admins switch between Auswertung and Mein Feedback and open an event detail', async () => { /* … */ });
```

- [ ] **Step 2: Run** `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/eventFeedbackView.test.js` → FAIL.
- [ ] **Step 3: Implement** view, client, `client.css` (tokens only; star buttons, bars). **Step 4: Run** the view suite, `test/pluginClientGuards.test.js test/cssRules.test.js test/contrast.test.js test/designTokens.test.js`, then `npm run wiki` and `npm test` → PASS.
- [ ] **Step 5: Commit** — `Add the page of the Event-Feedback plugin`
- [ ] **Step 6: Push and PR** `feature/event-feedback` → `feature/plugin-sdk-1.1` (German, Problem / Ursache / Änderung / Verifikation), only after the user's okay.

---

### Task 4: Release 3.5.0 (on `feature/plugin-sdk-1.1`, after the feedback PR is merged; replaces Task 6 of the badges plan)

- [ ] **Step 1:** `npm version 3.5.0 --no-git-tag-version`; new top entry in `updates.json` (date of the release day, German news: „Eigene Badges“, „Event-Feedback“, one short line for plugin authors on SDK 1.1), same shape as 3.4.0.
- [ ] **Step 2:** `npm test` and `npm run test:e2e` → PASS.
- [ ] **Step 3: Commit** — `Release 3.5.0 with plugin SDK 1.1, badges and event feedback`
- [ ] **Step 4:** Push and open the PR `feature/plugin-sdk-1.1` → `main` (German, links #162), only after the user's okay. Merging publishes image, tag and release; do not push a tag; check afterwards that the release appeared.
