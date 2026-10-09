const express = require('express');
const router = express.Router();
const { db, collection, doc, getDoc, getDocs, addDoc, deleteDoc, updateDoc, query, where, orderBy } = require('../firebaseAdmin');
const { requireAuth } = require('../middleware/auth');
const { checkRegistrationAllowed } = require('../middleware/maintenance');
const { getGuildRoles, getPublicGuildChannels } = require('../bot');
const { loadEventRoster, toPublicEvent, isEventVisibleTo } = require('../utils/eventUtils');
const { registerUserForEvent, switchOwnSlot, unregisterUserFromEvent, REGISTRATION_SOURCE } = require('../utils/registrationService');
const { hasSlots, withSlotSummary } = require('../utils/slotService');
const { debugLog } = require('../utils/debugLog');
const { avatarUrlOf, repairAvatarUrl } = require('../utils/avatar');

// No public preview: every event endpoint needs a login. Runs before router.param
// below, so anonymous requests get 401 and learn nothing about an event id
router.use(requireAuth);

/**
 * Every route with :id — draft and archived events answer 404 for non-admins,
 * as if they did not exist. Unknown ids are left to the route handler.
 */
router.param('id', async (req, res, next, id) => {
    try {
        const eventSnap = await getDoc(doc(db, 'events', id));
        if (eventSnap.exists() && !isEventVisibleTo(req.session.user, eventSnap.data())) {
            return res.status(404).json({ error: 'Event nicht gefunden' });
        }
        next();
    } catch (err) {
        console.error('Error checking event visibility:', err);
        res.status(500).json({ error: 'Fehler beim Laden des Events' });
    }
});

/**
 * GET /api/events — List all events (paginated)
 * Query params: ?status=active&category=tournament&page=1&limit=20
 */
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        const q = query(collection(db, 'events'));
        const snapshot = await getDocs(q);
        let events = [];
        snapshot.forEach(docSnap => {
            events.push(toPublicEvent(docSnap.id, docSnap.data()));
        });
        // Sort by startDate ascending (upcoming first), fallback to createdAt
        events.sort((a, b) => {
            const dateA = a.startDate || a.createdAt || '';
            const dateB = b.startDate || b.createdAt || '';
            return dateA.localeCompare(dateB);
        });

        // Filter by status — only admins may request non-active statuses.
        const statusFilter = req.query.status;
        const isAdmin = !!(req.session && req.session.user && req.session.user.isAdmin);
        if (statusFilter) {
            if (!isAdmin && statusFilter !== 'active') {
                return res.status(403).json({ error: 'Nicht berechtigt.' });
            }
            events = events.filter(e => e.status === statusFilter);
        } else {
            events = events.filter(e => !e.status || e.status === 'active');
        }

        // Filter by category
        if (req.query.category) {
            events = events.filter(e => e.category === req.query.category);
        }

        // Search by title and description
        if (req.query.search) {
            const searchTerm = req.query.search.toLowerCase().trim();
            if (searchTerm) {
                events = events.filter(e =>
                    (e.title || '').toLowerCase().includes(searchTerm) ||
                    (e.description || '').toLowerCase().includes(searchTerm)
                );
            }
        }

        // Get participant counts for all events in a single query
        const regSnapshot = await getDocs(collection(db, 'registrations'));
        const participantCounts = {};
        const registrationsByEvent = {};
        regSnapshot.forEach(regDoc => {
            const data = regDoc.data();
            (registrationsByEvent[data.eventId] ||= []).push(data);
            if (data.status === 'accepted' || data.status === 'pending') {
                const guestCount = Array.isArray(data.guests) ? data.guests.length : 0;
                participantCounts[data.eventId] = (participantCounts[data.eventId] || 0) + 1 + guestCount;
            }
        });

        // Attach participant counts to events
        events = events.map(e => withSlotSummary({
            ...e,
            currentParticipants: participantCounts[e.id] || 0
        }, registrationsByEvent[e.id] || []));

        // Group series events: replace multiple events with same seriesId by one representative
        const seriesGroups = {};
        const standalone = [];
        for (const event of events) {
            if (event.seriesId) {
                if (!seriesGroups[event.seriesId]) {
                    seriesGroups[event.seriesId] = [];
                }
                seriesGroups[event.seriesId].push(event);
            } else {
                standalone.push(event);
            }
        }

        // For each series, pick the next upcoming event as representative and attach seriesDates
        const now = new Date().toISOString();
        for (const [seriesId, seriesEvents] of Object.entries(seriesGroups)) {
            // Sort by startDate ascending
            seriesEvents.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

            // Pick the next upcoming event, or the last one if all are past
            const representative = seriesEvents.find(e => e.startDate >= now) || seriesEvents[seriesEvents.length - 1];

            representative.seriesDates = seriesEvents.map(e => ({
                id: e.id,
                startDate: e.startDate,
                endDate: e.endDate,
                currentParticipants: e.currentParticipants
            }));

            standalone.push(representative);
        }

        // Re-sort after grouping
        standalone.sort((a, b) => {
            const dateA = a.startDate || a.createdAt || '';
            const dateB = b.startDate || b.createdAt || '';
            return dateA.localeCompare(dateB);
        });

        events = standalone;

        debugLog('events.GET /', { count: events.length, filters: req.query });

        // Apply pagination
        const total = events.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const paginatedEvents = events.slice(startIndex, startIndex + limit);

        res.json({
            data: paginatedEvents,
            meta: {
                total,
                page,
                limit,
                totalPages
            }
        });
    } catch (err) {
        console.error('Error fetching events:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Events' });
    }
});

