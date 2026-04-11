const express = require('express');
const router = express.Router();
const { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, orderBy, writeBatch } = require('../firebaseAdmin');
const { requireAuth } = require('../middleware/auth');
const { debugLog } = require('../utils/debugLog');

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
        // Firestore 'in' queries support max 30 items per batch
        for (let i = 0; i < eventIdArr.length; i += 30) {
            const batch = eventIdArr.slice(i, i + 30);
            for (const eid of batch) {
                try {
                    const eventSnap = await getDoc(doc(db, 'events', eid));
                    if (eventSnap.exists()) {
                        eventMap.set(eid, { id: eventSnap.id, ...eventSnap.data() });
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
 * GET /api/user/profile — Full profile: registrations + stats + badges
 */
router.get('/profile', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;

        // ── Fetch registrations ──────────────────────────────────
        const regQ = query(
            collection(db, 'registrations'),
            where('userId', '==', user.id)
        );
        const regSnap = await getDocs(regQ);
        debugLog('user.getProfile', { userId: req.session?.user?.id });

        // Batch-load events
        const eventIds = new Set();
        regSnap.docs.forEach(d => {
            if (d.data().eventId) eventIds.add(d.data().eventId);
        });

        const eventMap = new Map();
        for (const eid of eventIds) {
            try {
                const eventSnap = await getDoc(doc(db, 'events', eid));
                if (eventSnap.exists()) {
                    eventMap.set(eid, { id: eventSnap.id, ...eventSnap.data() });
                }
            } catch { /* event may have been deleted */ }
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

        // ── Compute stats ────────────────────────────────────────
        const stats = {
            total: registrations.length,
            accepted: 0,
            pending: 0,
            rejected: 0,
            waitlisted: 0,
            checkedIn: 0
        };

        registrations.forEach(r => {
            if (r.status === 'accepted') stats.accepted++;
            else if (r.status === 'pending') stats.pending++;
            else if (r.status === 'rejected') stats.rejected++;
            else if (r.status === 'waitlisted') stats.waitlisted++;
            if (r.checkedIn) stats.checkedIn++;
        });

        // ── Compute badges ───────────────────────────────────────
        const badges = [];

        // 🌱 Newcomer — first registration
        if (registrations.length >= 1) {
            badges.push({
                id: 'newcomer',
                name: 'Newcomer',
                description: 'Erste Registrierung',
                icon: 'bi-seedling',
                color: '#22c55e',
                unlocked: true
            });
        } else {
            badges.push({
                id: 'newcomer',
                name: 'Newcomer',
                description: 'Registriere dich für ein Event',
                icon: 'bi-seedling',
                color: '#22c55e',
                unlocked: false
            });
        }

        // ⚡ Early Bird — registered within 1h of event creation
        const hasEarlyBird = registrations.some(r => {
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
        const activeRegs = registrations.filter(r =>
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

        res.json({
            user: {
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                avatar: user.avatar
            },
            registrations,
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
router.get('/search', requireAuth, async (req, res) => {
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
 * GET /api/user/settings — Get current user's account settings
 */
router.get('/settings', requireAuth, async (req, res) => {
    try {
        const userRef = doc(db, 'users', req.session.user.id);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
            return res.json({ acceptInvitations: true });
        }
        const data = userSnap.data();
        res.json({ acceptInvitations: data.acceptInvitations !== false });
    } catch (err) {
        console.error('Error fetching user settings:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Einstellungen' });
    }
});

/**
 * PUT /api/user/settings — Update account settings
 */
router.put('/settings', requireAuth, async (req, res) => {
    try {
        const { acceptInvitations } = req.body;
        const userRef = doc(db, 'users', req.session.user.id);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
            return res.status(404).json({ error: 'User nicht gefunden' });
        }
        await setDoc(userRef, {
            ...userSnap.data(),
            acceptInvitations: acceptInvitations !== false,
            updatedAt: new Date().toISOString()
        });
        res.json({ success: true });
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
        regSnap.forEach(regDoc => batch.delete(regDoc.ref));

        // Delete user document
        batch.delete(doc(db, 'users', userId));
        await batch.commit();

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
