const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, loadFrontendModules, httpAnswer, REPO_ROOT } = require('./helpers');

// View and client of the official plugin „Event einreichen“
// (plugins/event-submissions/assets/view.js, plugins/event-submissions/client.js)

const VIEW_PATH = path.join(REPO_ROOT, 'plugins', 'event-submissions', 'assets', 'view.js');
const CLIENT_PATH = path.join(REPO_ROOT, 'plugins', 'event-submissions', 'client.js');

const ADMIN = { id: 'u-admin', username: 'mori', displayName: 'Mori', avatar: '', roles: [], isAdmin: true };
const MEMBER = { id: 'u-member', username: 'tom', displayName: 'Tom', avatar: '', roles: [], isAdmin: false };

const ENTRY = {
    id: 'event-submissions',
    name: 'Event einreichen',
    version: '1.0.0',
    official: true,
    permissions: ['events:read', 'events:draft', 'discord:dm', 'discord:channel'],
    client: '/plugins/event-submissions/client.js?v=1.0.0',
    css: '/plugins/event-submissions/client.css?v=1.0.0'
};

const NOW = new Date('2026-11-19T15:00:00.000Z');

async function loadView() {
    const harness = await loadFrontendApp({});
    const modules = await loadFrontendModules(VIEW_PATH, harness.window);
    const view = modules.get('view.js');
    const helpers = harness.app.createPluginUi(ENTRY).helpers;
    return { view, helpers, harness };
}

async function openPluginApp(routes = {}, user = ADMIN) {
    const harness = await loadFrontendApp({ '/api/admin/roles': [], ...routes });
    harness.state.currentUser = user;
    harness.state.csrfToken = 'test-csrf';
    const modules = await loadFrontendModules(CLIENT_PATH, harness.window);
    const clientModule = modules.get('client.js');
    harness.app.mountPluginModule(ENTRY, clientModule);
    return harness;
}

async function go(harness, hash = 'p/event-submissions') {
    harness.location.hash = '#' + hash;
    await harness.app.handleRoute();
}

function sampleSubmission(overrides = {}) {
    return {
        id: 'sub-1',
        userId: 'u-member',
        userName: 'Tom',
        userAvatar: '',
        title: 'Retro-Konsolenabend',
        description: 'Alte Konsolen, **Couch-Koop** und Pizza.',
        wishedDate: '2026-12-05',
        category: 'Gamenight',
        status: 'open',
        reason: '',
        eventId: '',
        createdAt: '2026-11-17T15:00:00.000Z',
        updatedAt: '2026-11-17T15:00:00.000Z',
        ...overrides
    };
}

test('statusChip renders the German label and chip tone per status', async () => {
    const { view } = await loadView();
    assert.match(view.statusChip('open'), /class="chip chip-sm"[^>]*>Offen<\/span>/);
    assert.match(view.statusChip('planning'), /class="chip chip-sm chip-info"[^>]*>In Planung<\/span>/);
    assert.match(view.statusChip('accepted'), /class="chip chip-sm chip-success"[^>]*>Eingetragen<\/span>/);
    assert.match(view.statusChip('rejected'), /class="chip chip-sm chip-danger"[^>]*>Abgelehnt<\/span>/);
});

