const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendApp, loadFrontendModules, REPO_ROOT } = require('./helpers');
const { readCss, parseRules } = require('./cssSource');

const EVENTS_DIR = path.join(REPO_ROOT, 'public', 'js', 'events');

async function loadFlight() {
    const modules = await loadFrontendModules(path.join(EVENTS_DIR, 'card-flight.js'), vm.createContext({}));
    return modules.get('card-flight.js');
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('a card flies to the middle of the window', async () => {
    const { centerRect } = await loadFlight();
    assert.deepEqual(plain(centerRect({ left: 40, top: 500, width: 400, height: 300 }, { width: 1440, height: 900 })),
        { left: 520, top: 300, width: 400, height: 300 });
});

test('the open card fills the whole window', async () => {
    const { fullRect } = await loadFlight();
    assert.deepEqual(plain(fullRect({ width: 1440, height: 900 })), { left: 0, top: 0, width: 1440, height: 900 });
});

test('the flight times are the ones chosen in the prototype', async () => {
    const flight = await loadFlight();
    assert.deepEqual(plain(flight.FLIGHT_OPEN), { dim: 0.4, recede: 0.6, lift: 0.5, growAt: 0.42, grow: 0.55, faceOut: 0.18, contentIn: 0.35 });
    assert.deepEqual(plain(flight.FLIGHT_CLOSE), { contentOut: 0.15, faceInAt: 0.3, faceIn: 0.2, shrinkAt: 0.05, shrink: 0.45, homeOverlap: 0.06, home: 0.55, recede: 0.55, dim: 0.45 });
    assert.equal(flight.LIFT_SCALE, 1.06);
    assert.equal(flight.RECEDE_SCALE, 0.95);
});

test('the banner grows to the height of the event page banner', async () => {
    const { DETAIL_BANNER_HEIGHT } = await loadFlight();
    const header = parseRules(readCss('style.css')).find(rule => rule.selector === '.event-detail-banner-header' && rule.context === '');
    const height = header.declarations.find(entry => entry.property === 'height').value;
    assert.equal(height, `${DETAIL_BANNER_HEIGHT}px`);
});

test('only a plain left click flies', async () => {
    const { isPlainClick } = await loadFlight();
    assert.equal(isPlainClick({ button: 0 }), true);
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        assert.equal(isPlainClick({ button: 0, ...extra }), false, JSON.stringify(extra));
    }
});

test('with reduced motion a card opens its page directly', async () => {
    const { app, animations, location } = await loadFrontendApp({}, { reducedMotion: true });
    const card = { dataset: { eventId: 'dev-1' }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }) };
    await app.openEventCard(card, { button: 0 });
    assert.equal(location.hash, '#event/dev-1');
    assert.equal(animations.some(entry => entry.method.startsWith('timeline.')), false);
    assert.equal(app.state.flyingEventId, null);
});

test('the overview card carries the flight action and its event id', async () => {
    const modules = await loadFrontendModules(path.join(EVENTS_DIR, 'cards.js'), vm.createContext({ URL }));
    const html = modules.get('cards.js').renderEventCard({ id: 'e1', title: 'Raid', startDate: '2026-10-20T19:00:00.000Z' }, new Date('2026-10-17T12:00:00.000Z'));
    assert.match(html, /<a class="glass-card event-card"[^>]* data-click="openEventCard"/);
    assert.match(html, /data-event-id="e1"/);
    assert.match(html, /href="#event\/e1"/);
});