/**
 * GET /api/events/series/:seriesId — Get all events in a series
 */
router.get('/series/:seriesId', async (req, res) => {
    try {
        const seriesId = req.params.seriesId;
        const snapshot = await getDocs(collection(db, 'events'));
        const seriesEvents = [];
        snapshot.forEach(docSnap => {
            const event = docSnap.data();
            if (event.seriesId === seriesId && isEventVisibleTo(req.session.user, event)) {
                seriesEvents.push(toPublicEvent(docSnap.id, event));
            }
        });

        if (!seriesEvents.length) {
            return res.status(404).json({ error: 'Serie nicht gefunden' });
        }

        // Sort by startDate ascending
        seriesEvents.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

        // Get participant counts
        const regSnapshot = await getDocs(collection(db, 'registrations'));
        const participantCounts = {};
        const registrationsByEvent = {};
        regSnapshot.forEach(regDoc => {
            const data = regDoc.data();
            (registrationsByEvent[data.eventId] ||= []).push(data);
            if (data.status === 'accepted' || data.status === 'pending') {
                const guestCount = Array.isArray(data.guests) ? data.guests.length : 0;
                participantCounts[data.eventId] = (participantCounts[data.eventId] || 0) + 1 + guestCount;
            }
        });

        const result = seriesEvents.map(e => withSlotSummary({
            ...e,
            currentParticipants: participantCounts[e.id] || 0
        }, registrationsByEvent[e.id] || []));

        res.json(result);
    } catch (err) {
        console.error('Error fetching series:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Serie' });
    }
});

/**
 * GET /api/events/categories — Get all unique categories
 */
router.get('/categories', async (req, res) => {
    try {
        const q = query(collection(db, 'events'));
        const snapshot = await getDocs(q);
        const categories = new Set();
        snapshot.forEach(docSnap => {
            const cat = docSnap.data().category;
            if (cat) categories.add(cat);
        });
        res.json([...categories].sort());
    } catch (err) {
        res.status(500).json({ error: 'Fehler' });
    }
});

/**
 * Cached roles and channels for the form pickers.
 * Discord is only asked again once the cache has expired.
 */
const FORM_OPTIONS_CACHE_MS = 60 * 1000;
let formOptionsCache = { data: null, fetchedAt: 0 };

/**
 * GET /api/events/form-options — Roles and channels for form field pickers
 *
 * Used by the registration form to render role and channel fields. Only
 * channels every member can see are returned.
 */
router.get('/form-options', requireAuth, async (req, res) => {
    try {
        const now = Date.now();
        if (formOptionsCache.data && now - formOptionsCache.fetchedAt < FORM_OPTIONS_CACHE_MS) {
            return res.json(formOptionsCache.data);
        }

        const guildId = process.env.DISCORD_GUILD_ID;
        const [roles, channels] = await Promise.all([
            getGuildRoles(guildId),
            getPublicGuildChannels(guildId)
        ]);

        const data = {
            roles: roles.filter(role => !role.managed).map(role => ({ id: role.id, name: role.name })),
            channels
        };
        formOptionsCache = { data, fetchedAt: now };
        res.json(data);
    } catch (err) {
        console.error('Form options error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Auswahllisten' });
    }
});

/**
 * GET /api/events/:id — Get single event
 */
