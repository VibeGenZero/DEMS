// Server side of the official plugin „Badges“ (plugins/badges) through the real server:
// dev mock mode switches the plugin on and seeds its badges; this process writes extra
// documents straight into the server's SQLite file.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');
const { startPluginServer, loginAt } = require('./pluginTestServer');
const { PERSONAS, ROLE_ID } = require('../dev/mockGuild');

const API = '/api/plugins/badges';
const BADGE = { name: 'Veteran', description: 'Zehn Raids', icon: 'bi-trophy', color: '#22c55e', rule: { type: 'manual' }, roleId: null };
const DAY = 86_400_000;
const FORMER = '200000000000000098';

const dbPath = path.join(createTempDir('badges-server'), 'dev.sqlite');
let server;
let admin;

before(async () => {
    server = await startPluginServer({ DEV_SQLITE_PATH: dbPath }, { seed: false });
    admin = await loginAt(server.baseUrl, 'admin');
});

after(() => server.stop());

const persona = (id) => PERSONAS.find(entry => entry.id === id);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** The server's database, opened in this process (SQLite allows a second connection). */
function store() {
    process.env.SQLITE_PATH = dbPath;
    return require('../firebaseAdmin');
}

async function json(res, status = 200) {
    assert.equal(res.status, status, await res.clone().text());
    return res.json();
}

const createBadge = async (fields = {}) => json(await admin.send('POST', `${API}/badges`, { ...BADGE, ...fields }));
const listBadges = async () => json(await admin.request(`${API}/badges`));
const holdersOf = async (badgeId) => json(await admin.request(`${API}/badges/${badgeId}/holders`));
const profileOf = async (personaId) => json(await (await loginAt(server.baseUrl, personaId)).request('/api/user/profile'));

async function auditEntries(action) {
    const body = await json(await admin.request('/api/admin/audit-log?limit=500'));
    return body.data.filter(entry => entry.action === `plugin:badges:${action}`);
}

// ── Access and CRUD ─────────────────────────────────────────────────────

test('members cannot reach the admin routes', async () => {
    const member = await loginAt(server.baseUrl, 'member');
    assert.equal((await member.request(`${API}/badges`)).status, 403);
    assert.equal((await member.send('POST', `${API}/badges`, BADGE)).status, 403);
});

test('the seed has the founder badge for the admin and the regular badge without holders', async () => {
    const badges = await listBadges();
    const founder = badges.find(badge => badge.id === 'dev-badge-founder');
    assert.equal(founder.name, 'Gründungsmitglied');
    assert.equal(founder.ruleText, 'Von Hand');
    assert.equal(founder.holders, 1);
    const regular = badges.find(badge => badge.id === 'dev-badge-regular');
    assert.equal(regular.ruleText, 'Ab 2 Teilnahmen');
});

test('create, list, update and delete a badge; invalid input is refused in German', async () => {
    const created = await createBadge();
    assert.equal(created.name, 'Veteran');
    assert.equal(created.holders, 0);
    const listed = (await listBadges()).find(badge => badge.id === created.id);
    assert.deepEqual({ ruleText: listed.ruleText, holders: listed.holders, unsynced: listed.unsynced, roleId: listed.roleId },
        { ruleText: 'Von Hand', holders: 0, unsynced: 0, roleId: null });

    assert.deepEqual(await json(await admin.send('PUT', `${API}/badges/${created.id}`, { ...BADGE, name: '' }), 400),
        { error: 'Der Name muss 1 bis 40 Zeichen lang sein.' });
    const updated = await json(await admin.send('PUT', `${API}/badges/${created.id}`, { ...BADGE, name: 'Raid-Veteran' }));
    assert.equal(updated.name, 'Raid-Veteran');
    assert.equal((await auditEntries('badge.updated')).at(0).details, 'Badge „Raid-Veteran“ geändert');

    await json(await admin.send('DELETE', `${API}/badges/${created.id}`));
    assert.deepEqual(await json(await admin.send('DELETE', `${API}/badges/${created.id}`), 404), { error: 'Badge nicht gefunden.' });
    assert.deepEqual(await json(await admin.request(`${API}/badges/nope/holders`), 404), { error: 'Badge nicht gefunden.' });
    assert.ok((await auditEntries('badge.created')).some(entry => entry.details === 'Badge „Veteran“ angelegt'));
    assert.ok((await auditEntries('badge.deleted')).some(entry => entry.details === 'Badge „Raid-Veteran“ gelöscht'));
});

