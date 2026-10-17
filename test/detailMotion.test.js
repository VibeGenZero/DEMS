const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

const EVENT = {
    id: 'e1', title: 'Spieleabend', status: 'active', accessMode: 'open', approvalMode: 'instant',
    startDate: '2099-01-01T19:00:00.000Z', maxParticipants: 20, currentParticipants: 5,
    places: { taken: 5, capacity: 20, text: '5 von 20 Plätzen belegt' }, formFields: []
};

function routes(registration) {
    return {
        '/api/events/e1': EVENT,
        '/api/events/e1/my-registration': registration,
        '/api/events/e1/participants': { participants: [] },
        '/api/events/e1/comments': []
    };
}

const MOVEMENT = ['x', 'y', 'scale', 'xPercent', 'yPercent'];
const moves = (vars = {}) => MOVEMENT.some(key => key in vars);

test('a registration springs the status box, the button and the bar', async () => {
    const { app, animations, element, state } = await loadFrontendApp(routes({ registered: true, status: 'accepted', id: 'r1' }));
    state.currentUser = { id: 'u1', displayName: 'Tom', roles: [] };
    await app.showEventDetail('e1', { celebrate: 'registered', fromTaken: 4 });
    assert.ok(animations.some(entry => entry.targets === element('detail-registered') && entry.vars.ease === 'back.out(2)'), 'status box');
    assert.ok(animations.some(entry => entry.targets === '#sidebar-action-area .btn' && entry.vars.ease === 'back.out(2.2)'), 'sidebar button');
    assert.ok(animations.some(entry => entry.fromVars && entry.fromVars.value === 4), 'bar from the old places');
    assert.equal(animations.some(entry => entry.targets === '.col-lg-8'), false, 'no slide-in');
});

test('a page opened normally still slides in', async () => {
    const { app, animations, state } = await loadFrontendApp(routes({ registered: false }));
    state.currentUser = { id: 'u1', displayName: 'Tom', roles: [] };
    await app.showEventDetail('e1');
    assert.equal(animations.filter(entry => entry.targets === '.col-lg-8').length, 1);
    assert.ok(animations.some(entry => entry.fromVars && entry.fromVars.value === 0), 'sidebar bar grows from 0');
});

test('a check-in springs the check-in box', async () => {
    const { app, animations, element, state } = await loadFrontendApp(routes({ registered: true, status: 'accepted', id: 'r1' }));
    state.currentUser = { id: 'u1', displayName: 'Tom', roles: [] };
    await app.showEventDetail('e1', { celebrate: 'checkedin' });
    assert.ok(animations.some(entry => entry.targets === element('checkin-section') && entry.vars.ease === 'back.out(2)'));
    assert.equal(animations.some(entry => entry.targets === '.col-lg-8'), false);
});

test('with reduced motion the success moment only fades', async () => {
    const { app, animations, state } = await loadFrontendApp(routes({ registered: true, status: 'accepted', id: 'r1' }), { reducedMotion: true });
    state.currentUser = { id: 'u1', displayName: 'Tom', roles: [] };
    await app.showEventDetail('e1', { celebrate: 'registered', fromTaken: 4 });
    const tweens = animations.filter(entry => entry.method === 'to' || entry.method === 'fromTo');
    assert.ok(tweens.length > 0);
    assert.equal(tweens.some(entry => moves(entry.vars) || moves(entry.fromVars)), false);
    assert.equal(animations.some(entry => entry.fromVars && 'value' in entry.fromVars), false, 'the bar stands at once');
});
