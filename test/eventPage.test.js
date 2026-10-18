const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, REPO_ROOT } = require('./helpers');

// D-05: the event page shows the facts first and keeps one register button.

const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const SECTION = INDEX_HTML.slice(INDEX_HTML.indexOf('<section id="event-detail-section"'), INDEX_HTML.indexOf('<!-- ── PROFILE SECTION ── -->'));
const at = (id) => SECTION.indexOf(`id="${id}"`);
// setImmediate runs after the microtask queue is drained, so the fire-and-forget fetch chains have settled
const settle = () => new Promise(resolve => setImmediate(resolve));
const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };

/** Routes of one event page; `registration` answers my-registration. */
const eventRoutes = (fields, registration = { registered: false }) => ({
    '/api/events/ev': { id: 'ev', title: 'Feierabend-Runde', accessMode: 'open', maxParticipants: 0, currentParticipants: 0, formFields: [], startDate: new Date(Date.now() + 86_400_000).toISOString(), ...fields },
    '/api/events/ev/my-registration': registration,
    '/api/events/ev/participants': { participants: [], total: 0 },
    '/api/events/ev/comments': []
});

test('the event page areas come in phone order', () => {
    const order = ['detail-head', 'detail-side', 'detail-status', 'detail-main'].map(at);
    assert.ok(order.every(position => position !== -1), `missing area: ${order}`);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.doesNotMatch(SECTION, /col-lg-[48]/);
});

test('status cards sit in the status area and the content in main', () => {
    for (const id of ['detail-registered', 'detail-no-access', 'detail-ended']) {
        assert.ok(at(id) > at('detail-status') && at(id) < at('detail-main'), id);
    }
    for (const id of ['detail-description', 'detail-participants-section', 'detail-series-section', 'detail-register-area', 'detail-waitlist']) {
        assert.ok(at(id) > at('detail-main'), id);
    }
    for (const id of ['detail-title', 'detail-countdown-area']) {
        assert.ok(at(id) > at('detail-head') && at(id) < at('detail-side'), id);
    }
});

test('comments and check-in attach to their areas', async () => {
    const { app, state, element } = await loadFrontendApp(eventRoutes({}, { registered: true, status: 'accepted' }));
    state.currentUser = MEMBER;
    const appended = [];
    for (const area of ['detail-main', 'detail-status']) {
        const fake = element(area);
        const original = fake.appendChild;
        fake.appendChild = (child) => { appended.push(`${area} < ${child.id}`); return original(child); };
    }
    await app.showEventDetail('ev');
    await settle();
    assert.ok(appended.includes('detail-main < comments-section'), appended.join(', '));
    assert.ok(appended.includes('detail-status < checkin-section'), appended.join(', '));
});