test('hostile title, description, reason and member name render escaped in own and admin lists', async () => {
    const { view, helpers } = await loadView();
    const hostile = sampleSubmission({
        userName: '<script>alert(1)</script>',
        title: '<img src=x onerror=alert(1)>',
        description: '**Fett** und <img src=x onerror=alert(2)>',
        status: 'rejected',
        reason: '<b>Nicht erlaubt</b>'
    });

    const ownHtml = view.renderOwnList([hostile], helpers, NOW);
    assert.doesNotMatch(ownHtml, /<img src=x/);
    assert.doesNotMatch(ownHtml, /<b>Nicht erlaubt<\/b>/);
    assert.match(ownHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(ownHtml, /&lt;b&gt;Nicht erlaubt&lt;\/b&gt;/);
    // Description uses markdownPreview (** stripped) and is HTML-escaped
    assert.doesNotMatch(ownHtml, /\*\*Fett\*\*/);
    assert.match(ownHtml, /Fett und &lt;img src=x onerror=alert\(2\)&gt;/);

    const adminHtml = view.renderAdminList([hostile], { filter: 'done' }, helpers, NOW);
    assert.doesNotMatch(adminHtml, /<script>/);
    assert.doesNotMatch(adminHtml, /<img src=x/);
    assert.doesNotMatch(adminHtml, /<b>Nicht erlaubt<\/b>/);
    assert.match(adminHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(adminHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(adminHtml, /&lt;b&gt;Nicht erlaubt&lt;\/b&gt;/);
    assert.match(adminHtml, /Fett und &lt;img src=x onerror=alert\(2\)&gt;/);
});

test('own list shows withdraw only for open items, links accepted rows to #event/<eventId>, and renders empty state', async () => {
    const { view, helpers } = await loadView();
    assert.match(view.renderOwnList([], helpers, NOW), /Noch keine Vorschläge/);

    const items = [
        sampleSubmission({ id: 's-open', status: 'open', title: 'Offene Idee' }),
        sampleSubmission({ id: 's-plan', status: 'planning', title: 'Geplante Idee', eventId: 'ev-1' }),
        sampleSubmission({ id: 's-acc', status: 'accepted', title: 'Angenommene Idee', eventId: 'ev-2' }),
        sampleSubmission({ id: 's-rej', status: 'rejected', title: 'Abgelehnte Idee', reason: 'Schon geplant.' })
    ];
    const html = view.renderOwnList(items, helpers, NOW);
    const withdraws = [...html.matchAll(/data-click="p:event-submissions:withdraw"[^>]*data-id="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(withdraws, ['s-open']);
    assert.match(html, /href="#event\/ev-2"/);
    assert.match(html, /Schon geplant\./);
});

test('admin list shows Übernehmen and Ablehnen only for open and planning, and links accepted rows to #event/<eventId>', async () => {
    const { view, helpers } = await loadView();
    assert.match(view.renderAdminList([], { filter: 'open' }, helpers, NOW), /Noch keine Vorschläge/);

    const items = [
        sampleSubmission({ id: 's-open', status: 'open' }),
        sampleSubmission({ id: 's-plan', status: 'planning', eventId: 'ev-plan' }),
        sampleSubmission({ id: 's-acc', status: 'accepted', eventId: 'ev-acc' }),
        sampleSubmission({ id: 's-rej', status: 'rejected', reason: 'Zu früh.' })
    ];
    const html = view.renderAdminList(items, { filter: 'open' }, helpers, NOW);
    const takeOvers = [...html.matchAll(/data-click="p:event-submissions:takeOver"[^>]*data-id="([^"]+)"/g)].map(m => m[1]);
    const rejects = [...html.matchAll(/data-click="p:event-submissions:askReject"[^>]*data-id="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(takeOvers, ['s-open', 's-plan']);
    assert.deepEqual(rejects, ['s-open', 's-plan']);
    assert.match(html, /href="#event\/ev-acc"/);
});

test('renderRejectForm escapes the item and wires reject and cancelReject actions', async () => {
    const { view, helpers } = await loadView();
    const html = view.renderRejectForm(sampleSubmission({ id: 'sub-99', title: '<b>Test</b>' }), helpers);
    assert.doesNotMatch(html, /<b>Test<\/b>/);
    assert.match(html, /data-click="p:event-submissions:reject"[^>]*data-id="sub-99"/);
    assert.match(html, /data-click="p:event-submissions:cancelReject"/);
});

test('member submits a new idea and withdraws an open one through client.js', async () => {
    const own = [sampleSubmission({ id: 'sub-1', title: 'Erste Idee' })];
    const harness = await openPluginApp({
        '/api/plugins/event-submissions/mine': () => own,
        '/api/plugins/event-submissions/': (options) => {
            const body = JSON.parse(options.body);
            const created = sampleSubmission({ id: 'sub-2', ...body });
            own.unshift(created);
            return created;
        },
        '/api/plugins/event-submissions/sub-1': () => {
            const idx = own.findIndex(item => item.id === 'sub-1');
            if (idx >= 0) own.splice(idx, 1);
            return { success: true };
        }
    }, MEMBER);

    await go(harness);
    assert.match(harness.element('es-page').innerHTML, /Erste Idee/);
    assert.doesNotMatch(harness.element('es-page').innerHTML, /Alle Vorschläge/);

    harness.element('es-title').value = 'Quiz-Abend';
    harness.element('es-description').value = 'Fragen rund um **Games**';
    harness.element('es-wished-date').value = '2026-12-20';
    harness.element('es-category').value = 'Community';
    await harness.app.runAction('p:event-submissions:submit', harness.element('es-submit-btn'));

    assert.ok(harness.toasts.includes('Danke! Dein Vorschlag ist eingereicht.'), harness.toasts.join(' | '));
    assert.match(harness.element('es-page').innerHTML, /Quiz-Abend/);

    await harness.app.runAction('p:event-submissions:withdraw', { dataset: { id: 'sub-1' } });
    assert.ok(harness.toasts.includes('Vorschlag zurückgezogen.'), harness.toasts.join(' | '));
    assert.doesNotMatch(harness.element('es-page').innerHTML, /Erste Idee/);
});

test('admin sees tab badge, filters submissions, rejects with a reason and takes over into the event editor', async () => {
    const list = [
        sampleSubmission({ id: 'sub-open', title: 'Turnier-Idee', description: '5v5', wishedDate: '2026-12-10', category: 'Tournament', status: 'open' }),
        sampleSubmission({ id: 'sub-done', title: 'Alte Idee', status: 'rejected', reason: 'Vorbei' })
    ];
    const harness = await openPluginApp({
        '/api/plugins/event-submissions/counts': () => ({ open: list.filter(i => i.status === 'open').length }),
        '/api/plugins/event-submissions/?status=open': () => list.filter(i => i.status === 'open'),
        '/api/plugins/event-submissions/?status=done': () => list.filter(i => i.status === 'rejected' || i.status === 'accepted'),
        '/api/plugins/event-submissions/mine': () => [],
        '/api/plugins/event-submissions/sub-open/reject': (options) => {
            const { reason } = JSON.parse(options.body);
            const item = list.find(i => i.id === 'sub-open');
            item.status = 'rejected';
            item.reason = reason;
            return item;
        }
    }, ADMIN);

    await go(harness);
    assert.equal(harness.element('nav-p-event-submissions-badge').textContent, '1');
    assert.match(harness.element('es-page').innerHTML, /Alle Vorschläge/);
    assert.match(harness.element('es-page').innerHTML, /Turnier-Idee/);

    // Take over opens the event editor prefilled with startDate = wishedDate + T19:00 and ref
    await harness.app.runAction('p:event-submissions:takeOver', { dataset: { id: 'sub-open' } });
    assert.equal(harness.location.hash, '#event-editor/new');
    assert.equal(harness.element('event-title').value, 'Turnier-Idee');
    assert.equal(harness.element('event-category').value, 'Tournament');
    assert.equal(harness.state.startDatePicker.selectedDates[0].toISOString(), new Date('2026-12-10T19:00').toISOString());
    assert.deepEqual({ ...harness.state.pendingPluginOrigin }, { plugin: 'event-submissions', ref: 'sub-open' });

    // Close the editor and reject the submission with a reason
    await harness.app.runAction('closeEventEditor', {});
    await go(harness);
    await harness.app.runAction('p:event-submissions:askReject', { dataset: { id: 'sub-open' } });
    assert.ok(harness.element('es-reject-reason'));
    await harness.app.runAction('p:event-submissions:cancelReject', {});
    assert.doesNotMatch(harness.element('es-page').innerHTML, /es-reject-reason/);

    await harness.app.runAction('p:event-submissions:askReject', { dataset: { id: 'sub-open' } });
    harness.element('es-reject-reason').value = 'Passt zeitlich nicht.';
    await harness.app.runAction('p:event-submissions:reject', { dataset: { id: 'sub-open' } });
    assert.ok(harness.toasts.includes('Vorschlag abgelehnt.'), harness.toasts.join(' | '));

    // Switch filter to done
    await harness.app.runAction('p:event-submissions:filter', { dataset: { filter: 'done' } });
    assert.match(harness.element('es-page').innerHTML, /Passt zeitlich nicht\./);

    // Switch to submit tab
    await harness.app.runAction('p:event-submissions:showTab', { dataset: { tab: 'submit' } });
    assert.match(harness.element('es-page').innerHTML, /Neue Idee/);
});

test('server errors show a danger toast with the German message', async () => {
    const harness = await openPluginApp({
        '/api/plugins/event-submissions/mine': [],
        '/api/plugins/event-submissions/': httpAnswer(400, { error: 'Der Titel braucht 3 bis 100 Zeichen.' })
    }, MEMBER);

    await go(harness);
    harness.element('es-title').value = 'ab';
    await harness.app.runAction('p:event-submissions:submit', harness.element('es-submit-btn'));
    assert.ok(harness.toasts.includes('Der Titel braucht 3 bis 100 Zeichen.'));
});

test('the category list of the view matches the editor select #event-category and the server rules', async () => {
    const { view } = await loadView();
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    const select = html.slice(html.indexOf('id="event-category"'), html.indexOf('</select>', html.indexOf('id="event-category"')));
    const editorValues = [...select.matchAll(/<option value="([^"]*)">/g)].map(match => match[1]).filter(Boolean);
    assert.deepEqual([...view.CATEGORIES], editorValues);
    assert.deepEqual([...view.CATEGORIES], [...require('../plugins/event-submissions/rules').CATEGORIES]);

    const { helpers } = await loadView();
    const form = view.renderSubmitForm(view.CATEGORIES, helpers);
    const formValues = [...form.matchAll(/<option value="([^"]*)">/g)].map(match => match[1]);
    assert.deepEqual(formValues, ['', ...editorValues]);
    assert.match(form, /<option value="">Keine Kategorie<\/option>/);
});

test('a double click on „Vorschlag einreichen“ sends one request', async () => {
    let posts = 0;
    const harness = await openPluginApp({
        '/api/plugins/event-submissions/mine': [],
        '/api/plugins/event-submissions/': () => { posts += 1; return sampleSubmission({ id: 'sub-2' }); }
    }, MEMBER);

    await go(harness);
    harness.element('es-title').value = 'Quiz-Abend';
    await Promise.all([
        harness.app.runAction('p:event-submissions:submit', harness.element('es-submit-btn')),
        harness.app.runAction('p:event-submissions:submit', harness.element('es-submit-btn'))
    ]);
    assert.equal(posts, 1);
});
