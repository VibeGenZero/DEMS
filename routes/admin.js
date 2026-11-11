const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const {
    db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, writeBatch
} = require('../firebaseAdmin');
const { requireAuth, requireAdmin, safeEqual } = require('../middleware/auth');
const { csvCell } = require('../utils/csv');
const { checkEventFields, validateEvent, validateRegStatus, validateBotMessages } = require('../middleware/validators');
const { MAX_TEMPLATES, pickTemplateSettings, normalizeTemplateName, nameTaken } = require('../utils/eventTemplates');
const { sendDM, getGuildRoles, buildEventAnnouncement, getGuildScheduledEvents, deleteEventChannels, createScheduledEvent, updateScheduledEvent, removeScheduledEvent, setScheduledEventStatus, getBotStatus, getBotSettings, saveBotSettings, getRunningEvents, getGuildChannels, searchGuildMembers, fetchGuildMember, sendCheckinInvitations } = require('../bot');
const { promoteFromWaitlist, addAuditLog, loadEventRoster, loadEventRegistrations, loadUserParticipations, saveEventWithSlots } = require('../utils/eventUtils');
const { mergeReminderHours } = require('../utils/reminders');
const { keepDeadlineRefreshFlag } = require('../utils/eventListing');
const { describeEventChanges, notifyEventChange } = require('../utils/eventChangeNotice');
const { filterByPreference, normalizeNotificationPrefs } = require('../utils/notificationPrefs');
const { trackedEventIds, memberStats, memberBase, buildMemberList, buildMemberHistory } = require('../utils/memberOverview');
const { clearedCheckins, toParticipations, isListedGuest, guestCheckinOf } = require('../utils/participations');
const { setGuestCheckin } = require('../utils/checkin');
const { DEFAULT_RANGE, isValidRange, buildInsights } = require('../utils/insights');
const { MESSAGE_GROUPS, messageRecipients, recipientCounts, validateMessageText, sendParticipantMessage } = require('../utils/participantMessage');
const { describePlaces, formatPlaces, formatWaitlist, waitlistPositions } = require('../utils/capacity');
const { getSlots, findSlot, formatSlotLabel, normalizeSlots, sumCapacity, buildRoster, validateSlotChange } = require('../utils/slotService');
const { buildPreviewEvent } = require('../utils/eventPreview');
const {
    loadPoll, updatePoll, closePoll, decidePollWithEvent, deletePoll
} = require('../utils/pollStore');
const { withEventLock } = require('../utils/eventLock');
const { moveRegistrationToSlot, addRegistrationByAdmin, isOnRegistrationList, notifyStatusChange } = require('../utils/registrationService');
const { notifyRegistrationsChanged } = require('../utils/announcementRefresh');
const { changeRegistrationStatus } = require('../utils/registrationStatus');
const { closePendingRequests, actorName } = require('../utils/approvalRequests');
const { debugLog } = require('../utils/debugLog');
const { buildEventUrl } = require('../utils/eventUrl');
const { MAX_BANNER_BYTES, detectImageType, saveBanner, releaseBanners } = require('../utils/bannerStore');
const { sharedSessionStore } = require('../utils/sessionStore');
const { loadBotSettings, announceChannelId, isValidConfirmHours } = require('../utils/botSettings');
const { BULK_ACTIONS, MAX_BULK_IDS, planBulkAction } = require('../utils/bulkRegistrations');
const { followingDates, transferTime, planExtension, seriesUpdateFields, slotsForDate } = require('../utils/eventSeries');
const { cleanupEvent, restoreEventRole } = require('../utils/eventCleanup');
const {
    buildNewEvent, createEventChannelsAllowed, announceEvent, createPoll, announcePoll
} = require('../utils/adminActions');

// Statuses after which an event is over for good -> clean-up in Discord (B-10)
const OVER_STATUSES = ['archived', 'cancelled'];

/**
 * Clean-up or role hand-back after a status change (B-10), fire and forget:
 * archived/cancelled from another status -> channels and event role go;
 * active again -> the role comes back (see utils/eventCleanup.js).
 *
 * @param {string} eventId -> Event document id.
 * @param {Object} oldEvent -> The event before the change.
 * @param {string} status -> The status after the change.
 * @returns {boolean} -> True when a clean-up was started (it deletes the channels itself).
 */
function followStatusInDiscord(eventId, oldEvent, status) {
    if (OVER_STATUSES.includes(status) && !OVER_STATUSES.includes(oldEvent.status)) {
        cleanupEvent(eventId).catch(console.error);
        return true;
    }
    if (status === 'active') restoreEventRole(eventId, oldEvent).catch(console.error);
    return false;
}

// Days and clock times of series dates (W-11)
const { getTimezone } = require('../utils/timezone');


// All admin routes require auth + admin
router.use(requireAuth, requireAdmin);

// Database-backed configuration and privacy policy, the "System" view (#138)
router.use(require('./adminSystem'));

/**
 * GET /api/admin/roles — Get all guild roles
 */
router.get('/roles', async (req, res) => {
    const roles = await getGuildRoles(process.env.DISCORD_GUILD_ID);
    res.json(roles);
});

/**
 * GET /api/admin/channels — List guild channels for location autocomplete
 */
router.get('/channels', async (req, res) => {
    try {
        const guildId = process.env.DISCORD_GUILD_ID;
        if (!guildId) return res.json([]);
        const channels = await getGuildChannels(guildId);
        res.json(channels);
    } catch (err) {
        console.error('Get channels error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Channels' });
    }
});

/**
 * GET /api/admin/stats — Dashboard statistics
 */
router.get('/stats', async (req, res) => {
    try {
        // Count events
        const eventsSnap = await getDocs(collection(db, 'events'));
        let totalEvents = 0;
        let activeEvents = 0;
        let draftEvents = 0;
        let archivedEvents = 0;

        eventsSnap.forEach(d => {
            totalEvents++;
            const status = d.data().status || 'active';
            if (status === 'active') activeEvents++;
            else if (status === 'draft') draftEvents++;
            else if (status === 'archived') archivedEvents++;
        });

        // Count registrations
        const regsSnap = await getDocs(collection(db, 'registrations'));
        let totalRegs = 0;
        let pendingRegs = 0;
        let acceptedRegs = 0;
        let rejectedRegs = 0;
        let waitlistedRegs = 0;
        let tentativeRegs = 0;

        regsSnap.forEach(d => {
            const r = d.data();
            const count = 1 + (Array.isArray(r.guests) ? r.guests.length : 0);
            totalRegs += count;
            const status = r.status;
            if (status === 'pending') pendingRegs += count;
            else if (status === 'accepted') acceptedRegs += count;
            else if (status === 'rejected') rejectedRegs += count;
            else if (status === 'waitlisted') waitlistedRegs += count;
            else if (status === 'tentative') tentativeRegs += count;
        });

        res.json({
            events: { total: totalEvents, active: activeEvents, draft: draftEvents, archived: archivedEvents },
            registrations: { total: totalRegs, pending: pendingRegs, accepted: acceptedRegs, rejected: rejectedRegs, waitlisted: waitlistedRegs, tentative: tentativeRegs }
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
    }
});

/**
 * GET /api/admin/all-events — Get ALL events (including draft/archived) with their places
 */
router.get('/all-events', async (req, res) => {
    try {
        const [eventsSnap, registrationsSnap] = await Promise.all([
            getDocs(query(collection(db, 'events'), orderBy('createdAt', 'desc'))),
            getDocs(collection(db, 'registrations'))
        ]);
        // One read for all events, grouped in memory instead of one query per event
        const registrationsByEvent = new Map();
        registrationsSnap.forEach(docSnap => {
            const registration = docSnap.data();
            if (!registrationsByEvent.has(registration.eventId)) registrationsByEvent.set(registration.eventId, []);
            registrationsByEvent.get(registration.eventId).push(registration);
        });
        const events = [];
        eventsSnap.forEach(docSnap => {
            const event = docSnap.data();
            events.push({
                id: docSnap.id,
                ...event,
                places: describePlaces(registrationsByEvent.get(docSnap.id) || [], event.maxParticipants)
            });
        });
        res.json(events);
    } catch (err) {
        console.error('Error fetching all events:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Events' });
    }
});

/**
 * GET /api/admin/import/discord-events — Fetch scheduled events from Discord
 */
router.get('/import/discord-events', async (req, res) => {
    try {
        const events = await getGuildScheduledEvents(process.env.DISCORD_GUILD_ID);
        res.json(events);
    } catch (err) {
        console.error('Import discord events error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Discord-Events' });
    }
});

/**
 * Raw body parser of the banner upload: takes every content type (the type is
 * read from the bytes) and turns "too large" into our own 413 answer.
 */
const parseBannerBody = (req, res, next) => {
    express.raw({ type: () => true, limit: MAX_BANNER_BYTES })(req, res, (err) => {
        if (!err) return next();
        if (err.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Das Bild darf höchstens 5 MB groß sein.' });
        }
        console.error('Banner upload body error:', err);
        return res.status(400).json({ error: 'Keine Bilddatei empfangen.' });
    });
};

/**
 * POST /api/admin/uploads/banner — Store an event banner (raw image body)
 */
router.post('/uploads/banner', parseBannerBody, async (req, res) => {
    try {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            return res.status(400).json({ error: 'Keine Bilddatei empfangen.' });
        }
        const type = detectImageType(req.body);
        if (!type) {
            return res.status(400).json({ error: 'Nur PNG-, JPEG-, WebP- oder GIF-Bilder sind erlaubt.' });
        }
        const bannerUrl = await saveBanner(req.body, type);
        await addAuditLog('UPLOAD_BANNER', req.session.user.id, `Uploaded banner ${bannerUrl.split('/').pop()} (${req.body.length} bytes)`);
        res.json({ bannerUrl });
    } catch (err) {
        console.error('Banner upload error:', err);
        res.status(500).json({ error: 'Fehler beim Hochladen des Banners.' });
    }
});

/**
 * POST /api/admin/events — Create event
 */
