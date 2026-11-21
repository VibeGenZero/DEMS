const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Own, empty SQLite database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('plugin-context');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
delete process.env.DEV_MOCK;
process.env.SQLITE_PATH = path.join(tmpDir, 'plugin-context.sqlite');
process.env.BASE_URL = 'https://dems.example.org';

const { db, collection, doc, getDocs, setDoc, deleteDoc } = require('../firebaseAdmin');
const { PluginPermissionError, PluginHttpError } = require('../plugin-sdk/errors');
const { createMessageLimiter } = require('../plugin-sdk/discord');
const hooks = require('../plugin-sdk/hooks');
const state = require('../plugin-sdk/state');
const { createContext } = require('../plugin-sdk/context');

const USED = ['events', 'users', 'registrations', 'auditLogs', 'pluginState', 'pluginSettings'];
const DAY = 24 * 60 * 60 * 1000;

let logs;
let originals;

function entry(permissions = [], extra = {}) {
    return {
        id: 'alpha',
        dir: tmpDir,
        official: false,
        status: null,
        reason: '',
        manifest: {
            id: 'alpha', name: 'Alpha', version: '1.2.3', sdk: 1, description: '', author: '',
            server: 'server.js', client: '', css: '', permissions, settings: [
                { key: 'channel', type: 'channel', label: 'Kanal', help: '', required: false },
                { key: 'token', type: 'secret', label: 'Token', help: '', required: false }
            ],
            ...extra
        }
    };
}

/** ctx for `alpha` plus the arrays it fills. */
function build(permissions = [], { registering = true } = {}) {
    const runtime = {
        limiter: createMessageLimiter(),
        recordCollection: async () => {},
        routes: [],
        disableCallbacks: [],
        isRegistering: () => registering,
        profileProviders: [],
        setProfileProvider: fn => runtime.profileProviders.push(fn)
    };
    return { ctx: createContext({ entry: entry(permissions), host: runtime }), runtime };
}

beforeEach(async () => {
    for (const name of USED) {
        const snapshot = await getDocs(collection(db, name));
        for (const item of snapshot.docs) await deleteDoc(doc(db, name, item.id));
    }
    logs = { log: [], warn: [], error: [] };
    originals = { log: console.log, warn: console.warn, error: console.error };
    for (const kind of Object.keys(logs)) console[kind] = (...args) => logs[kind].push(args.map(String).join(' '));
});

afterEach(() => {
    Object.assign(console, originals);
    hooks.clearHooks('alpha');
});

test('ctx.plugin names the plugin and cannot be changed', () => {
    const { ctx } = build();
    assert.deepEqual({ ...ctx.plugin }, { id: 'alpha', version: '1.2.3', official: false });
    assert.ok(Object.isFrozen(ctx.plugin));
    assert.ok(Object.isFrozen(ctx));
});

test('ctx.log prefixes every line with the plugin id', () => {
    const { ctx } = build();
    ctx.log.info('hallo', 1);
    ctx.log.warn('achtung');
    ctx.log.error('kaputt');
    assert.deepEqual(logs.log, ['[plugin:alpha] hallo 1']);
    assert.deepEqual(logs.warn, ['[plugin:alpha] achtung']);
    assert.deepEqual(logs.error, ['[plugin:alpha] kaputt']);
});

test('a route needs access member or admin', () => {
    const { ctx } = build();
    assert.throws(() => ctx.routes.get('/x', {}, () => {}), { message: 'Route GET /x: access muss member oder admin sein.' });
    assert.throws(() => ctx.routes.post('/x', { access: 'public' }, () => {}), { message: 'Route POST /x: access muss member oder admin sein.' });
    assert.throws(() => ctx.routes.put('/x', undefined, () => {}), { message: 'Route PUT /x: access muss member oder admin sein.' });
});

test('routes are recorded with method, path, access, password and handler; a duplicate is refused', () => {
    const { ctx, runtime } = build();
    const handler = () => ({ ok: true });
    ctx.routes.get('/', { access: 'member' }, handler);
    ctx.routes.post('/', { access: 'member' }, handler);
    ctx.routes.delete('/items/:id', { access: 'admin', password: true }, handler);

    assert.deepEqual(runtime.routes, [
        { method: 'GET', path: '/', access: 'member', password: false, handler },
        { method: 'POST', path: '/', access: 'member', password: false, handler },
        { method: 'DELETE', path: '/items/:id', access: 'admin', password: true, handler }
    ]);
    assert.throws(() => ctx.routes.get('/', { access: 'admin' }, handler), { message: 'Route GET / ist bereits angemeldet.' });
});

