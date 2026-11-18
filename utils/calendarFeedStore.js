/**
 * Calendar subscriptions in the collection `calendarFeeds`, one document per
 * member (document id = Discord user id): `{ userId, token, createdAt }`.
 * Kept apart from `users`, so the secret never travels with user documents.
 */
const { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where } = require('../firebaseAdmin');
const { createFeedToken, isFeedToken } = require('./calendarFeed');

const COLLECTION = 'calendarFeeds';

/**
 * The feed of a member.
 *
 * @param {string} userId -> Discord user id.
 * @returns {Promise<Object|null>} -> `{ userId, token, createdAt }`, or null without a subscription.
 */
async function getFeedOf(userId) {
    const snap = await getDoc(doc(db, COLLECTION, userId));
    return snap.exists() ? snap.data() : null;
}

/**
 * Create a feed, or renew it with a new secret (the old link stops working).
 *
 * @param {string} userId -> Discord user id.
 * @param {Date} [now] -> Creation time.
 * @returns {Promise<Object>} -> The stored feed.
 */
async function saveNewFeed(userId, now = new Date()) {
    const feed = { userId, token: createFeedToken(), createdAt: now.toISOString() };
    await setDoc(doc(db, COLLECTION, userId), feed);
    return feed;
}

/**
 * End a member's feed; nothing happens without one.
 *
 * @param {string} userId -> Discord user id.
 * @returns {Promise<void>}
 */
async function deleteFeed(userId) {
    await deleteDoc(doc(db, COLLECTION, userId));
}

/**
 * The feed a link secret belongs to.
 *
 * @param {*} token -> Secret from the request path.
 * @returns {Promise<Object|null>} -> The feed, or null for an unknown or malformed secret.
 */
async function findFeedByToken(token) {
    if (!isFeedToken(token)) return null;
    const snapshot = await getDocs(query(collection(db, COLLECTION), where('token', '==', token)));
    const match = snapshot.docs.find(docSnap => docSnap.data().token === token);
    return match ? match.data() : null;
}

module.exports = { COLLECTION, getFeedOf, saveNewFeed, deleteFeed, findFeedByToken };
