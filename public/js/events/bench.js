/**
 * „Vielleicht“ / Ersatzbank on the event page (B-17): the „Vielleicht“ button
 * next to the registration, the own bench card with „Fest zusagen“, and the
 * names on the bench in the participants area. The bench takes no place.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast, toggleElement } from '../core/ui.js';
import { avatar } from '../core/components.js';
import { isRegistrationClosed } from './cards.js';
import { showEventDetail } from './detail.js';
import { submitRegistration } from './registration-form.js';

// Event of the open page; the „Vielleicht“ button answers for it
let benchEvent = null;

/**
 * Show „Vielleicht“ next to „Teilnehmen“ or the waitlist button while the event allows it.
 *
 * @param {Object} event -> Event of the page.
 * @returns {void}
 */
export function renderTentativeAction(event) {
    benchEvent = event;
    toggleElement(document.getElementById('tentative-btn'), event?.allowTentative === true);
}

/**
 * Show or hide the bench card for the own registration.
 *
 * @param {Object} event -> Event of the page.
 * @param {Object|null} registration -> Answer of GET /api/events/:id/my-registration.
 * @returns {boolean} -> True when the member is on the bench (the card is shown).
 */
export function renderTentativeCard(event, registration) {
    const card = document.getElementById('detail-tentative');
    const onBench = registration?.status === 'tentative' && !registration.asGuest;
    toggleElement(card, onBench);
    if (!onBench) return false;
    // Confirming follows the rules of a new registration (end, registration deadline)
    const open = !isRegistrationClosed(event);
    toggleElement(document.getElementById('tentative-confirm-btn'), open);
    toggleElement(document.getElementById('tentative-confirm-closed'), !open);
    return true;
}

/**
 * Names on the bench below the participants or the line-up.
 *
 * @param {Object} data -> Answer of GET /api/events/:id/participants (`bench`, on slot events `slots`).
 * @returns {void}
 */
export function renderBench(data) {
    const element = document.getElementById('detail-bench');
    if (!element) return;
    const bench = Array.isArray(data?.bench) ? data.bench : [];
    toggleElement(element, bench.length > 0);
    if (bench.length === 0) {
        element.innerHTML = '';
        return;
    }
    const slots = Array.isArray(data.slots) ? data.slots : [];
    const entries = bench.map(entry => {
        const slot = slots.find(item => item.id === entry.preferredSlotId);
        const role = slot ? ` · ${escapeHtml(`${slot.emoji ? `${slot.emoji} ` : ''}${slot.name}`)}` : '';
        return `<span class="chip">${avatar({ url: entry.avatar, name: entry.displayName, size: 'sm' })}${escapeHtml(entry.displayName)}${role}</span>`;
    }).join('');
    element.innerHTML = `
        <div class="section-label small mb-2"><i class="bi bi-question-circle me-2"></i>ERSATZBANK (${bench.length})</div>
        <div class="d-flex flex-wrap gap-2">${entries}</div>`;
}

/**
 * „Vielleicht“: send the form of the page as a tentative answer.
 *
 * @returns {Promise<void>}
 */
export async function answerTentative() {
    const eventId = state.detailEventId;
    if (!eventId || !benchEvent) return;
    // A full event shows the waitlist form, else the registration form
    const waitlistShown = document.getElementById('detail-waitlist')?.style.display === 'block';
    await submitRegistration(eventId, benchEvent, 'tentative-btn', waitlistShown ? 'waitlist-form-fields' : 'dynamic-form-fields', { tentative: true });
}

/**
 * „Fest zusagen“: turn the own answer into a registration and reload the page.
 *
 * @returns {Promise<void>}
 */
export async function confirmTentative() {
    const eventId = state.detailEventId;
    if (!eventId) return;
    const button = document.getElementById('tentative-confirm-btn');
    if (button) button.disabled = true;
    try {
        const res = await fetch(`/api/events/${eventId}/register/confirm`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        const result = await res.json();
        showToast(res.ok ? (result.message || 'Zusage gespeichert.') : (result.error || 'Fehler bei der Zusage.'), res.ok ? 'success' : 'danger');
        if (res.ok) await showEventDetail(eventId, { celebrate: result.status === 'accepted' ? 'registered' : undefined });
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    } finally {
        if (button) button.disabled = false;
    }
}

registerActions({
    answerTentative: () => answerTentative(),
    confirmTentative: () => confirmTentative()
});