test('a forbidden or unknown role is refused; an allowed mock role is accepted', async () => {
    for (const roleId of [ROLE_ID.MODERATOR, ROLE_ID.ADMIN, '119999999999999999']) {
        assert.deepEqual(await json(await admin.send('POST', `${API}/badges`, { ...BADGE, roleId }), 400),
            { error: 'Diese Rolle kann das Plugin nicht vergeben.' }, roleId);
    }
    const badge = await createBadge({ roleId: ROLE_ID.VIP });
    assert.equal(badge.roleId, ROLE_ID.VIP);
    await json(await admin.send('DELETE', `${API}/badges/${badge.id}`));
});

test('meta lists icons, event categories, plugin roles and event roles', async () => {
    const meta = await json(await admin.request(`${API}/meta`));
    assert.ok(meta.icons.includes('bi-trophy'));
    assert.ok(meta.categories.includes('Raid'));
    assert.deepEqual(meta.categories, [...meta.categories].sort((a, b) => a.localeCompare(b, 'de')));
    assert.deepEqual(meta.roles.map(role => role.id), [ROLE_ID.RAID_TEAM, ROLE_ID.VIP, ROLE_ID.EVENT, ROLE_ID.MEMBER]);
    assert.ok(Array.isArray(meta.eventRoleIds));
});

test('the member search finds stored members by name', async () => {
    const hits = await json(await admin.request(`${API}/members?q=len`));
    assert.ok(hits.some(hit => hit.id === persona('raider').userId));
});

// ── Manual awards and the profile ───────────────────────────────────────

test('manual award shows in the holders and in the member profile; revoke hides it', async () => {
    const badge = await createBadge();
    const tom = persona('member');
    await json(await admin.send('POST', `${API}/badges/${badge.id}/awards`, { userId: tom.userId }));
    assert.deepEqual(await json(await admin.send('POST', `${API}/badges/${badge.id}/awards`, { userId: tom.userId }), 400),
        { error: 'Dieses Mitglied hat das Badge schon.' });
    assert.deepEqual(await json(await admin.send('POST', `${API}/badges/${badge.id}/awards`, { userId: '299999999999999999' }), 404),
        { error: 'Mitglied nicht gefunden.' });

    const holders = await holdersOf(badge.id);
    assert.deepEqual(holders.map(holder => [holder.userId, holder.name, holder.byRule]), [[tom.userId, 'Tom', false]]);
    assert.equal((await listBadges()).find(entry => entry.id === badge.id).holders, 1);
    assert.ok((await auditEntries('badge.awarded')).some(entry => entry.details === 'Badge „Veteran“ an Tom vergeben'));

    const shown = (await profileOf('member')).badges.find(entry => entry.id === `p:badges:${badge.id}`);
    assert.deepEqual(shown, { id: `p:badges:${badge.id}`, name: 'Veteran', description: 'Zehn Raids', icon: 'bi-trophy', color: '#22c55e', unlocked: true });

    await json(await admin.send('DELETE', `${API}/badges/${badge.id}/awards/${tom.userId}`));
    assert.deepEqual(await json(await admin.send('DELETE', `${API}/badges/${badge.id}/awards/${tom.userId}`), 400),
        { error: 'Dieses Mitglied hat das Badge nicht.' });
    assert.deepEqual(await holdersOf(badge.id), []);
    assert.equal((await profileOf('member')).badges.some(entry => entry.id === `p:badges:${badge.id}`), false);
    assert.ok((await auditEntries('badge.revoked')).some(entry => entry.details === 'Badge „Veteran“ Tom entzogen'));

    // Awarding by hand again clears the tombstone
    await json(await admin.send('POST', `${API}/badges/${badge.id}/awards`, { userId: tom.userId }));
    assert.equal((await holdersOf(badge.id)).length, 1);
    await json(await admin.send('DELETE', `${API}/badges/${badge.id}`));
});

