const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('discord-approvals');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'approvals.sqlite');

const bot = require('../bot');
const { db, collection, doc, getDoc, getDocs, setDoc } = require('../firebaseAdmin');
const { changeRegistrationStatus } = require('../utils/registrationStatus');

after(async () => {
    await bot.client.destroy();
});

const HOUR = 60 * 60 * 1000;
const inHours = (hours) => new Date(Date.now() + hours * HOUR).toISOString();
const ADMIN = { id: 'admin-1', displayName: 'Mori' };

async function seedEvent(id, fields = {}) {
    await setDoc(doc(db, 'events', id), {
        title: `Event ${id}`, status: 'active', approvalMode: 'manual', maxParticipants: 5,
        startDate: inHours(48), endDate: inHours(50), ...fields
    });
}

async function seedRegistration(id, eventId, userId, fields = {}) {
    await setDoc(doc(db, 'registrations', id), {
        eventId, userId, userName: userId, guests: [], pendingGuests: [], formAnswers: {}, source: 'web',
        status: 'pending', createdAt: inHours(-24), ...fields
    });
}

const statusOf = async (id) => (await getDoc(doc(db, 'registrations', id))).data().status;

async function auditLogsFor(targetId) {
    return (await getDocs(collection(db, 'auditLogs'))).docs.map(d => d.data()).filter(log => log.targetId === targetId);
}

// ── Shared status change ────────────────────────────────────────────────

test('a pending request is accepted and the audit log names the admin', async () => {
    await seedEvent('svc-accept');
    await seedRegistration('svc-accept-reg', 'svc-accept', 'svc-user');

    const result = await changeRegistrationStatus({ registrationId: 'svc-accept-reg', status: 'accepted', actor: ADMIN, expectStatus: 'pending' });

    assert.equal(result.ok, true);
    assert.equal(await statusOf('svc-accept-reg'), 'accepted');
    const logs = await auditLogsFor('svc-accept-reg');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].adminId, 'admin-1');
});

test('a request that is no longer pending stays as it is', async () => {
    await seedEvent('svc-decided');
    await seedRegistration('svc-decided-reg', 'svc-decided', 'svc-user', { status: 'accepted' });

    const result = await changeRegistrationStatus({ registrationId: 'svc-decided-reg', status: 'rejected', actor: ADMIN, expectStatus: 'pending' });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'already_decided');
    assert.equal(result.registration.status, 'accepted');
    assert.equal(await statusOf('svc-decided-reg'), 'accepted');
    assert.equal((await auditLogsFor('svc-decided-reg')).length, 0);
});

test('an unknown registration is reported as not found', async () => {
    const result = await changeRegistrationStatus({ registrationId: 'svc-missing', status: 'accepted', actor: ADMIN });
    assert.deepEqual([result.ok, result.code], [false, 'not_found']);
});

// ── Request message ─────────────────────────────────────────────────────

const { MessageFlags } = require('discord.js');
const { buildEventUrl } = require('../utils/eventUrl');
const { textLength } = require('../bot/layout');
const { buildApprovalMessage } = require('../bot/approvals');

const RAID = {
    title: 'Raid-Abend', startDate: '2026-12-04T18:00:00.000Z', approvalMode: 'manual',
    slots: [{ id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 }, { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2 }]
};
const REQUEST = {
    id: 'req-1', eventId: 'raid-1', userId: '300000000000000001', userName: 'Thrallfan', status: 'pending',
    slotId: null, preferredSlotId: 'tank', guests: ['300000000000000002'],
    pendingGuests: [{ userId: '300000000000000003', displayName: 'Jaina', status: 'pending' }],
    formAnswers: { Charakter: 'Thrall', Erfahrung: '2 Jahre' }
};

/** Text and buttons of a request message. */
function partsOf(message) {
    const json = message.components.map(component => component.toJSON());
    const flat = [];
    const walk = (list) => list.forEach(component => { flat.push(component); walk(component.components || []); });
    walk(json);
    return {
        accent: json[0].accent_color,
        text: flat.filter(c => c.type === 10).map(c => c.content).join('\n'),
        buttons: flat.filter(c => c.type === 2).map(c => ({ label: c.label, id: c.custom_id || null, url: c.url || null }))
    };
}

