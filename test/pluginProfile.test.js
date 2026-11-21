// Plugin badges on the profile (SDK 1.1): validation of a provider's answer and the
// time limit per provider (plugin-sdk/profile.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePluginBadges, collectPluginBadges } = require('../plugin-sdk/profile');

const badge = (extra) => ({ id: 'b', name: 'Badge', icon: 'bi-star', unlocked: true, ...extra });

test('valid badges are copied with a prefixed id and only the known fields', () => {
    const { badges, dropped } = validatePluginBadges('alpha', [
        badge({ id: 'vet', name: 'Veteran', description: 'Zehn Raids', icon: 'bi-trophy', color: '#22C55E', extra: 1 }),
        badge({ id: 'open', name: ' Offen ', unlocked: false, progress: 0.5 })
    ]);
    assert.deepEqual(badges, [
        { id: 'p:alpha:vet', name: 'Veteran', description: 'Zehn Raids', icon: 'bi-trophy', color: '#22C55E', unlocked: true },
        { id: 'p:alpha:open', name: 'Offen', description: '', icon: 'bi-star', unlocked: false, progress: 0.5 }
    ]);
    assert.equal(dropped, 0);
});

test('an invalid entry is dropped alone', () => {
    const invalid = [
        badge({ id: 'bad id' }), badge({ id: 'x'.repeat(41) }), badge({ id: 7 }),
        badge({ name: '' }), badge({ name: '   ' }), badge({ name: 'x'.repeat(41) }),
        badge({ description: 'x'.repeat(201) }), badge({ description: 5 }),
        badge({ icon: 'bi-x" onclick="alert(1)' }), badge({ icon: 'fa-star' }), badge({ icon: undefined }),
        badge({ color: 'red' }), badge({ color: '#12345' }),
        badge({ unlocked: 'yes' }), badge({ unlocked: undefined }),
        badge({ progress: 2 }), badge({ progress: -0.1 }), badge({ progress: Number.NaN }), badge({ progress: '0.5' }),
        null, 'badge', ['b']
    ];
    const { badges, dropped } = validatePluginBadges('alpha', [...invalid, badge({ id: 'ok' })]);
    assert.deepEqual(badges.map(entry => entry.id), ['p:alpha:ok']);
    assert.equal(dropped, invalid.length);
});

test('at most 50 badges per plugin; an answer that is no list counts as one dropped entry', () => {
    const many = Array.from({ length: 60 }, (_, i) => badge({ id: `b${i}` }));
    assert.equal(validatePluginBadges('alpha', many).badges.length, 50);
    assert.deepEqual(validatePluginBadges('alpha', { id: 'b' }), { badges: [], dropped: 1 });
    assert.deepEqual(validatePluginBadges('alpha', undefined), { badges: [], dropped: 1 });
});

test('providers run in parallel; a throwing or hanging one is skipped and reported, the others still count', async () => {
    const errors = [];
    const started = Date.now();
    const badges = await collectPluginBadges({
        userId: 'u1',
        timeoutMs: 50,
        onError: (id, message) => errors.push([id, message]),
        providers: [
            { id: 'good', provider: ({ userId }) => [badge({ id: 'a', name: `Für ${userId}` })] },
            { id: 'boom', provider: () => { throw new Error('kaputt'); } },
            { id: 'slow', provider: () => new Promise(() => {}) },
            { id: 'late', provider: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return [badge({ id: 'z' })]; } },
            { id: 'weird', provider: () => 'kein Array' }
        ]
    });
    assert.deepEqual(badges.map(entry => entry.id), ['p:good:a', 'p:late:z']);
    assert.equal(badges[0].name, 'Für u1');
    assert.ok(Date.now() - started < 1000, 'the slow provider does not hold the profile');
    // Reported in the order they happen (the timeout last), compared sorted
    assert.deepEqual(errors.sort(), [
        ['boom', 'kaputt'],
        ['slow', 'Profil-Badges haben nicht innerhalb von 0,05 s geantwortet.'],
        ['weird', 'Profil-Badges müssen eine Liste sein.']
    ]);
});

test('the default limit is 2 s and no providers give no badges', async () => {
    const errors = [];
    const started = Date.now();
    const badges = await collectPluginBadges({
        userId: 'u1', onError: (id, message) => errors.push(message), providers: [{ id: 'slow', provider: () => new Promise(() => {}) }]
    });
    assert.deepEqual(badges, []);
    assert.ok(Date.now() - started >= 1900);
    assert.deepEqual(errors, ['Profil-Badges haben nicht innerhalb von 2 s geantwortet.']);
    assert.deepEqual(await collectPluginBadges({ userId: 'u1', providers: [] }), []);
});
