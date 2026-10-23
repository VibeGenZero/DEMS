/**
 * Member overview for admins (W-15): participation numbers per member and one
 * member's complete history. Pure helpers without database access;
 * routes/admin.js loads users, registrations and events.
 *
 * Rules:
 * - Teilnahme: accepted registration of an event that is over (ended or
 *   archived), not cancelled, not deleted.
 * - No-Show: such a Teilnahme that is not checked in, but only for events
 *   with attendance tracking (check-in switched on, or anybody checked in).
 */
const { isEventOver, parseDate } = require('./eventListing');
const { toProfileEntry, byDateDescending } = require('./profileEvents');

const SOURCES = ['web', 'discord', 'admin'];

/**
 * Whether an event lies behind the members, for the numbers.
 *
 * @param {Object|undefined} event -> Event data, undefined when deleted.
 * @param {Date} now -> Reference time.
 * @returns {boolean} -> True for archived or ended events; never for cancelled or deleted ones.
 */
function isOver(event, now) {
    if (!event || event.status === 'cancelled') return false;
    return event.status === 'archived' || isEventOver(event, now);
}

/**
 * Events whose attendance was tracked.
 *
 * @param {Map<string, Object>} eventsById -> Event data by id.
 * @param {Array<Object>} registrations -> Registrations of all members (or at least of the events in question).
 * @returns {Set<string>} -> Ids of events with check-in switched on or at least one checked-in registration.
 */
function trackedEventIds(eventsById, registrations) {
    const tracked = new Set();
    for (const [id, event] of eventsById) {
        if (event && event.checkinEnabled) tracked.add(id);
    }
    for (const registration of registrations) {
        if (registration.checkedIn === true && registration.eventId) tracked.add(registration.eventId);
    }
    return tracked;
}

/**
 * Whether one registration is a no-show.
 *
 * @param {Object} registration -> Registration data.
 * @param {Object|undefined} event -> Its event.
 * @param {Set<string>} tracked -> Ids of tracked events.
 * @param {Date} now -> Reference time.
 * @returns {boolean}
 */
function isNoShow(registration, event, tracked, now) {
    return registration.status === 'accepted'
        && registration.checkedIn !== true
        && isOver(event, now)
        && tracked.has(registration.eventId);
}

/**
 * The four numbers of one member.
 *
 * @param {Array<Object>} registrations -> The member's registrations, every status.
 * @param {Map<string, Object>} eventsById -> Event data by id; deleted events are missing.
 * @param {Set<string>} tracked -> Ids of tracked events (trackedEventIds).
 * @param {Date} [now] -> Reference time.
 * @returns {{ registrations: number, attended: number, checkedIn: number, noShows: number }}
 */
function memberStats(registrations, eventsById, tracked, now = new Date()) {
    const stats = { registrations: registrations.length, attended: 0, checkedIn: 0, noShows: 0 };
    for (const registration of registrations) {
        const event = eventsById.get(registration.eventId);
        if (registration.checkedIn === true) stats.checkedIn += 1;
        if (registration.status === 'accepted' && isOver(event, now)) stats.attended += 1;
        if (isNoShow(registration, event, tracked, now)) stats.noShows += 1;
    }
    return stats;
}

/**
 * Last time a member did something we know of.
 *
 * @param {Object} user -> users document.
 * @param {Array<Object>} registrations -> The member's registrations.
 * @returns {string|null} -> ISO time of the latest of `updatedAt` and the registration times, null without a readable date.
 */
function lastActivity(user, registrations) {
    let latest = null;
    for (const value of [user.updatedAt, ...registrations.map(registration => registration.createdAt)]) {
        const date = parseDate(value);
        if (date && (!latest || date > latest)) latest = date;
    }
    return latest ? latest.toISOString() : null;
}

/**
 * Name shown for a member.
 *
 * @param {Object} user -> users document.
 * @returns {string} -> Display name, else username, else the Discord id.
 */
function memberName(user) {
    return String(user.displayName || user.username || user.id || '');
}

/**
 * Registrations grouped by user id.
 *
 * @param {Array<Object>} registrations -> Any registrations.
 * @returns {Map<string, Array<Object>>}
 */
function groupByUser(registrations) {
    const groups = new Map();
    for (const registration of registrations) {
        if (!groups.has(registration.userId)) groups.set(registration.userId, []);
        groups.get(registration.userId).push(registration);
    }
    return groups;
}

/**
 * Public fields of a member for the admin pages.
 *
 * @param {Object} user -> users document.
 * @param {Array<Object>} registrations -> The member's registrations.
 * @returns {Object} -> `{ id, username, displayName, avatar, createdAt, lastActiveAt }`.
 */
function memberBase(user, registrations) {
    return {
        id: String(user.id || ''),
        username: String(user.username || ''),
        displayName: memberName(user),
        avatar: String(user.avatar || ''),
        createdAt: user.createdAt || '',
        lastActiveAt: lastActivity(user, registrations)
    };
}

/**
 * The member list: one entry per users document, ordered by name.
 *
 * @param {Array<Object>} users -> users documents (with `id`).
 * @param {Array<Object>} registrations -> All registrations; those of unknown user ids are ignored.
 * @param {Map<string, Object>} eventsById -> All events by id.
 * @param {Date} [now] -> Reference time.
 * @returns {Array<Object>} -> memberBase() plus `stats`.
 */
function buildMemberList(users, registrations, eventsById, now = new Date()) {
    const tracked = trackedEventIds(eventsById, registrations);
    const byUser = groupByUser(registrations);
    return users
        .map(user => {
            const own = byUser.get(user.id) || [];
            return { ...memberBase(user, own), stats: memberStats(own, eventsById, tracked, now) };
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de') || a.id.localeCompare(b.id));
}

/**
 * One member's complete history, newest event first.
 *
 * @param {Array<Object>} registrations -> The member's registrations with `id`.
 * @param {Map<string, Object>} eventsById -> Their events by id; deleted events are missing.
 * @param {Set<string>} tracked -> Ids of tracked events.
 * @param {Date} [now] -> Reference time.
 * @returns {Array<Object>} -> toProfileEntry() plus `source` (web|discord|admin) and `noShow`. No form answers, guests or check-in codes.
 */
function buildMemberHistory(registrations, eventsById, tracked, now = new Date()) {
    return registrations
        .map(registration => {
            const event = eventsById.get(registration.eventId) || null;
            return {
                ...toProfileEntry(registration, event),
                source: SOURCES.includes(registration.source) ? registration.source : 'web',
                noShow: isNoShow(registration, event, tracked, now)
            };
        })
        .sort(byDateDescending);
}

module.exports = {
    trackedEventIds,
    memberStats,
    lastActivity,
    memberBase,
    buildMemberList,
    buildMemberHistory
};
