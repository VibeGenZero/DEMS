const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareSnapshots, formatReport } = require('../scripts/style-snapshot');

const el = (label, styles) => ({ label, styles });

test('unchanged snapshots have no differences', () => {
    const snapshot = { desktop: { 'body>div:1': el('div.card', { color: 'rgb(1, 2, 3)' }) } };
    assert.deepEqual(compareSnapshots(snapshot, snapshot), { changes: [], removed: [], added: [] });
});

test('changed values are grouped by property and value pair, most frequent first', () => {
    const before = { desktop: {
        a: el('p.text-muted', { color: 'rgb(113, 113, 122)', 'font-size': '14px' }),
        b: el('small.text-muted', { color: 'rgb(113, 113, 122)', 'font-size': '12.8px' })
    } };
    const after = { desktop: {
        a: el('p.text-muted', { color: 'rgb(143, 143, 154)', 'font-size': '14px' }),
        b: el('small.text-muted', { color: 'rgb(143, 143, 154)', 'font-size': '14px' })
    } };
    assert.deepEqual(compareSnapshots(before, after).changes, [
        { viewport: 'desktop', property: 'color', before: 'rgb(113, 113, 122)', after: 'rgb(143, 143, 154)', count: 2, samples: ['p.text-muted', 'small.text-muted'] },
        { viewport: 'desktop', property: 'font-size', before: '12.8px', after: '14px', count: 1, samples: ['small.text-muted'] }
    ]);
});

test('a group keeps at most five different sample labels', () => {
    const many = (color) => ({ desktop: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, el(`span.s${i % 7}`, { color })])) });
    const [change] = compareSnapshots(many('a'), many('b')).changes;
    assert.equal(change.count, 8);
    assert.deepEqual(change.samples, ['span.s0', 'span.s1', 'span.s2', 'span.s3', 'span.s4']);
});

test('elements that appear or disappear are listed', () => {
    const result = compareSnapshots({ desktop: { a: el('div.old', {}) } }, { desktop: { b: el('div.new', {}) } });
    assert.deepEqual(result.removed, [{ viewport: 'desktop', label: 'div.old' }]);
    assert.deepEqual(result.added, [{ viewport: 'desktop', label: 'div.new' }]);
});

test('the report names every change in one line and counts the rest', () => {
    const report = formatReport({
        changes: [{ viewport: 'mobile', property: 'color', before: 'a', after: 'b', count: 3, samples: ['p.x', 'p.y'] }],
        removed: [{ viewport: 'mobile', label: 'div.old' }],
        added: []
    });
    assert.match(report, /mobile\s+color: a -> b\s+3×\s+p\.x, p\.y/);
    assert.match(report, /1 change group\(s\), 1 removed, 0 added/);
    assert.match(report, /removed: mobile div\.old/);
});
