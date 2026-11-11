/**
 * Check-in through Discord (B-07): when an event with check-in starts, every
 * accepted participant gets a DM with „Einchecken“. A click checks the member
 * in with the rules of utils/checkin.js, which the code check-in of the
 * website shares. The website code stays as an alternative.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown } = require('discord.js');
const { buildEventUrl } = require('../utils/eventUrl');
const { db, doc, getDoc } = require('../firebaseAdmin');
const { checkInMember, isCheckinRunning, listCheckinInvitees, markInvited } = require('../utils/checkin');
const { withEventLock } = require('../utils/eventLock');
const { debugLog } = require('../utils/debugLog');
const { state } = require('./client');
const { sendDM } = require('./messages');
const { CHECKIN_BUTTON_PREFIX } = require('./constants');

/**
 * „Zum Event“ link button.
 *
 * @param {string} eventId -> Event document id.
 * @returns {ButtonBuilder}
 */
function buildEventLinkButton(eventId) {
    return new ButtonBuilder().setLabel('Zum Event').setStyle(ButtonStyle.Link).setURL(buildEventUrl(eventId));
}

/**
 * DM that invites a participant to check in. Never contains the check-in code.
 *
 * @param {Object} event -> Event data.
 * @param {string} eventId -> Event document id.
 * @param {Object} [options]
 * @param {boolean} [options.startText] -> The member also wants the start DM: one message with the start text.
 * @returns {{ content: string, components: ActionRowBuilder[] }} -> Classic message payload.
 */
function buildCheckinInvitation(event, eventId, { startText = false } = {}) {
    const title = escapeMarkdown(String(event.title || ''));
    const content = startText
        ? `🎯 **${title}** hat gerade begonnen! Viel Spaß!\n\n📍 Checke jetzt ein:`
        : `📍 **${title}** läuft – checke jetzt ein!`;
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CHECKIN_BUTTON_PREFIX}:${eventId}`)
            .setLabel('Einchecken')
            .setStyle(ButtonStyle.Success),
        buildEventLinkButton(eventId)
    );
    return { content, components: [row] };
}

// Answers to a refused click; `update` closes the invitation, the others answer privately
const REFUSALS = {
    over: { content: '⌛ Der Check-in für dieses Event ist vorbei.', update: true },
    not_found: { content: '❌ Dieses Event ist nicht mehr aktiv.' },
    not_active: { content: '❌ Dieses Event ist nicht mehr aktiv.' },
    disabled: { content: '❌ Check-in ist für dieses Event nicht aktiviert.' },
    not_started: { content: '⏳ Der Check-in startet mit dem Event.' },
    no_registration: { content: '❌ Du hast keine angenommene Anmeldung für dieses Event.' }
};

/**
 * Replace the invitation by its text plus a result line; only „Zum Event“ stays.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> Event document id.
 * @param {string} line -> Result line (with an optional check-in message below).
 * @returns {Promise<void>}
 */
async function closeInvitation(interaction, eventId, line) {
    const original = interaction.message?.content || '';
    await interaction.update({
        content: original ? `${original}\n\n${line}` : line,
        components: [new ActionRowBuilder().addComponents(buildEventLinkButton(eventId))]
    });
}

/**
 * Click on „Einchecken“: checks the member in while the event runs.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction (in a DM, no member).
 * @param {string} eventId -> Event document id.
 * @returns {Promise<void>}
 */
async function handleCheckinButton(interaction, eventId) {
    const result = await checkInMember({ eventId, userId: interaction.user.id, requireRunning: true });
    if (result.ok) {
        const message = String(result.event.checkinMessage || '').trim();
        const line = result.alreadyCheckedIn
            ? 'ℹ️ Du bist bereits eingecheckt.'
            : `✅ Du bist eingecheckt!${message ? `\n${message}` : ''}`;
        await closeInvitation(interaction, eventId, line);
        return;
    }
    const refusal = REFUSALS[result.code] || { content: '❌ Fehler beim Check-in.' };
    if (refusal.update) {
        await closeInvitation(interaction, eventId, refusal.content);
        return;
    }
    await interaction.reply({ content: refusal.content, flags: MessageFlags.Ephemeral });
}

/**
 * Invite every accepted participant who is neither checked in nor invited yet.
 * Each registration is marked before its DM (at most once, like the reminder
 * flags); the lock keeps a scheduler pass and a code generation from inviting twice.
 *
 * @param {string} eventId -> Event document id.
 * @param {Object} event -> Event data (title for the DM).
 * @param {Object} [options]
 * @param {Date} [options.now] -> Invitation time.
 * @param {Function} [options.send] -> DM function (userId, payload), default sendDM.
 * @param {Set<string>} [options.startRecipients] -> Members who also get the start DM: their invitation carries the start text.
 * @returns {Promise<Set<string>>} -> User ids invited in this call.
 */
function inviteToCheckin(eventId, event, { now = new Date(), send = sendDM, startRecipients = new Set() } = {}) {
    return withEventLock(`checkin:${eventId}`, async () => {
        const invited = new Set();
        for (const { id, userId, guestId } of await listCheckinInvitees(eventId)) {
            await markInvited(id, now, guestId);
            invited.add(userId);
            try {
                await send(userId, buildCheckinInvitation(event, eventId, { startText: startRecipients.has(userId) }));
            } catch (err) {
                console.error(`Check-in invitation to ${userId} failed:`, err.message);
            }
        }
        if (invited.size > 0) debugLog('bot.checkinInvitations', { eventId, count: invited.size });
        return invited;
    });
}

/**
 * Send the check-in invitations of a running event right away (code generated
 * during the event). Before the start or after the end nothing is sent.
 *
 * @param {string} eventId -> Event document id.
 * @returns {Promise<number>} -> Number of members invited; 0 while the bot is not ready.
 */
async function sendCheckinInvitations(eventId) {
    if (!state.isReady) return 0;
    try {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists() || !isCheckinRunning(eventSnap.data())) return 0;
        return (await inviteToCheckin(eventId, eventSnap.data())).size;
    } catch (err) {
        console.error('Check-in invitations error:', err.message);
        return 0;
    }
}

module.exports = {
    buildCheckinInvitation,
    handleCheckinButton,
    inviteToCheckin,
    sendCheckinInvitations
};
