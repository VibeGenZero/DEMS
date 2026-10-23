/**
 * Evaluations for admins (W-14): attendance and no-show rates, occupancy,
 * most active members and categories over a time range. Pure helpers without
 * database access; routes/admin.js loads users, registrations and events.
 *
 * The attendance rules ("over", "tracked") come from memberOverview.js (W-15).
 */
const { parseDate } = require('./eventListing');
const { placesOf } = require('./capacity');
const { isOver, trackedEventIds } = require('./memberOverview');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Range key -> days back from now; `all` has no limit. */
const RANGES = { '30': 30, '90': 90, '365': 365, all: null };
const DEFAULT_RANGE = '90';
const TOP_MEMBERS = 10;
const NO_CATEGORY = 'Ohne Kategorie';

/**
 * Whether a range key is known.
 *
 * @param {*} range -> Value of `?range=`.
 * @returns {boolean}
 */
function isValidRange(range) {
    return typeof range === 'string' && Object.hasOwn(RANGES, range);
}

/**
 * Share in whole percent.
 *
 * @param {number} part -> Counted part.
 * @param {number} whole -> Base.
 * @returns {number|null} -> 0–100, null without a base.
 */
function rate(part, whole) {
    return whole > 0 ? Math.round((part / whole) * 100) : null;
}

const startTime = (event) => {
    const start = parseDate(event.startDate);
    return start ? start.getTime() : null;
};

/**
 * Events the evaluation looks at.
 *
 * @param {Map<string, Object>} eventsById -> All events by id.
 * @param {string} range -> Key of RANGES.
 * @param {Date} [now] -> Reference time.
 * @returns {Array<[string, Object]>} -> Over, not cancelled events whose start lies in the range (undated ones only for `all`), newest start first, undated last.
 */
function evaluatedEvents(eventsById, range, now = new Date()) {
    const days = RANGES[range];
    const from = days === null || days === undefined ? null : now.getTime() - days * DAY_MS;
    return [...eventsById]
        .filter(([, event]) => {
            if (!isOver(event, now)) return false;
            if (from === null) return true;
            const start = startTime(event);
            return start !== null && start >= from && start <= now.getTime();
        })
        .sort(([, a], [, b]) => (startTime(b) ?? -Infinity) - (startTime(a) ?? -Infinity));
}

/**
 * Numbers of one evaluated event.
 *
 * @param {string} id -> Event id.
 * @param {Object} event -> Event data.
 * @param {Array<Object>} registrations -> Its registrations.
 * @param {boolean} tracked -> Whether attendance was recorded.
 * @returns {Object} -> Row of the event table; nothing secret.
 */
function eventRow(id, event, registrations, tracked) {
    const accepted = registrations.filter(registration => registration.status === 'accepted');
    const checkedIn = accepted.filter(registration => registration.checkedIn === true).length;
    const placesOffered = Number(event.maxParticipants) > 0 ? Number(event.maxParticipants) : 0;
    const placesTaken = accepted.reduce((sum, registration) => sum + placesOf(registration), 0);
    return {
        id,
        title: String(event.title || ''),
        startDate: event.startDate || '',
        category: String(event.category || '').trim(),
        accepted: accepted.length,
        checkedIn,
        noShows: tracked ? accepted.length - checkedIn : null,
        attendanceRate: tracked ? rate(checkedIn, accepted.length) : null,
        placesTaken,
        placesOffered,
        occupancyRate: placesOffered > 0 ? rate(placesTaken, placesOffered) : null
    };
}

/**
 * Members with the most Teilnahmen.
 */
