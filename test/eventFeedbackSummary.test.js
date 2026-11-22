// GET /summary of „Event-Feedback“ with a fake ctx at a realistic size: it must not block the
// process for long, and it must count eligible members per event correctly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { register } = require('../plugins/event-feedback/server');

const DAY = 86_400_000;

function fakeCtx({ events, registrations, answers, requests }) {
    const routes = new Map();
    const route = method => (path, _options, handler) => routes.set(`${method} ${path}`, handler);
    const collections = { answers, requests };
    const ctx = {
        routes: { get: route('GET'), put: route('PUT'), post: route('POST'), delete: route('DELETE') },
        hooks: { on() {} },
        events: { list: async () => events, get: async id => events.find(event => event.id === id) || null },
        registrations: {
            list: async ({ eventId, userId } = {}) => registrations.filter(entry => (!eventId || entry.eventId === eventId) && (!userId || entry.userId === userId))
        },
        data: {
            list: async name => collections[name],
            where: async (name, field, _op, value) => collections[name].filter(doc => doc[field] === value),
            get: async (name, id) => collections[name].find(doc => doc.id === id) || null
        },
        settings: { get: async () => ({}) },
        discord: { sendDM: async () => true },
        siteUrl: hash => hash,
        httpError: (status, message) => Object.assign(new Error(message), { status }),
        log: { error() {} }
    };
    register(ctx);
    return routes;
}

test('the summary of 5000 events and 60000 registrations answers quickly and counts per event', async () => {
    const now = Date.now();
    const events = Array.from({ length: 5000 }, (_, i) => ({
        id: `e${i}`, title: `Abend ${i}`, status: 'archived', category: i % 2 ? 'Raid' : 'Quiz', checkinEnabled: false,
        startDate: new Date(now - (i + 1) * DAY).toISOString(), endDate: new Date(now - (i + 1) * DAY + 3600_000).toISOString()
    }));
    const registrations = Array.from({ length: 60000 }, (_, i) => ({
        id: `r${i}`, eventId: `e${i % 5000}`, userId: `u${i}`, status: i % 3 === 0 ? 'waitlisted' : 'accepted', checkedIn: false
    }));
    const requests = events.map(event => ({ id: event.id, eventId: event.id }));
    const answers = [{ id: 'a1', eventId: 'e0', userId: 'u0', rating: 4, comment: '' }];
    const routes = fakeCtx({ events, registrations, answers, requests });

    const started = process.hrtime.bigint();
    const summary = await routes.get('GET /summary')({ user: { id: 'admin' }, params: {}, query: {}, body: {} });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;

    assert.equal(summary.events.length, 100);
    assert.equal(summary.events[0].event.id, 'e0', 'newest first');
    // e0 has registrations r0, r5000, …, r55000: 12, of which r0, r15000, r30000, r45000 are waitlisted
    assert.equal(summary.events[0].eligible, 8);
    assert.ok(ms < 300, `took ${ms.toFixed(0)} ms`);
});
