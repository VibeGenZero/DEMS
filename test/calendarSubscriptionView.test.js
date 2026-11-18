/**
 * Calendar subscription in the fake DOM: the block „Kalender-Abo“ of the
 * profile settings loads the subscription, sets it up, renews and ends it.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, isHidden, REPO_ROOT } = require('./helpers');

const EMOJI = /\p{Extended_Pictographic}/u;
const FEED = {
    enabled: true,
    url: 'https://dems.example/calendar/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics',
    webcalUrl: 'webcal://dems.example/calendar/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics',
    googleUrl: 'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fdems.example%2Fcalendar%2FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics',
    createdAt: '2026-11-18T10:00:00.000Z'
};
const RENEWED = { ...FEED, url: FEED.url.replace(/A{43}/, 'B'.repeat(43)), webcalUrl: FEED.webcalUrl.replace(/A{43}/, 'B'.repeat(43)), googleUrl: FEED.googleUrl.replace(/A{43}/, 'B'.repeat(43)) };

/**
 * Profile code with a logged-in member; `/api/user/calendar` answers by method.
 *
 * @param {Object} answers -> `{ GET, POST, DELETE }` answers of the calendar endpoint.
 * @param {Object} [options] -> loadFrontendApp options, e.g. `{ confirm: false }`.
 */
async function openProfile(answers, options) {
    const frontend = await loadFrontendApp({
        '/api/user/calendar': (request) => answers[request.method || 'GET'] ?? httpAnswer(405, { error: 'Nicht erlaubt' })
    }, options);
    frontend.state.currentUser = { id: 'u-tom', username: 'tom', roles: [], isAdmin: false };
    frontend.state.csrfToken = 'test-token';
    return frontend;
}

const calendarRequests = (requests) => requests.filter(request => request.url === '/api/user/calendar');

test('without a subscription the block offers to set one up', async () => {
    const { app, element } = await openProfile({ GET: { enabled: false } });
    await app.loadCalendarSubscription();
    assert.equal(isHidden(element('calendar-feed-off')), false);
    assert.equal(isHidden(element('calendar-feed-on')), true);
});

test('with a subscription the block shows the link and the subscribe links', async () => {
    const { app, element } = await openProfile({ GET: FEED });
    await app.loadCalendarSubscription();
    assert.equal(isHidden(element('calendar-feed-off')), true);
    assert.equal(isHidden(element('calendar-feed-on')), false);
    assert.equal(element('calendar-feed-url').value, FEED.url);
    assert.equal(element('calendar-feed-google').getAttribute('href'), FEED.googleUrl);
    assert.equal(element('calendar-feed-webcal').getAttribute('href'), FEED.webcalUrl);
});

test('a failed load hides the block content and says nothing is set up', async () => {
    const { app, element } = await openProfile({ GET: httpAnswer(500, { error: 'Fehler beim Laden des Kalender-Abos' }) });
    await app.loadCalendarSubscription();
    assert.equal(isHidden(element('calendar-feed-on')), true);
    assert.equal(isHidden(element('calendar-feed-off')), false);
});

test('setting up sends the CSRF token and shows the new link', async () => {
    const { app, element, requests, toasts } = await openProfile({ GET: { enabled: false }, POST: FEED });
    await app.loadCalendarSubscription();
    await app.setUpCalendarSubscription();
    const post = calendarRequests(requests).find(request => request.method === 'POST');
    assert.equal(post.headers['X-CSRF-TOKEN'], 'test-token');
    assert.equal(element('calendar-feed-url').value, FEED.url);
    assert.equal(isHidden(element('calendar-feed-on')), false);
    assert.equal(toasts.at(-1), 'Kalender-Abo eingerichtet. Füge den Link in deiner Kalender-App hinzu.');
});

