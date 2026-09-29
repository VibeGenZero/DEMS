const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');

/**
 * Create or refresh the users document after a login.
 *
 * Shared by the Discord OAuth2 callback and the persona login of the dev
 * mock mode, so both store the same profile fields.
 *
 * @param {Object} profile -> `{ id, username, displayName, avatar }` of the user.
 * @returns {Promise<boolean>} -> True when the document was created just now.
 */
async function saveUserProfile({ id, username, displayName, avatar }) {
    const userRef = doc(db, 'users', id);
    const snap = await getDoc(userRef);
    const now = new Date().toISOString();

    if (!snap.exists()) {
        await setDoc(userRef, { id, username, displayName, avatar, acceptInvitations: true, createdAt: now, updatedAt: now });
        return true;
    }
    await setDoc(userRef, { ...snap.data(), username, displayName, avatar, updatedAt: now });
    return false;
}

module.exports = { saveUserProfile };
