const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, isHidden, REPO_ROOT } = require('./helpers');

// Upload and remove dialogs of System › Plugins (public/js/admin/plugin-upload.js)
const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

const REPORT = {
    ok: true, errors: [], warnings: [], fileCount: 4, packedBytes: 900, unpackedBytes: 4096,
    manifest: { id: 'hook-recorder', name: 'Hook-Rekorder', version: '1.2.0', sdk: 1, author: 'Jemand', description: '' },
    permissions: [], missing: [], unused: [], exists: false, installedVersion: '', replaces: null
};
const CUSTOM = {
    id: 'hook-recorder', name: 'Hook-Rekorder', version: '1.2.0', author: 'Jemand', description: '', official: false,
    permissions: [], status: 'off', statusText: 'Aus', enabled: false, lastError: '', limitWarning: null,
    settings: [], collections: [], permissionCheck: null, settingsValues: {}
};

async function load(extra = {}) {
    const harness = await loadFrontendApp({
        '/api/admin/plugins': { safeMode: false, uploadEnabled: true, plugins: [CUSTOM] },
        ...extra
    });
    harness.state.currentUser = { id: 'a', isAdmin: true };
    harness.state.csrfToken = 'tok';
    await harness.app.loadPluginsPanel();
    return harness;
}

test('renderUploadReport escapes names and lists both mismatch sides with labels', async () => {
    const { app } = await load();
    const html = app.renderUploadReport({
        ...REPORT,
        manifest: { ...REPORT.manifest, name: '<script>x</script>' },
        missing: [{ key: 'network', label: 'Verbindungen ins Internet aufbauen' }],
        unused: [{ key: 'events:draft', label: 'Events vorbereiten' }]
    }, null);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt; 1\.2\.0 · SDK 1 · von Jemand/);
    assert.match(html, /4 Dateien · 4 KB/);
    assert.match(html, /Berechtigungen passen nicht zum Code/);
    assert.match(html, /im Code, aber nicht angegeben: Verbindungen ins Internet aufbauen/);
    assert.match(html, /angegeben, aber nicht im Code: Events vorbereiten/);
});

test('renderUploadReport shows errors, the restart hint and the switch-off hint', async () => {
    const { app } = await load();
    assert.match(app.renderUploadReport({ ...REPORT, ok: false, errors: ['plugin.json fehlt.'] }, null), /plugin-error[^>]*>.*plugin\.json fehlt\./);
    const restart = app.renderUploadReport(REPORT, { version: '1.0.0', restart: true, enabled: false });
    assert.match(restart, /Ersetzt die installierte Version 1\.0\.0 \(Neustart nötig\)/);
    assert.doesNotMatch(restart, /Schalte das Plugin zuerst aus\./);
    const plain = app.renderUploadReport(REPORT, { version: '1.0.0', restart: false, enabled: true });
    assert.doesNotMatch(plain, /Neustart/);
    assert.match(plain, /Schalte das Plugin zuerst aus\./);
});

test('permissionCheckLines: none without a check, labels, too big, five warnings then a count', async () => {
    const { app } = await load();
    assert.deepEqual([...app.permissionCheckLines(null)], []);
    const lines = [...app.permissionCheckLines({
        missing: [{ key: 'a', label: 'A-Recht' }, { key: 'b', label: 'B-Recht' }],
        unused: [{ key: 'c', label: 'C-Recht' }],
        warnings: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'],
        tooBig: true
    })];
    assert.deepEqual(lines, [
        'Berechtigungen passen nicht zum Code: im Code, aber nicht angegeben: A-Recht, B-Recht',
        'Berechtigungen passen nicht zum Code: angegeben, aber nicht im Code: C-Recht',
        'Code zu groß für die Prüfung',
        'w1', 'w2', 'w3', 'w4', 'w5', 'und 2 weitere Hinweise'
    ]);
});

test('the card offers Entfernen only for a custom plugin that is off while uploads are on', async () => {
    const { app } = await load();
    const card = (view, uploadEnabled) => app.renderPluginCard(view, { uploadEnabled });
    assert.match(card(CUSTOM, true), /data-click="openPluginRemove" data-plugin-id="hook-recorder"/);
    assert.doesNotMatch(card(CUSTOM, false), /openPluginRemove/);
    assert.doesNotMatch(card({ ...CUSTOM, official: true }, true), /openPluginRemove/);
    assert.doesNotMatch(card({ ...CUSTOM, enabled: true, status: 'on' }, true), /openPluginRemove/);
});

