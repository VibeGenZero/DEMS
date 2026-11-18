const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escapeText, foldLine, formatUtc, buildCalendar } = require('../utils/icalendar');

const octets = (line) => Buffer.byteLength(line, 'utf8');
// Unfold as RFC 5545 3.1 describes: a CRLF followed by one space joins two lines
const unfold = (text) => text.replace(/\r\n /g, '');

test('text values escape backslash, semicolon, comma and line breaks', () => {
    assert.equal(escapeText('a\\b;c,d'), 'a\\\\b\\;c\\,d');
    assert.equal(escapeText('eins\r\nzwei\ndrei\rvier'), 'eins\\nzwei\\ndrei\\nvier');
    assert.equal(escapeText(''), '');
    assert.equal(escapeText(null), '');
    assert.equal(escapeText(42), '42');
});

test('short lines stay as they are', () => {
    assert.equal(foldLine('SUMMARY:Raid'), 'SUMMARY:Raid');
});

test('long lines fold at 75 octets with a space at the start of every continuation', () => {
    const line = `DESCRIPTION:${'x'.repeat(200)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    assert.ok(parts.length > 1);
    for (const part of parts) assert.ok(octets(part) <= 75, `${octets(part)} octets`);
    for (const part of parts.slice(1)) assert.ok(part.startsWith(' '));
    assert.equal(unfold(folded), line);
});

test('folding never splits an umlaut or an emoji', () => {
    const line = `SUMMARY:${'ä'.repeat(60)}🐉${'ö'.repeat(60)}🎮`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) {
        assert.ok(octets(part) <= 75, `${octets(part)} octets`);
        assert.ok(!part.includes('�'));
        // Each part on its own must be valid UTF-8 (a split character would not survive the round trip)
        assert.equal(Buffer.from(part, 'utf8').toString('utf8'), part);
        assert.ok(!/[\uD800-\uDBFF]$/.test(part), 'no lone high surrogate at the end');
        assert.ok(!/^ ?[\uDC00-\uDFFF]/.test(part), 'no lone low surrogate at the start');
    }
    assert.equal(unfold(folded), line);
});

test('UTC times use the basic format with Z', () => {
    assert.equal(formatUtc('2026-11-28T18:00:00.000Z'), '20261128T180000Z');
    assert.equal(formatUtc(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '20260102T030405Z');
});

const entry = (fields = {}) => ({
    uid: 'ev1@dems.example',
    title: 'Raid: Schattenfestung',
    start: '2026-11-28T18:00:00.000Z',
    end: '2026-11-28T21:00:00.000Z',
    status: 'CONFIRMED',
    location: 'Discord, Raid-Kanal',
    url: 'https://dems.example/#event/ev1',
    description: 'Status: Angemeldet\nhttps://dems.example/#event/ev1',
    lastModified: '2026-11-20T10:00:00.000Z',
    ...fields
});

const NOW = new Date('2026-11-21T12:00:00.000Z');

test('the calendar carries the header lines and joins every line with CRLF', () => {
    const text = buildCalendar({ name: 'Gilde · Meine Events', timeZone: 'Europe/Berlin', entries: [entry()], now: NOW });
    assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(text.endsWith('END:VCALENDAR\r\n'));
    assert.ok(!/[^\r]\n/.test(text), 'every line break is CRLF');
    const lines = unfold(text).split('\r\n');
    for (const header of [
        'VERSION:2.0',
        'PRODID:-//DEMS//Kalender-Abo//DE',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Gilde · Meine Events',
        'X-WR-TIMEZONE:Europe/Berlin',
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H'
    ]) assert.ok(lines.includes(header), header);
});

test('an entry carries its fields as escaped iCalendar properties', () => {
    const lines = unfold(buildCalendar({ name: 'DEMS', timeZone: 'UTC', entries: [entry()], now: NOW })).split('\r\n');
    for (const property of [
        'BEGIN:VEVENT',
        'UID:ev1@dems.example',
        'DTSTAMP:20261121T120000Z',
        'DTSTART:20261128T180000Z',
        'DTEND:20261128T210000Z',
        'SUMMARY:Raid: Schattenfestung',
        'STATUS:CONFIRMED',
        'LOCATION:Discord\\, Raid-Kanal',
        'URL:https://dems.example/#event/ev1',
        'DESCRIPTION:Status: Angemeldet\\nhttps://dems.example/#event/ev1',
        'LAST-MODIFIED:20261120T100000Z',
        'END:VEVENT'
    ]) assert.ok(lines.includes(property), property);
});

test('empty optional fields leave their property out', () => {
    const text = buildCalendar({ name: 'DEMS', timeZone: 'UTC', entries: [entry({ location: '', lastModified: '', description: '' })], now: NOW });
    assert.ok(!text.includes('LOCATION:'));
    assert.ok(!text.includes('LAST-MODIFIED:'));
    assert.ok(!text.includes('DESCRIPTION:'));
});

test('a calendar without entries is still a valid calendar', () => {
    const text = buildCalendar({ name: 'DEMS', timeZone: 'UTC', entries: [], now: NOW });
    assert.ok(text.includes('BEGIN:VCALENDAR'));
    assert.ok(!text.includes('BEGIN:VEVENT'));
});

test('text from an event cannot add entries or properties', () => {
    const title = 'Abend, mit; Gästen\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Fake';
    const text = buildCalendar({ name: 'Gilde\nX-INJECTED:1', timeZone: 'UTC', entries: [entry({ title, location: 'Ort\r\nATTENDEE:x', url: 'https://x/\nX-EVIL:1' })], now: NOW });
    const lines = unfold(text).split('\r\n');
    assert.equal(lines.filter(line => line === 'BEGIN:VEVENT').length, 1);
    assert.equal(lines.filter(line => line === 'END:VEVENT').length, 1);
    assert.ok(!lines.some(line => /^(SUMMARY:Fake|ATTENDEE|X-INJECTED|X-EVIL)/.test(line)));
    assert.ok(lines.includes('SUMMARY:Abend\\, mit\\; Gästen\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:Fake'));
});
