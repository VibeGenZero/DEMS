/**
 * Release notes (D-13): loads /api/updates once, sets the version badge and
 * the unread dot on the Info link, and shows the "Neuigkeiten & Updates" popup
 * with the top features once per version, only after login (core/auth.js).
 * A version the browser meets for the first time gets a small effect
 * (update-effects.js). Markup rules in pages/news-view.js.
 */
import { registerActions } from './actions.js';
import { toggleElement } from './ui.js';
import { celebrateUpdate } from './update-effects.js';
import { normalizeReleases, popupEntries, renderNewsPopup } from '../pages/news-view.js';

/** Version the popup was closed for (kept; e2e/helpers.js pre-sets it). */
const SEEN_KEY = 'dems_last_seen_version';
/** Version whose page "Was ist neu" was opened. */
const READ_KEY = 'dems_news_read_version';

let newsPromise = null;
// Fallback when the storage throws: the popup still opens at most once per page load
const seenThisPage = new Set();

function readKey(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function writeKey(key, value) {
    try { localStorage.setItem(key, value); } catch { /* blocked storage: per page only */ }
}

/**
 * Load the release notes once; later callers get the same promise.
 *
 * @returns {Promise<{ version: string, releases: Array<Object> }>} -> Empty notes when loading fails.
 */
export function getNews() {
    if (!newsPromise) {
        newsPromise = fetch('/api/updates')
            .then(res => (res.ok ? res.json() : null))
            .then(normalizeReleases)
            .catch(err => {
                console.error('Failed to load updates:', err);
                newsPromise = null;
                return normalizeReleases(null);
            });
    }
    return newsPromise;
}

/**
 * Show or hide the unread dot on the Info link.
 *
 * @param {string} version -> Current version.
 * @returns {void}
 */
export function updateNewsBadge(version) {
    const badge = document.getElementById('nav-info-badge');
    if (badge) toggleElement(badge, Boolean(version) && readKey(READ_KEY) !== version);
}

/**
 * The page "Was ist neu" was opened: the current version counts as read.
 *
 * @param {string} version -> Current version.
 * @returns {void}
 */
export function markNewsRead(version) {
    if (!version) return;
    writeKey(READ_KEY, version);
    updateNewsBadge('');
}

/**
 * Boot: version badge of the info page and the unread dot. Never opens the popup.
 *
 * @returns {Promise<void>}
 */
export async function loadUpdates() {
    const { version } = await getNews();
    if (!version) return;
    const badge = document.getElementById('info-version');
    if (badge) badge.textContent = `v${version}`;
    updateNewsBadge(version);
}

function markVersionSeen(version) {
    seenThisPage.add(version);
    writeKey(SEEN_KEY, version);
}

/**
 * Open the popup with the top features of the current release.
 *
 * @param {Object} release -> Normalized current release.
 * @returns {void}
 */
function openNewsPopup(release) {
    const modalEl = document.getElementById('updatesModal');
    document.getElementById('updates-version-badge').textContent = release.version;
    document.getElementById('updates-content').innerHTML = renderNewsPopup(popupEntries(release));
    // Closing in any way counts as seen
    modalEl.addEventListener('hidden.bs.modal', () => markVersionSeen(release.version), { once: true });
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    celebrateUpdate(release.version);
}

/**
 * After login: the popup once per version; a new member gets the welcome dialog instead.
 *
 * @param {Object} [options] -> `{ isNewUser }` of /auth/me.
 * @returns {Promise<void>}
 */
export async function showNewsAfterLogin({ isNewUser = false } = {}) {
    const { version, releases } = await getNews();
    const current = releases[0];
    if (!version || !current) return;
    if (isNewUser) {
        markVersionSeen(version);
        return;
    }
    if (seenThisPage.has(version) || readKey(SEEN_KEY) === version) return;
    if (!popupEntries(current).length) return;
    seenThisPage.add(version);
    openNewsPopup(current);
}

/**
 * "Alle Neuigkeiten": close the popup (counts as seen) and open the page.
 * Sets the hash itself like router.js#navigateTo, which would import this module back.
 *
 * @returns {void}
 */
export function openAllNews() {
    const modalEl = document.getElementById('updatesModal');
    bootstrap.Modal.getInstance(modalEl)?.hide();
    window.location.hash = '#news';
}

registerActions({ openAllNews: () => openAllNews() });
