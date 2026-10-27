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

const slotSection = (label, style, emoji) => ({
    type: 9,
    components: [{ type: 10, content: `**${emoji} ${label}**\n— frei —` }],
    accessory: { type: 2, style, label, emoji: { name: emoji }, custom_id: `event_slot:vorschau:${label}` }
});

// Components V2 message as POST /api/admin/events/preview returns it (B-05)
const PREVIEW = {
    message: {
        components: [{
            type: 17,
            accent_color: 0xf59e0b,
            components: [
                { type: 12, items: [{ media: { url: 'https://example.com/raid.png' } }] },
                { type: 10, content: '## 🎉 Raidnacht\nBringt **Tränke** mit.' },
                { type: 10, content: '🗓️ **Datum:** 1.12.2026, 19:00:00\n👥 **Plätze:** 0 von 6 Plätzen belegt' },
                { type: 14 },
                slotSection('Tank', 1, '🛡️'),
                slotSection('Heiler (voll)', 2, '💚'),
                { type: 1, components: [{ type: 2, style: 5, label: 'Zum Event', emoji: { name: '🔗' }, url: 'http://localhost:3000/#event/vorschau' }] }
            ]
        }]
    },
    bot: { name: 'DEMS Bot', avatarUrl: 'https://cdn.example/bot.png' }
};

test('the head shows the bot with its avatar, the APP tag and the time', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage(PREVIEW, NOW);
    assert.match(html, /^<div class="discord-message"><img class="avatar" src="https:\/\/cdn\.example\/bot\.png" alt="DEMS Bot"/);
    assert.ok(html.includes('<span class="discord-message-author">DEMS Bot</span><span class="discord-app-tag">APP</span><span class="discord-message-time">Heute um 18:05</span>'), html);
});

test('the container carries the event colour, the banner, the texts and a separator', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage(PREVIEW, NOW);
    assert.ok(html.includes('<div class="discord-container" data-style-border-color="#f59e0b">'), html);
    assert.ok(html.includes('<div class="discord-gallery"><img class="discord-gallery-image" src="https://example.com/raid.png" alt="" data-fallback="hide"></div>'));
    // Discord keeps single line breaks; marked needs a hard break for that
    assert.ok(html.includes('<div class="discord-text"><p>## 🎉 Raidnacht  \nBringt **Tränke** mit.</p></div>'), html);
    assert.ok(html.includes('<hr class="discord-separator">'));
    assert.doesNotMatch(html, /discord-embed/);
});

test('a section puts its button beside the line-up text', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage(PREVIEW, NOW);
    assert.ok(html.includes('<div class="discord-section"><div class="discord-section-text"><div class="discord-text"><p>**🛡️ Tank**  \n— frei —</p></div></div>'
        + '<span class="discord-button is-primary"><span class="discord-button-emoji">🛡️</span>Tank</span></div>'), html);
    assert.ok(html.includes('<span class="discord-button is-secondary"><span class="discord-button-emoji">💚</span>Heiler (voll)</span>'));
});

test('the button row keeps the link symbol', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage(PREVIEW, NOW);
    assert.ok(html.includes('<div class="discord-buttons"><span class="discord-button is-link"><span class="discord-button-emoji">🔗</span>Zum Event<i class="bi bi-box-arrow-up-right"></i></span></div>'), html);
});

test('a text display above the container stands outside it', async () => {
    const { renderDiscordMessage } = await load();
    const html = renderDiscordMessage({ message: { components: [{ type: 10, content: 'Hallo' }, { type: 17, components: [] }] } }, NOW);
    assert.ok(html.includes('<div class="discord-text"><p>Hallo</p></div><div class="discord-container">'), html);
});

test('texts from admins and Discord are escaped', async () => {
    const { renderDiscordMessage } = await load();
    const evil = '<img src=x onerror=alert(1)>';
    const html = renderDiscordMessage({
        message: {
            components: [{
                type: 17,
                components: [
                    { type: 12, items: [{ media: { url: `"${evil}` } }] },
                    { type: 9, components: [], accessory: { type: 2, style: 1, label: evil, emoji: { name: evil } } },
                    { type: 1, components: [{ type: 2, style: 1, label: evil }] }
                ]
            }]
        },
        bot: { name: evil }
    }, NOW);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /\sstyle=/);
});

test('missing or odd data still gives a message', async () => {
    const { renderDiscordMessage, discordColor, discordTime } = await load();
    const html = renderDiscordMessage({}, NOW);
    assert.ok(html.includes('<span class="discord-message-author">DEMS</span>'));
    assert.doesNotMatch(html, /discord-container|discord-buttons/);
    const odd = renderDiscordMessage({ message: { components: [null, { type: 99 }, { type: 17, accent_color: 'x', components: 'kaputt' }] } }, NOW);
    assert.ok(odd.includes('<div class="discord-container"></div>'), odd);
    assert.deepEqual([discordColor(0), discordColor(0x22c55e), discordColor(-1), discordColor('x'), discordColor(2 ** 24)], ['#000000', '#22c55e', '', '', '']);
    assert.equal(discordTime('kein Datum', NOW), '');
    assert.match(discordTime(new Date(2026, 11, 1, 19, 0).toISOString(), NOW), /^01\.12\.2026 19:00$/);
});