test('rule badges show progress in the profile before they are earned; manual ones stay hidden', async () => {
    const { db, doc, setDoc } = store();
    const lena = persona('raider');
    const archived = new Date(Date.now() - 10 * DAY).toISOString();
    await setDoc(doc(db, 'events', 'badge-progress-event'), { title: 'Fortschritt', status: 'archived', startDate: archived, createdAt: archived, category: 'Fortschritt' });
    await setDoc(doc(db, 'registrations', 'badge-progress-reg'), { eventId: 'badge-progress-event', userId: lena.userId, userName: 'Lena', status: 'accepted', createdAt: archived });
    const ruled = await createBadge({ name: 'Fortschritt', rule: { type: 'participations', count: 4, category: 'Fortschritt' } });
    const manual = await createBadge({ name: 'Nur von Hand' });
    // The backfill of Task 3 must not award it (1 of 4); the profile shows a quarter
    const shown = (await profileOf('raider')).badges.find(entry => entry.id === `p:badges:${ruled.id}`);
    assert.equal(shown.unlocked, false);
    assert.equal(shown.progress, 0.25);
    assert.equal(shown.description, 'Zehn Raids');
    assert.equal((await profileOf('raider')).badges.some(entry => entry.id === `p:badges:${manual.id}`), false);
    for (const badge of [ruled, manual]) await json(await admin.send('DELETE', `${API}/badges/${badge.id}`));
});

test('account deletion removes the member from holders and counts', async () => {
    const badge = await createBadge({ name: 'Abschied' });
    const neo = await loginAt(server.baseUrl, 'newbie');
    await json(await neo.request('/api/user/profile'));
    await json(await admin.send('POST', `${API}/badges/${badge.id}/awards`, { userId: persona('newbie').userId }));
    assert.equal((await holdersOf(badge.id)).length, 1);
    await json(await neo.send('DELETE', '/api/user/account'));
    assert.deepEqual(await holdersOf(badge.id), []);
    assert.equal((await listBadges()).find(entry => entry.id === badge.id).holders, 0);
    await json(await admin.send('DELETE', `${API}/badges/${badge.id}`));
});


// ── Automatic rules ─────────────────────────────────────────────────────

/** Poll until `check(value)` holds (hooks and backfills run in the background), at most ~3 s. */
async function eventually(read, check, label) {
    let value = await read();
    for (let i = 0; i < 60 && !check(value); i++) {
        await sleep(50);
        value = await read();
    }
    assert.ok(check(value), `${label}: ${JSON.stringify(value)}`);
    return value;
}

/** An archived event of `category` with accepted registrations of the given personas, straight into the database. */
async function archivedEventWith(key, category, personaIds) {
    const { db, doc, setDoc } = store();
    const at = new Date(Date.now() - 10 * DAY).toISOString();
    await setDoc(doc(db, 'events', key), { title: key, status: 'archived', startDate: at, createdAt: at, category });
    for (const personaId of personaIds) {
        await setDoc(doc(db, 'registrations', `${key}-${personaId}`), {
            eventId: key, userId: persona(personaId).userId, userName: personaId, status: 'accepted', createdAt: at
        });
    }
}

const holderIds = async (badgeId) => (await holdersOf(badgeId)).map(holder => holder.userId).sort();
const ids = (...personaIds) => personaIds.map(id => persona(id).userId).sort();

/** An active event with instant approval that the given personas registered for. */
async function eventWithMembers(fields, personaIds) {
    const event = await json(await admin.send('POST', '/api/admin/events', { status: 'active', approvalMode: 'instant', ...fields }));
    for (const personaId of personaIds) {
        await json(await (await loginAt(server.baseUrl, personaId)).send('POST', `/api/events/${event.id}/register`, {}));
    }
    return event;
}

async function registrationOf(eventId, personaId) {
    const list = await json(await admin.request(`/api/admin/events/${eventId}/registrations`));
    return list.data.find(reg => reg.userId === persona(personaId).userId);
}

