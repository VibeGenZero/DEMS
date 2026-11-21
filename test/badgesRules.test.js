// Pure rules of the official plugin „Badges“ (plugins/badges/rules.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    ICONS, MAX_BADGES, validateBadge, ruleText, countFor, awardId, dueAwards, progressFor, isActive, awardDm, awardPost
} = require('../plugins/badges/rules');

const VALID = { name: 'Veteran', description: '', icon: 'bi-trophy', color: '#22c55e', rule: { type: 'manual' }, roleId: null };

test('validateBadge trims, lower-cases the colour and normalizes the rule', () => {
    const result = validateBadge({ name: ' Veteran ', description: ' Zehn Raids ', icon: 'bi-trophy', color: '#22C55E',
        rule: { type: 'participations', count: 10, category: ' Raid ' }, roleId: null, extra: 'x' });
    assert.deepEqual(result, { ok: true, value: { name: 'Veteran', description: 'Zehn Raids', icon: 'bi-trophy', color: '#22c55e',
        rule: { type: 'participations', count: 10, category: 'Raid' }, roleId: null } });
    assert.deepEqual(validateBadge({ ...VALID, rule: { type: 'checkins', count: 3, category: '' } }).value.rule,
        { type: 'checkins', count: 3, category: null });
    assert.deepEqual(validateBadge({ ...VALID, rule: { type: 'manual', count: 5 } }).value.rule, { type: 'manual' });
    assert.equal(validateBadge({ ...VALID, roleId: '110000000000000005' }).value.roleId, '110000000000000005');
    assert.equal(validateBadge({ ...VALID, description: undefined }).value.description, '');
});

test('validateBadge names the problem in German', () => {
    const cases = [
        [{ name: '' }, 'Der Name muss 1 bis 40 Zeichen lang sein.'],
        [{ name: '   ' }, 'Der Name muss 1 bis 40 Zeichen lang sein.'],
        [{ name: 'x'.repeat(41) }, 'Der Name muss 1 bis 40 Zeichen lang sein.'],
        [{ name: 7 }, 'Der Name muss 1 bis 40 Zeichen lang sein.'],
        [{ description: 'x'.repeat(201) }, 'Die Beschreibung darf höchstens 200 Zeichen lang sein.'],
        [{ icon: 'bi-nope' }, 'Bitte wähle ein Icon aus der Liste.'],
        [{ color: 'red' }, 'Bitte wähle eine gültige Farbe.'],
        [{ color: '#12345' }, 'Bitte wähle eine gültige Farbe.'],
        [{ rule: { type: 'checkins', count: 0 } }, 'Die Anzahl muss zwischen 1 und 1000 liegen.'],
        [{ rule: { type: 'checkins', count: 1001 } }, 'Die Anzahl muss zwischen 1 und 1000 liegen.'],
        [{ rule: { type: 'participations', count: 2.5 } }, 'Die Anzahl muss zwischen 1 und 1000 liegen.'],
        [{ rule: { type: 'participations', count: 3, category: 'x'.repeat(81) } }, 'Die Kategorie darf höchstens 80 Zeichen lang sein.'],
        [{ rule: { type: 'karma' } }, 'Bitte wähle, wie das Badge vergeben wird.'],
        [{ rule: null }, 'Bitte wähle, wie das Badge vergeben wird.'],
        [{ roleId: 'abc' }, 'Diese Rolle kann das Plugin nicht vergeben.']
    ];
    for (const [patch, error] of cases) {
        assert.deepEqual(validateBadge({ ...VALID, ...patch }), { ok: false, error }, JSON.stringify(patch));
    }
    assert.deepEqual(validateBadge(null), { ok: false, error: 'Ungültige Eingabe.' });
});

test('ruleText', () => {
    assert.equal(ruleText({ type: 'manual' }), 'Von Hand');
    assert.equal(ruleText({ type: 'participations', count: 1, category: null }), 'Ab 1 Teilnahme');
    assert.equal(ruleText({ type: 'participations', count: 10, category: 'Raid' }), 'Ab 10 Teilnahmen · Raid');
    assert.equal(ruleText({ type: 'checkins', count: 1, category: null }), 'Ab 1 Check-in');
    assert.equal(ruleText({ type: 'checkins', count: 5, category: null }), 'Ab 5 Check-ins');
});

const EVENTS = new Map([
    ['a', { status: 'archived', category: 'Raid' }],
    ['b', { status: 'archived', category: 'Quiz' }],
    ['c', { status: 'active', category: 'Raid' }],
    ['d', { status: 'cancelled', category: 'Raid' }]
]);