router.post('/events', validateEvent, async (req, res) => {
    try {
        const {
            title, startDate, endDate, status, recurring, recurringInterval, recurringUntil,
            registrationDeadline, unregisterDeadline
        } = req.body;

        const slotResult = normalizeSlots(req.body.slots);
        if (slotResult.error) {
            return res.status(400).json({ error: slotResult.error });
        }
        const { slots } = slotResult;

        // An event can be created from a date poll -> checked and decided together with the creation below
        const fromPoll = req.body.fromPoll && typeof req.body.fromPoll === 'object' ? req.body.fromPoll : null;
        // Voters get a DM with the event link -> the event must be visible to members
        if (fromPoll && (status || 'active') !== 'active') {
            return res.status(400).json({ error: 'Ein Event aus einer Abstimmung muss aktiv sein.' });
        }

        const baseEvent = buildNewEvent({ ...req.body, slots, sourcePollId: fromPoll ? String(fromPoll.pollId) : '' }, req.session.user.id);

        /**
         * Write the event (or every instance of a series).
         *
         * @returns {Promise<Object>} -> `{ eventId, body }` -> first event ID and the response body.
         */
        const writeEvents = async () => {
            if (recurring && startDate && recurringUntil) {
                const seriesId = crypto.randomUUID();
                const createdEvents = [];
                let currentStart = new Date(startDate);
                // Compare only the date portion (YYYY-MM-DD) so the full last day is included
                // regardless of the event's time-of-day
                const duration = endDate ? (new Date(endDate) - new Date(startDate)) : 0;
                // Deadlines keep their distance to the start on every date (W-03)
                const offsetOf = (deadline) => (deadline ? new Date(startDate) - new Date(deadline) : null);
                const registrationOffset = offsetOf(registrationDeadline);
                const unregisterOffset = offsetOf(unregisterDeadline);
                const shift = (offset) => (offset === null ? '' : new Date(currentStart.getTime() - offset).toISOString());

                while (currentStart.toISOString().substring(0, 10) <= recurringUntil) {
                    const instance = {
                        ...baseEvent,
                        seriesId,
                        startDate: currentStart.toISOString(),
                        endDate: duration ? new Date(currentStart.getTime() + duration).toISOString() : '',
                        registrationDeadline: shift(registrationOffset),
                        unregisterDeadline: shift(unregisterOffset),
                    };
                    const ref = await addDoc(collection(db, 'events'), instance);
                    createdEvents.push({ id: ref.id, ...instance });

                    // Advance date based on interval
                    if (recurringInterval === 'weekly') {
                        currentStart = new Date(currentStart.getTime() + 7 * 24 * 60 * 60 * 1000);
                    } else if (recurringInterval === 'biweekly') {
                        currentStart = new Date(currentStart.getTime() + 14 * 24 * 60 * 60 * 1000);
                    } else {
                        currentStart.setMonth(currentStart.getMonth() + 1);
                    }
                }

                await addAuditLog('CREATE_EVENT', req.session.user.id, `Created ${createdEvents.length} recurring events "${title}"`, createdEvents[0]?.id);
                return { eventId: createdEvents[0]?.id, body: { count: createdEvents.length, events: createdEvents } };
            }

            const ref = await addDoc(collection(db, 'events'), baseEvent);
            debugLog('admin.createEvent', { title: req.body.title, adminId: req.session?.user?.id });
            await addAuditLog('CREATE_EVENT', req.session.user.id, `Created event "${title}"`, ref.id);
            if (baseEvent.autoCreateChannels && baseEvent.status === 'active') {
                createEventChannelsAllowed({ id: ref.id, ...baseEvent }).catch(console.error);
            }
            return { eventId: ref.id, body: { id: ref.id, ...baseEvent } };
        };

        if (!fromPoll) {
            const { body } = await writeEvents();
            return res.json(body);
        }

        // Check, creation and decision run under the poll lock -> one poll never becomes two events
        const decision = await decidePollWithEvent({
            pollId: String(fromPoll.pollId),
            optionId: String(fromPoll.optionId),
            createEvent: writeEvents
        });
        if (!decision.ok) {
            return res.status(decision.httpStatus).json({ error: decision.error });
        }
        await addAuditLog('DECIDE_POLL', req.session.user.id, `Decided poll "${decision.poll.title}" -> event ${decision.created.eventId}`, decision.poll.id);
        res.json(decision.created.body);

    } catch (err) {
        console.error('Create event error:', err);
        res.status(500).json({ error: 'Fehler beim Erstellen des Events' });
    }
});

/**
 * POST /api/admin/events/preview — Discord announcement and places of an
 * unsaved event for the wizard preview; built like "Ankündigen", stores nothing
 */
