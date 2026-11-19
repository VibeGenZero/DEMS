const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');
const { validateManifest } = require('../plugin-sdk/manifest');
const rules = require('../plugins/event-submissions/rules');

const PLUGIN_DIR = path.join(REPO_ROOT, 'plugins', 'event-submissions');
const TODAY = '2026-11-19';
const valid = (overrides = {}) => ({ title: 'Quiz-Nacht', description: '', wishedDate: '', category: '', ...overrides });

test('constants', () => {
    assert.equal(rules.MAX_OPEN, 3);
    assert.deepEqual(rules.OPEN_STATUSES, ['open', 'planning']);
    assert.deepEqual(rules.CATEGORIES, ['Tournament', 'Community', 'Workshop', 'Gamenight', 'Meeting', 'Sonstiges']);
});

test('CATEGORIES equal the options of #event-category in the editor', () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    const block = html.match(/<select[^>]*id="event-category"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(block, '#event-category select not found');
    const values = [...block[1].matchAll(/<option value="([^"]*)"/g)].map(match => match[1]).filter(value => value !== '');
    assert.deepEqual(rules.CATEGORIES, values);
});

test('plugin.json passes validateManifest with the spec values', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf8'));
    const result = validateManifest(raw, 'event-submissions', { fileExists: () => true });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.manifest.name, 'Event einreichen');
    assert.equal(result.manifest.version, '1.0.0');
    assert.equal(result.manifest.sdk, 1);
    assert.equal(result.manifest.server, 'server.js');
    assert.equal(result.manifest.client, 'client.js');
    assert.deepEqual(result.manifest.permissions, ['events:read', 'events:draft', 'discord:dm', 'discord:channel']);
    assert.deepEqual(result.manifest.settings, [{
        key: 'notifyChannel',
        type: 'channel',
        label: 'Kanal für neue Vorschläge',
        help: 'Leer lassen, wenn das Team nicht benachrichtigt werden soll.',
        required: false
    }]);
});

test('validateSubmission accepts a valid body, trims and drops unknown keys', () => {
    const result = rules.validateSubmission({
        title: '  Quiz-Nacht  ', description: '  **Fragen**  ', wishedDate: TODAY, category: ' Gamenight ', extra: 'x', status: 'accepted'
    }, TODAY);
    assert.deepEqual(result, { ok: true, value: { title: 'Quiz-Nacht', description: '**Fragen**', wishedDate: TODAY, category: 'Gamenight' } });
});

test('validateSubmission fills absent optional fields with empty strings', () => {
    assert.deepEqual(rules.validateSubmission({ title: 'Abc' }, TODAY), {
        ok: true, value: { title: 'Abc', description: '', wishedDate: '', category: '' }
    });
});

test('validateSubmission refuses a body that is no plain object', () => {
    for (const body of [null, undefined, [], 'text', 42]) {
        assert.deepEqual(rules.validateSubmission(body, TODAY), { ok: false, error: 'Ungültige Eingabe.' });
    }
});

test('validateSubmission refuses a non-string field as invalid input', () => {
    assert.deepEqual(rules.validateSubmission(valid({ title: 123 }), TODAY), { ok: false, error: 'Ungültige Eingabe.' });
    assert.deepEqual(rules.validateSubmission(valid({ category: ['Meeting'] }), TODAY), { ok: false, error: 'Ungültige Eingabe.' });
});

test('validateSubmission checks the title length after trimming', () => {
    const error = { ok: false, error: 'Der Titel braucht 3 bis 100 Zeichen.' };
    assert.deepEqual(rules.validateSubmission(valid({ title: '  ab  ' }), TODAY), error);
    assert.deepEqual(rules.validateSubmission(valid({ title: 'x'.repeat(101) }), TODAY), error);
    assert.deepEqual(rules.validateSubmission({ description: 'x' }, TODAY), error);
    assert.equal(rules.validateSubmission(valid({ title: 'abc' }), TODAY).ok, true);
    assert.equal(rules.validateSubmission(valid({ title: 'x'.repeat(100) }), TODAY).ok, true);
});

test('validateSubmission limits the description to 2000 characters', () => {
    assert.deepEqual(rules.validateSubmission(valid({ description: 'x'.repeat(2001) }), TODAY), {
        ok: false, error: 'Die Beschreibung darf höchstens 2000 Zeichen haben.'
    });
    assert.equal(rules.validateSubmission(valid({ description: 'x'.repeat(2000) }), TODAY).ok, true);
});

test('validateSubmission refuses a past wish date and takes today and later', () => {
    assert.deepEqual(rules.validateSubmission(valid({ wishedDate: '2026-11-18' }), TODAY), {
        ok: false, error: 'Der Wunschtermin muss heute oder später sein.'
    });
    assert.equal(rules.validateSubmission(valid({ wishedDate: TODAY }), TODAY).ok, true);
    assert.equal(rules.validateSubmission(valid({ wishedDate: '2027-01-01' }), TODAY).ok, true);
    assert.equal(rules.validateSubmission(valid({ wishedDate: '' }), TODAY).ok, true);
});

