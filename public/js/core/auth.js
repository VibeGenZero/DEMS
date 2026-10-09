/**
 * Login state: /auth/me, logged-in/logged-out views, logout.
 */
import { state } from './state.js';
import { showToast } from './ui.js';
import { showFirstLoginModal } from '../pages/profile.js';
import { refreshPollBadge } from '../polls/polls.js';

// POST with CSRF token: the server no longer logs out on a plain GET
export async function logout() {
    try {
        const res = await fetch('/auth/logout', { method: 'POST', headers: { 'X-CSRF-TOKEN': state.csrfToken } });
        if (res.ok) {
            window.location.href = '/';
            return;
        }
    } catch { /* falls through to the toast */ }
    showToast('Abmelden fehlgeschlagen. Bitte lade die Seite neu und versuche es erneut.', 'danger');
}

export async function checkAuth() {
    try {
        const res = await fetch('/auth/me');
        if (res.ok) {
            const data = await res.json();
            // Stricter check: must have at least an ID
            if (data && data.id) {
                const isNewUser = data.isNewUser;
                state.currentUser = data;
                showLoggedIn();
                // Show first-login modal after a short delay so the UI renders first
                if (isNewUser) {
                    setTimeout(showFirstLoginModal, 800);
                }
            } else {
                state.currentUser = null;
                showLoggedOut();
            }
        } else {
            state.currentUser = null;
            showLoggedOut();
        }
    } catch {
        state.currentUser = null;
        showLoggedOut();
    }
}

export function showLoggedIn() {
    document.getElementById('login-btn-container').style.display = 'none';
    const userInfo = document.getElementById('user-info');
    userInfo.style.display = 'flex';

    const avatarEl = document.getElementById('user-avatar');
    if (state.currentUser.avatar) {
        avatarEl.src = state.currentUser.avatar;
        avatarEl.style.display = 'block'; // Ensure it's visible if we have a src

        // Add error handler if not already present (to hide broken images)
        if (!avatarEl.onerror) {
            avatarEl.onerror = function () {
                this.style.display = 'none';
            };
        }
    } else {
        avatarEl.style.display = 'none';
    }

    document.getElementById('user-name').textContent = state.currentUser.displayName;
    document.getElementById('nav-profile').style.display = 'block';
    document.getElementById('nav-polls').style.display = 'block';
    refreshPollBadge();

    if (state.currentUser.isAdmin) {
        document.getElementById('nav-admin').style.display = 'block';
        document.getElementById('nav-bot-control').style.display = 'block';
    }
}

export function showLoggedOut() {
    document.getElementById('login-btn-container').style.display = 'block';
    document.getElementById('user-info').style.display = 'none';
    document.getElementById('nav-admin').style.display = 'none';
    document.getElementById('nav-bot-control').style.display = 'none';
    document.getElementById('nav-profile').style.display = 'none';
    document.getElementById('nav-polls').style.display = 'none';

    // Clear sensitive data from UI
    document.getElementById('user-avatar').src = '';
    document.getElementById('user-name').textContent = '';
}

// Temporary bridge for inline handlers; D-01 replaces them with data-click and removes it
Object.assign(window, { logout });
