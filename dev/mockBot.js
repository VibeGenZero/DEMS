/**
 * Simulated versions of every bot.js function that talks to Discord.
 *
 * bot.js merges these exports over its own ones when DEV_MOCK=true. The
 * routes then read roles, channels and scheduled events of the mock server
 * (dev/mockGuild.js), and everything that would be sent to Discord is
 * printed to the console with the [MOCK-DISCORD] prefix instead.
 */
const crypto = require('crypto');
const { db, doc, getDoc, updateDoc } = require('../firebaseAdmin');
const { GUILD, ROLES, CHANNELS, buildScheduledEvents, findMember } = require('./mockGuild');
const { buildEventUrl } = require('../utils/eventUrl');

const LOG_PREFIX = '\x1b[35m[MOCK-DISCORD]\x1b[0m';
const startedAt = new Date();
let dmsSent = 0;

/**
 * Print a simulated Discord action.
 *
 * @param {string} action -> What would have happened in Discord.
 * @param {*} [details] -> Payload that would have been sent.
 */
function mockLog(action, details) {
    if (details === undefined) {
        console.log(`${LOG_PREFIX} ${action}`);
    } else {
        console.log(`${LOG_PREFIX} ${action}`, details);
    }
}

/**
 * Convert a discord.js builder (embed, action row) into its API payload.
 *
 * @param {*} value -> Builder or plain value.
 * @returns {*} -> JSON payload, or the value itself when it is no builder.
 */
function toPayload(value) {
    if (!value || typeof value.toJSON !== 'function') return value;
    try {
        return value.toJSON();
    } catch (err) {
        return `[ungültige Komponente: ${err.message}]`;
    }
}

/** Readable name of a user for the log. */
function describeUser(userId) {
    const member = findMember(userId);
    return member ? `${member.displayName} (${userId})` : userId;
}

/** Readable name of a role for the log. */
function describeRole(roleId) {
    const role = ROLES.find(r => r.id === roleId);
    return role ? `@${role.name}` : roleId;
}

/** Readable name of a channel for the log. */
function describeChannel(channelId) {
    const channel = CHANNELS.find(c => c.id === channelId);
    return channel ? `#${channel.name}` : channelId;
}

/** Random 18 digit ID for channels and events created by the mock. */
function fakeSnowflake() {
    return `9${Date.now()}${String(crypto.randomInt(10000)).padStart(4, '0')}`;
}

/**
 * Channels in the format of bot.js -> `{ id, name, type }`, sorted by name.
 *
 * @param {Function} filter -> Decides which mock channels are listed.
 * @returns {Array<Object>} -> Matching channels.
 */
