const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };
const CALENDAR_URL = '/api/events?limit=500';

// Days of the month shown first, so the test never depends on the date it runs
const today = new Date();
const inThisMonth = (day, hour = 19) => new Date(today.getFullYear(), today.getMonth(), day, hour).toISOString();

test('the calendar loads every event once and shows each series date', async () => {
    const events = [
        { id: 'past', title: 'Retro-Abend', startDate: inThisMonth(3) },
        { id: 's1', title: 'Training', seriesId: 'series', startDate: inThisMonth(15), seriesDates: [{ id: 's1', startDate: inThisMonth(15) }, { id: 's2', startDate: inThisMonth(22) }] }
    ];
    const { app, state, element, requests } = await loadFrontendApp({ [CALENDAR_URL]: { data: events, meta: {} } });
    state.currentUser = MEMBER;

    await app.showCalendar();
    const html = element('events-calendar').innerHTML;
    for (const route of ['event/past', 'event/s1', 'event/s2']) assert.ok(html.includes(`data-route="${route}"`), route);

    await app.showCalendar();
    assert.equal(requests.filter(request => request.url === CALENDAR_URL).length, 1, 'loaded once');
    app.forgetCalendarEvents();
    await app.showCalendar();
    assert.equal(requests.filter(request => request.url === CALENDAR_URL).length, 2, 'loaded again after forgetting');
});

test('the calendar follows search and category, without the empty state of the cards', async () => {
    const events = [
        { id: 'raid', title: 'Raid-Abend', category: 'Raid', startDate: inThisMonth(12) },
        { id: 'games', title: 'Spieleabend', category: 'Gaming', startDate: inThisMonth(14) }
    ];
    const { app, state, element } = await loadFrontendApp({
        '/api/events?upcoming=1&limit=100': { data: events, meta: {} },
        [CALENDAR_URL]: { data: events, meta: {} }
    });
    state.currentUser = MEMBER;
    await app.showEventsSection();
    await app.runAction('switchView', { dataset: { view: 'calendar' } });
    const routes = () => [...element('events-calendar').innerHTML.matchAll(/data-route="event\/([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(routes(), ['raid', 'games']);

    await app.runAction('filterByCategory', { dataset: { category: 'Raid' } });
    assert.deepEqual(routes(), ['raid'], 'category');

    await app.runAction('filterByCategory', { dataset: { category: '' } });
    element('events-search').value = 'spiele';
    await app.runAction('searchEvents', element('events-search'));
    assert.deepEqual(routes(), ['games'], 'search');

    element('events-search').value = 'nichts';
    await app.runAction('searchEvents', element('events-search'));
    assert.deepEqual(routes(), []);
    assert.notEqual(element('events-empty').style.display, 'block', 'no "Keine Treffer" under the calendar');

    // Back to the cards: the empty state of the filter shows there
    await app.runAction('switchView', { dataset: { view: 'grid' } });
    assert.equal(element('events-empty').style.display, 'block');
    assert.match(element('events-empty').innerHTML, /Keine Treffer/);
});

test('a day with many events shows three and how many more', async () => {
    const events = [1, 2, 3, 4, 5].map(n => ({ id: `e${n}`, title: `Event ${n}`, startDate: inThisMonth(10, 10 + n) }));
    const { app, state, element } = await loadFrontendApp({ [CALENDAR_URL]: { data: events, meta: {} } });
    state.currentUser = MEMBER;
    await app.showCalendar();
    const html = element('events-calendar').innerHTML;
    assert.equal((html.match(/data-click="navigateTo"/g) || []).length, 3);
    assert.match(html, /<div class="calendar-day-event calendar-day-more">\+2 mehr<\/div>/);
    assert.doesNotMatch(html, /style="/);
});