test('password route needs admin access and a boolean option', () => {
    const { ctx } = build();
    assert.throws(
        () => ctx.routes.post('/x', { access: 'member', password: true }, () => {}),
        { message: 'Route POST /x: password: true gibt es nur mit access admin.' }
    );
    assert.throws(
        () => ctx.routes.post('/x', { access: 'admin', password: 'ja' }, () => {}),
        /password/
    );
});

test('route paths start with / and have no wildcard; the handler is a function', () => {
    const { ctx, runtime } = build();
    for (const bad of ['x', '', '/files/*', '/{*splat}', '/a b']) {
        assert.throws(() => ctx.routes.get(bad, { access: 'member' }, () => {}), /Pfad/);
    }
    assert.throws(() => ctx.routes.get('/x', { access: 'member' }, 'nope'), { message: 'Route GET /x: Handler muss eine Funktion sein.' });
    assert.equal(runtime.routes.length, 0);
});

test('routes and hooks are refused once register() is over', () => {
    const { ctx } = build(['events:read'], { registering: false });
    assert.throws(() => ctx.routes.get('/x', { access: 'member' }, () => {}), /nur während register/);
    assert.throws(() => ctx.hooks.on('member.deleted', () => {}), /nur während register/);
});

test('event hooks need events:read, member.deleted needs nothing', async () => {
    const { ctx } = build([]);
    assert.throws(() => ctx.hooks.on('event.created', () => {}), PluginPermissionError);
    assert.throws(() => ctx.hooks.on('event.nope', () => {}), { message: 'Unbekannter Hook: event.nope' });

    const seen = [];
    ctx.hooks.on('member.deleted', payload => { seen.push(payload); });
    hooks.emitHook('member.deleted', { userId: '1' });
    await hooks.whenHooksIdle();
    assert.deepEqual(seen, [{ userId: '1' }]);

    const withRead = build(['events:read']).ctx;
    assert.doesNotThrow(() => withRead.hooks.on('event.created', () => {}));
});

test('registration.checkedIn needs registrations:read', () => {
    assert.throws(() => build([]).ctx.hooks.on('registration.checkedIn', () => {}), PluginPermissionError);
    assert.doesNotThrow(() => build(['registrations:read']).ctx.hooks.on('registration.checkedIn', () => {}));
});

test('ctx.registrations needs registrations:read', async () => {
    await assert.rejects(build([]).ctx.registrations.list(), PluginPermissionError);
});

test('ctx.registrations.list returns attendance fields only, filtered and sorted by createdAt', async () => {
    const member = '111111111111111111';
    await setDoc(doc(db, 'registrations', 'r2'), {
        eventId: 'e1', userId: member, status: 'accepted', source: 'web', createdAt: '2026-11-02T10:00:00.000Z',
        checkedIn: true, checkedInAt: '2026-11-03T10:00:00.000Z', slotId: 'tank', formAnswers: { Discord: 'x' },
        guests: ['2'], pendingGuests: [], guestCheckins: {}, offer: null, checkinInvitedAt: '2026-11-03T09:00:00.000Z'
    });
    await setDoc(doc(db, 'registrations', 'r1'), {
        eventId: 'e2', userId: member, status: 'pending', source: 'discord', createdAt: '2026-11-01T10:00:00.000Z'
    });
    await setDoc(doc(db, 'registrations', 'r3'), {
        eventId: 'e1', userId: '222222222222222222', status: 'waitlisted', createdAt: '2026-11-04T10:00:00.000Z'
    });
    const { ctx } = build(['registrations:read']);
    assert.deepEqual(await ctx.registrations.list({ userId: member }), [
        { id: 'r1', eventId: 'e2', userId: member, status: 'pending', source: 'discord',
            createdAt: '2026-11-01T10:00:00.000Z', checkedIn: false, checkedInAt: null, slotId: null },
        { id: 'r2', eventId: 'e1', userId: member, status: 'accepted', source: 'web',
            createdAt: '2026-11-02T10:00:00.000Z', checkedIn: true, checkedInAt: '2026-11-03T10:00:00.000Z', slotId: 'tank' }
    ]);
    assert.deepEqual((await ctx.registrations.list()).map(item => item.id), ['r1', 'r2', 'r3']);
    assert.equal((await ctx.registrations.list()).at(-1).source, null);
    assert.deepEqual((await ctx.registrations.list({ eventId: 'e1' })).map(item => item.id), ['r2', 'r3']);
    assert.deepEqual(await ctx.registrations.list({ eventId: 'e1', userId: 'nobody' }), []);
    assert.deepEqual(await ctx.registrations.list({ eventId: 'a/b' }), []);
    assert.deepEqual(await ctx.registrations.list({ userId: 42 }), []);
});

