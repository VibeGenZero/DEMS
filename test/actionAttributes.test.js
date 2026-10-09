const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, REPO_ROOT } = require('./helpers');

// setImmediate runs after the microtask queue is drained, so every
// fire-and-forget fetch chain inside app.js has settled by then.
const settle = () => new Promise(resolve => setImmediate(resolve));

const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };

// Display names a member can pick in Discord. Each one broke out of a JS string
// while inline handlers carried names; as data attributes they must arrive unchanged.
const QUOTE_NAME = "x');globalThis.pwned=1;('";
const AVATAR_NAME = "X'+(globalThis.pwned=1)+'";
const ENTITY_NAME = '&quot;});globalThis.pwned=1;//';
// Admin-set texts: quotes, entities, backslash
const TRICKY_TEXT = 'Bob\'s "Raid" & <mehr> &#039; \\ ende';

const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>' };

/**
 * Decode an attribute value the way the browser does when it reads it.
 *
 * @param {string} value -> Raw attribute value from the HTML string.
 * @returns {string} -> Attribute value as the page sees it.
 */
function decodeAttribute(value) {
    return value.replace(/&(quot|amp|lt|gt|#0*39);/g, (match, name) => ENTITIES[name] || "'");
}

const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

/**
 * Elements in rendered HTML that carry `attribute`, with every attribute decoded.
 *
 * @param {string} html -> Rendered HTML.
 * @param {string} attribute -> e.g. "data-click".
 * @returns {Array<{ tag: string, attributes: Object<string, string> }>}
 */
function elementsWith(html, attribute) {
    const found = [];
    for (const tag of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
        const attributes = {};
        for (const attr of tag[2].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
            attributes[attr[1]] = decodeAttribute(attr[2] ?? attr[3]);
        }
        if (attribute in attributes) found.push({ tag: tag[1].toLowerCase(), attributes });
    }
    return found;
}

/**
 * Elements whose data-click/change/input names `action`; at least one must exist.
 */
function actionTargets(html, action, type = 'click') {
    const targets = elementsWith(html, `data-${type}`).filter(element => element.attributes[`data-${type}`] === action);
    assert.ok(targets.length > 0, `no element with data-${type}="${action}"`);
    return targets;
}

/**
 * Element double for app.runAction(): dataset from the data-* attributes.
 */
function actionElement({ tag, attributes }, extra = {}) {
    const dataset = {};
    for (const [name, value] of Object.entries(attributes)) {
        if (name.startsWith('data-')) dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = value;
    }
    return { tagName: tag.toUpperCase(), dataset, value: attributes.value, getAttribute: (name) => attributes[name] ?? null, ...extra };
}

function assertNoInlineHandlers(html) {
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i);
}

/**
 * Routes for one open event with the given participants and comments.
 *
 * @param {Object} data -> `{ participants, comments }`.
 * @returns {Object} -> Routes for loadFrontendApp().
 */
function eventRoutes({ participants = [], comments = [] }) {
    return {
        '/api/events/ev': { id: 'ev', title: 'Spieleabend', accessMode: 'open', maxParticipants: 0, currentParticipants: participants.length, formFields: [] },
        '/api/events/ev/my-registration': { registered: false },
        '/api/events/ev/participants': { participants, total: participants.length },
        '/api/events/ev/comments': comments
    };
}

const adminEvent = (id, fields = {}) => ({
    id, title: TRICKY_TEXT, description: '', status: 'active', accessMode: 'open', approvalMode: 'instant',
    startDate: '2026-10-20T18:00:00.000Z', createdAt: '2026-10-01T18:00:00.000Z', maxParticipants: 0, currentParticipants: 0, formFields: [], ...fields
});

test('replying sends the next comment once as a reply, the one after as a normal comment', async () => {
    const comment = { id: 'c1', userId: 'u-x', userName: QUOTE_NAME, text: 'Hallo', createdAt: '2026-10-01T18:00:00.000Z' };
    const { app, state, element, requests } = await loadFrontendApp(eventRoutes({ comments: [comment] }));
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();
    const html = element('comments-section').innerHTML;
    assertNoInlineHandlers(html);

    const [reply] = actionTargets(html, 'replyToComment');
    assert.equal(reply.attributes['data-user-name'], QUOTE_NAME);
    await app.runAction('replyToComment', actionElement(reply));
    assert.equal(element('comment-input').value, `@${QUOTE_NAME} `);

    const [send] = actionTargets(html, 'postComment');
    element('comment-input').value = 'Antwort';
    await app.runAction('postComment', actionElement(send));
    await settle();
    element('comment-input').value = 'Noch was';
    await app.runAction('postComment', actionElement(send));
    await settle();

    const posts = requests.filter(r => r.method === 'POST').map(r => JSON.parse(r.body));
    assert.deepEqual(posts, [{ text: 'Antwort', replyTo: 'c1' }, { text: 'Noch was', replyTo: null }]);
});

test('a participant avatar carries its initials fallback as data', async () => {
    const participant = { displayName: AVATAR_NAME, avatar: 'https://cdn.example/avatar.png' };
    const { app, state, element } = await loadFrontendApp(eventRoutes({ participants: [participant] }));
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();
    const html = element('detail-participants-avatars').innerHTML;
    assertNoInlineHandlers(html);
    const [img] = elementsWith(html, 'data-fallback');
    assert.deepEqual([img.attributes['data-fallback'], img.attributes['data-initials'], img.attributes.title], ['initials', 'X', AVATAR_NAME]);
});

test('guests are added and removed through actions with their exact data', async () => {
    const user = { id: '42', displayName: ENTITY_NAME, username: 'mal', avatar: 'https://cdn.example/a.png' };
    const { app, state, element } = await loadFrontendApp({ '/api/user/search?q=ma': [user] });
    element('guest-search-input').value = 'ma';
    await app.searchGuests();
    const results = element('guest-search-results').innerHTML;
    assertNoInlineHandlers(results);

    const [add] = actionTargets(results, 'addGuestToList');
    await app.runAction('addGuestToList', actionElement(add));
    assert.deepEqual({ ...state.selectedGuests[0] }, { id: '42', displayName: ENTITY_NAME, avatar: user.avatar });

    const selected = element('selected-guests').innerHTML;
    assertNoInlineHandlers(selected);
    const [remove] = actionTargets(selected, 'removeGuestFromList');
    await app.runAction('removeGuestFromList', actionElement(remove));
    assert.equal(state.selectedGuests.length, 0);
});

test('admin cards name every action with the event it belongs to', async () => {
    const { app, state, element, requests } = await loadFrontendApp({
        '/api/admin/all-events': [
            adminEvent('single'),
            adminEvent('s1', { seriesId: 'series', startDate: '2026-10-21T18:00:00.000Z' }),
            adminEvent('s2', { seriesId: 'series', startDate: '2026-10-28T18:00:00.000Z' })
        ],
        '/api/admin/events/single/registrations': { data: [], slots: [] }
    });
    state.currentUser = { ...MEMBER, isAdmin: true };
    await app.loadAdminEvents();
    const html = element('admin-events-grid').innerHTML;
    assertNoInlineHandlers(html);
    for (const target of elementsWith(html, 'data-click')) {
        const { attributes } = target;
        assert.ok(['single', 's1', 's2'].includes(attributes['data-event-id']) || attributes['data-series-id'] === 'series',
            `${attributes['data-click']} without its event`);
    }
    const open = actionTargets(html, 'showRegistrations').find(t => t.attributes['data-event-id'] === 'single');
    await app.runAction('showRegistrations', actionElement(open));
    assert.equal(element('reg-event-title').textContent, TRICKY_TEXT);
    assert.ok(requests.some(r => r.url === '/api/admin/events/single/registrations'));
});

test('accepting a registration sends the status and reloads with the exact title', async () => {
    const reg = { id: 'r1', userId: 'u-x', userName: 'Mia', status: 'pending', source: 'web', createdAt: '2026-10-01T18:00:00.000Z' };
    const { app, state, element, requests } = await loadFrontendApp({
        '/api/admin/events/ev/registrations': { data: [reg], slots: [] },
        '/api/admin/registrations/r1/status': { success: true }
    });
    state.currentUser = { ...MEMBER, isAdmin: true };
    await app.showRegistrations('ev', TRICKY_TEXT);
    const html = element('registrations-tbody').innerHTML;
    assertNoInlineHandlers(html);
    const accept = actionTargets(html, 'updateRegStatus').find(t => t.attributes['data-status'] === 'accepted');
    assert.equal(accept.attributes['data-event-title'], TRICKY_TEXT);
    element('reg-event-title').textContent = '';
    await app.runAction('updateRegStatus', actionElement(accept));
    const put = requests.find(r => r.method === 'PUT');
    assert.deepEqual([put.url, JSON.parse(put.body)], ['/api/admin/registrations/r1/status', { status: 'accepted' }]);
    assert.equal(element('reg-event-title').textContent, TRICKY_TEXT);
});

test('the overview opens events and filters categories through actions', async () => {
    const solo = adminEvent('solo', { title: 'Solo' });
    const series = adminEvent('s1', { title: 'Serie', seriesId: 'series-1', seriesDates: [{ id: 's1', startDate: '2026-10-20T18:00:00.000Z' }, { id: 's2', startDate: '2026-10-27T18:00:00.000Z' }] });
    const { app, state, element, location, requests } = await loadFrontendApp({
        '/api/events/categories': [TRICKY_TEXT],
        '/api/events': { data: [solo, series], meta: { total: 2, page: 1, limit: 20, totalPages: 1 } }
    });
    state.currentUser = MEMBER;
    await app.showEventsSection();
    const grid = element('events-grid').innerHTML;
    const bar = element('category-filter-bar').innerHTML;
    assertNoInlineHandlers(grid);
    assertNoInlineHandlers(bar);

    const card = actionTargets(grid, 'navigateTo').find(target => target.attributes['data-route'] === 'event/solo');
    await app.runAction('navigateTo', actionElement(card));
    assert.equal(location.hash, '#event/solo');
    const routes = actionTargets(grid, 'navigateTo').map(target => target.attributes['data-route']);
    assert.ok(routes.includes('event/s2'), 'series dates open their event');

    const pill = actionTargets(bar, 'filterByCategory').find(target => target.attributes['data-category'] === TRICKY_TEXT);
    await app.runAction('filterByCategory', actionElement(pill));
    await settle();   // filterByCategory starts showEventsSection without awaiting it
    assert.ok(requests.some(r => r.url.includes(`category=${encodeURIComponent(TRICKY_TEXT)}`)), 'filters by the exact category');
});

test('the calendar arrows move one month in each direction', async () => {
    const { app, state, element } = await loadFrontendApp({
        '/api/events/categories': [],
        '/api/events': { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } }
    });
    state.currentUser = MEMBER;
    const [calendarButton] = elementsWith(INDEX_HTML, 'data-click').filter(e => e.attributes['data-view'] === 'calendar');
    await app.runAction('switchView', actionElement(calendarButton));
    const month = () => element('events-calendar').innerHTML.match(/<h4>([^<]*)<\/h4>/)[1];
    const start = month();
    const back = actionTargets(element('events-calendar').innerHTML, 'shiftCalendarMonth').find(t => t.attributes['data-delta'] === '-1');
    await app.runAction('shiftCalendarMonth', actionElement(back));
    assert.notEqual(month(), start);
    assert.doesNotMatch(month(), /undefined/);
    const forward = actionTargets(element('events-calendar').innerHTML, 'shiftCalendarMonth').find(t => t.attributes['data-delta'] === '1');
    await app.runAction('shiftCalendarMonth', actionElement(forward));
    assert.equal(month(), start);
});

