/**
 * Starts server.js with a fake Discord HTTP API, so the real OAuth2 login of
 * routes/auth.js runs in tests without network access. Every code is
 * accepted; the user is FAKE_DISCORD_USER, a guild member without roles.
 * FAKE_DISCORD_PERMISSIONS sets the user's permission bitfield on the guild
 * as /users/@me/guilds reports it (default '0').
 */
const FAKE_DISCORD_USER = { id: '300000000000000001', username: 'oauth-tester', global_name: 'OAuth Tester', avatar: null };

const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (!href.startsWith('https://discord.com/api/')) return realFetch(url, options);
    if (href.endsWith('/oauth2/token')) return json({ access_token: 'fake-access-token', token_type: 'Bearer' });
    if (href.endsWith('/users/@me')) return json(FAKE_DISCORD_USER);
    if (href.endsWith('/users/@me/guilds')) {
        return json([{ id: process.env.DISCORD_GUILD_ID, name: 'Fake-Server', owner: false, permissions: process.env.FAKE_DISCORD_PERMISSIONS || '0' }]);
    }
    if (href.includes('/users/@me/guilds/')) return json({ roles: [] });
    return json({ message: 'Unbekannter Fake-Endpunkt' }, 404);
};

require('../../server');
