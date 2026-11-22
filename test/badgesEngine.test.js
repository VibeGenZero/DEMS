// Role bookkeeping of the badges engine (plugins/badges/engine.js) with a fake ctx:
// whatever order awards, revokes, deletes, role changes and retries arrive in, a member
// ends up with a badge's role exactly while an active badge carries it — and loses only
// roles the plugin gave.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../plugins/badges/engine');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** In-memory ctx: plugin data, a Discord with member roles (optionally slow or offline) and no-op rest. */
function fakeCtx({ slowRoleMs = 0, memberRoles = {} } = {}) {
    const collections = new Map();
    const coll = (name) => {
        if (!collections.has(name)) collections.set(name, new Map());
        return collections.get(name);
    };
    const roles = new Map(Object.entries(memberRoles).map(([userId, list]) => [userId, new Set(list)]));
    const discordState = { offline: false };
    let next = 0;
    const plain = (id, value) => ({ id, ...structuredClone(value) });
    const ctx = {
        log: { info() {}, warn() {}, error() {} },
        data: {
            list: async (name) => [...coll(name)].map(([id, value]) => plain(id, value)),
            where: async (name, field, _op, value) => [...coll(name)].filter(([, doc]) => doc[field] === value).map(([id, doc]) => plain(id, doc)),
            get: async (name, id) => (coll(name).has(id) ? plain(id, coll(name).get(id)) : null),
            set: async (name, id, value) => { coll(name).set(id, structuredClone(value)); return plain(id, value); },
            add: async (name, value) => { const id = `b${++next}`; coll(name).set(id, structuredClone(value)); return plain(id, value); },
            update: async (name, id, patch) => {
                if (!coll(name).has(id)) throw new Error(`Dokument nicht gefunden: ${id}`);
                Object.assign(coll(name).get(id), structuredClone(patch));
                return plain(id, coll(name).get(id));
            },
            delete: async (name, id) => { coll(name).delete(id); }
        },
        discord: {
            async addRole(userId, roleId) {
                await sleep(slowRoleMs);
                if (discordState.offline) return { ok: false, reason: 'Der Bot ist nicht verbunden.' };
                const own = roles.get(userId) || new Set();
                roles.set(userId, own);
                const changed = !own.has(roleId);
                own.add(roleId);
                return { ok: true, changed };
            },
            async removeRole(userId, roleId) {
                await sleep(slowRoleMs);
                if (discordState.offline) return { ok: false, reason: 'Der Bot ist nicht verbunden.' };
                const own = roles.get(userId) || new Set();
                const changed = own.has(roleId);
                own.delete(roleId);
                return { ok: true, changed };
            },
            sendDM: async () => true,
            sendChannelMessage: async () => true
        },
        settings: { get: async () => ({}) },
        members: { get: async (id) => ({ id, name: id, avatar: '' }) },
        registrations: { list: async () => [] },
        events: { list: async () => [] },
        audit: async () => {},
        siteUrl: (hash) => hash
    };
    const has = (userId, roleId) => Boolean(roles.get(userId) && roles.get(userId).has(roleId));
    return { ctx, has, discordState };
}

async function setup(options) {
    const fake = fakeCtx(options);
    const engine = createEngine(fake.ctx);
    const badge = (name, roleId) => fake.ctx.data.add('badges', { name, roleId, rule: { type: 'manual' }, createdAt: `${name}` });
    // Writes and effects both drained
    const drain = async () => {
        await engine.serial(() => {});
        await sleep(20 + (options && options.slowRoleMs ? options.slowRoleMs * 30 : 0));
        await engine.serial(() => {});
    };
    return { ...fake, engine, badge, drain };
}

test('a retry clicked twice still lets a later revoke take the role', async () => {
    const { engine, badge, has, drain, discordState } = await setup();
    const b = await badge('B', 'R');
    discordState.offline = true;
    await engine.serial(() => engine.award({ badge: b, userId: 'u1', by: 'admin' }));
    await drain();
    assert.equal(has('u1', 'R'), false, 'not given while offline');
    discordState.offline = false;
    await engine.serial(() => engine.retryRoles(b));
    await engine.serial(() => engine.retryRoles(b));
    await drain();
    assert.equal(has('u1', 'R'), true);
    await engine.serial(() => engine.revoke({ badge: b, userId: 'u1', by: 'admin' }));
    await drain();
    assert.equal(has('u1', 'R'), false);
});

