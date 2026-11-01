const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');

// Mock mode with an own, seeded database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('info-commands');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'info.sqlite');

const { MessageFlags } = require('discord.js');
const bot = require('../bot');
const { db, collection, doc, getDocs, setDoc, deleteDoc } = require('../firebaseAdmin');
const { PERSONAS, MEMBERS, ROLE_ID } = require('../dev/mockGuild');
const { POLL_ID } = require('../dev/seedData');
const { buildSlashCommands } = require('../bot/commands');
const { countComponents, MESSAGE_COMPONENTS_MAX } = require('../bot/layout');

const persona = (id) => PERSONAS.find(entry => entry.id === id);
const RAIDER = persona('raider');
const MEMBER = persona('member');
const KIRA = MEMBERS.find(member => member.username === 'kira');

before(async () => {
    process.env.DISCORD_ADMIN_ROLE_ID = ROLE_ID.ADMIN;
    await require('../dev/seed').seedIfEmpty();
});

after(async () => {
    await bot.client.destroy();
});

/** A fake interaction of a member with subcommand, options and focused text. */
function interactionOf({ kind, who, commandName, subcommand = null, options = {}, focused = '' }) {
    const interaction = createFakeInteraction({ kind, commandName, userId: who.userId, roles: who.roles, focused });
    interaction.options = {
        getSubcommand: () => subcommand,
        getString: (name) => (name in options ? options[name] : null),
        getFocused: () => focused
    };
    return interaction;
}
/** Run an interaction and wait until the deferred answer arrived. */
async function run(interaction) {
    await dispatchInteraction(bot.client, interaction);
    for (let i = 0; i < 100 && interaction.calls[interaction.calls.length - 1][0] !== 'editReply'; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return interaction.calls[interaction.calls.length - 1][1];
}
/** Text and buttons of a V2 or classic answer. */
function readAnswer(payload) {
    const texts = [];
    const buttons = [];
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 10 && node.content) texts.push(node.content);
        if (node.type === 2) buttons.push([node.label, node.custom_id || node.url]);
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(walk);
            else if (value && typeof value === 'object') walk(value);
        }
    };
    (payload.components || []).forEach(component => walk(typeof component.toJSON === 'function' ? component.toJSON() : component));
    return { text: [payload.content || '', ...texts].join('\n'), buttons };
}

// ── /abstimmungen ───────────────────────────────────────────────────────

test('/polls is defined with the German name /abstimmungen', () => {
    const commands = Object.fromEntries(buildSlashCommands().map(command => [command.name, command]));
    assert.equal(commands.polls.name_localizations.de, 'abstimmungen');
    assert.equal(commands.polls.description_localizations.de, 'Zeigt die offenen Terminabstimmungen');
});

test('the open poll is listed privately with dates, deadline, own state and buttons', async () => {
    const answer = await run(interactionOf({ kind: 'command', who: RAIDER, commandName: 'polls' }));
    const { text, buttons } = readAnswer(answer);
    assert.ok(answer.flags & MessageFlags.IsComponentsV2);
    assert.match(text, /Offene Abstimmungen/);
    assert.match(text, /Termin für den Herbst-Raid/);
    assert.match(text, /3 Termine · bis /);
    assert.match(text, /Noch nicht abgestimmt/);
    assert.deepEqual(buttons, [
        ['Abstimmen', `poll_vote:${POLL_ID.OPEN}`],
        ['Ansehen', `http://localhost:3000/#poll/${POLL_ID.OPEN}`]
    ]);
    assert.doesNotMatch(text, /Sommerfest/, 'decided polls are left out');

    const voter = await run(interactionOf({ kind: 'command', who: KIRA, commandName: 'polls' }));
    assert.match(readAnswer(voter).text, /Du hast abgestimmt/);
});

test('a poll the member may not vote in is left out; none open gives the note', async () => {
    const answer = await run(interactionOf({ kind: 'command', who: MEMBER, commandName: 'polls' }));
    assert.equal(answer.content, '📭 Gerade läuft keine Abstimmung. Alle Abstimmungen: http://localhost:3000/#polls');
});