test('ending an event awards a participation badge once, also after it is archived again', async () => {
    const badge = await createBadge({ name: 'Quiz-Fan', rule: { type: 'participations', count: 1, category: 'Quiz-T3' } });
    const event = await eventWithMembers({ title: 'Quiz T3', category: 'Quiz-T3', startDate: new Date(Date.now() + DAY).toISOString() }, ['raider']);
    await sleep(200);
    assert.deepEqual(await holderIds(badge.id), [], 'not before the end');

    await json(await admin.send('POST', `/api/admin/events/${event.id}/end`, {}));
    const [first] = await eventually(() => holdersOf(badge.id), list => list.length === 1, 'raider holds it');
    assert.deepEqual([first.userId, first.byRule], [persona('raider').userId, true]);
    const ruleEntries = (await auditEntries('badge.ruleAwarded')).filter(entry => entry.targetId === badge.id);
    assert.deepEqual(ruleEntries.map(entry => entry.details), ['Badge „Quiz-Fan“: 1 Mitglied automatisch ausgezeichnet']);

    await json(await admin.send('PUT', `/api/admin/events/${event.id}/status`, { status: 'active' }));
    await json(await admin.send('POST', `/api/admin/events/${event.id}/end`, {}));
    await sleep(300);
    const again = await holdersOf(badge.id);
    assert.deepEqual(again.map(holder => [holder.userId, holder.awardedAt]), [[first.userId, first.awardedAt]]);
    assert.equal((await auditEntries('badge.ruleAwarded')).filter(entry => entry.targetId === badge.id).length, 1);
});

test('a check-in awards a check-in badge to that member only', async () => {
    const badge = await createBadge({ name: 'Pünktlich', rule: { type: 'checkins', count: 1, category: 'Check-T3' } });
    const event = await eventWithMembers({ title: 'Check T3', category: 'Check-T3', startDate: new Date(Date.now() - 3600_000).toISOString() }, ['member', 'raider']);
    const tomReg = await registrationOf(event.id, 'member');
    await json(await admin.send('PUT', `/api/admin/registrations/${tomReg.id}/checkin`, { checkedIn: true }));
    await eventually(() => holderIds(badge.id), value => value.length === 1, 'Tom holds it');
    assert.deepEqual(await holderIds(badge.id), ids('member'));
});

test('creating a rule badge awards everyone who already meets the rule', async () => {
    await archivedEventWith('badge-backfill', 'Backfill-T3', ['raider', 'member']);
    const badge = await createBadge({ name: 'Nachzügler', rule: { type: 'participations', count: 1, category: 'Backfill-T3' } });
    await eventually(() => holderIds(badge.id), value => value.length === 2, 'both hold it');
    assert.deepEqual(await holderIds(badge.id), ids('member', 'raider'));
    assert.ok((await holdersOf(badge.id)).every(holder => holder.byRule));
    const entries = (await auditEntries('badge.ruleAwarded')).filter(entry => entry.targetId === badge.id);
    assert.deepEqual(entries.map(entry => [entry.details, entry.adminId]),
        [['Badge „Nachzügler“: 2 Mitglieder automatisch ausgezeichnet', persona('admin').userId]]);
});

test('lowering the count awards only the newly due members; a revoked member stays revoked', async () => {
    await archivedEventWith('badge-lower-1', 'Lower-T3', ['raider', 'member', 'admin']);
    await archivedEventWith('badge-lower-2', 'Lower-T3', ['raider']);
    const badge = await createBadge({ name: 'Treu', rule: { type: 'participations', count: 2, category: 'Lower-T3' } });
    await eventually(() => holderIds(badge.id), value => value.length === 1, 'Lena holds it');
    assert.deepEqual(await holderIds(badge.id), ids('raider'));
    await json(await admin.send('DELETE', `${API}/badges/${badge.id}/awards/${persona('raider').userId}`));

    await json(await admin.send('PUT', `${API}/badges/${badge.id}`, { ...BADGE, name: 'Treu', rule: { type: 'participations', count: 1, category: 'Lower-T3' } }));
    await eventually(() => holderIds(badge.id), value => value.length === 2, 'Tom and Mori hold it');
    assert.deepEqual(await holderIds(badge.id), ids('member', 'admin'));
});

test('changing only the name of a rule badge runs no backfill', async () => {
    const badge = await createBadge({ name: 'Still', rule: { type: 'participations', count: 1, category: 'Still-T3' } });
    await sleep(200);
    await archivedEventWith('badge-still', 'Still-T3', ['member']);
    await json(await admin.send('PUT', `${API}/badges/${badge.id}`, { ...BADGE, name: 'Leise', rule: { type: 'participations', count: 1, category: 'Still-T3' } }));
    await sleep(300);
    assert.deepEqual(await holderIds(badge.id), []);
});

