/**
 * Before 3.4.0, deleting an event left its comments behind, and members could
 * still read them under the deleted event's id (security report 2026-11).
 * Deleting an event now deletes its comments; this step removes the ones left
 * from earlier deletions. Safe to run twice: a second run finds nothing.
 */
module.exports = {
    id: '001-remove-orphan-comments',
    description: 'Kommentare gelöschter Events entfernen',
    async up({ db, collection, doc, getDocs, deleteDoc }) {
        const eventIds = new Set((await getDocs(collection(db, 'events'))).docs.map((snap) => snap.id));
        const orphans = (await getDocs(collection(db, 'comments'))).docs.filter((snap) => !eventIds.has(snap.data().eventId));
        for (const snap of orphans) await deleteDoc(doc(db, 'comments', snap.id));
    }
};
