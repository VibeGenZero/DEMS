/**
 * Data side of „Badges“: badges, awards, rule runs, the member's profile
 * badges, and the effects of an award (Discord role, DM, channel post).
 *
 * Two queues: every write runs on `serial`, so two triggers for the same
 * member can never award a badge twice; roles and messages run afterwards
 * on `effects`, in the background, so no route or hook waits for Discord.
 * A role is taken back only when this plugin gave it (`roleAdded`) and no
 * other active badge of the member carries the same role. Uses only the
 * `ctx` it is given and `rules.js`.
 */
const { awardId, isActive, progressFor, countFor, ruleText, dueAwards, awardDm, awardPost } = require('./rules');

const BADGES = 'badges';
const AWARDS = 'awards';

const nowIso = () => new Date().toISOString();
const byCreatedAt = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

/** Tasks run one after another; a failed task does not stop the next one. */
function createQueue() {
    let tail = Promise.resolve();
    return (task) => {
        const run = tail.then(task);
        tail = run.then(() => {}, () => {});
        return run;
    };
}

/**
 * @param {object} ctx -> The plugin context of the SDK.
 * @returns {object} -> See the methods below.
 */
function createEngine(ctx) {
    const serial = createQueue();
    const effectsQueue = createQueue();

    /** Run an effect in the background; an error is logged, never thrown. */
    function effect(what, task) {
        return effectsQueue(task).catch(err => ctx.log.error(`${what} fehlgeschlagen:`, err && err.message ? err.message : err));
    }

    /** @returns {Promise<object[]>} -> Every badge, oldest first. */
    async function listBadges() {
        return (await ctx.data.list(BADGES)).sort(byCreatedAt);
    }

    /** @returns {Promise<object[]>} -> Every award (also revoked ones). */
    const listAwards = () => ctx.data.list(AWARDS);

    /** @returns {Promise<object[]>} -> Awards of one badge (also revoked ones). */
    const awardsOfBadge = badgeId => ctx.data.where(AWARDS, 'badgeId', '==', badgeId);

    /** @returns {Promise<object|null>} -> The award of a badge to a member, revoked or not. */
    const findAward = (badgeId, userId) => ctx.data.get(AWARDS, awardId(badgeId, userId));

    /** Update an award that may have been deleted meanwhile (badge deleted, account deleted). */
    async function patchAward(id, patch) {
        if (await ctx.data.get(AWARDS, id)) await ctx.data.update(AWARDS, id, patch);
    }

    /** `ctx.discord.addRole/removeRole`; a role the guard refuses now counts as not done. */
    async function changeRole(give, userId, roleId) {
        try {
            return give ? await ctx.discord.addRole(userId, roleId) : await ctx.discord.removeRole(userId, roleId);
        } catch (err) {
            ctx.log.warn(`Rolle ${roleId} nicht ${give ? 'vergeben' : 'entzogen'}:`, err && err.message ? err.message : err);
            return { ok: false, reason: err && err.message ? err.message : String(err) };
        }
    }

    /** Give the badge's role for one award and remember whether this plugin gave it. */
    async function giveRole(roleId, award) {
        const result = await changeRole(true, award.userId, roleId);
        await patchAward(award.id, result.ok ? { roleAdded: result.changed, roleSynced: true } : { roleSynced: false });
    }

    /**
     * Take a role this plugin gave, unless another active badge of the member carries it; then that award owns it.
     *
     * @param {{ roleId: string, userId: string, awardDocId: string|null, roleAdded: boolean, exceptBadgeId: string }} input
     */
    async function releaseRole({ roleId, userId, awardDocId, roleAdded, exceptBadgeId }) {
        if (!roleId || !roleAdded) return;
        const [badges, awards] = await Promise.all([listBadges(), ctx.data.where(AWARDS, 'userId', '==', userId)]);
        const carriers = new Set(badges.filter(badge => badge.id !== exceptBadgeId && badge.roleId === roleId).map(badge => badge.id));
        const heir = awards.find(entry => isActive(entry) && carriers.has(entry.badgeId));
        if (heir) {
            await patchAward(heir.id, { roleAdded: true });
        } else {
            const result = await changeRole(false, userId, roleId);
            if (!result.ok) return;
        }
        if (awardDocId) await patchAward(awardDocId, { roleAdded: false });
    }

    /** DM and channel post for a new award, as the settings say. */
    async function announce(badge, userId) {
        const settings = await ctx.settings.get();
        if (settings.dmOnAward === true) {
            await ctx.discord.sendDM(userId, { text: awardDm(badge), link: { label: 'Zum Profil', url: ctx.siteUrl('profile') } });
        }
        if (settings.announceChannel) {
            const member = await ctx.members.get(userId);
            await ctx.discord.sendChannelMessage('announceChannel', { text: awardPost(member && member.name ? member.name : 'Ein Mitglied', badge) });
        }
    }

    /**
     * Store an award (overwrites a revoked one), then queue its role and messages. Call inside `serial`.
     *
     * @param {{ badge: object, userId: string, by: string, notify?: boolean }} input -> `by` = admin id or `'rule'`;
     *   `notify` sends DM and post (false for a backfill).
     * @returns {Promise<object>} -> The stored award.
     */
    async function award({ badge, userId, by, notify = false }) {
        const stored = await ctx.data.set(AWARDS, awardId(badge.id, userId), {
            badgeId: badge.id,
            userId,
            awardedAt: nowIso(),
            awardedBy: by,
            roleAdded: false,
            roleSynced: !badge.roleId,
            revokedAt: null,
            revokedBy: null
        });
        effect('Badge-Vergabe', async () => {
            if (badge.roleId) await giveRole(badge.roleId, stored);
            if (notify) await announce(badge, userId);
        });
        return stored;
    }

    /**
     * Mark an award as revoked (a tombstone, so a rule does not hand it back), then queue the role. Call inside `serial`.
     *
     * @returns {Promise<object>} -> The updated award.
     */
    async function revoke({ badge, userId, by }) {
        const updated = await ctx.data.update(AWARDS, awardId(badge.id, userId), { revokedAt: nowIso(), revokedBy: by });
        effect('Badge-Entzug', async () => {
            const current = await ctx.data.get(AWARDS, updated.id);
            if (!current) return;
            await releaseRole({ roleId: badge.roleId, userId, awardDocId: current.id, roleAdded: current.roleAdded === true, exceptBadgeId: badge.id });
        });
        return updated;
    }

    /**
     * Delete a badge and its awards, then take back the roles it gave. Call inside `serial`.
     *
     * @param {object} badge
     */
    async function removeBadge(badge) {
        const awards = await awardsOfBadge(badge.id);
        for (const entry of awards) await ctx.data.delete(AWARDS, entry.id);
        await ctx.data.delete(BADGES, badge.id);
        const given = awards.filter(entry => isActive(entry) && entry.roleAdded === true);
        if (!badge.roleId || given.length === 0) return;
        effect('Rollen eines gelöschten Badges', async () => {
            for (const entry of given) {
                await releaseRole({ roleId: badge.roleId, userId: entry.userId, awardDocId: null, roleAdded: true, exceptBadgeId: badge.id });
            }
        });
    }

    /**
     * After a badge's role changed: holders lose the old role (where this badge gave it) and get the new one.
     *
     * @param {object} badge -> The stored badge with the new `roleId`.
     * @param {string|null} oldRoleId
     */
    function moveRole(badge, oldRoleId) {
        effect('Rollenwechsel', async () => {
            for (const entry of (await awardsOfBadge(badge.id)).filter(isActive)) {
                await releaseRole({ roleId: oldRoleId, userId: entry.userId, awardDocId: entry.id, roleAdded: entry.roleAdded === true, exceptBadgeId: badge.id });
                if (badge.roleId) await giveRole(badge.roleId, entry);
                else await patchAward(entry.id, { roleAdded: false, roleSynced: true });
            }
        });
    }

    /**
     * Queue the role again for every active award whose role could not be given.
     *
     * @param {object} badge
     * @returns {Promise<number>} -> How many were queued.
     */
    async function retryRoles(badge) {
        if (!badge.roleId) return 0;
        const open = (await awardsOfBadge(badge.id)).filter(entry => isActive(entry) && entry.roleSynced === false);
        for (const entry of open) effect('Rolle erneut vergeben', () => giveRole(badge.roleId, entry));
        return open.length;
    }

    /**
     * The member's badges for the profile: earned ones, and rule badges not earned yet with their progress.
     * Manual badges not awarded and revoked badges are left out.
     *
     * @param {string} userId
     * @returns {Promise<object[]>} -> Entries for `ctx.profile.badges`.
     */
    async function profileBadges(userId) {
        const [badges, awards] = await Promise.all([listBadges(), ctx.data.where(AWARDS, 'userId', '==', userId)]);
        const needsCount = badges.some(badge => badge.rule && badge.rule.type !== 'manual'
            && !awards.some(entry => entry.badgeId === badge.id));
        let registrations = [];
        let eventsById = new Map();
        if (needsCount) {
            const [own, events] = await Promise.all([ctx.registrations.list({ userId }), ctx.events.list()]);
            registrations = own;
            eventsById = new Map(events.map(event => [event.id, event]));
        }
        const entries = [];
        for (const badge of badges) {
            const own = awards.find(entry => entry.badgeId === badge.id);
            const base = { id: badge.id, name: badge.name, description: badge.description || ruleText(badge.rule), icon: badge.icon, color: badge.color };
            if (own) {
                if (isActive(own)) entries.push({ ...base, unlocked: true });
                continue;
            }
            if (!badge.rule || badge.rule.type === 'manual') continue;
            entries.push({ ...base, unlocked: false, progress: progressFor(badge.rule, countFor(badge.rule, registrations, eventsById)) });
        }
        return entries;
    }

    /**
     * Award every rule badge that is due, inside `serial`; one audit entry per badge that awarded someone.
     *
     * @param {object} [input]
     * @param {string[]|null} [input.userIds] -> Only these members; null = everyone with a registration.
     * @param {boolean} [input.notify] -> DM and channel post for each new award (false for a backfill).
     * @param {string} [input.by] -> Who triggered it for the audit log: an admin id or 'system'.
     * @returns {Promise<Map<string, number>>} -> New awards per badge id.
     */
    function evaluate({ userIds = null, notify = false, by = 'system' } = {}) {
        return serial(async () => {
            const counts = new Map();
            if (Array.isArray(userIds) && userIds.length === 0) return counts;
            const single = Array.isArray(userIds) && userIds.length === 1;
            const [badges, awards, registrations, events] = await Promise.all([
                listBadges(), listAwards(), ctx.registrations.list(single ? { userId: userIds[0] } : {}), ctx.events.list()
            ]);
            for (const { badgeId, userId } of dueAwards({ badges, awards, registrations, events, userIds })) {
                const badge = badges.find(entry => entry.id === badgeId);
                await award({ badge, userId, by: 'rule', notify });
                counts.set(badgeId, (counts.get(badgeId) || 0) + 1);
            }
            for (const [badgeId, count] of counts) {
                const badge = badges.find(entry => entry.id === badgeId);
                const members = count === 1 ? '1 Mitglied' : `${count} Mitglieder`;
                await ctx.audit('badge.ruleAwarded', by, `Badge „${badge.name}“: ${members} automatisch ausgezeichnet`, badgeId);
            }
            return counts;
        });
    }

    return {
        serial, listBadges, listAwards, awardsOfBadge, findAward, award, revoke, removeBadge, moveRole, retryRoles,
        profileBadges, evaluate
    };
}

module.exports = { createEngine, createQueue, BADGES, AWARDS };