test('a check-in and a manual award at the same time create one award', async () => {
    const badge = await createBadge({ name: 'Gleichzeitig', rule: { type: 'checkins', count: 1, category: 'Race-T3' } });
    const event = await eventWithMembers({ title: 'Race T3', category: 'Race-T3', startDate: new Date(Date.now() - 3600_000).toISOString() }, ['member']);
    const tomReg = await registrationOf(event.id, 'member');
    const [checkin, manual] = await Promise.all([
        admin.send('PUT', `/api/admin/registrations/${tomReg.id}/checkin`, { checkedIn: true }),
        admin.send('POST', `${API}/badges/${badge.id}/awards`, { userId: persona('member').userId })
    ]);
    assert.equal(checkin.status, 200);
    assert.ok([200, 400].includes(manual.status), String(manual.status));
    await sleep(300);
    assert.deepEqual(await holderIds(badge.id), ids('member'));
});

// ── Effects: roles, DM, channel post ────────────────────────────────────

const { CHANNEL_ID } = require('../dev/mockGuild');

/** Lines of the mock Discord log that contain `text`. */
const linesWith = (text) => server.output().split('\n').filter(line => line.includes(text)).length;
const gave = (role, personaId) => `Rolle @${role} an ${persona(personaId).displayName} (${persona(personaId).userId}) vergeben`;
const took = (role, personaId) => `Rolle @${role} von ${persona(personaId).displayName} (${persona(personaId).userId}) entfernt`;
const award = async (badgeId, userId) => json(await admin.send('POST', `${API}/badges/${badgeId}/awards`, { userId }));
const revoke = async (badgeId, userId) => json(await admin.send('DELETE', `${API}/badges/${badgeId}/awards/${userId}`));
const settle = () => sleep(300);

test('awarding a badge with a role gives it once; revoking takes it only if the badge gave it', async () => {
    const vip = await createBadge({ name: 'VIP-Badge', roleId: ROLE_ID.VIP });
    const before = linesWith(gave('VIP', 'member'));
    await award(vip.id, persona('member').userId);
    await eventually(() => linesWith(gave('VIP', 'member')), count => count === before + 1, 'Tom got VIP');
    assert.equal((await holdersOf(vip.id))[0].roleSynced, true);

    // Lena has Raid-Team already: the badge neither gives nor takes it
    const raid = await createBadge({ name: 'Raid-Badge', roleId: ROLE_ID.RAID_TEAM });
    await award(raid.id, persona('raider').userId);
    await revoke(raid.id, persona('raider').userId);
    await settle();
    assert.equal(linesWith(gave('Raid-Team', 'raider')), 0);
    assert.equal(linesWith(took('Raid-Team', 'raider')), 0);

    const takenBefore = linesWith(took('VIP', 'member'));
    await revoke(vip.id, persona('member').userId);
    await eventually(() => linesWith(took('VIP', 'member')), count => count === takenBefore + 1, 'Tom lost VIP');
    for (const badge of [vip, raid]) await json(await admin.send('DELETE', `${API}/badges/${badge.id}`));
});

test('two badges with the same role: the role stays while one of them is held', async () => {
    const first = await createBadge({ name: 'Eins', roleId: ROLE_ID.EVENT });
    const second = await createBadge({ name: 'Zwei', roleId: ROLE_ID.EVENT });
    const tom = persona('member').userId;
    const gaveBefore = linesWith(gave('Event-Teilnehmer', 'member'));
    const tookBefore = linesWith(took('Event-Teilnehmer', 'member'));
    await award(first.id, tom);
    await award(second.id, tom);
    await eventually(() => linesWith(gave('Event-Teilnehmer', 'member')), count => count === gaveBefore + 1, 'given once');
    await revoke(first.id, tom);
    await settle();
    assert.equal(linesWith(took('Event-Teilnehmer', 'member')), tookBefore, 'the second badge still carries it');
    await revoke(second.id, tom);
    await eventually(() => linesWith(took('Event-Teilnehmer', 'member')), count => count === tookBefore + 1, 'taken with the last badge');
    for (const badge of [first, second]) await json(await admin.send('DELETE', `${API}/badges/${badge.id}`));
});

