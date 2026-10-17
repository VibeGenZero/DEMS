const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

// W-01: ended events are no longer LIVE in the bot control center, their
// page tells visitors that they are over, and the audit log names the system.

// setImmediate runs after the microtask queue is drained, so every
// fire-and-forget fetch chain inside the modules has settled by then.
const settle = () => new Promise(resolve => setImmediate(resolve));

const HOUR = 60 * 60 * 1000;
const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };
const at = (offset) => new Date(Date.now() + offset).toISOString();

test('the bot control center calls only a running event LIVE', async () => {
    const running = { id: 'run', title: 'Läuft', startDate: at(-0.5 * HOUR), endDate: at(2 * HOUR), maxParticipants: 0, registrationStats: { accepted: 1 } };
    const upcoming = { id: 'next', title: 'Kommt', startDate: at(24 * HOUR), maxParticipants: 0, registrationStats: { accepted: 0 } };
    const over = { id: 'over', title: 'Vorbei', startDate: at(-5 * HOUR), endDate: at(-2 * HOUR), maxParticipants: 0, registrationStats: { accepted: 0 } };
    const { app, element } = await loadFrontendApp({ '/api/admin/bot/running-events': [running, upcoming, over] });
    await app.loadBotRunningEvents();
    const html = element('bot-running-events').innerHTML;
    assert.equal((html.match(/live-indicator/g) || []).length, 1);
    assert.equal((html.match(/upcoming-indicator/g) || []).length, 2);
    assert.equal((html.match(/Beendet/g) || []).length, 1);
});

/** Routes of one event page; `registration` answers my-registration. */
const eventRoutes = (fields, registration) => ({
    '/api/events/ev': { id: 'ev', title: 'Feierabend-Runde', accessMode: 'open', maxParticipants: 0, currentParticipants: 0, formFields: [], ...fields },
    '/api/events/ev/my-registration': registration,
    '/api/events/ev/participants': { participants: [], total: 0 },
    '/api/events/ev/comments': []
});
const ENDED = { startDate: at(-6 * HOUR), endDate: at(-3 * HOUR) };

test('an ended event page tells a visitor that it is over', async () => {
    const { app, state, element } = await loadFrontendApp(eventRoutes(ENDED, { registered: false }));
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();
    assert.equal(isHidden(element('detail-ended')), false);
    assert.ok(isHidden(element('detail-register-area')));
    assert.ok(isHidden(element('detail-countdown-area')));
});

test('a registered member still sees the status of an ended event', async () => {
    const { app, state, element } = await loadFrontendApp(eventRoutes(ENDED, { registered: true, status: 'accepted' }));
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();
    assert.equal(isHidden(element('detail-registered')), false);
    assert.ok(isHidden(element('detail-ended')));
});

test('a running event still offers the registration', async () => {
    const { app, state, element } = await loadFrontendApp(eventRoutes({ startDate: at(-HOUR), endDate: at(HOUR) }, { registered: false }));
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();
    assert.equal(isHidden(element('detail-register-area')), false);
    assert.ok(isHidden(element('detail-ended')));
});

test('the audit log names the system', async () => {
    const { app, element } = await loadFrontendApp({
        '/api/admin/audit-log?limit=100': { data: [{ action: 'AUTO_ARCHIVE_EVENT', adminId: 'system', details: 'x', timestamp: new Date().toISOString() }], meta: { totalPages: 1 } }
    });
    // The element double has no scrollIntoView; the log scrolls itself into view at the end
    element('audit-log-container').scrollIntoView = () => {};
    await app.loadAuditLog();
    const html = element('audit-log-entries').innerHTML;
    assert.ok(html.includes('>System<'), html);
    assert.ok(!html.includes('system…'));
});
