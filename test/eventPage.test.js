const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, isHidden, REPO_ROOT } = require('./helpers');

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

test('the register buttons submit their form from the action area', () => {
    const areaStart = at('sidebar-action-area');
    const areaEnd = at('detail-status');
    for (const [id, form] of [['register-btn', 'registration-form'], ['waitlist-btn', 'waitlist-form']]) {
        const tag = SECTION.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] || '';
        assert.ok(at(id) > areaStart && at(id) < areaEnd, `${id} is not in the action area`);
        assert.match(tag, new RegExp(`form="${form}"`), id);
        assert.match(tag, /type="submit"/, id);
    }
    for (const form of ['registration-form', 'waitlist-form']) {
        const start = SECTION.indexOf(`<form id="${form}">`);
        const body = SECTION.slice(start, SECTION.indexOf('</form>', start));
        assert.ok(start !== -1, form);
        assert.doesNotMatch(body, /type="submit"/, form);
    }
});

test('each state shows exactly one action and the bar only for register and waitlist', async () => {
    const { app, element } = await loadFrontendApp({});
    const event = { id: 'ev', formFields: [] };
    const actions = ['register-btn', 'waitlist-btn', 'sidebar-status-btn'];
    const expected = { register: ['register-btn'], registered: ['sidebar-status-btn'], waitlist: ['waitlist-btn'], noaccess: ['sidebar-status-btn'], none: [] };
    for (const mode of ['register', 'registered', 'waitlist', 'noaccess', 'none', 'register']) {
        app.renderSidebarAction(mode, event);
        assert.deepEqual(actions.filter(id => !isHidden(element(id))), expected[mode], mode);
        assert.equal(element('event-detail-section').classList.contains('has-action-bar'), mode === 'register' || mode === 'waitlist', mode);
    }
    app.renderSidebarAction('registered', event);
    assert.match(element('sidebar-status-btn').innerHTML, /Angemeldet/);
    app.renderSidebarAction('noaccess', event);
    assert.match(element('sidebar-status-btn').innerHTML, /Kein Zugang/);
});

test('the form card only shows when there is something to enter', async () => {
    const plain = await loadFrontendApp(eventRoutes({ allowGuests: false }));
    plain.state.currentUser = MEMBER;
    await plain.app.showEventDetail('ev');
    await settle();
    assert.ok(isHidden(plain.element('detail-register-area')), 'empty card shown');
    assert.equal(isHidden(plain.element('register-btn')), false);

    const guests = await loadFrontendApp(eventRoutes({ allowGuests: true }));
    guests.state.currentUser = MEMBER;
    await guests.app.showEventDetail('ev');
    await settle();
    assert.equal(isHidden(guests.element('detail-register-area')), false);
});

test('a missing required field scrolls into view', async () => {
    const formFields = [{ label: 'Spielername', type: 'text', required: true }];
    const { app, state, element, toasts } = await loadFrontendApp(eventRoutes({ formFields }));
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();
    await app.submitRegistration('ev', { id: 'ev', formFields }, 'register-btn', 'dynamic-form-fields');
    assert.match(toasts.at(-1), /Spielername/);
    assert.deepEqual(element('form-field-0').calls.map(([name]) => name), ['scrollIntoView', 'focus']);
});

test('opening another event clears the action of the previous one', async () => {
    const { app, element } = await loadFrontendApp({});
    app.renderSidebarAction('register');
    app.resetEventDetailAreas();
    assert.deepEqual(['register-btn', 'waitlist-btn', 'sidebar-status-btn'].filter(id => !isHidden(element(id))), []);
    assert.equal(element('event-detail-section').classList.contains('has-action-bar'), false);
});
