const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');
const { actionTargets, actionElement, assertNoInlineHandlers } = require('./htmlSource');

const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };
const TRICKY_ID = 'reg"<x>';
const registration = (id, fields = {}) => ({
    id, userId: `u-${id}`, userName: id, status: 'accepted', source: 'web', createdAt: '2026-10-01T18:00:00.000Z', ...fields
});
const REGISTRATIONS = [
    registration('anna'),
    registration('ben', { checkedIn: true, checkedInAt: '2026-10-01T19:00:00.000Z' }),
    registration('cleo', { status: 'pending' }),
    registration(TRICKY_ID)
];

async function openDialog(routes = {}) {
    const harness = await loadFrontendApp({
        '/api/admin/events/ev1/registrations': { data: REGISTRATIONS, slots: [] },
        ...routes
    });
    harness.state.currentUser = ADMIN;
    harness.state.csrfToken = 'csrf-1';
    await harness.app.showRegistrations('ev1', 'Raid');
    return { ...harness, body: () => harness.element('registrations-tbody').innerHTML };
}

const rowOf = (html, name) => {
    const row = html.split('<tr').find(candidate => candidate.includes(`<strong>${name}</strong>`));
    assert.ok(row, `no row for ${name}`);
    return row;
};

test('accepted registrations get a check-in toggle, open requests none', async () => {
    const { body } = await openDialog();
    const html = body();
    assertNoInlineHandlers(html);

    const open = rowOf(html, 'anna');
    assert.match(open, /data-click="toggleRegCheckin"[^>]*data-checked-in="false"/);
    assert.match(open, /aria-pressed="false"[^>]*>\s*<i class="bi bi-square[^"]*"[^>]*><\/i>\s*Abhaken/);

    const done = rowOf(html, 'ben');
    assert.match(done, /data-click="toggleRegCheckin"[^>]*data-checked-in="true"/);
    assert.match(done, /aria-pressed="true"[^>]*>\s*<i class="bi bi-check2-square[^"]*"[^>]*><\/i>\s*Eingecheckt/);

    assert.doesNotMatch(rowOf(html, 'cleo'), /toggleRegCheckin/);

    // Ids reach the action escaped and unchanged
    assert.doesNotMatch(html, /<x>/);
    const ids = actionTargets(html, 'toggleRegCheckin').map(target => target.attributes['data-reg-id']);
    assert.ok(ids.includes(TRICKY_ID), ids.join(', '));
});

test('the toggle sends the opposite state with the CSRF token and reloads the list', async () => {
    const { app, body, requests, toasts } = await openDialog({
        '/api/admin/registrations/anna/checkin': { id: 'anna', checkedIn: true, checkedInAt: '2026-10-01T19:05:00.000Z' },
        '/api/admin/registrations/ben/checkin': { id: 'ben', checkedIn: false, checkedInAt: null }
    });
    const targets = actionTargets(body(), 'toggleRegCheckin');
    const of = (id) => actionElement(targets.find(target => target.attributes['data-reg-id'] === id));

    await app.runAction('toggleRegCheckin', of('anna'));
    const put = requests.find(request => request.url === '/api/admin/registrations/anna/checkin');
    assert.equal(put.method, 'PUT');
    assert.equal(put.headers['X-CSRF-TOKEN'], 'csrf-1');
    assert.deepEqual(JSON.parse(put.body), { checkedIn: true });
    assert.equal(toasts.at(-1), 'Eingecheckt.');

    await app.runAction('toggleRegCheckin', of('ben'));
    assert.deepEqual(JSON.parse(requests.find(request => request.url === '/api/admin/registrations/ben/checkin').body), { checkedIn: false });
    assert.equal(toasts.at(-1), 'Check-in zurückgenommen.');

    const reloads = requests.filter(request => request.url === '/api/admin/events/ev1/registrations');
    assert.equal(reloads.length, 3);
});

test('a refused check-in shows the error of the server', async () => {
    const { app, body, toasts } = await openDialog();
    const [first] = actionTargets(body(), 'toggleRegCheckin');
    await app.runAction('toggleRegCheckin', actionElement(first));
    assert.equal(toasts.at(-1), 'Nicht gefunden');
});

// ── Member entry (W-06) ────────────────────────────────────────────────

const isShown = (element) => !element.classList.contains('is-hidden') && element.style.display !== 'none';
const SLOTS = [{ id: 'tank', name: 'Tank', emoji: '', capacity: 1 }, { id: 'heal', name: 'Heiler', emoji: '', capacity: 1 }];
const HITS = [
    { id: '11', username: 'greta', displayName: 'Greta <b>', avatar: '', alreadyRegistered: false },
    { id: '12', username: 'gregor', displayName: 'Gregor', avatar: '', alreadyRegistered: true }
];

