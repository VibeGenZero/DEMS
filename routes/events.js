const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const { db, collection, doc, getDoc, getDocs, addDoc, deleteDoc, updateDoc, query, where, orderBy } = require('../firebaseAdmin');
const { requireAuth } = require('../middleware/auth');
const { checkRegistrationAllowed } = require('../middleware/maintenance');
const { getGuildRoles, getPublicGuildChannels } = require('../bot');
const { loadEventRoster, loadEventRegistrations, toPublicEvent, isEventVisibleTo } = require('../utils/eventUtils');
const { isEventOver, pickSeriesRepresentative, myRegistrationStatus } = require('../utils/eventListing');
const { registerUserForEvent, switchOwnSlot, unregisterUserFromEvent, REGISTRATION_SOURCE } = require('../utils/registrationService');
const { hasSlots, withSlotSummary } = require('../utils/slotService');
const { describePlaces, waitlistPositions } = require('../utils/capacity');
const { debugLog } = require('../utils/debugLog');
const { avatarUrlOf, repairAvatarUrl } = require('../utils/avatar');

/**
 * Event with its places: the numbers and the one sentence every view shows
 * (utils/capacity.js). currentParticipants stays for older readers and
 * equals the taken places, as the registration counts them.
 *
 * @param {Object} event -> Public event data.
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @returns {Object} -> The event with `currentParticipants` and `places` (`taken`, `capacity`, `guests`, `pending`, `waitlist`, `text`, `waitlistText`).
 */
function withPlaces(event, registrations) {
    const places = describePlaces(registrations, event.maxParticipants);
    return { ...event, currentParticipants: places.taken, places };
}

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
 * Query params: ?status=active&category=tournament&search=raid&page=1&limit=20
 * ?upcoming=1 leaves out events that are over (the overview); every event
 * carries myStatus, the signed-in member's status (utils/eventListing.js).
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

        // Overview: leave out events that are over, before series are grouped,
        // so seriesDates only lists the dates still to come
        if (req.query.upcoming === '1') {
            const now = new Date();
            events = events.filter(e => !isEventOver(e, now));
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

        // Get the registrations of all events in a single query
        const regSnapshot = await getDocs(collection(db, 'registrations'));
        const registrationsByEvent = {};
        regSnapshot.forEach(regDoc => {
            const data = regDoc.data();
            (registrationsByEvent[data.eventId] ||= []).push(data);
        });

        // Attach the places and the member's own status to events
        const userId = req.session.user.id;
        events = events.map(e => {
            const registrations = registrationsByEvent[e.id] || [];
            return withSlotSummary({ ...withPlaces(e, registrations), myStatus: myRegistrationStatus(registrations, userId) }, registrations);
        });

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

        // For each series, pick the date that is not over yet (a running one included) as
        // representative and attach seriesDates
        const now = new Date();
        for (const [seriesId, seriesEvents] of Object.entries(seriesGroups)) {
            // Sort by startDate ascending
            seriesEvents.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

            // A running date stays the representative, so the overview shows "Läuft gerade"
            const representative = pickSeriesRepresentative(seriesEvents, now);

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

        // Get the registrations of the series' events
        const regSnapshot = await getDocs(collection(db, 'registrations'));
        const registrationsByEvent = {};
        regSnapshot.forEach(regDoc => {
            const data = regDoc.data();
            (registrationsByEvent[data.eventId] ||= []).push(data);
        });

        const result = seriesEvents.map(e => withSlotSummary(withPlaces(e, registrationsByEvent[e.id] || []), registrationsByEvent[e.id] || []));

        res.json(result);
    } catch (err) {
        console.error('Error fetching series:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Serie' });
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
        const registrations = await loadEventRegistrations(req.params.id);

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

        const event = withPlaces(toPublicEvent(docSnap.id, docSnap.data()), registrations);
        res.json(withSlotSummary({
            ...event,
            checkinEnabled: !!event.checkinEnabled,
            waitlistCount: event.places.waitlist,
            createdByName
        }, registrations));
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
            const registration = regDoc.data();
            // Only the own place on the waitlist leaves the server, never the others' times (W-05)
            const waitlistPosition = registration.status === 'waitlisted'
                ? waitlistPositions(await loadEventRegistrations(req.params.id)).get(regDoc.id) || null
                : undefined;
            return res.json({
                registered: true,
                id: regDoc.id,
                ...registration,
                ...(waitlistPosition !== undefined ? { waitlistPosition } : {})
            });
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
// Six-digit codes: wrong guesses are limited per member. Only failed attempts count,
// so this limiter stays on in dev mock mode as well (unlike the global ones)
const checkinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => req.session?.user?.id || ipKeyGenerator(req.ip),
    message: { error: 'Zu viele Check-in-Versuche. Bitte warte ein paar Minuten.' },
    standardHeaders: true,
    legacyHeaders: false
});

router.post('/:id/checkin', requireAuth, checkinLimiter, async (req, res) => {
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
