/**
 * Server side of „Badges“: admins create badges and award them by hand or
 * by rule (participations when an event ends, check-ins, and a backfill when
 * a rule is saved); members see their badges on the profile.
 *
 * Every route is admin-only and lives below `/api/plugins/badges`; every
 * write goes through the engine's serial queue and is audited. Uses only
 * the `ctx` it is given and its own files.
 */
const { ICONS, MAX_BADGES, validateBadge, ruleText, isActive } = require('./rules');
const { createEngine, BADGES } = require('./engine');

const ADMIN = { access: 'admin' };
const MAX_ID_LENGTH = 128;

const MESSAGES = {
    notFound: 'Badge nicht gefunden.',
    tooMany: `Höchstens ${MAX_BADGES} Badges.`,
    role: 'Diese Rolle kann das Plugin nicht vergeben.',
    memberNotFound: 'Mitglied nicht gefunden.',
    alreadyHolds: 'Dieses Mitglied hat das Badge schon.',
    doesNotHold: 'Dieses Mitglied hat das Badge nicht.'
};

const nowIso = () => new Date().toISOString();
const isRuleBadge = badge => Boolean(badge.rule && badge.rule.type !== 'manual');
const sameRule = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
const isDocId = id => typeof id === 'string' && id.length >= 1 && id.length <= MAX_ID_LENGTH && !id.includes('/');
const distinctSorted = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'de'));

/**
 * @param {object} ctx -> The plugin context of the SDK.
 */
