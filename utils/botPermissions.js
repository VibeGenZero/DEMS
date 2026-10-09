/**
 * Discord permissions the bot needs, and the invite URL that asks for them.
 * Discord lets a bot grant only permissions it has itself, so everything the
 * bot allows in channel overwrites must be in this list as well.
 */
const { PermissionsBitField } = require('discord.js');

const { Flags } = PermissionsBitField;

const BOT_PERMISSIONS = [
    { flag: Flags.ManageRoles, reason: 'Rollen zuweisen/entfernen, Channel-Rechte setzen' },
    { flag: Flags.ManageChannels, reason: 'Event-Channels erstellen/löschen' },
    { flag: Flags.SendMessages, reason: 'Nachrichten in Channels senden' },
    { flag: Flags.SendMessagesInThreads, reason: 'Nachrichten in Threads senden' },
    { flag: Flags.EmbedLinks, reason: 'Rich Embeds senden' },
    { flag: Flags.MentionEveryone, reason: '@everyone und Rollen erwähnen' },
    { flag: Flags.ViewChannel, reason: 'Channels sehen' },
    { flag: Flags.ReadMessageHistory, reason: 'Nachrichtenverlauf lesen' },
    { flag: Flags.UseExternalEmojis, reason: 'Externe Emojis verwenden' },
    { flag: Flags.Connect, reason: 'Teilnehmern Zugang zu Event-Voice-Channels geben' },
    { flag: Flags.CreateEvents, reason: 'Server-Events anlegen („Mit Discord synchronisieren“)' }
];

/**
 * OAuth2 URL that adds the bot with every permission of BOT_PERMISSIONS.
 *
 * @param {string} clientId -> Discord application id.
 * @returns {string} -> Invite URL.
 */
function buildBotInviteUrl(clientId) {
    const permissions = new PermissionsBitField(BOT_PERMISSIONS.map(permission => permission.flag));
    const scopes = ['bot', 'applications.commands'];
    return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions.bitfield}&scope=${scopes.join('%20')}`;
}

module.exports = { BOT_PERMISSIONS, buildBotInviteUrl };