test('a card with a permission mismatch warns about it', async () => {
    const { app } = await load();
    const html = app.renderPluginCard({ ...CUSTOM, permissionCheck: { missing: [{ key: 'network', label: 'Netz' }], unused: [], warnings: [], tooBig: false } });
    assert.match(html, /Berechtigungen passen nicht zum Code: im Code, aber nicht angegeben: Netz/);
});

test('the status Neustart nötig is drawn as a warning chip', async () => {
    const { app } = await load();
    assert.match(app.renderPluginCard({ ...CUSTOM, status: 'restart', statusText: 'Neustart nötig' }), /chip-warning[^>]*>Neustart nötig/);
});

test('the upload button shows only with uploads on and without safe mode', async () => {
    const on = await load();
    assert.equal(isHidden(on.element('plugin-upload-open')), false);
    const off = await load({ '/api/admin/plugins': { safeMode: false, uploadEnabled: false, plugins: [CUSTOM] } });
    assert.equal(isHidden(off.element('plugin-upload-open')), true);
    const safe = await load({ '/api/admin/plugins': { safeMode: true, uploadEnabled: true, plugins: [CUSTOM] } });
    assert.equal(isHidden(safe.element('plugin-upload-open')), true);
});

test('the markup has the upload dialog, the remove dialog and the mismatch block of the trust dialog', () => {
    assert.match(HTML, /id="pluginUploadModal"/);
    assert.match(HTML, /accept="\.dems" data-change="pluginUploadFile" id="plugin-upload-file"/);
    assert.match(HTML, /data-click="installPluginUpload" id="plugin-upload-confirm" disabled>Installieren</);
    assert.match(HTML, /data-click="openPluginUpload" id="plugin-upload-open"/);
    assert.match(HTML, /id="pluginRemoveModal"/);
    assert.match(HTML, /id="plugin-trust-check-result"/);
});

test('the upload dialog warns about full access, the trust dialog shows the check above the permissions', () => {
    const uploadModal = HTML.slice(HTML.indexOf('id="pluginUploadModal"'), HTML.indexOf('id="pluginRemoveModal"'));
    assert.match(uploadModal, /<p>Ein hochgeladenes Plugin läuft nach dem Einschalten mit vollem Zugriff auf DEMS,\s+den Discord-Bot und die Datenbank\. Lade nur Pakete hoch, deren Code du vertraust\.<\/p>/);
    const trustModal = HTML.slice(HTML.indexOf('id="pluginTrustModal"'), HTML.indexOf('id="pluginUploadModal"'));
    assert.ok(trustModal.indexOf('id="plugin-trust-check-result"') > 0);
    assert.ok(trustModal.indexOf('id="plugin-trust-check-result"') < trustModal.indexOf('id="plugin-trust-permissions"'));
});

test('renderUploadReport names an unknown installed version', async () => {
    const { app } = await load();
    const html = app.renderUploadReport(REPORT, { version: '', restart: false, enabled: false });
    assert.match(html, /Ersetzt die installierte Version \(unbekannt\)</);
    assert.doesNotMatch(html, /Version  /);
});

test('removing: password first, DELETE with the password, reload and toast', async () => {
    const { app, element, requests, toasts } = await load({ '/api/admin/plugins/hook-recorder': { removed: true } });
    await app.runAction('openPluginRemove', { dataset: { pluginId: 'hook-recorder', pluginName: 'Hook-Rekorder' } });
    assert.equal(element('plugin-remove-name').textContent, '„Hook-Rekorder“');
    assert.equal(element('plugin-remove-confirm').disabled, true);
    element('plugin-remove-password').value = 'geheim';
    await app.runAction('pluginRemoveInput', element('plugin-remove-password'));
    assert.equal(element('plugin-remove-confirm').disabled, false);
    await app.runAction('confirmPluginRemove', element('plugin-remove-confirm'));
    const del = requests.find(request => request.method === 'DELETE');
    assert.equal(del.url, '/api/admin/plugins/hook-recorder');
    assert.deepEqual(JSON.parse(del.body), { password: 'geheim' });
    assert.deepEqual(toasts, ['Plugin „Hook-Rekorder“ entfernt.']);
});

test('a refused removal shows the server message', async () => {
    const { app, element, toasts } = await load({ '/api/admin/plugins/hook-recorder': httpAnswer(401, { error: 'Ungültiges Admin-Reset-Passwort.' }) });
    await app.runAction('openPluginRemove', { dataset: { pluginId: 'hook-recorder', pluginName: 'Hook-Rekorder' } });
    element('plugin-remove-password').value = 'falsch';
    await app.runAction('confirmPluginRemove', element('plugin-remove-confirm'));
    assert.deepEqual(toasts, ['Ungültiges Admin-Reset-Passwort.']);
});

