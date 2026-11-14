/**
 * Keeps Discord in step with the event assistant: when a settings save turned
 * `isFeatureOn('memberDiscord')` on or off, `/ask` must be registered again and
 * the announcements redrawn („Frage stellen“). That can take long (one edit
 * per announcement, Discord rate limits), so it runs in the background and
 * never delays or fails the save.
 */
const { isFeatureOn } = require('../ai/settings');

/**
 * Start `refreshAskFeature()` of the bot when the feature flipped; never waits.
 *
 * @param {boolean} wasOn -> `isFeatureOn('memberDiscord')` before the save.
 * @param {Object} [options] -> `{ bot }` replaces bot.js (tests).
 * @returns {boolean} -> True when a refresh was started.
 * @example
 * const askWasOn = isFeatureOn('memberDiscord');
 * await saveAiSettings(body);
 * refreshAskIfSwitched(askWasOn);
 */
function refreshAskIfSwitched(wasOn, { bot } = {}) {
    if (isFeatureOn('memberDiscord') === wasOn) return false;
    Promise.resolve()
        // bot.js loads modules that load the routes: required when used
        .then(() => (bot || require('../bot')).refreshAskFeature())
        .catch(err => console.error('Discord refresh of the event assistant failed:', err?.code || err?.name || 'error'));
    return true;
}

module.exports = { refreshAskIfSwitched };
