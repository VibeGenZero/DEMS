const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

const FILE = path.join(REPO_ROOT, 'public', 'js', 'admin', 'discord-preview.js');
const NOW = new Date(2026, 9, 14, 18, 5);
// marked wraps the text in a paragraph; sanitizing is tested with ui.js
const load = async () => (await loadFrontendModules(FILE, vm.createContext({
    marked: { parse: (text) => `<p>${text}</p>` },
    DOMPurify: { sanitize: (html) => html }
}))).get('discord-preview.js');

const PREVIEW = {
    embed: {
        title: '🎉 Raidnacht', description: 'Bringt **Tränke** mit.', color: 0x8b5cf6,
        fields: [
            { name: '🗓️ Datum', value: '1.12.2026, 19:00:00', inline: true },
            { name: '👥 Plätze', value: '0 von 6 Plätzen belegt', inline: true },
            { name: '📋 Anmeldung', value: '[Hier anmelden](http://localhost:3000/#event/vorschau)', inline: false }
        ],
        image: { url: 'https://example.com/raid.png' },
        footer: { text: 'DEMS — Event Management' },
        timestamp: new Date(2026, 9, 14, 18, 0).toISOString()
    },
    components: [{
        type: 1, components: [
            { type: 2, style: 1, label: 'Tank', emoji: { name: '🛡️' }, custom_id: 'slot:vorschau:tank' },
            { type: 2, style: 2, label: 'Heiler (voll)', emoji: { name: '💚' }, custom_id: 'slot:vorschau:heal' },
            { type: 2, style: 5, label: 'Zum Event', emoji: { name: '🔗' }, url: 'http://localhost:3000/#event/vorschau' }
        ]
    }],
    bot: { name: 'DEMS Bot', avatarUrl: 'https://cdn.example/bot.png' }
};

test('the head shows the bot with its avatar, the APP tag and the time', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage(PREVIEW, NOW);
    assert.match(html, /^<div class="discord-message"><img class="avatar" src="https:\/\/cdn\.example\/bot\.png" alt="DEMS Bot"/);
    assert.ok(html.includes('<span class="discord-message-author">DEMS Bot</span><span class="discord-app-tag">APP</span><span class="discord-message-time">Heute um 18:05</span>'), html);
});

test('the embed carries colour, title, description, fields, image and footer', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage(PREVIEW, NOW);
    assert.ok(html.includes('<div class="discord-embed" data-style-border-color="#8b5cf6">'), html);
    assert.ok(html.includes('<div class="discord-embed-title">🎉 Raidnacht</div>'));
    assert.ok(html.includes('<div class="discord-embed-description"><p>Bringt **Tränke** mit.</p></div>'));
    assert.equal((html.match(/class="discord-field"/g) || []).length, 2);
    assert.equal((html.match(/class="discord-field is-wide"/g) || []).length, 1);
    assert.ok(html.includes('<img class="discord-embed-image" src="https://example.com/raid.png" alt="" data-fallback="hide">'));
    assert.ok(html.includes('<div class="discord-embed-footer">DEMS — Event Management • Heute um 18:00</div>'));
});

test('buttons keep their Discord style, the emoji and a link symbol', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage(PREVIEW, NOW);
    assert.ok(html.includes('<span class="discord-button is-primary"><span class="discord-button-emoji">🛡️</span>Tank</span>'));
    assert.ok(html.includes('<span class="discord-button is-secondary"><span class="discord-button-emoji">💚</span>Heiler (voll)</span>'));
    assert.ok(html.includes('<span class="discord-button is-link"><span class="discord-button-emoji">🔗</span>Zum Event<i class="bi bi-box-arrow-up-right"></i></span>'));
});

test('texts from admins and Discord are escaped', async () => {
    const { renderDiscordMessage } = await load();
    const evil = '<img src=x onerror=alert(1)>';
    const html = renderDiscordMessage({
        embed: { title: evil, fields: [{ name: evil, value: 'x', inline: true }], footer: { text: evil } },
        components: [{ type: 1, components: [{ type: 2, style: 1, label: evil, emoji: { name: evil } }] }],
        bot: { name: evil }
    }, NOW);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /\sstyle=/);
});

test('missing or odd data still gives a message', async () => {
    const { renderDiscordMessage, discordColor, discordTime } = await load();
    const html = renderDiscordMessage({}, NOW);
    assert.ok(html.includes('<span class="discord-message-author">DEMS</span>'));
    assert.ok(html.includes('<div class="discord-embed">'));
    assert.doesNotMatch(html, /discord-embed-title|discord-buttons|discord-embed-footer/);
    assert.deepEqual([discordColor(0), discordColor(0x22c55e), discordColor(-1), discordColor('x'), discordColor(2 ** 24)], ['#000000', '#22c55e', '', '', '']);
    assert.equal(discordTime('kein Datum', NOW), '');
    assert.match(discordTime(new Date(2026, 11, 1, 19, 0).toISOString(), NOW), /^01\.12\.2026 19:00$/);
});
