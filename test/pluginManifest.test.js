const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    SDK_VERSION,
    PERMISSIONS,
    SETTING_TYPES,
    validateManifest
} = require('../plugin-sdk/manifest');

/** The manifest from the design spec. */
function specManifest(overrides = {}) {
    return {
        id: 'event-submissions',
        name: 'Event einreichen',
        version: '1.0.0',
        sdk: 1,
        description: 'Mitglieder reichen Event-Ideen ein, das Team übernimmt oder lehnt ab.',
        author: 'DEMS',
        server: 'server.js',
        client: 'client.js',
        permissions: ['events:read', 'events:draft', 'discord:dm', 'discord:channel'],
        settings: [
            {
                key: 'notifyChannel',
                type: 'channel',
                label: 'Kanal für neue Vorschläge',
                help: 'Leer lassen, wenn das Team nicht benachrichtigt werden soll.'
            }
        ],
        ...overrides
    };
}

const FILES = new Set(['plugin.json', 'server.js', 'client.js']);
const options = { fileExists: (relPath) => FILES.has(relPath) };

function validate(overrides, folder = 'event-submissions', opts = options) {
    return validateManifest(specManifest(overrides), folder, opts);
}

function assertInvalid(result, reason) {
    assert.equal(result.ok, false);
    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, reason);
}

test('exports SDK_VERSION, PERMISSIONS and SETTING_TYPES', () => {
    assert.equal(SDK_VERSION, 1);
    assert.deepEqual(PERMISSIONS, {
        'events:read': 'Events lesen',
        'events:draft': 'Events für das Team vorbereiten',
        'members:read': 'Mitgliedernamen und Avatare lesen',
        'discord:dm': 'Direktnachrichten über den Bot senden',
        'discord:channel': 'Nachrichten in Discord-Kanäle posten',
        network: 'Verbindungen ins Internet aufbauen',
        theme: 'Aussehen der ganzen Seite ändern'
    });
    assert.deepEqual(SETTING_TYPES, ['text', 'textarea', 'number', 'boolean', 'select', 'channel', 'role', 'secret']);
});

test('accepts the spec manifest and returns a normalized copy', () => {
    const input = specManifest();
    const result = validateManifest(input, 'event-submissions', options);
    assert.equal(result.ok, true);
    assert.deepEqual(result.manifest.permissions, input.permissions);
    assert.notEqual(result.manifest.permissions, input.permissions);
    assert.equal(result.manifest.css, '');
    assert.equal(result.manifest.id, 'event-submissions');
    assert.equal(result.manifest.name, 'Event einreichen');
    assert.equal(result.manifest.version, '1.0.0');
    assert.equal(result.manifest.sdk, 1);
    assert.equal(result.manifest.server, 'server.js');
    assert.equal(result.manifest.client, 'client.js');
    assert.equal(result.manifest.settings.length, 1);
    assert.equal(result.manifest.settings[0].key, 'notifyChannel');
    assert.equal(result.manifest.settings[0].type, 'channel');
});

test('sets css to client.css when that file exists', () => {
    const result = validate({}, 'event-submissions', {
        fileExists: (relPath) => FILES.has(relPath) || relPath === 'client.css'
    });
    assert.equal(result.ok, true);
    assert.equal(result.manifest.css, 'client.css');
});

test('defaults optional fields when absent', () => {
    const raw = specManifest();
    delete raw.description;
    delete raw.author;
    delete raw.server;
    delete raw.client;
    delete raw.permissions;
    delete raw.settings;
    const result = validateManifest(raw, 'event-submissions', options);
    assert.equal(result.ok, true);
    assert.equal(result.manifest.description, '');
    assert.equal(result.manifest.author, '');
    assert.equal(result.manifest.server, '');
    assert.equal(result.manifest.client, '');
    assert.deepEqual(result.manifest.permissions, []);
    assert.deepEqual(result.manifest.settings, []);
});

test('rejects a manifest that is not an object', () => {
    for (const raw of [null, 'x', 5, []]) {
        const result = validateManifest(raw, 'event-submissions', options);
        assert.equal(result.ok, false);
        assert.equal(result.status, 'invalid');
    }
});

test('rejects an id that does not match the pattern', () => {
    for (const id of ['ab', 'Event', '1abc', 'a_bc', 'a'.repeat(33), 5, undefined]) {
        assertInvalid(validate({ id }, String(id)), 'Ungültig: Die ID ist nicht erlaubt.');
    }
});

test('rejects an id that differs from the folder name', () => {
    assertInvalid(validate({}, 'other-folder'), 'Ungültig: Die ID passt nicht zum Ordnernamen.');
});

test('reports another sdk version as incompatible', () => {
    const result = validate({ sdk: 2 });
    assert.deepEqual(result, { ok: false, status: 'incompatible', reason: 'Inkompatibel (SDK 2)' });
});

test('rejects a missing or non-integer sdk', () => {
    for (const sdk of [undefined, '1', 1.5, null]) {
        assertInvalid(validate({ sdk }), 'Ungültig: SDK-Version fehlt.');
    }
});

test('rejects a version that is not x.y.z', () => {
    for (const version of ['1.0', '1.0.0-beta', 'v1.0.0', '', 1]) {
        assertInvalid(validate({ version }), 'Ungültig: Version muss x.y.z sein.');
    }
});

test('rejects an empty, missing or too long name', () => {
    for (const name of ['', '   ', undefined, 'x'.repeat(41), 5]) {
        assertInvalid(validate({ name }), 'Ungültig: Name ist zu lang oder fehlt.');
    }
    assert.equal(validate({ name: 'x'.repeat(40) }).ok, true);
});

test('rejects a too long description', () => {
    assertInvalid(validate({ description: 'x'.repeat(201) }), 'Ungültig: Beschreibung ist zu lang oder fehlt.');
    assert.equal(validate({ description: 'x'.repeat(200) }).ok, true);
});

test('rejects a too long author', () => {
    assertInvalid(validate({ author: 'x'.repeat(61) }), 'Ungültig: Autor ist zu lang oder fehlt.');
    assert.equal(validate({ author: 'x'.repeat(60) }).ok, true);
});

test('rejects server and client files outside the plugin or missing', () => {
    const bad = ['../server.js', 'lib/../../x.js', '/server.js', 'lib\\server.js', 'missing.js'];
    for (const field of ['server', 'client']) {
        for (const file of bad) {
            assertInvalid(
                validate({ [field]: file }),
                `Ungültig: Datei ${file} fehlt oder liegt außerhalb des Plugins.`
            );
        }
    }
});

test('rejects an unknown permission', () => {
    assertInvalid(
        validate({ permissions: ['events:read', 'db:raw'] }),
        'Ungültig: Unbekannte Berechtigung db:raw.'
    );
});

test('rejects a setting with a bad key', () => {
    assertInvalid(
        validate({ settings: [{ key: '1bad', type: 'text', label: 'X' }] }),
        'Ungültig: Einstellung 1bad ist fehlerhaft.'
    );
});

test('rejects a setting with an unknown type', () => {
    assertInvalid(
        validate({ settings: [{ key: 'color', type: 'colour', label: 'Farbe' }] }),
        'Ungültig: Einstellung color ist fehlerhaft.'
    );
});

test('rejects a select setting without options', () => {
    assertInvalid(
        validate({ settings: [{ key: 'mode', type: 'select', label: 'Modus' }] }),
        'Ungültig: Einstellung mode ist fehlerhaft.'
    );
    const ok = validate({
        settings: [{ key: 'mode', type: 'select', label: 'Modus', options: ['a', 'b'] }]
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.manifest.settings[0].options, ['a', 'b']);
});
