/**
 * Test plugin: records every hook into its `log` collection and offers a few
 * routes the server tests call (access rules, errors, the logged-in user).
 */
const HOOKS = [
    'event.created', 'event.published', 'event.updated', 'event.ended',
    'event.cancelled', 'event.deleted', 'member.deleted'
];

function register(ctx) {
    for (const name of HOOKS) {
        ctx.hooks.on(name, async payload => {
            await ctx.data.add('log', { hook: name, payload, at: new Date().toISOString() });
        });
    }

    ctx.routes.get('/log', { access: 'admin' }, async () => {
        const entries = await ctx.data.list('log');
        return entries.sort((a, b) => a.at.localeCompare(b.at));
    });
    ctx.routes.get('/me', { access: 'member' }, ({ user }) => ({ user }));
    ctx.routes.post('/me', { access: 'member' }, ({ user }) => ({ user }));
    ctx.routes.post('/boom', { access: 'member' }, () => {
        throw new Error('kaputt');
    });
    ctx.routes.post('/teapot', { access: 'member' }, () => {
        throw ctx.httpError(418, 'Ich bin eine Teekanne.');
    });
}

module.exports = { register };
