const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, orderBy, writeBatch } = require('../firebaseAdmin');
const { requireAuth } = require('../middleware/auth');
const { debugLog } = require('../utils/debugLog');
const { deleteUserPollVotes } = require('../utils/pollStore');
const { promoteFromWaitlist, toPublicEvent, loadEventRegistrations, loadUserParticipations } = require('../utils/eventUtils');
const { notifyRegistrationsChanged } = require('../utils/announcementRefresh');
const { OCCUPYING_STATUSES, waitlistPositions } = require('../utils/capacity');
const { buildProfileEvents } = require('../utils/profileEvents');
const { NOTIFICATION_KINDS, normalizeNotificationPrefs } = require('../utils/notificationPrefs');
const { currentPrivacyVersion } = require('../utils/privacyPolicy');
const { savePrivacyAcceptance } = require('../utils/userProfile');

/**
 * POST /api/user/privacy/accept — { version }: the member accepts the current privacy policy (#138)
 */
router.post('/privacy/accept', requireAuth, async (req, res) => {
    try {
        const current = await currentPrivacyVersion();
        if (current === 0) return res.status(409).json({ error: 'Es gibt keine Datenschutzerklärung zum Akzeptieren.' });
        if (req.body.version !== current) {
            return res.status(409).json({ error: 'Es gibt eine neue Fassung der Datenschutzerklärung. Bitte lies sie und stimme erneut zu.', version: current });
        }
        const acceptedAt = await savePrivacyAcceptance(req.session.user.id, current);
        req.session.user.privacyAcceptedVersion = current;
        debugLog('privacy.accept', { userId: req.session.user.id, version: current });
        res.json({ success: true, version: current, acceptedAt });
    } catch (err) {
        console.error('Privacy accept error:', err);
        res.status(500).json({ error: 'Die Zustimmung konnte nicht gespeichert werden.' });
    }
});

/**
 * GET /api/user/registrations — Get all registrations for the logged-in user
 */
router.get('/registrations', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const regQ = query(
            collection(db, 'registrations'),
            where('userId', '==', user.id)
        );
        const regSnap = await getDocs(regQ);

        // Collect unique event IDs and batch-fetch them
        const eventIds = new Set();
        regSnap.docs.forEach(d => {
            if (d.data().eventId) eventIds.add(d.data().eventId);
        });

        // Batch-load events (avoid N+1 query problem)
        const eventMap = new Map();
        const eventIdArr = [...eventIds];
        // 'in' queries in batches of 30 ids (the old Firestore limit, kept for small queries)
        for (let i = 0; i < eventIdArr.length; i += 30) {
            const batch = eventIdArr.slice(i, i + 30);
            for (const eid of batch) {
                try {
                    const eventSnap = await getDoc(doc(db, 'events', eid));
                    if (eventSnap.exists()) {
                        eventMap.set(eid, toPublicEvent(eventSnap.id, eventSnap.data()));
                    }
                } catch { /* event may have been deleted */ }
            }
        }

        const registrations = regSnap.docs.map(regDoc => {
            const reg = regDoc.data();
            return {
                id: regDoc.id,
                ...reg,
                event: eventMap.get(reg.eventId) || null
            };
        });

        // Sort by createdAt desc
        registrations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(registrations);
    } catch (err) {
        console.error('Error fetching user registrations:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Registrierungen' });
    }
});

/**
 * GET /api/user/profile — stats, badges and the member's events: `upcoming` and `history` (utils/profileEvents.js)
 */
