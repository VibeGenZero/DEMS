/**
 * Guest search and selected guests of a registration.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml } from '../core/ui.js';

export let guestSearchTimer = null;

export function debounceGuestSearch() {
    clearTimeout(guestSearchTimer);
    guestSearchTimer = setTimeout(searchGuests, 300);
}

export async function searchGuests() {
    const input = document.getElementById('guest-search-input');
    const resultsEl = document.getElementById('guest-search-results');
    if (!input || !resultsEl) return;

    const q = input.value.trim();
    if (q.length < 2) {
        resultsEl.style.display = 'none';
        resultsEl.innerHTML = '';
        return;
    }

    try {
        const res = await fetch(`/api/user/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const users = await res.json();

        // Filter out already selected guests
        const filtered = users.filter(u => !state.selectedGuests.some(g => g.id === u.id));

        if (!filtered.length) {
            resultsEl.innerHTML = '<div class="list-group-item bg-dark text-muted small">Keine Nutzer gefunden</div>';
            resultsEl.style.display = 'block';
            return;
        }

        resultsEl.innerHTML = filtered.map(u => `
            <button type="button" class="list-group-item list-group-item-action bg-dark text-white border-secondary d-flex align-items-center gap-2"
                data-click="addGuestToList" data-user-id="${escapeHtml(u.id)}" data-display-name="${escapeHtml(u.displayName)}" data-avatar="${escapeHtml(u.avatar || '')}">
                <img src="${escapeHtml(u.avatar)}" width="28" height="28" class="rounded-circle" data-fallback="hide">
                <span>${escapeHtml(u.displayName)}</span>
                <small class="text-muted ms-1">@${escapeHtml(u.username)}</small>
            </button>
        `).join('');
        resultsEl.style.display = 'block';
    } catch (err) {
        console.error('Guest search error:', err);
    }
}

export function addGuestToList(user) {
    if (state.selectedGuests.some(g => g.id === user.id)) return;
    state.selectedGuests.push(user);
    renderSelectedGuests();

    // Clear search
    const input = document.getElementById('guest-search-input');
    const resultsEl = document.getElementById('guest-search-results');
    if (input) input.value = '';
    if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
}

export function removeGuestFromList(userId) {
    state.selectedGuests = state.selectedGuests.filter(g => g.id !== userId);
    renderSelectedGuests();
}

export function renderSelectedGuests() {
    const container = document.getElementById('selected-guests');
    if (!container) return;
    if (!state.selectedGuests.length) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = state.selectedGuests.map(g => `
        <div class="badge d-flex align-items-center gap-1 p-2" style="background:rgba(139,92,246,0.2);border:1px solid rgba(139,92,246,0.4);font-size:0.85rem;">
            <img src="${escapeHtml(g.avatar)}" width="18" height="18" class="rounded-circle" data-fallback="hide">
            <span>${escapeHtml(g.displayName)}</span>
            <button type="button" class="btn-close btn-close-white ms-1" style="font-size:0.6rem;"
                data-click="removeGuestFromList" data-user-id="${escapeHtml(g.id)}"></button>
        </div>
    `).join('');
}

// Reset guest selection when event detail is loaded
export function resetGuestSelection() {
    state.selectedGuests = [];
    renderSelectedGuests();
    const input = document.getElementById('guest-search-input');
    const resultsEl = document.getElementById('guest-search-results');
    if (input) input.value = '';
    if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
}

registerActions({
    debounceGuestSearch: () => debounceGuestSearch(),
    addGuestToList: (el) => addGuestToList({ id: el.dataset.userId, displayName: el.dataset.displayName, avatar: el.dataset.avatar }),
    removeGuestFromList: (el) => removeGuestFromList(el.dataset.userId)
});
