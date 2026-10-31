/**
 * Data side of the comment ↔ thread sync (B-16), without discord.js: the
 * switch, which event a Discord thread belongs to, how a Discord message reads
 * as a comment and how a website comment is named in Discord. Used by
 * bot/threadSync.js, its twins in dev/mockBot.js and the comment routes.
 */
const { db, collection, doc, getDoc, getDocs, updateDoc, query, where } = require('../firebaseAdmin');

// Same limit as POST /api/events/:id/comments
const COMMENT_MAX_LENGTH = 1000;
// Discord's limit for a webhook username
const WEBHOOK_NAME_MAX_LENGTH = 80;
const WEB_SUFFIX = ' (Web)';

// threadId -> eventId; checked against the stored event on every hit
const threadEvents = new Map();

/**
 * Whether comments and discussion threads are mirrored.
 *
 * @returns {boolean} -> True only with DISCORD_THREAD_SYNC=true (the bot then needs the Message Content intent).
 */
function isThreadSyncEnabled() {
    return process.env.DISCORD_THREAD_SYNC === 'true';
}

/**
 * Cut a text to the comment limit without splitting a surrogate pair.
 *
 * @param {string} text -> Any text.
 * @returns {string} -> At most COMMENT_MAX_LENGTH characters, ending with "…" when cut.
 */
function fitComment(text) {
    if (text.length <= COMMENT_MAX_LENGTH) return text;
    let cut = text.slice(0, COMMENT_MAX_LENGTH - 1);
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    return `${cut}…`;
}

/**
 * Text of a Discord message as a comment.
 *
 * @param {Object} message
 * @param {string} [message.content] -> Raw Discord content.
 * @param {Object} [message.names] -> `{ users, roles, channels }`, each `{ [id]: name }`, for the mentions.
 * @param {string[]} [message.attachments] -> Attachment URLs, one line each.
 * @returns {string} -> Readable text cut to the comment limit; '' when there is nothing to show.
 * @example
 * formatDiscordContent({ content: '<@1> schau', names: { users: { 1: 'Lena' } } }) // '@Lena schau'
 */
function formatDiscordContent({ content = '', names = {}, attachments = [] } = {}) {
    const users = names.users || {};
    const roles = names.roles || {};
    const channels = names.channels || {};
    const text = String(content || '')
        .replace(/<@!?(\d+)>/g, (_, id) => `@${users[id] || 'unbekannt'}`)
        .replace(/<@&(\d+)>/g, (_, id) => `@${roles[id] || 'unbekannt'}`)
        .replace(/<#(\d+)>/g, (_, id) => `#${channels[id] || 'unbekannt'}`)
        .replace(/<a?:(\w+):\d+>/g, (_, name) => `:${name}:`)
        .trim();
    const lines = [text, ...attachments.filter(Boolean)].filter(Boolean);
    return fitComment(lines.join('\n'));
}

/**
 * Name of a website comment in Discord.
 *
 * @param {string} displayName -> Name of the commenting member.
 * @returns {string} -> "<name> (Web)", at most 80 characters; Discord refuses "discord" in webhook names.
 */
function webhookName(displayName) {
    const name = String(displayName || '').replace(/discord/gi, '').replace(/\s+/g, ' ').trim() || 'Mitglied';
    return `${name.slice(0, WEBHOOK_NAME_MAX_LENGTH - WEB_SUFFIX.length).trim()}${WEB_SUFFIX}`;
}

/**
 * Comment a reply belongs to; replies are one level deep like on the event page.
 *
 * @param {{ id: string, replyTo?: string|null }} comment -> The answered comment.
 * @returns {string} -> Its own id, or the id of its top comment.
 */
function topLevelReplyTarget(comment) {
    return comment.replyTo || comment.id;
}

/**
 * The event whose discussion thread this is.
 *
 * @param {string} threadId -> Discord thread id.
 * @returns {Promise<{ id: string, event: Object }|null>} -> The event, or null for any other thread.
 */
async function findEventByThreadId(threadId) {
    const cachedId = threadEvents.get(threadId);
    if (cachedId) {
        const snap = await getDoc(doc(db, 'events', cachedId));
        if (snap.exists() && snap.data().discordThread?.threadId === threadId) return { id: cachedId, event: snap.data() };
        threadEvents.delete(threadId);
    }
    const snapshot = await getDocs(collection(db, 'events'));
    const match = snapshot.docs.find(eventDoc => eventDoc.data().discordThread?.threadId === threadId);
    if (!match) return null;
    threadEvents.set(threadId, match.id);
    return { id: match.id, event: match.data() };
}

/**
 * The comment mirrored from or to a Discord message.
 *
 * @param {string} messageId -> Discord message id.
 * @returns {Promise<{ id: string, data: Object }|null>}
 */
async function commentByDiscordMessageId(messageId) {
    if (!messageId) return null;
    const snapshot = await getDocs(query(collection(db, 'comments'), where('discordMessageId', '==', messageId)));
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, data: snapshot.docs[0].data() };
}

/**
 * Remember the Discord message of a website comment.
 *
 * @param {string} commentId -> Comment document id.
 * @param {string} messageId -> Discord message id.
 * @returns {Promise<void>}
 */
async function storeDiscordMessageId(commentId, messageId) {
    await updateDoc(doc(db, 'comments', commentId), { discordMessageId: messageId });
}

/**
 * A comment and the event it belongs to.
 *
 * @param {string} commentId -> Comment document id.
 * @returns {Promise<{ comment: Object, event: Object }|null>} -> Null when either is missing.
 */
async function loadCommentWithEvent(commentId) {
    const commentSnap = await getDoc(doc(db, 'comments', commentId));
    if (!commentSnap.exists()) return null;
    const comment = { id: commentId, ...commentSnap.data() };
    const eventSnap = await getDoc(doc(db, 'events', comment.eventId));
    if (!eventSnap.exists()) return null;
    return { comment, event: eventSnap.data() };
}

/**
 * The comment a website reply answers, when it exists.
 *
 * @param {string|null} replyTo -> Comment id.
 * @returns {Promise<Object|null>} -> `{ id, ...data }` or null.
 */
async function loadAnsweredComment(replyTo) {
    if (!replyTo) return null;
    const snap = await getDoc(doc(db, 'comments', replyTo));
    return snap.exists() ? { id: replyTo, ...snap.data() } : null;
}

module.exports = {
    COMMENT_MAX_LENGTH,
    isThreadSyncEnabled,
    formatDiscordContent,
    webhookName,
    topLevelReplyTarget,
    findEventByThreadId,
    commentByDiscordMessageId,
    storeDiscordMessageId,
    loadCommentWithEvent,
    loadAnsweredComment
};