router.get('/profile', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;

        // ── Fetch registrations and guest places (#110) ──────────
        const participations = await loadUserParticipations(user.id);
        debugLog('user.getProfile', { userId: req.session?.user?.id });

        // Batch-load events
        const eventIds = new Set(participations.map(entry => entry.eventId).filter(Boolean));

        const eventMap = new Map();
        // Complete event data for the lists of the page; never sent as it is
        const eventsById = new Map();
        for (const eid of eventIds) {
            try {
                const eventSnap = await getDoc(doc(db, 'events', eid));
                if (eventSnap.exists()) {
                    eventMap.set(eid, toPublicEvent(eventSnap.id, eventSnap.data()));
                    eventsById.set(eid, eventSnap.data());
                }
            } catch { /* event may have been deleted */ }
        }

        // A guest place counts as Teilnahme and Check-in of the guest, not as their registration (#110)
        const registrations = participations.map(entry => ({ ...entry, event: eventMap.get(entry.eventId) || null }));

        // Sort by createdAt desc
        registrations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const ownWithEvents = registrations.filter(entry => !entry.asGuest);

        // ── Compute stats ────────────────────────────────────────
        const stats = {
            total: ownWithEvents.length,
            accepted: 0,
            pending: 0,
            rejected: 0,
            waitlisted: 0,
            // „Vielleicht“ answers (B-17)
            tentative: 0,
            checkedIn: 0
        };

        registrations.forEach(r => {
            if (r.status === 'accepted') stats.accepted++;
            else if (r.status === 'pending') stats.pending++;
            else if (r.status === 'rejected') stats.rejected++;
            else if (r.status === 'waitlisted') stats.waitlisted++;
            else if (r.status === 'tentative') stats.tentative++;
            if (r.checkedIn) stats.checkedIn++;
        });

        // ── Compute badges ───────────────────────────────────────
        const badges = [];

        // 🌱 Newcomer — first registration
        if (ownWithEvents.length >= 1) {
            badges.push({
                id: 'newcomer',
                name: 'Newcomer',
                description: 'Erste Registrierung',
                icon: 'bi-flower1',
                color: '#22c55e',
                unlocked: true
            });
        } else {
            badges.push({
                id: 'newcomer',
                name: 'Newcomer',
                description: 'Registriere dich für ein Event',
                icon: 'bi-flower1',
                color: '#22c55e',
                unlocked: false
            });
        }

        // ⚡ Early Bird — registered within 1h of event creation
        const hasEarlyBird = ownWithEvents.some(r => {
            if (!r.event || !r.createdAt || !r.event.createdAt) return false;
            const regTime = new Date(r.createdAt).getTime();
            const eventCreated = new Date(r.event.createdAt).getTime();
            return (regTime - eventCreated) <= (60 * 60 * 1000); // 1 hour
        });
        badges.push({
            id: 'early-bird',
            name: 'Early Bird',
            description: hasEarlyBird
                ? 'Innerhalb 1h nach Event-Erstellung registriert'
                : 'Registriere dich innerhalb 1h nach Event-Erstellung',
            icon: 'bi-sunrise',
            color: '#eab308',
            unlocked: hasEarlyBird
        });

        // 🔥 Regular — 5+ events accepted
        const acceptedCount = stats.accepted;
        badges.push({
            id: 'regular',
            name: 'Regular',
            description: acceptedCount >= 5
                ? `${acceptedCount} Events teilgenommen`
                : `${acceptedCount}/5 Events teilgenommen`,
            icon: 'bi-fire',
            color: '#f97316',
            unlocked: acceptedCount >= 5,
            progress: Math.min(acceptedCount / 5, 1)
        });

        // 👑 Veteran — 10+ events
        badges.push({
            id: 'veteran',
            name: 'Veteran',
            description: acceptedCount >= 10
                ? `${acceptedCount} Events teilgenommen`
                : `${acceptedCount}/10 Events teilgenommen`,
            icon: 'bi-trophy',
            color: '#a855f7',
            unlocked: acceptedCount >= 10,
            progress: Math.min(acceptedCount / 10, 1)
        });

        // ⭐ Legend — 20+ events
        badges.push({
            id: 'legend',
            name: 'Legende',
            description: acceptedCount >= 20
                ? `${acceptedCount} Events teilgenommen`
                : `${acceptedCount}/20 Events teilgenommen`,
            icon: 'bi-star-fill',
            color: '#f59e0b',
            unlocked: acceptedCount >= 20,
            progress: Math.min(acceptedCount / 20, 1)
        });

        // ✅ Perfect Attendance — 3+ events checked in
        badges.push({
            id: 'perfect-attendance',
            name: 'Perfect Attendance',
            description: stats.checkedIn >= 3
                ? `${stats.checkedIn} Events eingecheckt`
                : `${stats.checkedIn}/3 Events eingecheckt`,
            icon: 'bi-check-all',
            color: '#06b6d4',
            unlocked: stats.checkedIn >= 3,
            progress: Math.min(stats.checkedIn / 3, 1)
        });

        // 🎯 Streak Master — 3+ consecutive accepted events (by start date)
        const acceptedRegs = registrations
            .filter(r => r.status === 'accepted' && r.event?.startDate)
            .sort((a, b) => new Date(a.event.startDate) - new Date(b.event.startDate));
        let maxStreak = 0;
        let currentStreak = 0;
        for (let i = 0; i < acceptedRegs.length; i++) {
            if (i === 0) {
                currentStreak = 1;
            } else {
                const prev = new Date(acceptedRegs[i - 1].event.startDate);
                const curr = new Date(acceptedRegs[i].event.startDate);
                const daysDiff = (curr - prev) / (1000 * 60 * 60 * 24);
                currentStreak = daysDiff <= 30 ? currentStreak + 1 : 1;
            }
            maxStreak = Math.max(maxStreak, currentStreak);
        }
        badges.push({
            id: 'streak-master',
            name: 'Streak Master',
            description: maxStreak >= 3
                ? `${maxStreak} Events in Folge`
                : `${maxStreak}/3 Events in Folge`,
            icon: 'bi-bullseye',
            color: '#ef4444',
            unlocked: maxStreak >= 3,
            progress: Math.min(maxStreak / 3, 1)
        });

        // 🏅 Multitasker — 3+ simultaneously active registrations
        const activeRegs = ownWithEvents.filter(r =>
            ['accepted', 'pending'].includes(r.status) &&
            r.event?.startDate &&
            new Date(r.event.startDate) > new Date()
        );
        badges.push({
            id: 'multitasker',
            name: 'Multitasker',
            description: activeRegs.length >= 3
                ? `${activeRegs.length} aktive Registrierungen`
                : `${activeRegs.length}/3 aktive Registrierungen`,
            icon: 'bi-stack',
            color: '#8b5cf6',
            unlocked: activeRegs.length >= 3,
            progress: Math.min(activeRegs.length / 3, 1)
        });

        // ── Lists of the profile page ────────────────────────────
        // Place on the waitlist (W-05): one read per active event the member waits for; never for a guest place
        const waitlistPositionsById = new Map();
        for (const registration of participations) {
            if (registration.asGuest || registration.status !== 'waitlisted' || eventsById.get(registration.eventId)?.status !== 'active') continue;
            const position = waitlistPositions(await loadEventRegistrations(registration.eventId)).get(registration.id);
            if (position) waitlistPositionsById.set(registration.id, position);
        }
        const { upcoming, history } = buildProfileEvents(participations, eventsById, new Date(), waitlistPositionsById);

        res.json({
            user: {
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                avatar: user.avatar
            },
            upcoming,
            history,
            stats,
            badges,
            unlockedBadges: badges.filter(b => b.unlocked).length,
            totalBadges: badges.length
        });

    } catch (err) {
        console.error('Error fetching user profile:', err);
        res.status(500).json({ error: 'Fehler beim Laden des Profils' });
    }
});