test('uploading: check posts the raw bytes, install sends replace from the report', async () => {
    const { app, element, requests, toasts } = await load({
        '/api/admin/plugins/upload/check': { uploadId: 'u1', report: { ...REPORT, replaces: { version: '1.0.0', restart: true, enabled: false } } },
        '/api/admin/plugins/upload/install': { plugin: { ...CUSTOM, status: 'restart' } }
    });
    await app.runAction('openPluginUpload', element('plugin-upload-open'));
    await app.runAction('pluginUploadFile', { files: [{ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }] });
    const check = requests.find(request => request.url === '/api/admin/plugins/upload/check');
    assert.equal(check.method, 'POST');
    assert.match(element('plugin-upload-report').innerHTML, /Ersetzt die installierte Version 1\.0\.0 \(Neustart nötig\)/);
    assert.equal(element('plugin-upload-confirm').disabled, true);
    element('plugin-upload-password').value = 'geheim';
    await app.runAction('pluginUploadInput', element('plugin-upload-password'));
    assert.equal(element('plugin-upload-confirm').disabled, false);
    await app.runAction('installPluginUpload', element('plugin-upload-confirm'));
    const install = requests.find(request => request.url === '/api/admin/plugins/upload/install');
    assert.deepEqual(JSON.parse(install.body), { uploadId: 'u1', password: 'geheim', replace: true });
    assert.deepEqual(toasts, ['Plugin „Hook-Rekorder“ installiert. Neustart nötig.']);
});

test('install stays disabled while the plugin to replace is on', async () => {
    const { app, element } = await load({
        '/api/admin/plugins/upload/check': { uploadId: 'u1', report: { ...REPORT, replaces: { version: '1.0.0', restart: false, enabled: true } } }
    });
    await app.runAction('pluginUploadFile', { files: [{ arrayBuffer: async () => new ArrayBuffer(1) }] });
    element('plugin-upload-password').value = 'geheim';
    await app.runAction('pluginUploadInput', element('plugin-upload-password'));
    assert.equal(element('plugin-upload-confirm').disabled, true);
    assert.match(element('plugin-upload-report').innerHTML, /Schalte das Plugin zuerst aus\./);
});

// Fix round 1

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const file = (bytes = new Uint8Array([1, 2, 3]).buffer) => ({ files: [{ arrayBuffer: async () => bytes }] });
const OK_CHECK = { uploadId: 'u1', report: REPORT };

test('Entfernen shows in safe mode (status safe, stored off) but not on an orphaned card', async () => {
    const { app } = await load();
    const safe = app.renderPluginCard({ ...CUSTOM, status: 'safe', enabled: false }, { safeMode: true, uploadEnabled: true });
    assert.match(safe, /data-click="openPluginRemove"/);
    const stored = app.renderPluginCard({ ...CUSTOM, status: 'safe', enabled: true }, { safeMode: true, uploadEnabled: true });
    assert.doesNotMatch(stored, /openPluginRemove/);
    const orphan = app.renderPluginCard({ ...CUSTOM, status: 'orphaned', enabled: false }, { uploadEnabled: true });
    assert.doesNotMatch(orphan, /openPluginRemove/);
});

test('closing the upload dialog clears the password, the file, the report and the kept check', async () => {
    const { app, element } = await load({ '/api/admin/plugins/upload/check': OK_CHECK });
    await app.runAction('openPluginUpload', element('plugin-upload-open'));
    await app.runAction('pluginUploadFile', file());
    element('plugin-upload-password').value = 'geheim';
    await app.runAction('pluginUploadInput', element('plugin-upload-password'));
    assert.equal(element('plugin-upload-confirm').disabled, false);
    element('pluginUploadModal').dispatch('hidden.bs.modal');
    assert.equal(element('plugin-upload-password').value, '');
    assert.equal(element('plugin-upload-report').innerHTML, '');
    assert.equal(element('plugin-upload-confirm').disabled, true);
});

test('closing the remove dialog clears its password and the target', async () => {
    const { app, element, requests } = await load();
    await app.runAction('openPluginRemove', { dataset: { pluginId: 'hook-recorder', pluginName: 'Hook-Rekorder' } });
    element('plugin-remove-password').value = 'geheim';
    element('pluginRemoveModal').dispatch('hidden.bs.modal');
    assert.equal(element('plugin-remove-password').value, '');
    element('plugin-remove-password').value = 'x';
    await app.runAction('confirmPluginRemove', element('plugin-remove-confirm'));
    assert.equal(requests.filter(request => request.method === 'DELETE').length, 0);
});

