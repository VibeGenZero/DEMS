const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

// B-15: an offered waitlist place on the event page, in the profile, in the
// admin registrations dialog, and the bot center settings for it.

const settle = () => new Promise(resolve => setImmediate(resolve));
const HOUR = 60 * 60 * 1000;
const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };
const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };
const at = (offset) => new Date(Date.now() + offset).toISOString();
const OFFERED = { registered: true, id: 'r1', status: 'offered', offer: { offeredAt: at(-HOUR), expiresAt: at(6 * HOUR) } };

async function openPage(registration, routes = {}) {
    const loaded = await loadFrontendApp({
        '/api/events/ev': { id: 'ev', title: 'Koop-Abend', accessMode: 'open', maxParticipants: 5, currentParticipants: 5, formFields: [], startDate: at(48 * HOUR) },
        '/api/events/ev/my-registration': registration,
        '/api/events/ev/participants': { participants: [], total: 0 },
        '/api/events/ev/comments': [],
        ...routes
    });
    loaded.state.currentUser = MEMBER;
    loaded.state.csrfToken = 'test-token';
    await loaded.app.showEventDetail('ev');
    await settle();
    return loaded;
}

test('an offered place shows the offer card with the deadline instead of the registered area', async () => {
    const { element } = await openPage(OFFERED);
    assert.equal(isHidden(element('detail-offer')), false);
    assert.equal(isHidden(element('detail-registered')), true);
    assert.match(element('detail-offer-text').textContent, /^Bestätige ihn bis .+, sonst rückt der Nächste nach\.$/);
});

test('another status keeps the offer card hidden', async () => {
    const { element } = await openPage({ registered: true, id: 'r1', status: 'accepted' });
    assert.equal(isHidden(element('detail-offer')), true);
});

test('„Platz annehmen“ and „Doch nicht“ send the answer with the CSRF token and reload the page', async () => {
    for (const [answer, toast] of [['confirm', 'Du bist dabei!'], ['decline', 'Dein Platz geht an den Nächsten.']]) {
        const { app, requests, toasts } = await openPage(OFFERED, {
            [`/api/events/ev/offer/${answer}`]: answer === 'confirm' ? { success: true, status: 'accepted' } : { success: true }
        });
        const before = requests.filter(request => request.url === '/api/events/ev/my-registration').length;
        await app.answerWaitlistOffer(answer);
        await settle();
        const sent = requests.find(request => request.url === `/api/events/ev/offer/${answer}`);
        assert.equal(sent.method, 'POST');
        assert.equal(sent.headers['X-CSRF-TOKEN'], 'test-token');
        assert.equal(toasts.at(-1), toast);
        assert.ok(requests.filter(request => request.url === '/api/events/ev/my-registration').length > before, 'reloaded');
    }
});

test('a refused answer shows the server message', async () => {
    const { app, toasts } = await openPage(OFFERED);
    await app.answerWaitlistOffer('confirm');
    assert.equal(toasts.at(-1), 'Nicht gefunden');
});

test('the profile and the event cards name the offer', async () => {
    const { app } = await loadFrontendApp({});
    const event = { id: 'ev-1', title: 'Koop-Abend', startDate: at(48 * HOUR), endDate: at(50 * HOUR), status: 'active', location: '', checkinEnabled: false };
    const entry = { id: 'r1', status: 'offered', checkedIn: false, createdAt: at(-HOUR), slot: null, waitlistPosition: null, offerExpiresAt: at(6 * HOUR), event };
    assert.match(app.renderUpcomingRow(entry, new Date(), true), /chip-warning[^>]*><i class="bi bi-hourglass-split"><\/i>Platz angeboten · bis /);
    assert.match(app.renderStatusChip('offered'), /Platz angeboten/);
});

test('the admin dialog shows an offered registration with its deadline and the decisions', async () => {
    const harness = await loadFrontendApp({
        '/api/admin/events/ev1/registrations': {
            data: [{ id: 'o', userId: '1', userName: 'Elif', status: 'offered', offer: { expiresAt: at(6 * HOUR) }, source: 'web', createdAt: at(-2 * HOUR) }],
            slots: [],
            eventStatus: 'active'
        }
    });
    harness.state.currentUser = ADMIN;
    await harness.app.showRegistrations('ev1', 'Koop-Abend');
    const html = harness.element('registrations-tbody').innerHTML;
    assert.match(html, /Angeboten · bis /);
    assert.match(html, /data-status="accepted"/);
    assert.match(html, /data-status="rejected"/);
});

test('the bot center loads and saves the confirmation switch and period', async () => {
    const settings = { waitlistConfirmation: false, waitlistConfirmHours: 24 };
    const harness = await loadFrontendApp({ '/api/admin/bot/settings': settings, '/api/admin/channels': [] });
    harness.state.csrfToken = 'test-token';
    await harness.app.loadBotSettings();
    assert.equal(harness.element('bot-waitlist-confirmation').checked, false);
    assert.equal(harness.element('bot-waitlist-confirm-hours').value, '24');

    harness.element('bot-waitlist-confirmation').checked = true;
    harness.element('bot-waitlist-confirm-hours').value = '6';
    await harness.app.saveBotSettingsForm();
    const sent = harness.requests.filter(request => request.url === '/api/admin/bot/settings' && request.method === 'PUT').at(-1);
    const body = JSON.parse(sent.body);
    assert.deepEqual([body.waitlistConfirmation, body.waitlistConfirmHours], [true, 6]);
});
