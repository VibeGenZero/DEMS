/**
 * Comment ↔ thread sync (B-16): website comments go into the event's Discord
 * discussion thread through a webhook the bot creates on the announcement
 * channel; thread messages, edits and deletions come back as comments. Runs
 * only with DISCORD_THREAD_SYNC=true (utils/threadSync.js). The webhook token
 * lives only in memory.
 */
const { db, collection, doc, addDoc, updateDoc, deleteDoc } = require('../firebaseAdmin');
const {
    webhookName, isThreadSyncEnabled, loadCommentWithEvent, loadAnsweredComment, storeDiscordMessageId,
    formatDiscordContent, findEventByThreadId, commentByDiscordMessageId, topLevelReplyTarget
} = require('../utils/threadSync');
const { client, state } = require('./client');
const { isGoneDiscordError } = require('./messages');

const WEBHOOK_NAME = 'DEMS Kommentare';
const UNKNOWN_WEBHOOK = 10015;

// channelId -> Webhook of the bot
const webhooks = new Map();

/**
 * Forget the cached webhooks (tests).
 */
function clearWebhookCache() {
    webhooks.clear();
}

/**
 * Link to a message in a thread.
 *
 * @param {{ guildId: string, threadId: string }} thread -> `event.discordThread`.
 * @param {string} messageId -> Discord message id.
 * @returns {string}
 */
function messageUrl(thread, messageId) {
    return `https://discord.com/channels/${thread.guildId}/${thread.threadId}/${messageId}`;
}

/**
 * Webhook post of a website comment.
 *
 * @param {Object} comment -> `{ text, userName, userAvatar }`.
 * @param {Object} event -> Event with `discordThread`.
 * @param {Object|null} [answered] -> The answered comment (`{ userName, discordMessageId? }`) of a reply.
 * @returns {Object} -> Options for `webhook.send`; never pings anybody.
 */
function buildThreadPost(comment, event, answered = null) {
    const thread = event.discordThread;
    let content = String(comment.text || '');
    if (answered) {
        const link = answered.discordMessageId ? ` · ${messageUrl(thread, answered.discordMessageId)}` : '';
        content = `-# ↪ Antwort an **${String(answered.userName || 'Mitglied')}**${link}\n${content}`;
    }
    const avatar = String(comment.userAvatar || '');
    return {
        content,
        username: webhookName(comment.userName),
        avatarURL: avatar.startsWith('https://') ? avatar : undefined,
        threadId: thread.threadId,
        allowedMentions: { parse: [] }
    };
}

/**
 * The bot's webhook in a channel: the cached one, an existing one the bot owns, or a new one.
 *
 * @param {Object} channel -> Text channel (discord.js).
 * @param {string} botUserId -> The bot's user id.
 * @returns {Promise<Object>} -> Webhook with a token.
 */
async function channelWebhook(channel, botUserId) {
    const cached = webhooks.get(channel.id);
    if (cached) return cached;
    const existing = [...(await channel.fetchWebhooks()).values()]
        .find(hook => hook.owner?.id === botUserId && hook.token);
    const webhook = existing || await channel.createWebhook({ name: WEBHOOK_NAME, reason: 'Kommentar-Sync mit der Website (B-16)' });
    webhooks.set(channel.id, webhook);
    return webhook;
}

/**
 * Run a webhook action; a webhook deleted in Discord is replaced once.
 *
 * @param {Object} channel -> Text channel (discord.js).
 * @param {string} botUserId -> The bot's user id.
 * @param {Function} action -> async (webhook) => result.
 * @returns {Promise<*>} -> The action's result.
 */
async function withWebhook(channel, botUserId, action) {
    try {
        return await action(await channelWebhook(channel, botUserId));
    } catch (err) {
        if (err.code !== UNKNOWN_WEBHOOK) throw err;
        webhooks.delete(channel.id);
        return action(await channelWebhook(channel, botUserId));
    }
}

/**
 * Post through the bot's webhook of a channel.
 *
 * @param {Object} channel -> Parent text channel of the thread.
 * @param {string} botUserId -> The bot's user id.
 * @param {Object} payload -> From buildThreadPost().
 * @returns {Promise<Object>} -> The sent message.
 */
function postWithWebhook(channel, botUserId, payload) {
    return withWebhook(channel, botUserId, webhook => webhook.send(payload));
}

/**
 * Parent text channel of an event's discussion thread.
 *
 * @param {string} threadId -> Discord thread id.
 * @returns {Promise<Object>} -> The channel that owns the webhook.
 */
async function threadParent(threadId) {
    const thread = await client.channels.fetch(threadId);
    return thread.parent || client.channels.fetch(thread.parentId);
}

/**
 * Post a website comment into its event's discussion thread.
 *
 * @param {string} commentId -> Comment document id.
 * @returns {Promise<string|null>} -> Discord message id; null without sync, bot, thread,
 *   for comments from Discord, already mirrored ones or when Discord refuses (logged).
 */
async function mirrorCommentToThread(commentId) {
    if (!state.isReady || !isThreadSyncEnabled()) return null;
    try {
        const loaded = await loadCommentWithEvent(commentId);
        if (!loaded) return null;
        const { comment, event } = loaded;
        if (!event.discordThread?.threadId || comment.source === 'discord' || comment.discordMessageId) return null;

        const answered = await loadAnsweredComment(comment.replyTo);
        const parent = await threadParent(event.discordThread.threadId);
        const message = await postWithWebhook(parent, client.user.id, buildThreadPost(comment, event, answered));
        await storeDiscordMessageId(commentId, message.id);
        return message.id;
    } catch (err) {
        console.error('Could not mirror the comment into the thread:', err.message);
        return null;
    }
}