/**
 * GET /api/users/search?q=... — Search registered users by name
 * Only returns users who accept invitations
 */
// Per member: typing a name searches on every key, but listing the whole member
// base by brute force should take a while (pentest recommendation)
const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: (req) => req.session.user.id,
    message: { error: 'Zu viele Suchanfragen. Bitte warte einen Moment.' },
    standardHeaders: true,
    legacyHeaders: false
});

router.get('/search', requireAuth, searchLimiter, async (req, res) => {
    try {
        const q = (req.query.q || '').toLowerCase().trim();
        if (!q || q.length < 2) {
            return res.json([]);
        }

        const snap = await getDocs(collection(db, 'users'));
        const currentUserId = req.session.user.id;
        const results = [];

        snap.forEach(docSnap => {
            const user = docSnap.data();
            // Skip self and users who disabled invitations
            if (user.id === currentUserId) return;
            if (user.acceptInvitations === false) return;

            const nameMatch = (user.displayName || '').toLowerCase().includes(q);
            const usernameMatch = (user.username || '').toLowerCase().includes(q);
            if (nameMatch || usernameMatch) {
                results.push({
                    id: user.id,
                    username: user.username,
                    displayName: user.displayName,
                    avatar: user.avatar
                });
            }
        });

        res.json(results.slice(0, 10));
    } catch (err) {
        console.error('User search error:', err);
        res.status(500).json({ error: 'Fehler bei der Suche' });
    }
});

