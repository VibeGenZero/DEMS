const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

let app;
before(async () => { ({ app } = await loadFrontendApp({})); });

const entry = (n, fields = {}) => ({ title: `Titel ${n}`, content: `Text ${n}`, ...fields });
const titles = (entries) => Array.from(entries, e => e.title);

// ── Data ──────────────────────────────────────────────────────

test('the new format is read as it is', () => {
    const data = { version: '2.6.0', releases: [{ version: '2.6.0', date: '2026-10-03', news: [entry(1)] }, { version: '2.5.1', date: '2026-10-02', news: [entry(2)] }] };
    const result = app.normalizeReleases(data);
    assert.equal(result.version, '2.6.0');
    assert.deepEqual(Array.from(result.releases, r => r.version), ['2.6.0', '2.5.1']);
});

test('the old single-release format still works', () => {
    const result = app.normalizeReleases({ version: '9.9.9', date: '2026-10-01', news: [entry(1)] });
    assert.equal(result.version, '9.9.9');
    assert.equal(result.releases.length, 1);
    assert.deepEqual(titles(result.releases[0].news), ['Titel 1']);
    assert.deepEqual(Array.from(app.normalizeReleases({ version: '9.9.9', date: '2026-10-01', news: [] }).releases[0].news), []);
});

test('entries without title are dropped and broken data gives an empty list', () => {
    const result = app.normalizeReleases({ version: '1.0.0', releases: [{ version: '1.0.0', date: '2026-01-01', news: [entry(1), { title: '  ', content: 'x' }, null] }] });
    assert.deepEqual(titles(result.releases[0].news), ['Titel 1']);
    assert.deepEqual({ ...app.normalizeReleases(null), releases: [] }, { version: '', releases: [] });
});

// ── Popup choice ──────────────────────────────────────────────

test('marked highlights are shown in their order', () => {
    const news = [1, 2, 3, 4, 5, 6].map(n => entry(n, { highlight: n === 2 || n === 5 }));
    assert.deepEqual(titles(app.popupEntries({ news })), ['Titel 2', 'Titel 5']);
});

test('without marks the first three are shown, never more than three', () => {
    assert.deepEqual(titles(app.popupEntries({ news: [1, 2, 3, 4, 5].map(n => entry(n)) })), ['Titel 1', 'Titel 2', 'Titel 3']);
    const many = [1, 2, 3, 4, 5].map(n => entry(n, { highlight: true }));
    assert.equal(app.popupEntries({ news: many }).length, 3);
    assert.deepEqual(Array.from(app.popupEntries(null)), []);
});

// ── Markup ────────────────────────────────────────────────────

test('dates read in German', () => {
    assert.equal(app.formatReleaseDate('2026-10-03'), '03.10.2026');
    assert.equal(app.formatReleaseDate('kaputt'), '–');
    assert.equal(app.formatReleaseDate(''), '–');
});

test('the popup lists the chosen entries as text', () => {
    const html = app.renderNewsPopup([entry(1), entry(2, { content: '<b>fett</b>' })]);
    assert.equal(html.match(/class="news-entry"/g).length, 2);
    assert.match(html, /Titel 1/);
    assert.ok(html.includes('&lt;b&gt;fett&lt;/b&gt;'));
    assert.ok(!html.includes('<b>fett</b>'));
});

test('the page lists every release, the newest one open', () => {
    const html = app.renderReleaseList([
        { version: '2.6.0', date: '2026-10-03', news: [entry(1, { title: '🛡️ Rollen-Slots' })] },
        { version: '2.3.0', date: '2026-04-10', news: [entry(2), entry(3)] }
    ]);
    const blocks = html.split('<details').slice(1);
    assert.equal(blocks.length, 2);
    assert.match(blocks[0], /^ class="news-release" open>/);
    assert.match(blocks[1], /^ class="news-release">/);
    assert.match(blocks[0], /<summary[^>]*>[\s\S]*2\.6\.0[\s\S]*03\.10\.2026[\s\S]*<\/summary>/);
    assert.match(blocks[0], /🛡️ Rollen-Slots/);
    assert.equal(blocks[1].match(/class="news-entry"/g).length, 2);
});

test('an empty list says so', () => {
    assert.match(app.renderReleaseList([]), /Noch keine Neuigkeiten/);
});
