# Badges Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the official plugin „Badges“: admins create badges, award them by hand or by rule (participations / check-ins, optional category), optionally tied to a Discord role; members see them in their profile. Then release DEMS 3.5.0.

**Architecture:** One folder `plugins/badges/`. `rules.js` is pure (validation, counting, due awards, texts, icon list). `engine.js` owns the plugin's two in-memory queues (evaluations/writes, and background effects: role, DM, post) and talks to `ctx`. `server.js` wires routes, hooks and the profile provider. The browser side is `client.js` (state + actions) with pure markup in `assets/view.js` and styles in `client.css`.

**Tech Stack:** Plugin SDK 1.1 (`docs/superpowers/plans/2026-11-21-plugin-sdk-1-1.md` must be done), Node built-ins only, ES module client, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-plugin-sdk-1-1-badges-design.md` (Part 2). Branch: `feature/badges-plugin` created from `feature/plugin-sdk-1.1` after the SDK plan; its PR targets `feature/plugin-sdk-1.1`. Task 6 (release) runs on `feature/plugin-sdk-1.1` after that merge.

## Global Constraints

- Official plugin rules (`test/pluginClientGuards.test.js`): `server.js`/`rules.js`/`engine.js` require only Node built-ins and own files, no DEMS imports, no `node_modules`; the client imports only `./assets/<name>.js`; actions only through `ui.actions.register` (`data-click` etc. → `p:badges:<name>`); no inline handlers or styles; tokens only in `client.css`; no emojis; Bootstrap Icons only.
- All UI text, error messages, DMs, posts and audit details in German; code and comments in English.
- Escape every interpolated value with `ui.helpers.escapeHtml`; runtime colours only via `data-style-*` + `ui.helpers.applyStyleData`; hidden start states via `.is-hidden` + `ui.helpers.showElement/toggleElement`.
- All plugin routes `access: 'admin'`; every mutation writes `ctx.audit(...)`.
- Limits from the spec, verbatim: name 1–40, description ≤ 200, `count` 1–1000, at most 100 badges; colour `#rrggbb`.
- Teilnahme = own registration `accepted` for an event with status `archived`; Check-in = own registration `checkedIn === true` for an event not `cancelled`; `category` set → `event.category === category` exactly.
- Rules never revoke. A revoked award stays as tombstone (`revokedAt` set); awarding by hand again clears it.
- Backfill (rule badge created or its rule/category changed) sends no DM and no channel post; it does give roles.
- A role is removed only when the award has `roleAdded: true` and no other active award of the member carries the same role.
- Commit messages: English imperative + why, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Wiki updated in the same commit as behaviour, then `npm run wiki`.

## Review Focus

1. Two triggers for the same member at the same moment (check-in hook while an admin awards by hand) create one award, not two DMs — pinned in Task 3 (serial queue + deterministic doc id).
2. A badge whose role was deleted in Discord or became forbidden: saving another field of the badge must still work (role validated only when it changes), and effects record `roleSynced: false` instead of throwing — pinned in Task 4.
3. Deleting a member's DEMS account: their awards vanish (core purge on `userId`), the holder list and counts no longer show them, and nothing crashes on the missing member — pinned in Task 2.
4. An event moved back from `archived` to `active` and archived again must not award twice or send a second DM — pinned in Task 3.
5. A rule badge with `count` lowered after members already hold it: the backfill awards only the newly due members — pinned in Task 3.

---

### Task 1: Pure rules (`rules.js`)

**Files:**
- Create: `plugins/badges/rules.js`
- Test: `test/badgesRules.test.js`

