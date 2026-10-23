const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

const NEWS = {
    version: '2.6.0',
    releases: [
        { version: '2.6.0', date: '2026-10-03', news: [{ title: 'Neu A', content: 'a', highlight: true }, { title: 'Neu B', content: 'b' }] },
        { version: '2.5.1', date: '2026-10-02', news: [{ title: 'Alt', content: 'c' }] }
    ]
};

async function open(storage = {}, data = NEWS) {
    const loaded = await loadFrontendApp({ '/api/updates': data }, { storage, reducedMotion: true });
    await loaded.app.loadUpdates();
    return loaded;
}
const popupOpened = (loaded) => loaded.element('updates-content').innerHTML.includes('news-entry');

test('loading sets the version badge and never opens the popup', async () => {
    const loaded = await open();
    assert.equal(loaded.element('info-version').textContent, 'v2.6.0');
    assert.equal(popupOpened(loaded), false);
});

test('after login an unseen version opens the popup once; closing marks it seen', async () => {
    const loaded = await open();
    await loaded.app.showNewsAfterLogin({ isNewUser: false });
    assert.equal(popupOpened(loaded), true);
    assert.match(loaded.element('updates-content').innerHTML, /Neu A/);
    assert.ok(!loaded.element('updates-content').innerHTML.includes('Neu B'), 'only the highlight');
    assert.equal(loaded.element('updates-version-badge').textContent, '2.6.0');
    assert.equal(loaded.localStorage.getItem('dems_last_seen_version'), null, 'not seen before it closes');

    loaded.element('updatesModal').dispatch('hidden.bs.modal');
    assert.equal(loaded.localStorage.getItem('dems_last_seen_version'), '2.6.0');

    loaded.element('updates-content').innerHTML = '';
    await loaded.app.showNewsAfterLogin({ isNewUser: false });
    assert.equal(popupOpened(loaded), false);
});

test('a seen version opens nothing', async () => {
    const loaded = await open({ dems_last_seen_version: '2.6.0' });
    await loaded.app.showNewsAfterLogin({ isNewUser: false });
    assert.equal(popupOpened(loaded), false);
});

test('a new member gets no popup and the version counts as seen', async () => {
    const loaded = await open();
    await loaded.app.showNewsAfterLogin({ isNewUser: true });
    assert.equal(popupOpened(loaded), false);
    assert.equal(loaded.localStorage.getItem('dems_last_seen_version'), '2.6.0');
});

test('a release without entries opens no popup', async () => {
    const loaded = await open({}, { version: '9.9.9', date: '2026-10-01', news: [] });
    await loaded.app.showNewsAfterLogin({ isNewUser: false });
    assert.equal(popupOpened(loaded), false);
});

test('the Info badge shows until the page was opened', async () => {
    const loaded = await open();
    assert.equal(isHidden(loaded.element('nav-info-badge')), false);
    await loaded.app.showNewsSection();
    assert.equal(loaded.element('news-section').style.display, 'block');
    assert.match(loaded.element('news-list').innerHTML, /2\.6\.0[\s\S]*2\.5\.1/);
    assert.equal(isHidden(loaded.element('nav-info-badge')), true);
    assert.equal(loaded.localStorage.getItem('dems_news_read_version'), '2.6.0');
});

test('the popup alone does not clear the badge', async () => {
    const loaded = await open();
    await loaded.app.showNewsAfterLogin({ isNewUser: false });
    loaded.element('updatesModal').dispatch('hidden.bs.modal');
    assert.equal(isHidden(loaded.element('nav-info-badge')), false);
});

test('a read version shows no badge', async () => {
    const loaded = await open({ dems_news_read_version: '2.6.0' });
    assert.equal(isHidden(loaded.element('nav-info-badge')), true);
});

test('a blocked storage breaks nothing and opens the popup only once per page', async () => {
    const loaded = await open('throws');
    await loaded.app.showNewsAfterLogin({ isNewUser: false });
    assert.equal(popupOpened(loaded), true);
    loaded.element('updatesModal').dispatch('hidden.bs.modal');
    loaded.element('updates-content').innerHTML = '';
    await loaded.app.showNewsAfterLogin({ isNewUser: false });
    assert.equal(popupOpened(loaded), false);
    await loaded.app.showNewsSection();
    assert.match(loaded.element('news-list').innerHTML, /2\.5\.1/);
});

test('"Alle Neuigkeiten" leads to the page', async () => {
    const loaded = await open();
    await loaded.app.showNewsAfterLogin({ isNewUser: false });
    loaded.app.openAllNews();
    assert.equal(loaded.location.hash, '#news');
});

test('#news is public: logged out it shows the page, not the login', async () => {
    const loaded = await loadFrontendApp({ '/api/updates': NEWS });
    loaded.state.currentUser = null;
    loaded.location.hash = '#news';
    await loaded.app.handleRoute();
    // showNewsSection runs without being awaited by the router
    await loaded.app.getNews();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(loaded.element('news-section').style.display, 'block');
    assert.notEqual(loaded.element('login-section').style.display, 'block');
    assert.match(loaded.element('news-list').innerHTML, /2\.5\.1/);
});
