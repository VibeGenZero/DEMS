/**
 * Location field of the event wizard: suggestions of Discord channels
 * while typing "#…". Split from wizard.js to keep it small.
 */
import { registerActions } from '../core/actions.js';
import { escapeHtml } from '../core/ui.js';

export let _cachedChannels = null;

export async function loadChannelsForAutocomplete() {
    if (_cachedChannels !== null) return _cachedChannels;
    try {
        const res = await fetch('/api/admin/channels');
        const channels = res.ok ? await res.json() : [];
        _cachedChannels = Array.isArray(channels) ? channels : [];
        return _cachedChannels;
    } catch { return []; }
}

export async function handleLocationInput() {
    const input = document.getElementById('event-location-text');
    const suggestionsEl = document.getElementById('location-suggestions');
    if (!input || !suggestionsEl) return;

    const val = input.value.trim();

    const chanIdEl = document.getElementById('event-location-channel-id');
    const chanTypeEl = document.getElementById('event-location-channel-type');
    if (chanIdEl) chanIdEl.value = '';
    if (chanTypeEl) chanTypeEl.value = '';

    if (!val) {
        suggestionsEl.style.display = 'none';
        return;
    }

    const channels = await loadChannelsForAutocomplete();
    const q = val.replace(/^#/, '').toLowerCase();
    const filtered = channels.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8);

    if (!filtered.length) {
        suggestionsEl.style.display = 'none';
        return;
    }

    suggestionsEl.innerHTML = filtered.map(c => `
        <div class="location-suggestion-item"
             data-click="selectLocationChannel" data-channel-id="${escapeHtml(c.id)}" data-channel-name="${escapeHtml(c.name)}" data-channel-type="${escapeHtml(c.type)}">
            <i class="bi bi-${c.type === 'voice' ? 'volume-up' : 'hash'} me-2"></i>${escapeHtml(c.name)}
        </div>`).join('');
    suggestionsEl.style.display = 'block';
}

export function selectLocationChannel(channelId, channelName, channelType) {
    const input = document.getElementById('event-location-text');
    if (input) input.value = '#' + channelName;
    const chanIdEl = document.getElementById('event-location-channel-id');
    if (chanIdEl) chanIdEl.value = channelId;
    const chanTypeEl = document.getElementById('event-location-channel-type');
    if (chanTypeEl) chanTypeEl.value = channelType;
    const suggestionsEl = document.getElementById('location-suggestions');
    if (suggestionsEl) suggestionsEl.style.display = 'none';
}

registerActions({
    handleLocationInput: () => handleLocationInput(),
    selectLocationChannel: (el) => selectLocationChannel(el.dataset.channelId, el.dataset.channelName, el.dataset.channelType)
});
