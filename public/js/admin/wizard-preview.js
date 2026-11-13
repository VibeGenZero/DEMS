/**
 * Preview of the event wizard: the overview card and the Discord
 * announcement of the unsaved input. The card is drawn at once; the
 * announcement comes from POST /api/admin/events/preview, which uses the
 * builders of "Ankündigen".
 */
import { state } from '../core/state.js';
import { applyStyleData } from '../core/ui.js';
import { renderEventCard } from '../events/cards.js';
import { applyBannerColors } from '../events/list.js';
import { renderDiscordMessage } from './discord-preview.js';

const DISCORD_LOADING = '<div class="discord-message" aria-hidden="true"><div class="skeleton skeleton-avatar"></div>'
    + '<div class="discord-message-body"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text is-short"></div></div></div>';
const DISCORD_UNAVAILABLE = '<p class="text-body-tertiary small mb-0">Discord-Vorschau gerade nicht verfügbar.</p>';

// Counts the previews; an answer for an older one is dropped
let previewSequence = 0;

/**
 * Event object of the draft for renderEventCard().
 *
 * @param {Object} draft -> Input of collectEventDraft().
 * @param {string} editId -> Id of the edited event, '' for a new one.
 * @param {Object|null} places -> Places of the preview answer; null while it loads.
 * @returns {Object} -> Event with the fields the card reads.
 */
export function previewEventOf(draft, editId, places) {
    const slots = Array.isArray(draft.slots) ? draft.slots : [];
    const draftCapacity = slots.length > 0
        ? slots.reduce((sum, slot) => sum + Math.max(0, Number(slot.capacity) || 0), 0)
        : Math.max(0, parseInt(draft.maxParticipants, 10) || 0);
    return {
        id: editId || 'vorschau',
        title: draft.title,
        bannerUrl: draft.bannerUrl,
        accentColor: draft.accentColor,
        category: draft.category,
        startDate: draft.startDate,
        endDate: draft.endDate,
        accessMode: draft.accessMode,
        maxParticipants: places ? places.capacity : draftCapacity,
        ...(places ? { places } : {})
    };
}

/**
 * Drop the answer of a preview that is still loading.
 *
 * @returns {void}
 */
export function cancelWizardPreview() {
    previewSequence++;
}

/**
 * Draw the card at once, then ask the server for the Discord message.
 *
 * @param {Object} draft -> Input of collectEventDraft().
 * @param {string} editId -> Id of the edited event, '' for a new one.
 * @param {Date} [now] -> Reference time for the card and the message.
 * @param {Object} [options]
 * @param {boolean} [options.keep] -> Leave the drawn message in place until the new one arrives (a redraw while typing) instead of the skeleton.
 * @returns {Promise<void>} -> Resolves when the message is drawn, dropped or replaced by the unavailable hint.
 */
export async function renderWizardPreview(draft, editId, now = new Date(), { keep = false } = {}) {
    const sequence = ++previewSequence;
    const cardEl = document.getElementById('wizard-preview-card');
    const discordEl = document.getElementById('wizard-preview-discord');
    const drawCard = (places) => {
        cardEl.innerHTML = renderEventCard(previewEventOf(draft, editId, places), now);
        applyBannerColors(cardEl);
    };
    drawCard(null);
    if (!keep || !discordEl.innerHTML) discordEl.innerHTML = DISCORD_LOADING;
    try {
        const res = await fetch('/api/admin/events/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ ...draft, id: editId || undefined })
        });
        const preview = await res.json();
        if (sequence !== previewSequence) return;
        if (!res.ok) throw new Error(preview.error);
        drawCard(preview.places);
        discordEl.innerHTML = renderDiscordMessage(preview, now);
        applyStyleData(discordEl);
    } catch {
        if (sequence === previewSequence) discordEl.innerHTML = DISCORD_UNAVAILABLE;
    }
}
