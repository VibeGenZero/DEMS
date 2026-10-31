/**
 * Discord server events (scheduled events) of DEMS events: import list,
 * „Mit Discord synchronisieren“ and keeping the synced event in step (B-09).
 */
const { GuildScheduledEventEntityType, GuildScheduledEventStatus } = require('discord.js');
const { bannerForDiscord } = require('../utils/bannerStore');
const { client, state } = require('./client');

// Discord limits of a scheduled event
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 1000;
const LOCATION_MAX_LENGTH = 100;
// Without an end the event lasts two hours, like isEventOver
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
// Discord: Unknown Guild Scheduled Event
const UNKNOWN_SCHEDULED_EVENT = 10070;
const FINISHED = [GuildScheduledEventStatus.Completed, GuildScheduledEventStatus.Canceled];

/**
 * Fields of the Discord server event of a DEMS event, for create and edit.
 *
 * @param {Object} event -> Event data.
 * @param {Date} [now] -> Fallback start (in an hour) when the event has no start date.
 * @returns {Object} -> `{ name, description, scheduledStartTime, scheduledEndTime, entityType, channel, entityMetadata }`.
 *   A voice channel (the event's own one, else a voice location) makes a voice event; otherwise it is
 *   external at the location text, or „Discord“.
 */
function buildScheduledEventFields(event, now = new Date()) {
    const scheduledStartTime = event.startDate ? new Date(event.startDate) : new Date(now.getTime() + 60 * 60 * 1000);
    let scheduledEndTime = event.endDate ? new Date(event.endDate) : null;
    if (!scheduledEndTime || scheduledEndTime <= scheduledStartTime) {
        scheduledEndTime = new Date(scheduledStartTime.getTime() + DEFAULT_DURATION_MS);
    }
    const location = event.location || {};
    const voiceChannel = event.discordChannelId || (location.channelType === 'voice' ? location.channelId : null);
    const place = voiceChannel
        ? { entityType: GuildScheduledEventEntityType.Voice, channel: voiceChannel, entityMetadata: undefined }
        : {
            entityType: GuildScheduledEventEntityType.External,
            channel: null,
            entityMetadata: { location: String(location.text || '').trim().slice(0, LOCATION_MAX_LENGTH) || 'Discord' }
        };
    return {
        name: String(event.title || '').slice(0, NAME_MAX_LENGTH),
        description: String(event.description || '').slice(0, DESCRIPTION_MAX_LENGTH),
        scheduledStartTime,
        scheduledEndTime,
        ...place
    };
}

/**
 * Get all scheduled events from the guild
 */
async function getGuildScheduledEvents(guildId) {
    if (!state.isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const events = await guild.scheduledEvents.fetch();
        return events.map(e => ({
            id: e.id,
            name: e.name,
            description: e.description,
            scheduledStartTimestamp: e.scheduledStartTimestamp,
            scheduledEndTimestamp: e.scheduledEndTimestamp,
            image: e.coverImageURL({ size: 1024 }),
            location: e.entityMetadata?.location || 'Discord',
            url: e.url
        }));
    } catch (err) {
        console.error('Failed to fetch guild scheduled events:', err.message);
        return [];
    }
}

/**
 * Create a native Discord Scheduled Event
 */
async function createScheduledEvent(event) {
    if (!state.isReady) return null;
    try {
        const guildId = process.env.DISCORD_GUILD_ID;
        const guild = await client.guilds.fetch(guildId);

        const scheduledEvent = await guild.scheduledEvents.create({
            ...buildScheduledEventFields(event),
            privacyLevel: 2, // GUILD_ONLY
            reason: 'DEMS Sync'
        });

        // Set Image: an uploaded banner (W-12) as the file itself, so it works
        // without a public BASE_URL; an external one as its URL
        const banner = bannerForDiscord(event.bannerUrl);
        if (banner.file || banner.url) {
            try {
                await scheduledEvent.setImage(banner.file || banner.url);
            } catch (e) {
                console.warn('Could not set banner image for scheduled event:', e.message);
            }
        }

        console.log(`✅ Scheduled Event created: ${scheduledEvent.name} (${scheduledEvent.id})`);
        return scheduledEvent.id;
    } catch (err) {
        console.error('Failed to create scheduled event:', err);
        return null;
    }
}

