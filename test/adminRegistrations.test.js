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