router.post('/events/preview', async (req, res) => {
    try {
        const id = typeof req.body.id === 'string' ? req.body.id : '';
        const event = buildPreviewEvent(req.body);
        // A new event shows the message as right after announcing it: nobody registered yet
        const roster = id ? await loadEventRoster(id, event) : buildRoster(event, []);
        const linkId = id || 'vorschau';
        const bot = getBotStatus() || {};
        res.json({
            // The V2 message as the bot would post it now, without a ping line (B-05)
            message: { components: buildEventAnnouncement(event, linkId, roster).components.map(component => component.toJSON()) },
            places: { ...roster.places, text: formatPlaces(roster.places), waitlistText: formatWaitlist(roster.places.waitlist) },
            bot: { name: String(bot.username || 'DEMS').replace(/#\d+$/, ''), avatarUrl: bot.avatarUrl || null }
        });
    } catch (err) {
        console.error('Event preview error:', err);
        res.status(500).json({ error: 'Vorschau konnte nicht erstellt werden.' });
    }
});

// Audit detail suffix for members who switched a DM kind off (W-16)
const optedOutNote = (optedOut) => (optedOut > 0 ? `; ${optedOut} opted out` : '');

/**
 * Fields PUT /events/:id writes from the wizard input.
 *
 * @param {Object} body -> Request body.
 * @param {Array<Object>} slots -> Normalized slots.
 * @param {Object} oldEvent -> Stored event before the save.
 * @returns {Object} -> Updates for the event document.
 */
function buildEventUpdates(body, slots, oldEvent) {
    const {
        title, description, maxParticipants, accessMode, requiredRoles,
        approvalMode, assignRoleId, formFields,
        startDate, endDate, bannerUrl, category, status, reminderHours, checkinMessage,
        customBotMessages, autoCreateChannels, channelConfig, allowGuests, allowTentative,
        accentColor, location, registrationDeadline, unregisterDeadline, announceChannelId
    } = body;
    // A date of a series keeps its rhythm; "Wiederholen bis" changes only by an extension (W-11)
    const inSeries = !!oldEvent.seriesId;
    return {
        title,
        description,
        maxParticipants: slots.length > 0 ? sumCapacity(slots) : (parseInt(maxParticipants) || 0),
        accessMode: accessMode || 'open',
        requiredRoles: requiredRoles || [],
        approvalMode: approvalMode || 'manual',
        assignRoleId: assignRoleId || '',
        formFields: formFields || [],
        startDate: startDate || '',
        endDate: endDate || '',
        registrationDeadline: registrationDeadline || '',
        unregisterDeadline: unregisterDeadline || '',
        // A moved deadline lets the scheduler refresh the announcement again (W-03)
        registrationClosedRefreshed: keepDeadlineRefreshFlag(oldEvent, registrationDeadline || ''),
        bannerUrl: bannerUrl || '',
        category: category || '',
        status: status || 'active',
        // Same start -> reminders already sent stay sent, editing must not send them again
        reminderHours: mergeReminderHours(reminderHours, oldEvent, startDate || ''),
        checkinMessage: checkinMessage || '',
        customBotMessages: customBotMessages || {},
        autoCreateChannels: !!autoCreateChannels,
        channelConfig: channelConfig || {},
        // Own announcement channel, '' = default (B-11)
        announceChannelId: announceChannelId || '',
        allowGuests: slots.length > 0 ? false : allowGuests !== false,
        // „Vielleicht“ / Ersatzbank (B-17); turning it off keeps the bench
        allowTentative: allowTentative === true,
        slots,
        sourcePollId: oldEvent.sourcePollId || '',
        accentColor: accentColor || '',
        location: location || null,
        recurring: inSeries ? true : !!body.recurring,
        recurringInterval: inSeries ? (oldEvent.recurringInterval || '') : (body.recurringInterval || ''),
        recurringUntil: inSeries ? (oldEvent.recurringUntil || '') : (body.recurringUntil || ''),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Updates of a following date of a series (W-11): the shared settings of the
 * edited date, the edited start time and duration on the date's own day.
 *
 * @param {Object} edited -> Updates written to the edited date.
 * @param {Array<Object>} slots -> Normalized slots of this date.
 * @param {Object} oldEvent -> Stored date before the save.
 * @returns {Object} -> Updates for the date's document.
 */
function buildFollowingUpdates(edited, slots, oldEvent) {
    const times = transferTime(oldEvent.startDate, edited, getTimezone()) || {
        startDate: oldEvent.startDate || '',
        endDate: oldEvent.endDate || '',
        registrationDeadline: oldEvent.registrationDeadline || '',
        unregisterDeadline: oldEvent.unregisterDeadline || ''
    };
    return {
        ...seriesUpdateFields(edited),
        ...times,
        slots,
        maxParticipants: slots.length > 0 ? sumCapacity(slots) : edited.maxParticipants,
        allowGuests: slots.length > 0 ? false : edited.allowGuests,
        reminderHours: mergeReminderHours(edited.reminderHours, oldEvent, times.startDate),
        registrationClosedRefreshed: keepDeadlineRefreshFlag(oldEvent, times.registrationDeadline),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Side effects after one date was saved: channels, waitlist, announcement and
 * the optional change DM (W-04).
 *
 * @param {Object} params -> `{ eventId, oldEvent, updates, notify, adminId }`.
 * @returns {Promise<number>} -> Participants notified successfully.
 */
/**
 * Store what a Discord server event call reached (B-09): 'gone' forgets the link, so
 * „Mit Discord synchronisieren“ is offered again; a status is kept to skip repeated calls.
 *
 * @param {string} eventId -> Event document id (still existing).
 * @param {string|boolean} result -> Result of updateScheduledEvent / setScheduledEventStatus, or 'gone'.
 * @returns {Promise<void>}
 */
async function storeScheduledEventResult(eventId, result) {
    if (result === 'gone') {
        await updateDoc(doc(db, 'events', eventId), { discordScheduledEventId: null, discordScheduledEventStatus: null });
    } else if (result === 'active' || result === 'completed') {
        await updateDoc(doc(db, 'events', eventId), { discordScheduledEventStatus: result });
    }
}

/**
 * Keep the Discord server event of a synced event in step after a change (B-09):
 * cancelled or draft -> removed, archived -> completed, active -> updated.
 * Meant to run fire and forget; never throws.
 *
 * @param {string} eventId -> Event document id.
 * @param {Object} event -> The event as it is now (with `discordScheduledEventId`).
 * @param {Object} [options]
 * @param {boolean} [options.bannerChanged] -> Upload the banner again.
 * @returns {Promise<void>}
 */
async function syncScheduledEventAfterChange(eventId, event, { bannerChanged = false } = {}) {
    if (!event?.discordScheduledEventId) return;
    try {
        let result;
        if (event.status === 'cancelled' || event.status === 'draft') {
            result = (await removeScheduledEvent(event)) ? 'gone' : false;
        } else if (event.status === 'archived') {
            result = await setScheduledEventStatus(event, 'completed');
        } else {
            result = await updateScheduledEvent(event, { bannerChanged });
        }
        await storeScheduledEventResult(eventId, result);
    } catch (err) {
        console.error('Discord server event sync error:', err.message);
    }
}

async function applySavedEvent({ eventId, oldEvent, updates, notify, adminId }) {
    // Following dates of a series keep their status -> it is not in their updates
    const status = updates.status || oldEvent.status;
    const isNowActive = status === 'active';
    const wasActive = oldEvent.status === 'active';

    const hasChannels = !!(oldEvent.discordChannelId || oldEvent.discordTextChannelId);
    const cleaningUp = followStatusInDiscord(eventId, oldEvent, status);
    if (updates.autoCreateChannels && isNowActive && !hasChannels) {
        createEventChannelsAllowed({ id: eventId, ...updates }).catch(console.error);
    } else if (!cleaningUp && (oldEvent.autoCreateChannels && wasActive) && (!updates.autoCreateChannels || !isNowActive)) {
        deleteEventChannels(eventId).catch(console.error);
    }

    // The synced Discord server event follows the saved event (B-09)
    syncScheduledEventAfterChange(eventId, { ...oldEvent, ...updates, status }, {
        bannerChanged: updates.bannerUrl !== undefined && updates.bannerUrl !== oldEvent.bannerUrl
    });

    // More places or new slots can let waitlisted members move up
    await promoteFromWaitlist(eventId, { ...oldEvent, ...updates });
    notifyRegistrationsChanged(eventId);

    // Change DM only on the admin's explicit request (W-04) and while DM notifications
    // are on in the bot center (B-02); the flag itself is never stored
    const changes = describeEventChanges(oldEvent, updates);
    if (!notify || !isNowActive || changes.length === 0) return 0;
    if (!(await loadBotSettings()).dmNotifications) return 0;
    const { recipients, notified, optedOut } = await notifyEventChange({ eventId, title: updates.title, changes });
    if (recipients + optedOut > 0) {
        const changed = changes.map(change => change.label).join(', ');
        await addAuditLog('NOTIFY_EVENT_CHANGE', adminId,
            `Notified ${notified} of ${recipients} participants about changed ${changed}${optedOutNote(optedOut)}`, eventId);
    }
    return notified;
}

// Day of a series date in German messages, e.g. "14.11."
const seriesDayLabel = (iso) => new Intl.DateTimeFormat('de-DE', { timeZone: getTimezone(), day: '2-digit', month: '2-digit' }).format(new Date(iso));

/**
 * Check the slots of the request against the registrations of every following date.
 *
 * @param {Array<Object>|undefined} rawSlots -> Slots of the request.
 * @param {Array<Object>} dates -> Following dates with `id`.
 * @returns {Promise<string|null>} -> German error naming the first date that refuses, or null.
 */
async function checkFollowingSlots(rawSlots, dates) {
    for (const date of dates) {
        const oldSlots = getSlots(date);
        const result = normalizeSlots(slotsForDate(rawSlots, oldSlots), oldSlots);
        const error = result.error || validateSlotChange({ oldSlots, newSlots: result.slots, registrations: await loadEventRegistrations(date.id) });
        if (error) return `Termin ${seriesDayLabel(date.startDate)}: ${error}`;
    }
    return null;
}

/**
 * Create the dates an extension adds to a series (W-11) and store the new end on every date.
 *
 * @param {Object} params -> `{ seriesId, editedId, starts, newUntil, adminId }`.
 * @returns {Promise<number>} -> Number of created dates.
 */
async function extendSeries({ seriesId, editedId, starts, newUntil, adminId }) {
    const all = await loadSeriesDates(seriesId);
    const changeable = all.filter(date => ['draft', 'active'].includes(date.status || 'active'));
    const template = changeable.at(-1) || all.find(date => date.id === editedId);
    const { id: _templateId, ...base } = template;
    const now = new Date().toISOString();
    for (const start of starts) {
        const times = transferTime(start, template, getTimezone());
        const created = {
            ...base,
            ...times,
            recurringUntil: newUntil,
            checkinCode: '',
            checkinEnabled: false,
            announcements: [],
            discordThread: null,
            discordChannelId: null,
            discordTextChannelId: null,
            // A new date is not linked to the Discord server event of the copied one (B-09)
            discordScheduledEventId: null,
            discordScheduledEventStatus: null,
            discordCleanup: null,
            reminderHours: mergeReminderHours(base.reminderHours, null, times.startDate),
            eventStartNotificationSent: false,
            registrationClosedRefreshed: false,
            createdAt: now,
            createdBy: adminId
        };
        delete created.updatedAt;
        await addDoc(collection(db, 'events'), created);
    }
    for (const date of all) {
        if (date.recurringUntil !== newUntil) await updateDoc(doc(db, 'events', date.id), { recurringUntil: newUntil });
    }
    await addAuditLog('EXTEND_SERIES', adminId, `Extended series "${template.title}" to ${newUntil}: ${starts.length} new dates`, editedId);
    return starts.length;
}

/** Stored dates of a series with `id`, sorted by start. */
async function loadSeriesDates(seriesId) {
    const snapshot = await getDocs(collection(db, 'events'));
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        .filter(event => event.seriesId === seriesId)
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}

/**
 * Save a date of a series, optionally with the following dates, and extend
 * the series (W-11). Runs under the series lock.
 *
 * @param {Object} params -> `{ eventId, stored, body, applyTo, adminId }`.
 * @returns {Promise<Object>} -> `{ status, body }` for the answer.
 */
async function saveSeriesDate({ eventId, stored, body, applyTo, adminId }) {
    const all = await loadSeriesDates(stored.seriesId);
    const plan = planExtension({
        seriesEvents: all, interval: stored.recurringInterval, oldUntil: stored.recurringUntil || '',
        newUntil: typeof body.recurringUntil === 'string' ? body.recurringUntil : '', timeZone: getTimezone()
    });
    if (plan.error) return { status: 400, body: { error: plan.error } };

    const following = applyTo === 'following' ? followingDates(all, { id: eventId, ...stored }) : [];
    const slotError = await checkFollowingSlots(body.slots, following);
    if (slotError) return { status: 400, body: { error: slotError } };

    const saved = await saveEventWithSlots(eventId, body.slots, (slots, oldEvent) => buildEventUpdates(body, slots, oldEvent));
    if (!saved.ok) return { status: 400, body: { error: saved.error } };
    await addAuditLog('UPDATE_EVENT', adminId, `Updated event "${body.title}"`, eventId);
    const savedDates = [{ eventId, oldEvent: saved.oldEvent, updates: saved.updates }];

    // A registration can land in a removed slot after the check -> the dates saved so far stay
    let conflict = null;
    for (const date of following) {
        const result = await saveEventWithSlots(date.id, slotsForDate(body.slots, getSlots(date)),
            (slots, oldEvent) => buildFollowingUpdates(saved.updates, slots, oldEvent));
        if (!result.ok) {
            const lastSaved = savedDates.at(-1).updates.startDate;
            conflict = `Die Änderung wurde bis zum ${seriesDayLabel(lastSaved)} übernommen; der Termin ${seriesDayLabel(date.startDate)} hat inzwischen Anmeldungen in einem entfernten Slot.`;
            break;
        }
        savedDates.push({ eventId: date.id, oldEvent: result.oldEvent, updates: result.updates });
    }
    const updatedDates = savedDates.length - 1;
    if (updatedDates > 0) {
        await addAuditLog('UPDATE_SERIES', adminId, `Applied changes of "${saved.updates.title}" to ${updatedDates} following dates`, eventId);
    }

    let notifiedCount = 0;
    for (const date of savedDates) {
        notifiedCount += await applySavedEvent({ ...date, notify: body.notifyParticipants === true, adminId });
    }
    // A replaced or cleared upload is deleted once no other event uses it (W-12)
    await releaseBanners(savedDates.filter(date => date.oldEvent.bannerUrl !== date.updates.bannerUrl).map(date => date.oldEvent.bannerUrl));
    if (conflict) return { status: 409, body: { error: conflict } };

    const createdDates = plan.starts.length > 0
        ? await extendSeries({ seriesId: stored.seriesId, editedId: eventId, starts: plan.starts, newUntil: body.recurringUntil, adminId })
        : 0;
    const recurringUntil = createdDates > 0 ? body.recurringUntil : saved.updates.recurringUntil;
    return { status: 200, body: { id: eventId, ...saved.updates, recurringUntil, notifiedCount, updatedDates, createdDates } };
}

/**
 * PUT /api/admin/events/:id — Update event; for a date of a series optionally
 * with all following dates (`applyTo: 'following'`) and an extension (W-11)
 */
router.put('/events/:id', validateEvent, async (req, res) => {
    try {
        const adminId = req.session.user.id;
        const storedSnap = await getDoc(doc(db, 'events', req.params.id));
        const stored = storedSnap.exists() ? storedSnap.data() : {};
        if (stored.seriesId) {
            const applyTo = req.body.applyTo === 'following' ? 'following' : 'this';
            const result = await withEventLock(`series:${stored.seriesId}`,
                () => saveSeriesDate({ eventId: req.params.id, stored, body: req.body, applyTo, adminId }));
            return res.status(result.status).json(result.body);
        }

        // Slots are validated and written under the event lock -> a parallel
        // registration cannot land in a slot that is being removed
        const saved = await saveEventWithSlots(req.params.id, req.body.slots, (slots, oldEvent) => buildEventUpdates(req.body, slots, oldEvent));
        if (!saved.ok) {
            return res.status(400).json({ error: saved.error });
        }
        const { oldEvent, updates } = saved;
        await addAuditLog('UPDATE_EVENT', adminId, `Updated event "${updates.title}"`, req.params.id);
        // A replaced or cleared upload is deleted once no other event uses it (W-12)
        if (oldEvent.bannerUrl && oldEvent.bannerUrl !== updates.bannerUrl) await releaseBanners([oldEvent.bannerUrl]);

        const notifiedCount = await applySavedEvent({
            eventId: req.params.id, oldEvent, updates, notify: req.body.notifyParticipants === true, adminId
        });
        res.json({ id: req.params.id, ...updates, notifiedCount, updatedDates: 0, createdDates: 0 });
    } catch (err) {
        console.error('Update event error:', err);
        res.status(500).json({ error: 'Fehler beim Aktualisieren' });
    }
});

/**
 * PUT /api/admin/events/:id/status — Change event status
 */
router.put('/events/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (!['draft', 'active', 'archived', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Ungültiger Status' });
        }

        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const oldEvent = eventSnap.exists() ? eventSnap.data() : {};
        // Members plan by the start date -> an event without one stays a draft (D-10)
        if (status === 'active' && !oldEvent.startDate) {
            return res.status(400).json({ error: 'Aktive Events brauchen ein Startdatum.' });
        }

        await updateDoc(doc(db, 'events', req.params.id), { status, updatedAt: new Date().toISOString() });
        await addAuditLog('UPDATE_EVENT_STATUS', req.session.user.id, `Changed status to ${status}`, req.params.id);
        notifyRegistrationsChanged(req.params.id);
        syncScheduledEventAfterChange(req.params.id, { ...oldEvent, status });
        const cleaningUp = followStatusInDiscord(req.params.id, oldEvent, status);

        if (oldEvent.autoCreateChannels) {
            if (status === 'active' && oldEvent.status !== 'active') {
                createEventChannelsAllowed({ id: req.params.id, ...oldEvent, status }).catch(console.error);
            } else if (!cleaningUp && status !== 'active' && oldEvent.status === 'active') {
                deleteEventChannels(req.params.id).catch(console.error);
            }
        }

        res.json({ id: req.params.id, status });
    } catch (err) {
        console.error('Update event status error:', err);
        res.status(500).json({ error: 'Fehler beim Aktualisieren des Status' });
    }
});

/**
 * PUT /api/admin/events/:id/cancel — Cancel event and notify participants
 */
router.put('/events/:id/cancel', async (req, res) => {
    try {
        const eventId = req.params.id;
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists()) return res.status(404).json({ error: 'Event nicht gefunden' });

        const event = eventSnap.data();

        // 1. Update status
        await updateDoc(doc(db, 'events', eventId), { status: 'cancelled', updatedAt: new Date().toISOString() });
        syncScheduledEventAfterChange(eventId, { ...event, status: 'cancelled' });
        // Channels and event role go (B-10); an event over already was cleaned up then
        if (!OVER_STATUSES.includes(event.status)) cleanupEvent(eventId).catch(console.error);

        // 2. Notify participants
        const regQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', eventId),
            where('status', 'in', ['accepted', 'pending'])
        );
        const regs = await getDocs(regQ);
        // The cancellation counts as a change: members may switch it off (W-16)
        const { userIds, optedOut } = await filterByPreference(regs.docs.map(regDoc => regDoc.data().userId), 'changes');

        let notifiedCount = 0;
        for (const userId of userIds) {
            const sent = await sendDM(userId, `⚠️ **WICHTIG:** Das Event **${event.title}** wurde leider **ABGESAGT**.`);
            if (sent) notifiedCount++;
        }

        await closePendingRequests(regs.docs.map(regDoc => regDoc.data()), { status: 'cancelled' }, event);
        await addAuditLog('CANCEL_EVENT', req.session.user.id, `Cancelled event "${event.title}" and notified ${notifiedCount} users${optedOutNote(optedOut)}`, eventId);
        notifyRegistrationsChanged(eventId);

        res.json({ success: true, notifiedCount });
    } catch (err) {
        console.error('Cancel event error:', err);
        res.status(500).json({ error: 'Fehler beim Absagen' });
    }
});