function register(ctx) {
    const engine = createEngine(ctx);

    /** @returns {Promise<object>} -> The badge; a 404 answer when there is none. */
    async function findBadge(id) {
        const badge = isDocId(id) ? await ctx.data.get(BADGES, id) : null;
        if (!badge) throw ctx.httpError(404, MESSAGES.notFound);
        return badge;
    }

    /** A badge as the admin page shows it, with its holder counts. */
    function toView(badge, awards) {
        const active = awards.filter(entry => entry.badgeId === badge.id && isActive(entry));
        return {
            id: badge.id,
            name: badge.name,
            description: badge.description,
            icon: badge.icon,
            color: badge.color,
            rule: badge.rule,
            ruleText: ruleText(badge.rule),
            roleId: badge.roleId,
            holders: active.length,
            unsynced: active.filter(entry => entry.roleSynced === false).length,
            createdAt: badge.createdAt
        };
    }

    /** Refuse a role the plugin may not use; only checked when the role changes. */
    async function checkRole(roleId) {
        if (roleId === null) return;
        const roles = await ctx.discord.listRoles();
        if (!roles.some(role => role.id === roleId)) throw ctx.httpError(400, MESSAGES.role);
    }

    /** @returns {object} -> Validated badge fields; a 400 answer with the German reason otherwise. */
    function readInput(body) {
        const result = validateBadge(body);
        if (!result.ok) throw ctx.httpError(400, result.error);
        return result.value;
    }

    async function memberName(userId) {
        const member = await ctx.members.get(userId);
        return member && member.name ? member.name : 'Unbekanntes Mitglied';
    }

    /** A backfill after an admin saved a rule: in the background, never inside the route's time. */
    function backfill(adminId) {
        engine.evaluate({ notify: false, by: adminId })
            .catch(err => ctx.log.error('Nachvergabe fehlgeschlagen:', err && err.message ? err.message : err));
    }

    ctx.profile.badges(({ userId }) => engine.profileBadges(userId));

    // Participations count once the event is over (archived)
    ctx.hooks.on('event.ended', async ({ event }) => {
        const registrations = await ctx.registrations.list({ eventId: event.id });
        const userIds = [...new Set(registrations.filter(entry => entry.status === 'accepted').map(entry => entry.userId))];
        await engine.evaluate({ userIds, notify: true });
    });

    ctx.hooks.on('registration.checkedIn', ({ registration }) => engine.evaluate({ userIds: [registration.userId], notify: true }));

    ctx.routes.get('/badges', ADMIN, async () => {
        const [badges, awards] = await Promise.all([engine.listBadges(), engine.listAwards()]);
        return badges.map(badge => toView(badge, awards));
    });

    ctx.routes.get('/meta', ADMIN, async () => {
        const [events, roles] = await Promise.all([ctx.events.list(), ctx.discord.listRoles()]);
        const text = value => (typeof value === 'string' ? value.trim() : '');
        return {
            icons: [...ICONS],
            categories: distinctSorted(events.map(event => text(event.category)).filter(Boolean)),
            roles,
            eventRoleIds: [...new Set(events.map(event => text(event.assignRoleId)).filter(Boolean))]
        };
    });

    ctx.routes.post('/badges', ADMIN, async ({ user, body }) => {
        const value = readInput(body);
        await checkRole(value.roleId);
        return engine.serial(async () => {
            if ((await engine.listBadges()).length >= MAX_BADGES) throw ctx.httpError(400, MESSAGES.tooMany);
            const at = nowIso();
            const badge = await ctx.data.add(BADGES, { ...value, createdAt: at, createdBy: user.id, updatedAt: at, updatedBy: user.id });
            await ctx.audit('badge.created', user.id, `Badge „${badge.name}“ angelegt`, badge.id);
            if (isRuleBadge(badge)) backfill(user.id);
            return toView(badge, []);
        });
    });

    ctx.routes.put('/badges/:id', ADMIN, async ({ user, params, body }) => {
        const value = readInput(body);
        const stored = await findBadge(params.id);
        if (value.roleId !== stored.roleId) await checkRole(value.roleId);
        return engine.serial(async () => {
            const badge = await ctx.data.update(BADGES, stored.id, { ...value, updatedAt: nowIso(), updatedBy: user.id });
            await ctx.audit('badge.updated', user.id, `Badge „${badge.name}“ geändert`, badge.id);
            if (isRuleBadge(badge) && !sameRule(badge.rule, stored.rule)) backfill(user.id);
            return toView(badge, await engine.awardsOfBadge(badge.id));
        });
    });

    ctx.routes.delete('/badges/:id', ADMIN, async ({ user, params }) => {
        const badge = await findBadge(params.id);
        await engine.serial(async () => {
            for (const entry of await engine.awardsOfBadge(badge.id)) await ctx.data.delete('awards', entry.id);
            await ctx.data.delete(BADGES, badge.id);
            await ctx.audit('badge.deleted', user.id, `Badge „${badge.name}“ gelöscht`, badge.id);
        });
        return { success: true };
    });

    ctx.routes.get('/badges/:id/holders', ADMIN, async ({ params }) => {
        const badge = await findBadge(params.id);
        const active = (await engine.awardsOfBadge(badge.id)).filter(isActive)
            .sort((a, b) => String(b.awardedAt).localeCompare(String(a.awardedAt)));
        return Promise.all(active.map(async entry => {
            const member = await ctx.members.get(entry.userId);
            return {
                userId: entry.userId,
                name: member && member.name ? member.name : 'Unbekanntes Mitglied',
                avatar: member ? member.avatar : '',
                awardedAt: entry.awardedAt,
                byRule: entry.awardedBy === 'rule',
                roleSynced: entry.roleSynced !== false
            };
        }));
    });

    ctx.routes.post('/badges/:id/awards', ADMIN, async ({ user, params, body }) => {
        const badge = await findBadge(params.id);
        const userId = body && typeof body.userId === 'string' ? body.userId : '';
        const member = isDocId(userId) ? await ctx.members.get(userId) : null;
        if (!member) throw ctx.httpError(404, MESSAGES.memberNotFound);
        await engine.serial(async () => {
            const existing = await engine.findAward(badge.id, userId);
            if (existing && isActive(existing)) throw ctx.httpError(400, MESSAGES.alreadyHolds);
            await engine.award({ badge, userId, by: user.id });
            await ctx.audit('badge.awarded', user.id, `Badge „${badge.name}“ an ${member.name} vergeben`, badge.id);
        });
        return { success: true };
    });

    ctx.routes.delete('/badges/:id/awards/:userId', ADMIN, async ({ user, params }) => {
        const badge = await findBadge(params.id);
        const { userId } = params;
        await engine.serial(async () => {
            const existing = isDocId(userId) ? await engine.findAward(badge.id, userId) : null;
            if (!existing || !isActive(existing)) throw ctx.httpError(400, MESSAGES.doesNotHold);
            await engine.revoke({ badge, userId, by: user.id });
            await ctx.audit('badge.revoked', user.id, `Badge „${badge.name}“ ${await memberName(userId)} entzogen`, badge.id);
        });
        return { success: true };
    });

    ctx.routes.get('/members', ADMIN, async ({ query }) => ctx.members.search(typeof query.q === 'string' ? query.q : ''));
}

module.exports = { register };
