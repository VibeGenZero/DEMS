const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, frontendSources, REPO_ROOT } = require('./helpers');

// Every place that shows a person (or the bot) renders it with avatar() from
// core/components.js, so a missing or broken image always becomes initials (D-09)

// setImmediate runs after the microtask queue is drained, so every
// fire-and-forget fetch chain inside the modules has settled by then.
const settle = () => new Promise(resolve => setImmediate(resolve));

const IMAGE = 'https://cdn.example/a.png';
const MEMBER = { id: 'u-member', username: 'lena', displayName: 'Lena Raid', avatar: IMAGE, roles: [], isAdmin: false };

// The render functions are pure, so one load serves the markup tests
const frontend = loadFrontendApp({});

test('the navbar shows the own avatar, or initials without an image', async () => {
    const { app, state, element } = await loadFrontendApp({});
    state.currentUser = MEMBER;
    app.showLoggedIn();
    assert.equal(element('user-avatar').innerHTML, app.avatar({ url: IMAGE, name: 'Lena Raid' }));

    state.currentUser = { ...MEMBER, avatar: '' };
    app.showLoggedIn();
    assert.equal(element('user-avatar').innerHTML, '<span class="avatar avatar-initials" title="Lena Raid">LR</span>');

    app.showLoggedOut();
    assert.equal(element('user-avatar').innerHTML, '');
});

test('the bot control shows the bot as a large avatar with the initials of its name', async () => {
    const online = { online: true, username: 'DEMS Bot#0001', avatarUrl: IMAGE, uptime: 60, ping: 42 };
    const { app, element } = await loadFrontendApp({ '/api/admin/bot/status': online });
    await app.loadBotStatus();
    const html = element('bot-status-panel').innerHTML;
    assert.ok(html.includes(app.avatar({ url: IMAGE, name: 'DEMS Bot#0001', size: 'lg' })), html);
    assert.doesNotMatch(html, /alt="Bot Avatar"|bi-robot/);

    // Before the bot logged in there is neither a name nor an image
    const offline = await loadFrontendApp({ '/api/admin/bot/status': { online: false, username: null, avatarUrl: null } });
    await offline.app.loadBotStatus();
    assert.ok(offline.element('bot-status-panel').innerHTML.includes('<span class="avatar avatar-lg avatar-initials" title="Bot">B</span>'));
});

test('a comment shows its author as a small avatar, with initials when the image is missing', async () => {
    const { app } = await frontend;
    const comment = { id: 'c1', userId: 'u-x', userName: 'Tom Sommer', userAvatar: IMAGE, text: 'Hallo', createdAt: '2026-10-01T18:00:00.000Z' };
    assert.ok(app.renderComment(comment, 'ev', true).includes(app.avatar({ url: IMAGE, name: 'Tom Sommer', size: 'sm' })));
    assert.ok(app.renderComment({ ...comment, userAvatar: '' }, 'ev', true).includes('<span class="avatar avatar-sm avatar-initials" title="Tom Sommer">TS</span>'));
});

test('participants are avatars, the ones beyond twenty a "+N" tile', async () => {
    const participants = [{ displayName: 'Mara Klein', avatar: IMAGE }, { displayName: 'Tom', avatar: '' }];
    const { app, state, element } = await loadFrontendApp({
        '/api/events/ev': { id: 'ev', title: 'Spieleabend', accessMode: 'open', maxParticipants: 0, currentParticipants: 25, formFields: [] },
        '/api/events/ev/my-registration': { registered: false },
        '/api/events/ev/participants': { participants, total: 25 },
        '/api/events/ev/comments': []
    });
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();
    assert.equal(
        element('detail-participants-avatars').innerHTML,
        app.avatar({ url: IMAGE, name: 'Mara Klein' }) + '<span class="avatar avatar-initials" title="Tom">T</span><span class="avatar avatar-more">+5</span>'
    );
});

test('line-up, waitlist and poll votes show small avatars', async () => {
    const { app } = await frontend;
    const mara = { displayName: 'Mara Klein', avatar: IMAGE };
    assert.equal(app.renderRosterAvatar(mara), app.avatar({ url: IMAGE, name: 'Mara Klein', size: 'sm' }));
    assert.equal(app.renderRosterAvatar({ displayName: 'Mara Klein' }), '<span class="avatar avatar-sm avatar-initials" title="Mara Klein">MK</span>');

    const poll = {
        id: 'p1', status: 'open', isOpen: false, canVote: false, myVote: { yes: [], maybe: [] },
        options: [{ id: 'o1', startDate: '2026-10-20T18:00:00.000Z' }],
        tally: { voterCount: 2, options: [] }
    };
    const row = app.renderPollOptionRow(poll, { optionId: 'o1', yes: 1, maybe: 1, yesVoters: [mara], maybeVoters: [{ displayName: 'Tom', avatar: '' }] });
    assert.ok(row.includes(`<div class="poll-voters">${app.avatar({ url: IMAGE, name: 'Mara Klein', size: 'sm' })}<span class="avatar avatar-sm avatar-initials" title="Tom">T</span></div>`), row);
});

test('the guest search and the chosen guests show small avatars', async () => {
    const mara = { id: '42', displayName: 'Mara Klein', username: 'mara', avatar: IMAGE };
    const tom = { id: '43', displayName: 'Tom', username: 'tom', avatar: '' };
    const { app, element } = await loadFrontendApp({ '/api/user/search?q=ma': [mara, tom] });
    element('guest-search-input').value = 'ma';
    await app.searchGuests();
    const results = element('guest-search-results').innerHTML;
    assert.ok(results.includes(app.avatar({ url: IMAGE, name: 'Mara Klein', size: 'sm' })), results);
    assert.ok(results.includes('<span class="avatar avatar-sm avatar-initials" title="Tom">T</span>'), results);

    app.addGuestToList(mara);
    app.addGuestToList(tom);
    const chosen = element('selected-guests').innerHTML;
    assert.ok(chosen.includes(app.avatar({ url: IMAGE, name: 'Mara Klein', size: 'sm' })), chosen);
    assert.ok(chosen.includes('<span class="avatar avatar-sm avatar-initials" title="Tom">T</span>'), chosen);
});

test('no page keeps its own avatar classes', () => {
    const OLD_CLASSES = /\b(?:comment-avatar|bot-avatar(?:-placeholder)?|participant-avatar(?:-placeholder)?|participants-overflow-badge|roster-avatar(?:-fallback)?)\b/;
    const sources = [
        ['index.html', fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8')],
        ['style.css', fs.readFileSync(path.join(REPO_ROOT, 'public', 'css', 'style.css'), 'utf8')],
        ...frontendSources().map(({ file, source }) => [file, source])
    ];
    for (const [file, source] of sources) assert.doesNotMatch(source, OLD_CLASSES, file);
});
