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
const { GUILD, ROLES, CHANNELS, CATEGORIES, PERSONAS, MEMBERS, buildScheduledEvents, findMember } = require('./mockGuild');
const { getTimezone } = require('../utils/timezone');

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

// A new token or guild (#138): the simulated bot is back at once
async function restartBot() {
    mockLog(`Bot simuliert neu angemeldet — verbunden mit "${GUILD.name}"`);
    return { ok: true, guildName: GUILD.name };
}

// The simulated bot is ready at once
async function whenBotSettled() {
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

async function getGuildCategories() {
    return CATEGORIES.map(({ id, name }) => ({ id, name }));
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

/** Member data like bot.js returns it; the mock server has no avatars. */
const toMemberInfo = (member) => ({ id: member.userId, username: member.username, displayName: member.displayName, avatar: '' });

// Discord matches only the start of a name; the mock also matches inside it, which is friendlier for the persona names
async function searchGuildMembers(query, limit = 10) {
    const term = String(query || '').toLowerCase();
    const hits = [...PERSONAS, ...MEMBERS]
        .filter(member => member.displayName.toLowerCase().includes(term) || member.username.toLowerCase().includes(term))
        .slice(0, limit)
        .map(toMemberInfo);
    mockLog(`Mitgliedersuche "${query}"`, `${hits.length} Treffer`);
    return hits;
}

async function fetchGuildMember(userId) {
    const member = findMember(userId);
    mockLog(`Mitglied abgefragt: ${describeUser(userId)}`);
    return member ? toMemberInfo(member) : false;
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

/**
 * JSON of a Components V2 payload for the log, nested components included.
 *
 * @param {Object} payload -> `{ flags, components }` of a message builder.
 * @returns {string} -> Indented JSON.
 */
function describePayload(payload) {
    return JSON.stringify((payload?.components || []).map(toPayload), null, 2);
}

async function sendChannelMessage(channelId, payload, options = {}) {
    mockLog(`Nachricht in ${describeChannel(channelId)}`, {
        roleIds: (options.roleIds || []).map(describeRole),
        pingEveryone: !!options.pingEveryone
    });
    console.log(describePayload(payload));
    return { channelId, messageId: fakeSnowflake(), guildId: GUILD.id };
}

async function ensureAnnouncementThread(sent, title, existing = null) {
    // The mock cannot see deleted threads, so a stored one is always kept
    if (existing && existing.threadId) return existing;
    const thread = { guildId: GUILD.id, threadId: fakeSnowflake() };
    mockLog(`Diskussions-Thread "${String(title).slice(0, 100)}" an Nachricht ${sent.messageId} eröffnet`, thread);
    return thread;
}

async function refreshEventAnnouncements(eventId) {
    const snap = await getDoc(doc(db, 'events', eventId));
    if (!snap.exists()) return false;

    const event = snap.data();
    const announcements = Array.isArray(event.announcements) ? event.announcements : [];
    if (announcements.length === 0) return false;

    // Required lazily -> bot.js merges this module into its own exports
    const { buildEventAnnouncement } = require('../bot');
    const { loadEventRoster } = require('../utils/eventUtils');
    const roster = await loadEventRoster(eventId, event);
    mockLog(`Ankündigung von "${event.title}" aktualisiert (${announcements.length}×)`);
    console.log(describePayload(buildEventAnnouncement(event, eventId, roster, announcements[0].intro || '')));
    return true;
}

async function refreshPollMessages(pollId) {
    const { loadPoll, loadPollVotes } = require('../utils/pollStore');
    const poll = await loadPoll(pollId);
    if (!poll) return false;
    const announcements = Array.isArray(poll.announcements) ? poll.announcements : [];
    if (announcements.length === 0) return false;

    // Required lazily -> bot.js merges this module into its own exports
    const { buildPollMessage } = require('../bot');
    const { tallyPoll } = require('../utils/pollService');
    const tally = tallyPoll(poll, await loadPollVotes(pollId));
    mockLog(`Abstimmung "${poll.title}" aktualisiert (${announcements.length}×)`);
    console.log(describePayload(buildPollMessage(poll, tally, announcements[0].intro || '')));
    return true;
}

async function markPollMessagesDeleted(poll) {
    const announcements = Array.isArray(poll.announcements) ? poll.announcements : [];
    if (announcements.length === 0) return false;
    mockLog(`Abstimmung "${poll.title}" als gelöscht markiert (${announcements.length}×)`);
    return true;
}

async function sendApprovalRequest(registrationId) {
    const { loadApprovalRequest, storeApprovalMessage } = require('../utils/approvalRequests');
    const request = await loadApprovalRequest(registrationId);
    if (!request) return null;
    mockLog(`Freigabe-Anfrage in ${describeChannel(request.channelId)} für ${describeUser(request.registration.userId)} ("${request.event.title}")`, {
        formAnswers: request.registration.formAnswers || {}
    });
    return storeApprovalMessage(registrationId, { channelId: request.channelId, messageId: fakeSnowflake() });
}

async function closeApprovalRequest(registration, outcome, event = null) {
    const { formatOutcome, eventForClosing, storedApprovalMessage } = require('../utils/approvalRequests');
    const stored = storedApprovalMessage(registration);
    if (!stored) return false;
    const eventData = await eventForClosing(registration, event);
    mockLog(`Freigabe-Anfrage ${stored.messageId} geschlossen ("${eventData.title || registration.eventId}"): ${formatOutcome(outcome)}`);
    return true;
}

async function sendCheckinInvitations(eventId) {
    const { isCheckinRunning, listCheckinInvitees, markInvited } = require('../utils/checkin');
    const { withEventLock } = require('../utils/eventLock');
    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists() || !isCheckinRunning(eventSnap.data())) return 0;
    const event = eventSnap.data();
    return withEventLock(`checkin:${eventId}`, async () => {
        const invitees = await listCheckinInvitees(eventId);
        for (const { id, userId } of invitees) {
            await markInvited(id);
            mockLog(`Check-in-Einladung an ${describeUser(userId)} ("${event.title}") mit Button „Einchecken“`);
        }
        return invitees.length;
    });
}

async function mirrorCommentToThread(commentId) {
    const { isThreadSyncEnabled, loadCommentWithEvent, storeDiscordMessageId, webhookName } = require('../utils/threadSync');
    if (!isThreadSyncEnabled()) return null;
    const loaded = await loadCommentWithEvent(commentId);
    if (!loaded) return null;
    const { comment, event } = loaded;
    if (!event.discordThread?.threadId || comment.source === 'discord' || comment.discordMessageId) return null;
    const messageId = fakeSnowflake();
    mockLog(`Kommentar in Thread "${event.title}" als „${webhookName(comment.userName)}“: ${comment.text}`);
    await storeDiscordMessageId(commentId, messageId);
    return messageId;
}

async function deleteMirroredMessage(comment, event) {
    const { isThreadSyncEnabled } = require('../utils/threadSync');
    if (!isThreadSyncEnabled() || !comment?.discordMessageId || !event?.discordThread?.threadId) return false;
    mockLog(`Kommentar-Kopie ${comment.discordMessageId} im Thread "${event.title || ''}" gelöscht`);
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

async function sendWaitlistOffer(registrationId) {
    const regSnap = await getDoc(doc(db, 'registrations', registrationId));
    if (!regSnap.exists()) return false;
    const registration = regSnap.data();
    const eventSnap = await getDoc(doc(db, 'events', registration.eventId));
    if (!eventSnap.exists() || !registration.offer) return false;
    const until = new Date(registration.offer.expiresAt).toLocaleString('de-DE', { timeZone: getTimezone() });
    mockLog(`Platz angeboten: ${describeUser(registration.userId)} für "${eventSnap.data().title}" bis ${until}`,
        { buttons: [`offer_confirm:${registrationId}`, `offer_decline:${registrationId}`, 'Zum Event'] });
    dmsSent++;
    return true;
}

async function removeRoleFromMembers(roleId, userIds) {
    const members = userIds.length === 1 ? '1 Mitglied' : `${userIds.length} Mitgliedern`;
    mockLog(`Rolle ${describeRole(roleId)} von ${members} entfernt`, userIds.map(describeUser));
    return { removed: userIds.length, failed: 0 };
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

// A Discord server event id starting with "gone" counts as deleted in Discord (B-09, for tests)
const isGoneScheduledEvent = (event) => String(event?.discordScheduledEventId || '').startsWith('gone');

async function updateScheduledEvent(event, { bannerChanged = false } = {}) {
    if (!event?.discordScheduledEventId) return false;
    if (isGoneScheduledEvent(event)) return 'gone';
    mockLog(`Server-Event "${event.title}" aktualisiert${bannerChanged ? ' (neues Bild)' : ''}`, { startDate: event.startDate, endDate: event.endDate });
    return 'updated';
}

async function removeScheduledEvent(event) {
    if (!event?.discordScheduledEventId) return false;
    if (!isGoneScheduledEvent(event)) mockLog(`Server-Event "${event.title}" entfernt`);
    return true;
}

async function setScheduledEventStatus(event, target) {
    if (!event?.discordScheduledEventId) return false;
    if (isGoneScheduledEvent(event)) return 'gone';
    mockLog(`Server-Event "${event.title}" ${target === 'completed' ? 'beendet' : 'läuft'}`);
    return target;
}

module.exports = {
    startBot,
    restartBot,
    whenBotSettled,
    getGuildName,
    getGuildIconUrl,
    getGuildRoles,
    getGuildChannels,
    getPublicGuildChannels,
    getGuildCategories,
    getGuildScheduledEvents,
    getUserRoles,
    fetchMemberRoleIds,
    isGuildMember,
    searchGuildMembers,
    fetchGuildMember,
    getBotStatus,
    sendDM,
    sendChannelMessage,
    ensureAnnouncementThread,
    refreshEventAnnouncements,
    refreshPollMessages,
    markPollMessagesDeleted,
    sendGuestInvitation,
    sendApprovalRequest,
    closeApprovalRequest,
    sendCheckinInvitations,
    mirrorCommentToThread,
    deleteMirroredMessage,
    assignRole,
    removeRole,
    removeRoleFromMembers,
    sendWaitlistOffer,
    createEventChannels,
    addParticipantToEventChannels,
    removeParticipantFromEventChannels,
    deleteEventChannels,
    createScheduledEvent,
    updateScheduledEvent,
    removeScheduledEvent,
    setScheduledEventStatus
};