**Interfaces:**
- Produces:
  - `ICONS` — array of ~40 `bi-*` names (award, trophy, star, gem, shield, heart, fire, lightning, rocket, controller, crown-like `bi-award-fill` …; only names present in `public/vendor/bootstrap-icons/bootstrap-icons.css`).
  - `MAX_BADGES = 100`
  - `validateBadge(input)` → `{ ok: true, value: { name, description, icon, color, rule, roleId } } | { ok: false, error }`; trims `name`/`description`; `rule` `{ type: 'manual' }` or `{ type: 'participations'|'checkins', count, category }` (`category` trimmed string or `null`); `roleId` snowflake or `null`.
  - `ruleText(rule)` → `'Von Hand'` | `'Ab 1 Teilnahme'` / `'Ab 10 Teilnahmen'` | `'Ab 1 Check-in'` / `'Ab 5 Check-ins'`, with `' · <Kategorie>'` appended when `category` is set.
  - `countFor(rule, registrations, eventsById)` → number (registrations of one member).
  - `awardId(badgeId, userId)` → `` `${badgeId}_${userId}` ``.
  - `dueAwards({ badges, awards, registrations, events, userIds = null })` → `Array<{ badgeId, userId }>`: rule badges only; members of `userIds` (or every member with a registration); due when `countFor ≥ count` and no award doc (active or tombstone) exists.
  - `progressFor(rule, count)` → `Math.min(1, count / rule.count)`.
  - `isActive(award)` → `!award.revokedAt`.
  - `awardDm(badge)` → `Du hast das Badge **<name>** erhalten!`; `awardPost(memberName, badge)` → `**<memberName>** hat das Badge **<name>** erhalten.` (Discord markdown characters `*_~\`|` in names escaped with `\`).

- [ ] **Step 1: Write the failing tests**

```js
test('validateBadge trims, checks every limit and names the problem in German', () => {
    const ok = validateBadge({ name: ' Veteran ', description: '', icon: 'bi-trophy', color: '#22C55E',
        rule: { type: 'participations', count: 10, category: ' Raid ' }, roleId: null });
    assert.deepEqual(ok, { ok: true, value: { name: 'Veteran', description: '', icon: 'bi-trophy', color: '#22c55e',
        rule: { type: 'participations', count: 10, category: 'Raid' }, roleId: null } });
    const cases = [
        [{ name: '' }, 'Der Name muss 1 bis 40 Zeichen lang sein.'],
        [{ name: 'x'.repeat(41) }, 'Der Name muss 1 bis 40 Zeichen lang sein.'],
        [{ description: 'x'.repeat(201) }, 'Die Beschreibung darf höchstens 200 Zeichen lang sein.'],
        [{ icon: 'bi-nope' }, 'Bitte wähle ein Icon aus der Liste.'],
        [{ color: 'red' }, 'Bitte wähle eine gültige Farbe.'],
        [{ rule: { type: 'checkins', count: 0 } }, 'Die Anzahl muss zwischen 1 und 1000 liegen.'],
        [{ rule: { type: 'checkins', count: 1001 } }, 'Die Anzahl muss zwischen 1 und 1000 liegen.'],
        [{ rule: { type: 'karma' } }, 'Bitte wähle, wie das Badge vergeben wird.'],
        [{ roleId: 'abc' }, 'Diese Rolle kann das Plugin nicht vergeben.']
    ];
    for (const [patch, error] of cases) assert.deepEqual(validateBadge({ ...VALID, ...patch }), { ok: false, error });
});

test('ruleText', () => {
    assert.equal(ruleText({ type: 'manual' }), 'Von Hand');
    assert.equal(ruleText({ type: 'participations', count: 1, category: null }), 'Ab 1 Teilnahme');
    assert.equal(ruleText({ type: 'participations', count: 10, category: 'Raid' }), 'Ab 10 Teilnahmen · Raid');
    assert.equal(ruleText({ type: 'checkins', count: 5, category: null }), 'Ab 5 Check-ins');
});

test('countFor counts accepted registrations of archived events and check-ins of not cancelled ones', () => {
    const events = new Map([['a', { status: 'archived', category: 'Raid' }], ['b', { status: 'archived', category: 'Quiz' }],
        ['c', { status: 'active', category: 'Raid' }], ['d', { status: 'cancelled', category: 'Raid' }]]);
    const regs = [
        { eventId: 'a', status: 'accepted', checkedIn: true }, { eventId: 'b', status: 'accepted', checkedIn: false },
        { eventId: 'c', status: 'accepted', checkedIn: true }, { eventId: 'd', status: 'accepted', checkedIn: true },
        { eventId: 'a', status: 'rejected', checkedIn: false }, { eventId: 'gone', status: 'accepted', checkedIn: true }
    ];
    assert.equal(countFor({ type: 'participations', category: null }, regs, events), 2);
    assert.equal(countFor({ type: 'participations', category: 'Raid' }, regs, events), 1);
    assert.equal(countFor({ type: 'checkins', category: null }, regs, events), 2);
    assert.equal(countFor({ type: 'checkins', category: 'Raid' }, regs, events), 2);
});

test('dueAwards skips manual badges, existing awards and tombstones, honours userIds', () => { /* … */ });
test('every icon exists in the vendored Bootstrap Icons font', () => { /* read bootstrap-icons.css, assert each `.${icon}::before` */ });
test('awardDm and awardPost escape Discord markdown', () => {
    assert.equal(awardPost('a*b', { name: 'X_Y' }), '**a\\*b** hat das Badge **X\\_Y** erhalten.');
});
```

(`VALID` = the valid input of the first case. The `dueAwards` test: badges `manual`, `participations ≥ 1`, `checkins ≥ 1`; awards contain one active and one tombstone; assert the exact `[{ badgeId, userId }]` list, and that `userIds: ['u2']` limits it.)

- [ ] **Step 2: Run to verify they fail** — `node --test test/badgesRules.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `plugins/badges/rules.js`** (CommonJS, no requires).
- [ ] **Step 4: Run** — `node --test test/badgesRules.test.js` → PASS.
- [ ] **Step 5: Commit** — `Add the rules of the badges plugin`

---

### Task 2: Manifest, badge CRUD, manual awards and the profile provider

**Files:**
- Create: `plugins/badges/plugin.json` (exactly the manifest of the spec; `"author": "DEMS"`, `"server": "server.js"`, `"client": "client.js"`), `plugins/badges/engine.js`, `plugins/badges/server.js`, a minimal `plugins/badges/client.js` (`export function register(ui) {}` — filled in Task 5)
- Modify: `dev/seedData.js` (`buildPluginSeedData` + `badges`), `test/pluginTestServer.js` only if a constant for the official plugins list is needed
- Test: `test/badgesServer.test.js` (create)

**Interfaces:**
- Consumes: Task 1 (`validateBadge`, `ruleText`, `awardId`, `isActive`, `progressFor`, `countFor`, `MAX_BADGES`, `ICONS`); SDK 1.1 `ctx.data`, `ctx.members.get/search`, `ctx.discord.listRoles`, `ctx.events.list`, `ctx.registrations.list`, `ctx.profile.badges`, `ctx.audit`.
- Produces:
  - `createEngine(ctx)` in `engine.js` → `{ serial(task), award({ badge, userId, by, notify }), revoke({ badge, userId, by }), profileBadges(userId) }` (Task 3 adds `evaluate`, Task 4 adds the effects).
  - Routes below `/api/plugins/badges` (all `access: 'admin'`):
    | Method | Path | Body / answer |
    |---|---|---|
    | GET | `/badges` | `[{ id, name, description, icon, color, rule, ruleText, roleId, holders, unsynced, createdAt }]` sorted by `createdAt` |
    | GET | `/meta` | `{ icons: ICONS, categories: string[] (distinct non-empty `category` of all events, sorted), roles: listRoles(), eventRoleIds: string[] (`assignRoleId` of events) }` |
    | POST | `/badges` | badge input → created badge (201 semantics not needed; answer the badge) |
    | PUT | `/badges/:id` | badge input → updated badge |
    | DELETE | `/badges/:id` | `{ success: true }` |
    | GET | `/badges/:id/holders` | `[{ userId, name, avatar, awardedAt, byRule: boolean, roleSynced }]` active awards, newest first; a member without `users` doc → name `'Unbekanntes Mitglied'` |
    | POST | `/badges/:id/awards` | `{ userId }` → `{ success: true }` |
    | DELETE | `/badges/:id/awards/:userId` | `{ success: true }` |
    | GET | `/members?q=` | `ctx.members.search(q)` |
  - Errors via `ctx.httpError`: 404 `Badge nicht gefunden.`, 400 validation errors of `validateBadge`, 400 `Höchstens 100 Badges.`, 400 `Diese Rolle kann das Plugin nicht vergeben.` (a changed `roleId` not in `listRoles()`), 404 `Mitglied nicht gefunden.` (`ctx.members.get` null), 400 `Dieses Mitglied hat das Badge schon.`, 400 `Dieses Mitglied hat das Badge nicht.`.
  - Audit actions: `badge.created`, `badge.updated`, `badge.deleted`, `badge.awarded`, `badge.revoked` (details e.g. `Badge „Veteran“ angelegt`, `Badge „Veteran“ an Kira vergeben`).
  - Seed: badge `dev-badge-founder` („Gründungsmitglied“, `bi-star-fill`, manual, no role) awarded to the admin persona by the admin; badge `dev-badge-regular` („Stammgast“, `bi-trophy`, participations ≥ 2, no category, no role), no award. Core seed (`buildSeedData`): one former member `users/200000000000000099` („Ex-Mitglied“, not in `dev/mockGuild.js`), so role changes for someone who left the server can be tested.

- [ ] **Step 1: Write the failing server tests** (`test/badgesServer.test.js`, same setup as `test/eventSubmissionsServer.test.js`: `startPluginServer()`, `loginAt(...)`)

```js
const API = '/api/plugins/badges';

test('members cannot reach the admin routes', async () => {
    const member = await loginAt(server.baseUrl, 'member');
    assert.equal((await member.request(`${API}/badges`)).status, 403);
});

test('create, list, update and delete a badge; invalid input is refused in German', async () => {
    const created = await json(await admin.send('POST', `${API}/badges`, BADGE));
    assert.equal(created.name, 'Veteran');
    const listed = (await json(await admin.request(`${API}/badges`))).find(b => b.id === created.id);
    assert.equal(listed.ruleText, 'Von Hand');
    assert.equal(listed.holders, 0);
    const res = await admin.send('PUT', `${API}/badges/${created.id}`, { ...BADGE, name: '' });
    assert.deepEqual(await json(res, 400), { error: 'Der Name muss 1 bis 40 Zeichen lang sein.' });
    await json(await admin.send('DELETE', `${API}/badges/${created.id}`));
    assert.deepEqual(await json(await admin.send('DELETE', `${API}/badges/${created.id}`), 404), { error: 'Badge nicht gefunden.' });
});

test('a forbidden or unknown role is refused; an allowed mock role is accepted', async () => {
    const refused = await admin.send('POST', `${API}/badges`, { ...BADGE, roleId: ROLE_ID.MODERATOR });
    assert.deepEqual(await json(refused, 400), { error: 'Diese Rolle kann das Plugin nicht vergeben.' });
    assert.equal((await json(await admin.send('POST', `${API}/badges`, { ...BADGE, roleId: ROLE_ID.VIP }))).roleId, ROLE_ID.VIP);
});

test('manual award shows in the holders and in the member profile; revoke hides it', async () => {
    const badge = await json(await admin.send('POST', `${API}/badges`, BADGE));
    const tom = persona('member');
    await json(await admin.send('POST', `${API}/badges/${badge.id}/awards`, { userId: tom.userId }));
    assert.deepEqual(await json(await admin.send('POST', `${API}/badges/${badge.id}/awards`, { userId: tom.userId }), 400),
        { error: 'Dieses Mitglied hat das Badge schon.' });
    assert.equal((await json(await admin.request(`${API}/badges/${badge.id}/holders`)))[0].userId, tom.userId);
    const member = await loginAt(server.baseUrl, 'member');
    const profile = await json(await member.request('/api/user/profile'));
    assert.equal(profile.badges.find(b => b.id === `p:badges:${badge.id}`).unlocked, true);
    await json(await admin.send('DELETE', `${API}/badges/${badge.id}/awards/${tom.userId}`));
    const after = await json(await member.request('/api/user/profile'));
    assert.equal(after.badges.some(b => b.id === `p:badges:${badge.id}`), false);
});

test('rule badges show progress in the profile before they are earned', async () => { /* seeded Stammgast: locked, progress = archived accepted participations / 2 */ });
test('account deletion removes the member from holders and counts', async () => { /* newbie gets an award, DELETE /api/user/account as newbie, holders without newbie, count down */ });
test('the seed has the founder badge for the admin', async () => { /* GET /badges includes dev-badge-founder with holders 1 */ });
```

(`BADGE` = `{ name: 'Veteran', description: 'Zehn Raids', icon: 'bi-trophy', color: '#22c55e', rule: { type: 'manual' }, roleId: null }`; `json(res, status)` as in the reference test; `ROLE_ID` from `dev/mockGuild`.)

- [ ] **Step 2: Run to verify they fail** — `node --test test/badgesServer.test.js` → FAIL (404 plugin not found).

- [ ] **Step 3: Implement** `plugin.json`, `engine.js` (`serial` = one promise chain like `createKeyedQueue` of the reference plugin with a single key; `award` writes `awards/<awardId>` `{ badgeId, userId, awardedAt, awardedBy, roleAdded: false, roleSynced: !badge.roleId, revokedAt: null, revokedBy: null }` — overwriting a tombstone; `revoke` sets `revokedAt/By`; `profileBadges(userId)` per the spec's "Member side": active awards → `{ id: badge.id, name, description: description || ruleText, icon, color, unlocked: true }`, rule badges without any award doc → `unlocked: false, progress`; manual unawarded and tombstoned badges omitted; order by badge `createdAt`), `server.js` (routes, `ctx.profile.badges(({ userId }) => engine.profileBadges(userId))`, all writes through `engine.serial`), seed data, empty `client.js`. Holder counts and lists skip awards whose `userId` has no `users` doc only for the name; the purge already removes the docs.

- [ ] **Step 4: Run** — `node --test test/badgesServer.test.js test/pluginClientGuards.test.js test/pluginDiscovery.test.js` → PASS.

- [ ] **Step 5: Commit** — `Add the badges plugin with manual awards and profile badges`

---

### Task 3: Automatic rules — triggers and backfill

**Files:**
- Modify: `plugins/badges/engine.js` (`evaluate`), `plugins/badges/server.js` (hooks `event.ended`, `registration.checkedIn`; backfill after create/update)
- Test: `test/badgesServer.test.js`

**Interfaces:**
- Produces: `engine.evaluate({ userIds = null, notify, by })` → `Promise<Map<badgeId, number>>` (awarded per badge), runs inside `serial`; reads `badges`, `awards`, `ctx.registrations.list(userIds?.length === 1 ? { userId } : {})`, `ctx.events.list()` once; writes each due award through the same code as `award` (`awardedBy: 'rule'`); for each badge with ≥ 1 new award one audit entry `badge.ruleAwarded` (`Badge „<Name>“: <n> Mitglieder automatisch ausgezeichnet`, adminId = `by` or `'system'`).
- Triggers: `event.ended` → `evaluate({ userIds: <userIds of accepted registrations of payload.event.id>, notify: true })`; `registration.checkedIn` → `evaluate({ userIds: [payload.registration.userId], notify: true })`; after `POST /badges` of a rule badge and after `PUT` that changed `rule.type`, `rule.count` or `rule.category` → `evaluate({ notify: false, by: adminId })`, not awaited by the route (the route answers at once).

- [ ] **Step 1: Write the failing tests**

```js
test('ending an event awards a participation badge once, also after re-archiving', async () => {
    // badge participations ≥ 1, category 'Quiz'; event (category 'Quiz') with raider accepted; POST …/end
    // → raider holds it (poll holders up to ~2 s), audit has one badge.ruleAwarded entry, DM line count +1 only with dmOnAward on
    // PUT …/status active, then POST …/end again → still one award, no second DM
});
test('a check-in awards a check-in badge to that member only', async () => { /* admin PUT …/checkin → member holds it */ });
test('creating a rule badge backfills silently', async () => {
    // seeded archived event has accepted lena and tom → badge participations ≥ 1 → both hold it,
    // server.output() gets no new "DM an" line and no channel line
});
test('lowering the count backfills only the newly due members; revoked members stay revoked', async () => { /* … */ });
test('a check-in and a manual award at the same time create one award', async () => {
    // fire PUT …/checkin and POST …/awards in parallel for the same member → holders has one entry
});
```

(Use the event/registration helpers the reference server test uses; read the audit log through the admin audit route the other server tests use.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `node --test test/badgesServer.test.js test/badgesRules.test.js` → PASS.
- [ ] **Step 5: Commit** — `Award badges automatically by participations and check-ins`

---

### Task 4: Effects — roles, DM, channel post, retry

**Files:**
- Modify: `plugins/badges/engine.js` (background effects queue), `plugins/badges/server.js` (route `POST /badges/:id/roles/retry`; role change on `PUT`; role clean-up on `DELETE`)
- Test: `test/badgesServer.test.js`

**Interfaces:**
- Produces: `engine.effects` queue (serial, never awaited by routes or hooks; every step in `try/catch` + `ctx.log.error`):
  - after an award: `roleId` → `ctx.discord.addRole` → award `{ roleAdded: changed, roleSynced: true }` or `{ roleSynced: false }`; then, only when `notify`: `dmOnAward` on → `ctx.discord.sendDM(userId, { text: awardDm(badge), link: { label: 'Zum Profil', url: ctx.siteUrl('profile') } })`; `announceChannel` set → `ctx.discord.sendChannelMessage('announceChannel', { text: awardPost(memberName, badge) })`.
  - after a revoke, a delete or a role change: `removeRole` only where `roleAdded` and no other active award of the member has a badge with the same `roleId`.
  - `PUT` with a new `roleId`: for every active award remove the old role (rule above), add the new one, recompute `roleAdded`/`roleSynced`; a `roleId` unchanged is not validated against `listRoles()` again.
  - `DELETE /badges/:id`: removes roles (rule above), then the awards and the badge.
  - `POST /badges/:id/roles/retry` → re-queues `addRole` for active awards with `roleSynced: false`, answers `{ queued: <n> }`.
  - `GET /badges` `unsynced` = active awards with `roleSynced: false`.

- [ ] **Step 1: Write the failing tests** (mock bot log lines in `server.output()`: `Rolle <name> an <user> vergeben` / `… entfernt` from `dev/mockBot.js` Task 3 of the SDK plan)

```js
test('awarding a badge with a role gives it once; revoking takes it only if the badge gave it', async () => {
    // badge roleId VIP; award Tom (member persona, no VIP) → output has "Rolle @VIP an Tom (200000000000000003) vergeben"
    // badge roleId Raid-Team; award Lena (raider persona, has Raid-Team) → no new line, roleAdded false;
    // revoke Lena → no "entfernt" line; revoke Tom from the VIP badge → "Rolle @VIP von Tom (200000000000000003) entfernt"
});
test('a second badge with the same role keeps it on revoke of the first', async () => { /* … */ });
test('deleting a badge removes the roles it gave', async () => { /* … */ });
test('changing the role moves holders from the old to the new role', async () => { /* VIP → Raid-Team */ });
test('dmOnAward and announceChannel send one DM and one post per award, never on backfill', async () => {
    // PUT /api/admin/plugins/badges/settings { dmOnAward: true, announceChannel: CHANNEL_ID.<some text channel> }
    // manual award → +1 DM line, +1 channel line; backfill of a new rule badge → +0
});
test('an unsynced role shows in the list and retry queues it', async () => {
    // award the seeded former member 200000000000000099 (users doc, not in the mock guild) → roleSynced false, GET /badges unsynced 1,
    // POST …/roles/retry → { queued: 1 }
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `node --test test/badgesServer.test.js` → PASS.
- [ ] **Step 5: Commit** — `Give and take Discord roles with badges and announce new ones`

---

### Task 5: Admin page (client)

**Files:**
- Modify: `plugins/badges/client.js`
- Create: `plugins/badges/assets/view.js`, `plugins/badges/client.css`
- Test: `test/badgesView.test.js` (create; pure markup like `test/eventSubmissionsView.test.js`)

**Interfaces:**
- Consumes: Task 2/4 routes; `ui.addPage`, `ui.api`, `ui.actions.register`, `ui.helpers` (`escapeHtml`, `showToast`, `showConfirmDialog`, `avatar`, `emptyState`, `applyStyleData`, `showElement`, `toggleElement`).
- Produces (pure, `assets/view.js`, each takes `helpers` last):
  - `renderBadgeCards(badges, helpers)` — per badge: icon in its colour (`data-style-color`), name, description, `ruleText`, role chip with the role name from `meta.roles` (or „Rolle nicht verfügbar“), `<n> Mitglieder`, warning line `Rolle bei <n> Mitgliedern noch nicht vergeben` + button `Erneut versuchen` when `unsynced > 0`, buttons `Vergeben`, `Inhaber`, `Bearbeiten`, `Löschen`; empty list → `emptyState` „Noch keine Badges“.
  - `renderEditor(badge | null, meta, helpers)` — inline card form (not a modal, like „Event einreichen“): Name, Beschreibung, icon grid of `meta.icons` (radio buttons, `aria-label` = icon name), Farbe (`<input type="color">`), Vergabe (select „Von Hand“, „Ab N Teilnahmen“, „Ab N Check-ins“) + number field (hidden for „Von Hand“) + Kategorie select („Alle Kategorien“ + `meta.categories`), Discord-Rolle select („Keine“ + `meta.roles`; empty roles → hint „Der Bot ist nicht verbunden oder es gibt keine Rolle, die ein Plugin vergeben darf.“; a chosen role in `meta.eventRoleIds` → hint „Diese Rolle wird auch von Events vergeben und danach wieder entzogen.“), buttons Speichern / Abbrechen.
  - `renderHolders(badge, holders, helpers)` — avatar, name, date (`de-DE`), „von Hand“/„automatisch“, `Entziehen`.
  - `renderAwardSearch(results, helpers)` — search field (debounced 300 ms in `client.js`) + hits with `Vergeben`.
- `client.js`: `ui.addPage({ access: 'admin', title: 'Badges', tab: { label: 'Badges', icon: 'bi-award' }, render })`; actions `newBadge`, `editBadge`, `saveBadge`, `cancelEdit`, `deleteBadge` (`showConfirmDialog` with the spec's text: „<n> Mitglieder haben dieses Badge. Es wird bei allen entfernt, ebenso die Rolle „<Rolle>“, wo das Badge sie vergeben hat.“ — without a role the second sentence is left out), `showHolders`, `revokeAward`, `showAward`, `searchMembers`, `awardMember`, `retryRoles`, `changeRuleType`; toasts `Badge gespeichert.`, `Badge gelöscht.`, `Badge vergeben.`, `Badge entzogen.`, errors as `danger` with the server's message.

- [ ] **Step 1: Write the failing view tests**

```js
test('badge cards escape names and show rule, role, holders and the unsynced warning', () => {
    const html = renderBadgeCards([{ id: 'b1', name: '<x>', description: '', icon: 'bi-trophy', color: '#22c55e',
        ruleText: 'Ab 10 Teilnahmen · Raid', roleId: '1', holders: 12, unsynced: 3 }], META, helpers);
    assert.match(html, /&lt;x&gt;/);
    assert.match(html, /Ab 10 Teilnahmen · Raid/);
    assert.match(html, /12 Mitglieder/);
    assert.match(html, /Rolle bei 3 Mitgliedern noch nicht vergeben/);
    assert.match(html, /data-click="p:badges:retryRoles"/);
    assert.doesNotMatch(html, /style=/);
});
test('the editor hides the count for manual badges and warns about event roles', () => { /* … */ });
test('an empty list shows the empty state', () => { /* … */ });
```

(`helpers` = real `escapeHtml` etc. imported the way `test/eventSubmissionsView.test.js` does; `META` = `{ icons: ['bi-trophy'], categories: ['Raid'], roles: [{ id: '1', name: 'VIP', color: null }], eventRoleIds: [] }`.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** view, client and `client.css` (only tokens from `public/css/tokens.css`; reuse core components — card, chip, button, empty state, avatar; only the icon grid and the badge icon circle need own rules). **Step 4: Run** `node --test test/badgesView.test.js test/pluginClientGuards.test.js test/pluginClient.test.js` and `npm test` → PASS.
- [ ] **Step 5: Manual check** — `npm run dev:mock`, admin persona: tab „Badges“, create a rule badge with the VIP role, see the mock log lines, open „Inhaber“, award by search, revoke, delete; member persona: profile lists the badges with progress. Light and dark theme.
- [ ] **Step 6: Wiki** — `plugin-sdk.md` reference plugins row + a short „Badges“ paragraph (collections `badges`, `awards`, rules, role rule, backfill without messages, roles stay after account deletion); `write-plugin.md` example of `ctx.profile.badges` if the how-to lists `ctx` parts; `docs/wiki/index.md` file table already covers `plugins/*`; `npm run wiki`.
- [ ] **Step 7: Commit** — `Add the admin page of the badges plugin`
- [ ] **Step 8: Push and open the PR** `feature/badges-plugin` → `feature/plugin-sdk-1.1` (German: Problem / Ursache / Änderung / Verifikation, ends with the Claude Code line), after the user agreed to push.

---

### Task 6: Release 3.5.0 (on `feature/plugin-sdk-1.1`, after the plugin PR is merged)

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm version 3.5.0 --no-git-tag-version`), `updates.json` (new top entry `3.5.0`, date of the release day, German news: one highlighted entry „Eigene Badges“ for members/admins, one for plugin authors „Plugin-SDK 1.1“), `docs/wiki/ops/deployment.md` only if it lists versions

- [ ] **Step 1:** `npm version 3.5.0 --no-git-tag-version`; add the `updates.json` entry (same shape as 3.4.0: `title`, `content`, `highlight`).
- [ ] **Step 2:** `npm test` → PASS; `npm run test:e2e` → PASS (profile and styleguide specs touch badges).
- [ ] **Step 3: Commit** — `Release 3.5.0 with plugin SDK 1.1 and the badges plugin`
- [ ] **Step 4:** Push and open the PR `feature/plugin-sdk-1.1` → `main` (German, Problem / Ursache / Änderung / Verifikation, links #162), after the user agreed. Merging publishes image, tag and release automatically — do not push a tag; afterwards check that the release appeared.