/**
 * Remove the Discord message of a comment deleted on the website.
 *
 * @param {Object} comment -> The deleted comment's data (`source`, `discordMessageId`).
 * @param {Object|null} event -> Its event (`discordThread`).
 * @returns {Promise<boolean>} -> True when the message is gone; false without sync, bot, message
 *   or thread, and when Discord refuses (e.g. no "Nachrichten verwalten" for a member's message; logged).
 */
async function deleteMirroredMessage(comment, event) {
    if (!state.isReady || !isThreadSyncEnabled() || !comment?.discordMessageId || !event?.discordThread?.threadId) return false;
    const threadId = event.discordThread.threadId;
    try {
        if (comment.source === 'discord') {
            const thread = await client.channels.fetch(threadId);
            await thread.messages.delete(comment.discordMessageId);
        } else {
            const parent = await threadParent(threadId);
            await withWebhook(parent, client.user.id, webhook => webhook.deleteMessage(comment.discordMessageId, threadId));
        }
        return true;
    } catch (err) {
        if (isGoneDiscordError(err)) return true;
        console.error('Could not delete the thread message of a comment:', err.message);
        return false;
    }
}

/**
 * Names for the mentions of a message.
 *
 * @param {Object} mentions -> `message.mentions` (discord.js collections or Maps).
 * @returns {{ users: Object, roles: Object, channels: Object }} -> `{ [id]: name }` each.
 */
function mentionNames(mentions = {}) {
    const users = {};
    for (const [id, user] of mentions.users || []) {
        users[id] = mentions.members?.get?.(id)?.displayName || user.globalName || user.username;
    }
    const byName = (entries) => Object.fromEntries([...(entries || [])].map(([id, entry]) => [id, entry.name]));
    return { users, roles: byName(mentions.roles), channels: byName(mentions.channels) };
}

/**
 * Comment text of a Discord message.
 *
 * @param {Object} message -> discord.js message.
 * @returns {string} -> Readable text, '' when there is nothing to show.
 */
function commentText(message) {
    return formatDiscordContent({
        content: message.content,
        names: mentionNames(message.mentions),
        attachments: [...(message.attachments?.values?.() || [])].map(attachment => attachment.url)
    });
}

/**
 * Whether a message is a member's message that may become a comment.
 *
 * @param {Object} message -> discord.js message.
 * @returns {boolean} -> False for bots, webhooks (incl. the bot's own), system messages and non-threads.
 */
function isMirrorableMessage(message) {
    return Boolean(message && message.author && !message.author.bot && !message.webhookId && !message.system
        && message.channel?.isThread?.());
}

/**
 * A member's message in an event's discussion thread → comment on the event page.
 *
 * @param {Object} message -> discord.js message.
 * @returns {Promise<string|null>} -> New comment id; null when the message is not mirrored.
 */
async function handleThreadMessage(message) {
    if (!isThreadSyncEnabled() || !isMirrorableMessage(message)) return null;
    const found = await findEventByThreadId(message.channelId || message.channel.id);
    if (!found) return null;
    const text = commentText(message);
    if (!text || await commentByDiscordMessageId(message.id)) return null;

    const answered = await commentByDiscordMessageId(message.reference?.messageId);
    const member = message.member;
    const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
    const comment = {
        eventId: found.id,
        userId: message.author.id,
        userName: member?.displayName || message.author.globalName || message.author.username,
        userAvatar: member?.displayAvatarURL?.() || message.author.displayAvatarURL?.() || '',
        text,
        isAdmin: Boolean(adminRoleId && member?.roles?.cache?.has(adminRoleId)),
        replyTo: answered ? topLevelReplyTarget({ id: answered.id, ...answered.data }) : null,
        createdAt: (message.createdAt || new Date()).toISOString(),
        source: 'discord',
        discordMessageId: message.id
    };
    const ref = await addDoc(collection(db, 'comments'), comment);
    return ref.id;
}

/**
 * A Discord edit of a mirrored member message → new comment text.
 *
 * @param {Object|null} oldMessage -> Unused (may be partial).
 * @param {Object} newMessage -> discord.js message, fetched when partial.
 * @returns {Promise<string|null>} -> Updated comment id; null when nothing changed.
 */
async function handleThreadMessageUpdate(oldMessage, newMessage) {
    if (!isThreadSyncEnabled() || !newMessage) return null;
    const message = newMessage.partial ? await newMessage.fetch() : newMessage;
    // Only member messages; the bot's webhook copies of website comments stay as they are
    if (message.webhookId || message.author?.bot) return null;
    const found = await commentByDiscordMessageId(message.id);
    if (!found || found.data.source !== 'discord') return null;
    const text = commentText(message);
    // Empty text keeps the old one; the same text is e.g. a link preview being added
    if (!text || text === found.data.text) return null;
    await updateDoc(doc(db, 'comments', found.id), { text, editedAt: new Date().toISOString() });
    return found.id;
}

/**
 * A mirrored message deleted in Discord → its comment is deleted too.
 *
 * @param {Object} message -> discord.js message, may be partial (only the id is needed).
 * @returns {Promise<string|null>} -> Deleted comment id; null for any other message.
 */
async function handleThreadMessageDelete(message) {
    if (!isThreadSyncEnabled() || !message?.id) return null;
    const found = await commentByDiscordMessageId(message.id);
    if (!found) return null;
    await deleteDoc(doc(db, 'comments', found.id));
    return found.id;
}

module.exports = {
    mirrorCommentToThread,
    deleteMirroredMessage,
    handleThreadMessage,
    handleThreadMessageUpdate,
    handleThreadMessageDelete,
    buildThreadPost,
    postWithWebhook,
    withWebhook,
    clearWebhookCache,
    messageUrl
};
