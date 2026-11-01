/**
 * Announcement channel of an event in the wizard (B-11): step „Erweitert“
 * offers the bot center default first, then the server's text channels.
 * '' means the default; a stored channel the bot cannot list stays selectable.
 */
import { state } from '../core/state.js';
import { textChannelOptions } from './bot-control.js';
import { loadChannelsForAutocomplete } from './wizard-location.js';

/**
 * Label of the default option, naming the bot center channel when it is known.
 *
 * @param {Array<Object>} channels -> Channel list of GET /api/admin/channels.
 * @param {string} defaultId -> Effective default (`defaultAnnounceChannel` of the bot settings), '' when none is set.
 * @returns {string} -> e.g. "Standard aus der Bot-Zentrale (#ankündigungen)".
 */
export function announceDefaultLabel(channels, defaultId) {
    const channel = defaultId && (Array.isArray(channels) ? channels : []).find(entry => entry.id === defaultId);
    return channel ? `Standard aus der Bot-Zentrale (#${channel.name})` : 'Standard aus der Bot-Zentrale';
}

/**
 * Fill the dropdown and select a channel ('' = default).
 *
 * @param {string} selected -> Stored `announceChannelId`.
 * @returns {Promise<void>}
 */
export async function renderAnnounceChannelSelect(selected) {
    const select = document.getElementById('event-announce-channel');
    if (!select) return;
    const channels = await loadChannelsForAutocomplete();
    select.innerHTML = textChannelOptions(channels, selected || '', announceDefaultLabel(channels, state.announceDefaultChannel || ''));
    select.value = selected || '';
}
