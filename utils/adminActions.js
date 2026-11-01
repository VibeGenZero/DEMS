/**
 * Admin actions the website and the Discord admin commands (B-13) share:
 * building a new event, publishing a draft, announcing an event, creating
 * and announcing a date poll. Routes map the results to HTTP answers.
 *
 * Bot helpers are loaded inside the functions (`require('../bot')`), so mock
 * mode gets its twins and bot/ modules can require this file without a cycle.
 */
const { db, collection, doc, getDoc, addDoc, updateDoc } = require('../firebaseAdmin');
const { addAuditLog, loadEventRoster } = require('./eventUtils');
const { mergeReminderHours } = require('./reminders');
const { sumCapacity } = require('./slotService');
const { loadBotSettings, announceTarget } = require('./botSettings');
const { notifyRegistrationsChanged } = require('./announcementRefresh');
const { normalizePollInput, tallyPoll } = require('./pollService');
const { loadPoll, loadPollVotes } = require('./pollStore');
const { debugLog } = require('./debugLog');

// Announcement records kept per event or poll (older ones are no longer refreshed)
const MAX_TRACKED_ANNOUNCEMENTS = 5;
const SEND_FAILED = 'Konnte nicht in den Channel posten.';

const bot = () => require('../bot');
/** Audit detail suffix for actions done through the Discord commands. */
const viaNote = (via) => (via === 'discord' ? ' in Discord' : '');

/**
 * The document of a new event from wizard or modal input. Slots must be
 * normalized already; they decide the places and switch guests off.
 *
 * @param {Object} input -> Event fields (`slots` normalized, `sourcePollId` optional).
 * @param {string} createdBy -> Discord user id of the admin.
 * @returns {Object} -> Event document.
 */
function buildNewEvent(input, createdBy) {
    const slots = Array.isArray(input.slots) ? input.slots : [];
    const startDate = input.startDate || '';
    return {
        title: input.title,
        description: input.description,
        maxParticipants: slots.length > 0 ? sumCapacity(slots) : (parseInt(input.maxParticipants) || 0),
        accessMode: input.accessMode || 'open',
        requiredRoles: input.requiredRoles || [],
        approvalMode: input.approvalMode || 'manual',
        assignRoleId: input.assignRoleId || '',
        formFields: input.formFields || [],
        startDate,
        endDate: input.endDate || '',
        registrationDeadline: input.registrationDeadline || '',
        unregisterDeadline: input.unregisterDeadline || '',
        // Set by the scheduler once the announcement lost its buttons at the deadline (W-03)
        registrationClosedRefreshed: false,
        bannerUrl: input.bannerUrl || '',
        category: input.category || '',
        status: input.status || 'active',
        reminderHours: mergeReminderHours(input.reminderHours, null, startDate),
        checkinMessage: input.checkinMessage || '',
        customBotMessages: input.customBotMessages || {},
        autoCreateChannels: !!input.autoCreateChannels,
        channelConfig: input.channelConfig || {},
        allowGuests: slots.length > 0 ? false : input.allowGuests !== false,
        slots,
        sourcePollId: input.sourcePollId || '',
        accentColor: input.accentColor || '',
        location: input.location || null,
        eventStartNotificationSent: false,
        recurring: !!input.recurring,
        recurringInterval: input.recurringInterval || '',
        recurringUntil: input.recurringUntil || '',
        createdAt: new Date().toISOString(),
        createdBy
    };
}

/**
 * Create the private channels of an event unless "Auto Channel-Erstellung" is
 * off in the bot center (B-02). The event keeps its own option either way.
 *
 * @param {Object} event -> Event with `id`.
 * @returns {Promise<Object|null>} -> Channel ids, or null when locked or failed.
 */
async function createEventChannelsAllowed(event) {
    const { autoChannelCreation } = await loadBotSettings();
    if (!autoChannelCreation) {
        debugLog('admin.channelsLocked', { eventId: event.id });
        return null;
    }
    return bot().createEventChannels(event);
}

/**
 * Publish a draft: status active, audit entry, channels, announcement refresh.
 *
 * @param {string} eventId -> Event document id.
 * @param {string} adminId -> Discord user id of the admin.
 * @param {Object} [options]
 * @param {string} [options.via] -> 'discord' marks the audit detail.
 * @returns {Promise<{ ok: true, event: Object } | { ok: false, code: 'missing'|'not_draft'|'no_start' }>}
 */
async function publishDraft(eventId, adminId, { via } = {}) {
    const snap = await getDoc(doc(db, 'events', eventId));
    if (!snap.exists()) return { ok: false, code: 'missing' };
    const event = snap.data();
    if (event.status !== 'draft') return { ok: false, code: 'not_draft' };
    // Members plan by the start date -> an event without one stays a draft (D-10)
    if (!event.startDate) return { ok: false, code: 'no_start' };

    const updates = { status: 'active', updatedAt: new Date().toISOString() };
    await updateDoc(doc(db, 'events', eventId), updates);
    await addAuditLog('UPDATE_EVENT_STATUS', adminId, `Changed status to active${viaNote(via)}`, eventId);
    notifyRegistrationsChanged(eventId);
    if (event.autoCreateChannels) {
        createEventChannelsAllowed({ id: eventId, ...event, ...updates }).catch(console.error);
    }
    return { ok: true, event: { ...event, ...updates } };
}

