/**
 * Message of the team to the participants of one event (W-09): dialog
 * #participantMessageModal with recipient group, text, counter, Discord preview
 * and an inline confirmation step (no second dialog on top). The DM itself is
 * built and sent by the server (utils/participantMessage.js).
 */
import { registerActions } from '../core/actions.js';
import { avatar } from '../core/components.js';
import { state } from '../core/state.js';
import { renderMarkdownSafe, showToast, toggleElement } from '../core/ui.js';

/** Recipient groups in display order; `key` is the `group` of the API. */
export const PARTICIPANT_GROUPS = [
    { key: 'accepted', label: 'Nur Angenommene' },
    { key: 'all', label: 'Alle Anmeldungen' }
];
const MAX_LENGTH = 1500;
// Megaphone of the DM heading; written as an escape because it is part of the
// Discord text the server sends, not a symbol of this page
const MEGAPHONE = '\u{1F4E3}';

/** The dialog's event, group and the counts of GET …/message-recipients. */
export const messageDialog = {
    eventId: null,
    eventTitle: '',
    group: 'accepted',
    counts: null,
    sending: false
};

const byId = (id) => document.getElementById(id);

/**
 * The DM text as the server builds it (twin of buildParticipantMessage in
 * utils/participantMessage.js; test/fixtures/participantMessageCases.js keeps both equal).
 *
 * @param {Object} input -> `{ title, text, sender, url }`.
 * @returns {string}
 */
export function buildParticipantMessagePreview({ title, text, sender, url }) {
    return [
        `${MEGAPHONE} **Nachricht zum Event „${String(title ?? '')}“**`,
        '',
        String(text ?? '').trim(),
        '',
        `— ${String(sender ?? '')} · Alle Infos: ${String(url ?? '')}`
    ].join('\n');
}

/**
 * Counter text.
 *
 * @param {number} count -> People the group reaches.
 * @returns {string} -> "an 1 Person" / "an 12 Personen".
 */
export function participantCountText(count) {
    const n = Number(count) || 0;
    return `an ${n} ${n === 1 ? 'Person' : 'Personen'}`;
}

/**
 * The DM as Discord shows it.
 *
 * @param {string} message -> Result of buildParticipantMessagePreview().
 * @returns {string} -> HTML of a div.discord-message (styles: DISCORD PREVIEW).
 */
export function renderParticipantPreview(message) {
    return '<div class="discord-message">'
        + avatar({ name: 'DEMS' })
        + '<div class="discord-message-body">'
        + '<div class="discord-message-header"><span class="discord-message-author">DEMS</span><span class="discord-app-tag">APP</span></div>'
        + `<div class="discord-message-text">${renderMarkdownSafe(message)}</div>`
        + '</div></div>';
}

const countOfGroup = () => (messageDialog.counts ? Number(messageDialog.counts[messageDialog.group]) || 0 : 0);

function senderName() {
    const user = state.currentUser || {};
    return String(user.displayName || user.username || 'Admin');
}

function showConfirmStep(visible) {
    toggleElement(byId('participant-message-confirm'), visible);
    toggleElement(byId('participant-message-actions'), !visible);
}

/**
 * Bring counter, character count, preview and send button up to date.
 *
 * @returns {void}
 */
export function updateParticipantMessage() {
    const text = String(byId('participant-message-text').value || '');
    const trimmed = text.trim();
    const count = countOfGroup();
    byId('participant-message-count').textContent = messageDialog.counts ? participantCountText(count) : '';
    byId('participant-message-chars').textContent = `${trimmed.length} / ${MAX_LENGTH}`;
    byId('participant-message-hint').textContent = messageDialog.counts && count === 0 ? 'Niemand in dieser Auswahl' : '';
    byId('participant-message-preview').innerHTML = renderParticipantPreview(buildParticipantMessagePreview({
        title: messageDialog.eventTitle,
        text: trimmed || '…',
        sender: senderName(),
        url: `${location.origin || ''}/#event/${messageDialog.eventId}`
    }));
    byId('participant-message-send').disabled = !trimmed || trimmed.length > MAX_LENGTH || count === 0 || messageDialog.sending;
    for (const { key } of PARTICIPANT_GROUPS) {
        const radio = byId(`participant-group-${key}`);
        if (radio) radio.checked = key === messageDialog.group;
    }
}

