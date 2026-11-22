/**
 * Test plugin: records every hook into its `log` collection and offers a few
 * routes the server tests call (access rules, errors, the logged-in user,
 * documents owned by a member).
 */
const HOOKS = [
    'event.created', 'event.published', 'event.updated', 'event.ended',
    'event.cancelled', 'event.deleted', 'member.deleted', 'registration.checkedIn'
];

function register(ctx) {
    // Handlers run one after another, so the counter keeps the emission order
    // even when two hooks land in the same millisecond
    let seq = 0;
    for (const name of HOOKS) {
        ctx.hooks.on(name, async payload => {
            seq += 1;
            await ctx.data.add('log', { hook: name, payload, seq, at: new Date().toISOString() });
        });
    }

    // Profile badges (SDK 1.1): one valid badge with markup in its name, one with an unknown icon
    ctx.profile.badges(({ userId }) => [
        { id: 'probe', name: '<b>Probe</b>', description: `Testbadge für ${userId}`, icon: 'bi-bug', color: '#123456', unlocked: true },
        { id: 'nope', name: 'Kaputt', icon: 'nope', unlocked: true }
    ]);

    ctx.routes.get('/log', { access: 'admin' }, async () => {
        const entries = await ctx.data.list('log');
        return entries.sort((a, b) => a.seq - b.seq);
    });
    // Documents with the reserved `userId` field: account deletion must purge them
    ctx.routes.post('/owned', { access: 'member' }, ({ user }) => ctx.data.add('owned', { userId: user.id, note: 'gehört mir' }));
    ctx.routes.get('/owned', { access: 'admin' }, () => ctx.data.list('owned'));
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
