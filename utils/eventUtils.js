const { db, collection, doc, getDocs, addDoc, updateDoc, query, where } = require('../firebaseAdmin');
const { sendDM, assignRole } = require('../bot');
const { buildRoster } = require('./slotService');

/**
 * Promote the oldest waitlisted user when a spot opens
 */
async function promoteFromWaitlist(eventId, event) {
    try {
        // Check if there's room
        if (event.maxParticipants > 0) {
            const regQ = query(
                collection(db, 'registrations'),
                where('eventId', '==', eventId),
                where('status', 'in', ['pending', 'accepted'])
            );
            const regSnap = await getDocs(regQ);
            if (regSnap.size >= event.maxParticipants) return; // Still full
        }

        // Find oldest waitlisted (sort in memory to avoid composite index)
        const waitQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', eventId),
            where('status', '==', 'waitlisted')
        );
        const waitSnap = await getDocs(waitQ);
        if (waitSnap.empty) return;

        // Sort by createdAt in memory
        const waitDocs = waitSnap.docs.sort((a, b) => {
            const dateA = a.data().createdAt || '';
            const dateB = b.data().createdAt || '';
            return dateA.localeCompare(dateB);
        });

        const promotedDoc = waitDocs[0];
        const promoted = promotedDoc.data();
        const newStatus = event.approvalMode === 'instant' ? 'accepted' : 'pending';

        await updateDoc(doc(db, 'registrations', promotedDoc.id), { status: newStatus });

        if (newStatus === 'accepted') {
            await sendDM(promoted.userId,
                `🎉 Ein Platz wurde frei! Du wurdest von der Warteliste für **${event.title}** in die Teilnehmerliste aufgenommen!`
            );
            if (event.assignRoleId) {
                await assignRole(promoted.userId, event.assignRoleId, process.env.DISCORD_GUILD_ID);
            }
        } else {
            await sendDM(promoted.userId,
                `📋 Ein Platz wurde frei bei **${event.title}**! Deine Anfrage wird jetzt geprüft.`
            );
        }
        console.log(`Promoted user ${promoted.userId} from waitlist for event ${eventId}`);
    } catch (err) {
        console.error('Waitlist promotion error:', err.message);
    }
}

/**
 * Load every registration of an event.
 *
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<Array<Object>>} -> Registrations with their `id`.
 */
async function loadEventRegistrations(eventId) {
    const snapshot = await getDocs(query(collection(db, 'registrations'), where('eventId', '==', eventId)));
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
}

/**
 * Find the registration of one user for an event.
 *
 * @param {string} eventId -> The event document ID.
 * @param {string} userId -> Discord user ID.
 * @returns {Promise<Object|null>} -> The registration with its `id`, or null.
 */
async function findUserRegistration(eventId, userId) {
    const registrations = await loadEventRegistrations(eventId);
    return registrations.find(registration => registration.userId === userId) || null;
}

/**
 * Load the line-up of an event.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Object} event -> The event document data.
 * @param {Object} [options] -> Load options.
 * @param {boolean} [options.withProfiles] -> Also load user profiles for names and avatars.
 * @returns {Promise<Object>} -> Roster from buildRoster().
 */
async function loadEventRoster(eventId, event, { withProfiles = false } = {}) {
    const registrations = await loadEventRegistrations(eventId);
    const usersById = {};
    if (withProfiles) {
        const usersSnap = await getDocs(collection(db, 'users'));
        usersSnap.forEach(userDoc => { usersById[userDoc.id] = userDoc.data(); });
    }
    return buildRoster(event, registrations, usersById);
}

/**
 * Log admin action to auditing collection
 */
async function addAuditLog(action, adminId, details, targetId = null) {
    try {
        await addDoc(collection(db, 'auditLogs'), {
            action,
            adminId,
            details,
            targetId,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Audit log error:', err);
    }
}

module.exports = { promoteFromWaitlist, addAuditLog, loadEventRegistrations, findUserRegistration, loadEventRoster };