/**
 * POST /api/admin/events/:id/start — Manually start event
 */
router.post('/events/:id/start', async (req, res) => {
    try {
        const eventId = req.params.id;
        const col = collection(db, 'events');
        const eventSnap = await getDoc(doc(col, eventId));
        if (!eventSnap.exists()) return res.status(404).json({ error: 'Event nicht gefunden' });

        const data = eventSnap.data();
        const updates = {
            status: 'active',
            updatedAt: new Date().toISOString()
        };
        // Set start date to now if empty OR if we want to force update? 
        // Plan says: set to NOW if empty.
        if (!data.startDate) {
            updates.startDate = new Date().toISOString();
        }

        await updateDoc(doc(col, eventId), updates);
        await addAuditLog('START_EVENT', req.session.user.id, `Manually started event "${data.title}"`, eventId);
        notifyRegistrationsChanged(eventId);
        if (data.discordScheduledEventId) {
            setScheduledEventStatus({ ...data, ...updates }, 'active')
                .then(result => storeScheduledEventResult(eventId, result))
                .catch(err => console.error('Discord server event start error:', err.message));
        }

        if (data.autoCreateChannels && data.status !== 'active') {
            createEventChannelsAllowed({ id: eventId, ...data, ...updates }).catch(console.error);
        }

        res.json({ success: true, updates });
    } catch (err) {
        console.error('Start event error:', err);
        res.status(500).json({ error: 'Fehler beim Starten' });
    }
});

/**
 * POST /api/admin/events/:id/end — Manually end event
 */
router.post('/events/:id/end', async (req, res) => {
    try {
        const eventId = req.params.id;
        const col = collection(db, 'events');
        const eventSnap = await getDoc(doc(col, eventId));
        if (!eventSnap.exists()) return res.status(404).json({ error: 'Event nicht gefunden' });

        const data = eventSnap.data();
        const updates = {
            status: 'archived',
            updatedAt: new Date().toISOString(),
            endDate: new Date().toISOString() // Always set end date to now
        };

        await updateDoc(doc(col, eventId), updates);
        await addAuditLog('END_EVENT', req.session.user.id, `Manually ended event "${data.title}"`, eventId);
        notifyRegistrationsChanged(eventId);
        if (data.discordScheduledEventId) {
            setScheduledEventStatus({ ...data, ...updates }, 'completed')
                .then(result => storeScheduledEventResult(eventId, result))
                .catch(err => console.error('Discord server event end error:', err.message));
        }

        // Channels and event role go (B-10); an event over already was cleaned up then
        if (!OVER_STATUSES.includes(data.status)) cleanupEvent(eventId).catch(console.error);

        res.json({ success: true, updates });
    } catch (err) {
        console.error('End event error:', err);
        res.status(500).json({ error: 'Fehler beim Beenden' });
    }
});

/**
 * DELETE /api/admin/events/:id — Delete event
 */
router.delete('/events/:id', async (req, res) => {
    try {
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const event = eventSnap.exists() ? eventSnap.data() : null;

        // The clean-up reads the channel ids and the registrations -> before they are gone (B-10)
        if (event) await cleanupEvent(req.params.id);
        // The Discord server event goes too (B-09); it only needs the stored id
        if (event?.discordScheduledEventId) {
            removeScheduledEvent(event).catch(err => console.error('Discord server event delete error:', err.message));
        }

        await deleteDoc(doc(db, 'events', req.params.id));
        // Also delete all registrations for this event
        const regQ = query(collection(db, 'registrations'), where('eventId', '==', req.params.id));
        const regs = await getDocs(regQ);
        const deletePromises = [];
        regs.forEach(docSnap => {
            deletePromises.push(deleteDoc(doc(db, 'registrations', docSnap.id)));
        });
        await Promise.all(deletePromises);
        await closePendingRequests(regs.docs.map(docSnap => docSnap.data()), { status: 'deleted' }, event);
        if (event) await releaseBanners([event.bannerUrl]);

        await addAuditLog('DELETE_EVENT', req.session.user.id, `Deleted event ${req.params.id}`, req.params.id);

        res.json({ success: true });
    } catch (err) {
        console.error('Delete event error:', err);
        res.status(500).json({ error: 'Fehler beim Löschen' });
    }
});

/**
 * DELETE /api/admin/events/series/:seriesId — Delete all events in a series
 */
router.delete('/events/series/:seriesId', async (req, res) => {
    try {
        const seriesId = req.params.seriesId;
        const snapshot = await getDocs(collection(db, 'events'));
        const eventIds = [];
        const banners = [];
        const eventsById = new Map();
        snapshot.forEach(docSnap => {
            if (docSnap.data().seriesId === seriesId) {
                eventIds.push(docSnap.id);
                banners.push(docSnap.data().bannerUrl);
                eventsById.set(docSnap.id, docSnap.data());
            }
        });

        if (!eventIds.length) {
            return res.status(404).json({ error: 'Serie nicht gefunden' });
        }

        // Delete all events and their registrations
        for (const eventId of eventIds) {
            // Clean-up first: it reads the channel ids and the registrations (B-10)
            await cleanupEvent(eventId);
            const seriesEvent = eventsById.get(eventId);
            if (seriesEvent.discordScheduledEventId) {
                removeScheduledEvent(seriesEvent).catch(err => console.error('Discord server event delete error:', err.message));
            }
            await deleteDoc(doc(db, 'events', eventId));

            const regQ = query(collection(db, 'registrations'), where('eventId', '==', eventId));
            const regs = await getDocs(regQ);
            const deletePromises = [];
            regs.forEach(regDoc => {
                deletePromises.push(deleteDoc(doc(db, 'registrations', regDoc.id)));
            });
            await Promise.all(deletePromises);
            await closePendingRequests(regs.docs.map(regDoc => regDoc.data()), { status: 'deleted' }, eventsById.get(eventId));
        }
        await releaseBanners(banners);

        await addAuditLog('DELETE_SERIES', req.session.user.id, `Deleted series ${seriesId} (${eventIds.length} events)`, eventIds[0]);
        res.json({ success: true, deletedCount: eventIds.length });
    } catch (err) {
        console.error('Delete series error:', err);
        res.status(500).json({ error: 'Fehler beim Löschen der Serie' });
    }
});

// ── Event templates (W-10) ──────────────────────────────────────────────

/** Every stored template as `{ id, ...data }`. */
async function loadTemplates() {
    const snapshot = await getDocs(collection(db, 'eventTemplates'));
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
}

/**
 * Check name and settings of a template body.
 *
 * @param {Object} body -> `{ name, settings }`.
 * @param {Array<Object>} templates -> Stored templates.
 * @param {string} [exceptId] -> Template being overwritten.
 * @returns {Promise<Object>} -> `{ name, settings }` or `{ status, error }`.
 */
async function checkTemplateBody(body, templates, exceptId) {
    const named = normalizeTemplateName(body.name);
    if (named.error) return { status: 400, error: named.error };
    if (nameTaken(templates, named.name, exceptId)) return { status: 409, error: 'Eine Vorlage mit diesem Namen gibt es schon.' };
    const input = body.settings && typeof body.settings === 'object' ? body.settings : {};
    const errors = await checkEventFields(input, { template: true });
    if (errors.length > 0) return { status: 400, error: errors.join(' ') };
    const picked = pickTemplateSettings(input);
    if (picked.error) return { status: 400, error: picked.error };
    return { name: named.name, settings: picked.settings };
}

/**
 * GET /api/admin/event-templates — All templates, sorted by name
 */
router.get('/event-templates', async (req, res) => {
    try {
        const templates = await loadTemplates();
        templates.sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
        res.json(templates);
    } catch (err) {
        console.error('List templates error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Vorlagen' });
    }
});

/**
 * POST /api/admin/event-templates — Store the wizard settings as a template
 */