test('deleting a badge while its gives are still queued leaves the role on nobody', async () => {
    const { engine, badge, has, drain } = await setup({ slowRoleMs: 5 });
    const b = await badge('B', 'R');
    await engine.serial(async () => {
        for (let i = 0; i < 10; i++) await engine.award({ badge: b, userId: `u${i}`, by: 'rule' });
    });
    await sleep(12);
    await engine.serial(() => engine.removeBadge(b));
    await drain();
    for (let i = 0; i < 10; i++) assert.equal(has(`u${i}`, 'R'), false, `u${i}`);
});

test('changing the role while gives are queued moves everyone to the new role only', async () => {
    const { ctx, engine, badge, has, drain } = await setup({ slowRoleMs: 5 });
    const b = await badge('B', 'OLD');
    await engine.serial(async () => {
        for (let i = 0; i < 5; i++) await engine.award({ badge: b, userId: `u${i}`, by: 'rule' });
    });
    await sleep(8);
    const moved = await ctx.data.update('badges', b.id, { roleId: 'NEW' });
    engine.moveRole(moved, 'OLD');
    await drain();
    for (let i = 0; i < 5; i++) {
        assert.equal(has(`u${i}`, 'OLD'), false, `u${i} lost OLD`);
        assert.equal(has(`u${i}`, 'NEW'), true, `u${i} got NEW`);
    }
});

test('revoking and awarding again in quick succession keeps the role, and a later revoke takes it', async () => {
    const { engine, badge, has, drain } = await setup({ slowRoleMs: 5 });
    const b = await badge('B', 'R');
    await engine.serial(() => engine.award({ badge: b, userId: 'u', by: 'admin' }));
    await drain();
    await engine.serial(() => engine.revoke({ badge: b, userId: 'u', by: 'admin' }));
    await engine.serial(() => engine.award({ badge: b, userId: 'u', by: 'admin' }));
    await drain();
    assert.equal(has('u', 'R'), true);
    await engine.serial(() => engine.revoke({ badge: b, userId: 'u', by: 'admin' }));
    await drain();
    assert.equal(has('u', 'R'), false);
});

test('two badges with one role: the role goes with the last of them, also when the second was awarded late', async () => {
    const { engine, badge, has, drain } = await setup({ slowRoleMs: 5 });
    const first = await badge('A', 'R');
    const second = await badge('B', 'R');
    await engine.serial(() => engine.award({ badge: first, userId: 'u', by: 'admin' }));
    await drain();
    await engine.serial(() => engine.revoke({ badge: first, userId: 'u', by: 'admin' }));
    await engine.serial(() => engine.award({ badge: second, userId: 'u', by: 'admin' }));
    await drain();
    assert.equal(has('u', 'R'), true);
    await engine.serial(() => engine.revoke({ badge: second, userId: 'u', by: 'admin' }));
    await drain();
    assert.equal(has('u', 'R'), false);
});

test('a role the member had before is never taken', async () => {
    const { engine, badge, has, drain } = await setup({ memberRoles: { u: ['R'] } });
    const b = await badge('B', 'R');
    await engine.serial(() => engine.award({ badge: b, userId: 'u', by: 'admin' }));
    await drain();
    await engine.serial(() => engine.revoke({ badge: b, userId: 'u', by: 'admin' }));
    await drain();
    assert.equal(has('u', 'R'), true);
});

test('a removal that fails is kept as pending and done by the next retry', async () => {
    const { engine, badge, has, drain, discordState } = await setup();
    const b = await badge('B', 'R');
    await engine.serial(() => engine.award({ badge: b, userId: 'u', by: 'admin' }));
    await drain();
    discordState.offline = true;
    await engine.serial(() => engine.removeBadge(b));
    await drain();
    assert.equal(has('u', 'R'), true, 'still there while offline');
    assert.equal(await engine.pendingRemovals(), 1);
    discordState.offline = false;
    assert.equal(await engine.serial(() => engine.retryPending()), 1);
    await drain();
    assert.equal(has('u', 'R'), false);
    assert.equal(await engine.pendingRemovals(), 0);
});

test('a holder whose role could not be given counts as unsynced until a retry gives it', async () => {
    const { engine, badge, drain, discordState } = await setup();
    const b = await badge('B', 'R');
    discordState.offline = true;
    await engine.serial(() => engine.award({ badge: b, userId: 'u', by: 'admin' }));
    await drain();
    assert.deepEqual(await engine.unsyncedOf(b), ['u']);
    discordState.offline = false;
    assert.equal(await engine.serial(() => engine.retryRoles(b)), 1);
    await drain();
    assert.deepEqual(await engine.unsyncedOf(b), []);
});
