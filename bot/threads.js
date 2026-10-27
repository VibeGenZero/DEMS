/**
 * Discussion thread of an event announcement (B-14): one public thread per
 * event, opened on the announcement message.
 */
const { ThreadAutoArchiveDuration } = require('discord.js');
const { client, state } = require('./client');
const { isGoneDiscordError } = require('./messages');

// Discord's limit for a thread name
const THREAD_NAME_MAX_LENGTH = 100;

/**
 * Whether a stored thread still exists in Discord.
 *
 * @param {Object} existing -> `{ guildId, threadId }`.
 * @returns {Promise<boolean>} -> False only when Discord says it is gone; true on other errors,
 *   so a hiccup never opens a second thread.
 */
async function threadStillExists(existing) {
    try {
        return !!(await client.channels.fetch(existing.threadId));
    } catch (err) {
        if (isGoneDiscordError(err)) return false;
        console.error('Could not check the discussion thread:', err.message);
        return true;
    }
}

/**
 * The discussion thread of an event: the stored one while it exists, else a
 * new public thread on the given announcement message.
 *
 * @param {{ channelId: string, messageId: string }} sent -> The announcement just posted.
 * @param {string} title -> Event title, the thread name.
 * @param {Object|null} [existing] -> `event.discordThread`.
 * @returns {Promise<Object|null>} -> `{ guildId, threadId }`; `existing` when kept; null when the bot
 *   is not ready or Discord refused the thread.
 * @example
 * const thread = await ensureAnnouncementThread(sent, event.title, event.discordThread);
 */
async function ensureAnnouncementThread(sent, title, existing = null) {
    if (!state.isReady) return null;
    try {
        if (existing && existing.threadId && await threadStillExists(existing)) return existing;

        const channel = await client.channels.fetch(sent.channelId);
        const message = await channel.messages.fetch(sent.messageId);
        const thread = await message.startThread({
            name: String(title || 'Diskussion').slice(0, THREAD_NAME_MAX_LENGTH),
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek
        });
        console.log(`🧵 Discussion thread opened for "${title}"`);
        return { guildId: thread.guildId || channel.guildId || null, threadId: thread.id };
    } catch (err) {
        console.error('Could not open the discussion thread:', err.message);
        return null;
    }
}

module.exports = { ensureAnnouncementThread };