test('deleting a badge takes back the roles it gave', async () => {
    const badge = await createBadge({ name: 'Weg damit', roleId: ROLE_ID.VIP });
    const tookBefore = linesWith(took('VIP', 'member'));
    await award(badge.id, persona('member').userId);
    await eventually(async () => (await holdersOf(badge.id))[0], holder => holder && holder.roleSynced, 'role given');
    await settle();
    await json(await admin.send('DELETE', `${API}/badges/${badge.id}`));
    await eventually(() => linesWith(took('VIP', 'member')), count => count === tookBefore + 1, 'Tom lost VIP');
});

test('changing the role moves holders from the old role to the new one', async () => {
    const badge = await createBadge({ name: 'Umzug', roleId: ROLE_ID.VIP });
    const tom = persona('member').userId;
    const tookVip = linesWith(took('VIP', 'member'));
    const gaveMember = linesWith(gave('Mitglied', 'member'));
    const gaveRaid = linesWith(gave('Raid-Team', 'member'));
    await award(badge.id, tom);
    await settle();
    await json(await admin.send('PUT', `${API}/badges/${badge.id}`, { ...BADGE, name: 'Umzug', roleId: ROLE_ID.RAID_TEAM }));
    await eventually(() => linesWith(took('VIP', 'member')), count => count === tookVip + 1, 'VIP taken');
    await eventually(() => linesWith(gave('Raid-Team', 'member')), count => count === gaveRaid + 1, 'Raid-Team given');
    assert.equal(linesWith(gave('Mitglied', 'member')), gaveMember);
    await json(await admin.send('DELETE', `${API}/badges/${badge.id}`));
});

test('dmOnAward and announceChannel send one DM and one post per new award, never on a backfill', async () => {
    const settings = (values) => admin.send('PUT', '/api/admin/plugins/badges/settings', { values });
    await json(await settings({ dmOnAward: true, announceChannel: CHANNEL_ID.GENERAL }));
    try {
        const badge = await createBadge({ name: 'Gemeldet' });
        const dmBefore = linesWith('DM an Mori');
        const postBefore = linesWith('Plugin-Nachricht in');
        await award(badge.id, persona('admin').userId);
        await eventually(() => linesWith('DM an Mori'), count => count === dmBefore + 1, 'one DM');
        await eventually(() => linesWith('Plugin-Nachricht in'), count => count === postBefore + 1, 'one post');
        assert.ok(server.output().includes('hat das Badge **Gemeldet** erhalten.'));
        assert.ok(server.output().includes('Du hast das Badge **Gemeldet** erhalten!'));

        await archivedEventWith('badge-silent', 'Silent-T4', ['admin']);
        const ruled = await createBadge({ name: 'Leise', rule: { type: 'participations', count: 1, category: 'Silent-T4' } });
        await eventually(() => holderIds(ruled.id), value => value.length === 1, 'backfilled');
        await settle();
        assert.equal(linesWith('DM an Mori'), dmBefore + 1, 'no DM on a backfill');
        assert.equal(linesWith('Plugin-Nachricht in'), postBefore + 1, 'no post on a backfill');
        for (const entry of [badge, ruled]) await json(await admin.send('DELETE', `${API}/badges/${entry.id}`));
    } finally {
        await json(await settings({ dmOnAward: false, announceChannel: '' }));
    }
});

test('a role that cannot be given shows as unsynced, and retry queues it again', async () => {
    const { db, doc, setDoc } = store();
    await setDoc(doc(db, 'users', FORMER), { id: FORMER, username: 'ehemalig', displayName: 'Ex-Mitglied' });
    const badge = await createBadge({ name: 'Verlassen', roleId: ROLE_ID.VIP });
    await award(badge.id, FORMER);
    await eventually(async () => (await listBadges()).find(entry => entry.id === badge.id).unsynced, value => value === 1, 'unsynced');
    assert.equal((await holdersOf(badge.id))[0].roleSynced, false);
    assert.deepEqual(await json(await admin.send('POST', `${API}/badges/${badge.id}/roles/retry`, {})), { queued: 1 });
    await settle();
    assert.equal((await listBadges()).find(entry => entry.id === badge.id).unsynced, 1, 'still not on the server');
    await json(await admin.send('DELETE', `${API}/badges/${badge.id}`));
});
