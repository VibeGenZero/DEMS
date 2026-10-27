const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

// setImmediate runs after the microtask queue is drained, so every
// fire-and-forget fetch chain inside app.js has settled by then.
const settle = () => new Promise(resolve => setImmediate(resolve));

const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };

const GAME_NIGHT = {
    id: 'game-night', title: 'Spieleabend', accessMode: 'open',
    maxParticipants: 0, currentParticipants: 1, checkinEnabled: true, formFields: []
};
const RAID = {
    id: 'raid', title: 'Raid', accessMode: 'role-required', requiredRoles: ['role-raider'],
    maxParticipants: 0, currentParticipants: 0, formFields: []
};
const OPEN_EVENT = {
    id: 'open-event', title: 'Stammtisch', accessMode: 'open',
    maxParticipants: 0, currentParticipants: 0, formFields: []
};

const GAME_NIGHT_COMMENT = {
    id: 'c1', userId: 'u-alice', userName: 'Alice', text: 'Bringt Snacks mit', createdAt: '2026-10-01T18:00:00.000Z'
};

/**
 * Routes for the three events; game night shows Alice as participant and one comment.
 *
 * @param {Object} [overrides] -> URL → body or () => body.
 * @returns {Object} -> Routes for loadFrontendApp().
 */
function eventRoutes(overrides = {}) {
    return {
        '/api/events/game-night': GAME_NIGHT,
        '/api/events/game-night/my-registration': { registered: false },
        '/api/events/game-night/participants': { participants: [{ displayName: 'Alice', avatar: null }], total: 1 },
        '/api/events/game-night/comments': [GAME_NIGHT_COMMENT],
        '/api/events/raid': RAID,
        '/api/events/raid/my-registration': { registered: false },
        '/api/events/open-event': OPEN_EVENT,
        '/api/events/open-event/my-registration': { registered: false },
        '/api/events/open-event/participants': { participants: [], total: 0 },
        '/api/events/open-event/comments': [],
        ...overrides
    };
}

/**
 * Open an event page and wait until all of its requests have settled.
 *
 * @param {Object} app -> loadFrontendApp().app.
 * @param {string} eventId -> Event to open.
 * @returns {Promise<void>}
 */
async function openEvent(app, eventId) {
    await app.showEventDetail(eventId);
    await settle();
}

test('opening a role-locked event hides participants and comments of the previous event', async () => {
    const { app, element, toasts, state } = await loadFrontendApp(eventRoutes());
    state.currentUser = MEMBER;

    await openEvent(app, 'game-night');
    assert.equal(element('detail-participants-section').style.display, 'block');
    assert.match(element('comments-section').innerHTML, /Bringt Snacks mit/);

    await openEvent(app, 'raid');
    assert.equal(element('detail-no-access').style.display, 'block');
    assert.equal(element('detail-participants-section').style.display, 'none');
    assert.doesNotMatch(element('detail-participants-avatars').innerHTML, /Alice/);
    assert.equal(element('comments-section').style.display, 'none');
    assert.equal(element('comments-section').innerHTML, '');

    await openEvent(app, 'game-night');
    assert.equal(element('detail-participants-section').style.display, 'block');
    assert.notEqual(element('comments-section').style.display, 'none');
    assert.match(element('comments-section').innerHTML, /Bringt Snacks mit/);
    assert.deepEqual(toasts, []);
});

/**
 * A gate that holds route answers back until release() is called.
 *
 * @returns {Object} -> `{ late(body), release() }`: late wraps a body into a route answering after release.
 */
function createGate() {
    let release;
    const opened = new Promise(resolve => { release = resolve; });
    return { late: (body) => () => opened.then(() => body), release };
}

