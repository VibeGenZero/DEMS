/**
 * Waitlist offer on the event page (B-15): a freed place is held for the
 * member until the deadline; „Platz annehmen“ moves them up, „Doch nicht“
 * hands the place to the next entry. The same answers exist in the Discord DM.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { showToast, toggleElement } from '../core/ui.js';
import { showEventDetail } from './detail.js';

/**
 * Deadline in the viewer's time, e.g. "Fr., 06.11., 20:00".
 *
 * @param {string} iso -> ISO date.
 * @returns {string} -> '' for no or an unreadable date.
 */
export function formatOfferDeadline(iso) {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Show or hide the offer card for the own registration.
 *
 * @param {Object|null} registration -> Answer of GET /api/events/:id/my-registration.
 * @returns {boolean} -> True when the registration is an open offer (the card is shown).
 */
export function renderOfferCard(registration) {
    const card = document.getElementById('detail-offer');
    const offered = registration?.status === 'offered';
    toggleElement(card, offered);
    if (!offered) return false;
    const until = formatOfferDeadline(registration.offer?.expiresAt);
    document.getElementById('detail-offer-text').textContent = until
        ? `Bestätige ihn bis ${until}, sonst rückt der Nächste nach.`
        : 'Bestätige ihn bald, sonst rückt der Nächste nach.';
    return true;
}

// Toast per answer; a confirmation for a manual event becomes a request
const ANSWER_TOASTS = {
    accepted: 'Du bist dabei!',
    pending: 'Deine Anfrage wird jetzt geprüft.',
    decline: 'Dein Platz geht an den Nächsten.'
};

/**
 * Send „Platz annehmen“ (`confirm`) or „Doch nicht“ (`decline`) and reload the page.
 *
 * @param {'confirm'|'decline'} answer -> The answer.
 * @returns {Promise<void>}
 */
export async function answerWaitlistOffer(answer) {
    const eventId = state.detailEventId;
    if (!eventId) return;
    const buttons = ['offer-confirm-btn', 'offer-decline-btn'].map(id => document.getElementById(id)).filter(Boolean);
    buttons.forEach(button => { button.disabled = true; });
    try {
        const res = await fetch(`/api/events/${eventId}/offer/${answer}`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Das Angebot ist nicht mehr gültig.', 'danger');
        } else {
            showToast(ANSWER_TOASTS[answer === 'decline' ? 'decline' : result.status] || 'Gespeichert.', 'success');
        }
        await showEventDetail(eventId);
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    } finally {
        buttons.forEach(button => { button.disabled = false; });
    }
}

registerActions({
    confirmOffer: () => answerWaitlistOffer('confirm'),
    declineOffer: () => answerWaitlistOffer('decline')
});
