/**
 * "Neuigkeiten & Updates" dialog. A version the browser meets for the first
 * time gets a small effect (update-effects.js).
 */
import { registerActions } from './actions.js';
import { escapeHtml } from './ui.js';
import { celebrateUpdate } from './update-effects.js';

export async function checkUpdates() {
    try {
        const res = await fetch('/api/updates');
        if (!res.ok) return;
        const data = await res.json();

        // Update version badge
        const badge = document.getElementById('info-version');
        if (badge) badge.textContent = `v${data.version}`;

        // Check if we should show modal
        const lastSeenVersion = localStorage.getItem('dems_last_seen_version');

        if (lastSeenVersion !== data.version) {
            // Show modal
            const modalEl = document.getElementById('updatesModal');
            const versionBadge = document.getElementById('updates-version-badge');
            const contentDiv = document.getElementById('updates-content');

            versionBadge.textContent = data.version;

            contentDiv.innerHTML = data.news.map(item => `
                <div class="mb-4">
                    <h6 class="text-accent fw-bold mb-2">${escapeHtml(item.title)}</h6>
                    <p class="text-secondary mb-0">${escapeHtml(item.content)}</p>
                </div>
            `).join('');

            const modal = new bootstrap.Modal(modalEl);
            modal.show();
            celebrateUpdate(data.version);

            // Store current version availability for checkbox logic
            modalEl.dataset.version = data.version;
        }
    } catch (err) {
        console.error('Failed to check updates:', err);
    }
}

export function closeUpdatesModal() {
    const modalEl = document.getElementById('updatesModal');
    const checkbox = document.getElementById('dont-show-again');

    if (checkbox.checked && modalEl.dataset.version) {
        localStorage.setItem('dems_last_seen_version', modalEl.dataset.version);
    }

    // reset checkbox
    checkbox.checked = false;
}

registerActions({ closeUpdatesModal: () => closeUpdatesModal() });