router.get('/:id', async (req, res) => {
    try {
        const docSnap = await getDoc(doc(db, 'events', req.params.id));
        if (!docSnap.exists()) {
            return res.status(404).json({ error: 'Event nicht gefunden' });
        }
        // Get registration count (accepted + pending)
        const regQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('status', 'in', ['pending', 'accepted'])
        );
        const regSnap = await getDocs(regQ);

        let currentParticipants = 0;
        const occupyingRegistrations = [];
        regSnap.forEach(regDoc => {
            const r = regDoc.data();
            occupyingRegistrations.push(r);
            currentParticipants += 1 + (Array.isArray(r.guests) ? r.guests.length : 0);
        });

        // Get waitlist count
        const waitQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('status', '==', 'waitlisted')
        );
        const waitSnap = await getDocs(waitQ);

        // Look up creator display name
        let createdByName = '';
        const creatorId = docSnap.data().createdBy;
        if (creatorId) {
            try {
                const userSnap = await getDoc(doc(db, 'users', creatorId));
                if (userSnap.exists()) {
                    const u = userSnap.data();
                    createdByName = u.displayName || u.username || '';
                }
            } catch { /* non-fatal */ }
        }

        const event = toPublicEvent(docSnap.id, docSnap.data());
        res.json(withSlotSummary({
            ...event,
            checkinEnabled: !!event.checkinEnabled,
            currentParticipants,
            waitlistCount: waitSnap.size,
            createdByName
        }, occupyingRegistrations));
    } catch (err) {
        console.error('Error fetching event:', err);
        res.status(500).json({ error: 'Fehler beim Laden des Events' });
    }
});

/**
 * POST /api/events/:id/register — Register for an event
 */
router.post('/:id/register', requireAuth, checkRegistrationAllowed, async (req, res) => {
    try {
        const user = req.session.user;
        const result = await registerUserForEvent({
            eventId: req.params.id,
            user: { id: user.id, displayName: user.displayName, roles: user.roles },
            formAnswers: req.body.formAnswers || {},
            guests: Array.isArray(req.body.guests) ? req.body.guests : [],
            source: REGISTRATION_SOURCE.WEB,
            slotId: typeof req.body.slotId === 'string' ? req.body.slotId : null,
            altSlotIds: Array.isArray(req.body.altSlotIds) ? req.body.altSlotIds : []
        });

        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }

        debugLog('events.register', { eventId: req.params.id, userId: req.session?.user?.id });
        res.json({ id: result.id, status: result.status, message: result.message, slotId: result.slotId, isAlt: result.isAlt });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Fehler bei der Anmeldung' });
    }
});

/**
 * PUT /api/events/:id/register/slot — Switch the own registration into a free slot
 */
router.put('/:id/register/slot', requireAuth, checkRegistrationAllowed, async (req, res) => {
    try {
        const result = await switchOwnSlot({
            eventId: req.params.id,
            userId: req.session.user.id,
            slotId: typeof req.body.slotId === 'string' ? req.body.slotId : ''
        });
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        debugLog('events.switchSlot', { eventId: req.params.id, userId: req.session.user.id, slotId: result.slotId });
        res.json({ status: result.status, slotId: result.slotId, message: result.message });
    } catch (err) {
        console.error('Switch slot error:', err);
        res.status(500).json({ error: 'Fehler beim Wechseln des Slots' });
    }
});

/**
 * DELETE /api/events/:id/register — Unregister from an event
 */
router.delete('/:id/register', requireAuth, async (req, res) => {
    try {
        const result = await unregisterUserFromEvent({ eventId: req.params.id, userId: req.session.user.id });
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        debugLog('events.cancelRegistration', { eventId: req.params.id, userId: req.session.user.id });
        res.json({ success: true, message: 'Abmeldung erfolgreich.' });
    } catch (err) {
        console.error('Unregister error:', err);
        res.status(500).json({ error: 'Fehler bei der Abmeldung' });
    }
});

/**
 * GET /api/events/:id/my-registration — Check if user is registered
 */
router.get('/:id/my-registration', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;

        // Check if user is the primary registrant
        const regQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('userId', '==', user.id)
        );
        const regSnap = await getDocs(regQ);

        if (!regSnap.empty) {
            const regDoc = regSnap.docs[0];
            return res.json({ registered: true, id: regDoc.id, ...regDoc.data() });
        }

        // Check if user is an accepted guest in someone else's registration
        const guestQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('guests', 'array-contains', user.id)
        );
        const guestSnap = await getDocs(guestQ);

        // The document belongs to the inviting member (form answers, guest list) -> only status and id
        if (!guestSnap.empty) {
            const regDoc = guestSnap.docs[0];
            return res.json({ registered: true, asGuest: true, id: regDoc.id, status: regDoc.data().status });
        }

        res.json({ registered: false });
    } catch (err) {
        res.status(500).json({ error: 'Fehler' });
    }
});

/**
 * GET /api/events/:id/participants — Get accepted participants (auth required)
 */