router.post('/event-templates', async (req, res) => {
    try {
        const templates = await loadTemplates();
        if (templates.length >= MAX_TEMPLATES) {
            return res.status(400).json({ error: `Es sind höchstens ${MAX_TEMPLATES} Vorlagen möglich.` });
        }
        const checked = await checkTemplateBody(req.body, templates);
        if (checked.error) return res.status(checked.status).json({ error: checked.error });

        const template = {
            name: checked.name,
            settings: checked.settings,
            createdAt: new Date().toISOString(),
            createdBy: req.session.user.id,
            updatedAt: null,
            updatedBy: null
        };
        const ref = await addDoc(collection(db, 'eventTemplates'), template);
        await addAuditLog('CREATE_EVENT_TEMPLATE', req.session.user.id, `Created event template "${template.name}"`, ref.id);
        res.json({ id: ref.id, ...template });
    } catch (err) {
        console.error('Create template error:', err);
        res.status(500).json({ error: 'Fehler beim Speichern der Vorlage' });
    }
});

/**
 * PUT /api/admin/event-templates/:id — Overwrite name and settings of a template
 */
router.put('/event-templates/:id', async (req, res) => {
    try {
        const templates = await loadTemplates();
        const old = templates.find(template => template.id === req.params.id);
        if (!old) return res.status(404).json({ error: 'Vorlage nicht gefunden' });
        const checked = await checkTemplateBody(req.body, templates, old.id);
        if (checked.error) return res.status(checked.status).json({ error: checked.error });

        const template = {
            name: checked.name,
            settings: checked.settings,
            createdAt: old.createdAt || null,
            createdBy: old.createdBy || null,
            updatedAt: new Date().toISOString(),
            updatedBy: req.session.user.id
        };
        await setDoc(doc(db, 'eventTemplates', old.id), template);
        const oldBanner = old.settings?.bannerUrl;
        if (oldBanner && oldBanner !== template.settings.bannerUrl) await releaseBanners([oldBanner]);
        await addAuditLog('UPDATE_EVENT_TEMPLATE', req.session.user.id, `Updated event template "${template.name}"`, old.id);
        res.json({ id: old.id, ...template });
    } catch (err) {
        console.error('Update template error:', err);
        res.status(500).json({ error: 'Fehler beim Speichern der Vorlage' });
    }
});

/**
 * DELETE /api/admin/event-templates/:id — Delete a template; events made from it stay
 */
router.delete('/event-templates/:id', async (req, res) => {
    try {
        const ref = doc(db, 'eventTemplates', req.params.id);
        const snap = await getDoc(ref);
        if (!snap.exists()) return res.status(404).json({ error: 'Vorlage nicht gefunden' });
        const old = snap.data();
        await deleteDoc(ref);
        await releaseBanners([old.settings?.bannerUrl]);
        await addAuditLog('DELETE_EVENT_TEMPLATE', req.session.user.id, `Deleted event template "${old.name}"`, req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete template error:', err);
        res.status(500).json({ error: 'Fehler beim Löschen der Vorlage' });
    }
});

/**
 * POST /api/admin/events/:id/duplicate — Duplicate an event
 */
router.post('/events/:id/duplicate', async (req, res) => {
    try {
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        if (!eventSnap.exists()) {
            return res.status(404).json({ error: 'Event nicht gefunden' });
        }

        const original = eventSnap.data();
        const duplicate = {
            ...original,
            title: `${original.title} (Kopie)`,
            status: 'draft',
            createdAt: new Date().toISOString(),
            createdBy: req.session.user.id,
            checkinCode: '',  // Reset check-in code
            announcements: [],  // Each copy is announced on its own
            discordThread: null,  // and opens its own discussion thread (B-14)
            discordScheduledEventId: null,  // and is synced to Discord on its own (B-09)
            discordScheduledEventStatus: null,
            discordCleanup: null,  // and is cleaned up on its own (B-10)
            reminderHours: mergeReminderHours(original.reminderHours, null, original.startDate),  // nothing sent for the copy yet
            eventStartNotificationSent: false,
        };
        // Remove fields that shouldn't be copied
        delete duplicate.updatedAt;

        const ref = await addDoc(collection(db, 'events'), duplicate);
        await addAuditLog('DUPLICATE_EVENT', req.session.user.id, `Duplicated event "${original.title}"`, ref.id);
        res.json({ id: ref.id, ...duplicate });
    } catch (err) {
        console.error('Duplicate event error:', err);
        res.status(500).json({ error: 'Fehler beim Duplizieren' });
    }
});

/**
 * POST /api/admin/events/:id/generate-checkin — Generate a check-in code
 */
router.post('/events/:id/generate-checkin', async (req, res) => {
    try {
        const code = String(crypto.randomInt(100000, 1000000));
        await updateDoc(doc(db, 'events', req.params.id), {
            checkinCode: code,
            checkinEnabled: true
        });
        await addAuditLog('GENERATE_CHECKIN', req.session.user.id, `Generated check-in code for event`, req.params.id);
        // Event already running -> check-in invitations by DM right away (B-07); before the start the scheduler sends them
        sendCheckinInvitations(req.params.id).catch(err => console.error('Check-in invitations error:', err.message));
        res.json({ code });
    } catch (err) {
        console.error('Generate checkin error:', err);
        res.status(500).json({ error: 'Fehler beim Generieren' });
    }
});

/**
 * GET /api/admin/events/:id/checkin-stats — Get check-in statistics
 */
router.get('/events/:id/checkin-stats', async (req, res) => {
    try {
        const regQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('status', '==', 'accepted')
        );
        const regs = await getDocs(regQ);
        // Persons: the members and their listed guests (#110)
        const people = toParticipations(regs.docs.map(d => ({ id: d.id, ...d.data() })));
        const total = people.length;
        const checkedIn = people.filter(person => person.checkedIn === true).length;

        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const checkinCode = eventSnap.exists() ? eventSnap.data().checkinCode || '' : '';

        res.json({ total, checkedIn, code: checkinCode });
    } catch (err) {
        console.error('Checkin stats error:', err);
        res.status(500).json({ error: 'Fehler' });
    }
});

/**
 * GET /api/admin/events/:id/registrations — Get registrations for an event (paginated)
 */
router.get('/events/:id/registrations', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;

        const q = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);

        const allRegs = [];
        snapshot.forEach(docSnap => {
            allRegs.push({ id: docSnap.id, ...docSnap.data() });
        });
        // Place on the waitlist (W-05), counted over all registrations before paging
        const positions = waitlistPositions(allRegs);
        for (const registration of allRegs) {
            if (positions.has(registration.id)) registration.waitlistPosition = positions.get(registration.id);
        }

        // Pagination
        const total = allRegs.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const paginatedRegs = allRegs.slice(startIndex, startIndex + limit);

        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const slots = eventSnap.exists() ? getSlots(eventSnap.data()) : [];
        // The dialog offers the member entry (W-06) only for active and archived events
        const eventStatus = eventSnap.exists() ? eventSnap.data().status || 'active' : null;

        res.json({
            data: paginatedRegs,
            meta: { total, page, limit, totalPages },
            slots,
            eventStatus
        });
    } catch (err) {
        console.error('Get registrations error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Anmeldungen' });
    }
});

/**
 * GET /api/admin/events/:id/member-search?q= — Search members of the Discord server for a manual entry (W-06).
 * Each hit says whether the member is already on this event's list.
 */
router.get('/events/:id/member-search', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) {
            return res.json([]);
        }
        const [members, registrations] = await Promise.all([
            searchGuildMembers(q, 10),
            loadEventRegistrations(req.params.id)
        ]);
        res.json(members.map(member => ({ ...member, alreadyRegistered: isOnRegistrationList(registrations, member.id) })));
    } catch (err) {
        console.error('Member search error:', err);
        res.status(500).json({ error: 'Fehler bei der Mitgliedersuche' });
    }
});

/**
 * POST /api/admin/events/:id/registrations/bulk — Accept, waitlist or reject
 * several registrations of one event (W-08). Body `{ ids, action }`.
 * Accept never overbooks: what does not fit goes on the waitlist (`full`).
 */
router.post('/events/:id/registrations/bulk', async (req, res) => {
    try {
        const { action, ids } = req.body;
        if (!Object.hasOwn(BULK_ACTIONS, action)) {
            return res.status(400).json({ error: 'Ungültige Sammelaktion.' });
        }
        const uniqueIds = Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string' && id))] : [];
        if (uniqueIds.length === 0 || uniqueIds.length > MAX_BULK_IDS || uniqueIds.length !== new Set(ids).size) {
            return res.status(400).json({ error: `Bitte 1 bis ${MAX_BULK_IDS} Anmeldungen auswählen.` });
        }
        const eventId = req.params.id;
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists()) {
            return res.status(404).json({ error: 'Event nicht gefunden' });
        }

        // Plan on the fresh state and write everything under the event lock
        const { plan, event, registrationsById } = await withEventLock(eventId, async () => {
            const lockedEvent = (await getDoc(doc(db, 'events', eventId))).data();
            const registrations = await loadEventRegistrations(eventId);
            const result = planBulkAction({ action, ids: uniqueIds, registrations, event: lockedEvent });
            if (result.changes.length > 0) {
                const batch = writeBatch(db);
                for (const change of result.changes) {
                    const update = { status: change.to };
                    if (change.slotId !== undefined) update.slotId = change.slotId;
                    // A decision ends a waitlist offer (B-15)
                    if (change.from === 'offered') update.offer = null;
                    // Leaving the bench counts as registered now, for the waitlist order (B-17)
                    if (change.from === 'tentative') update.createdAt = new Date().toISOString();
                    if (change.clearCheckin) Object.assign(update, clearedCheckins(registrations.find(reg => reg.id === change.id)));
                    batch.update(doc(db, 'registrations', change.id), update);
                }
                await batch.commit();
            }
            return { plan: result, event: lockedEvent, registrationsById: new Map(registrations.map(reg => [reg.id, reg])) };
        });

        // Tell every member whose status changed, one after another (never throws)
        for (const change of plan.changes) {
            await notifyStatusChange({
                registration: registrationsById.get(change.id), eventId, event, status: change.to,
                slotId: change.slotId === undefined ? registrationsById.get(change.id).slotId : change.slotId
            });
        }
        // Requests in the approval channel show the decision (B-06)
        for (const change of plan.changes) {
            await closePendingRequests([registrationsById.get(change.id)], { status: change.to, actorName: actorName(req.session.user) }, event);
        }
        const counts = { accepted: 0, waitlisted: 0, rejected: 0 };
        plan.changes.forEach(change => { counts[change.to] += 1; });
        if (counts.rejected > 0) await promoteFromWaitlist(eventId, event);
        if (plan.changes.length > 0) notifyRegistrationsChanged(eventId);

        const summary = [
            `${counts.accepted} angenommen`, `${counts.waitlisted} Warteliste`, `${counts.rejected} abgelehnt`,
            `${plan.full.length} ohne freien Platz`, `${plan.skipped.length} übersprungen`
        ].join(', ');
        await addAuditLog('BULK_UPDATE_REGISTRATIONS', req.session.user.id, `${action}: ${summary}`, eventId);

        res.json({
            ...counts,
            full: plan.full.length,
            skipped: plan.skipped.length,
            results: plan.changes.map(change => ({
                id: change.id, status: change.to,
                slotId: change.slotId === undefined ? (registrationsById.get(change.id).slotId || null) : change.slotId
            }))
        });
    } catch (err) {
        console.error('Bulk registration action error:', err);
        res.status(500).json({ error: 'Fehler bei der Sammelaktion' });
    }
});

