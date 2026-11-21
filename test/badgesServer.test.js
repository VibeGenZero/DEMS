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

