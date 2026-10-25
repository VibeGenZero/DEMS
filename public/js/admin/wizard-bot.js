/**
 * Bot center switches inside the event wizard (B-02): with "Auto
 * Channel-Erstellung" off the channel option is locked, with
 * "DM-Benachrichtigungen" off the wizard offers no change notice
 * (admin/wizard-notify.js reads state.botSettings).
 */
import { state } from '../core/state.js';
import { toggleElement } from '../core/ui.js';

/**
 * The switches the wizard needs; anything unknown counts as on (the server default).
 *
 * @param {Object} raw -> Answer of GET /api/admin/bot/settings.
 * @returns {{ dmNotifications: boolean, autoChannelCreation: boolean }}
 */
export function wizardSwitchesOf(raw) {
    const settings = raw && typeof raw === 'object' ? raw : {};
    return {
        dmNotifications: settings.dmNotifications !== false,
        autoChannelCreation: settings.autoChannelCreation !== false
    };
}

/** Lock or unlock the channel option; the event keeps its own value. */
export function applyChannelLock() {
    const locked = state.botSettings?.autoChannelCreation === false;
    document.getElementById('event-auto-create-channels').disabled = locked;
    toggleElement(document.getElementById('event-channels-locked'), locked);
}

/**
 * Load the switches when the wizard opens; a failed read keeps everything usable.
 *
 * @returns {Promise<Object>} -> state.botSettings.
 */
export async function loadWizardBotSettings() {
    let raw = null;
    try {
        const res = await fetch('/api/admin/bot/settings');
        if (res.ok) raw = await res.json();
    } catch {
        raw = null;
    }
    state.botSettings = wizardSwitchesOf(raw);
    applyChannelLock();
    return state.botSettings;
}
