/**
 * Data side of „Badges“: badges, awards and the member's profile badges.
 *
 * Every write runs on one serial queue (`serial`), so two triggers for the
 * same member can never award a badge twice. Uses only the `ctx` it is given
 * and `rules.js`.
 */
const { awardId, isActive, progressFor, countFor, ruleText, dueAwards } = require('./rules');

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
 * @param {object} [options]
 * @param {(badge: object, award: object, options: { notify: boolean }) => void} [options.onAwarded] -> Called after an
 *   award is stored (roles and messages, see server.js); must not throw.
 * @returns {object} -> See the methods below.
 */
function createEngine(ctx, { onAwarded = () => {} } = {}) {
    const serial = createQueue();

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

    /**
     * Store an award (overwrites a revoked one). Call inside `serial`.
     *
     * @param {{ badge: object, userId: string, by: string }} input -> `by` = admin id or `'rule'`.
     * @returns {Promise<object>} -> The stored award.
     */
    async function award({ badge, userId, by }) {
        return ctx.data.set(AWARDS, awardId(badge.id, userId), {
            badgeId: badge.id,
            userId,
            awardedAt: nowIso(),
            awardedBy: by,
            roleAdded: false,
            roleSynced: !badge.roleId,
            revokedAt: null,
            revokedBy: null
        });
    }

    /**
     * Mark an award as revoked; it stays as a tombstone so a rule does not hand it back. Call inside `serial`.
     *
     * @returns {Promise<object>} -> The updated award.
     */
    async function revoke({ badge, userId, by }) {
        return ctx.data.update(AWARDS, awardId(badge.id, userId), { revokedAt: nowIso(), revokedBy: by });
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
                const stored = await award({ badge, userId, by: 'rule' });
                onAwarded(badge, stored, { notify });
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

    return { serial, listBadges, listAwards, awardsOfBadge, findAward, award, revoke, profileBadges, evaluate };
}

module.exports = { createEngine, createQueue, BADGES, AWARDS };
