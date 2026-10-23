const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const {
    db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, writeBatch
} = require('../firebaseAdmin');
const { requireAuth, requireAdmin, safeEqual } = require('../middleware/auth');
const { csvCell } = require('../utils/csv');
const { validateEvent, validateRegStatus, validateBotMessages } = require('../middleware/validators');
const { sendDM, assignRole, parseTemplate, getGuildRoles, sendChannelMessage, buildEventEmbed, buildEventComponents, getGuildScheduledEvents, createEventChannels, deleteEventChannels, createScheduledEvent, getBotStatus, getBotSettings, saveBotSettings, getRunningEvents, getGuildChannels, buildPollEmbed, buildPollComponents, searchGuildMembers, fetchGuildMember } = require('../bot');
const { promoteFromWaitlist, addAuditLog, loadEventRoster, loadEventRegistrations, saveEventWithSlots } = require('../utils/eventUtils');
const { mergeReminderHours } = require('../utils/reminders');
const { keepDeadlineRefreshFlag } = require('../utils/eventListing');
const { describeEventChanges, notifyEventChange } = require('../utils/eventChangeNotice');
const { filterByPreference, normalizeNotificationPrefs } = require('../utils/notificationPrefs');
const { trackedEventIds, memberStats, memberBase, buildMemberList, buildMemberHistory } = require('../utils/memberOverview');
const { describePlaces, formatPlaces, formatWaitlist, waitlistPositions } = require('../utils/capacity');
const { getSlots, findSlot, formatSlotLabel, normalizeSlots, sumCapacity, resolveAcceptanceSlot, buildRoster } = require('../utils/slotService');
const { buildPreviewEvent } = require('../utils/eventPreview');
const { normalizePollInput, tallyPoll } = require('../utils/pollService');
const {
    loadPoll, loadPollVotes, updatePoll, closePoll, decidePollWithEvent, deletePoll
} = require('../utils/pollStore');
const { withEventLock } = require('../utils/eventLock');
const { moveRegistrationToSlot, buildTemplateVars, addRegistrationByAdmin, isOnRegistrationList } = require('../utils/registrationService');
const { notifyRegistrationsChanged } = require('../utils/announcementRefresh');
const { debugLog } = require('../utils/debugLog');
const { buildEventUrl } = require('../utils/eventUrl');

// Announcements per event that are kept up to date live
const MAX_TRACKED_ANNOUNCEMENTS = 5;

