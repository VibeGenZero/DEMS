const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('offer-buttons');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'buttons.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const { rememberBotSettings, normalizeBotSettings } = require('../utils/botSettings');
const { buildOfferMessage } = require('../bot/waitlistOffers');

after(async () => {
    await bot.client.destroy();
});

const HOUR = 60 * 60 * 1000;
const at = (ms) => new Date(Date.now() + ms).toISOString();
rememberBotSettings(normalizeBotSettings({}));

let counter = 0;
async function createEvent(fields = {}) {
    const id = `btn-event-${++counter}`;
    await setDoc(doc(db, 'events', id), {
        title: 'Koop-Abend', status: 'active', approvalMode: 'instant', maxParticipants: 1, startDate: at(72 * HOUR), ...fields
    });
    return id;
}
async function addRegistration(eventId, status, minutesAgo, fields = {}) {
    const id = `btn-reg-${++counter}`;
    await setDoc(doc(db, 'registrations', id), {
        eventId, userId: `btn-user-${counter}`, userName: `User ${counter}`, status, guests: [], pendingGuests: [],
        createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), ...fields
    });
    return id;
}
const offerUntil = (ms) => ({ offeredAt: new Date().toISOString(), expiresAt: at(ms) });
const registrationOf = async (id) => {
    const snap = await getDoc(doc(db, 'registrations', id));
    return snap.exists() ? snap.data() : null;
};

/** Click a DM button as a user; returns the last answer payload. */
async function click(customId, userId) {
    const interaction = createFakeInteraction({ kind: 'button', customId, userId });
    interaction.message = { content: '🎉 Ein Platz bei **Koop-Abend** ist frei geworden!' };
    await dispatchInteraction(bot.client, interaction);
    for (let i = 0; i < 100 && !['editReply', 'update', 'reply'].includes(interaction.calls.at(-1)[0]); i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return { calls: interaction.calls, answer: interaction.calls.at(-1)[1] };
}
const buttonsOf = (payload) => (payload.components || []).flatMap(row => row.toJSON().components).map(button => button.label);

test('the offer DM names the deadline and offers confirm, decline and the event', () => {
    const message = buildOfferMessage({ title: 'Koop-Abend' }, 'ev1', 'reg1', '2026-11-06T19:00:00.000Z');
    assert.match(message.content, /Ein Platz bei \*\*Koop-Abend\*\* ist frei geworden/);
    assert.match(message.content, /Fr\., 06\.11\., 20:00/);
    const [row] = message.components.map(component => component.toJSON());
    assert.deepEqual(row.components.map(button => [button.label, button.custom_id || button.url]), [
        ['Platz annehmen', 'offer_confirm:reg1'],
        ['Doch nicht', 'offer_decline:reg1'],
        ['Zum Event', 'http://localhost:3000/#event/ev1']
    ]);
});

test('„Platz annehmen“ accepts and leaves only the event link', async () => {
    const eventId = await createEvent();
    const reg = await addRegistration(eventId, 'offered', 30, { offer: offerUntil(HOUR) });
    const { calls, answer } = await click(`offer_confirm:${reg}`, (await registrationOf(reg)).userId);
    assert.equal(calls[0][0], 'deferUpdate');
    assert.match(answer.content, /✅ Du bist dabei!/);
    assert.match(answer.content, /Ein Platz bei/, 'keeps the DM text');
    assert.deepEqual(buttonsOf(answer), ['Zum Event']);
    assert.equal((await registrationOf(reg)).status, 'accepted');
});

test('for a manual event the answer says the request is checked', async () => {
    const eventId = await createEvent({ approvalMode: 'manual' });
    const reg = await addRegistration(eventId, 'offered', 30, { offer: offerUntil(HOUR) });
    const { answer } = await click(`offer_confirm:${reg}`, (await registrationOf(reg)).userId);
    assert.match(answer.content, /📋 Deine Anfrage wird jetzt geprüft\./);
    assert.equal((await registrationOf(reg)).status, 'pending');
});

test('„Doch nicht“ removes the registration and offers the place to the next', async () => {
    const eventId = await createEvent();
    const reg = await addRegistration(eventId, 'offered', 30, { offer: offerUntil(HOUR) });
    const next = await addRegistration(eventId, 'waitlisted', 20);
    const { answer } = await click(`offer_decline:${reg}`, (await registrationOf(reg)).userId);
    assert.match(answer.content, /👋 Alles klar, dein Platz geht an den Nächsten\./);
    assert.deepEqual(buttonsOf(answer), ['Zum Event']);
    assert.equal(await registrationOf(reg), null);
    assert.equal((await registrationOf(next)).status, 'offered');
});

test('a click after the deadline or on a removed offer is no longer valid', async () => {
    const eventId = await createEvent();
    const late = await addRegistration(eventId, 'offered', 30, { offer: offerUntil(-60_000) });
    const expired = await click(`offer_confirm:${late}`, (await registrationOf(late)).userId);
    assert.match(expired.answer.content, /⌛ Das Angebot ist nicht mehr gültig\./);
    assert.deepEqual(buttonsOf(expired.answer), ['Zum Event']);
    assert.equal((await registrationOf(late)).status, 'offered', 'the expiry pass removes it');

    const removed = await click('offer_confirm:btn-reg-none', 'btn-user-x');
    assert.match(removed.answer.content, /⌛ Das Angebot ist nicht mehr gültig\./);
});

test('another user cannot answer the offer', async () => {
    const eventId = await createEvent();
    const reg = await addRegistration(eventId, 'offered', 30, { offer: offerUntil(HOUR) });
    const { calls, answer } = await click(`offer_confirm:${reg}`, 'intruder');
    assert.equal(calls.at(-1)[0], 'reply');
    assert.equal(answer.content, '❌ Dieses Angebot gilt nicht für dich.');
    assert.equal((await registrationOf(reg)).status, 'offered');
});
