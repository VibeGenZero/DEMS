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