function topMembers(rows, registrationsByEvent, users) {
    const profiles = new Map(users.map(user => [user.id, user]));
    const counts = new Map();
    for (const row of rows) {
        for (const registration of registrationsByEvent.get(row.id) || []) {
            if (registration.status !== 'accepted' || !registration.userId) continue;
            const entry = counts.get(registration.userId) || { attended: 0, checkedIn: 0, fallbackName: registration.userName };
            entry.attended += 1;
            if (registration.checkedIn === true) entry.checkedIn += 1;
            counts.set(registration.userId, entry);
        }
    }
    return [...counts]
        .map(([id, entry]) => {
            const profile = profiles.get(id);
            const name = String((profile && (profile.displayName || profile.username)) || entry.fallbackName || id);
            return { id, name, attended: entry.attended, checkedIn: entry.checkedIn, hasProfile: !!profile };
        })
        .sort((a, b) => b.attended - a.attended || b.checkedIn - a.checkedIn || a.name.localeCompare(b.name, 'de'))
        .slice(0, TOP_MEMBERS);
}

/**
 * Categories of the evaluated events.
 */
function categoryList(rows, registrationsByEvent, tracked) {
    const groups = new Map();
    for (const row of rows) {
        const key = row.category.toLocaleLowerCase('de');
        if (!groups.has(key)) {
            groups.set(key, { label: row.category || NO_CATEGORY, events: 0, registrations: 0, accepted: 0, trackedAccepted: 0, trackedCheckedIn: 0 });
        }
        const group = groups.get(key);
        group.events += 1;
        group.registrations += (registrationsByEvent.get(row.id) || []).length;
        group.accepted += row.accepted;
        if (tracked.has(row.id)) {
            group.trackedAccepted += row.accepted;
            group.trackedCheckedIn += row.checkedIn;
        }
    }
    const list = [...groups.values()];
    const largest = Math.max(0, ...list.map(group => group.events));
    return list
        .map(group => ({
            label: group.label,
            events: group.events,
            registrations: group.registrations,
            averageAccepted: Math.round((group.accepted / group.events) * 10) / 10,
            attendanceRate: rate(group.trackedCheckedIn, group.trackedAccepted),
            share: rate(group.events, largest) ?? 0
        }))
        .sort((a, b) => b.events - a.events || b.registrations - a.registrations || a.label.localeCompare(b.label, 'de'));
}

/**
 * The whole evaluation for one range.
 *
 * @param {Object} input -> `{ users, registrations, eventsById, range, now }`.
 * @returns {Object} -> `{ range, totals, members, categories, events }`; rates are whole percent or null.
 */
function buildInsights({ users = [], registrations = [], eventsById, range = DEFAULT_RANGE, now = new Date() }) {
    const tracked = trackedEventIds(eventsById, registrations);
    const registrationsByEvent = new Map();
    for (const registration of registrations) {
        if (!registrationsByEvent.has(registration.eventId)) registrationsByEvent.set(registration.eventId, []);
        registrationsByEvent.get(registration.eventId).push(registration);
    }

    const rows = evaluatedEvents(eventsById, range, now)
        .map(([id, event]) => eventRow(id, event, registrationsByEvent.get(id) || [], tracked.has(id)));

    const trackedRows = rows.filter(row => tracked.has(row.id));
    const trackedAccepted = trackedRows.reduce((sum, row) => sum + row.accepted, 0);
    const trackedCheckedIn = trackedRows.reduce((sum, row) => sum + row.checkedIn, 0);
    const limited = rows.filter(row => row.placesOffered > 0);
    const placesTaken = limited.reduce((sum, row) => sum + row.placesTaken, 0);
    const placesOffered = limited.reduce((sum, row) => sum + row.placesOffered, 0);
    const attendanceRate = rate(trackedCheckedIn, trackedAccepted);

    return {
        range,
        totals: {
            events: rows.length,
            trackedEvents: trackedRows.length,
            accepted: rows.reduce((sum, row) => sum + row.accepted, 0),
            checkedIn: rows.reduce((sum, row) => sum + row.checkedIn, 0),
            attendanceRate,
            noShowRate: attendanceRate === null ? null : 100 - attendanceRate,
            placesTaken,
            placesOffered,
            occupancyRate: rate(placesTaken, placesOffered)
        },
        members: topMembers(rows, registrationsByEvent, users),
        categories: categoryList(rows, registrationsByEvent, tracked),
        events: rows
    };
}

module.exports = { RANGES, DEFAULT_RANGE, isValidRange, evaluatedEvents, buildInsights };