function listChannels(filter) {
    return CHANNELS
        .filter(filter)
        .map(({ id, name, type }) => ({ id, name, type }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Lifecycle ────────────────────────────────────────────────────────────

async function startBot() {
    mockLog(`Bot simuliert — verbunden mit "${GUILD.name}"`);
    return true;
}

// ── Reading ──────────────────────────────────────────────────────────────

async function getGuildName() {
    return GUILD.name;
}

// The mock server has no icon -> the login card shows its initials
async function getGuildIconUrl() {
    return null;
}

async function getGuildRoles() {
    return ROLES.map(role => ({ ...role }));
}

async function getGuildChannels() {
    return listChannels(() => true);
}

async function getPublicGuildChannels() {
    return listChannels(channel => channel.isPublic);
}

async function getGuildScheduledEvents() {
    return buildScheduledEvents(new Date());
}

async function getUserRoles(userId) {
    const member = findMember(userId);
    if (!member) return [];
    return ROLES
        .filter(role => member.roles.includes(role.id))
        .map(role => ({ id: role.id, name: role.name, color: `#${role.color.toString(16).padStart(6, '0')}` }));
}

async function fetchMemberRoleIds(userId) {
    const member = findMember(userId);
    return member ? { isMember: true, roleIds: [...member.roles] } : { isMember: false, roleIds: [] };
}

async function isGuildMember(userId) {
    return !!findMember(userId);
}

function getBotStatus() {
    return {
        online: true,
        username: 'DEMS Bot (Mock)#0000',
        avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
        uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
        startedAt: startedAt.toISOString(),
        ping: 42,
        guildName: GUILD.name,
        guildMemberCount: GUILD.memberCount,
        guildId: GUILD.id,
        dmsSent,
        commandsProcessed: 0,
        reminderSchedulerActive: true,
        presenceAutoUpdate: false
    };
}

// ── Sending ──────────────────────────────────────────────────────────────

async function sendDM(userId, message) {
    dmsSent++;
    const payload = typeof message === 'string'
        ? message
        : {
            ...message,
            embeds: (message.embeds || []).map(toPayload),
            components: (message.components || []).map(toPayload)
        };
    mockLog(`DM an ${describeUser(userId)}`, payload);
    return true;
}

async function sendChannelMessage(channelId, embed, options = {}) {
    mockLog(`Nachricht in ${describeChannel(channelId)}`, {
        text: options.text || '',
        roleIds: (options.roleIds || []).map(describeRole),
        pingEveryone: !!options.pingEveryone,
        embed: toPayload(embed),
        components: (options.components || []).map(toPayload)
    });
    return { channelId, messageId: fakeSnowflake() };
}

async function refreshEventAnnouncements(eventId) {
    const snap = await getDoc(doc(db, 'events', eventId));
    if (!snap.exists()) return false;

    const event = snap.data();
    const announcements = Array.isArray(event.announcements) ? event.announcements : [];
    if (announcements.length === 0) return false;

    // Required lazily -> bot.js merges this module into its own exports
    const { buildEventEmbed, buildEventComponents } = require('../bot');
    const { loadEventRoster } = require('../utils/eventUtils');
    const roster = await loadEventRoster(eventId, event);
    mockLog(`Ankündigung von "${event.title}" aktualisiert (${announcements.length}×)`, {
        embed: toPayload(buildEventEmbed(event, buildEventUrl(eventId), roster)),
        components: buildEventComponents(event, eventId, roster).map(toPayload)
    });
    return true;
}

async function refreshPollMessages(pollId) {
    const { loadPoll, loadPollVotes } = require('../utils/pollStore');
    const poll = await loadPoll(pollId);
    if (!poll) return false;
    const announcements = Array.isArray(poll.announcements) ? poll.announcements : [];
    if (announcements.length === 0) return false;

    // Required lazily -> bot.js merges this module into its own exports
    const { buildPollEmbed, buildPollComponents } = require('../bot');
    const { tallyPoll } = require('../utils/pollService');
    const tally = tallyPoll(poll, await loadPollVotes(pollId));
    mockLog(`Abstimmung "${poll.title}" aktualisiert (${announcements.length}×)`, {
        embed: toPayload(buildPollEmbed(poll, tally)),
        components: buildPollComponents(poll).map(toPayload)
    });
    return true;
}

async function markPollMessagesDeleted(poll) {
    const announcements = Array.isArray(poll.announcements) ? poll.announcements : [];
    if (announcements.length === 0) return false;
    mockLog(`Abstimmung "${poll.title}" als gelöscht markiert (${announcements.length}×)`);
    return true;
}

async function sendGuestInvitation(guestUserId, registrant, event, registrationId) {
    dmsSent++;
    mockLog(`Gäste-Einladung an ${describeUser(guestUserId)}`, {
        from: registrant.displayName,
        event: event.title,
        registrationId
    });
    return true;
}

async function assignRole(userId, roleId) {
    mockLog(`Rolle ${describeRole(roleId)} an ${describeUser(userId)} vergeben`);
    return true;
}

async function removeRole(userId, roleId) {
    mockLog(`Rolle ${describeRole(roleId)} von ${describeUser(userId)} entfernt`);
    return true;
}

// ── Channels & scheduled events ─────────────────────────────────────────

async function createEventChannels(event) {
    if (event.discordChannelId || event.discordTextChannelId) {
        return { voiceId: event.discordChannelId, textId: event.discordTextChannelId };
    }

    const type = (event.channelConfig && event.channelConfig.type) || 'voice';
    const voiceId = type === 'voice' || type === 'both' ? fakeSnowflake() : null;
    const textId = type === 'text' || type === 'both' ? fakeSnowflake() : null;

    await updateDoc(doc(db, 'events', event.id), { discordChannelId: voiceId, discordTextChannelId: textId });
    mockLog(`Event-Channels für "${event.title}" erstellt`, { voiceId, textId });
    return { voiceId, textId };
}

async function addParticipantToEventChannels(event, userId) {
    if (!event.discordChannelId && !event.discordTextChannelId) return false;
    mockLog(`${describeUser(userId)} zu den Channels von "${event.title}" hinzugefügt`);
    return true;
}

async function removeParticipantFromEventChannels(event, userId) {
    if (!event.discordChannelId && !event.discordTextChannelId) return false;
    mockLog(`${describeUser(userId)} aus den Channels von "${event.title}" entfernt`);
    return true;
}

async function deleteEventChannels(eventId) {
    const snap = await getDoc(doc(db, 'events', eventId));
    if (!snap.exists()) return false;

    const event = snap.data();
    if (!event.discordChannelId && !event.discordTextChannelId) return false;

    await updateDoc(doc(db, 'events', eventId), { discordChannelId: null, discordTextChannelId: null });
    mockLog(`Event-Channels für "${event.title}" gelöscht`);
    return true;
}

async function createScheduledEvent(event) {
    const id = fakeSnowflake();
    mockLog(`Scheduled Event "${event.title}" erstellt`, { id, startDate: event.startDate, endDate: event.endDate });
    return id;
}

module.exports = {
    startBot,
    getGuildName,
    getGuildIconUrl,
    getGuildRoles,
    getGuildChannels,
    getPublicGuildChannels,
    getGuildScheduledEvents,
    getUserRoles,
    fetchMemberRoleIds,
    isGuildMember,
    getBotStatus,
    sendDM,
    sendChannelMessage,
    refreshEventAnnouncements,
    refreshPollMessages,
    markPollMessagesDeleted,
    sendGuestInvitation,
    assignRole,
    removeRole,
    createEventChannels,
    addParticipantToEventChannels,
    removeParticipantFromEventChannels,
    deleteEventChannels,
    createScheduledEvent
};
