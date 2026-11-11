/**
 * Starts server.js in setup mode (#138) with a fake Discord: the OAuth2 check
 * of the client id/secret always passes, and the bot "logs in" at once on a
 * fake guild with a few roles, channels and categories. Used by the browser
 * test of the setup wizard (e2e/setup.spec.js).
 */
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (!href.startsWith('https://discord.com/api/')) return realFetch(url, options);
    if (href.endsWith('/oauth2/token')) return json({ access_token: 'fake-access-token', token_type: 'Bearer' });
    return json({ message: 'Unbekannter Fake-Endpunkt' }, 404);
};

const FAKE_GUILD = {
    name: 'Fake-Gilde',
    roles: [{ id: '310000000000000001', name: 'Orga', color: 0, managed: false }, { id: '310000000000000002', name: 'DEMS-Bot', color: 0, managed: true }],
    channels: [{ id: '320000000000000001', name: 'ankündigungen', type: 'text' }, { id: '320000000000000002', name: 'Lobby', type: 'voice' }],
    categories: [{ id: '330000000000000001', name: 'Events' }]
};

// routes/setup.js calls these through require('./bot') at request time
const bot = require('../../bot');
Object.assign(bot, {
    // The start of server.js logs the bot in with the stored token: never against the real Discord
    startBot: async () => false,
    restartBot: async () => ({ ok: true, guildName: FAKE_GUILD.name }),
    getGuildName: async () => FAKE_GUILD.name,
    getGuildRoles: async () => FAKE_GUILD.roles,
    getGuildChannels: async () => FAKE_GUILD.channels,
    getGuildCategories: async () => FAKE_GUILD.categories
});

require('../../server');