/**
 * Open the dialog for one event.
 *
 * @param {string} eventId -> Event id.
 * @param {string} eventTitle -> Event title for heading and preview.
 * @returns {Promise<void>}
 */
export async function showParticipantMessage(eventId, eventTitle) {
    Object.assign(messageDialog, { eventId: String(eventId ?? ''), eventTitle: String(eventTitle ?? ''), group: 'accepted', counts: null, sending: false });
    byId('participant-message-title').textContent = messageDialog.eventTitle;
    byId('participant-message-text').value = '';
    showConfirmStep(false);
    updateParticipantMessage();

    // Never two dialogs on top of each other: the registrations dialog closes first
    const registrations = byId('registrationsModal');
    if (registrations) bootstrap.Modal.getInstance(registrations)?.hide();
    bootstrap.Modal.getOrCreateInstance(byId('participantMessageModal')).show();

    const requested = messageDialog.eventId;
    try {
        const res = await fetch(`/api/admin/events/${encodeURIComponent(requested)}/message-recipients`);
        const data = await res.json();
        if (messageDialog.eventId !== requested) return;
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        messageDialog.counts = { accepted: Number(data.accepted) || 0, all: Number(data.all) || 0 };
    } catch (err) {
        showToast(err.message || 'Empfänger konnten nicht geladen werden.', 'danger');
    }
    updateParticipantMessage();
}

/**
 * Switch the recipient group.
 *
 * @param {string} group -> Key of PARTICIPANT_GROUPS; anything else is ignored.
 * @returns {void}
 */
export function setParticipantGroup(group) {
    if (!PARTICIPANT_GROUPS.some(entry => entry.key === group)) return;
    messageDialog.group = group;
    showConfirmStep(false);
    updateParticipantMessage();
}

/**
 * First click on "Senden": ask inside the dialog.
 *
 * @returns {void}
 */
export function askSendParticipantMessage() {
    updateParticipantMessage();
    if (byId('participant-message-send').disabled) return;
    byId('participant-message-question').textContent = `Nachricht ${participantCountText(countOfGroup())} senden?`;
    showConfirmStep(true);
}

export function cancelSendParticipantMessage() {
    showConfirmStep(false);
}

/**
 * Send after the confirmation; the dialog closes on success and keeps the text on an error.
 *
 * @returns {Promise<void>}
 */
export async function sendParticipantMessage() {
    if (messageDialog.sending) return;
    const text = String(byId('participant-message-text').value || '').trim();
    const yes = byId('participant-message-yes');
    messageDialog.sending = true;
    yes.disabled = true;
    try {
        const res = await fetch(`/api/admin/events/${encodeURIComponent(messageDialog.eventId)}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ text, group: messageDialog.group })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Nachricht konnte nicht gesendet werden.');
        const recipients = Number(data.recipients) || 0;
        const delivered = Number(data.delivered) || 0;
        bootstrap.Modal.getOrCreateInstance(byId('participantMessageModal')).hide();
        showToast(`Nachricht an ${delivered} von ${recipients} Personen zugestellt.`, delivered === recipients ? 'success' : 'warning');
    } catch (err) {
        showConfirmStep(false);
        showToast(err.message || 'Nachricht konnte nicht gesendet werden.', 'danger');
    } finally {
        messageDialog.sending = false;
        yes.disabled = false;
        updateParticipantMessage();
    }
}

registerActions({
    showParticipantMessage: (el) => showParticipantMessage(el.dataset.eventId, el.dataset.eventTitle),
    setParticipantGroup: (el) => setParticipantGroup(el.dataset.group),
    updateParticipantMessage: () => updateParticipantMessage(),
    askSendParticipantMessage: () => askSendParticipantMessage(),
    cancelSendParticipantMessage: () => cancelSendParticipantMessage(),
    sendParticipantMessage: () => sendParticipantMessage()
});
