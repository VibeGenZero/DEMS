/**
 * Rules of the member list (#members, W-15): search and sorting. Pure
 * functions without DOM; admin/members.js keeps the state, admin/member-view.js
 * draws the rows.
 */

export const MEMBER_SORT_KEYS = ['name', 'registrations', 'attended', 'checkedIn', 'noShows', 'lastActive'];

export const DEFAULT_MEMBER_SORT = { key: 'name', direction: 'asc' };

const nameOf = (member) => String(member.displayName || member.username || member.id || '');
const byName = (a, b) => nameOf(a).localeCompare(nameOf(b), 'de', { sensitivity: 'base' }) || String(a.id).localeCompare(String(b.id));

/**
 * Value of a member in one sort column.
 *
 * @param {Object} member -> List entry of GET /api/admin/members.
 * @param {string} key -> A number key or "lastActive".
 * @returns {number} -> Number or time in ms; -Infinity without a last activity.
 */
function sortValue(member, key) {
    if (key === 'lastActive') {
        const time = member.lastActiveAt ? new Date(member.lastActiveAt).getTime() : NaN;
        return Number.isNaN(time) ? -Infinity : time;
    }
    return Number(member.stats && member.stats[key]) || 0;
}

/**
 * Members that match a search.
 *
 * @param {Array<Object>} members -> List entries.
 * @param {string} search -> Text the admin typed.
 * @returns {Array<Object>} -> Entries whose display name, username or Discord id contain the text (case-insensitive); all for an empty search.
 */
export function filterMemberRows(members, search) {
    const needle = String(search ?? '').trim().toLocaleLowerCase('de');
    if (!needle) return members.slice();
    return members.filter(member => [member.displayName, member.username, member.id]
        .some(value => String(value ?? '').toLocaleLowerCase('de').includes(needle)));
}

/**
 * Members in the chosen order.
 *
 * @param {Array<Object>} members -> List entries; the array is not changed.
 * @param {{ key: string, direction: 'asc'|'desc' }} sort -> Column and direction.
 * @returns {Array<Object>} -> New array; equal values keep name order (A–Z).
 */
export function sortMemberRows(members, sort) {
    const key = MEMBER_SORT_KEYS.includes(sort && sort.key) ? sort.key : DEFAULT_MEMBER_SORT.key;
    const factor = sort && sort.direction === 'desc' ? -1 : 1;
    return members.slice().sort((a, b) => {
        if (key === 'name') return factor * byName(a, b);
        const valueA = sortValue(a, key);
        const valueB = sortValue(b, key);
        const order = valueA === valueB ? 0 : (valueA < valueB ? -1 : 1);
        return factor * order || byName(a, b);
    });
}

/**
 * Sorting after a click on a column head.
 *
 * @param {{ key: string, direction: string }} current -> Sorting shown now.
 * @param {string} key -> Clicked column.
 * @returns {{ key: string, direction: 'asc'|'desc' }} -> The same column flips; a new one starts A–Z for the name and highest/newest first otherwise.
 */
export function nextMemberSort(current, key) {
    if (current && current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    return { key, direction: key === 'name' ? 'asc' : 'desc' };
}
