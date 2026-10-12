/**
 * Profile page, account settings, first-login dialog.
 */
import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { registerActions } from '../core/actions.js';
import { applyStyleData, escapeHtml, showToast } from '../core/ui.js';

// Mirrors isEventVisibleTo in utils/eventUtils.js: the API answers 404 to
// non-admins for draft and archived events, so their page cannot be opened
export function canOpenEvent(event) {
    return !!event && (!!state.currentUser?.isAdmin || !['draft', 'archived'].includes(event.status));
}

export async function showProfileSection() {
    const section = document.getElementById('profile-section');
    section.style.display = 'block';

    if (!state.currentUser) return navigateTo('events');

    // Show loading state
    const header = document.getElementById('profile-header');
    const statsContainer = document.getElementById('profile-stats');
    const badgesContainer = document.getElementById('profile-badges');
    const regContainer = document.getElementById('profile-registrations');
    const emptyEl = document.getElementById('profile-empty');
    const badgeCountEl = document.getElementById('profile-badge-count');

    header.innerHTML = `
    <img src="${escapeHtml(state.currentUser.avatar)}" class="profile-avatar" alt="Avatar">
    <div>
      <div class="profile-name">${escapeHtml(state.currentUser.displayName)}</div>
      <div class="profile-meta">@${escapeHtml(state.currentUser.username)} · Discord ID: ${state.currentUser.id}</div>
    </div>
  `;

    statsContainer.innerHTML = Array(4).fill('').map(() => `
    <div class="stat-card"><div class="skeleton-block profile-stat-skeleton"></div></div>
  `).join('');
    badgesContainer.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-secondary spinner-border-sm"></div></div>';
    regContainer.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-secondary spinner-border-sm"></div></div>';
    emptyEl.style.display = 'none';

    try {
        const res = await fetch('/api/user/profile');
        const data = await res.json();
        if (window.VERBOSE_LOG) console.log('[VERBOSE] GET /api/user/profile', data);
        const { stats, badges, registrations, unlockedBadges, totalBadges } = data;

        // ── Stats Grid ──────────────────────────────────────
        const statItems = [
            { icon: 'bi-calendar-check', label: 'Events', value: stats.total, tone: 'text-accent' },
            { icon: 'bi-check-circle', label: 'Angenommen', value: stats.accepted, tone: 'text-success' },
            { icon: 'bi-qr-code', label: 'Eingecheckt', value: stats.checkedIn, tone: 'text-info' },
            { icon: 'bi-hourglass-split', label: 'Ausstehend', value: stats.pending, tone: 'text-warning' }
        ];

        statsContainer.innerHTML = statItems.map(s => `
      <div class="stat-card profile-stat-card">
        <div class="stat-icon"><i class="bi ${s.icon} ${s.tone}"></i></div>
        <div class="stat-value" data-target="${s.value}">0</div>
        <div class="stat-label">${s.label}</div>
      </div>
    `).join('');

        if (typeof gsap !== 'undefined') {
            // Animate stat counters
            statsContainer.querySelectorAll('.stat-value').forEach(el => {
                const target = parseInt(el.dataset.target) || 0;
                gsap.to(el, {
                    textContent: target,
                    duration: 1.2,
                    ease: 'power2.out',
                    snap: { textContent: 1 },
                    delay: 0.2
                });
            });

            gsap.from('.profile-stat-card', {
                y: 20, duration: 0.4,
                stagger: 0.08, ease: 'power3.out'
            });
        }

        // ── Badges ──────────────────────────────────────────
        badgeCountEl.textContent = `${unlockedBadges} / ${totalBadges} freigeschaltet`;

        badgesContainer.innerHTML = badges.map(badge => `
      <div class="profile-badge-card ${badge.unlocked ? 'unlocked' : 'locked'}">
        <div class="profile-badge-icon"${badge.unlocked ? ` data-style-color="${escapeHtml(badge.color)}" data-style-glow="${escapeHtml(badge.color)}"` : ''}>
          <i class="bi ${badge.icon}"></i>
        </div>
        <div class="profile-badge-name">${escapeHtml(badge.name)}</div>
        <div class="profile-badge-desc">${escapeHtml(badge.description)}</div>
        ${badge.progress !== undefined && !badge.unlocked ? `
          <div class="profile-badge-progress">
            <div class="profile-badge-progress-bar" data-style-width="${Math.round(badge.progress * 100)}" data-style-background="${escapeHtml(badge.color)}"></div>
          </div>
        ` : ''}
      </div>
    `).join('');
        applyStyleData(badgesContainer);

        if (typeof gsap !== 'undefined') {
            gsap.from('.profile-badge-card', {
                scale: 0.8, duration: 0.4,
                stagger: 0.06, ease: 'back.out(1.4)',
                delay: 0.3
            });
        }

        // ── Registrations ───────────────────────────────────
        const loadMoreWrapper = document.getElementById('profile-load-more-wrapper');
        const loadMoreBtn = document.getElementById('profile-load-more');

        if (!registrations.length) {
            regContainer.innerHTML = '';
            emptyEl.style.display = 'block';
            loadMoreWrapper.style.display = 'none';
        } else {
            const statusTexts = { pending: '⏳ Ausstehend', accepted: '✅ Angenommen', rejected: '❌ Abgelehnt', waitlisted: '📋 Warteliste' };
            const PAGE_SIZE = 5;
            let visibleCount = PAGE_SIZE;

            function renderRegCards() {
                const slice = registrations.slice(0, visibleCount);
                regContainer.innerHTML = slice.map(reg => `
        <div class="profile-reg-card${canOpenEvent(reg.event) ? '' : ' profile-reg-card-static'}" ${canOpenEvent(reg.event) ? `data-click="navigateTo" data-route="event/${escapeHtml(reg.event.id)}"` : ''}>
          <div class="profile-reg-info">
            <h6>${reg.event ? escapeHtml(reg.event.title) : '<span class="text-muted">Gelöschtes Event</span>'}</h6>
            <small>
              ${reg.createdAt ? new Date(reg.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
              ${reg.event && reg.event.category ? ` · ${escapeHtml(reg.event.category)}` : ''}
              ${reg.checkedIn ? ' · <span class="text-success">✓ Eingecheckt</span>' : ''}
            </small>
          </div>
          <span class="badge-pill status-${reg.status}">
            ${statusTexts[reg.status] || reg.status}
          </span>
        </div>
      `).join('');

                loadMoreWrapper.style.display = visibleCount < registrations.length ? 'block' : 'none';
            }

            renderRegCards();

            loadMoreBtn.onclick = () => {
                const prevCount = visibleCount;
                visibleCount = Math.min(visibleCount + PAGE_SIZE, registrations.length);
                renderRegCards();

                if (typeof gsap !== 'undefined') {
                    const newCards = Array.from(regContainer.querySelectorAll('.profile-reg-card')).slice(prevCount);
                    gsap.from(newCards, { y: 15, duration: 0.3, stagger: 0.05, ease: 'power3.out' });
                }
            };

            if (typeof gsap !== 'undefined') {
                gsap.from('.profile-reg-card', {
                    y: 15, duration: 0.3,
                    stagger: 0.05, ease: 'power3.out',
                    delay: 0.5
                });
            }
        }

        // Animate the header card
        if (typeof gsap !== 'undefined') {
            gsap.from('#profile-header-card', {
                y: 20, duration: 0.5, ease: 'power3.out'
            });
        }

        // Load account settings
        await loadAccountSettings();

        // ── Debug Card ──────────────────────────────────────
        if (window.DEBUG_MODE) {
            const wrapper = document.getElementById('debug-card-wrapper');
            wrapper.style.display = 'block';

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

    } catch {
        regContainer.innerHTML = '<div class="alert alert-danger">Fehler beim Laden des Profils.</div>';
        statsContainer.innerHTML = '';
        badgesContainer.innerHTML = '';
    }
}

export function toggleVerboseLog(enabled) {
    window.VERBOSE_LOG = enabled;
    localStorage.setItem('dems_verbose_log', enabled ? 'true' : 'false');
    showToast(enabled ? '🐛 Verbose-Logging aktiviert' : 'Verbose-Logging deaktiviert', enabled ? 'warning' : 'secondary');
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
    if (!confirm('Bist du sicher? Dein Account und alle Registrierungen werden dauerhaft gelöscht.')) return;
    if (!confirm('Letzte Bestätigung: Account wirklich löschen?')) return;
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
    confirmInvitationPreference: (el) => confirmInvitationPreference(el.dataset.accept === 'true')
});