test('ctx.profile.badges stores one provider during register()', () => {
    const { ctx, runtime } = build([]);
    const provider = () => [];
    assert.throws(() => ctx.profile.badges('nope'), { message: 'Profil-Badges: provider muss eine Funktion sein.' });
    ctx.profile.badges(provider);
    assert.deepEqual(runtime.profileProviders, [provider]);
    assert.throws(() => ctx.profile.badges(() => []), { message: 'Profil-Badges lassen sich nur einmal anmelden.' });
    assert.throws(() => build([], { registering: false }).ctx.profile.badges(provider),
        { message: 'Routen und Hooks lassen sich nur während register() anmelden.' });
});

test('onDisable collects callbacks', () => {
    const { ctx, runtime } = build();
    const fn = () => {};
    ctx.onDisable(fn);
    assert.deepEqual(runtime.disableCallbacks, [fn]);
    assert.throws(() => ctx.onDisable('nope'), /Funktion/);
});

test('ctx.events needs events:read', async () => {
    const { ctx } = build([]);
    await assert.rejects(ctx.events.get('e1'), PluginPermissionError);
    await assert.rejects(ctx.events.list(), PluginPermissionError);
});

test('ctx.events.get returns the plugin shape without secrets, or null', async () => {
    await setDoc(doc(db, 'events', 'e1'), {
        title: 'Raid', startDate: '2026-12-01T20:00:00.000Z', checkinCode: 'SECRET', aiNotes: 'intern', status: 'draft'
    });
    const { ctx } = build(['events:read']);

    const event = await ctx.events.get('e1');
    assert.equal(event.id, 'e1');
    assert.equal(event.title, 'Raid');
    assert.equal(event.status, 'draft');
    assert.equal(event.origin, null);
    assert.ok(!('checkinCode' in event));
    assert.ok(!('aiNotes' in event));
    assert.equal(await ctx.events.get('missing'), null);
    assert.equal(await ctx.events.get('../users/x'), null);
});

test('ctx.events.list returns every event; upcoming keeps future and running ones', async () => {
    const now = Date.now();
    await setDoc(doc(db, 'events', 'past'), { title: 'Alt', startDate: new Date(now - 2 * DAY).toISOString(), checkinCode: 'A' });
    await setDoc(doc(db, 'events', 'running'), {
        title: 'Läuft', startDate: new Date(now - 60000).toISOString(), endDate: new Date(now + DAY).toISOString()
    });
    await setDoc(doc(db, 'events', 'future'), { title: 'Neu', startDate: new Date(now + DAY).toISOString(), status: 'archived' });
    const { ctx } = build(['events:read']);

    const all = await ctx.events.list();
    assert.deepEqual(all.map(event => event.id), ['past', 'running', 'future']);
    assert.ok(all.every(event => !('checkinCode' in event)));
    const upcoming = await ctx.events.list({ upcoming: true });
    assert.deepEqual(upcoming.map(event => event.id), ['running', 'future']);
});

test('ctx.events.url and ctx.siteUrl build DEMS links', () => {
    const { ctx } = build();
    assert.equal(ctx.events.url('e1'), 'https://dems.example.org/#event/e1');
    assert.equal(ctx.siteUrl('p/alpha'), 'https://dems.example.org/#p/alpha');
});

test('ctx.members.get needs members:read and returns id, name, avatar or null', async () => {
    await setDoc(doc(db, 'users', '123456789012345678'), {
        id: '123456789012345678', username: 'raider', displayName: 'Raid Leiterin', avatar: 'https://cdn.example/a.png', acceptInvitations: true
    });
    await setDoc(doc(db, 'users', '223456789012345678'), { id: '223456789012345678', username: 'nur-name' });

    await assert.rejects(build([]).ctx.members.get('123456789012345678'), PluginPermissionError);

    const { ctx } = build(['members:read']);
    assert.deepEqual(await ctx.members.get('123456789012345678'), {
        id: '123456789012345678', name: 'Raid Leiterin', avatar: 'https://cdn.example/a.png'
    });
    assert.deepEqual(await ctx.members.get('223456789012345678'), {
        id: '223456789012345678', name: 'nur-name', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png'
    });
    assert.equal(await ctx.members.get('999'), null);
    assert.equal(await ctx.members.get('a/b'), null);
    assert.equal(await ctx.members.get(42), null);
});

