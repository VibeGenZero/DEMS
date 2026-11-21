// The role guard for plugins (utils/pluginRoleGuard.js, used by bot/pluginRoles.js and dev/mockBot.js): which Discord roles a plugin may give or take.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { isPluginAssignableRole, FORBIDDEN_ROLE_PERMISSIONS } = require('../utils/pluginRoleGuard');

const opts = { adminRoleId: 'A', botTopPosition: 10, everyoneId: 'G' };
const role = (extra) => ({ id: 'R', managed: false, position: 5, permissions: [], ...extra });

test('a plain role below the bot is assignable', () => {
    assert.equal(isPluginAssignableRole(role(), opts), true);
    assert.equal(isPluginAssignableRole(role({ permissions: ['SendMessages', 'ViewChannel', 'Connect'] }), opts), true);
});

test('@everyone, managed roles, the DEMS admin role and roles at or above the bot are refused', () => {
    assert.equal(isPluginAssignableRole(role({ id: 'G' }), opts), false);
    assert.equal(isPluginAssignableRole(role({ managed: true }), opts), false);
    assert.equal(isPluginAssignableRole(role({ id: 'A' }), opts), false);
    assert.equal(isPluginAssignableRole(role({ position: 10 }), opts), false);
    assert.equal(isPluginAssignableRole(role({ position: 11 }), opts), false);
});

test('without a configured admin role only the other rules apply', () => {
    assert.equal(isPluginAssignableRole(role({ id: 'A' }), { ...opts, adminRoleId: '' }), true);
});

test('every dangerous permission is refused, and each is a real discord.js flag', () => {
    assert.deepEqual(FORBIDDEN_ROLE_PERMISSIONS, [
        'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'ManageGuildExpressions',
        'ManageEvents', 'ManageMessages', 'ManageThreads', 'ManageNicknames', 'KickMembers', 'BanMembers',
        'ModerateMembers', 'MentionEveryone', 'ViewAuditLog', 'ViewGuildInsights',
        'MuteMembers', 'DeafenMembers', 'MoveMembers', 'PinMessages', 'BypassSlowmode', 'ViewCreatorMonetizationAnalytics'
    ]);
    for (const permission of FORBIDDEN_ROLE_PERMISSIONS) {
        assert.equal(typeof PermissionFlagsBits[permission], 'bigint', permission);
        assert.equal(isPluginAssignableRole(role({ permissions: ['SendMessages', permission] }), opts), false, permission);
    }
});

test('a malformed role is refused', () => {
    assert.equal(isPluginAssignableRole(null, opts), false);
    assert.equal(isPluginAssignableRole(role({ permissions: undefined }), opts), false);
});

test('a role that gets a forbidden right through a channel overwrite is refused; plain channel access is fine', () => {
    assert.equal(isPluginAssignableRole(role({ channelAllows: ['ViewChannel', 'SendMessages', 'Connect'] }), opts), true);
    for (const permission of ['ManageMessages', 'ManageChannels', 'MuteMembers', 'MoveMembers', 'PinMessages']) {
        assert.equal(isPluginAssignableRole(role({ channelAllows: ['ViewChannel', permission] }), opts), false, permission);
    }
    assert.equal(isPluginAssignableRole(role({ channelAllows: 'ManageMessages' }), opts), false, 'malformed overwrites refuse');
});

