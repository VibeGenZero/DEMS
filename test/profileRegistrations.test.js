const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

const MEMBER = { id: 'u-member', username: 'member', displayName: 'Member', avatar: '', roles: [], isAdmin: false };
const ADMIN = { ...MEMBER, id: 'u-admin', username: 'admin', isAdmin: true };

const PROFILE = {
    stats: { total: 2, accepted: 2, pending: 0, rejected: 0, waitlisted: 0, checkedIn: 0 },
    badges: [],
    unlockedBadges: 0,
    totalBadges: 0,
    registrations: [
        { id: 'r1', status: 'accepted', createdAt: '2026-10-01T18:00:00.000Z', event: { id: 'game-night', title: 'Spieleabend', status: 'active' } },
        { id: 'r2', status: 'accepted', createdAt: '2026-09-01T18:00:00.000Z', event: { id: 'old-raid', title: 'Alter Raid', status: 'archived' } }
    ]
};

/**
 * Render the profile for a user and return the HTML of one registration card.
 *
 * @param {Object} user -> Session user.
 * @param {string} title -> Event title on the card.
 * @returns {Promise<Object>} -> `{ card, toasts }`.
 */
async function renderCard(user, title) {
    const { app, element, toasts, state } = await loadFrontendApp({ '/api/user/profile': PROFILE });
    state.currentUser = user;
    await app.showProfileSection();
    const cards = element('profile-registrations').innerHTML.split('class="profile-reg-card').slice(1);
    return { card: cards.find(html => html.includes(title)), toasts };
}

test('a profile card links to an event the member can open', async () => {
    const { card, toasts } = await renderCard(MEMBER, 'Spieleabend');
    assert.match(card, /data-click="navigateTo" data-route="event\/game-night"/);
    assert.doesNotMatch(card, /profile-reg-card-static/);
    assert.deepEqual(toasts, []);
});

test('a profile card of an archived event stays but does not link for members', async () => {
    const { card, toasts } = await renderCard(MEMBER, 'Alter Raid');
    assert.doesNotMatch(card, /navigateTo/);
    assert.match(card, /profile-reg-card-static/);
    assert.deepEqual(toasts, []);
});

test('admins can still open an archived event from their profile', async () => {
    const { card } = await renderCard(ADMIN, 'Alter Raid');
    assert.match(card, /data-click="navigateTo" data-route="event\/old-raid"/);
});
