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
import { showSystemSection } from '../admin/system.js';
import { beginCardClose, landCardFlight } from '../events/card-flight.js';
import { showEventDetail } from '../events/detail.js';
import { showEventsSection } from '../events/list.js';
import { showDebugSection } from '../pages/debug.js';
import { showInfoSection } from '../pages/info.js';
import { showNewsSection } from '../pages/news.js';
import { showPrivacySection } from '../pages/privacy.js';
import { showProfileSection } from '../pages/profile.js';
import { showPollDetail, showPollsSection } from '../polls/polls.js';

// Discord messages sent before v2.5.1 link to #events/<id> instead of #event/<id>
export const LEGACY_EVENT_ROUTE = /^events\/(.+)$/;

// Pages without their own navbar link mark the link of their list
const NAV_ROUTE = { member: 'members', insights: 'admin', system: 'admin', news: 'info', privacy: 'info' };

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

// The page that is shown may veto leaving it (unsaved input); see setLeaveGuard
let leaveGuard = null;
let lastHash = null;
let guardPending = false;
// The page that is shown is told once when another route replaces it; see onRouteLeave
let leaveHandler = null;

const routeOf = (hash) => String(hash || '').split('/')[0];

/**
 * Let the shown page decide whether it may be left.
 *
 * The guard is asked once before another route or parameter is shown. An
 * answer at once (true or false) leaves the browser history alone. A promise
 * (a confirm dialog) puts the address of the shown page back while it waits.
 * A guard that answered true is used up: the page sets it again when it is
 * shown again.
 *
 * @param {Function|null} guard -> `({ route, param }) => boolean | Promise<boolean>`; false keeps the page. null removes the guard.
 * @returns {void}
 */
export function setLeaveGuard(guard) {
    leaveGuard = typeof guard === 'function' ? guard : null;
}

/**
 * Tell the shown page when another route is shown instead of it.
 *
 * Unlike the guard this cannot be vetoed and does not depend on it: the
 * callback runs once, before the other route is drawn. A change of the
 * parameter within the same route (`#system/a` -> `#system/b`) does not count.
 *
 * @param {Function|null} callback -> Called without arguments; null removes it.
 * @returns {void}
 */
export function onRouteLeave(callback) {
    leaveHandler = typeof callback === 'function' ? { route: routeOf(lastHash), callback } : null;
}

// The guard did not say yes at once: keep the shown page in the address; a promise may still allow the change
async function settleLeaveGuard(hash, answer) {
    history.replaceState(null, '', '#' + lastHash);
    if (!answer || typeof answer.then !== 'function') return;
    guardPending = true;
    let allowed = false;
    try {
        allowed = (await answer) === true;
    } finally {
        guardPending = false;
    }
    if (!allowed) return;
    leaveGuard = null;
    // Replaces the entry that was put back, so nothing is added to the history; the hash change routes
    window.location.replace('#' + hash);
}

/**
 * Show the section of the current hash.
 *
 * @returns {Promise<void>|void} -> For the overview and an event page: resolves once the section is drawn; with a leave guard: once it has answered.
 */
export function handleRoute() {
    let hash = window.location.hash.replace('#', '') || 'events';
    if (leaveGuard && lastHash !== null && hash !== lastHash) {
        // A second navigation while the question is open changes nothing
        if (guardPending) {
            history.replaceState(null, '', '#' + lastHash);
            return;
        }
        const [nextRoute, nextParam] = hash.split('/');
        const answer = leaveGuard({ route: nextRoute, param: nextParam });
        if (answer !== true) return settleLeaveGuard(hash, answer);
        leaveGuard = null;
    }

    // Clear countdown timers
    state.countdownTimers.forEach(t => clearInterval(t));
    state.countdownTimers = [];

    // Clear bot status refresh when navigating away
    if (state.botStatusRefreshInterval) {
        clearInterval(state.botStatusRefreshInterval);
        state.botStatusRefreshInterval = null;
    }

    const legacyEvent = hash.match(LEGACY_EVENT_ROUTE);
    if (legacyEvent) {
        hash = 'event/' + legacyEvent[1];
        history.replaceState(null, '', '#' + hash);
    }
    lastHash = hash;
    const parts = hash.split('/');
    const route = parts[0];
    const param = parts[1];

    if (leaveHandler && leaveHandler.route !== route) {
        const { callback } = leaveHandler;
        leaveHandler = null;
        callback();
    }

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

    // Info, the release notes and the privacy policy are public
    if (!state.currentUser && route !== 'login' && route !== 'info' && route !== 'news' && route !== 'privacy') {
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
        case 'system':
            if (state.currentUser && state.currentUser.isAdmin) {
                return showSystemSection(param);
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
        case 'news':
            showNewsSection();
            break;
        case 'privacy':
            showPrivacySection();
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