test('renewing asks first and then shows the new link', async () => {
    const { app, element, requests, dialogs, toasts } = await openProfile({ GET: FEED, POST: RENEWED });
    await app.loadCalendarSubscription();
    await app.renewCalendarSubscription();
    assert.equal(dialogs.length, 1);
    assert.match(dialogs[0].text, /alte Link funktioniert danach nicht mehr/);
    assert.equal(dialogs[0].label, 'Link erneuern');
    assert.equal(calendarRequests(requests).filter(request => request.method === 'POST').length, 1);
    assert.equal(element('calendar-feed-url').value, RENEWED.url);
    assert.equal(toasts.at(-1), 'Neuer Link erstellt. Verbinde deine Kalender-Apps neu.');
});

test('renewing or ending without confirming changes nothing', async () => {
    const { app, element, requests } = await openProfile({ GET: FEED, POST: RENEWED, DELETE: { enabled: false } }, { confirm: false });
    await app.loadCalendarSubscription();
    await app.renewCalendarSubscription();
    await app.endCalendarSubscription();
    assert.deepEqual(calendarRequests(requests).map(request => request.method), ['GET']);
    assert.equal(element('calendar-feed-url').value, FEED.url);
});

test('ending asks first and then offers a new setup', async () => {
    const { app, element, requests, dialogs, toasts } = await openProfile({ GET: FEED, DELETE: { enabled: false } });
    await app.loadCalendarSubscription();
    await app.endCalendarSubscription();
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].label, 'Abo beenden');
    assert.equal(dialogs[0].danger, true);
    const del = calendarRequests(requests).find(request => request.method === 'DELETE');
    assert.equal(del.headers['X-CSRF-TOKEN'], 'test-token');
    assert.equal(isHidden(element('calendar-feed-off')), false);
    assert.equal(isHidden(element('calendar-feed-on')), true);
    assert.equal(element('calendar-feed-url').value, '');
    assert.equal(toasts.at(-1), 'Kalender-Abo beendet. Der Link funktioniert nicht mehr.');
});

test('a failed change keeps the shown state and says so', async () => {
    const { app, element, toasts } = await openProfile({ GET: FEED, POST: httpAnswer(500, { error: 'Fehler beim Einrichten des Kalender-Abos' }) });
    await app.loadCalendarSubscription();
    await app.renewCalendarSubscription();
    assert.equal(element('calendar-feed-url').value, FEED.url);
    assert.equal(toasts.at(-1), 'Fehler beim Einrichten des Kalender-Abos');
});

test('copying without clipboard access asks to copy by hand', async () => {
    const { app, toasts } = await openProfile({ GET: FEED });
    await app.loadCalendarSubscription();
    await app.copyCalendarSubscriptionLink();
    assert.equal(toasts.at(-1), 'Kopieren ging nicht – bitte den Link markieren und kopieren.');
});

test('the block sits in the settings card above the account deletion, with German texts and no inline handlers', () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    const card = html.slice(html.indexOf('id="account-settings-card"'), html.indexOf('Account löschen'));
    const block = card.slice(card.indexOf('id="calendar-feed-block"'));
    assert.ok(card.includes('id="calendar-feed-block"'));
    assert.ok(card.indexOf('notify-waitlist-toggle') < card.indexOf('calendar-feed-block'), 'below the DM switches');
    for (const text of ['Kalender-Abo', 'Kalender-Abo einrichten', 'Kopieren', 'In Google Kalender öffnen', 'In Apple/Outlook abonnieren', 'Link erneuern', 'Abo beenden', 'Teile ihn nicht.']) {
        assert.ok(block.includes(text), text);
    }
    for (const action of ['setUpCalendarSubscription', 'copyCalendarSubscriptionLink', 'renewCalendarSubscription', 'endCalendarSubscription']) {
        assert.ok(block.includes(`data-click="${action}"`), action);
    }
    assert.match(block, /<div id="calendar-feed-on" class="is-hidden">/);
    assert.match(block, /<input[^>]*id="calendar-feed-url"[^>]*readonly/);
    assert.match(block, /<a[^>]*id="calendar-feed-google"[^>]*target="_blank"[^>]*rel="noopener"/);
    assert.doesNotMatch(block, /\son[a-z]+=/i);
    assert.doesNotMatch(block, EMOJI);
});
