const express = require('express');
const router = express.Router();
const { db, collection, doc, getDoc, getDocs, addDoc, deleteDoc, updateDoc, query, where, orderBy } = require('../firebaseAdmin');
const { requireAuth } = require('../middleware/auth');
const { sendDM, assignRole, parseTemplate, getGuildRoles, addParticipantToEventChannels, removeParticipantFromEventChannels, removeRole } = require('../bot');
const { promoteFromWaitlist } = require('../utils/eventUtils');

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
            events.push({ id: docSnap.id, ...docSnap.data() });
        });
        // Sort by startDate ascending (upcoming first), fallback to createdAt
        events.sort((a, b) => {
            const dateA = a.startDate || a.createdAt || '';
            const dateB = b.startDate || b.createdAt || '';
            return dateA.localeCompare(dateB);
        });

        // Filter by status (default: only active for non-admin)
        const statusFilter = req.query.status;
        if (statusFilter) {
            events = events.filter(e => e.status === statusFilter);
        } else {
            // By default, only show active events to users
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
        regSnapshot.forEach(regDoc => {
            const data = regDoc.data();
            if (data.status === 'accepted' || data.status === 'pending') {
                const guestCount = Array.isArray(data.guests) ? data.guests.length : 0;
                participantCounts[data.eventId] = (participantCounts[data.eventId] || 0) + 1 + guestCount;
            }
        });

        // Attach participant counts to events
        events = events.map(e => ({
            ...e,
            currentParticipants: participantCounts[e.id] || 0
        }));

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
        regSnap.forEach(doc => {
            const r = doc.data();
            currentParticipants += 1 + (Array.isArray(r.guests) ? r.guests.length : 0);
        });

        // Get waitlist count
        const waitQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('status', '==', 'waitlisted')
        );
        const waitSnap = await getDocs(waitQ);

        res.json({
            id: docSnap.id,
            ...docSnap.data(),
            currentParticipants,
            waitlistCount: waitSnap.size
        });
    } catch (err) {
        console.error('Error fetching event:', err);
        res.status(500).json({ error: 'Fehler beim Laden des Events' });
    }
});

/**
 * POST /api/events/:id/register — Register for an event
 */
router.post('/:id/register', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const eventRef = doc(db, 'events', req.params.id);
        const eventSnap = await getDoc(eventRef);

        if (!eventSnap.exists()) {
            return res.status(404).json({ error: 'Event nicht gefunden' });
        }

        const event = eventSnap.data();

        // Check event is active
        if (event.status && event.status !== 'active') {
            return res.status(400).json({ error: 'Dieses Event akzeptiert keine Anmeldungen.' });
        }

        // Check if already registered
        const existQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('userId', '==', user.id)
        );
        const existSnap = await getDocs(existQ);

        if (!existSnap.empty) {
            return res.status(400).json({ error: 'Du bist bereits registriert.' });
        }

        // Check role requirement
        if (event.accessMode === 'role-required' && event.requiredRoles && event.requiredRoles.length > 0) {
            const hasRole = event.requiredRoles.some(roleId => user.roles.includes(roleId));
            if (!hasRole) {
                return res.status(403).json({ error: 'Du hast nicht die erforderliche Rolle.' });
            }
        }

        // Check max participants — if full, add to waitlist
        let status;
        let isWaitlisted = false;

        const incomingGuests = Array.isArray(req.body.guests) ? req.body.guests : [];
        if (event.allowGuests === false && incomingGuests.length > 0) {
            return res.status(400).json({ error: 'Gäste sind für dieses Event nicht zugelassen.' });
        }
        const requiredSlots = 1 + incomingGuests.length;

        if (event.maxParticipants > 0) {
            const regQ = query(
                collection(db, 'registrations'),
                where('eventId', '==', req.params.id),
                where('status', 'in', ['pending', 'accepted'])
            );
            const regSnap = await getDocs(regQ);

            let currentCount = 0;
            regSnap.forEach(doc => {
                const r = doc.data();
                currentCount += 1 + (r.guests ? r.guests.length : 0);
            });

            if (currentCount + requiredSlots > event.maxParticipants) {
                status = 'waitlisted';
                isWaitlisted = true;
            }
        }

        if (!isWaitlisted) {
            status = event.approvalMode === 'instant' ? 'accepted' : 'pending';
        }

        // Create registration
        const registration = {
            eventId: req.params.id,
            userId: user.id,
            userName: user.displayName,
            status,
            formAnswers: req.body.formAnswers || {},
            guests: incomingGuests,
            createdAt: new Date().toISOString()
        };

        const regRef = await addDoc(collection(db, 'registrations'), registration);

        // Send DM notification
        const templateSnap = await getDoc(doc(db, 'botMessages', 'templates'));
        const globalTemplates = templateSnap.exists() ? templateSnap.data() : {};

        // Prepare variables
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const eventUrl = `${baseUrl}/#events/${req.params.id}`;

        let roleName = '';
        let roleMention = '';

        if (event.assignRoleId) {
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
            'user.id': user.id,
            'user.name': user.displayName,
            'user.mention': `<@${user.id}>`,
            'event.title': event.title || 'Unbekanntes Event',
            'event.url': eventUrl,
            'role.name': roleName,
            'role.mention': roleMention
        };

        const customMsgs = event.customBotMessages || {};

        if (isWaitlisted) {
            // Waitlist message (currently no custom override for waitlist in plan, but good to keep consistent)
            await sendDM(user.id, `📋 Das Event **${event.title}** ist aktuell voll. Du wurdest auf die **Warteliste** gesetzt. Wir benachrichtigen dich, sobald ein Platz frei wird!`);
        } else if (status === 'accepted') {
            const template = customMsgs.accepted || globalTemplates.accepted;
            const msg = template
                ? parseTemplate(template, vars)
                : `✅ Du wurdest automatisch für **${event.title}** angenommen!`;

            await sendDM(user.id, msg);

            if (event.assignRoleId) {
                await assignRole(user.id, event.assignRoleId, process.env.DISCORD_GUILD_ID);
            }
            if (event.discordChannelId || event.discordTextChannelId) {
                await addParticipantToEventChannels(event, user.id);
            }
        } else {
            const template = customMsgs.registration || globalTemplates.registration;
            const msg = template
                ? parseTemplate(template, vars)
                : `📋 Deine Anfrage für **${event.title}** ist eingegangen. Bitte warte auf die Bestätigung.`;

            await sendDM(user.id, msg);
        }

        const messages = {
            accepted: 'Erfolgreich angemeldet!',
            pending: 'Anfrage eingegangen.',
            waitlisted: 'Auf die Warteliste gesetzt.'
        };

        res.json({ id: regRef.id, status, message: messages[status] });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Fehler bei der Anmeldung' });
    }
});

