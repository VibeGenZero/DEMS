/**
 * Entry point of the Discord bot. Routes, utils and the server require only
 * this file; the code lives in the area modules of bot/ (map in
 * docs/wiki/modules/bot.md). In dev mock mode dev/mockBot.js replaces the
 * Discord-facing exports at the end of this file.
 */
// Loaded before firebaseAdmin.js and the bot/ modules so the mock environment is in place
// even when bot.js is required without server.js (e.g. in tests)
const { IS_MOCK_MODE } = require('./dev/mockMode');
const { parseTemplate } = require('./utils/template');
const { wireClient, startBot, whenBotSettled, stopBot } = require('./bot/lifecycle');
const { client } = require('./bot/client');
const {
    sendDM, sendChannelMessage, buildEventAnnouncement, canRegisterViaDiscord,
    isGoneDiscordError, refreshEventAnnouncements
} = require('./bot/messages');
const { buildPollMessage, buildPollVoteReply, refreshPollMessages, markPollMessagesDeleted } = require('./bot/polls');
const { buildSlotModal, buildRegisteredSlotReply } = require('./bot/registrationModal');
const {
    assignRole, removeRole, getUserRoles, fetchMemberRoleIds, searchGuildMembers, fetchGuildMember,
    isGuildMember, getGuildName, getGuildIconUrl, getGuildRoles, getGuildChannels, getPublicGuildChannels
} = require('./bot/guild');
const {
    getGuildScheduledEvents, createScheduledEvent, createEventChannels, addParticipantToEventChannels,
    removeParticipantFromEventChannels, deleteEventChannels
} = require('./bot/channels');
const { checkReminders, startReminderScheduler } = require('./bot/scheduler');
const { getBotStatus, getBotSettings, saveBotSettings, getRunningEvents } = require('./bot/settings');
const { sendGuestInvitation } = require('./bot/guests');
const { buildAnnouncementIntro } = require('./bot/layout');
const { ensureAnnouncementThread } = require('./bot/threads');
const { sendApprovalRequest, closeApprovalRequest } = require('./bot/approvals');
const { sendCheckinInvitations } = require('./bot/checkin');
const { mirrorCommentToThread, deleteMirroredMessage } = require('./bot/threadSync');

// Ready, error and interaction listeners, attached once when the bot is loaded
wireClient();

module.exports = {
    client,
    startBot,
    whenBotSettled,
    stopBot,
    sendDM,
    sendChannelMessage,
    refreshEventAnnouncements,
    isGoneDiscordError,
    buildPollMessage,
    buildPollVoteReply,
    refreshPollMessages,
    markPollMessagesDeleted,
    buildSlotModal,
    buildRegisteredSlotReply,
    buildEventAnnouncement,
    assignRole,
    removeRole,
    getUserRoles,
    fetchMemberRoleIds,
    isGuildMember,
    searchGuildMembers,
    fetchGuildMember,
    getGuildName,
    getGuildIconUrl,
    getGuildRoles,
    getGuildChannels,
    getPublicGuildChannels,
    getGuildScheduledEvents,
    parseTemplate,
    startReminderScheduler,
    checkReminders,
    createEventChannels,
    addParticipantToEventChannels,
    removeParticipantFromEventChannels,
    deleteEventChannels,
    createScheduledEvent,
    getBotStatus,
    getBotSettings,
    saveBotSettings,
    getRunningEvents,
    sendGuestInvitation,
    canRegisterViaDiscord,
    buildAnnouncementIntro,
    ensureAnnouncementThread,
    sendApprovalRequest,
    closeApprovalRequest,
    sendCheckinInvitations,
    mirrorCommentToThread,
    deleteMirroredMessage
};

// Dev mock mode: every call that would reach Discord goes to the simulated
// server instead (see dev/mockBot.js)
if (IS_MOCK_MODE) Object.assign(module.exports, require('./dev/mockBot'));
