const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadFrontendApp, loadFrontendModules, httpAnswer, REPO_ROOT } = require('./helpers');

// View and client of the official plugin „Event-Feedback“
// (plugins/event-feedback/assets/view.js, plugins/event-feedback/client.js)

const VIEW_PATH = path.join(REPO_ROOT, 'plugins', 'event-feedback', 'assets', 'view.js');
const CLIENT_PATH = path.join(REPO_ROOT, 'plugins', 'event-feedback', 'client.js');
const API = '/api/plugins/event-feedback';

const ADMIN = { id: 'u-admin', username: 'mori', displayName: 'Mori', avatar: '', roles: [], isAdmin: true };
const MEMBER = { id: 'u-member', username: 'tom', displayName: 'Tom', avatar: '', roles: [], isAdmin: false };
const ENTRY = {
    id: 'event-feedback', name: 'Event-Feedback', version: '1.0.0', official: true,
    permissions: ['events:read', 'registrations:read', 'discord:dm'],
    client: '/plugins/event-feedback/client.js?v=1.0.0', css: '/plugins/event-feedback/client.css?v=1.0.0'
};
const EVENT = { id: 'e1', title: 'Raid-Abend', startDate: '2026-11-20T18:00:00.000Z', category: 'Raid' };

async function loadView() {
    const harness = await loadFrontendApp({});
    const modules = await loadFrontendModules(VIEW_PATH, harness.window);
    return { view: modules.get('view.js'), helpers: harness.app.createPluginUi(ENTRY).helpers };
}

async function openPluginApp(routes, user, hash = 'p/event-feedback') {
    const harness = await loadFrontendApp({ '/api/admin/roles': [], ...routes });
    harness.state.currentUser = user;
    harness.state.csrfToken = 'test-csrf';
    const modules = await loadFrontendModules(CLIENT_PATH, harness.window);
    harness.app.mountPluginModule(ENTRY, modules.get('client.js'));
    harness.location.hash = '#' + hash;
    await harness.app.handleRoute();
    return harness;
}

// ── Pure markup ─────────────────────────────────────────────────────────

test('stars as input carry aria-pressed and German labels; read-only stars say n von 5', async () => {
    const { view } = await loadView();
    const input = view.renderStars(3, { input: true });
    assert.equal((input.match(/data-click="p:event-feedback:pickStar"/g) || []).length, 5);
    assert.match(input, /data-rating="1"[^>]*aria-pressed="false"[^>]*aria-label="1 Stern"/);
    assert.match(input, /data-rating="3"[^>]*aria-pressed="true"[^>]*aria-label="3 Sterne"/);
    assert.equal((input.match(/bi-star-fill/g) || []).length, 3);
    const still = view.renderStars(4);
    assert.match(still, /aria-label="4 von 5 Sternen"/);
    assert.doesNotMatch(still, /data-click/);
});

test('the form escapes the title, prefills an answer and turns read-only outside the window', async () => {
    const { view, helpers } = await loadView();
    const open = view.renderForm({ event: { ...EVENT, title: '<b>Raid</b>' }, editable: true, answer: { rating: 4, comment: 'Gut & "laut"' } }, helpers);
    assert.match(open, /&lt;b&gt;Raid&lt;\/b&gt;/);
    assert.match(open, /Gut &amp; &quot;laut&quot;<\/textarea>/);
    assert.match(open, /maxlength="1000"/);
    assert.match(open, /Feedback ändern/);
    assert.match(open, /data-click="p:event-feedback:sendAnswer"/);
    const fresh = view.renderForm({ event: EVENT, editable: true, answer: null }, helpers);
    assert.match(fresh, /Feedback senden/);
    const closed = view.renderForm({ event: EVENT, editable: false, answer: { rating: 2, comment: 'Alt' } }, helpers);
    assert.match(closed, /Die Feedback-Zeit für dieses Event ist vorbei\./);
    assert.match(closed, /aria-label="2 von 5 Sternen"/);
    assert.doesNotMatch(closed, /<textarea/);
    assert.doesNotMatch(closed, /sendAnswer/);
});

test('my feedback lists open events with a link and my answers; empty lists say so', async () => {
    const { view, helpers } = await loadView();
    const html = view.renderMine({ open: [EVENT], done: [{ event: { ...EVENT, id: 'e2', title: 'Quiz' }, rating: 5, comment: '<i>Top</i>', editable: true }] }, helpers);
    assert.match(html, /href="#p\/event-feedback\/e1"/);
    assert.match(html, /Feedback geben/);
    assert.match(html, /&lt;i&gt;Top&lt;\/i&gt;/);
    assert.match(html, /href="#p\/event-feedback\/e2"[^>]*>(?:<i[^>]*><\/i>)?Ändern/);
    const empty = view.renderMine({ open: [], done: [] }, helpers);
    assert.match(empty, /Gerade wartet kein Event auf dein Feedback\./);
});

