const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startPluginServer, loginAt } = require('./pluginTestServer');
const { createClient } = require('./helpers');

const API = '/api/plugins/custom-design';

let server;
let admin;
let anon;

before(async () => {
    server = await startPluginServer();
    admin = await loginAt(server.baseUrl, 'admin');
    anon = createClient(server.baseUrl);
});

after(() => server.stop());

beforeEach(async () => {
    const res = await admin.send('POST', `${API}/reset`, {});
    assert.equal(res.status, 200, await res.clone().text());
});

async function json(res, status = 200) {
    assert.equal(res.status, status, await res.clone().text());
    return res.json();
}

async function auditEntries(action) {
    const body = await json(await admin.request('/api/admin/audit-log?limit=500'));
    return body.data.filter(entry => entry.action === action);
}

test('members and raiders get 403 on every route', async () => {
    for (const personaId of ['member', 'raider']) {
        const client = await loginAt(server.baseUrl, personaId);
        assert.equal((await client.request(`${API}/`)).status, 403);
        assert.equal((await client.send('PUT', `${API}/draft`, {})).status, 403);
        assert.equal((await client.send('DELETE', `${API}/draft`, {})).status, 403);
        assert.equal((await client.send('POST', `${API}/publish`, {})).status, 403);
        assert.equal((await client.send('POST', `${API}/publish-css`, { password: 'dev' })).status, 403);
        assert.equal((await client.send('POST', `${API}/reset`, {})).status, 403);
    }
});

test('a token draft publishes without the password', async () => {
    const draftRes = await json(
        await admin.send('PUT', `${API}/draft`, {
            tokens: { dark: { accent: '#123456' } },
        })
    );
    assert.equal(draftRes.draft.tokens.dark.accent, '#123456');
    assert.equal(draftRes.draft.error, '');

    await json(await admin.send('POST', `${API}/publish`, {}));

    const themeRes = await anon.request('/theme.css');
    assert.equal(themeRes.status, 200);
    const css = await themeRes.text();
    assert.equal(css.includes('--accent: #123456;'), true);
});

test('the draft shows only in the preview', async () => {
    await json(
        await admin.send('PUT', `${API}/draft`, {
            tokens: { dark: { accent: '#234567' } },
        })
    );

    const publicCss = await (await anon.request('/theme.css')).text();
    assert.equal(publicCss, '');

    const previewCss = await (await admin.request('/theme-preview.css')).text();
    assert.equal(previewCss.includes('--accent: #234567;'), true);
});

test('changed free CSS needs the password', async () => {
    await json(
        await admin.send('PUT', `${API}/draft`, {
            css: '.x{}',
        })
    );

    const noPwd = await json(await admin.send('POST', `${API}/publish`, {}), 403);
    assert.equal(
        noPwd.error,
        'Eigenes CSS wurde geändert – zum Veröffentlichen ist das Reset-Passwort nötig.'
    );

    const wrongPwd = await json(
        await admin.send('POST', `${API}/publish-css`, { password: 'falsch' }),
        401
    );
    assert.equal(wrongPwd.error, 'Ungültiges Admin-Reset-Passwort.');

    await json(await admin.send('POST', `${API}/publish-css`, { password: 'dev' }), 200);
    const publicCss = await (await anon.request('/theme.css')).text();
    assert.equal(publicCss.includes('.x{}'), true);
});

test('a filter error is kept with the draft and blocks publishing', async () => {
    await json(
        await admin.send('PUT', `${API}/draft`, {
            tokens: { dark: { accent: '#345678' } },
        })
    );

    const bad = await json(
        await admin.send('PUT', `${API}/draft`, {
            tokens: { dark: { accent: '#345678' } },
            css: '@import "x";',
        }),
        200
    );
    assert.equal(bad.draft.error, 'Zeile 1: @import ist nicht erlaubt.');

    // Preview still serves the last valid draft sheet
    const previewCss = await (await admin.request('/theme-preview.css')).text();
    assert.equal(previewCss.includes('--accent: #345678;'), true);
    assert.equal(previewCss.includes('@import'), false);

    const pubErr = await json(
        await admin.send('POST', `${API}/publish-css`, { password: 'dev' }),
        409
    );
    assert.equal(
        pubErr.error,
        'Das eigene CSS hat einen Fehler: Zeile 1: @import ist nicht erlaubt.'
    );
});

test('invalid source answers 400', async () => {
    const err = await json(
        await admin.send('PUT', `${API}/draft`, {
            tokens: { dark: { accent: 'not-a-color' } },
        }),
        400
    );
    assert.equal(
        err.error,
        'Ungültige Farbe für Akzentfarbe (Dunkel): erlaubt ist #rrggbb.'
    );
});

test('reset brings the default back', async () => {
    await json(
        await admin.send('PUT', `${API}/draft`, {
            tokens: { dark: { accent: '#456789' } },
        })
    );
    await json(await admin.send('POST', `${API}/publish`, {}));
    await json(await admin.send('POST', `${API}/reset`, {}));

    const publicCss = await (await anon.request('/theme.css')).text();
    assert.equal(publicCss, '');

    const state = await json(await admin.request(`${API}/`));
    assert.equal(state.published, null);
    assert.equal(state.draft, null);
});

test('publish and reset are audit-logged', async () => {
    await json(
        await admin.send('PUT', `${API}/draft`, {
            tokens: { dark: { accent: '#56789a' } },
        })
    );
    await json(await admin.send('POST', `${API}/publish`, {}));

    const publishLogs = await auditEntries('plugin:custom-design:publish');
    assert.equal(publishLogs.length >= 1, true);
    assert.equal(publishLogs[0].details.includes('Akzentfarbe (Dunkel)'), true);

    await json(await admin.send('POST', `${API}/reset`, {}));
    const resetLogs = await auditEntries('plugin:custom-design:reset');
    assert.equal(resetLogs.length >= 1, true);
    assert.equal(resetLogs[0].details, 'Design auf Standard zurückgesetzt');
});