test('a request names event, member, wish, guests and answers and offers the decisions', () => {
    const message = buildApprovalMessage(REQUEST, RAID);
    const { accent, text, buttons } = partsOf(message);

    assert.equal(message.flags, MessageFlags.IsComponentsV2);
    assert.equal(accent, 0xf59e0b);
    assert.match(text, /Neue Anfrage: Raid-Abend/);
    assert.ok(text.includes(new Date(RAID.startDate).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })));
    assert.match(text, /<@300000000000000001>/);
    assert.match(text, /Wunsch: 🛡️ Tank/);
    assert.match(text, /<@300000000000000002>/);
    assert.match(text, /Jaina/);
    assert.match(text, /\*\*Charakter:\*\* Thrall/);
    assert.match(text, /\*\*Erfahrung:\*\* 2 Jahre/);
    assert.deepEqual(buttons, [
        { label: 'Annehmen', id: 'approval_accept:req-1', url: null },
        { label: 'Ablehnen', id: 'approval_reject:req-1', url: null },
        { label: 'Warteliste', id: 'approval_waitlist:req-1', url: null },
        { label: 'Zum Event', id: null, url: buildEventUrl('raid-1') }
    ]);
});

test('long answers are cut and the message stays within Discord limits', () => {
    const long = { ...REQUEST, formAnswers: { Bewerbung: 'x'.repeat(3000), Rest: 'y'.repeat(3000) } };
    const message = buildApprovalMessage(long, RAID);
    const { text } = partsOf(message);
    assert.match(text, /x…/);
    assert.ok(textLength(message) <= 4000);
});

test('a closed request keeps the link and names the result instead of the buttons', () => {
    const outcomes = {
        accepted: '✅ Angenommen von Mori',
        rejected: '❌ Abgelehnt von Mori',
        waitlisted: '🕒 Auf die Warteliste gesetzt von Mori',
        withdrawn: '↩️ Vom Mitglied zurückgezogen',
        cancelled: '🚫 Event abgesagt',
        deleted: '🗑️ Event gelöscht'
    };
    for (const [status, line] of Object.entries(outcomes)) {
        const { accent, text, buttons } = partsOf(buildApprovalMessage(REQUEST, RAID, { status, actorName: 'Mori' }));
        assert.ok(text.includes(line), status);
        assert.equal(accent, 0x6b7280, status);
        assert.deepEqual(buttons.map(button => button.label), ['Zum Event'], status);
    }
});

// ── Posting requests ────────────────────────────────────────────────────

const { CHANNEL_ID } = require('../dev/mockGuild');
const { normalizeBotSettings, rememberBotSettings } = require('../utils/botSettings');
const { registerUserForEvent } = require('../utils/registrationService');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function withApprovalChannel(channelId, fn) {
    rememberBotSettings(normalizeBotSettings({ approvalChannel: channelId }));
    try {
        await fn();
    } finally {
        rememberBotSettings(normalizeBotSettings({}));
    }
}

/** Mock log lines written while `fn` runs. */
async function captureLog(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => { lines.push(args.map(String).join(' ')); };
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines;
}

async function registrationOf(eventId, userId) {
    const all = (await getDocs(collection(db, 'registrations'))).docs.map(d => ({ id: d.id, ...d.data() }));
    return all.find(registration => registration.eventId === eventId && registration.userId === userId);
}

async function waitForApprovalMessage(eventId, userId, timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const registration = await registrationOf(eventId, userId);
        if (registration && registration.approvalMessage) return registration;
        await sleep(20);
    }
    return registrationOf(eventId, userId);
}

const member = (id) => ({ id, displayName: `Name ${id}`, roles: [] });

test('a new pending registration is posted to the approval channel', async () => {
    await seedEvent('post-manual', { title: 'Freigabe-Abend' });
    let registration;
    const lines = await captureLog(() => withApprovalChannel(CHANNEL_ID.EVENTS, async () => {
        const result = await registerUserForEvent({ eventId: 'post-manual', user: member('post-user') });
        assert.equal(result.status, 'pending');
        registration = await waitForApprovalMessage('post-manual', 'post-user');
    }));

    assert.equal(registration.approvalMessage.channelId, CHANNEL_ID.EVENTS);
    assert.match(registration.approvalMessage.messageId, /^\d+$/);
    assert.ok(lines.some(line => line.includes('Freigabe-Anfrage in #events') && line.includes('Freigabe-Abend')), lines.join('\n'));
});

test('moving up into a manual event posts a request too', async () => {
    await seedEvent('post-promote', { maxParticipants: 1 });
    await seedRegistration('post-promote-a', 'post-promote', 'post-a', { status: 'accepted' });
    await seedRegistration('post-promote-b', 'post-promote', 'post-b', { status: 'waitlisted' });

    await captureLog(() => withApprovalChannel(CHANNEL_ID.EVENTS, async () => {
        await changeRegistrationStatus({ registrationId: 'post-promote-a', status: 'rejected', actor: ADMIN });
    }));

    const promoted = (await getDoc(doc(db, 'registrations', 'post-promote-b'))).data();
    assert.equal(promoted.status, 'pending');
    assert.equal(promoted.approvalMessage.channelId, CHANNEL_ID.EVENTS);
});

