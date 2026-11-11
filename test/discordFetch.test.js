const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { discordFetch, checkClientCredentials, DISCORD_API } = require('../utils/discordFetch');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const answer = (status, body = {}) => ({ ok: status < 400, status, json: async () => body });

test('discordFetch retries a dropped connection and gives up on other errors', async () => {
    let calls = 0;
    global.fetch = async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        return answer(200);
    };
    assert.equal((await discordFetch(`${DISCORD_API}/x`)).status, 200);
    assert.equal(calls, 2);

    calls = 0;
    global.fetch = async () => { calls++; throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' }); };
    await assert.rejects(discordFetch(`${DISCORD_API}/x`), /nope/);
    assert.equal(calls, 1);
});

test('checkClientCredentials asks Discord with the client credentials grant (#138)', async () => {
    const seen = [];
    global.fetch = async (url, options) => { seen.push({ url, options }); return answer(200, { access_token: 't' }); };

    assert.deepEqual(await checkClientCredentials('123456789012345678', 's3cret'), { ok: true });
    assert.equal(seen[0].url, `${DISCORD_API}/oauth2/token`);
    assert.equal(seen[0].options.method, 'POST');
    assert.equal(seen[0].options.headers.Authorization, `Basic ${Buffer.from('123456789012345678:s3cret').toString('base64')}`);
    assert.match(String(seen[0].options.body), /grant_type=client_credentials/);
});

test('a rejected client id or secret answers invalid_client', async () => {
    global.fetch = async () => answer(401, { error: 'invalid_client' });
    assert.deepEqual(await checkClientCredentials('1', 'wrong'), { ok: false, error: 'invalid_client' });
    global.fetch = async () => answer(400, { error: 'invalid_client' });
    assert.deepEqual(await checkClientCredentials('1', 'wrong'), { ok: false, error: 'invalid_client' });
});

test('an unreachable Discord answers unreachable, missing values invalid_client', async () => {
    global.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await checkClientCredentials('1', 's'), { ok: false, error: 'unreachable' });
    global.fetch = async () => answer(503);
    assert.deepEqual(await checkClientCredentials('1', 's'), { ok: false, error: 'unreachable' });
    assert.deepEqual(await checkClientCredentials('', 's'), { ok: false, error: 'invalid_client' });
});
