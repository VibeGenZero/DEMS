/**
 * The simulated Discord server of the dev mock mode.
 *
 * All IDs look like Discord snowflakes (18 digits), so code that works with
 * them - e.g. the avatar fallback `parseInt(id) % 5` - behaves like with real
 * data. The personas are the accounts offered on the dev login page, the
 * members fill participant lists and the guest search.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const GUILD = { id: '100000000000000000', name: 'DEMS Dev Server', memberCount: 42 };

const ROLE_ID = {
    ADMIN: '110000000000000001',
    MODERATOR: '110000000000000002',
    MEMBER: '110000000000000003',
    RAID_TEAM: '110000000000000004',
    VIP: '110000000000000005',
    BOT: '110000000000000006',
    // Handed out to accepted participants of some seed events, taken back after them (B-10)
    EVENT: '110000000000000007'
};

// Highest position first, like getGuildRoles() returns them
const ROLES = [
    { id: ROLE_ID.BOT, name: 'DEMS Bot', color: 0x5865f2, managed: true },
    { id: ROLE_ID.ADMIN, name: 'Admin', color: 0xef4444, managed: false },
    { id: ROLE_ID.MODERATOR, name: 'Moderator', color: 0xf59e0b, managed: false },
    { id: ROLE_ID.RAID_TEAM, name: 'Raid-Team', color: 0x22c55e, managed: false },
    { id: ROLE_ID.VIP, name: 'VIP', color: 0xa855f7, managed: false },
    { id: ROLE_ID.EVENT, name: 'Event-Teilnehmer', color: 0x14b8a6, managed: false },
    { id: ROLE_ID.MEMBER, name: 'Mitglied', color: 0x3b82f6, managed: false }
];

const CHANNEL_ID = {
    GENERAL: '120000000000000001',
    ANNOUNCEMENTS: '120000000000000002',
    EVENTS: '120000000000000003',
    LOBBY: '120000000000000004',
    EVENT_VOICE: '120000000000000005',
    STAGE: '120000000000000006',
    FORUM: '120000000000000007',
    MOD_INTERNAL: '120000000000000008'
};

// `type` uses the simplified format of bot.js ('text' | 'voice');
// `isPublic` decides whether getPublicGuildChannels() offers the channel
const CHANNELS = [
    { id: CHANNEL_ID.GENERAL, name: 'allgemein', type: 'text', isPublic: true },
    { id: CHANNEL_ID.ANNOUNCEMENTS, name: 'ankündigungen', type: 'text', isPublic: true },
    { id: CHANNEL_ID.EVENTS, name: 'events', type: 'text', isPublic: true },
    { id: CHANNEL_ID.LOBBY, name: 'Lobby', type: 'voice', isPublic: true },
    { id: CHANNEL_ID.EVENT_VOICE, name: 'Event-Voice', type: 'voice', isPublic: true },
    { id: CHANNEL_ID.STAGE, name: 'Bühne', type: 'voice', isPublic: true },
    { id: CHANNEL_ID.FORUM, name: 'forum', type: 'text', isPublic: true },
    { id: CHANNEL_ID.MOD_INTERNAL, name: 'mod-intern', type: 'text', isPublic: false }
];

// Accounts offered on the dev login page
const PERSONAS = [
    {
        id: 'admin', userId: '200000000000000001', username: 'mori', displayName: 'Mori (Admin)',
        roles: [ROLE_ID.ADMIN, ROLE_ID.MEMBER], description: 'Admin-Bereich, Bot-Zentrale, Wartung', isNewcomer: false
    },
    {
        id: 'raider', userId: '200000000000000002', username: 'lena', displayName: 'Lena',
        roles: [ROLE_ID.MEMBER, ROLE_ID.RAID_TEAM], description: 'Mitglied mit Rolle Raid-Team', isNewcomer: false
    },
    {
        id: 'member', userId: '200000000000000003', username: 'tom', displayName: 'Tom',
        roles: [ROLE_ID.MEMBER], description: 'Mitglied ohne Sonderrollen', isNewcomer: false
    },
    {
        id: 'newbie', userId: '200000000000000004', username: 'neo', displayName: 'Neo (Neuling)',
        roles: [], description: 'Erster Login, noch kein Profil', isNewcomer: true
    }
];

// Further members of the mock server -> participants, commenters, guests
const MEMBERS = [
    { userId: '200000000000000011', username: 'kira', displayName: 'Kira', roles: [ROLE_ID.MEMBER, ROLE_ID.RAID_TEAM] },
    { userId: '200000000000000012', username: 'jonas', displayName: 'Jonas', roles: [ROLE_ID.MEMBER] },
    { userId: '200000000000000013', username: 'aylin', displayName: 'Aylin', roles: [ROLE_ID.MEMBER, ROLE_ID.VIP] },
    { userId: '200000000000000014', username: 'ben', displayName: 'Ben', roles: [ROLE_ID.MEMBER, ROLE_ID.RAID_TEAM] },
    { userId: '200000000000000015', username: 'chiara', displayName: 'Chiara', roles: [ROLE_ID.MEMBER, ROLE_ID.MODERATOR] },
    { userId: '200000000000000016', username: 'dennis', displayName: 'Dennis', roles: [ROLE_ID.MEMBER, ROLE_ID.RAID_TEAM] },
    { userId: '200000000000000017', username: 'elif', displayName: 'Elif', roles: [ROLE_ID.MEMBER] },
    { userId: '200000000000000018', username: 'felix', displayName: 'Felix', roles: [ROLE_ID.MEMBER, ROLE_ID.RAID_TEAM] },
    { userId: '200000000000000019', username: 'greta', displayName: 'Greta', roles: [ROLE_ID.MEMBER] }
];

/**
 * Find a persona or member of the mock server.
 *
 * @param {string} userId -> Discord user ID.
 * @returns {Object|null} -> Persona or member, null when unknown.
 */
function findMember(userId) {
    return [...PERSONAS, ...MEMBERS].find(member => member.userId === userId) || null;
}

/**
 * Discord's default avatar for a user without an own avatar.
 *
 * @param {string} userId -> Numeric Discord user ID.
 * @returns {string} -> URL of the default avatar.
 */
function defaultAvatar(userId) {
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) % 5n)}.png`;
}

/**
 * Scheduled events offered by the Discord import of the admin area.
 *
 * @param {Date} now -> Reference time, the events lie in the future of it.
 * @returns {Array<Object>} -> Events in the format of getGuildScheduledEvents().
 */
function buildScheduledEvents(now) {
    const scheduled = (id, name, description, inDays, durationHours, location) => {
        const start = now.getTime() + inDays * DAY;
        return {
            id,
            name,
            description,
            scheduledStartTimestamp: start,
            scheduledEndTimestamp: start + durationHours * HOUR,
            image: null,
            location,
            url: `https://discord.com/events/${GUILD.id}/${id}`
        };
    };

    return [
        scheduled('130000000000000001', 'Community-Quiz', 'Quizabend mit Preisen für die besten drei Teams.', 4, 2, 'Discord'),
        scheduled('130000000000000002', 'Turnier-Qualifikation', 'Qualifikationsrunde für das Herbstturnier.', 12, 4, 'Event-Voice')
    ];
}

module.exports = {
    GUILD,
    ROLE_ID,
    ROLES,
    CHANNEL_ID,
    CHANNELS,
    PERSONAS,
    MEMBERS,
    findMember,
    defaultAvatar,
    buildScheduledEvents
};