test('ctx.members.search finds stored users by any name, 2–50 characters, at most 20, sorted by name', async () => {
    await setDoc(doc(db, 'users', '111111111111111111'), { username: 'kira', displayName: 'Kira K.', avatar: null });
    await setDoc(doc(db, 'users', '222222222222222222'), { username: 'ben', globalName: 'Benjamin', acceptInvitations: false });
    await setDoc(doc(db, 'users', '333333333333333333'), { username: 'anna', displayName: 'Anna' });
    await setDoc(doc(db, 'users', '000000000000000005'), { username: 'zora', displayName: 'Zora Anders' });
    for (let i = 0; i < 25; i++) await setDoc(doc(db, 'users', `4000000000000000${10 + i}`), { username: `zz${String(i).padStart(2, '0')}` });
    const { ctx } = build(['members:read']);

    const kira = await ctx.members.search('KIR');
    assert.deepEqual(kira.map(member => member.id), ['111111111111111111']);
    assert.deepEqual(Object.keys(kira[0]).sort(), ['avatar', 'id', 'name']);
    assert.equal(kira[0].name, 'Kira K.');
    // The name follows ctx.members.get: display name, then user name, then global name
    assert.deepEqual((await ctx.members.search('jamin')).map(member => member.name), ['ben']);
    assert.deepEqual((await ctx.members.search('an')).map(member => member.name), ['Anna', 'Zora Anders']);
    const many = await ctx.members.search('zz');
    assert.equal(many.length, 20);
    assert.equal(many[0].name, 'zz00');
    assert.deepEqual(await ctx.members.search(' k '), []);
    assert.deepEqual(await ctx.members.search('x'.repeat(51)), []);
    assert.deepEqual(await ctx.members.search(42), []);
    await assert.rejects(build([]).ctx.members.search('kira'), PluginPermissionError);
});

test('ctx.settings.get returns the stored values of the manifest keys, secrets included', async () => {
    await state.writeSettings('alpha', { channel: '111111111111111111', token: 'geheim', removed: 'x' });
    const { ctx } = build();
    assert.deepEqual(await ctx.settings.get(), { channel: '111111111111111111', token: 'geheim' });
});

test('ctx.audit stores the action as plugin:<id>:<action>', async () => {
    const { ctx } = build();
    await ctx.audit('approved', 'admin-1', 'Vorschlag übernommen', 'sub-1');
    const snapshot = await getDocs(collection(db, 'auditLogs'));
    const [log] = snapshot.docs.map(item => item.data());
    assert.equal(log.action, 'plugin:alpha:approved');
    assert.equal(log.adminId, 'admin-1');
    assert.equal(log.details, 'Vorschlag übernommen');
    assert.equal(log.targetId, 'sub-1');
    await assert.rejects(ctx.audit('', 'admin-1', 'x'), /Aktion/);
});

test('ctx.httpError builds a PluginHttpError', () => {
    const { ctx } = build();
    const err = ctx.httpError(418, 'Ich bin eine Teekanne.');
    assert.ok(err instanceof PluginHttpError);
    assert.equal(err.status, 418);
    assert.equal(err.message, 'Ich bin eine Teekanne.');
});

test('ctx.discord checks its permission and ctx.data records collections', async () => {
    const recorded = [];
    const runtime = {
        limiter: createMessageLimiter(), recordCollection: async coll => { recorded.push(coll); },
        routes: [], disableCallbacks: [], isRegistering: () => true
    };
    const ctx = createContext({ entry: entry([]), host: runtime });
    await assert.rejects(ctx.discord.sendDM('123456789012345678', { text: 'Hi' }), PluginPermissionError);
    await ctx.data.add('items', { title: 'x' });
    assert.deepEqual(recorded, ['items']);
    const snapshot = await getDocs(collection(db, 'plugin:alpha:items'));
    for (const item of snapshot.docs) await deleteDoc(item.ref);
});