/**
 * POST /api/admin/events/:id/registrations — Admin puts a server member on the list (W-06).
 * Body `{ userId, slotId? }`; accepted at once with source "admin", see addRegistrationByAdmin.
 */
router.post('/events/:id/registrations', async (req, res) => {
    try {
        const { userId, slotId } = req.body;
        if (typeof userId !== 'string' || !/^\d+$/.test(userId)) {
            return res.status(400).json({ error: 'Bitte wähle ein Mitglied aus.' });
        }
        const member = await fetchGuildMember(userId);
        if (member === false) {
            return res.status(404).json({ error: 'Mitglied nicht gefunden.' });
        }
        if (!member) {
            return res.status(503).json({ error: 'Discord ist gerade nicht erreichbar. Bitte versuche es später erneut.' });
        }

        const result = await addRegistrationByAdmin({
            eventId: req.params.id,
            member,
            slotId: typeof slotId === 'string' ? slotId : null
        });
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        await addAuditLog('ADD_REGISTRATION', req.session.user.id, `Added ${member.displayName} to the event`, req.params.id);
        const { ok, ...body } = result;
        res.status(201).json(body);
    } catch (err) {
        console.error('Admin add registration error:', err);
        res.status(500).json({ error: 'Fehler beim Eintragen' });
    }
});

/**
 * GET /api/admin/events/:id/registrations/export — Export registrations as CSV
 */
router.get('/events/:id/registrations/export', async (req, res) => {
    try {
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const event = eventSnap.exists() ? eventSnap.data() : {};
        const eventTitle = event.title || 'Event';
        const slots = getSlots(event);
        const slotLabel = (slotId) => formatSlotLabel(findSlot(slots, slotId));

        const q = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);

        const registrations = [];
        const allFormKeys = new Set();
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            registrations.push(data);
            if (data.formAnswers) {
                Object.keys(data.formAnswers).forEach(k => allFormKeys.add(k));
            }
        });

        const formKeysArr = [...allFormKeys];

        // Build CSV
        const slotHeaders = slots.length > 0 ? ['Slot', 'Wunschrolle'] : [];
        const headers = ['User', 'UserID', 'Status', 'Eingecheckt', 'Quelle', 'Datum', 'Gäste (Anzahl)', 'Gäste IDs', 'Gäste eingecheckt', ...slotHeaders, ...formKeysArr].map(csvCell);
        const rows = registrations.map(r => {
            const guestCount = Array.isArray(r.guests) ? r.guests.length : 0;
            const guestIds = Array.isArray(r.guests) ? r.guests.join('; ') : '';
            const guestsCheckedIn = (r.guests || []).filter(guest => guestCheckinOf(r, guest).checkedIn).length;
            const base = [
                r.userName || '',
                r.userId,
                r.status,
                r.checkedIn ? 'Ja' : 'Nein',
                ({ discord: 'Discord', admin: 'Admin' })[r.source] || 'Website',
                r.createdAt ? new Date(r.createdAt).toLocaleDateString('de-DE') : '',
                guestCount,
                guestIds,
                guestsCheckedIn
            ];
            const formVals = formKeysArr.map(k => (r.formAnswers ? r.formAnswers[k] : '') || '');
            const slotValues = slots.length > 0 ? [slotLabel(r.slotId), slotLabel(r.preferredSlotId)] : [];
            // csvCell quotes every cell and defuses formulas (=, +, -, @) for Excel/LibreOffice
            return [...base, ...slotValues, ...formVals].map(csvCell).join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${eventTitle.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_')}_registrations.csv"`);
        res.send('\uFEFF' + csv); // BOM for Excel UTF-8

        await addAuditLog('EXPORT_REGISTRATIONS', req.session.user.id, `Exported registrations for event ${req.params.id}`, req.params.id);
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Fehler beim Exportieren' });
    }
});

/**
 * PUT /api/admin/registrations/:id/status — Accept/Reject/Waitlist a registration
 */
router.put('/registrations/:id/status', validateRegStatus, async (req, res) => {
    try {
        const result = await changeRegistrationStatus({
            registrationId: req.params.id,
            status: req.body.status,
            actor: req.session.user
        });
        if (!result.ok) {
            return res.status(404).json({ error: result.error });
        }
        const { status, slotId, warning } = result;
        res.json({ id: req.params.id, status, slotId, ...(warning ? { warning } : {}) });
    } catch (err) {
        console.error('Update registration status error:', err);
        res.status(500).json({ error: 'Fehler beim Aktualisieren des Status' });
    }
});

/**
 * PUT /api/admin/registrations/:id/checkin — Admin sets or clears the check-in of an accepted registration.
 * Body `{ checkedIn: boolean }`; works at any time and without a check-in code.
 */
router.put('/registrations/:id/checkin', async (req, res) => {
    try {
        const { checkedIn, guestId } = req.body;
        if (typeof checkedIn !== 'boolean') {
            return res.status(400).json({ error: 'Bitte gib an, ob eingecheckt werden soll.' });
        }
        const regRef = doc(db, 'registrations', req.params.id);
        const regSnap = await getDoc(regRef);
        if (!regSnap.exists()) {
            return res.status(404).json({ error: 'Anmeldung nicht gefunden' });
        }
        const reg = regSnap.data();
        if (reg.status !== 'accepted') {
            return res.status(400).json({ error: 'Nur angenommene Anmeldungen können eingecheckt werden.' });
        }

        // A guest of the registration (#110): written under the event lock, like the guest's own check-in
        if (guestId !== undefined) {
            if (typeof guestId !== 'string' || !isListedGuest(reg, guestId)) {
                return res.status(400).json({ error: 'Dieser Gast gehört nicht zu der Anmeldung.' });
            }
            // Checked again under the lock: the registration may have left „accepted“ meanwhile
            const result = await setGuestCheckin({ registrationId: req.params.id, guestId, checkedIn });
            if (!result) {
                return res.status(400).json({ error: 'Nur angenommene Anmeldungen können eingecheckt werden.' });
            }
            const guestName = toParticipations([{ id: req.params.id, ...reg }]).find(person => person.userId === guestId).userName;
            await addAuditLog(
                checkedIn ? 'CHECKIN_REGISTRATION' : 'UNDO_CHECKIN_REGISTRATION',
                req.session.user.id,
                checkedIn ? `Checked in guest ${guestName} of ${reg.userName}` : `Took back check-in of guest ${guestName} of ${reg.userName}`,
                req.params.id
            );
            return res.json({ id: req.params.id, guestId, checkedIn, checkedInAt: result.checkedInAt });
        }

        // A repeated check-in keeps the original time
        const checkedInAt = checkedIn ? (reg.checkedIn && reg.checkedInAt) || new Date().toISOString() : null;
        await updateDoc(regRef, { checkedIn, checkedInAt });

        await addAuditLog(
            checkedIn ? 'CHECKIN_REGISTRATION' : 'UNDO_CHECKIN_REGISTRATION',
            req.session.user.id,
            checkedIn ? `Checked in ${reg.userName}` : `Took back check-in of ${reg.userName}`,
            req.params.id
        );
        res.json({ id: req.params.id, checkedIn, checkedInAt });
    } catch (err) {
        console.error('Admin check-in error:', err);
        res.status(500).json({ error: 'Fehler beim Speichern des Check-ins' });
    }
});

/**
 * PUT /api/admin/registrations/:id/slot — Move a registration into another slot
 */
router.put('/registrations/:id/slot', async (req, res) => {
    try {
        const result = await moveRegistrationToSlot({
            registrationId: req.params.id,
            slotId: typeof req.body.slotId === 'string' ? req.body.slotId : ''
        });
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        await addAuditLog('MOVE_REGISTRATION_SLOT', req.session.user.id, `Moved ${result.userName} to slot "${result.slotName}"`, req.params.id);
        res.json({ id: req.params.id, slotId: result.slotId, ...(result.warning ? { warning: result.warning } : {}) });
    } catch (err) {
        console.error('Move registration slot error:', err);
        res.status(500).json({ error: 'Fehler beim Verschieben' });
    }
});

/**
 * GET /api/admin/events/:id/message-recipients — How many people each group of the
 * participant message reaches (W-09). Numbers only.
 */
router.get('/events/:id/message-recipients', async (req, res) => {
    try {
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        if (!eventSnap.exists()) return res.status(404).json({ error: 'Event nicht gefunden' });
        res.json(recipientCounts(await loadEventRegistrations(req.params.id)));
    } catch (err) {
        console.error('Message recipients error:', err);
        res.status(500).json({ error: 'Fehler beim Zählen der Empfänger' });
    }
});

/**
 * POST /api/admin/events/:id/message — DM of the team to the participants (W-09).
 * Body `{ text, group }` (group "accepted" | "all"); DM choices (W-16) do not apply.
 * Answers `{ recipients, delivered }`.
 */
router.post('/events/:id/message', async (req, res) => {
    try {
        const { group } = req.body;
        if (typeof group !== 'string' || !Object.hasOwn(MESSAGE_GROUPS, group)) {
            return res.status(400).json({ error: 'Ungültige Empfängerauswahl.' });
        }
        const checked = validateMessageText(req.body.text);
        if (checked.error) return res.status(400).json({ error: checked.error });

        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        if (!eventSnap.exists()) return res.status(404).json({ error: 'Event nicht gefunden' });
        const registrations = await loadEventRegistrations(req.params.id);
        if (messageRecipients(registrations, group).length === 0) {
            return res.status(400).json({ error: 'Niemand in dieser Auswahl.' });
        }

        const admin = req.session.user;
        const result = await sendParticipantMessage({
            registrations,
            group,
            title: eventSnap.data().title || '',
            text: checked.text,
            sender: admin.displayName || admin.username || 'Admin',
            url: buildEventUrl(req.params.id),
            send: sendDM
        });
        const groupLabel = group === 'all' ? 'Alle Anmeldungen' : 'Nur Angenommene';
        await addAuditLog(
            'MESSAGE_PARTICIPANTS',
            admin.id,
            `${groupLabel}: ${result.delivered}/${result.recipients} zugestellt – „${checked.text.slice(0, 100)}“`,
            req.params.id
        );
        res.json(result);
    } catch (err) {
        console.error('Participant message error:', err);
        res.status(500).json({ error: 'Fehler beim Senden der Nachricht' });
    }
});

