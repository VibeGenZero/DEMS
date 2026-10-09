const { test } = require('node:test');
const assert = require('node:assert/strict');
const { avatarUrlOf, repairAvatarUrl } = require('../utils/avatar');

const CUSTOM = 'https://cdn.discordapp.com/avatars/300000000000000001/a1b2c3.png';
const EMBED = 'https://cdn.discordapp.com/embed/avatars/3.png';

test('a session user brings a complete avatar URL that is used as is', () => {
    assert.equal(avatarUrlOf({ id: '300000000000000001', avatar: CUSTOM }), CUSTOM);
    assert.equal(avatarUrlOf({ id: '300000000000000001', avatar: EMBED }), EMBED);
    assert.equal(avatarUrlOf({ id: '300000000000000001' }), 'https://cdn.discordapp.com/embed/avatars/0.png');
});

test('avatar URLs that comments stored wrapped into a second URL are unwrapped', () => {
    const wrap = (url) => `https://cdn.discordapp.com/avatars/300000000000000001/${url}.png?size=64`;
    assert.equal(repairAvatarUrl(wrap(CUSTOM)), CUSTOM);
    assert.equal(repairAvatarUrl(wrap(EMBED)), EMBED);
});

test('intact avatar URLs and empty values stay as they are', () => {
    for (const value of [CUSTOM, EMBED, 'https://cdn.discordapp.com/avatars/1/abc.png?size=64', '', null, undefined]) {
        assert.equal(repairAvatarUrl(value), value, String(value));
    }
});