/**
 * The synced Discord server event of a DEMS event.
 *
 * @param {Object} event -> Event with `discordScheduledEventId`.
 * @returns {Promise<Object>} -> discord.js GuildScheduledEvent (throws 10070 when it is gone).
 */
async function fetchScheduledEvent(event) {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    return guild.scheduledEvents.fetch(event.discordScheduledEventId);
}

/**
 * Bring the Discord server event up to date after the DEMS event was saved (B-09).
 *
 * @param {Object} event -> Saved event with `discordScheduledEventId`.
 * @param {Object} [options]
 * @param {boolean} [options.bannerChanged] -> Upload the (new) banner as image; otherwise the image stays.
 * @param {Date} [options.now] -> Reference time for a start in the past.
 * @returns {Promise<'updated'|'gone'|false>} -> 'gone' when Discord no longer knows the event; false while
 *   not ready, for finished Discord events and on other errors (logged).
 */
async function updateScheduledEvent(event, { bannerChanged = false, now = new Date() } = {}) {
    if (!state.isReady || !event?.discordScheduledEventId) return false;
    try {
        const scheduled = await fetchScheduledEvent(event);
        if (FINISHED.includes(scheduled.status)) return false;
        const fields = buildScheduledEventFields(event, now);
        // Discord refuses a start in the past, and a running event keeps its start
        if (scheduled.status === GuildScheduledEventStatus.Active || fields.scheduledStartTime <= now) {
            delete fields.scheduledStartTime;
        }
        await scheduled.edit({ ...fields, reason: 'DEMS Sync' });
        if (bannerChanged) {
            const banner = bannerForDiscord(event.bannerUrl);
            await scheduled.setImage(banner.file || banner.url || null);
        }
        return 'updated';
    } catch (err) {
        if (err.code === UNKNOWN_SCHEDULED_EVENT) return 'gone';
        console.error('Could not update the Discord server event:', err.message);
        return false;
    }
}

/**
 * Remove the Discord server event (event cancelled, deleted or back to draft).
 *
 * @param {Object} event -> Event with `discordScheduledEventId`.
 * @returns {Promise<boolean>} -> True when it is gone (also when it already was); false while not ready or on errors (logged).
 */
async function removeScheduledEvent(event) {
    if (!state.isReady || !event?.discordScheduledEventId) return false;
    try {
        const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
        await guild.scheduledEvents.delete(event.discordScheduledEventId);
        return true;
    } catch (err) {
        if (err.code === UNKNOWN_SCHEDULED_EVENT) return true;
        console.error('Could not remove the Discord server event:', err.message);
        return false;
    }
}

/**
 * Set the Discord server event to running or completed. Discord only allows
 * scheduled -> active -> completed, so a never started event is started first.
 *
 * @param {Object} event -> Event with `discordScheduledEventId`.
 * @param {'active'|'completed'} target -> Wanted state.
 * @returns {Promise<'active'|'completed'|'gone'|false>} -> The state reached; 'gone' when it no longer exists
 *   (or was cancelled in Discord); false while not ready or on errors (logged).
 */
async function setScheduledEventStatus(event, target) {
    if (!state.isReady || !event?.discordScheduledEventId) return false;
    const S = GuildScheduledEventStatus;
    try {
        const scheduled = await fetchScheduledEvent(event);
        if (scheduled.status === S.Completed) return 'completed';
        if (scheduled.status === S.Canceled) return 'gone';
        if (scheduled.status === S.Scheduled) await scheduled.setStatus(S.Active);
        if (target === 'completed') {
            await scheduled.setStatus(S.Completed);
            return 'completed';
        }
        return 'active';
    } catch (err) {
        if (err.code === UNKNOWN_SCHEDULED_EVENT) return 'gone';
        console.error('Could not set the status of the Discord server event:', err.message);
        return false;
    }
}

module.exports = {
    buildScheduledEventFields,
    getGuildScheduledEvents,
    createScheduledEvent,
    updateScheduledEvent,
    removeScheduledEvent,
    setScheduledEventStatus
};