/**
 * POST /api/admin/events/:id/announce — Announce event to Discord channel
 */
router.post('/events/:id/announce', async (req, res) => {
    try {
        const { text, roleIds, pingEveryone } = req.body;
        const result = await announceEvent(req.params.id, req.session.user.id, { pings: { text, roleIds, pingEveryone } });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        res.json({ success: true, message: 'Event im Discord-Channel angekündigt!' });
    } catch (err) {
        console.error('Announce error:', err);
        res.status(500).json({ error: 'Fehler beim Ankündigen' });
    }
});

/**
 * POST /api/admin/events/:id/sync-discord — Create native Discord Scheduled Event
 */
router.post('/events/:id/sync-discord', async (req, res) => {
    try {
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        if (!eventSnap.exists()) {
            return res.status(404).json({ error: 'Event nicht gefunden' });
        }

        const event = eventSnap.data();

        if (event.discordScheduledEventId) {
            return res.status(400).json({ error: 'Dieses Event wurde bereits mit Discord synchronisiert.' });
        }

        const scheduledEventId = await createScheduledEvent({ id: req.params.id, ...event });

        if (scheduledEventId) {
            await updateDoc(doc(db, 'events', req.params.id), {
                discordScheduledEventId: scheduledEventId,
                discordScheduledEventStatus: 'scheduled',
                updatedAt: new Date().toISOString()
            });
            await addAuditLog('SYNC_DISCORD_EVENT', req.session.user.id, `Synced event "${event.title}" to Discord`, req.params.id);
            res.json({ success: true, discordScheduledEventId: scheduledEventId });
        } else {
            res.status(500).json({ error: 'Konnte das Scheduled Event in Discord nicht erstellen. Bitte Berechtigungen prüfen.' });
        }
    } catch (err) {
        console.error('Sync discord event error:', err);
        res.status(500).json({ error: 'Fehler beim Synchronisieren' });
    }
});

// ═══════════════════════════════════════════════
// DATE POLLS
// ═══════════════════════════════════════════════

/**
 * POST /api/admin/polls — Create a date poll
 */
router.post('/polls', async (req, res) => {
    try {
        const result = await createPoll(req.body, req.session.user.id);
        if (!result.ok) {
            return res.status(400).json({ error: result.error });
        }
        res.json(result.poll);
    } catch (err) {
        console.error('Create poll error:', err);
        res.status(500).json({ error: 'Fehler beim Erstellen der Abstimmung' });
    }
});

/**
 * PUT /api/admin/polls/:id — Edit an open date poll
 */
router.put('/polls/:id', async (req, res) => {
    try {
        const result = await updatePoll(req.params.id, req.body);
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        await addAuditLog('UPDATE_POLL', req.session.user.id, `Updated poll "${result.poll.title}"`, req.params.id);
        res.json(result.poll);
    } catch (err) {
        console.error('Update poll error:', err);
        res.status(500).json({ error: 'Fehler beim Speichern der Abstimmung' });
    }
});

/**
 * POST /api/admin/polls/:id/close — Close a date poll
 */
router.post('/polls/:id/close', async (req, res) => {
    try {
        const result = await closePoll(req.params.id);
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        await addAuditLog('CLOSE_POLL', req.session.user.id, `Closed poll "${result.poll.title}"`, req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Close poll error:', err);
        res.status(500).json({ error: 'Fehler beim Beenden der Abstimmung' });
    }
});

/**
 * POST /api/admin/polls/:id/announce — Post a date poll to the announcement channel
 */
router.post('/polls/:id/announce', async (req, res) => {
    try {
        const { text, roleIds, pingEveryone } = req.body;
        const result = await announcePoll(req.params.id, req.session.user.id, { pings: { text, roleIds, pingEveryone } });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        res.json({ success: true, message: 'Abstimmung im Discord-Channel gepostet!' });
    } catch (err) {
        console.error('Announce poll error:', err);
        res.status(500).json({ error: 'Fehler beim Posten der Abstimmung' });
    }
});

/**
 * DELETE /api/admin/polls/:id — Delete a date poll with its votes
 */
router.delete('/polls/:id', async (req, res) => {
    try {
        const poll = await loadPoll(req.params.id);
        const result = await deletePoll(req.params.id);
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        await addAuditLog('DELETE_POLL', req.session.user.id, `Deleted poll "${poll ? poll.title : req.params.id}"`, req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete poll error:', err);
        res.status(500).json({ error: 'Fehler beim Löschen der Abstimmung' });
    }
});

/**
 * GET /api/admin/bot-messages — Get message templates
 */
router.get('/bot-messages', async (req, res) => {
    try {
        const docSnap = await getDoc(doc(db, 'botMessages', 'templates'));
        if (!docSnap.exists()) {
            // Return defaults
            return res.json({
                registration: '📋 Deine Anfrage für **{event.title}** ist eingegangen. Bitte warte auf die Bestätigung.',
                accepted: '✅ Du wurdest für **{event.title}** angenommen! Willkommen dabei!',
                rejected: '❌ Leider wurde deine Anfrage für **{event.title}** abgelehnt.'
            });
        }
        res.json(docSnap.data());
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Laden der Nachrichten' });
    }
});

/**
 * PUT /api/admin/bot-messages — Update message templates
 */
router.put('/bot-messages', validateBotMessages, async (req, res) => {
    try {
        const { registration, accepted, rejected } = req.body;
        await setDoc(doc(db, 'botMessages', 'templates'), {
            registration: registration || '',
            accepted: accepted || '',
            rejected: rejected || ''
        });
        await addAuditLog('UPDATE_TEMPLATES', req.session.user.id, 'Updated bot message templates');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Speichern' });
    }
});

/**
 * GET /api/admin/members — Every stored member with participation numbers (W-15).
 * Read-only; numbers and rules in utils/memberOverview.js.
 */
router.get('/members', async (req, res) => {
    try {
        const [userSnap, regSnap, eventSnap] = await Promise.all([
            getDocs(collection(db, 'users')),
            getDocs(collection(db, 'registrations')),
            getDocs(collection(db, 'events'))
        ]);
        const users = userSnap.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id }));
        const registrations = regSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        const eventsById = new Map(eventSnap.docs.map(docSnap => [docSnap.id, docSnap.data()]));
        res.json({ members: buildMemberList(users, registrations, eventsById, new Date()) });
    } catch (err) {
        console.error('Member list error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Mitglieder' });
    }
});

/**
 * GET /api/admin/insights?range=30|90|365|all — Evaluations of past events (W-14).
 * Read-only; rules in utils/insights.js. Default range 90 days.
 */
router.get('/insights', async (req, res) => {
    try {
        const range = req.query.range === undefined ? DEFAULT_RANGE : req.query.range;
        if (!isValidRange(range)) {
            return res.status(400).json({ error: 'Ungültiger Zeitraum.' });
        }
        const [userSnap, regSnap, eventSnap] = await Promise.all([
            getDocs(collection(db, 'users')),
            getDocs(collection(db, 'registrations')),
            getDocs(collection(db, 'events'))
        ]);
        const users = userSnap.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id }));
        const registrations = regSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        const eventsById = new Map(eventSnap.docs.map(docSnap => [docSnap.id, docSnap.data()]));
        res.json(buildInsights({ users, registrations, eventsById, range, now: new Date() }));
    } catch (err) {
        console.error('Insights error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Auswertungen' });
    }
});

/**
 * GET /api/admin/members/:id — One member: account info, numbers and complete history (W-15).
 */
router.get('/members/:id', async (req, res) => {
    try {
        const userSnap = await getDoc(doc(db, 'users', req.params.id));
        if (!userSnap.exists()) {
            return res.status(404).json({ error: 'Mitglied nicht gefunden.' });
        }
        const user = { ...userSnap.data(), id: userSnap.id };
        // Own registrations and guest places (#110)
        const registrations = await loadUserParticipations(user.id);

        // Events of the history, and their registrations to know whether attendance was tracked
        const eventsById = new Map();
        const eventRegistrations = [];
        for (const eventId of new Set(registrations.map(registration => registration.eventId).filter(Boolean))) {
            const eventSnap = await getDoc(doc(db, 'events', eventId));
            if (!eventSnap.exists()) continue;
            eventsById.set(eventId, eventSnap.data());
            eventRegistrations.push(...await loadEventRegistrations(eventId));
        }
        const tracked = trackedEventIds(eventsById, eventRegistrations);
        const now = new Date();

        res.json({
            member: {
                ...memberBase(user, registrations.filter(registration => !registration.asGuest)),
                acceptInvitations: user.acceptInvitations !== false,
                notifications: normalizeNotificationPrefs(user.notifications)
            },
            stats: memberStats(registrations, eventsById, tracked, now),
            history: buildMemberHistory(registrations, eventsById, tracked, now)
        });
    } catch (err) {
        console.error('Member detail error:', err);
        res.status(500).json({ error: 'Fehler beim Laden des Mitglieds' });
    }
});

/**
 * GET /api/admin/audit-log — Get audit logs (paginated)
 */
router.get('/audit-log', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;

        const q = query(collection(db, 'auditLogs'));
        const snapshot = await getDocs(q);

        const logs = [];
        snapshot.forEach(d => logs.push({ id: d.id, ...d.data() }));
        // Sort by timestamp descending in memory (convention: no composite indexes)
        logs.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

        // Pagination
        const total = logs.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const paginatedLogs = logs.slice(startIndex, startIndex + limit);

        res.json({
            data: paginatedLogs,
            meta: { total, page, limit, totalPages }
        });
    } catch (err) {
        console.error('Audit log error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Logs' });
    }
});

/**
 * DELETE /api/admin/reset — Full System Reset
 * Body: { password, targets: ['events', 'users', 'registrations', 'comments', 'auditLogs'] }
 */
