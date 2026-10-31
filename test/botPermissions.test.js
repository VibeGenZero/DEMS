const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionsBitField } = require('discord.js');
const { buildBotInviteUrl } = require('../utils/botPermissions');

const { Flags } = PermissionsBitField;

/**
 * Permissions requested by an invite URL.
 *
 * @param {string} url -> Invite URL.
 * @returns {PermissionsBitField} -> Requested permissions.
 */
const permissionsOf = (url) => new PermissionsBitField(BigInt(new URL(url).searchParams.get('permissions')));

test('the invite asks for the right to create server events', () => {
    // "Mit Discord synchronisieren" creates a Discord scheduled event
    assert.equal(permissionsOf(buildBotInviteUrl('123')).has(Flags.CreateEvents), true);
});

test('the invite asks for every right the bot grants participants', () => {
    // addParticipantToEventChannels allows ViewChannel + Connect (voice) and ViewChannel + SendMessages (text);
    // Discord refuses overwrites with permissions the bot does not have itself
    const permissions = permissionsOf(buildBotInviteUrl('123'));
    for (const [name, flag] of Object.entries({ ViewChannel: Flags.ViewChannel, Connect: Flags.Connect, SendMessages: Flags.SendMessages })) {
        assert.equal(permissions.has(flag), true, name);
    }
});

test('the invite adds the bot with slash commands for the given application', () => {
    const url = new URL(buildBotInviteUrl('123'));
    assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
    assert.equal(url.searchParams.get('client_id'), '123');
    assert.equal(url.searchParams.get('scope'), 'bot applications.commands');
    for (const flag of [Flags.ManageRoles, Flags.ManageChannels, Flags.EmbedLinks, Flags.ReadMessageHistory]) {
        assert.equal(permissionsOf(url.href).has(flag), true, String(flag));
    }
});

test('the invite asks for the right to open discussion threads', () => {
    // Each announced event gets a public thread on its announcement (B-14)
    const permissions = permissionsOf(buildBotInviteUrl('123'));
    assert.equal(permissions.has(Flags.CreatePublicThreads), true);
    assert.equal(permissions.has(Flags.SendMessagesInThreads), true);
});

test('the invite asks for the rights of the comment sync (B-16)', () => {
    // The bot creates its own webhook and removes members' thread messages whose comment was deleted
    const permissions = permissionsOf(buildBotInviteUrl('123'));
    assert.equal(permissions.has(Flags.ManageWebhooks), true, 'ManageWebhooks');
    assert.equal(permissions.has(Flags.ManageMessages), true, 'ManageMessages');
});