test('a location suggestion fills the exact channel', async () => {
    const channel = { id: '7', name: TRICKY_TEXT, type: 'voice' };
    const { app, element } = await loadFrontendApp({ '/api/admin/channels': [channel] });
    element('event-location-text').value = 'bob';
    await app.handleLocationInput();
    const html = element('location-suggestions').innerHTML;
    assertNoInlineHandlers(html);
    const [suggestion] = actionTargets(html, 'selectLocationChannel');
    await app.runAction('selectLocationChannel', actionElement(suggestion));
    assert.deepEqual(
        [element('event-location-text').value, element('event-location-channel-id').value, element('event-location-channel-type').value],
        [`#${TRICKY_TEXT}`, '7', 'voice']
    );
});

test('a wizard step dot jumps to its step as a number', async () => {
    const { app, element } = await loadFrontendApp({});
    const dot = actionTargets(INDEX_HTML, 'wizardGoTo').find(t => t.attributes['data-step'] === '3');
    await app.runAction('wizardGoTo', actionElement(dot));
    assert.equal(element('wizard-step-counter').textContent, 'Schritt 3 von 5');
    assert.equal(element('wstep-3').classList.contains('active'), true);
    assert.equal(element('wstep-2').classList.contains('completed'), true);
});

test('the poll admin bar names its actions literally and passes the poll id', async () => {
    const { app, state, element } = await loadFrontendApp({});
    state.currentUser = { ...MEMBER, isAdmin: true };
    // The bar lives inside the poll page; rendering that container registers its id
    element('poll-detail').innerHTML = '<div id="poll-admin-bar"></div>';
    app.renderPollAdminBar({ id: "p'1", status: 'open' });
    const html = element('poll-admin-bar').innerHTML;
    assertNoInlineHandlers(html);
    const names = elementsWith(html, 'data-click').map(e => [e.attributes['data-click'], e.attributes['data-poll-id']]);
    assert.deepEqual(names, [
        ['showPollAnnounceDialog', "p'1"], ['showPollEditor', "p'1"], ['closePollFromUi', "p'1"],
        ['showPollDecideDialog', "p'1"], ['deletePollFromUi', "p'1"]
    ]);
});

test('a vote click sends the answer for that date', async () => {
    const { app, state, requests } = await loadFrontendApp({ '/api/polls/p1/vote': { error: 'nur geprüft' } });
    state.currentUser = MEMBER;
    state.currentPoll = { id: 'p1' };
    await app.runAction('setPollVote', { tagName: 'BUTTON', dataset: { optionId: 'raid-a', state: 'yes' }, getAttribute: () => null });
    const vote = requests.find(r => r.method === 'PUT');
    assert.ok(vote, 'the vote is sent');
    assert.deepEqual([vote.url, JSON.parse(vote.body)], ['/api/polls/p1/vote', { optionId: 'raid-a', state: 'yes' }]);
});
