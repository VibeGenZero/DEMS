const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { getTimezone } = require('../utils/timezone');
const { parseLocalDateTime } = require('../utils/localDateTime');
const { localDay } = require('../utils/eventSeries');

const original = process.env.TIMEZONE;
afterEach(() => {
    if (original === undefined) delete process.env.TIMEZONE;
    else process.env.TIMEZONE = original;
});

test('getTimezone reads TIMEZONE at call time, default Europe/Berlin', () => {
    delete process.env.TIMEZONE;
    assert.equal(getTimezone(), 'Europe/Berlin');
    process.env.TIMEZONE = 'America/New_York';
    assert.equal(getTimezone(), 'America/New_York');
});

test('a time zone set after the modules were loaded changes parsing and formatting (#138)', () => {
    process.env.TIMEZONE = 'Europe/Berlin';
    const berlin = parseLocalDateTime('24.12.2026 19:30');
    process.env.TIMEZONE = 'America/New_York';
    const newYork = parseLocalDateTime('24.12.2026 19:30');
    assert.notEqual(berlin.toISOString(), newYork.toISOString());
    // 23:30 UTC is still the 24th in New York, already the 25th in Berlin
    assert.equal(localDay('2026-12-24T23:30:00.000Z'), '2026-12-24');
    process.env.TIMEZONE = 'Europe/Berlin';
    assert.equal(localDay('2026-12-24T23:30:00.000Z'), '2026-12-25');
});

test('no module keeps TIMEZONE in a constant read at load time', () => {
    const root = path.join(__dirname, '..');
    const offenders = [];
    for (const dir of ['bot', 'utils', 'routes', 'middleware']) {
        for (const file of fs.readdirSync(path.join(root, dir)).filter(name => name.endsWith('.js'))) {
            const source = fs.readFileSync(path.join(root, dir, file), 'utf8');
            // A module constant filled from TIMEZONE, or the old TIMEZONE constant of bot/constants.js
            if (/^const\s+\w+\s*=\s*process\.env\.TIMEZONE/m.test(source) || /\{[^}]*\bTIMEZONE\b[^}]*\}\s*=\s*require\(/.test(source)) {
                offenders.push(`${dir}/${file}`);
            }
        }
    }
    assert.deepEqual(offenders, []);
});
