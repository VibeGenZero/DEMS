const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadFrontendApp } = require('./helpers');

// setImmediate runs after the microtask queue is drained, so every
// fire-and-forget fetch chain inside app.js has settled by then.
const settle = () => new Promise(resolve => setImmediate(resolve));

const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };

// Display names a member can pick in Discord. Each one leaves a JS string
// inside an inline handler when the value is only HTML-escaped.
const QUOTE_NAME = "x');globalThis.pwned=1;('";
const AVATAR_NAME = "X'+(globalThis.pwned=1)+'";
const ENTITY_NAME = '&quot;});globalThis.pwned=1;//';
// Admin-set texts: quotes, entities, backslash
const TRICKY_TEXT = 'Bob\'s "Raid" & <mehr> &#039; \\ ende';

const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>' };

/**
 * Decode an attribute value the way the browser does before it runs the handler.
 *
 * @param {string} value -> Raw attribute value from the HTML string.
 * @returns {string} -> Handler source code.
 */
function decodeAttribute(value) {
    return value.replace(/&(quot|amp|lt|gt|#0*39);/g, (match, name) => ENTITIES[name] || "'");
}

/**
 * All values of one attribute in an HTML string, decoded.
 *
 * @param {string} html -> Rendered HTML.
 * @param {string} attribute -> e.g. "onclick".
 * @returns {string[]} -> Handler sources.
 */
function attributeValues(html, attribute) {
    return [...html.matchAll(new RegExp(`\\s${attribute}="([^"]*)"`, 'g'))].map(match => decodeAttribute(match[1]));
}

/**
 * Find the handler that calls `functionName` in the rendered HTML.
 *
 * @param {string} html -> Rendered HTML.
 * @param {string} functionName -> Called function.
 * @param {string} [attribute] -> Handler attribute.
 * @returns {string} -> Handler source.
 */
function handlerCalling(html, functionName, attribute = 'onclick') {
    const handler = attributeValues(html, attribute).find(code => code.includes(`${functionName}(`));
    assert.ok(handler, `no ${attribute} handler calls ${functionName}(`);
    return handler;
}

/**
 * Run handler source like the browser: as a function body with `this` bound to
 * the element. Every name in `stubs` records its calls.
 *
 * @param {string} code -> Handler source.
 * @param {Object} [options] -> `{ stubs: string[], element, globals }`.
 * @returns {Object} -> `{ calls: [name, args][], context }`.
 */
function runHandler(code, { stubs = [], element = {}, globals = {} } = {}) {
    const calls = [];
    const context = vm.createContext({ ...globals });
    for (const name of stubs) context[name] = (...args) => { calls.push([name, args]); };
    const handler = vm.compileFunction(code, ['event'], { parsingContext: context });
    handler.call(element, {});
    return { calls, context };
}

/**
 * Assert that the handler calls exactly `functionName(...args)` and nothing else.
 *
 * @param {string} code -> Handler source.
 * @param {string} functionName -> Expected call.
 * @param {Array} args -> Expected arguments.
 * @returns {void}
 */
function assertCallsOnly(code, functionName, args) {
    const { calls, context } = runHandler(code, { stubs: [functionName] });
    assert.equal(context.pwned, undefined, `injected code ran: ${code}`);
    // Objects built inside the vm context have another Object prototype; compare plain data
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[functionName, args]]);
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

test('the reply button passes a comment author name with quotes as plain text', async () => {
    const comment = { id: 'c1', userId: 'u-x', userName: QUOTE_NAME, text: 'Hallo', createdAt: '2026-10-01T18:00:00.000Z' };
    const { app, element, state } = await loadFrontendApp(eventRoutes({ comments: [comment] }));
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();

    const handler = handlerCalling(element('comments-section').innerHTML, 'replyToComment');
    assertCallsOnly(handler, 'replyToComment', ['ev', 'c1', QUOTE_NAME]);
});

test('a broken participant avatar falls back to initials without running the name', async () => {
    const participant = { displayName: AVATAR_NAME, avatar: 'https://cdn.example/avatar.png' };
    const { app, element, state } = await loadFrontendApp(eventRoutes({ participants: [participant] }));
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();

    const html = element('detail-participants-avatars').innerHTML;
    const [handler] = attributeValues(html, 'onerror');
    const [title] = attributeValues(html, 'title');
    const [initials] = attributeValues(html, 'data-initials');
    let replacement = null;
    const img = { title, dataset: { initials }, replaceWith(node) { replacement = node; } };
    const { context } = runHandler(handler, {
        element: img,
        globals: { document: { createElement: (tag) => ({ tag }) } }
    });

    assert.equal(context.pwned, undefined, `injected code ran: ${handler}`);
    assert.deepEqual(replacement, { tag: 'div', className: 'participant-avatar-placeholder', title: AVATAR_NAME, textContent: 'X' });
});

test('adding a guest from the search passes the member as data', async () => {
    const user = { id: '42', displayName: ENTITY_NAME, username: 'mal', avatar: 'https://cdn.example/a.png' };
    const { app, element } = await loadFrontendApp({ '/api/user/search?q=ma': [user] });
    element('guest-search-input').value = 'ma';
    await app.searchGuests();

    const handler = handlerCalling(element('guest-search-results').innerHTML, 'addGuestToList');
    assertCallsOnly(handler, 'addGuestToList', [{ id: '42', displayName: ENTITY_NAME, avatar: user.avatar }]);
});

test('removing a selected guest passes the id unchanged', async () => {
    const { app, element } = await loadFrontendApp({});
    app.addGuestToList({ id: "4'2", displayName: 'Gast', avatar: '' });

    const handler = handlerCalling(element('selected-guests').innerHTML, 'removeGuestFromList');
    assertCallsOnly(handler, 'removeGuestFromList', ["4'2"]);
});

test('admin event cards open the registrations with the exact title', async () => {
    const { app, element } = await loadFrontendApp({
        '/api/admin/all-events': [
            adminEvent('single'),
            adminEvent('s1', { seriesId: 'series', startDate: '2026-10-21T18:00:00.000Z' }),
            adminEvent('s2', { seriesId: 'series', startDate: '2026-10-28T18:00:00.000Z' })
        ]
    });
    await app.loadAdminEvents();

    const handlers = attributeValues(element('admin-events-grid').innerHTML, 'onclick')
        .filter(code => code.includes('showRegistrations('));
    assert.ok(handlers.length >= 3, `expected handlers for the single event and both series dates, got ${handlers.length}`);
    const ids = [];
    for (const handler of handlers) {
        const { calls, context } = runHandler(handler, { stubs: ['showRegistrations'] });
        assert.equal(context.pwned, undefined);
        assert.equal(calls.length, 1);
        assert.equal(calls[0][1][1], TRICKY_TEXT);
        ids.push(calls[0][1][0]);
    }
    assert.ok(['single', 's1', 's2'].every(id => ids.includes(id)), ids.join(','));
});

test('accepting and rejecting a registration keeps the exact event title', async () => {
    const reg = { id: 'r1', userId: 'u-x', userName: 'Mia', status: 'pending', source: 'web', createdAt: '2026-10-01T18:00:00.000Z' };
    const { app, element } = await loadFrontendApp({ '/api/admin/events/ev/registrations': { data: [reg], slots: [] } });
    await app.showRegistrations('ev', TRICKY_TEXT);

    const handlers = attributeValues(element('registrations-tbody').innerHTML, 'onclick')
        .filter(code => code.includes('updateRegStatus('));
    assert.equal(handlers.length, 2);
    assertCallsOnly(handlers[0], 'updateRegStatus', ['r1', 'accepted', 'ev', TRICKY_TEXT]);
    assertCallsOnly(handlers[1], 'updateRegStatus', ['r1', 'rejected', 'ev', TRICKY_TEXT]);
});

test('category pills filter by the exact category', async () => {
    const { app, element } = await loadFrontendApp({ '/api/events/categories': [TRICKY_TEXT] });
    await app.loadCategories();

    const handlers = attributeValues(element('category-filter-bar').innerHTML, 'onclick');
    assert.equal(handlers.length, 2);
    assertCallsOnly(handlers[0], 'filterByCategory', ['']);
    assertCallsOnly(handlers[1], 'filterByCategory', [TRICKY_TEXT]);
});

test('location suggestions select the exact channel', async () => {
    const channel = { id: '7', name: TRICKY_TEXT, type: 'voice' };
    const { app, element } = await loadFrontendApp({ '/api/admin/channels': [channel] });
    element('event-location-text').value = 'bob';
    await app.handleLocationInput();

    const handler = handlerCalling(element('location-suggestions').innerHTML, 'selectLocationChannel');
    assertCallsOnly(handler, 'selectLocationChannel', ['7', TRICKY_TEXT, 'voice']);
});