/**
 * Post an event to the announcement channel and remember the message; opens
 * the discussion thread when the bot center wants one (B-14).
 *
 * @param {string} eventId -> Event document id.
 * @param {string} adminId -> Discord user id of the admin.
 * @param {Object} [options]
 * @param {Object} [options.pings] -> `{ text, roleIds, pingEveryone }`.
 * @param {string} [options.via] -> 'discord' marks the audit detail.
 * @returns {Promise<{ ok: true, sent: Object, event: Object } | { ok: false, status: number, error: string }>}
 */
async function announceEvent(eventId, adminId, { pings = {}, via } = {}) {
    const settings = await loadBotSettings();
    // Bot center choice, else DISCORD_ANNOUNCE_CHANNEL_ID (B-02)
    const target = announceTarget(settings);
    if (target.error) return { ok: false, status: 400, error: target.error };

    const snap = await getDoc(doc(db, 'events', eventId));
    if (!snap.exists()) return { ok: false, status: 404, error: 'Event nicht gefunden' };
    const event = snap.data();

    const { buildAnnouncementIntro, buildEventAnnouncement, sendChannelMessage, ensureAnnouncementThread } = bot();
    const ping = {
        text: typeof pings.text === 'string' ? pings.text : '',
        roleIds: Array.isArray(pings.roleIds) ? pings.roleIds : [],
        pingEveryone: !!pings.pingEveryone
    };
    // Stored with the record: live updates keep the ping line (B-05)
    const intro = buildAnnouncementIntro(ping);
    const roster = await loadEventRoster(eventId, event);
    const sent = await sendChannelMessage(target.channelId, buildEventAnnouncement(event, eventId, roster, intro), ping);
    if (!sent) return { ok: false, status: 500, error: SEND_FAILED };

    const announcements = [
        ...(Array.isArray(event.announcements) ? event.announcements : []),
        { channelId: sent.channelId, messageId: sent.messageId, intro }
    ].slice(-MAX_TRACKED_ANNOUNCEMENTS);
    const updates = { announcements };
    // One discussion thread per event (B-14); a failed thread never fails the announcement
    if (settings.announcementThreads) {
        const thread = await ensureAnnouncementThread(sent, event.title, event.discordThread || null);
        if (thread && thread !== event.discordThread) updates.discordThread = thread;
    }
    await updateDoc(doc(db, 'events', eventId), updates);
    await addAuditLog('ANNOUNCE_EVENT', adminId, `Announced event "${event.title}"${viaNote(via)}`, eventId);
    return { ok: true, sent, event: { ...event, ...updates } };
}

/**
 * Create an open date poll with the rules of normalizePollInput.
 *
 * @param {Object} input -> `{ title, description, options: [{ startDate, endDate }] }`.
 * @param {string} adminId -> Discord user id of the admin.
 * @param {Object} [options]
 * @param {string} [options.via] -> 'discord' marks the audit detail.
 * @returns {Promise<{ ok: true, poll: Object } | { ok: false, error: string }>} -> The poll with `id`.
 */
async function createPoll(input, adminId, { via } = {}) {
    const result = normalizePollInput(input);
    if (result.error) return { ok: false, error: result.error };
    const now = new Date().toISOString();
    const poll = {
        ...result.poll,
        status: 'open',
        winnerOptionId: '',
        eventId: '',
        announcements: [],
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
        closedAt: ''
    };
    const ref = await addDoc(collection(db, 'polls'), poll);
    await addAuditLog('CREATE_POLL', adminId, `Created poll "${poll.title}"${viaNote(via)}`, ref.id);
    return { ok: true, poll: { id: ref.id, ...poll } };
}

/**
 * Post a date poll to the announcement channel and remember the message.
 *
 * @param {string} pollId -> Poll document id.
 * @param {string} adminId -> Discord user id of the admin.
 * @param {Object} [options]
 * @param {Object} [options.pings] -> `{ text, roleIds, pingEveryone }`.
 * @param {string} [options.via] -> 'discord' marks the audit detail.
 * @returns {Promise<{ ok: true, sent: Object } | { ok: false, status: number, error: string }>}
 */
async function announcePoll(pollId, adminId, { pings = {}, via } = {}) {
    const target = announceTarget(await loadBotSettings());
    if (target.error) return { ok: false, status: 400, error: target.error };
    const poll = await loadPoll(pollId);
    if (!poll) return { ok: false, status: 404, error: 'Abstimmung nicht gefunden' };

    const { buildAnnouncementIntro, buildPollMessage, sendChannelMessage } = bot();
    const ping = {
        text: typeof pings.text === 'string' ? pings.text : '',
        roleIds: Array.isArray(pings.roleIds) ? pings.roleIds : [],
        pingEveryone: !!pings.pingEveryone
    };
    const intro = buildAnnouncementIntro(ping);
    const tally = tallyPoll(poll, await loadPollVotes(poll.id));
    const sent = await sendChannelMessage(target.channelId, buildPollMessage(poll, tally, intro), ping);
    if (!sent) return { ok: false, status: 500, error: SEND_FAILED };

    const announcements = [
        ...(Array.isArray(poll.announcements) ? poll.announcements : []),
        { channelId: sent.channelId, messageId: sent.messageId, intro }
    ].slice(-MAX_TRACKED_ANNOUNCEMENTS);
    await updateDoc(doc(db, 'polls', poll.id), { announcements });
    await addAuditLog('ANNOUNCE_POLL', adminId, `Announced poll "${poll.title}"${viaNote(via)}`, poll.id);
    return { ok: true, sent };
}

module.exports = {
    MAX_TRACKED_ANNOUNCEMENTS,
    buildNewEvent,
    createEventChannelsAllowed,
    publishDraft,
    announceEvent,
    createPoll,
    announcePoll
};
