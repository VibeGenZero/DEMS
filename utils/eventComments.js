/**
 * Comments go with their event: deleting an event (or a series) deletes its
 * comments, so a deleted event leaves no thread behind that members could
 * still read under its id (security report 2026-11).
 */
const { db, collection, doc, getDocs, query, where, deleteDoc } = require('../firebaseAdmin');

/**
 * Delete every comment of an event.
 *
 * @param {string} eventId -> Id of the event.
 * @returns {Promise<number>} -> Number of deleted comments.
 */
async function deleteEventComments(eventId) {
    const snapshot = await getDocs(query(collection(db, 'comments'), where('eventId', '==', eventId)));
    await Promise.all(snapshot.docs.map(docSnap => deleteDoc(doc(db, 'comments', docSnap.id))));
    return snapshot.size;
}

module.exports = { deleteEventComments };