test('late answers for the previous event do not land on the current one', async () => {
    const gate = createGate();
    const { app, element, toasts, state } = await loadFrontendApp(eventRoutes({
        '/api/events/game-night/participants': gate.late({ participants: [{ displayName: 'Alice', avatar: null }], total: 1 }),
        '/api/events/game-night/comments': gate.late([GAME_NIGHT_COMMENT])
    }));
    state.currentUser = MEMBER;

    await openEvent(app, 'game-night');
    await openEvent(app, 'open-event');
    gate.release();
    await settle();

    assert.doesNotMatch(element('detail-participants-avatars').innerHTML, /Alice/);
    assert.doesNotMatch(element('comments-section').innerHTML, /Bringt Snacks mit/);
    assert.deepEqual(toasts, []);
});

test('a slow event answer does not replace the event opened after it', async () => {
    const gate = createGate();
    const { app, element, toasts, state } = await loadFrontendApp(eventRoutes({
        '/api/events/game-night': gate.late(GAME_NIGHT)
    }));
    state.currentUser = MEMBER;

    const slowOpen = app.showEventDetail('game-night');
    await openEvent(app, 'open-event');
    gate.release();
    await slowOpen;
    await settle();

    assert.equal(element('detail-title').textContent, 'Stammtisch');
    assert.doesNotMatch(element('comments-section').innerHTML, /Bringt Snacks mit/);
    assert.deepEqual(toasts, []);
});

test('the check-in box of a registered event does not stay on the next event', async () => {
    const { app, element, toasts, state } = await loadFrontendApp(eventRoutes({
        '/api/events/game-night/my-registration': { registered: true, status: 'accepted', checkedIn: false }
    }));
    state.currentUser = MEMBER;

    await openEvent(app, 'game-night');
    assert.match(element('checkin-section').innerHTML, /checkin-code-input/);
    assert.notEqual(element('checkin-section').style.display, 'none');

    await openEvent(app, 'open-event');
    assert.equal(element('checkin-section').style.display, 'none');
    assert.equal(element('checkin-section').innerHTML, '');

    await openEvent(app, 'game-night');
    assert.match(element('checkin-section').innerHTML, /checkin-code-input/);
    assert.notEqual(element('checkin-section').style.display, 'none');
    assert.deepEqual(toasts, []);
});

// ── Discussion thread row (B-14) ────────────────────────────────────────

const THREAD = { guildId: '111111111111111111', threadId: '222222222222222222' };

test('an event with a discussion thread links it in the sidebar; the next event without one hides the row', async () => {
    const { app, element, state } = await loadFrontendApp(eventRoutes({
        '/api/events/game-night': { ...GAME_NIGHT, discordThread: THREAD }
    }));
    state.currentUser = MEMBER;

    await openEvent(app, 'game-night');
    const row = element('sidebar-thread-row');
    assert.equal(row.style.display, 'flex');
    assert.ok(row.innerHTML.includes('<div class="sidebar-label">Diskussion</div>'), row.innerHTML);
    assert.ok(row.innerHTML.includes('<a href="https://discord.com/channels/111111111111111111/222222222222222222" target="_blank" rel="noopener">Im Discord-Thread mitreden</a>'), row.innerHTML);
    assert.ok(row.innerHTML.includes('bi-chat-dots'));

    await openEvent(app, 'open-event');
    assert.equal(element('sidebar-thread-row').style.display, 'none');
});

test('a thread with broken ids shows no row', async () => {
    for (const discordThread of [{ guildId: 'abc', threadId: '222222222222222222' }, { guildId: THREAD.guildId, threadId: '"><img src=x>' }, null, 'kaputt']) {
        const { app, element, state } = await loadFrontendApp(eventRoutes({
            '/api/events/open-event': { ...OPEN_EVENT, discordThread }
        }));
        state.currentUser = MEMBER;
        await openEvent(app, 'open-event');
        assert.equal(element('sidebar-thread-row').style.display, 'none', JSON.stringify(discordThread));
        assert.doesNotMatch(element('sidebar-thread-row').innerHTML, /<img/);
    }
});

test('the thread row starts hidden in the markup', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.ok(html.includes('<div id="sidebar-thread-row" class="sidebar-detail-row is-hidden"></div>'));
});