test('instant events and an empty approval channel post nothing', async () => {
    await seedEvent('post-instant', { approvalMode: 'instant' });
    await seedEvent('post-nochannel');
    await captureLog(async () => {
        await withApprovalChannel(CHANNEL_ID.EVENTS, () => registerUserForEvent({ eventId: 'post-instant', user: member('post-c') }));
        await registerUserForEvent({ eventId: 'post-nochannel', user: member('post-d') });
        await sleep(200);
    });
    assert.equal((await registrationOf('post-instant', 'post-c')).approvalMessage, undefined);
    assert.equal((await registrationOf('post-nochannel', 'post-d')).approvalMessage, undefined);
});

// ── Decision buttons ────────────────────────────────────────────────────

const { createFakeInteraction, dispatchInteraction } = require('./helpers');

/** Click a decision button and wait for the private answer after the defer. */
// Mock mode sets DISCORD_ADMIN_ROLE_ID to the admin role of the mock server
async function click(action, registrationId, { userId = 'admin-1', roles = [process.env.DISCORD_ADMIN_ROLE_ID] } = {}) {
    const interaction = createFakeInteraction({ kind: 'button', customId: `${action}:${registrationId}`, userId, roles });
    const lines = await captureLog(async () => {
        await dispatchInteraction(bot.client, interaction);
        const start = Date.now();
        while (!interaction.calls.some(([name]) => name === 'editReply') && Date.now() - start < 3000) await sleep(10);
    });
    const answer = interaction.calls.find(([name]) => name === 'editReply' || name === 'reply');
    return { interaction, answer: answer && answer[1].content, lines };
}

test('members without the admin role cannot decide', async () => {
    await seedEvent('btn-guard');
    await seedRegistration('btn-guard-reg', 'btn-guard', 'btn-user');

    const { answer } = await click('approval_accept', 'btn-guard-reg', { userId: 'btn-other', roles: ['role-member'] });

    assert.equal(answer, '⛔ Nur Admins können Anmeldungen freigeben.');
    assert.equal(await statusOf('btn-guard-reg'), 'pending');
});

test('"Annehmen" accepts, sends the DM and logs the admin', async () => {
    await seedEvent('btn-accept', { title: 'Annahme-Abend' });
    await seedRegistration('btn-accept-reg', 'btn-accept', 'btn-user');

    const { interaction, answer, lines } = await click('approval_accept', 'btn-accept-reg');

    assert.equal(interaction.calls[0][0], 'deferReply');
    assert.equal(answer, '✅ Angenommen.');
    assert.equal(await statusOf('btn-accept-reg'), 'accepted');
    assert.ok(lines.some(line => line.includes('DM an')), 'acceptance DM');
    assert.equal((await auditLogsFor('btn-accept-reg'))[0].adminId, 'admin-1');
});

test('"Ablehnen" rejects and lets the waitlist move up, "Warteliste" waitlists', async () => {
    await seedEvent('btn-reject', { maxParticipants: 1 });
    await seedRegistration('btn-reject-reg', 'btn-reject', 'btn-user');
    await seedRegistration('btn-reject-wait', 'btn-reject', 'btn-waiting', { status: 'waitlisted' });
    await seedEvent('btn-wait');
    await seedRegistration('btn-wait-reg', 'btn-wait', 'btn-user');

    assert.equal((await click('approval_reject', 'btn-reject-reg')).answer, '❌ Abgelehnt.');
    assert.equal(await statusOf('btn-reject-reg'), 'rejected');
    assert.equal(await statusOf('btn-reject-wait'), 'pending');

    assert.equal((await click('approval_waitlist', 'btn-wait-reg')).answer, '🕒 Auf die Warteliste gesetzt.');
    assert.equal(await statusOf('btn-wait-reg'), 'waitlisted');
});

test('a click on a decided request changes nothing and tells the current status', async () => {
    await seedEvent('btn-late');
    await seedRegistration('btn-late-reg', 'btn-late', 'btn-user', { status: 'accepted' });

    const { answer } = await click('approval_reject', 'btn-late-reg');

    assert.equal(answer, 'ℹ️ Bereits entschieden: Angenommen.');
    assert.equal(await statusOf('btn-late-reg'), 'accepted');
});