test('validateSubmission refuses a malformed or impossible wish date', () => {
    for (const wishedDate of ['2027-02-30', '2027-13-01', '2027-1-5', '05.01.2027', '2027-01-05T19:00', 'morgen']) {
        assert.deepEqual(rules.validateSubmission(valid({ wishedDate }), TODAY), { ok: false, error: 'Ungültiger Wunschtermin.' }, wishedDate);
    }
    assert.equal(rules.validateSubmission(valid({ wishedDate: '2028-02-29' }), TODAY).ok, true);
});

test('validateSubmission accepts only the known categories', () => {
    assert.deepEqual(rules.validateSubmission(valid({ category: 'Raid' }), TODAY), { ok: false, error: 'Unbekannte Kategorie.' });
    assert.deepEqual(rules.validateSubmission(valid({ category: 'meeting' }), TODAY), { ok: false, error: 'Unbekannte Kategorie.' });
    for (const category of rules.CATEGORIES) assert.equal(rules.validateSubmission(valid({ category }), TODAY).ok, true);
});

test('validateReason trims, allows empty and limits to 500 characters', () => {
    assert.deepEqual(rules.validateReason('  Schon geplant.  '), { ok: true, value: 'Schon geplant.' });
    assert.deepEqual(rules.validateReason(undefined), { ok: true, value: '' });
    assert.deepEqual(rules.validateReason(''), { ok: true, value: '' });
    assert.deepEqual(rules.validateReason('x'.repeat(500)), { ok: true, value: 'x'.repeat(500) });
    assert.deepEqual(rules.validateReason('x'.repeat(501)), { ok: false, error: 'Die Begründung darf höchstens 500 Zeichen haben.' });
    assert.deepEqual(rules.validateReason(42), { ok: false, error: 'Ungültige Eingabe.' });
});

test('DM texts are exact', () => {
    assert.equal(rules.acceptedDm('Quiz-Nacht'), 'Dein Event „Quiz-Nacht“ wurde eingetragen.');
    assert.equal(rules.rejectedDm('Quiz-Nacht', ''), 'Dein Event-Vorschlag „Quiz-Nacht“ wurde abgelehnt.');
    assert.equal(rules.rejectedDm('Quiz-Nacht'), 'Dein Event-Vorschlag „Quiz-Nacht“ wurde abgelehnt.');
    assert.equal(rules.rejectedDm('Quiz-Nacht', 'Machen wir schon.'), 'Dein Event-Vorschlag „Quiz-Nacht“ wurde abgelehnt.\nBegründung: Machen wir schon.');
});

test('newSubmissionPost has the exact text', () => {
    assert.equal(rules.newSubmissionPost('Lyra', 'Quiz-Nacht'), 'Neuer Event-Vorschlag von **Lyra**: „Quiz-Nacht“');
});

test('newSubmissionPost escapes Discord Markdown and neutralises mentions', () => {
    assert.equal(
        rules.newSubmissionPost('**Bold**_x_', 'a~b`c|d>e\\f'),
        'Neuer Event-Vorschlag von **\\*\\*Bold\\*\\*\\_x\\_**: „a\\~b\\`c\\|d\\>e\\\\f“'
    );
    assert.equal(
        rules.newSubmissionPost('@everyone', '<@&123> @here'),
        'Neuer Event-Vorschlag von **@​everyone**: „<@​&123\\> @​here“'
    );
});

test('statusFilter filters by status group and sorts newest first', () => {
    const list = [
        { id: 'a', status: 'open', createdAt: '2026-11-01T10:00:00.000Z' },
        { id: 'b', status: 'planning', createdAt: '2026-11-03T10:00:00.000Z' },
        { id: 'c', status: 'accepted', createdAt: '2026-11-02T10:00:00.000Z' },
        { id: 'd', status: 'rejected', createdAt: '2026-11-04T10:00:00.000Z' },
        { id: 'e', status: 'open', createdAt: '2026-11-05T10:00:00.000Z' }
    ];
    const ids = (result) => result.map(item => item.id);
    assert.deepEqual(ids(rules.statusFilter(list, 'open')), ['e', 'a']);
    assert.deepEqual(ids(rules.statusFilter(list, 'planning')), ['b']);
    assert.deepEqual(ids(rules.statusFilter(list, 'done')), ['d', 'c']);
    assert.deepEqual(ids(rules.statusFilter(list, undefined)), ['e', 'd', 'b', 'c', 'a']);
    assert.deepEqual(ids(rules.statusFilter(list, 'whatever')), ['e', 'd', 'b', 'c', 'a']);
    // A new array; the input keeps its order
    assert.notEqual(rules.statusFilter(list, 'all'), list);
    assert.deepEqual(ids(list), ['a', 'b', 'c', 'd', 'e']);
});
