/**
 * Profile page (#profile): loads the profile and fills its areas; account
 * settings and the first-login dialog. Rows, card and badge list are built
 * by profile-view.js.
 */
import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { registerActions } from '../core/actions.js';
import { emptyState } from '../core/components.js';
import { applyStyleData, showConfirmDialog, showToast, toggleElement } from '../core/ui.js';
import {
    renderBadgeList, renderBadgeSkeleton, renderHistoryRow, renderProfileCard, renderProfileSkeleton, renderUpcomingRow
} from './profile-view.js';

// History rows shown at first and added by each "Weitere anzeigen"
const HISTORY_PAGE_SIZE = 5;
// History of the last answer and how many of its rows are shown
let profileHistory = [];
let historyVisible = HISTORY_PAGE_SIZE;

// Mirrors isEventVisibleTo in utils/eventUtils.js: the API answers 404 to
// non-admins for draft and archived events, so their page cannot be opened
export function canOpenEvent(event) {
    return !!event && (!!state.currentUser?.isAdmin || !['draft', 'archived'].includes(event.status));
}

/**
 * Show the profile page: placeholders first, then the answer of GET /api/user/profile.
 *
 * @returns {Promise<void>}
 */
export async function showProfileSection() {
    document.getElementById('profile-section').style.display = 'block';
    if (!state.currentUser) return navigateTo('events');

    const upcomingEl = document.getElementById('profile-upcoming');
    const badgesEl = document.getElementById('profile-badges');
    document.getElementById('profile-card').innerHTML = renderProfileCard(state.currentUser, null);
    document.getElementById('profile-upcoming-count').textContent = '';
    document.getElementById('profile-badge-count').textContent = '';
    upcomingEl.innerHTML = renderProfileSkeleton(3);
    badgesEl.innerHTML = renderBadgeSkeleton(4);
    toggleElement(document.getElementById('profile-history-block'), false);

    try {
        const res = await fetch('/api/user/profile');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (window.VERBOSE_LOG) console.log('[VERBOSE] GET /api/user/profile', data);
        renderProfile(data);
    } catch (err) {
        console.error('Failed to load the profile:', err);
        upcomingEl.innerHTML = emptyState({
            icon: 'exclamation-triangle',
            title: 'Profil konnte nicht geladen werden',
            text: 'Prüfe deine Verbindung und versuche es noch einmal.',
            action: '<button type="button" class="btn btn-accent" data-click="reloadProfile"><i class="bi bi-arrow-clockwise me-1"></i>Erneut versuchen</button>'
        });
        badgesEl.innerHTML = '';
    }

    await loadAccountSettings();
    showDebugCard();
}

/**
 * Fill card, upcoming events, badges and history from a profile answer.
 * Missing lists count as empty, so an incomplete answer still shows a page.
 *
 * @param {Object} data -> Answer of GET /api/user/profile.
 * @returns {void}
 */
function renderProfile(data) {
    const now = new Date();
    const upcoming = Array.isArray(data.upcoming) ? data.upcoming : [];
    const badges = Array.isArray(data.badges) ? data.badges : [];
    profileHistory = Array.isArray(data.history) ? data.history : [];
    historyVisible = HISTORY_PAGE_SIZE;

    document.getElementById('profile-card').innerHTML = renderProfileCard(state.currentUser, data.stats || {});
    document.getElementById('profile-upcoming-count').textContent = upcoming.length ? String(upcoming.length) : '';
    document.getElementById('profile-upcoming').innerHTML = upcoming.length
        ? upcoming.map(entry => renderUpcomingRow(entry, now, canOpenEvent(entry.event))).join('')
        : emptyState({
            icon: 'calendar-x',
            title: 'Noch nichts geplant',
            text: 'Melde dich für ein Event an, dann steht es hier.',
            action: '<a class="btn btn-accent" href="#events"><i class="bi bi-calendar-event me-1"></i>Events ansehen</a>'
        });

    const badgesEl = document.getElementById('profile-badges');
    badgesEl.innerHTML = renderBadgeList(badges);
    applyStyleData(badgesEl);
    document.getElementById('profile-badge-count').textContent = `${badges.filter(badge => badge.unlocked).length} von ${badges.length}`;

    renderProfileHistory();
}

/**
 * Show the first `historyVisible` rows of the history; without a history the block stays hidden.
 *
 * @returns {void}
 */