/**
 * DELETE /api/events/:id/register — Unregister from an event
 */
router.delete('/:id/register', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const eventId = req.params.id;

        // Find registration
        const q = query(
            collection(db, 'registrations'),
            where('eventId', '==', eventId),
            where('userId', '==', user.id)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return res.status(404).json({ error: 'Nicht angemeldet.' });
        }

        const regDoc = snapshot.docs[0];
        const regData = regDoc.data();

        // Delete registration
        await deleteDoc(doc(db, 'registrations', regDoc.id));

        res.json({ success: true, message: 'Abmeldung erfolgreich.' });

        try {
            // Post-processing: If user was accepted, remove role
            const eventSnap = await getDoc(doc(db, 'events', eventId));
            if (eventSnap.exists()) {
                const event = eventSnap.data();
                if (regData.status === 'accepted') {
                    if (event.assignRoleId) {
                        await removeRole(user.id, event.assignRoleId, process.env.DISCORD_GUILD_ID);
                    }
                    if (event.discordChannelId || event.discordTextChannelId) {
                        await removeParticipantFromEventChannels(event, user.id);
                    }
                }

                // Trigger waitlist promotion if a spot opened up
                if (regData.status === 'accepted' || regData.status === 'pending') {
                    await promoteFromWaitlist(eventId, event);
                }
            }
        } catch (postErr) {
            console.error('Post-processing error after unregister:', postErr);
        }

    } catch (err) {
        console.error('Unregister error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Fehler bei der Abmeldung' });
        }
    }
});

/**
 * GET /api/events/:id/my-registration — Check if user is registered
 */
router.get('/:id/my-registration', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const regQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', req.params.id),
            where('userId', '==', user.id)
        );
        const regSnap = await getDocs(regQ);

        if (regSnap.empty) {
            return res.json({ registered: false });
        }

        const regDoc = regSnap.docs[0];
        res.json({ registered: true, id: regDoc.id, ...regDoc.data() });
    } catch (err) {
        res.status(500).json({ error: 'Fehler' });
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
router.get('/:id/comments', async (req, res) => {
    try {
        const q = query(
            collection(db, 'comments'),
            where('eventId', '==', req.params.id)
        );
        const snapshot = await getDocs(q);
        const comments = [];
        snapshot.forEach(docSnap => {
            comments.push({ id: docSnap.id, ...docSnap.data() });
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
            userAvatar: user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
                : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.id) % 5}.png`,
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