test('a second install click while the first request runs sends nothing; failure re-enables the button', async () => {
    const gate = deferred();
    const { app, element, requests } = await load({
        '/api/admin/plugins/upload/check': OK_CHECK,
        '/api/admin/plugins/upload/install': async () => { await gate.promise; return httpAnswer(401, { error: 'Ungültiges Admin-Reset-Passwort.' }); }
    });
    await app.runAction('pluginUploadFile', file());
    element('plugin-upload-password').value = 'geheim';
    await app.runAction('pluginUploadInput', element('plugin-upload-password'));
    const first = app.runAction('installPluginUpload', element('plugin-upload-confirm'));
    assert.equal(element('plugin-upload-confirm').disabled, true);
    await app.runAction('installPluginUpload', element('plugin-upload-confirm'));
    gate.resolve();
    await first;
    assert.equal(requests.filter(request => request.url === '/api/admin/plugins/upload/install').length, 1);
    assert.equal(element('plugin-upload-confirm').disabled, false);
});

test('a second remove click while the first request runs sends nothing', async () => {
    const gate = deferred();
    const { app, element, requests } = await load({ '/api/admin/plugins/hook-recorder': async () => { await gate.promise; return { removed: true }; } });
    await app.runAction('openPluginRemove', { dataset: { pluginId: 'hook-recorder', pluginName: 'Hook-Rekorder' } });
    element('plugin-remove-password').value = 'geheim';
    const first = app.runAction('confirmPluginRemove', element('plugin-remove-confirm'));
    await app.runAction('confirmPluginRemove', element('plugin-remove-confirm'));
    gate.resolve();
    await first;
    assert.equal(requests.filter(request => request.method === 'DELETE').length, 1);
});

test('the answer for an older file is ignored', async () => {
    const slow = deferred();
    let calls = 0;
    const { app, element } = await load({
        '/api/admin/plugins/upload/check': async () => {
            calls += 1;
            if (calls === 1) { await slow.promise; return { uploadId: 'old', report: { ...REPORT, manifest: { ...REPORT.manifest, name: 'Alt' } } }; }
            return { uploadId: 'new', report: { ...REPORT, manifest: { ...REPORT.manifest, name: 'Neu' } } };
        }
    });
    const first = app.runAction('pluginUploadFile', file());
    await app.runAction('pluginUploadFile', file());
    slow.resolve();
    await first;
    assert.match(element('plugin-upload-report').innerHTML, /Neu/);
    assert.doesNotMatch(element('plugin-upload-report').innerHTML, /Alt/);
});

test('the answer after the dialog was closed is ignored', async () => {
    const slow = deferred();
    const { app, element } = await load({ '/api/admin/plugins/upload/check': async () => { await slow.promise; return OK_CHECK; } });
    await app.runAction('openPluginUpload', element('plugin-upload-open'));
    const pending = app.runAction('pluginUploadFile', file());
    element('pluginUploadModal').dispatch('hidden.bs.modal');
    slow.resolve();
    await pending;
    assert.equal(element('plugin-upload-report').innerHTML, '');
});

test('the raw check request carries the octet-stream type, the CSRF token and the bytes', async () => {
    const { app, requests } = await load({ '/api/admin/plugins/upload/check': OK_CHECK });
    const bytes = new Uint8Array([9, 8, 7]).buffer;
    await app.runAction('pluginUploadFile', file(bytes));
    const check = requests.find(request => request.url === '/api/admin/plugins/upload/check');
    assert.equal(check.headers['Content-Type'], 'application/octet-stream');
    assert.equal(check.headers['X-CSRF-TOKEN'], 'tok');
    assert.equal(check.body, bytes);
});

test('a report that is not ok keeps Installieren disabled', async () => {
    const { app, element } = await load({ '/api/admin/plugins/upload/check': { uploadId: null, report: { ...REPORT, ok: false, errors: ['plugin.json fehlt.'] } } });
    await app.runAction('pluginUploadFile', file());
    element('plugin-upload-password').value = 'geheim';
    await app.runAction('pluginUploadInput', element('plugin-upload-password'));
    assert.equal(element('plugin-upload-confirm').disabled, true);
});

test('the report header leaves out von without an author', async () => {
    const { app } = await load();
    const html = app.renderUploadReport({ ...REPORT, manifest: { ...REPORT.manifest, author: '' } }, null);
    assert.match(html, /Hook-Rekorder 1\.2\.0 · SDK 1</);
    assert.doesNotMatch(html, /von/);
});