function renderProfileHistory() {
    toggleElement(document.getElementById('profile-history-block'), profileHistory.length > 0);
    document.getElementById('profile-history-count').textContent = profileHistory.length ? String(profileHistory.length) : '';
    document.getElementById('profile-history').innerHTML = profileHistory.slice(0, historyVisible)
        .map(entry => renderHistoryRow(entry, canOpenEvent(entry.event))).join('');
    toggleElement(document.getElementById('profile-history-more'), historyVisible < profileHistory.length);
}

/**
 * Show five more rows of the history; the rows are already loaded.
 *
 * @returns {void}
 */
export function showMoreProfileHistory() {
    historyVisible = Math.min(historyVisible + HISTORY_PAGE_SIZE, profileHistory.length);
    renderProfileHistory();
}

/**
 * Fill the debug card below the profile (only with DEBUG_MODE).
 *
 * @returns {void}
 */
function showDebugCard() {
    if (!window.DEBUG_MODE) return;
    document.getElementById('debug-card-wrapper').style.display = 'block';

    document.getElementById('debug-user-json').textContent =
        JSON.stringify(state.currentUser, null, 2);

    document.getElementById('debug-server-info').textContent =
        JSON.stringify({
            debugMode: window.DEBUG_MODE,
            guildId: window._demsGuildId,
            userAgent: navigator.userAgent.slice(0, 80),
            href: window.location.href,
        }, null, 2);

    const verboseToggle = document.getElementById('verbose-log-toggle');
    verboseToggle.checked = localStorage.getItem('dems_verbose_log') === 'true';
    window.VERBOSE_LOG = verboseToggle.checked;

    const collapseEl = document.getElementById('debug-collapse');
    collapseEl.addEventListener('show.bs.collapse', () => {
        document.getElementById('debug-chevron').style.transform = 'rotate(180deg)';
    });
    collapseEl.addEventListener('hide.bs.collapse', () => {
        document.getElementById('debug-chevron').style.transform = 'rotate(0deg)';
    });
}

export function toggleVerboseLog(enabled) {
    window.VERBOSE_LOG = enabled;
    localStorage.setItem('dems_verbose_log', enabled ? 'true' : 'false');
    showToast(enabled ? 'Verbose-Logging aktiviert' : 'Verbose-Logging deaktiviert', enabled ? 'warning' : 'info');
}

export async function loadAccountSettings() {
    try {
        const res = await fetch('/api/user/settings');
        if (!res.ok) return;
        const settings = await res.json();
        const toggle = document.getElementById('accept-invitations-toggle');
        if (toggle) toggle.checked = settings.acceptInvitations !== false;
    } catch (err) {
        console.error('Failed to load account settings:', err);
    }
}

export async function saveAccountSettings() {
    const toggle = document.getElementById('accept-invitations-toggle');
    if (!toggle) return;
    try {
        const res = await fetch('/api/user/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ acceptInvitations: toggle.checked })
        });
        if (res.ok) {
            showToast(toggle.checked ? 'Einladungen aktiviert' : 'Einladungen deaktiviert', 'success');
        }
    } catch (err) {
        console.error('Failed to save account settings:', err);
    }
}

export async function deleteUserAccount() {
    const confirmed = await showConfirmDialog(
        'Account und alle Anmeldungen dauerhaft löschen? Das lässt sich nicht rückgängig machen.', 'Account löschen');
    if (!confirmed) return;
    try {
        const res = await fetch('/api/user/account', {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        if (res.ok) {
            showToast('Account erfolgreich gelöscht.', 'success');
            // DELETE /api/user/account already ended the session
            setTimeout(() => { window.location.href = '/'; }, 1500);
        } else {
            showToast('Fehler beim Löschen des Accounts.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export function showFirstLoginModal() {
    const modal = new bootstrap.Modal(document.getElementById('firstLoginModal'));
    modal.show();
}

export async function confirmInvitationPreference(accept) {
    try {
        await fetch('/api/user/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ acceptInvitations: accept })
        });
    } catch (err) {
        console.error('Failed to save invitation preference:', err);
    }
    const modalEl = document.getElementById('firstLoginModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    showToast(accept ? 'Du kannst jetzt Gäste-Einladungen erhalten.' : 'Einladungen wurden deaktiviert. Du kannst das in deinem Profil ändern.', 'info');
}

registerActions({
    saveAccountSettings: () => saveAccountSettings(),
    deleteUserAccount: () => deleteUserAccount(),
    toggleVerboseLog: (el) => toggleVerboseLog(el.checked),
    confirmInvitationPreference: (el) => confirmInvitationPreference(el.dataset.accept === 'true'),
    showMoreProfileHistory: () => showMoreProfileHistory(),
    reloadProfile: () => showProfileSection()
});