router.delete('/reset', async (req, res) => {
    try {
        const { password, targets } = req.body;

        // 1. Verify Password
        if (!safeEqual(password, process.env.ADMIN_RESET_PASSWORD)) {
            return res.status(401).json({ error: 'Ungültiges Admin-Reset-Passwort.' });
        }

        if (!targets || !Array.isArray(targets) || targets.length === 0) {
            return res.status(400).json({ error: 'Keine Ziele zum Löschen ausgewählt.' });
        }

        let totalDeleted = 0;
        const collections = {
            events: 'events',
            users: 'users',
            registrations: 'registrations',
            comments: 'comments',
            auditLogs: 'auditLogs',
            polls: 'polls',
            pollVotes: 'pollVotes'
        };

        for (const target of targets) {
            const colName = collections[target];
            if (!colName) continue;

            const snapshot = await getDocs(collection(db, colName));
            if (snapshot.empty) continue;
            const wipedBanners = colName === 'events' ? snapshot.docs.map(docSnap => docSnap.data().bannerUrl) : [];

            // Delete in batches of 500
            const docs = snapshot.docs;
            const batchSize = 500;
            for (let i = 0; i < docs.length; i += batchSize) {
                const batch = writeBatch(db);
                const chunk = docs.slice(i, i + batchSize);
                chunk.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                totalDeleted += chunk.length;
            }
            console.log(`🧹 Wiped collection: ${colName}`);
            await releaseBanners(wipedBanners);
        }

        console.log(`⚠️ SYSTEM RESET by ${req.session.user.id}: Deleted ${totalDeleted} documents.`);

        // Deleted users must not keep a working login: end every session except the
        // admins' (like panic mode), so the admin who ran the reset stays signed in
        if (targets.includes('users')) {
            const ended = await sharedSessionStore().destroyAll({ keepAdmins: true });
            console.log(`🔒 ${ended} Sessions nach dem Löschen der Nutzer beendet.`);
        }

        res.json({ success: true, count: totalDeleted });

    } catch (err) {
        console.error('System reset error:', err);
        res.status(500).json({ error: 'System-Reset fehlgeschlagen.' });
    }
});

// ═══════════════════════════════════════════════════════════
// BOT CONTROL CENTER (Bot-Zentrale)
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/admin/bot/status — Get bot status and runtime info
 */
router.get('/bot/status', async (req, res) => {
    try {
        const status = getBotStatus();
        res.json(status);
    } catch (err) {
        console.error('Bot status error:', err);
        res.status(500).json({ error: 'Fehler beim Laden des Bot-Status' });
    }
});

/**
 * GET /api/admin/bot/settings — Get bot settings
 */
router.get('/bot/settings', async (req, res) => {
    try {
        const settings = await getBotSettings();
        // The channel announcements use without an own event channel, also the .env one (B-11)
        res.json({ ...settings, defaultAnnounceChannel: announceChannelId(settings) });
    } catch (err) {
        console.error('Bot settings error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Bot-Einstellungen' });
    }
});

/**
 * PUT /api/admin/bot/settings — Update bot settings
 */
router.put('/bot/settings', async (req, res) => {
    try {
        const {
            statusType, activityType, activityText,
            dmNotifications, reminderEnabled, eventStartNotifications,
            autoChannelCreation, announcementThreads, autoUpdatePresence, autoStatusCalendarEvents,
            announceChannel, approvalChannel, welcomeMessage, waitlistConfirmation, waitlistConfirmHours
        } = req.body;

        // Confirmation period of waitlist offers in whole hours (B-15); left out = default
        const hasHours = waitlistConfirmHours !== undefined && waitlistConfirmHours !== null && waitlistConfirmHours !== '';
        if (hasHours && !isValidConfirmHours(Number(waitlistConfirmHours))) {
            return res.status(400).json({ error: 'Die Bestätigungsfrist muss zwischen 1 und 72 Stunden liegen.' });
        }

        const settings = {
            statusType: statusType || 'online',
            activityType: activityType || 'WATCHING',
            activityText: activityText || '',
            dmNotifications: dmNotifications !== false,
            reminderEnabled: reminderEnabled !== false,
            eventStartNotifications: eventStartNotifications !== false,
            autoChannelCreation: autoChannelCreation !== false,
            announcementThreads: announcementThreads !== false,
            autoUpdatePresence: !!autoUpdatePresence,
            autoStatusCalendarEvents: !!autoStatusCalendarEvents,
            announceChannel: announceChannel || '',
            approvalChannel: approvalChannel || '',
            welcomeMessage: welcomeMessage || '',
            waitlistConfirmation: waitlistConfirmation !== false,
            waitlistConfirmHours: hasHours ? Number(waitlistConfirmHours) : 12,
        };

        // Only text channels of the server; while the list cannot be read, only the stored value or none (B-02)
        const stored = await getBotSettings();
        const changedChannels = [
            ['announceChannel', 'Ankündigungskanal nicht gefunden.'],
            ['approvalChannel', 'Freigabe-Kanal nicht gefunden.']
        ].filter(([key]) => settings[key] && settings[key] !== stored[key]);
        if (changedChannels.length > 0) {
            const guildId = process.env.DISCORD_GUILD_ID;
            const channels = guildId ? await getGuildChannels(guildId) : [];
            for (const [key, error] of changedChannels) {
                if (!channels.some(channel => channel.id === settings[key] && channel.type === 'text')) {
                    return res.status(400).json({ error });
                }
            }
        }

        const success = await saveBotSettings(settings);
        if (success) {
            await addAuditLog('UPDATE_BOT_SETTINGS', req.session.user.id, 'Bot-Zentrale Einstellungen aktualisiert');
            res.json({ success: true, settings });
        } else {
            res.status(500).json({ error: 'Fehler beim Speichern' });
        }
    } catch (err) {
        console.error('Update bot settings error:', err);
        res.status(500).json({ error: 'Fehler beim Speichern der Einstellungen' });
    }
});

/**
 * GET /api/admin/bot/running-events — Get currently active events with live stats
 */
router.get('/bot/running-events', async (req, res) => {
    try {
        const events = await getRunningEvents();
        res.json(events);
    } catch (err) {
        console.error('Running events error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der laufenden Events' });
    }
});

// ═══════════════════════════════════════════════════════════
// MAINTENANCE MODE (Wartungsmodus)
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/admin/maintenance — Get current maintenance settings
 */
router.get('/maintenance', async (req, res) => {
    try {
        const snap = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        const defaults = {
            warningEnabled: false,
            warningText: '',
            loginDisabled: false,
            registrationDisabled: false,
            plannedMaintenance: false,
            plannedMaintenanceStart: '',
            plannedMaintenanceEnd: '',
            plannedMaintenanceText: '',
            panicMode: false,
            panicActivatedAt: '',
            panicActivatedBy: ''
        };
        res.json(snap.exists() ? { ...defaults, ...snap.data() } : defaults);
    } catch (err) {
        console.error('Maintenance settings error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Wartungseinstellungen.' });
    }
});

/**
 * PUT /api/admin/maintenance — Update maintenance settings
 */
router.put('/maintenance', async (req, res) => {
    try {
        const {
            warningEnabled, warningText,
            loginDisabled, registrationDisabled,
            plannedMaintenance, plannedMaintenanceStart,
            plannedMaintenanceEnd, plannedMaintenanceText
        } = req.body;

        const settings = {
            warningEnabled: !!warningEnabled,
            warningText: (warningText || '').substring(0, 500),
            loginDisabled: !!loginDisabled,
            registrationDisabled: !!registrationDisabled,
            plannedMaintenance: !!plannedMaintenance,
            plannedMaintenanceStart: plannedMaintenanceStart || '',
            plannedMaintenanceEnd: plannedMaintenanceEnd || '',
            plannedMaintenanceText: (plannedMaintenanceText || '').substring(0, 500),
            updatedAt: new Date().toISOString(),
            updatedBy: req.session.user.id
        };

        // Preserve panic mode state (can't be changed via this endpoint)
        const existing = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        if (existing.exists()) {
            const data = existing.data();
            settings.panicMode = !!data.panicMode;
            settings.panicActivatedAt = data.panicActivatedAt || '';
            settings.panicActivatedBy = data.panicActivatedBy || '';
        } else {
            settings.panicMode = false;
            settings.panicActivatedAt = '';
            settings.panicActivatedBy = '';
        }

        await setDoc(doc(db, 'maintenanceSettings', 'config'), settings);
        await addAuditLog('UPDATE_MAINTENANCE', req.session.user.id, 'Wartungseinstellungen aktualisiert');
        res.json({ success: true, settings });
    } catch (err) {
        console.error('Update maintenance error:', err);
        res.status(500).json({ error: 'Fehler beim Speichern der Wartungseinstellungen.' });
    }
});

/**
 * POST /api/admin/maintenance/panic — Activate Panic Mode (no password required)
 * Complete lockdown: only admin reset password holder can deactivate
 */
router.post('/maintenance/panic', async (req, res) => {
    try {
        const existing = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        const data = existing.exists() ? existing.data() : {};

        await setDoc(doc(db, 'maintenanceSettings', 'config'), {
            ...data,
            panicMode: true,
            panicActivatedAt: new Date().toISOString(),
            panicActivatedBy: req.session.user.id,
            warningEnabled: true,
            warningText: data.warningText || 'NOTFALL-WARTUNG: System ist gesperrt.',
            loginDisabled: true,
            registrationDisabled: true,
            updatedAt: new Date().toISOString(),
            updatedBy: req.session.user.id
        });

        // A lockdown that only covers new logins is no lockdown: end every
        // non-admin session (the admin's own session survives, so the mode can
        // be deactivated). Logins during the lockdown are blocked anyway.
        const ended = await sharedSessionStore().destroyAll({ keepAdmins: true });
        console.log(`🚪 ${ended} Nicht-Admin-Sitzungen durch den Panic Mode beendet.`);

        await addAuditLog('PANIC_MODE_ACTIVATED', req.session.user.id, 'Panic Mode aktiviert — Kompletter Lockdown');
        console.log(`🚨 PANIC MODE activated by ${req.session.user.id}`);
        res.json({ success: true });
    } catch (err) {
        console.error('Panic mode activation error:', err);
        res.status(500).json({ error: 'Panic Mode konnte nicht aktiviert werden.' });
    }
});

/**
 * POST /api/admin/maintenance/panic/deactivate — Deactivate Panic Mode
 * Requires the ADMIN_RESET_PASSWORD
 */
router.post('/maintenance/panic/deactivate', async (req, res) => {
    try {
        const { password } = req.body;
        if (!safeEqual(password, process.env.ADMIN_RESET_PASSWORD)) {
            return res.status(401).json({ error: 'Ungültiges Admin-Reset-Passwort.' });
        }

        const existing = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        const data = existing.exists() ? existing.data() : {};

        await setDoc(doc(db, 'maintenanceSettings', 'config'), {
            ...data,
            panicMode: false,
            panicActivatedAt: '',
            panicActivatedBy: '',
            warningEnabled: false,
            warningText: '',
            loginDisabled: false,
            registrationDisabled: false,
            updatedAt: new Date().toISOString(),
            updatedBy: req.session.user.id
        });

        await addAuditLog('PANIC_MODE_DEACTIVATED', req.session.user.id, 'Panic Mode deaktiviert');
        console.log(`✅ PANIC MODE deactivated by ${req.session.user.id}`);
        res.json({ success: true });
    } catch (err) {
        console.error('Panic mode deactivation error:', err);
        res.status(500).json({ error: 'Panic Mode konnte nicht deaktiviert werden.' });
    }
});

module.exports = router;