test('polls are sorted by deadline, at most five, the rest in a closing line', async () => {
    const day = 86_400_000;
    const ids = [];
    const options = [{ id: 'a', startDate: new Date(Date.now() + 20 * day).toISOString(), endDate: '' }, { id: 'b', startDate: new Date(Date.now() + 21 * day).toISOString(), endDate: '' }];
    const base = { description: '', options, accessMode: 'open', requiredRoles: [], announcements: [], winnerOptionId: '', eventId: '', createdBy: 'x', createdAt: new Date().toISOString(), closedAt: '' };
    for (let i = 1; i <= 6; i++) {
        const id = `info-poll-${i}`;
        ids.push(id);
        // Poll 6 has no deadline -> last
        await setDoc(doc(db, 'polls', id), { ...base, title: `Umfrage ${i}`, status: 'open', deadline: i === 6 ? '' : new Date(Date.now() + (10 - i) * day).toISOString() });
    }
    await setDoc(doc(db, 'polls', 'info-poll-expired'), { ...base, title: 'Abgelaufen', status: 'open', deadline: new Date(Date.now() - day).toISOString() });
    await setDoc(doc(db, 'polls', 'info-poll-closed'), { ...base, title: 'Beendet', status: 'closed', deadline: '' });
    try {
        const answer = await run(interactionOf({ kind: 'command', who: RAIDER, commandName: 'polls' }));
        const { text, buttons } = readAnswer(answer);
        const titles = [...text.matchAll(/\*\*(.+?)\*\*/g)].map(match => match[1]);
        // The seed poll ends in 3 days, before the test polls (5–9 days)
        assert.deepEqual(titles, ['Termin für den Herbst-Raid', 'Umfrage 5', 'Umfrage 4', 'Umfrage 3', 'Umfrage 2']);
        assert.match(text, /… und 2 weitere/);
        assert.match(text, /http:\/\/localhost:3000\/#polls/);
        assert.doesNotMatch(text, /Abgelaufen|Beendet/);
        assert.equal(buttons.length, 10);
        assert.ok(countComponents(answer) <= MESSAGE_COMPONENTS_MAX);
    } finally {
        for (const id of [...ids, 'info-poll-expired', 'info-poll-closed']) await deleteDoc(doc(db, 'polls', id));
    }
});

// ── /event info ─────────────────────────────────────────────────────────

const { EVENT_ID } = require('../dev/seedData');
const ADMIN = persona('admin');

test('/event has the subcommands create and info', () => {
    const event = buildSlashCommands().find(command => command.name === 'event');
    assert.deepEqual(event.options.map(option => option.name), ['create', 'info']);
    const info = event.options[1];
    assert.equal(info.name_localizations.de, 'info');
    assert.equal(info.description_localizations.de, 'Zeigt die Details eines Events');
    assert.equal(info.options[0].name, 'event');
    assert.equal(info.options[0].required, true);
    assert.equal(info.options[0].autocomplete, true);
});

test('the info autocomplete offers active events that are not over, next first', async () => {
    const day = 86_400_000;
    const at = (days) => new Date(Date.now() + days * day).toISOString();
    const events = {
        'info-ac-2': { title: 'Infotest Zwei', status: 'active', startDate: at(3) },
        'info-ac-1': { title: 'Infotest Eins', status: 'active', startDate: at(2) },
        'info-ac-old': { title: 'Infotest Alt', status: 'active', startDate: at(-3), endDate: at(-3 + 0.1) },
        'info-ac-draft': { title: 'Infotest Entwurf', status: 'draft', startDate: at(4) }
    };
    for (const [id, event] of Object.entries(events)) await setDoc(doc(db, 'events', id), event);
    try {
        const interaction = interactionOf({ kind: 'autocomplete', who: MEMBER, commandName: 'event', subcommand: 'info', focused: 'INFOTEST' });
        await dispatchInteraction(bot.client, interaction);
        assert.deepEqual(interaction.calls.at(-1), ['respond', [{ name: 'Infotest Eins', value: 'info-ac-1' }, { name: 'Infotest Zwei', value: 'info-ac-2' }]]);

        // create still offers the templates (admins only)
        const templates = interactionOf({ kind: 'autocomplete', who: ADMIN, commandName: 'event', subcommand: 'create', focused: 'raid' });
        await dispatchInteraction(bot.client, templates);
        assert.deepEqual(templates.calls.at(-1)[1].map(choice => choice.name), ['Raid-Abend']);
    } finally {
        for (const id of Object.keys(events)) await deleteDoc(doc(db, 'events', id));
    }
});

const askInfo = (who, eventId) => run(interactionOf({ kind: 'command', who, commandName: 'event', subcommand: 'info', options: { event: eventId } }));

test('an open event answers privately in the announcement layout', async () => {
    const interaction = interactionOf({ kind: 'command', who: RAIDER, commandName: 'event', subcommand: 'info', options: { event: EVENT_ID.OPEN } });
    const answer = await run(interaction);
    assert.deepEqual(interaction.calls[0], ['deferReply', { flags: MessageFlags.Ephemeral }]);
    assert.ok(answer.flags & MessageFlags.IsComponentsV2);
    const { text, buttons } = readAnswer(answer);
    assert.match(text, /## 🎉 /);
    assert.ok(buttons.some(([label, id]) => label === 'Anmelden' && id === `event_register:${EVENT_ID.OPEN}`));
    assert.ok(buttons.some(([label, url]) => label === 'Zum Event' && url.endsWith(`#event/${EVENT_ID.OPEN}`)));
});

test('a draft is not found for members but shown to admins; unknown ids are not found', async () => {
    assert.equal((await askInfo(MEMBER, EVENT_ID.DRAFT)).content, '❌ Event nicht gefunden.');
    assert.equal((await askInfo(MEMBER, 'no-such-event')).content, '❌ Event nicht gefunden.');
    const admin = await askInfo(ADMIN, EVENT_ID.DRAFT);
    assert.match(readAnswer(admin).text, /Entwurf: Halloween-Special/);
});

test('a registered member sees the own status with waitlist place or slot', async () => {
    const waitlisted = readAnswer(await askInfo(MEMBER, EVENT_ID.FULL)).text;
    assert.match(waitlisted, /Dein Status: 🕒 Warteliste – Platz \d von \d/);

    const slotted = readAnswer(await askInfo(ADMIN, EVENT_ID.ROLE)).text;
    assert.match(slotted, /Dein Status: ✅ Angemeldet · .*Schaden/);

    const none = readAnswer(await askInfo(persona('newbie'), EVENT_ID.OPEN)).text;
    assert.doesNotMatch(none, /Dein Status/);
});
