const { db, collection, doc, getDocs, addDoc, updateDoc, query, where, orderBy } = require('../firebaseAdmin');
const { sendDM, assignRole } = require('../bot');

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

module.exports = { promoteFromWaitlist, addAuditLog };
