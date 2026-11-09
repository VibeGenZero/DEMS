/**
 * Waitlist offers in Discord (B-15): the DM that offers a freed place with
 * „Platz annehmen“ / „Doch nicht“, and the answers to those buttons. The
 * rules (deadline, confirm, decline, expiry) live in utils/waitlistOffers.js.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown } = require('discord.js');
const { db, doc, getDoc } = require('../firebaseAdmin');
const { buildEventUrl } = require('../utils/eventUrl');
const { debugLog } = require('../utils/debugLog');
const { state } = require('./client');
const { sendDM } = require('./messages');
const { OFFER_CONFIRM_PREFIX, OFFER_DECLINE_PREFIX } = require('./constants');
const { getTimezone } = require('../utils/timezone');

/** Deadline in the server time zone, e.g. "Fr., 06.11., 20:00". */
const formatDeadline = (iso) => new Date(iso).toLocaleString('de-DE', {
    timeZone: getTimezone(), weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
});

/** „Zum Event“ link button. */
const eventLinkButton = (eventId) => new ButtonBuilder().setURL(buildEventUrl(eventId)).setLabel('Zum Event').setStyle(ButtonStyle.Link);

/**
 * The offer DM: event, deadline and the three buttons.
 *
 * @param {Object} event -> Event data.
 * @param {string} eventId -> Event document id.
 * @param {string} registrationId -> The offered registration.
 * @param {string} expiresAt -> ISO deadline.
 * @returns {{ content: string, components: Array<ActionRowBuilder> }}
 */
function buildOfferMessage(event, eventId, registrationId, expiresAt) {
    const title = escapeMarkdown(String(event.title || ''));
    const content = `🎉 Ein Platz bei **${title}** ist frei geworden! Bestätige ihn bis **${formatDeadline(expiresAt)}**, sonst rückt der Nächste nach.`;
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${OFFER_CONFIRM_PREFIX}:${registrationId}`).setLabel('Platz annehmen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${OFFER_DECLINE_PREFIX}:${registrationId}`).setLabel('Doch nicht').setStyle(ButtonStyle.Secondary),
        eventLinkButton(eventId)
    );
    return { content, components: [row] };
}

/**
 * Send the offer DM of a registration.
 *
 * @param {string} registrationId -> The offered registration.
 * @returns {Promise<boolean>} -> False while the bot is not ready, for a missing offer or a failed DM.
 */
async function sendWaitlistOffer(registrationId) {
    if (!state.isReady) return false;
    try {
        const regSnap = await getDoc(doc(db, 'registrations', registrationId));
        if (!regSnap.exists()) return false;
        const registration = regSnap.data();
        if (registration.status !== 'offered' || !registration.offer) return false;
        const eventSnap = await getDoc(doc(db, 'events', registration.eventId));
        if (!eventSnap.exists()) return false;
        debugLog('bot.sendWaitlistOffer', { registrationId, userId: registration.userId });
        return await sendDM(registration.userId,
            buildOfferMessage(eventSnap.data(), registration.eventId, registrationId, registration.offer.expiresAt));
    } catch (err) {
        console.error('Failed to send the waitlist offer:', err.message);
        return false;
    }
}

const NOT_VALID = '⌛ Das Angebot ist nicht mehr gültig.';
// Result line per outcome of a confirmation
const CONFIRMED = {
    accepted: '✅ Du bist dabei!',
    pending: '📋 Deine Anfrage wird jetzt geprüft.'
};

/**
 * The offer DM with its text plus a result line; only „Zum Event“ stays.
 *
 * @param {Object} interaction -> The button interaction.
 * @param {string|null} eventId -> Event document id, null when unknown.
 * @param {string} line -> Result line.
 * @returns {Object} -> Payload for update / editReply.
 */
function closedOffer(interaction, eventId, line) {
    const original = interaction.message?.content || '';
    return {
        content: original ? `${original}\n\n${line}` : line,
        components: eventId ? [new ActionRowBuilder().addComponents(eventLinkButton(eventId))] : []
    };
}

/**
 * „Platz annehmen“ / „Doch nicht“ in the offer DM. Only the offered member
 * may answer; the rules run in utils/waitlistOffers.js.
 *
 * @param {Object} interaction -> Button interaction (in a DM).
 * @param {boolean} confirm -> True for „Platz annehmen“.
 * @param {string} registrationId -> The offered registration.
 * @returns {Promise<void>}
 */
async function handleOfferButton(interaction, confirm, registrationId) {
    const snap = await getDoc(doc(db, 'registrations', registrationId));
    const registration = snap.exists() ? snap.data() : null;
    if (!registration || registration.status !== 'offered') {
        await interaction.update(closedOffer(interaction, registration?.eventId || null, NOT_VALID));
        return;
    }
    if (registration.userId !== interaction.user.id) {
        await interaction.reply({ content: '❌ Dieses Angebot gilt nicht für dich.', flags: MessageFlags.Ephemeral });
        return;
    }
    // Moving up sends DMs, gives roles and channel access -> can take longer than 3 seconds
    await interaction.deferUpdate();
    const { confirmOffer, declineOffer } = require('../utils/waitlistOffers');
    const result = confirm
        ? await confirmOffer({ registrationId, userId: interaction.user.id })
        : await declineOffer({ registrationId, userId: interaction.user.id });
    let line = NOT_VALID;
    if (result.ok) line = confirm ? CONFIRMED[result.status] : '👋 Alles klar, dein Platz geht an den Nächsten.';
    await interaction.editReply(closedOffer(interaction, registration.eventId, line));
}

module.exports = {
    formatDeadline,
    buildOfferMessage,
    sendWaitlistOffer,
    handleOfferButton
};
