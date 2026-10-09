/**
 * Import of Discord scheduled events into the wizard.
 */
import { state } from '../core/state.js';
import { showCreateEventModal, updateBannerPreview } from './wizard.js';
import { escapeHtml, markdownPreview, showToast } from '../core/ui.js';

export async function showImportDiscordEventsModal() {
    const modal = new bootstrap.Modal(document.getElementById('importDiscordEventsModal'));
    modal.show();
    await fetchDiscordEvents();
}

export async function fetchDiscordEvents() {
    const list = document.getElementById('discord-events-list');
    list.innerHTML = '<div class="text-center py-5"><span class="spinner-border text-primary"></span><p class="mt-2 text-muted">Lade Events...</p></div>';

    try {
        const res = await fetch('/api/admin/import/discord-events');
        const events = await res.json();

        if (!events || events.length === 0) {
            list.innerHTML = '<div class="text-center py-5"><i class="bi bi-calendar-x" style="font-size: 2rem; color: var(--text-muted);"></i><p class="mt-2 text-muted">Keine geplanten Events im Discord gefunden.</p></div>';
            return;
        }

        list.innerHTML = events.map(ev => `
            <a href="#" class="list-group-item list-group-item-action d-flex gap-3 py-3" onclick="selectDiscordEvent(this)" data-event='${JSON.stringify(ev).replace(/'/g, "&apos;")}'>
                ${ev.image ? `<img src="${ev.image}" alt="Event Image" width="48" height="48" class="rounded-circle flex-shrink-0" style="object-fit:cover;">` : '<div class="rounded-circle bg-secondary d-flex align-items-center justify-content-center flex-shrink-0" style="width:48px;height:48px;"><i class="bi bi-discord"></i></div>'}
                <div class="d-flex gap-2 w-100 justify-content-between">
                    <div>
                        <h6 class="mb-0 text-white">${escapeHtml(ev.name)}</h6>
                        <p class="mb-0 opacity-75 small text-white-50">${ev.description ? escapeHtml(markdownPreview(ev.description, 100)) : 'Keine Beschreibung'}</p>
                    </div>
                    <small class="opacity-50 text-nowrap text-white-50">${new Date(ev.scheduledStartTimestamp).toLocaleDateString()}</small>
                </div>
            </a>
        `).join('');
    } catch (err) {
        console.error(err);
        list.innerHTML = '<div class="alert alert-danger">Fehler beim Laden der Events.</div>';
    }
}

export function selectDiscordEvent(el) {
    const eventData = JSON.parse(el.getAttribute('data-event'));

    // Close import modal
    const importModalEl = document.getElementById('importDiscordEventsModal');
    const importModal = bootstrap.Modal.getInstance(importModalEl);
    importModal.hide();

    // Open create modal
    showCreateEventModal().then(() => {
        // Fill form
        document.getElementById('event-title').value = eventData.name || '';
        if (state.descriptionEditor) {
            state.descriptionEditor.value(eventData.description || '');
        } else {
            document.getElementById('event-description').value = eventData.description || '';
        }

        if (eventData.image) {
            document.getElementById('event-banner-url').value = eventData.image;
            updateBannerPreview();
        }

        if (eventData.scheduledStartTimestamp) {
            const startDate = new Date(eventData.scheduledStartTimestamp);
            if (state.startDatePicker) state.startDatePicker.setDate(startDate);
        }

        if (eventData.scheduledEndTimestamp) {
            const endDate = new Date(eventData.scheduledEndTimestamp);
            if (state.endDatePicker) state.endDatePicker.setDate(endDate);
        }

        showToast('Event-Daten übernommen!', 'success');
    });
}

// Temporary bridge for inline handlers; D-01 replaces them with data-click and removes it
Object.assign(window, { showImportDiscordEventsModal, selectDiscordEvent });
