const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');

// Members ask the event assistant in Discord: /ask, „Frage stellen“ and its
// modal. Mock mode with an own, seeded database; mock mode turns the mock AI
// provider on, so the feature is on unless a test switches it off.
const tmpDir = createTempDir('ask-command');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'ask.sqlite');

const { MessageFlags } = require('discord.js');
const bot = require('../bot');
const { db, doc, setDoc, deleteDoc } = require('../firebaseAdmin');
const { PERSONAS, ROLE_ID } = require('../dev/mockGuild');
const { EVENT_ID } = require('../dev/seedData');
const { buildSlashCommands } = require('../bot/commands');
const settings = require('../ai/settings');
const limits = require('../ai/limits');

const persona = (id) => PERSONAS.find(entry => entry.id === id);
const RAIDER = persona('raider');
const MEMBER = persona('member');
const OPEN_TITLE = 'Community-Spieleabend';

before(async () => {
    process.env.DISCORD_ADMIN_ROLE_ID = ROLE_ID.ADMIN;
    await require('../dev/seed').seedIfEmpty();
});

beforeEach(async () => {
    limits.resetLimits();
    await deleteDoc(doc(db, 'aiSettings', 'config'));
    await settings.loadAiSettings();
});

after(async () => {
    await bot.client.destroy();
});

/** A fake interaction of a member with options, focused text and modal fields. */
function interactionOf({ kind, who, commandName, customId, options = {}, focused = '', fields = {}, message = null }) {
    const interaction = createFakeInteraction({ kind, commandName, customId, userId: who.userId, roles: who.roles, focused });
    interaction.options = {
        getSubcommand: () => null,
        getString: (name) => (name in options ? options[name] : null),
        getFocused: () => focused
    };
    interaction.fields = { getTextInputValue: (id) => (id in fields ? fields[id] : '') };
    interaction.message = message;
    return interaction;
}

