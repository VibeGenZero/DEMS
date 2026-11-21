const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadFrontendApp, loadFrontendModules, httpAnswer, REPO_ROOT } = require('./helpers');

// View and client of the official plugin „Badges“ (plugins/badges/assets/view.js, plugins/badges/client.js)

const VIEW_PATH = path.join(REPO_ROOT, 'plugins', 'badges', 'assets', 'view.js');
const CLIENT_PATH = path.join(REPO_ROOT, 'plugins', 'badges', 'client.js');
const API = '/api/plugins/badges';

const ADMIN = { id: 'u-admin', username: 'mori', displayName: 'Mori', avatar: '', roles: [], isAdmin: true };
const ENTRY = {
    id: 'badges',
    name: 'Badges',
    version: '1.0.0',
    official: true,
    permissions: ['events:read', 'registrations:read', 'members:read', 'discord:roles', 'discord:dm', 'discord:channel'],
    client: '/plugins/badges/client.js?v=1.0.0',
    css: '/plugins/badges/client.css?v=1.0.0'
};
const META = {
    icons: ['bi-trophy', 'bi-star'],
    categories: ['Raid', 'Quiz'],
    roles: [{ id: '110000000000000005', name: 'VIP', color: '#a855f7' }, { id: '110000000000000007', name: 'Event-Teilnehmer', color: null }],
    eventRoleIds: ['110000000000000007']
};

const sampleBadge = (overrides = {}) => ({
    id: 'b1', name: 'Raid-Veteran', description: 'Zehn Raids', icon: 'bi-trophy', color: '#22c55e',
    rule: { type: 'participations', count: 10, category: 'Raid' }, ruleText: 'Ab 10 Teilnahmen · Raid',
    roleId: '110000000000000005', holders: 12, unsynced: 0, createdAt: '2026-11-20T10:00:00.000Z', ...overrides
});

async function loadView() {
    const harness = await loadFrontendApp({});
    const modules = await loadFrontendModules(VIEW_PATH, harness.window);
    return { view: modules.get('view.js'), helpers: harness.app.createPluginUi(ENTRY).helpers };
}

async function openPluginApp(routes = {}, options = {}) {
    const harness = await loadFrontendApp({ '/api/admin/roles': [], [`${API}/roles/pending`]: { removals: 0 }, ...routes }, options);
    harness.state.currentUser = ADMIN;
    harness.state.csrfToken = 'test-csrf';
    const modules = await loadFrontendModules(CLIENT_PATH, harness.window);
    harness.app.mountPluginModule(ENTRY, modules.get('client.js'));
    harness.location.hash = '#p/badges';
    await harness.app.handleRoute();
    return harness;
}

// ── Pure markup ─────────────────────────────────────────────────────────

test('badge cards escape names and show rule, role, holders and the unsynced warning', async () => {
    const { view, helpers } = await loadView();
    const html = view.renderBadgeCards([sampleBadge({ name: '<img src=x>', description: '"Zehn" & <b>Raids</b>', unsynced: 3 })], META, helpers);
    assert.match(html, /&lt;img src=x&gt;/);
    assert.match(html, /&quot;Zehn&quot; &amp; &lt;b&gt;Raids&lt;\/b&gt;/);
    assert.match(html, /Ab 10 Teilnahmen · Raid/);
    assert.match(html, /VIP/);
    assert.match(html, /12 Mitglieder/);
    assert.match(html, /Rolle bei 3 Mitgliedern noch nicht vergeben/);
    assert.match(html, /data-click="p:badges:retryRoles" data-id="b1"/);
    assert.match(html, /data-style-color="#22c55e"/);
    for (const action of ['showAward', 'showHolders', 'editBadge', 'deleteBadge']) {
        assert.match(html, new RegExp(`data-click="p:badges:${action}" data-id="b1"`), action);
    }
    assert.doesNotMatch(html, /style=/);
    assert.doesNotMatch(html, /onclick/i);
});

test('singular counts, a missing role and no role at all', async () => {
    const { view, helpers } = await loadView();
    const one = view.renderBadgeCards([sampleBadge({ holders: 1, unsynced: 1 })], META, helpers);
    assert.match(one, /1 Mitglied</);
    assert.match(one, /Rolle bei 1 Mitglied noch nicht vergeben/);
    const gone = view.renderBadgeCards([sampleBadge({ roleId: '119999999999999999' })], META, helpers);
    assert.match(gone, /Rolle nicht verfügbar/);
    const none = view.renderBadgeCards([sampleBadge({ roleId: null })], META, helpers);
    assert.doesNotMatch(none, /bi-discord/);
    assert.doesNotMatch(none, /retryRoles/);
});

test('an empty list shows the empty state', async () => {
    const { view, helpers } = await loadView();
    const html = view.renderBadgeCards([], META, helpers);
    assert.match(html, /empty-state/);
    assert.match(html, /Noch keine Badges/);
});

