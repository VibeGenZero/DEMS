const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const {
    db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, writeBatch
} = require('../firebaseAdmin');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateEvent, validateRegStatus, validateBotMessages } = require('../middleware/validators');
const { sendDM, assignRole, parseTemplate, getGuildRoles, sendChannelMessage, buildEventEmbed, getGuildScheduledEvents, createEventChannels, deleteEventChannels, createScheduledEvent, getBotStatus, getBotSettings, saveBotSettings, getRunningEvents } = require('../bot');
const { promoteFromWaitlist, addAuditLog } = require('../utils/eventUtils');

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
 * GET /api/admin/all-events — Get ALL events (including draft/archived)
 */
router.get('/all-events', async (req, res) => {
    try {
        const q = query(collection(db, 'events'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const events = [];
        snapshot.forEach(docSnap => {
            events.push({ id: docSnap.id, ...docSnap.data() });
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
            customBotMessages, autoCreateChannels, channelConfig, allowGuests
        } = req.body;

        const baseEvent = {
            title,
            description,
            maxParticipants: parseInt(maxParticipants) || 0,
            accessMode: accessMode || 'open',
            requiredRoles: requiredRoles || [],
            approvalMode: approvalMode || 'manual',
            assignRoleId: assignRoleId || '',
            formFields: formFields || [],
            startDate: startDate || '',
            endDate: endDate || '',
            bannerUrl: bannerUrl || '',
            category: category || '',
            status: status || 'active',
            reminderHours: Array.isArray(reminderHours) ? reminderHours : (reminderHours ? [{ hours: parseInt(reminderHours) || 0, sent: false }] : []),
            checkinMessage: checkinMessage || '',
            customBotMessages: customBotMessages || {},
            autoCreateChannels: !!autoCreateChannels,
            channelConfig: channelConfig || {},
            allowGuests: allowGuests !== false,
            eventStartNotificationSent: false,
            recurring: !!recurring,
            recurringInterval: recurringInterval || '',
            recurringUntil: recurringUntil || '',
            createdAt: new Date().toISOString(),
            createdBy: req.session.user.id
        };

        // Generate recurring instances
        if (recurring && startDate && recurringUntil) {
            const seriesId = crypto.randomUUID();
            const createdEvents = [];
            let currentStart = new Date(startDate);
            // Compare only the date portion (YYYY-MM-DD) so the full last day is included
            // regardless of the event's time-of-day
            const duration = endDate ? (new Date(endDate) - new Date(startDate)) : 0;

            while (currentStart.toISOString().substring(0, 10) <= recurringUntil) {
                const instance = {
                    ...baseEvent,
                    seriesId,
                    startDate: currentStart.toISOString(),
                    endDate: duration ? new Date(currentStart.getTime() + duration).toISOString() : '',
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
            res.json({ count: createdEvents.length, events: createdEvents });
        } else {
            const ref = await addDoc(collection(db, 'events'), baseEvent);
            await addAuditLog('CREATE_EVENT', req.session.user.id, `Created event "${title}"`, ref.id);
            if (baseEvent.autoCreateChannels && baseEvent.status === 'active') {
                createEventChannels({ id: ref.id, ...baseEvent }).catch(console.error);
            }
            res.json({ id: ref.id, ...baseEvent });
        }
    } catch (err) {
        console.error('Create event error:', err);
        res.status(500).json({ error: 'Fehler beim Erstellen des Events' });
    }
});

/**
 * PUT /api/admin/events/:id — Update event
 */
router.put('/events/:id', validateEvent, async (req, res) => {
    try {
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const oldEvent = eventSnap.exists() ? eventSnap.data() : {};

        const {
            title, description, maxParticipants, accessMode, requiredRoles,
            approvalMode, assignRoleId, formFields,
            startDate, endDate, bannerUrl, category, status, reminderHours, checkinMessage,
            customBotMessages, autoCreateChannels, channelConfig, allowGuests
        } = req.body;

        const updates = {
            title,
            description,
            maxParticipants: parseInt(maxParticipants) || 0,
            accessMode: accessMode || 'open',
            requiredRoles: requiredRoles || [],
            approvalMode: approvalMode || 'manual',
            assignRoleId: assignRoleId || '',
            formFields: formFields || [],
            startDate: startDate || '',
            endDate: endDate || '',
            bannerUrl: bannerUrl || '',
            category: category || '',
            status: status || 'active',
            reminderHours: Array.isArray(reminderHours) ? reminderHours : (reminderHours ? [{ hours: parseInt(reminderHours) || 0, sent: false }] : []),
            checkinMessage: checkinMessage || '',
            customBotMessages: customBotMessages || {},
            autoCreateChannels: !!autoCreateChannels,
            channelConfig: channelConfig || {},
            allowGuests: allowGuests !== false,
            recurring: !!req.body.recurring,
            recurringInterval: req.body.recurringInterval || '',
            recurringUntil: req.body.recurringUntil || '',
            updatedAt: new Date().toISOString()
        };

        await updateDoc(doc(db, 'events', req.params.id), updates);
        await addAuditLog('UPDATE_EVENT', req.session.user.id, `Updated event "${title}"`, req.params.id);

        const isNowActive = updates.status === 'active';
        const wasActive = oldEvent.status === 'active';

        if (updates.autoCreateChannels && isNowActive && (!oldEvent.autoCreateChannels || !wasActive)) {
            createEventChannels({ id: req.params.id, ...updates }).catch(console.error);
        } else if ((oldEvent.autoCreateChannels && wasActive) && (!updates.autoCreateChannels || !isNowActive)) {
            deleteEventChannels(req.params.id).catch(console.error);
        }

        res.json({ id: req.params.id, ...updates });
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

        await updateDoc(doc(db, 'events', req.params.id), { status, updatedAt: new Date().toISOString() });
        await addAuditLog('UPDATE_EVENT_STATUS', req.session.user.id, `Changed status to ${status}`, req.params.id);

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

        let notifiedCount = 0;
        for (const regDoc of regs.docs) {
            const reg = regDoc.data();
            const sent = await sendDM(reg.userId, `⚠️ **WICHTIG:** Das Event **${event.title}** wurde leider **ABGESAGT**.`);
            if (sent) notifiedCount++;
        }

        await addAuditLog('CANCEL_EVENT', req.session.user.id, `Cancelled event "${event.title}" and notified ${notifiedCount} users`, eventId);

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

        if (event && event.autoCreateChannels && event.status === 'active') {
            deleteEventChannels(req.params.id).catch(console.error);
        }

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
            const event = (await getDoc(doc(db, 'events', eventId))).data();
            await deleteDoc(doc(db, 'events', eventId));

            const regQ = query(collection(db, 'registrations'), where('eventId', '==', eventId));
            const regs = await getDocs(regQ);
            const deletePromises = [];
            regs.forEach(regDoc => {
                deletePromises.push(deleteDoc(doc(db, 'registrations', regDoc.id)));
            });
            await Promise.all(deletePromises);

            if (event && event.autoCreateChannels && event.status === 'active') {
                deleteEventChannels(eventId).catch(console.error);
            }
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
        const code = String(Math.floor(100000 + Math.random() * 900000));
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

        // Pagination
        const total = allRegs.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const paginatedRegs = allRegs.slice(startIndex, startIndex + limit);

        res.json({
            data: paginatedRegs,
            meta: { total, page, limit, totalPages }
        });
    } catch (err) {
        console.error('Get registrations error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Anmeldungen' });
    }
});

/**
 * GET /api/admin/events/:id/registrations/export — Export registrations as CSV
 */
router.get('/events/:id/registrations/export', async (req, res) => {
    try {
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const eventTitle = eventSnap.exists() ? eventSnap.data().title : 'Event';

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
        const headers = ['User', 'UserID', 'Status', 'Datum', 'Gäste (Anzahl)', 'Gäste IDs', ...formKeysArr];
        const rows = registrations.map(r => {
            const guestCount = Array.isArray(r.guests) ? r.guests.length : 0;
            const guestIds = Array.isArray(r.guests) ? r.guests.join('; ') : '';
            const base = [
                `"${(r.userName || '').replace(/"/g, '""')}"`,
                r.userId,
                r.status,
                r.createdAt ? new Date(r.createdAt).toLocaleDateString('de-DE') : '',
                guestCount,
                `"${guestIds}"`
            ];
            const formVals = formKeysArr.map(k => {
                const val = r.formAnswers ? r.formAnswers[k] : '';
                return `"${String(val || '').replace(/"/g, '""')}"`;
            });
            return [...base, ...formVals].join(',');
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

        const reg = regSnap.data();
        await updateDoc(doc(db, 'registrations', req.params.id), { status });

        // Fetch event for template variables & role
        const eventSnap = await getDoc(doc(db, 'events', reg.eventId));
        const event = eventSnap.exists() ? eventSnap.data() : {};

        // Get message templates
        const templateSnap = await getDoc(doc(db, 'botMessages', 'templates'));
        const globalTemplates = templateSnap.exists() ? templateSnap.data() : {};

        // Prepare variables
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const eventUrl = `${baseUrl}/#events/${reg.eventId}`;

        let roleName = '';
        let roleMention = '';

        if (event.assignRoleId) {
            // Try to find role name from cache or fetch
            const roles = await getGuildRoles(process.env.DISCORD_GUILD_ID);
            const role = roles.find(r => r.id === event.assignRoleId);
            if (role) {
                roleName = role.name;
                roleMention = `<@&${role.id}>`;
            } else {
                roleName = 'Unbekannte Rolle';
                roleMention = 'Unbekannte Rolle';
            }
        }

        const vars = {
            'user.id': reg.userId,
            'user.name': reg.userName,
            'user.mention': `<@${reg.userId}>`,
            'event.title': event.title || 'Unbekanntes Event',
            'event.url': eventUrl,
            'role.name': roleName,
            'role.mention': roleMention
        };

        const customMsgs = event.customBotMessages || {};

        if (status === 'accepted') {
            const template = customMsgs.accepted || globalTemplates.accepted;
            const msg = template
                ? parseTemplate(template, vars)
                : `✅ Du wurdest für **${event.title}** angenommen! Willkommen dabei!`;

            await sendDM(reg.userId, msg);

            // Assign role
            if (event.assignRoleId) {
                await assignRole(reg.userId, event.assignRoleId, process.env.DISCORD_GUILD_ID);
            }
        } else if (status === 'rejected') {
            const template = customMsgs.rejected || globalTemplates.rejected;
            const msg = template
                ? parseTemplate(template, vars)
                : `❌ Leider wurde deine Anfrage für **${event.title}** abgelehnt.`;

            await sendDM(reg.userId, msg);

            // Auto-promote from waitlist
            await promoteFromWaitlist(reg.eventId, event);
        }

        await addAuditLog('UPDATE_REGISTRATION_STATUS', req.session.user.id, `Set status to ${status} for user ${reg.userName}`, req.params.id);

        res.json({ id: req.params.id, status });
    } catch (err) {
        console.error('Update registration status error:', err);
        res.status(500).json({ error: 'Fehler beim Aktualisieren des Status' });
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

        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const registrationLink = `${baseUrl}/#events/${req.params.id}`;

        const embed = buildEventEmbed(event, registrationLink);
        const success = await sendChannelMessage(channelId, embed, {
            text: text || '',
            roleIds: roleIds || [],
            pingEveryone: !!pingEveryone
        });

        if (success) {
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
        const adminPassword = process.env.ADMIN_RESET_PASSWORD;
        if (!adminPassword || password !== adminPassword) {
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
            auditLogs: 'auditLogs'
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

module.exports = router;
