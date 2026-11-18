const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resolveServerName } = require('../utils/serverName');

// Name of the community for the login page (/api/server-info) and the
// calendar feed: SERVER_NAME, else the Discord server name, else „DEMS“

const saved = { SERVER_NAME: process.env.SERVER_NAME, DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID };
afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

test('SERVER_NAME wins', async () => {
    process.env.SERVER_NAME = 'Raid-Gilde';
    process.env.DISCORD_GUILD_ID = '123';
    assert.equal(await resolveServerName({ getGuildName: async () => 'Discord-Name' }), 'Raid-Gilde');
});

test('without SERVER_NAME the Discord server name is used', async () => {
    delete process.env.SERVER_NAME;
    process.env.DISCORD_GUILD_ID = '123';
    let asked = '';
    assert.equal(await resolveServerName({ getGuildName: async (id) => { asked = id; return 'Discord-Name'; } }), 'Discord-Name');
    assert.equal(asked, '123');
});

test('without a name from Discord or without a server id it is „DEMS“', async () => {
    delete process.env.SERVER_NAME;
    process.env.DISCORD_GUILD_ID = '123';
    assert.equal(await resolveServerName({ getGuildName: async () => '' }), 'DEMS');
    delete process.env.DISCORD_GUILD_ID;
    assert.equal(await resolveServerName({ getGuildName: async () => { throw new Error('nicht gefragt'); } }), 'DEMS');
});
