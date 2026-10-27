const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

// Pure helpers of the Components V2 messages (B-05); no database, no client
const { toAccentColor, fitText, buildAnnouncementIntro, countComponents, textLength, DEMS_ACCENT } = require('../bot/layout');

test('the event colour becomes the container accent, anything else the DEMS accent', () => {
    assert.equal(DEMS_ACCENT, 0x8b5cf6);
    assert.equal(toAccentColor('#f59e0b'), 0xf59e0b);
    assert.equal(toAccentColor('#F59E0B'), 0xf59e0b);
    for (const value of ['', 'red', '#fff', '#12345g', null, undefined, 42]) {
        assert.equal(toAccentColor(value), DEMS_ACCENT, String(value));
    }
});

test('fitText keeps short text and cuts long text with an ellipsis', () => {
    assert.equal(fitText('Raid', 10), 'Raid');
    assert.equal(fitText('', 10), '');
    assert.equal(fitText(undefined, 10), '');
    const cut = fitText('a'.repeat(20), 10);
    assert.equal(cut.length, 10);
    assert.ok(cut.endsWith('…'));
});

test('fitText never leaves half an emoji', () => {
    // '🎉' is two UTF-16 units; a cut right after the first one must drop it
    const cut = fitText('aaaaaaaa🎉bbbb', 10);
    assert.equal(cut, 'aaaaaaaa…');
    assert.doesNotMatch(cut, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test('the intro lists role pings, @everyone and the text in that order', () => {
    assert.equal(buildAnnouncementIntro({ roleIds: ['1', '2'], pingEveryone: true, text: '  Heute Abend!  ' }), '<@&1> <@&2>\n@everyone\nHeute Abend!');
    assert.equal(buildAnnouncementIntro({ text: 'Nur Text' }), 'Nur Text');
    assert.equal(buildAnnouncementIntro({ roleIds: [], pingEveryone: false, text: '   ' }), '');
    assert.equal(buildAnnouncementIntro(), '');
});

test('countComponents counts nested components like Discord does', () => {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(t => t.setContent('a'))
        .addSectionComponents(s => s.addTextDisplayComponents(t => t.setContent('b')).setButtonAccessory(b => b.setCustomId('x').setLabel('X').setStyle(1)));
    const payload = { flags: MessageFlags.IsComponentsV2, components: [new TextDisplayBuilder().setContent('intro'), container] };
    // intro 1 + container 1 + text 1 + section 1 + section text 1 + accessory 1
    assert.equal(countComponents(payload), 6);
    assert.equal(textLength(payload), 'intro'.length + 'a'.length + 'b'.length);
});