// All admin routes require auth + admin
router.use(requireAuth, requireAdmin);

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

        regsSnap.forEach(d => {
            const r = d.data();
            const count = 1 + (Array.isArray(r.guests) ? r.guests.length : 0);
            totalRegs += count;
            const status = r.status;
            if (status === 'pending') pendingRegs += count;
            else if (status === 'accepted') acceptedRegs += count;
            else if (status === 'rejected') rejectedRegs += count;
            else if (status === 'waitlisted') waitlistedRegs += count;
        });

        res.json({
            events: { total: totalEvents, active: activeEvents, draft: draftEvents, archived: archivedEvents },
            registrations: { total: totalRegs, pending: pendingRegs, accepted: acceptedRegs, rejected: rejectedRegs, waitlisted: waitlistedRegs }
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
 * POST /api/admin/events — Create event
 */
router.post('/events', validateEvent, async (req, res) => {
    try {
        const {
            title, description, maxParticipants, accessMode, requiredRoles,
            approvalMode, assignRoleId, formFields,
            startDate, endDate, bannerUrl, category, status, reminderHours,
            recurring, recurringInterval, recurringUntil, checkinMessage,
            customBotMessages, autoCreateChannels, channelConfig, allowGuests,
            accentColor, location, registrationDeadline, unregisterDeadline
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

        const baseEvent = {
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
            // Set by the scheduler once the announcement lost its buttons at the deadline (W-03)
            registrationClosedRefreshed: false,
            bannerUrl: bannerUrl || '',
            category: category || '',
            status: status || 'active',
            reminderHours: mergeReminderHours(reminderHours, null, startDate || ''),
            checkinMessage: checkinMessage || '',
            customBotMessages: customBotMessages || {},
            autoCreateChannels: !!autoCreateChannels,
            channelConfig: channelConfig || {},
            allowGuests: slots.length > 0 ? false : allowGuests !== false,
            slots,
            sourcePollId: fromPoll ? String(fromPoll.pollId) : '',
            accentColor: accentColor || '',
            location: location || null,
            eventStartNotificationSent: false,
            recurring: !!recurring,
            recurringInterval: recurringInterval || '',
            recurringUntil: recurringUntil || '',
            createdAt: new Date().toISOString(),
            createdBy: req.session.user.id
        };

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
                createEventChannels({ id: ref.id, ...baseEvent }).catch(console.error);
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
            embed: buildEventEmbed(event, buildEventUrl(linkId), roster).toJSON(),
            components: buildEventComponents(event, linkId, roster).map(row => row.toJSON()),
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
 * PUT /api/admin/events/:id — Update event
 */
router.put('/events/:id', validateEvent, async (req, res) => {
    try {
        const {
            title, description, maxParticipants, accessMode, requiredRoles,
            approvalMode, assignRoleId, formFields,
            startDate, endDate, bannerUrl, category, status, reminderHours, checkinMessage,
            customBotMessages, autoCreateChannels, channelConfig, allowGuests,
            accentColor, location, registrationDeadline, unregisterDeadline
        } = req.body;

        // Slots are validated and written under the event lock -> a parallel
        // registration cannot land in a slot that is being removed
        const saved = await saveEventWithSlots(req.params.id, req.body.slots, (slots, oldEvent) => ({
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
            allowGuests: slots.length > 0 ? false : allowGuests !== false,
            slots,
            sourcePollId: oldEvent.sourcePollId || '',
            accentColor: accentColor || '',
            location: location || null,
            recurring: !!req.body.recurring,
            recurringInterval: req.body.recurringInterval || '',
            recurringUntil: req.body.recurringUntil || '',
            updatedAt: new Date().toISOString()
        }));
        if (!saved.ok) {
            return res.status(400).json({ error: saved.error });
        }
        const { oldEvent, updates } = saved;
        await addAuditLog('UPDATE_EVENT', req.session.user.id, `Updated event "${title}"`, req.params.id);

        const isNowActive = updates.status === 'active';
        const wasActive = oldEvent.status === 'active';

        if (updates.autoCreateChannels && isNowActive && (!oldEvent.autoCreateChannels || !wasActive)) {
            createEventChannels({ id: req.params.id, ...updates }).catch(console.error);
        } else if ((oldEvent.autoCreateChannels && wasActive) && (!updates.autoCreateChannels || !isNowActive)) {
            deleteEventChannels(req.params.id).catch(console.error);
        }

        // More places or new slots can let waitlisted members move up
        await promoteFromWaitlist(req.params.id, { ...oldEvent, ...updates });
        notifyRegistrationsChanged(req.params.id);

        // Change DM only on the admin's explicit request (W-04); the flag itself is never stored
        let notifiedCount = 0;
        const changes = describeEventChanges(oldEvent, updates);
        if (req.body.notifyParticipants === true && updates.status === 'active' && changes.length > 0) {
            const { recipients, notified, optedOut } = await notifyEventChange({ eventId: req.params.id, title: updates.title, changes });
            notifiedCount = notified;
            if (recipients + optedOut > 0) {
                const changed = changes.map(change => change.label).join(', ');
                await addAuditLog('NOTIFY_EVENT_CHANGE', req.session.user.id,
                    `Notified ${notified} of ${recipients} participants about changed ${changed}${optedOutNote(optedOut)}`, req.params.id);
            }
        }
        res.json({ id: req.params.id, ...updates, notifiedCount });
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

        if (oldEvent.autoCreateChannels) {
            if (status === 'active' && oldEvent.status !== 'active') {
                createEventChannels({ id: req.params.id, ...oldEvent, status }).catch(console.error);
            } else if (status !== 'active' && oldEvent.status === 'active') {
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

        if (event.autoCreateChannels && event.status === 'active') {
            deleteEventChannels(eventId).catch(console.error);
        }

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

        if (data.autoCreateChannels && data.status !== 'active') {
            createEventChannels({ id: eventId, ...data, ...updates }).catch(console.error);
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

        if (data.autoCreateChannels && data.status === 'active') {
            deleteEventChannels(eventId).catch(console.error);
        }

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

        // deleteEventChannels reads the channel ids from the event -> before the event is gone
        if (event) await deleteEventChannels(req.params.id);

        await deleteDoc(doc(db, 'events', req.params.id));
        // Also delete all registrations for this event
        const regQ = query(collection(db, 'registrations'), where('eventId', '==', req.params.id));
        const regs = await getDocs(regQ);
        const deletePromises = [];
        regs.forEach(docSnap => {
            deletePromises.push(deleteDoc(doc(db, 'registrations', docSnap.id)));
        });
        await Promise.all(deletePromises);

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
        snapshot.forEach(docSnap => {
            if (docSnap.data().seriesId === seriesId) {
                eventIds.push(docSnap.id);
            }
        });

        if (!eventIds.length) {
            return res.status(404).json({ error: 'Serie nicht gefunden' });
        }

        // Delete all events and their registrations
        for (const eventId of eventIds) {
            // Channels first: deleteEventChannels reads their ids from the event
            await deleteEventChannels(eventId);
            await deleteDoc(doc(db, 'events', eventId));

            const regQ = query(collection(db, 'registrations'), where('eventId', '==', eventId));
            const regs = await getDocs(regQ);
            const deletePromises = [];
            regs.forEach(regDoc => {
                deletePromises.push(deleteDoc(doc(db, 'registrations', regDoc.id)));
            });
            await Promise.all(deletePromises);
        }

        await addAuditLog('DELETE_SERIES', req.session.user.id, `Deleted series ${seriesId} (${eventIds.length} events)`, eventIds[0]);
        res.json({ success: true, deletedCount: eventIds.length });
    } catch (err) {
        console.error('Delete series error:', err);
        res.status(500).json({ error: 'Fehler beim Löschen der Serie' });
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
        let total = 0;
        let checkedIn = 0;
        regs.forEach(d => {
            total++;
            if (d.data().checkedIn) checkedIn++;
        });

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
        const headers = ['User', 'UserID', 'Status', 'Eingecheckt', 'Quelle', 'Datum', 'Gäste (Anzahl)', 'Gäste IDs', ...slotHeaders, ...formKeysArr].map(csvCell);
        const rows = registrations.map(r => {
            const guestCount = Array.isArray(r.guests) ? r.guests.length : 0;
            const guestIds = Array.isArray(r.guests) ? r.guests.join('; ') : '';
            const base = [
                r.userName || '',
                r.userId,
                r.status,
                r.checkedIn ? 'Ja' : 'Nein',
                ({ discord: 'Discord', admin: 'Admin' })[r.source] || 'Website',
                r.createdAt ? new Date(r.createdAt).toLocaleDateString('de-DE') : '',
                guestCount,
                guestIds
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
        const { status } = req.body;
        const regSnap = await getDoc(doc(db, 'registrations', req.params.id));
        if (!regSnap.exists()) {
            return res.status(404).json({ error: 'Anmeldung nicht gefunden' });
        }

        const reg = { id: req.params.id, ...regSnap.data() };
        const eventSnap = await getDoc(doc(db, 'events', reg.eventId));
        const event = eventSnap.exists() ? eventSnap.data() : {};
        const slots = getSlots(event);

        // Status and slot change under the event lock -> no race with new registrations
        const { slotId, warning } = await withEventLock(reg.eventId, async () => {
            const update = { status };
            let overbookedWarning = null;
            // Waitlisted and rejected registrations give up their place -> a later acceptance picks a slot again
            if (slots.length > 0 && (status === 'waitlisted' || status === 'rejected')) {
                update.slotId = null;
            }
            // Only accepted registrations carry a check-in (badges count every checkedIn)
            if (status !== 'accepted' && reg.checkedIn) {
                update.checkedIn = false;
                update.checkedInAt = null;
            }
            if (slots.length > 0 && status === 'accepted' && !findSlot(slots, reg.slotId)) {
                const registrations = await loadEventRegistrations(reg.eventId);
                const choice = resolveAcceptanceSlot(slots, registrations, reg);
                update.slotId = choice.slotId;
                if (choice.overbooked) {
                    overbookedWarning = `Slot „${findSlot(slots, choice.slotId).name}“ ist jetzt überbucht.`;
                }
            }
            await updateDoc(doc(db, 'registrations', req.params.id), update);
            return { slotId: 'slotId' in update ? update.slotId : reg.slotId, warning: overbookedWarning };
        });
        debugLog('admin.updateRegStatus', { regId: req.params.id, newStatus: status });

        const templateSnap = await getDoc(doc(db, 'botMessages', 'templates'));
        const globalTemplates = templateSnap.exists() ? templateSnap.data() : {};
        const customMsgs = event.customBotMessages || {};
        const slot = findSlot(slots, slotId);
        const vars = await buildTemplateVars({
            user: { id: reg.userId, displayName: reg.userName },
            eventId: reg.eventId,
            event,
            slot
        });
        const slotLine = slot ? `\n🎯 Dein Slot: **${formatSlotLabel(slot)}**` : '';

        if (status === 'accepted') {
            const template = customMsgs.accepted || globalTemplates.accepted;
            const msg = template
                ? parseTemplate(template, vars)
                : `✅ Du wurdest für **${event.title}** angenommen! Willkommen dabei!${slotLine}`;
            await sendDM(reg.userId, msg);

            if (event.assignRoleId) {
                await assignRole(reg.userId, event.assignRoleId, process.env.DISCORD_GUILD_ID);
            }
        } else if (status === 'rejected') {
            const template = customMsgs.rejected || globalTemplates.rejected;
            const msg = template
                ? parseTemplate(template, vars)
                : `❌ Leider wurde deine Anfrage für **${event.title}** abgelehnt.`;
            await sendDM(reg.userId, msg);

            await promoteFromWaitlist(reg.eventId, event);
        }

        notifyRegistrationsChanged(reg.eventId);
        await addAuditLog('UPDATE_REGISTRATION_STATUS', req.session.user.id, `Set status to ${status} for user ${reg.userName}`, req.params.id);

        res.json({ id: req.params.id, status, slotId: slotId || null, ...(warning ? { warning } : {}) });
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
        const { checkedIn } = req.body;
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
 * POST /api/admin/events/:id/announce — Announce event to Discord channel
 */
router.post('/events/:id/announce', async (req, res) => {
    try {
        const channelId = process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
        if (!channelId) {
            return res.status(400).json({ error: 'DISCORD_ANNOUNCE_CHANNEL_ID nicht konfiguriert in .env' });
        }

        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        if (!eventSnap.exists()) {
            return res.status(404).json({ error: 'Event nicht gefunden' });
        }

        const event = eventSnap.data();
        const { text, roleIds, pingEveryone } = req.body;

        const registrationLink = buildEventUrl(req.params.id);

        const roster = await loadEventRoster(req.params.id, event);
        const embed = buildEventEmbed(event, registrationLink, roster);
        const sent = await sendChannelMessage(channelId, embed, {
            text: text || '',
            roleIds: roleIds || [],
            pingEveryone: !!pingEveryone,
            components: buildEventComponents(event, req.params.id, roster)
        });

        if (sent) {
            const announcements = [
                ...(Array.isArray(event.announcements) ? event.announcements : []),
                { channelId: sent.channelId, messageId: sent.messageId }
            ].slice(-MAX_TRACKED_ANNOUNCEMENTS);
            await updateDoc(doc(db, 'events', req.params.id), { announcements });
            await addAuditLog('ANNOUNCE_EVENT', req.session.user.id, `Announced event "${event.title}"`, req.params.id);
            res.json({ success: true, message: 'Event im Discord-Channel angekündigt!' });
        } else {
            res.status(500).json({ error: 'Konnte nicht in den Channel posten.' });
        }
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
        const result = normalizePollInput(req.body);
        if (result.error) {
            return res.status(400).json({ error: result.error });
        }
        const now = new Date().toISOString();
        const poll = {
            ...result.poll,
            status: 'open',
            winnerOptionId: '',
            eventId: '',
            announcements: [],
            createdBy: req.session.user.id,
            createdAt: now,
            updatedAt: now,
            closedAt: ''
        };
        const ref = await addDoc(collection(db, 'polls'), poll);
        await addAuditLog('CREATE_POLL', req.session.user.id, `Created poll "${poll.title}"`, ref.id);
        res.json({ id: ref.id, ...poll });
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
        const channelId = process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
        if (!channelId) {
            return res.status(400).json({ error: 'DISCORD_ANNOUNCE_CHANNEL_ID nicht konfiguriert in .env' });
        }
        const poll = await loadPoll(req.params.id);
        if (!poll) {
            return res.status(404).json({ error: 'Abstimmung nicht gefunden' });
        }

        const { text, roleIds, pingEveryone } = req.body;
        const tally = tallyPoll(poll, await loadPollVotes(poll.id));
        const sent = await sendChannelMessage(channelId, buildPollEmbed(poll, tally), {
            text: text || '',
            roleIds: Array.isArray(roleIds) ? roleIds : [],
            pingEveryone: !!pingEveryone,
            components: buildPollComponents(poll)
        });
        if (!sent) {
            return res.status(500).json({ error: 'Konnte nicht in den Channel posten.' });
        }

        const announcements = [
            ...(Array.isArray(poll.announcements) ? poll.announcements : []),
            { channelId: sent.channelId, messageId: sent.messageId }
        ].slice(-MAX_TRACKED_ANNOUNCEMENTS);
        await updateDoc(doc(db, 'polls', poll.id), { announcements });
        await addAuditLog('ANNOUNCE_POLL', req.session.user.id, `Announced poll "${poll.title}"`, poll.id);
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
 * GET /api/admin/members/:id — One member: account info, numbers and complete history (W-15).
 */
router.get('/members/:id', async (req, res) => {
    try {
        const userSnap = await getDoc(doc(db, 'users', req.params.id));
        if (!userSnap.exists()) {
            return res.status(404).json({ error: 'Mitglied nicht gefunden.' });
        }
        const user = { ...userSnap.data(), id: userSnap.id };
        const regSnap = await getDocs(query(collection(db, 'registrations'), where('userId', '==', user.id)));
        const registrations = regSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

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
                ...memberBase(user, registrations),
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
        // Sort by timestamp descending in memory (avoids Firestore index)
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
        }

        console.log(`⚠️ SYSTEM RESET by ${req.session.user.id}: Deleted ${totalDeleted} documents.`);

        // If users were deleted, destroy session? 
        // Logic: if current user is deleted, next request fails auth anyway.

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
        res.json(settings);
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
            autoChannelCreation, autoUpdatePresence, autoStatusCalendarEvents,
            announceChannel, welcomeMessage
        } = req.body;

        const settings = {
            statusType: statusType || 'online',
            activityType: activityType || 'WATCHING',
            activityText: activityText || '',
            dmNotifications: dmNotifications !== false,
            reminderEnabled: reminderEnabled !== false,
            eventStartNotifications: eventStartNotifications !== false,
            autoChannelCreation: autoChannelCreation !== false,
            autoUpdatePresence: !!autoUpdatePresence,
            autoStatusCalendarEvents: !!autoStatusCalendarEvents,
            announceChannel: announceChannel || '',
            welcomeMessage: welcomeMessage || '',
        };

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