/** Run an interaction and wait until the deferred answer arrived. */
async function run(interaction) {
    await dispatchInteraction(bot.client, interaction);
    for (let i = 0; i < 200 && interaction.calls.at(-1)[0] !== 'editReply'; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return interaction.calls.at(-1)[1];
}

const ask = (who, eventId, question) => interactionOf({ kind: 'command', who, commandName: 'ask', options: { event: eventId, question } });
const buttonsOf = (payload) => (payload.components || [])
    .map(row => (typeof row.toJSON === 'function' ? row.toJSON() : row))
    .flatMap(row => row.components || []);

// ── Definition ──────────────────────────────────────────────────────────

test('/ask (German /frage) is defined only while the Discord feature is on', async () => {
    const command = buildSlashCommands().find(entry => entry.name === 'ask');
    assert.ok(command, 'ask is registered while the feature is on');
    assert.equal(command.name_localizations.de, 'frage');
    assert.equal(command.description, 'Stelle eine Frage zu einem Event');
    assert.equal(command.description_localizations.de, 'Stelle eine Frage zu einem Event');
    const [event, question] = command.options;
    assert.deepEqual([event.name, event.required, event.autocomplete, event.description], ['event', true, true, 'Name des Events']);
    assert.deepEqual([question.name, question.name_localizations.de, question.required, question.max_length, question.description],
        ['question', 'frage', true, 500, 'Deine Frage']);

    await settings.saveAiSettings({ memberDiscord: false });
    assert.ok(!buildSlashCommands().some(entry => entry.name === 'ask'), 'switched off');
    await settings.saveAiSettings({ memberDiscord: true });

    const provider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = '';
    try {
        assert.ok(!buildSlashCommands().some(entry => entry.name === 'ask'), 'AI not configured');
    } finally {
        process.env.AI_PROVIDER = provider;
    }
});

// ── /ask ────────────────────────────────────────────────────────────────

test('/ask answers privately with the mock answer, the quoted question and „Zum Event“', async () => {
    const interaction = ask(RAIDER, EVENT_ID.OPEN, 'Wann geht es los?');
    const answer = await run(interaction);
    assert.deepEqual(interaction.calls[0], ['deferReply', { flags: MessageFlags.Ephemeral }]);
    assert.equal(answer.content, '**Event-Assistent**\n> Wann geht es los?\n\nMock-Antwort: Wann geht es los?');
    assert.deepEqual(answer.allowedMentions, { parse: [] });
    const [link] = buttonsOf(answer);
    assert.equal(link.label, 'Zum Event');
    assert.ok(link.url.endsWith(`#event/${EVENT_ID.OPEN}`), link.url);
});

test('the answer names the assistant from the settings', async () => {
    await settings.saveAiSettings({ assistantName: 'Gildenhelfer' });
    const answer = await run(ask(RAIDER, EVENT_ID.OPEN, 'Wer kommt?'));
    assert.match(answer.content, /^\*\*Gildenhelfer\*\*\n/);
});

test('the autocomplete of /ask offers only active events that are not over', async () => {
    const day = 86_400_000;
    const at = (days) => new Date(Date.now() + days * day).toISOString();
    const events = {
        'ask-ac-1': { title: 'Fragetest Eins', status: 'active', startDate: at(2) },
        'ask-ac-old': { title: 'Fragetest Alt', status: 'active', startDate: at(-3), endDate: at(-3 + 0.1) },
        'ask-ac-draft': { title: 'Fragetest Entwurf', status: 'draft', startDate: at(4) },
        'ask-ac-archived': { title: 'Fragetest Archiv', status: 'archived', startDate: at(5) }
    };
    for (const [id, event] of Object.entries(events)) await setDoc(doc(db, 'events', id), event);
    try {
        const interaction = interactionOf({ kind: 'autocomplete', who: MEMBER, commandName: 'ask', focused: 'FRAGETEST' });
        await dispatchInteraction(bot.client, interaction);
        assert.deepEqual(interaction.calls.at(-1), ['respond', [{ name: 'Fragetest Eins', value: 'ask-ac-1' }]]);
    } finally {
        for (const id of Object.keys(events)) await deleteDoc(doc(db, 'events', id));
    }
});

test('a draft or unknown event is not found for a member', async () => {
    for (const eventId of [EVENT_ID.DRAFT, 'no-such-event']) {
        const answer = await run(ask(MEMBER, eventId, 'Gibt es das?'));
        assert.equal(answer.content, '❌ Event nicht gefunden.');
        assert.deepEqual(answer.allowedMentions, { parse: [] });
    }
});

test('above the hourly limit the limit sentence arrives privately', async () => {
    await settings.saveAiSettings({ memberQuestionsPerHour: 1 });
    await run(ask(RAIDER, EVENT_ID.OPEN, 'Erste Frage'));
    const interaction = ask(RAIDER, EVENT_ID.OPEN, 'Zweite Frage');
    const answer = await run(interaction);
    assert.deepEqual(interaction.calls[0], ['deferReply', { flags: MessageFlags.Ephemeral }]);
    assert.equal(answer.content, '❌ Du hast das Fragenlimit für diese Stunde erreicht. Bitte versuche es später noch einmal.');
});

test('a mention-heavy, overlong answer cannot ping and stays within 2000 characters', async () => {
    const { handleAskCommand } = require('../bot/ask');
    const client = { async chat() { return { text: `@everyone ${'x'.repeat(3000)}`, usage: { inputTokens: 1, outputTokens: 1 } }; } };
    const interaction = ask(RAIDER, EVENT_ID.OPEN, '@everyone hallo\n> **zweite** Zeile <@&1>');
    await handleAskCommand(interaction, { client });
    const [name, answer] = interaction.calls.at(-1);
    assert.equal(name, 'editReply');
    assert.deepEqual(answer.allowedMentions, { parse: [] });
    assert.ok(answer.content.length <= 2000, String(answer.content.length));
    // The question is quoted on one line, its Markdown escaped
    const [, quote] = answer.content.split('\n');
    assert.equal(quote, '> @everyone hallo > \\*\\*zweite\\*\\* Zeile <@&1>');
});

test('a quoted question is cut to 200 characters', async () => {
    const { buildAskAnswer } = require('../bot/ask');
    const reply = buildAskAnswer({ name: 'Event-Assistent', question: 'a'.repeat(300), text: 'Antwort', eventId: 'evt1' });
    const [, quote] = reply.content.split('\n');
    assert.equal(quote, `> ${'a'.repeat(199)}…`);
});

test('a database error is answered with the fixed sentence, never with its message', async () => {
    const { handleAskCommand } = require('../bot/ask');
    const client = { async chat() { throw Object.assign(new Error('geheime Details'), { code: 'EBROKEN' }); } };
    const interaction = ask(RAIDER, EVENT_ID.OPEN, 'Kaputt?');
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    try {
        await handleAskCommand(interaction, { client });
    } finally {
        console.error = original;
    }
    assert.deepEqual(interaction.calls.at(-1)[1], { content: '❌ Die Frage konnte nicht verarbeitet werden.', allowedMentions: { parse: [] } });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes('EBROKEN'));
    assert.ok(!errors[0].includes('geheime') && !errors[0].includes('Kaputt'));
});