router.get('/:id/participants', requireAuth, async (req, res) => {
    try {
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const event = eventSnap.exists() ? eventSnap.data() : null;
        const regQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('status', '==', 'accepted')
        );
        const regSnap = await getDocs(regQ);

        const userIds = [];
        regSnap.forEach(d => {
            if (d.data().userId) userIds.push(d.data().userId);
        });

        const total = userIds.length;
        const limited = userIds.slice(0, 20);

        const participants = [];
        for (const uid of limited) {
            try {
                const userSnap = await getDoc(doc(db, 'users', uid));
                if (userSnap.exists()) {
                    const u = userSnap.data();
                    participants.push({
                        displayName: u.displayName || u.username || 'Unbekannt',
                        avatar: u.avatar || ''
                    });
                }
            } catch { /* skip missing users */ }
        }

        const payload = { participants, total };
        if (event && hasSlots(event)) {
            const roster = await loadEventRoster(req.params.id, event, { withProfiles: true });
            payload.slots = roster.slots;
            payload.waitlist = roster.waitlist;
        }
        res.json(payload);
    } catch (err) {
        console.error('Participants error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Teilnehmer' });
    }
});

/**
 * POST /api/events/:id/checkin — User check-in with code
 */
router.post('/:id/checkin', requireAuth, async (req, res) => {
    try {
        const { code } = req.body;
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        if (!eventSnap.exists()) {
            return res.status(404).json({ error: 'Event nicht gefunden' });
        }

        const event = eventSnap.data();
        if (!event.checkinEnabled || !event.checkinCode) {
            return res.status(400).json({ error: 'Check-in ist nicht aktiviert.' });
        }

        if (code !== event.checkinCode) {
            return res.status(400).json({ error: 'Ungültiger Check-in Code.' });
        }

        // Find user's accepted registration
        const regQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('userId', '==', req.session.user.id),
            where('status', '==', 'accepted')
        );
        const regs = await getDocs(regQ);
        if (regs.empty) {
            return res.status(400).json({ error: 'Keine akzeptierte Anmeldung gefunden.' });
        }

        const regDoc = regs.docs[0];
        if (regDoc.data().checkedIn) {
            return res.json({ success: true, alreadyCheckedIn: true, checkinMessage: event.checkinMessage || '' });
        }

        await updateDoc(doc(db, 'registrations', regDoc.id), {
            checkedIn: true,
            checkedInAt: new Date().toISOString()
        });

        res.json({ success: true, checkinMessage: event.checkinMessage || '' });
    } catch (err) {
        console.error('Checkin error:', err);
        res.status(500).json({ error: 'Fehler beim Check-in' });
    }
});

/**
 * GET /api/events/:id/comments — Get comments for an event
 */
router.get('/:id/comments', requireAuth, async (req, res) => {
    try {
        const q = query(
            collection(db, 'comments'),
            where('eventId', '==', req.params.id)
        );
        const snapshot = await getDocs(q);
        const comments = [];
        snapshot.forEach(docSnap => {
            const comment = docSnap.data();
            // Older comments stored a wrapped avatar URL -> shown with the real one
            comments.push({ id: docSnap.id, ...comment, userAvatar: repairAvatarUrl(comment.userAvatar) });
        });
        // Sort in memory to avoid Firestore composite index requirement
        comments.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        res.json(comments);
    } catch (err) {
        console.error('Error fetching comments:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Kommentare' });
    }
});

/**
 * POST /api/events/:id/comments — Post a comment
 */
router.post('/:id/comments', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const { text, replyTo } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Kommentar darf nicht leer sein.' });
        }

        if (text.trim().length > 1000) {
            return res.status(400).json({ error: 'Kommentar darf max. 1000 Zeichen lang sein.' });
        }

        const comment = {
            eventId: req.params.id,
            userId: user.id,
            userName: user.displayName,
            userAvatar: avatarUrlOf(user),
            text: text.trim(),
            isAdmin: !!user.isAdmin,
            replyTo: replyTo || null,
            createdAt: new Date().toISOString()
        };

        const ref = await addDoc(collection(db, 'comments'), comment);
        res.json({ id: ref.id, ...comment });
    } catch (err) {
        console.error('Error posting comment:', err);
        res.status(500).json({ error: 'Fehler beim Posten des Kommentars' });
    }
});

/**
 * DELETE /api/events/:id/comments/:commentId — Delete a comment
 */
router.delete('/:id/comments/:commentId', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const commentSnap = await getDoc(doc(db, 'comments', req.params.commentId));

        if (!commentSnap.exists()) {
            return res.status(404).json({ error: 'Kommentar nicht gefunden.' });
        }

        const comment = commentSnap.data();
        // Allow deletion by comment owner or admin
        if (comment.userId !== user.id && !user.isAdmin) {
            return res.status(403).json({ error: 'Nicht berechtigt.' });
        }

        await deleteDoc(doc(db, 'comments', req.params.commentId));
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting comment:', err);
        res.status(500).json({ error: 'Fehler beim Löschen des Kommentars' });
    }
});

module.exports = router;
