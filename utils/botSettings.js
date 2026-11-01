/**
 * Settings of the bot control center (B-02): defaults for every key, one
 * cached copy for the process, and the gate for automatic DMs.
 *
 * The cache is exact because DEMS runs as one process: every save goes
 * through bot.js#saveBotSettings, which calls rememberBotSettings().
 * Database only; Discord calls stay in bot.js.
 */
const { db, collection, doc, getDoc, getDocs, query, where, updateDoc } = require('../firebaseAdmin');

const DEFAULT_BOT_SETTINGS = Object.freeze({
    statusType: 'online',
    activityType: 'WATCHING',
    activityText: '',
    dmNotifications: true,
    reminderEnabled: true,
    eventStartNotifications: true,
    autoChannelCreation: true,
    announcementThreads: true,
    autoUpdatePresence: false,
    autoStatusCalendarEvents: false,
    announceChannel: '',
    // Channel for approval requests (B-06); empty -> approvals only on the website
    approvalChannel: '',
    welcomeMessage: '',
    // A freed waitlist place is offered and must be confirmed within the period (B-15)
    waitlistConfirmation: true,
    waitlistConfirmHours: 12
});

// Allowed confirmation period in hours (B-15)
const CONFIRM_HOURS_MIN = 1;
const CONFIRM_HOURS_MAX = 72;

/**
 * Whether a value is a whole number of hours the confirmation period allows.
 *
 * @param {*} value -> Stored or submitted value.
 * @returns {boolean}
 */
function isValidConfirmHours(value) {
    return Number.isInteger(value) && value >= CONFIRM_HOURS_MIN && value <= CONFIRM_HOURS_MAX;
}

// Switches that are on unless stored as false / off unless stored as true (same rules as PUT /bot/settings)
const ON_BY_DEFAULT = ['dmNotifications', 'reminderEnabled', 'eventStartNotifications', 'autoChannelCreation', 'announcementThreads', 'waitlistConfirmation'];
const OFF_BY_DEFAULT = ['autoUpdatePresence', 'autoStatusCalendarEvents'];

let cached = null;

/**
 * Defaults merged with the stored keys.
 *
 * @param {Object|null} raw -> Stored document or a settings object.
 * @returns {Object} -> Every setting with a value; unknown keys (updatedAt) stay.
 */
function normalizeBotSettings(raw) {
    const stored = raw && typeof raw === 'object' ? raw : {};
    const settings = { ...DEFAULT_BOT_SETTINGS, ...stored };
    for (const key of ON_BY_DEFAULT) settings[key] = stored[key] !== false;
    for (const key of OFF_BY_DEFAULT) settings[key] = !!stored[key];
    for (const key of ['statusType', 'activityType']) settings[key] = stored[key] || DEFAULT_BOT_SETTINGS[key];
    for (const key of ['activityText', 'announceChannel', 'welcomeMessage']) settings[key] = typeof stored[key] === 'string' ? stored[key] : '';
    settings.waitlistConfirmHours = isValidConfirmHours(stored.waitlistConfirmHours)
        ? stored.waitlistConfirmHours
        : DEFAULT_BOT_SETTINGS.waitlistConfirmHours;
    return settings;
}

async function readStoredSettings() {
    const snap = await getDoc(doc(db, 'botSettings', 'config'));
    return snap.exists() ? snap.data() : null;
}

/**
 * The current settings; read from the database once, then from memory.
 *
 * @param {Object} [options] -> `{ read }` replaces the database read (tests).
 * @returns {Promise<Object>} -> Normalized settings; the defaults after a read error.
 */
async function loadBotSettings({ read = readStoredSettings } = {}) {
    if (cached) return cached;
    try {
        cached = normalizeBotSettings(await read());
        return cached;
    } catch (err) {
        console.error('Bot-Einstellungen konnten nicht gelesen werden:', err.message);
        return normalizeBotSettings(null);
    }
}

/** Replace the cached settings after a save. */
function rememberBotSettings(settings) {
    cached = normalizeBotSettings(settings);
}

/** Drop the cache, so the next read goes to the database (tests). */
function forgetBotSettings() {
    cached = null;
}

/**
 * Send a DM the bot sends on its own (status, waitlist, guests, changes, polls,
 * welcome) — only while "DM-Benachrichtigungen" is on. Admin-triggered messages
 * (cancellation, "Nachricht an Teilnehmer") call bot.sendDM directly.
 *
 * @param {string} userId -> Discord user id.
 * @param {string|Object} message -> DM content.
 * @returns {Promise<boolean>} -> True when sent.
 */
async function sendAutomaticDM(userId, message) {
    const { dmNotifications } = await loadBotSettings();
    if (!dmNotifications) return false;
    // Required late: bot.js requires utils that require this module (and mock mode swaps sendDM)
    return require('../bot').sendDM(userId, message);
}

/**
 * Channel for event and poll announcements.
 *
 * @param {Object} settings -> Normalized settings.
 * @returns {string} -> Bot center choice, else DISCORD_ANNOUNCE_CHANNEL_ID, else ''.
 */
function announceChannelId(settings) {
    return (settings && settings.announceChannel) || process.env.DISCORD_ANNOUNCE_CHANNEL_ID || '';
}

/**
 * Send the welcome message of the bot center when a member is accepted for
 * the first time ever (B-02). A member counts as welcomed when the profile has
 * `welcomeSentAt` or another of their registrations is accepted, so members
 * accepted before the message existed never get it. The flag is written before
 * the DM, like the reminder flags. Never throws.
 *
 * @param {Object} user -> `{ id, displayName }`.
 * @param {string|null} registrationId -> The registration that was just accepted.
 * @returns {Promise<boolean>} -> True when the welcome was sent.
 */
async function sendWelcomeOnce(user, registrationId) {
    try {
        const { welcomeMessage, dmNotifications } = await loadBotSettings();
        const text = (welcomeMessage || '').trim();
        if (!text || !dmNotifications || !user || !user.id) return false;

        const profileRef = doc(db, 'users', user.id);
        const profile = await getDoc(profileRef);
        if (!profile.exists() || profile.data().welcomeSentAt) return false;
        const registrations = await getDocs(query(collection(db, 'registrations'), where('userId', '==', user.id)));
        if (registrations.docs.some(entry => entry.id !== registrationId && entry.data().status === 'accepted')) return false;

        await updateDoc(profileRef, { welcomeSentAt: new Date().toISOString() });
        const name = user.displayName || profile.data().displayName || profile.data().username || '';
        const message = text.split('{user.name}').join(name).split('{user.mention}').join(`<@${user.id}>`);
        return await require('../bot').sendDM(user.id, message);
    } catch (err) {
        console.error(`Willkommensnachricht an ${user && user.id} fehlgeschlagen:`, err.message);
        return false;
    }
}

/**
 * Where an announcement goes, or why it cannot be posted.
 *
 * @param {Object} settings -> Normalized settings.
 * @returns {{ channelId: string } | { error: string }}
 */
function announceTarget(settings) {
    const channelId = announceChannelId(settings);
    return channelId ? { channelId } : { error: 'Kein Ankündigungskanal festgelegt – bitte in der Bot-Zentrale wählen.' };
}

module.exports = {
    isValidConfirmHours,
    sendWelcomeOnce,
    announceTarget,
    DEFAULT_BOT_SETTINGS,
    normalizeBotSettings,
    loadBotSettings,
    rememberBotSettings,
    forgetBotSettings,
    sendAutomaticDM,
    announceChannelId
};
