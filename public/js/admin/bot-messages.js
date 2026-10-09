/**
 * Bot message templates dialog.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { showToast } from '../core/ui.js';

export async function showBotMessagesModal() {
    try {
        const res = await fetch('/api/admin/bot-messages');
        const data = await res.json();
        document.getElementById('msg-registration').value = data.registration || '';
        document.getElementById('msg-accepted').value = data.accepted || '';
        document.getElementById('msg-rejected').value = data.rejected || '';
    } catch {
        // Use defaults
    }
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('botMessagesModal'));
    modal.show();
}

export async function saveBotMessages() {
    try {
        const res = await fetch('/api/admin/bot-messages', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            body: JSON.stringify({
                registration: document.getElementById('msg-registration').value,
                accepted: document.getElementById('msg-accepted').value,
                rejected: document.getElementById('msg-rejected').value
            })
        });
        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('botMessagesModal')).hide();
            showToast('Bot-Nachrichten gespeichert!', 'success');
        }
    } catch {
        showToast('Fehler beim Speichern.', 'danger');
    }
}

registerActions({ showBotMessagesModal: () => showBotMessagesModal(), saveBotMessages: () => saveBotMessages() });