/**
 * Settings as the API answers them: invitations and the DM choices (W-16), missing values on.
 *
 * @param {Object} [data] -> Stored users document.
 * @returns {{ acceptInvitations: boolean, notifications: Object }}
 */
function settingsOf(data = {}) {
    return { acceptInvitations: data.acceptInvitations !== false, notifications: normalizeNotificationPrefs(data.notifications) };
}

/**
 * GET /api/user/settings — Get current user's account settings
 */
router.get('/settings', requireAuth, async (req, res) => {
    try {
        const userSnap = await getDoc(doc(db, 'users', req.session.user.id));
        res.json(settingsOf(userSnap.exists() ? userSnap.data() : {}));
    } catch (err) {
        console.error('Error fetching user settings:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Einstellungen' });
    }
});

/**
 * PUT /api/user/settings — Update account settings
 *
 * Changes only what the body sends as a boolean: `acceptInvitations` and the
 * DM kinds in `notifications` (W-16); everything else stays as stored.
 */
router.put('/settings', requireAuth, async (req, res) => {
    try {
        const userRef = doc(db, 'users', req.session.user.id);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
            return res.status(404).json({ error: 'User nicht gefunden' });
        }
        const stored = userSnap.data();
        const updated = { ...stored, updatedAt: new Date().toISOString() };
        if (typeof req.body.acceptInvitations === 'boolean') updated.acceptInvitations = req.body.acceptInvitations;
        const sent = req.body.notifications && typeof req.body.notifications === 'object' ? req.body.notifications : {};
        const choices = NOTIFICATION_KINDS.filter(kind => typeof sent[kind] === 'boolean');
        if (choices.length > 0) {
            updated.notifications = { ...normalizeNotificationPrefs(stored.notifications), ...Object.fromEntries(choices.map(kind => [kind, sent[kind]])) };
        }
        await setDoc(userRef, updated);
        res.json(settingsOf(updated));
    } catch (err) {
        console.error('Error updating user settings:', err);
        res.status(500).json({ error: 'Fehler beim Speichern der Einstellungen' });
    }
});

/**
 * DELETE /api/user/account — Delete user account and all registrations
 */
router.delete('/account', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const batch = writeBatch(db);

        // Delete all registrations
        const regQ = query(collection(db, 'registrations'), where('userId', '==', userId));
        const regSnap = await getDocs(regQ);
        const touchedEventIds = new Set();
        const freedEventIds = new Set();
        regSnap.forEach(regDoc => {
            const registration = regDoc.data();
            batch.delete(regDoc.ref);
            touchedEventIds.add(registration.eventId);
            if (OCCUPYING_STATUSES.includes(registration.status)) freedEventIds.add(registration.eventId);
        });

        // Delete user document
        batch.delete(doc(db, 'users', userId));
        await batch.commit();

        // Freed places go to the waitlist; announcements show the new numbers
        for (const eventId of touchedEventIds) {
            try {
                if (freedEventIds.has(eventId)) {
                    const eventSnap = await getDoc(doc(db, 'events', eventId));
                    if (eventSnap.exists()) await promoteFromWaitlist(eventId, eventSnap.data());
                }
                notifyRegistrationsChanged(eventId);
            } catch (followUpErr) {
                console.error('Follow-up after account deletion failed:', followUpErr.message);
            }
        }

        // Votes of date polls belong to the account as well
        try {
            await deleteUserPollVotes(userId);
        } catch (pollErr) {
            console.error('Deleting poll votes failed:', pollErr.message);
        }

        // Destroy session
        req.session.destroy(() => {
            res.json({ success: true });
        });
    } catch (err) {
        console.error('Error deleting account:', err);
        res.status(500).json({ error: 'Fehler beim Löschen des Accounts' });
    }
});

module.exports = router;
