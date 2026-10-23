/**
 * Hash router: handleRoute, navigateTo and the pending route before a login.
 */
import { registerActions } from './actions.js';
import { state } from './state.js';
import { placeNavMarker } from './tab-glider.js';
import { showBotControlSection } from '../admin/bot-control.js';
import { showAdminSection } from '../admin/dashboard.js';
import { showInsightsSection } from '../admin/insights.js';
import { showMemberDetail, showMembersSection } from '../admin/members.js';
import { beginCardClose, landCardFlight } from '../events/card-flight.js';
import { showEventDetail } from '../events/detail.js';
import { showEventsSection } from '../events/list.js';
import { showDebugSection } from '../pages/debug.js';
import { showInfoSection } from '../pages/info.js';
import { showProfileSection } from '../pages/profile.js';
import { showPollDetail, showPollsSection } from '../polls/polls.js';

// Discord messages sent before v2.5.1 link to #events/<id> instead of #event/<id>
export const LEGACY_EVENT_ROUTE = /^events\/(.+)$/;

// Pages without their own navbar link mark the link of their list
const NAV_ROUTE = { member: 'members', insights: 'admin' };

// Event a logged-out user opened -> shown after the Discord login
export const PENDING_ROUTE_KEY = 'dems_pending_route';

export const PENDING_ROUTE_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Remember the event a logged-out user opened, because the OAuth callback
 * always redirects to #events.
 */
export function rememberPendingRoute(route) {
    localStorage.setItem(PENDING_ROUTE_KEY, JSON.stringify({ route, savedAt: Date.now() }));
}

/**
 * Right after the login redirect (#events), go back to the event that was
 * opened before the login. A remembered event is used at most once.
 */
export function restorePendingRoute() {
    if (!state.currentUser) return;
    const stored = localStorage.getItem(PENDING_ROUTE_KEY);
    if (!stored) return;
    localStorage.removeItem(PENDING_ROUTE_KEY);

    let pending;
    try {
        pending = JSON.parse(stored);
    } catch {
        return;
    }
    const isFresh = Date.now() - pending.savedAt < PENDING_ROUTE_MAX_AGE_MS;
    const hash = window.location.hash.replace('#', '');
    if (isFresh && (hash === '' || hash === 'events')) {
        history.replaceState(null, '', '#' + pending.route);
    }
}

/**
 * Show the section of the current hash.
 *
 * @returns {Promise<void>|void} -> For the overview and an event page: resolves once the section is drawn.
 */
export function handleRoute() {
    // Clear countdown timers
    state.countdownTimers.forEach(t => clearInterval(t));
    state.countdownTimers = [];

    // Clear bot status refresh when navigating away
    if (state.botStatusRefreshInterval) {
        clearInterval(state.botStatusRefreshInterval);
        state.botStatusRefreshInterval = null;
    }

    let hash = window.location.hash.replace('#', '') || 'events';
    const legacyEvent = hash.match(LEGACY_EVENT_ROUTE);
    if (legacyEvent) {
        hash = 'event/' + legacyEvent[1];
        history.replaceState(null, '', '#' + hash);
    }
    const parts = hash.split('/');
    const route = parts[0];
    const param = parts[1];

    // A page opened by a card flight is copied before its section disappears
    const closingFlight = beginCardClose(route);

    document.querySelectorAll('.app-section').forEach(s => s.style.display = 'none');
    // The phone action bar of the event page also lifts the toasts; an event route sets it again
    document.getElementById('event-detail-section')?.classList.remove('has-action-bar');

    // Only the navbar: the tabs component (.nav.nav-pills) uses .nav-link too
    document.querySelectorAll('#main-navbar .nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-section') === (NAV_ROUTE[route] || route) + '-section') {
            link.classList.add('active');
        }
    });
    placeNavMarker();

    if (!state.currentUser && route !== 'login' && route !== 'info') {
        if ((route === 'event' || route === 'poll') && param) rememberPendingRoute(hash);
        document.getElementById('login-section').style.display = 'block';
        return;
    }

    switch (route) {
        case 'events': {
            const shown = showEventsSection();
            if (closingFlight) landCardFlight(shown);
            return shown;
        }
        case 'event':
            return showEventDetail(param);
        case 'polls':
            showPollsSection();
            break;
        case 'poll':
            showPollDetail(param);
            break;
        case 'profile':
            showProfileSection();
            break;
        case 'admin':
            if (state.currentUser && state.currentUser.isAdmin) {
                showAdminSection();
            } else {
                navigateTo('events');
            }
            break;
        case 'members':
            if (state.currentUser && state.currentUser.isAdmin) {
                showMembersSection();
            } else {
                navigateTo('events');
            }
            break;
        case 'insights':
            if (state.currentUser && state.currentUser.isAdmin) {
                showInsightsSection();
            } else {
                navigateTo('events');
            }
            break;
        case 'member':
            if (state.currentUser && state.currentUser.isAdmin) {
                showMemberDetail(param);
            } else {
                navigateTo('events');
            }
            break;
        case 'bot-control':
            if (state.currentUser && state.currentUser.isAdmin) {
                showBotControlSection();
            } else {
                navigateTo('events');
            }
            break;
        case 'info':
            showInfoSection();
            break;
        case 'debug':
            if (window.DEBUG_MODE) {
                showDebugSection();
            } else {
                navigateTo('events');
            }
            break;
        default:
            showEventsSection();
    }
}

export function navigateTo(route) {
    window.location.hash = '#' + route;
}

registerActions({ navigateTo: (el) => navigateTo(el.dataset.route) });