/** Dialog of event ev1; GET and POST share the list URL, so the route answers by the method of the last request. */
async function openEntryDialog({ eventStatus = 'active', slots = [], added = { id: 'new', status: 'accepted', slotId: null } } = {}) {
    let harness;
    const listUrl = '/api/admin/events/ev1/registrations';
    harness = await loadFrontendApp({
        [listUrl]: () => (harness.requests.at(-1).method === 'POST' ? added : { data: REGISTRATIONS, slots, eventStatus }),
        '/api/admin/events/ev1/member-search?q=gre': HITS,
        '/api/admin/all-events': [],
        '/api/admin/stats': {}
    });
    harness.state.currentUser = ADMIN;
    harness.state.csrfToken = 'csrf-1';
    await harness.app.showRegistrations('ev1', 'Raid');
    return harness;
}

test('the member entry shows for active and archived events, not for drafts', async () => {
    for (const [eventStatus, shown] of [['active', true], ['archived', true], ['draft', false], ['cancelled', false]]) {
        const { element } = await openEntryDialog({ eventStatus });
        assert.equal(isShown(element('reg-add')), shown, eventStatus);
    }
});

test('a search lists the members, escaped, and greys out those on the list', async () => {
    const { app, element, requests } = await openEntryDialog();
    element('reg-add-search').value = 'gre';
    await app.runRegistrationMemberSearch();
    assert.ok(requests.some(request => request.url === '/api/admin/events/ev1/member-search?q=gre'));
    const html = element('reg-add-results').innerHTML;
    assertNoInlineHandlers(html);
    assert.doesNotMatch(html, /<b>/);
    const [greta] = actionTargets(html, 'addRegistrationMember');
    assert.equal(greta.attributes['data-user-id'], '11');
    assert.equal(greta.attributes['data-display-name'], 'Greta <b>');
    assert.equal(actionTargets(html, 'addRegistrationMember').length, 1);
    assert.match(html, /disabled[^>]*>[\s\S]*Gregor[\s\S]*schon angemeldet/);

    // Fewer than two characters clear the list without a request
    element('reg-add-search').value = 'g';
    const before = requests.length;
    await app.runRegistrationMemberSearch();
    assert.equal(requests.length, before);
    assert.equal(element('reg-add-results').innerHTML, '');
});

test('a slot event offers its slots for the entry', async () => {
    const { element } = await openEntryDialog({ slots: SLOTS });
    assert.ok(isShown(element('reg-add-slot')));
    assert.match(element('reg-add-slot').innerHTML, /value="tank"[\s\S]*value="heal"/);
    const plain = await openEntryDialog();
    assert.equal(isShown(plain.element('reg-add-slot')), false);
});

test('adding a member posts id and slot, confirms, warns and reloads', async () => {
    const { app, element, requests, toasts } = await openEntryDialog({
        slots: SLOTS, added: { id: 'new', status: 'accepted', slotId: 'tank', warning: 'Slot „Tank“ ist jetzt überbucht.' }
    });
    element('reg-add-search').value = 'gre';
    await app.runRegistrationMemberSearch();
    element('reg-add-slot').value = 'tank';
    const [greta] = actionTargets(element('reg-add-results').innerHTML, 'addRegistrationMember');
    await app.runAction('addRegistrationMember', actionElement(greta));

    const post = requests.find(request => request.method === 'POST' && request.url === '/api/admin/events/ev1/registrations');
    assert.equal(post.headers['X-CSRF-TOKEN'], 'csrf-1');
    assert.deepEqual(JSON.parse(post.body), { userId: '11', slotId: 'tank' });
    assert.deepEqual(toasts.slice(-2), ['Greta <b> eingetragen.', 'Slot „Tank“ ist jetzt überbucht.']);
    assert.equal(element('reg-add-search').value, '');
    assert.equal(requests.filter(request => request.method === 'GET' && request.url === '/api/admin/events/ev1/registrations').length, 2);
});

test('admin entries carry the source badge "Admin"', async () => {
    const harness = await loadFrontendApp({
        '/api/admin/events/ev1/registrations': { data: [registration('dora', { source: 'admin' })], slots: [], eventStatus: 'active' }
    });
    harness.state.currentUser = ADMIN;
    await harness.app.showRegistrations('ev1', 'Raid');
    assert.match(harness.element('registrations-tbody').innerHTML, /bi-person-gear[^>]*><\/i>Admin/);
});