test('countFor counts accepted registrations of archived events and check-ins of events that are not cancelled', () => {
    const regs = [
        { eventId: 'a', status: 'accepted', checkedIn: true },
        { eventId: 'b', status: 'accepted', checkedIn: false },
        { eventId: 'c', status: 'accepted', checkedIn: true },
        { eventId: 'd', status: 'accepted', checkedIn: true },
        { eventId: 'a', status: 'rejected', checkedIn: false },
        { eventId: 'b', status: 'waitlisted', checkedIn: false },
        { eventId: 'gone', status: 'accepted', checkedIn: true }
    ];
    assert.equal(countFor({ type: 'participations', category: null }, regs, EVENTS), 2);
    assert.equal(countFor({ type: 'participations', category: 'Raid' }, regs, EVENTS), 1);
    assert.equal(countFor({ type: 'checkins', category: null }, regs, EVENTS), 2);
    assert.equal(countFor({ type: 'checkins', category: 'Raid' }, regs, EVENTS), 2);
    assert.equal(countFor({ type: 'checkins', category: 'Quiz' }, regs, EVENTS), 0);
    assert.equal(countFor({ type: 'manual' }, regs, EVENTS), 0);
});

test('awardId, isActive and progressFor', () => {
    assert.equal(awardId('b1', '200000000000000003'), 'b1_200000000000000003');
    assert.equal(isActive({ revokedAt: null }), true);
    assert.equal(isActive({ revokedAt: '2026-11-21T10:00:00.000Z' }), false);
    assert.equal(progressFor({ count: 4 }, 1), 0.25);
    assert.equal(progressFor({ count: 4 }, 9), 1);
});

test('dueAwards skips manual badges, existing awards and tombstones, honours userIds', () => {
    const badges = [
        { id: 'hand', rule: { type: 'manual' } },
        { id: 'one', rule: { type: 'participations', count: 1, category: null } },
        { id: 'check', rule: { type: 'checkins', count: 1, category: null } },
        { id: 'two', rule: { type: 'participations', count: 2, category: null } }
    ];
    const registrations = [
        { userId: 'u1', eventId: 'a', status: 'accepted', checkedIn: true },
        { userId: 'u2', eventId: 'b', status: 'accepted', checkedIn: false },
        { userId: 'u3', eventId: 'a', status: 'accepted', checkedIn: true },
        { userId: 'u3', eventId: 'b', status: 'accepted', checkedIn: false }
    ];
    const events = [{ id: 'a', ...EVENTS.get('a') }, { id: 'b', ...EVENTS.get('b') }];
    const awards = [
        { badgeId: 'one', userId: 'u1', revokedAt: null },
        { badgeId: 'check', userId: 'u3', revokedAt: '2026-11-20T10:00:00.000Z' }
    ];
    assert.deepEqual(dueAwards({ badges, awards, registrations, events }), [
        { badgeId: 'one', userId: 'u2' },
        { badgeId: 'one', userId: 'u3' },
        { badgeId: 'check', userId: 'u1' },
        { badgeId: 'two', userId: 'u3' }
    ]);
    assert.deepEqual(dueAwards({ badges, awards, registrations, events, userIds: ['u2'] }), [{ badgeId: 'one', userId: 'u2' }]);
    assert.deepEqual(dueAwards({ badges, awards, registrations, events, userIds: [] }), []);
});

test('every icon exists in the vendored Bootstrap Icons font and the list has no duplicates', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'vendor', 'bootstrap-icons', 'bootstrap-icons.css'), 'utf8');
    assert.ok(ICONS.length >= 30 && ICONS.length <= 60, `${ICONS.length} icons`);
    assert.equal(new Set(ICONS).size, ICONS.length);
    for (const icon of ICONS) assert.ok(css.includes(`.${icon}::before`), icon);
    assert.equal(MAX_BADGES, 100);
});

test('awardDm and awardPost escape Discord markdown', () => {
    assert.equal(awardDm({ name: 'Raid_Veteran' }), 'Du hast das Badge **Raid\\_Veteran** erhalten!');
    assert.equal(awardPost('a*b', { name: 'X_Y' }), '**a\\*b** hat das Badge **X\\_Y** erhalten.');
    assert.equal(awardPost('`~|\\', { name: 'Z' }), '**\\`\\~\\|\\\\** hat das Badge **Z** erhalten.');
});
