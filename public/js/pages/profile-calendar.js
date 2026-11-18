/**
 * Block „Kalender-Abo“ of the profile settings (calendar-subscription): the
 * member's personal iCalendar link for Google, Apple and Outlook Calendar.
 * GET/POST/DELETE /api/user/calendar; profile.js loads it with the settings.
 * Link values go into DOM properties and attributes, never into HTML.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { showConfirmDialog, showToast, toggleElement } from '../core/ui.js';

const ENDPOINT = '/api/user/calendar';
// Shown link of the current answer, for „Kopieren“
let currentUrl = '';

/**
 * Show the answer of the calendar endpoint.
 *
 * @param {Object} feed -> `{ enabled: false }` or `{ enabled: true, url, webcalUrl, googleUrl }`.
 * @returns {void}
 */
function renderCalendarSubscription(feed) {
    const enabled = !!(feed && feed.enabled);
    currentUrl = enabled ? String(feed.url || '') : '';
    const urlInput = document.getElementById('calendar-feed-url');
    if (urlInput) urlInput.value = currentUrl;
    document.getElementById('calendar-feed-google')?.setAttribute('href', enabled ? String(feed.googleUrl || '#') : '#');
    document.getElementById('calendar-feed-webcal')?.setAttribute('href', enabled ? String(feed.webcalUrl || '#') : '#');
    const off = document.getElementById('calendar-feed-off');
    const on = document.getElementById('calendar-feed-on');
    if (off) toggleElement(off, !enabled);
    if (on) toggleElement(on, enabled);
}

/**
 * Send a change to the calendar endpoint.
 *
 * @param {string} method -> POST (set up or renew) or DELETE (end).
 * @returns {Promise<Object>} -> The new answer.
 * @throws {Error} -> With the German message of the server.
 */
async function changeCalendarSubscription(method) {
    const res = await fetch(ENDPOINT, { method, headers: { 'X-CSRF-TOKEN': state.csrfToken } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Das Kalender-Abo konnte nicht geändert werden.');
    return body;
}

/**
 * Load the member's subscription into the block; a failed load shows the setup button.
 *
 * @returns {Promise<void>}
 */
export async function loadCalendarSubscription() {
    try {
        const res = await fetch(ENDPOINT);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        renderCalendarSubscription(await res.json());
    } catch (err) {
        console.error('Failed to load the calendar subscription:', err);
        renderCalendarSubscription({ enabled: false });
    }
}

/** „Kalender-Abo einrichten“ */
export async function setUpCalendarSubscription() {
    try {
        renderCalendarSubscription(await changeCalendarSubscription('POST'));
        showToast('Kalender-Abo eingerichtet. Füge den Link in deiner Kalender-App hinzu.', 'success');
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

/** „Link erneuern“: new secret, the old link stops working */
export async function renewCalendarSubscription() {
    const confirmed = await showConfirmDialog(
        'Der alte Link funktioniert danach nicht mehr. Kalender, die ihn abonniert haben, musst du neu verbinden.',
        'Link erneuern', { danger: false });
    if (!confirmed) return;
    try {
        renderCalendarSubscription(await changeCalendarSubscription('POST'));
        showToast('Neuer Link erstellt. Verbinde deine Kalender-Apps neu.', 'success');
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

/** „Abo beenden“ */
export async function endCalendarSubscription() {
    const confirmed = await showConfirmDialog(
        'Kalender-Abo beenden? Der Link funktioniert danach nicht mehr, deine Kalender-Apps bekommen keine Events mehr.',
        'Abo beenden');
    if (!confirmed) return;
    try {
        renderCalendarSubscription(await changeCalendarSubscription('DELETE'));
        showToast('Kalender-Abo beendet. Der Link funktioniert nicht mehr.', 'success');
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

/** „Kopieren“ */
export async function copyCalendarSubscriptionLink() {
    try {
        await navigator.clipboard.writeText(currentUrl);
        showToast('Link kopiert.', 'success');
    } catch {
        showToast('Kopieren ging nicht – bitte den Link markieren und kopieren.', 'warning');
    }
}

registerActions({
    setUpCalendarSubscription: () => setUpCalendarSubscription(),
    renewCalendarSubscription: () => renewCalendarSubscription(),
    endCalendarSubscription: () => endCalendarSubscription(),
    copyCalendarSubscriptionLink: () => copyCalendarSubscriptionLink()
});
