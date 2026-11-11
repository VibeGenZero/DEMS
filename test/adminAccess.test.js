const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { hasAdministratorPermission, isGuildAdministrator, isDemsAdmin } = require('../utils/adminAccess');

test('the Administrator bit is read from every permission shape Discord delivers', () => {
    // OAuth /users/@me/guilds: decimal string
    assert.equal(hasAdministratorPermission('8'), true);
    assert.equal(hasAdministratorPermission('2251799813685247'), true, 'all permissions');
    assert.equal(hasAdministratorPermission('2048'), false, 'only "Send Messages"');
    // discord.js: PermissionsBitField
    assert.equal(hasAdministratorPermission(new PermissionsBitField(PermissionFlagsBits.Administrator)), true);
    assert.equal(hasAdministratorPermission(new PermissionsBitField(PermissionFlagsBits.ManageGuild)), false);
    assert.equal(hasAdministratorPermission(8n), true);
});

test('missing or broken permissions never make an admin', () => {
    for (const value of [undefined, null, '', 'abc', '-8', {}, 0]) {
        assert.equal(hasAdministratorPermission(value), false, String(value));
    }
});

test('the owner and Administrators of a guild from /users/@me/guilds count', () => {
    assert.equal(isGuildAdministrator({ id: 'g1', owner: true, permissions: '0' }), true);
    assert.equal(isGuildAdministrator({ id: 'g1', owner: false, permissions: '8' }), true);
    assert.equal(isGuildAdministrator({ id: 'g1', owner: false, permissions: '1024' }), false);
    assert.equal(isGuildAdministrator(undefined), false);
});

test('a DEMS admin holds the admin role or the Discord Administrator permission', () => {
    const adminRoleId = 'role-admin';
    assert.equal(isDemsAdmin({ roleIds: ['role-admin'], adminRoleId }), true);
    assert.equal(isDemsAdmin({ roleIds: ['role-member'], adminRoleId }), false);
    assert.equal(isDemsAdmin({ roleIds: [], isAdministrator: true, adminRoleId }), true);
    // Setup wizard "Keine (nur Discord-Administratoren)"
    assert.equal(isDemsAdmin({ roleIds: ['role-admin'], adminRoleId: '' }), false);
    assert.equal(isDemsAdmin({ roleIds: [], isAdministrator: true, adminRoleId: '' }), true);
    assert.equal(isDemsAdmin({ isAdministrator: false }), false);
});

test('the admin role defaults to DISCORD_ADMIN_ROLE_ID', () => {
    const previous = process.env.DISCORD_ADMIN_ROLE_ID;
    process.env.DISCORD_ADMIN_ROLE_ID = 'role-from-env';
    try {
        assert.equal(isDemsAdmin({ roleIds: ['role-from-env'] }), true);
    } finally {
        if (previous === undefined) delete process.env.DISCORD_ADMIN_ROLE_ID;
        else process.env.DISCORD_ADMIN_ROLE_ID = previous;
    }
});