// ── Button and modal ────────────────────────────────────────────────────

/** The announcement the button sits on, as Discord hands it back (JSON components). */
async function announcementMessage(eventId) {
    const { loadEventRoster } = require('../utils/eventUtils');
    const { getDoc } = require('../firebaseAdmin');
    const event = (await getDoc(doc(db, 'events', eventId))).data();
    const payload = bot.buildEventAnnouncement(event, eventId, await loadEventRoster(eventId, event));
    return { components: payload.components.map(component => component.toJSON()) };
}

test('„Frage stellen“ opens the question modal at once', async () => {
    const message = await announcementMessage(EVENT_ID.OPEN);
    const interaction = interactionOf({ kind: 'button', who: RAIDER, customId: `event_ask:${EVENT_ID.OPEN}`, message });
    await dispatchInteraction(bot.client, interaction);
    const [name, modal] = interaction.calls[0];
    assert.equal(name, 'showModal');
    const json = modal.toJSON();
    assert.equal(json.custom_id, `event_ask_modal:${EVENT_ID.OPEN}`);
    assert.equal(json.title, `Frage: ${OPEN_TITLE}`);
    assert.equal(json.components.length, 1);
    const [label] = json.components;
    assert.equal(label.label, 'Deine Frage');
    assert.deepEqual([label.component.custom_id, label.component.style, label.component.max_length, label.component.required],
        ['question', 2, 500, true]);
});

test('the modal title is cut to 45 characters', () => {
    const { buildAskModal } = require('../bot/ask');
    const title = buildAskModal({ title: 'x'.repeat(80) }, 'evt1').toJSON().title;
    assert.equal(title.length, 45);
    assert.ok(title.startsWith('Frage: x') && title.endsWith('…'));
});

test('the submitted modal answers like the command', async () => {
    const interaction = interactionOf({
        kind: 'modal', who: RAIDER, customId: `event_ask_modal:${EVENT_ID.OPEN}`, fields: { question: 'Was soll ich mitbringen?' }
    });
    const answer = await run(interaction);
    assert.deepEqual(interaction.calls[0], ['deferReply', { flags: MessageFlags.Ephemeral }]);
    assert.equal(answer.content, '**Event-Assistent**\n> Was soll ich mitbringen?\n\nMock-Antwort: Was soll ich mitbringen?');
    assert.deepEqual(answer.allowedMentions, { parse: [] });
    assert.equal(buttonsOf(answer)[0].label, 'Zum Event');
});

test('an old button, the modal and the command answer „ausgeschaltet“ while the feature is off', async () => {
    await settings.saveAiSettings({ memberDiscord: false });
    const button = interactionOf({ kind: 'button', who: RAIDER, customId: `event_ask:${EVENT_ID.OPEN}`, message: null });
    const modal = interactionOf({ kind: 'modal', who: RAIDER, customId: `event_ask_modal:${EVENT_ID.OPEN}`, fields: { question: 'Hallo?' } });
    for (const interaction of [button, modal, ask(RAIDER, EVENT_ID.OPEN, 'Hallo?')]) {
        await dispatchInteraction(bot.client, interaction);
        assert.deepEqual(interaction.calls, [['reply', {
            content: 'Der Event-Assistent ist gerade ausgeschaltet.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }
        }]]);
    }
});
