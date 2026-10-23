/**
 * Member overview for admins (W-15): the list #members and one member's page
 * #member/<id>. Loads GET /api/admin/members(/:id); rules in
 * admin/member-rows.js, markup in admin/member-view.js.
 */
import { registerActions } from '../core/actions.js';
import { DEFAULT_MEMBER_SORT, MEMBER_SORT_KEYS, filterMemberRows, nextMemberSort, sortMemberRows } from './member-rows.js';
import {
    memberCountText, renderMemberDetail, renderMemberDetailError, renderMemberDetailSkeleton, renderMemberEmpty,
    renderMemberLoadError, renderMemberNotFound, renderMemberTable, renderMemberTableSkeleton
} from './member-view.js';

// Member the page shows; answers for another one are dropped
let detailMemberId = null;

/**
 * What the admin looks at in the list. It lives as long as the page: coming
 * back from a member keeps search and sorting.
 */
export const membersView = {
    // null until GET /api/admin/members has answered once
    members: null,
    search: '',
    sort: { ...DEFAULT_MEMBER_SORT }
};

/**
 * Draw count and table from membersView. Does nothing before the first answer.
 *
 * @param {Date} [now] -> Reference time.
 * @returns {void}
 */
export function renderMembers(now = new Date()) {
    if (!membersView.members) return;
    const { members, search, sort } = membersView;
    document.getElementById('members-count').textContent = memberCountText(members.length);
    const rows = sortMemberRows(filterMemberRows(members, search), sort);
    document.getElementById('members-table').innerHTML = rows.length
        ? renderMemberTable(rows, { sort, now })
        : renderMemberEmpty({ search });
}

/**
 * Load the list. Placeholders only before the first answer.
 *
 * @returns {Promise<void>}
 */
export async function loadMembers() {
    const table = document.getElementById('members-table');
    if (!membersView.members) table.innerHTML = renderMemberTableSkeleton();
    try {
        const res = await fetch('/api/admin/members');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        membersView.members = Array.isArray(data.members) ? data.members : [];
        renderMembers();
    } catch {
        membersView.members = null;
        document.getElementById('members-count').textContent = '';
        table.innerHTML = renderMemberLoadError();
    }
}

/**
 * Open the member list.
 *
 * @returns {Promise<void>}
 */
export async function showMembersSection() {
    document.getElementById('members-section').style.display = 'block';
    document.getElementById('members-search').value = membersView.search;
    await loadMembers();
}

export function searchMembers(text) {
    membersView.search = String(text ?? '');
    renderMembers();
}

export function resetMemberSearch() {
    document.getElementById('members-search').value = '';
    searchMembers('');
}

/**
 * Sort by a column; the same column again turns the direction.
 *
 * @param {string} key -> One of MEMBER_SORT_KEYS; anything else is ignored.
 * @returns {void}
 */
export function sortMembers(key) {
    if (!MEMBER_SORT_KEYS.includes(key)) return;
    membersView.sort = nextMemberSort(membersView.sort, key);
    renderMembers();
}

/**
 * Open one member's page.
 *
 * @param {string} id -> Discord user id from #member/<id>.
 * @returns {Promise<void>}
 */
export async function showMemberDetail(id) {
    document.getElementById('member-detail-section').style.display = 'block';
    const container = document.getElementById('member-detail');
    const memberId = String(id ?? '');
    detailMemberId = memberId;
    container.innerHTML = renderMemberDetailSkeleton();
    try {
        const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}`);
        if (detailMemberId !== memberId) return;
        if (res.status === 404) {
            container.innerHTML = renderMemberNotFound();
            return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const detail = await res.json();
        if (detailMemberId !== memberId) return;
        container.innerHTML = renderMemberDetail(detail);
    } catch {
        if (detailMemberId === memberId) container.innerHTML = renderMemberDetailError(memberId);
    }
}

registerActions({
    reloadMemberDetail: (el) => showMemberDetail(el.dataset.memberId),
    reloadMembers: () => loadMembers(),
    searchMembers: (el) => searchMembers(el.value),
    resetMemberSearch: () => resetMemberSearch(),
    sortMembers: (el) => sortMembers(el.dataset.sort)
});
