const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeEqual } = require('../middleware/auth');
const { csvCell } = require('../utils/csv');
const { parseTemplate } = require('../utils/template');

test('passwords are compared without leaking their length or content through timing', () => {
    assert.equal(safeEqual('geheim', 'geheim'), true);
    assert.equal(safeEqual('geheim', 'geheiM'), false);
    assert.equal(safeEqual('geheim', 'geheim-und-länger'), false);
    assert.equal(safeEqual(undefined, 'geheim'), false);
    assert.equal(safeEqual('', ''), false, 'an empty secret never matches');
});

test('CSV cells that a spreadsheet would run as a formula are defused', () => {
    for (const formula of ['=HYPERLINK("http://evil.example")', '+49 170 1234', '-2+3', '@SUMME(A1)', '\t=1', '\r=1']) {
        assert.equal(csvCell(formula), `"'${formula.replace(/"/g, '""')}"`, JSON.stringify(formula));
    }
});

test('ordinary CSV cells are quoted and keep their content', () => {
    assert.equal(csvCell('Kira "die Heilerin"'), '"Kira ""die Heilerin"""');
    assert.equal(csvCell('a=b'), '"a=b"');
    assert.equal(csvCell(3), '"3"');
    assert.equal(csvCell(true), '"true"');
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell(undefined), '""');
});

test('template values are inserted literally, never as replacement patterns', () => {
    assert.equal(parseTemplate('Hallo {user.name}!', { 'user.name': 'A$&B $1 $` $\'' }), 'Hallo A$&B $1 $` $\'!');
    assert.equal(parseTemplate('{event.title} / {event.title}', { 'event.title': 'Raid' }), 'Raid / Raid');
    // "." in a variable name is no wildcard
    assert.equal(parseTemplate('{userXname}', { 'user.name': 'Tom' }), '{userXname}');
});