test('the editor prefills a badge, hides the count for manual badges and warns about event roles', async () => {
    const { view, helpers } = await loadView();
    const html = view.renderEditor(sampleBadge(), META, helpers);
    assert.match(html, /id="bd-name"[^>]*value="Raid-Veteran"/);
    assert.match(html, /value="bi-trophy"[^>]*checked/);
    assert.match(html, /id="bd-color"[^>]*value="#22c55e"/);
    assert.match(html, /<option value="participations" selected>/);
    assert.match(html, /id="bd-count"[^>]*value="10"/);
    assert.match(html, /<option value="Raid" selected>/);
    assert.match(html, /<option value="110000000000000005" selected>VIP<\/option>/);
    assert.match(html, /id="bd-count-row" class="[^"]*"/);
    assert.doesNotMatch(html, /id="bd-count-row" class="[^"]*is-hidden/);
    assert.match(html, /id="bd-role-hint" class="[^"]*is-hidden/);
    assert.match(html, /Diese Rolle wird auch von Events vergeben und danach wieder entzogen\./);

    const fresh = view.renderEditor(null, META, helpers);
    assert.match(fresh, /Neues Badge/);
    assert.match(fresh, /id="bd-count-row" class="[^"]*is-hidden/);
    assert.match(fresh, /<option value="manual" selected>/);

    const eventRole = view.renderEditor(sampleBadge({ roleId: '110000000000000007' }), META, helpers);
    assert.doesNotMatch(eventRole, /id="bd-role-hint" class="[^"]*is-hidden/);

    const noRoles = view.renderEditor(null, { ...META, roles: [] }, helpers);
    assert.match(noRoles, /Der Bot ist nicht verbunden oder es gibt keine Rolle, die ein Plugin vergeben darf\./);
});

test('the editor keeps a stored role or category that the lists no longer offer', async () => {
    const { view, helpers } = await loadView();
    const html = view.renderEditor(sampleBadge({ roleId: '119999999999999999', rule: { type: 'participations', count: 3, category: 'Alt' } }),
        { ...META, roles: [] }, helpers);
    assert.match(html, /<option value="119999999999999999" selected>Gespeicherte Rolle \(nicht verfügbar\)<\/option>/);
    assert.match(html, /<option value="Alt" selected>Alt \(kein Event mehr\)<\/option>/);
    assert.doesNotMatch(html, /<option value="" selected>Keine<\/option>/);
    assert.doesNotMatch(html, /<option value="" selected>Alle Kategorien<\/option>/);
});

test('failed role removals show as one line with a retry; none show nothing', async () => {
    const { view } = await loadView();
    assert.equal(view.renderPendingRemovals(0), '');
    assert.match(view.renderPendingRemovals(1), /Rolle bei 1 Mitglied noch nicht entzogen/);
    const many = view.renderPendingRemovals(4);
    assert.match(many, /Rollen bei 4 Mitgliedern noch nicht entzogen/);
    assert.match(many, /data-click="p:badges:retryPending"/);
});

test('holders show name, date and how they got it, each with a revoke button', async () => {
    const { view, helpers } = await loadView();
    const html = view.renderHolders(sampleBadge(), [
        { userId: '200000000000000003', name: '<Tom>', avatar: '', awardedAt: '2026-11-20T10:00:00.000Z', byRule: false, roleSynced: true },
        { userId: '200000000000000002', name: 'Lena', avatar: '', awardedAt: '2026-11-19T10:00:00.000Z', byRule: true, roleSynced: false }
    ], helpers);
    assert.match(html, /&lt;Tom&gt;/);
    assert.match(html, /20\.11\.2026/);
    assert.match(html, /von Hand/);
    assert.match(html, /automatisch/);
    assert.match(html, /data-click="p:badges:revokeAward" data-id="b1" data-user="200000000000000003"/);
    assert.match(view.renderHolders(sampleBadge(), [], helpers), /Noch niemand hat dieses Badge\./);
});

test('the award search lists hits with an award button', async () => {
    const { view, helpers } = await loadView();
    const box = view.renderAwardSearch(sampleBadge(), helpers);
    assert.match(box, /data-input="p:badges:searchMembers" data-id="b1"/);
    assert.match(box, /id="bd-results"/);
    const hits = view.renderSearchResults('b1', [{ id: '200000000000000003', name: 'Tom', avatar: '' }], helpers);
    assert.match(hits, /data-click="p:badges:awardMember" data-id="b1" data-user="200000000000000003"/);
    assert.match(view.renderSearchResults('b1', [], helpers), /Niemand gefunden\./);
});

// ── Client ──────────────────────────────────────────────────────────────

