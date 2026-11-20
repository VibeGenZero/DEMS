// Per-member serialisation of `POST /` in plugins/event-submissions/server.js,
// against a fake ctx whose storage is truly asynchronous (like PostgreSQL).
// The dev-server test cannot catch a missing queue: SQLite answers synchronously
// behind its promises, so count-then-add never interleaves there.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PluginHttpError } = require('../plugin-sdk/errors');
const { register } = require('../plugins/event-submissions/server');

const LIMIT_SENTENCE = 'Du hast schon 3 offene Vorschläge. Warte, bis das Team sie bearbeitet hat.';
const STORAGE_DELAY_MS = 5;
const BLOCKED_AFTER_MS = 1000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const member = (id) => ({ id, name: `Mitglied ${id}`, avatar: '', isAdmin: false, roles: [] });

/**
 * A ctx with the parts `register` touches. `data.where` and `data.add` wait
 * before they read or write, so parallel requests interleave unless the plugin
 * serialises them. `hold(userId)` makes that member's reads wait until released.
 */
function createFakeCtx() {
    const routes = new Map();
    const collections = new Map();
    const holds = new Map();
    let nextId = 1;

    const route = (method) => (path, options, handler) => routes.set(`${method} ${path}`, { options, handler });
    const docsOf = (collection) => {
        if (!collections.has(collection)) collections.set(collection, []);
        return collections.get(collection);
    };

    const ctx = {
        routes: { get: route('GET'), post: route('POST'), put: route('PUT'), delete: route('DELETE') },
        hooks: { on: () => {} },
        settings: { get: async () => ({ notifyChannel: '' }) },
        discord: { sendDM: async () => {}, sendChannelMessage: async () => {} },
        events: { url: (id) => `https://dems.test/#event/${id}` },
        siteUrl: (path) => `https://dems.test/${path}`,
        audit: async () => {},
        log: { info: () => {}, warn: () => {}, error: () => {} },
        httpError: (status, message) => new PluginHttpError(status, message),
        data: {
            async where(collection, field, op, value) {
                await sleep(STORAGE_DELAY_MS);
                if (field === 'userId' && holds.has(value)) await holds.get(value);
                assert.equal(op, '==');
                return docsOf(collection).filter(doc => doc[field] === value).map(doc => ({ ...doc }));
            },
            async add(collection, value) {
                await sleep(STORAGE_DELAY_MS);
                const doc = { id: `submission-${nextId++}`, ...value };
                docsOf(collection).push(doc);
                return { ...doc };
            },
            get: async () => null,
            list: async () => [],
            update: async () => null,
            delete: async () => {}
        }
    };

    register(ctx);
    const post = routes.get('POST /');
    assert.ok(post, 'register adds POST /');
    assert.equal(post.options.access, 'member');

    return {
        submit: (user, title) => post.handler({ user, params: {}, query: {}, body: { title } }),
        stored: (userId) => docsOf('submissions').filter(doc => doc.userId === userId),
        hold(userId) {
            let release;
            holds.set(userId, new Promise(resolve => { release = resolve; }));
            return () => {
                holds.delete(userId);
                release();
            };
        }
    };
}

test('five parallel submits of one member let exactly three through', async () => {
    const fake = createFakeCtx();
    const lena = member('user-lena');

    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(n => fake.submit(lena, `Doppelklick ${n}`)));

    const accepted = results.filter(result => result.status === 'fulfilled');
    const refused = results.filter(result => result.status === 'rejected');
    assert.equal(accepted.length, 3, `accepted: ${accepted.length}, refused: ${refused.length}`);
    assert.equal(refused.length, 2);
    for (const { reason } of refused) {
        assert.ok(reason instanceof PluginHttpError, String(reason));
        assert.equal(reason.status, 409);
        assert.equal(reason.message, LIMIT_SENTENCE);
    }
    assert.equal(fake.stored(lena.id).length, 3);
    assert.ok(fake.stored(lena.id).every(doc => doc.status === 'open'));
});

test('a second member is not blocked by the first member\'s chain', async () => {
    const fake = createFakeCtx();
    const lena = member('user-lena');
    const tom = member('user-tom');

    const release = fake.hold(lena.id);
    let lenaDone = false;
    const lenaSubmits = Promise.allSettled([1, 2].map(n => fake.submit(lena, `Wartet ${n}`)))
        .finally(() => { lenaDone = true; });

    try {
        let timer;
        const blocked = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Tom waited for Lena\'s chain')), BLOCKED_AFTER_MS);
        });
        const created = await Promise.race([fake.submit(tom, 'Eigene Idee'), blocked]).finally(() => clearTimeout(timer));
        assert.equal(created.userId, tom.id);
        assert.equal(created.status, 'open');
        assert.equal(lenaDone, false, 'Lena\'s submits are still held');
    } finally {
        release();
    }

    const lenaResults = await lenaSubmits;
    assert.ok(lenaResults.every(result => result.status === 'fulfilled'), JSON.stringify(lenaResults));
    assert.equal(fake.stored(lena.id).length, 2);
    assert.equal(fake.stored(tom.id).length, 1);
});