test('the admin summary shows the average with a comma, the rate and comments without names', async () => {
    const { view, helpers } = await loadView();
    const summary = {
        events: [
            { event: EVENT, count: 9, eligible: 12, average: 4.3 },
            { event: { ...EVENT, id: 'e2', title: 'Quiz' }, count: 1, eligible: 0, average: 4 },
            { event: { ...EVENT, id: 'e3', title: 'Leer' }, count: 0, eligible: 5, average: null }
        ],
        categories: [{ category: 'Raid', count: 10, average: 4.2 }]
    };
    const detail = { event: EVENT, count: 9, eligible: 12, average: 4.3, distribution: [0, 1, 1, 2, 5], comments: [{ rating: 2, comment: '<script>x</script>' }] };
    const html = view.renderSummary(summary, helpers, { openId: 'e1', detail });
    assert.match(html, /★ 4,3/);
    assert.match(html, /9 von 12 \(75 %\)/);
    assert.match(html, /★ 4,0/);
    assert.match(html, /1 Antwort</);
    assert.match(html, /★ –/);
    assert.match(html, /Raid ★ 4,2/);
    assert.match(html, /data-click="p:event-feedback:openEvent" data-id="e1"/);
    assert.match(html, /data-style-width="56"/, '5 of 9 answers have 5 stars');
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
    assert.doesNotMatch(html, /style=/);
    assert.match(view.renderSummary({ events: [], categories: [] }, helpers, {}), /Noch kein Feedback/);
});

test('the admin switch marks the active pill', async () => {
    const { view } = await loadView();
    assert.match(view.renderAdminSwitch('summary'), /class="nav-link active"[^>]*data-tab="summary"|data-tab="summary"[^>]*class="nav-link active"/);
    assert.match(view.renderAdminSwitch('summary'), /Auswertung/);
    assert.match(view.renderAdminSwitch('mine'), /Mein Feedback/);
});

// ── Client ──────────────────────────────────────────────────────────────

test('a member opens the form from the DM link, picks 4 stars, writes a comment and sends', async () => {
    const sent = [];
    let open = [EVENT];
    const harness = await openPluginApp({
        [`${API}/mine`]: () => ({ open, done: [] }),
        [`${API}/events/e1/mine`]: (options = {}) => {
            if (options.method === 'PUT') {
                sent.push(JSON.parse(options.body));
                open = [];
                return { rating: 4, comment: 'Gut' };
            }
            return { event: EVENT, editable: true, answer: null };
        }
    }, MEMBER, 'p/event-feedback/e1');
    assert.match(harness.element('ef-page').innerHTML, /Raid-Abend/);
    assert.equal(harness.element('nav-p-event-feedback-badge').textContent, '1');
    await harness.app.runAction('p:event-feedback:pickStar', { dataset: { rating: '4' } });
    assert.match(harness.element('ef-stars').innerHTML, /data-rating="4"[^>]*aria-pressed="true"/);
    harness.element('ef-comment').value = 'Gut';
    await harness.app.runAction('p:event-feedback:sendAnswer', {});
    assert.deepEqual(sent, [{ rating: 4, comment: 'Gut' }]);
    assert.ok(harness.toasts.includes('Danke für dein Feedback!'), harness.toasts.join(' | '));
    assert.equal(harness.element('nav-p-event-feedback-badge').textContent, '0');
});

test('a link to an event the member may not rate shows the server message', async () => {
    const harness = await openPluginApp({
        [`${API}/mine`]: () => ({ open: [], done: [] }),
        [`${API}/events/e9/mine`]: httpAnswer(403, { error: 'Für dieses Event kannst du kein Feedback geben.' })
    }, MEMBER, 'p/event-feedback/e9');
    assert.match(harness.element('ef-page').innerHTML, /Für dieses Event kannst du kein Feedback geben\./);
    assert.match(harness.element('ef-page').innerHTML, /empty-state/);
});

test('admins see the summary first, open an event and switch to their own feedback', async () => {
    const harness = await openPluginApp({
        [`${API}/mine`]: () => ({ open: [], done: [] }),
        [`${API}/summary`]: () => ({ events: [{ event: EVENT, count: 2, eligible: 4, average: 4.5 }], categories: [] }),
        [`${API}/events/e1/summary`]: () => ({ event: EVENT, count: 2, eligible: 4, average: 4.5, distribution: [0, 0, 0, 1, 1], comments: [{ rating: 5, comment: 'Super Orga!' }] })
    }, ADMIN);
    assert.match(harness.element('ef-page').innerHTML, /2 von 4 \(50 %\)/);
    await harness.app.runAction('p:event-feedback:openEvent', { dataset: { id: 'e1' } });
    assert.match(harness.element('ef-page').innerHTML, /Super Orga!/);
    await harness.app.runAction('p:event-feedback:showTab', { dataset: { tab: 'mine' } });
    assert.match(harness.element('ef-page').innerHTML, /Gerade wartet kein Event auf dein Feedback\./);
});