test('the admin page shows failed removals and retries them', async () => {
    let pending = 2;
    const harness = await openPluginApp({
        [`${API}/meta`]: () => META,
        [`${API}/badges`]: () => [],
        [`${API}/roles/pending`]: () => ({ removals: pending }),
        [`${API}/roles/retry`]: () => { pending = 0; return { queued: 2 }; }
    });
    assert.match(harness.element('bd-pending').innerHTML, /Rollen bei 2 Mitgliedern noch nicht entzogen/);
    await harness.app.runAction('p:badges:retryPending', {});
    assert.ok(harness.toasts.includes('2 Rollen werden erneut entzogen.'), harness.toasts.join(' | '));
    assert.equal(harness.element('bd-pending').innerHTML, '');
});

test('the admin page lists the badges, creates one with the editor values and awards one by search', async () => {
    const badges = [sampleBadge()];
    const sent = [];
    const harness = await openPluginApp({
        [`${API}/meta`]: () => META,
        [`${API}/badges`]: (options = {}) => {
            if (options.method === 'POST') {
                const body = JSON.parse(options.body);
                sent.push(body);
                const created = sampleBadge({ id: 'b2', ...body, ruleText: 'Von Hand', holders: 0 });
                badges.push(created);
                return created;
            }
            return badges;
        },
        [`${API}/members?q=to`]: () => [{ id: '200000000000000003', name: 'Tom', avatar: '' }],
        [`${API}/badges/b1/awards`]: (options) => { sent.push(JSON.parse(options.body)); return { success: true }; }
    }, { timers: true });
    assert.match(harness.element('bd-list').innerHTML, /Raid-Veteran/);

    await harness.app.runAction('p:badges:newBadge', {});
    harness.element('bd-name').value = 'Gründer';
    harness.element('bd-description').value = 'Von Anfang an';
    harness.element('bd-color').value = '#f59e0b';
    harness.element('bd-rule').value = 'manual';
    harness.element('bd-role').value = '';
    harness.element('bd-icon-bi-star').checked = true;
    await harness.app.runAction('p:badges:saveBadge', {});
    assert.deepEqual(sent[0], { name: 'Gründer', description: 'Von Anfang an', icon: 'bi-star', color: '#f59e0b', rule: { type: 'manual' }, roleId: null });
    assert.ok(harness.toasts.includes('Badge gespeichert.'), harness.toasts.join(' | '));
    assert.match(harness.element('bd-list').innerHTML, /Gründer/);

    await harness.app.runAction('p:badges:showAward', { dataset: { id: 'b1' } });
    harness.element('bd-search').value = 'to';
    await harness.app.runAction('p:badges:searchMembers', harness.element('bd-search'));
    await harness.advance(300);
    assert.match(harness.element('bd-results').innerHTML, /Tom/);
    await harness.app.runAction('p:badges:awardMember', { dataset: { id: 'b1', user: '200000000000000003' } });
    assert.deepEqual(sent[1], { userId: '200000000000000003' });
    assert.ok(harness.toasts.includes('Badge vergeben.'), harness.toasts.join(' | '));
});

test('a rule badge sends count and category; the count row follows the rule type', async () => {
    const sent = [];
    const harness = await openPluginApp({
        [`${API}/meta`]: () => META,
        [`${API}/badges`]: (options = {}) => {
            if (options.method === 'POST') { sent.push(JSON.parse(options.body)); return sampleBadge({ id: 'b9' }); }
            return [];
        }
    });
    await harness.app.runAction('p:badges:newBadge', {});
    assert.ok(harness.element('bd-count-row').classList.contains('is-hidden'));
    harness.element('bd-rule').value = 'checkins';
    await harness.app.runAction('p:badges:changeRuleType', harness.element('bd-rule'));
    assert.ok(!harness.element('bd-count-row').classList.contains('is-hidden'));
    harness.element('bd-name').value = 'Pünktlich';
    harness.element('bd-count').value = '5';
    harness.element('bd-category').value = 'Raid';
    harness.element('bd-role').value = '110000000000000007';
    await harness.app.runAction('p:badges:changeRole', harness.element('bd-role'));
    assert.ok(!harness.element('bd-role-hint').classList.contains('is-hidden'));
    await harness.app.runAction('p:badges:saveBadge', {});
    assert.deepEqual(sent[0].rule, { type: 'checkins', count: 5, category: 'Raid' });
    assert.equal(sent[0].roleId, '110000000000000007');
});

test('a server error shows a danger toast with its German message', async () => {
    const harness = await openPluginApp({
        [`${API}/meta`]: () => META,
        [`${API}/badges`]: (options = {}) => (options.method === 'POST'
            ? httpAnswer(400, { error: 'Der Name muss 1 bis 40 Zeichen lang sein.' })
            : [])
    });
    await harness.app.runAction('p:badges:newBadge', {});
    harness.element('bd-name').value = '';
    await harness.app.runAction('p:badges:saveBadge', {});
    assert.ok(harness.toasts.includes('Der Name muss 1 bis 40 Zeichen lang sein.'), harness.toasts.join(' | '));
});
