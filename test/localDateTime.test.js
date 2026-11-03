const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLocalDateTime, parseEndInput, parsePollLines, DATE_FORMAT_HINT } = require('../utils/localDateTime');

const TZ = 'Europe/Berlin';
const iso = (date) => (date ? date.toISOString() : date);

test('a German date and time is read in the server time zone', () => {
    assert.equal(iso(parseLocalDateTime('24.12.2026 19:30', TZ)), '2026-12-24T18:30:00.000Z');
    // Summer time, one-digit parts and a two-digit year
    assert.equal(iso(parseLocalDateTime('1.7.26 9:05', TZ)), '2026-07-01T07:05:00.000Z');
    assert.equal(iso(parseLocalDateTime('  03.11.2026   20:00 ', TZ)), '2026-11-03T19:00:00.000Z');
});

test('unreadable or impossible dates are refused', () => {
    for (const text of ['31.02.2026 10:00', '24.13.2026 19:30', '24.12.2026 24:00', '24.12.2026 19:60', '24.12.2026', 'morgen', '', '2026-12-24 19:30']) {
        assert.equal(parseLocalDateTime(text, TZ), null, text);
    }
    assert.equal(parseLocalDateTime(undefined, TZ), null);
});

test('the end may be a time on the start day or the next day', () => {
    const start = parseLocalDateTime('31.12.2026 22:00', TZ);
    assert.equal(iso(parseEndInput('23:30', start, TZ)), '2026-12-31T22:30:00.000Z');
    assert.equal(iso(parseEndInput('01:00', start, TZ)), '2027-01-01T00:00:00.000Z');
    // The same time as the start means the next day
    assert.equal(iso(parseEndInput('22:00', start, TZ)), '2027-01-01T21:00:00.000Z');
    assert.equal(iso(parseEndInput('02.01.2027 10:00', start, TZ)), '2027-01-02T09:00:00.000Z');
});

test('an empty end is no end, an unreadable one is refused', () => {
    const start = parseLocalDateTime('31.12.2026 22:00', TZ);
    assert.equal(parseEndInput('', start, TZ), null);
    assert.equal(parseEndInput('   ', start, TZ), null);
    assert.equal(parseEndInput('spät', start, TZ), undefined);
    assert.equal(parseEndInput('25:00', start, TZ), undefined);
});

test('poll lines become dates with an optional end', () => {
    const result = parsePollLines('24.12.2026 19:30\n\n25.12.2026 18:00 – 22:00\n26.12.2026 18:00 bis 27.12.2026 01:00\n27.12.2026 18:00 - 20:00', TZ);
    assert.deepEqual(result, {
        options: [
            { startDate: '2026-12-24T18:30:00.000Z', endDate: '' },
            { startDate: '2026-12-25T17:00:00.000Z', endDate: '2026-12-25T21:00:00.000Z' },
            { startDate: '2026-12-26T17:00:00.000Z', endDate: '2026-12-27T00:00:00.000Z' },
            { startDate: '2026-12-27T17:00:00.000Z', endDate: '2026-12-27T19:00:00.000Z' }
        ]
    });
});

test('a wrong poll line is named', () => {
    const result = parsePollLines('24.12.2026 19:30\nnächsten Freitag', TZ);
    assert.match(result.error, /Zeile 2/);
    assert.match(result.error, /„nächsten Freitag“/);
    assert.match(result.error, new RegExp(DATE_FORMAT_HINT));
    assert.match(parsePollLines('24.12.2026 19:30 – irgendwann', TZ).error, /Zeile 1/);
});
