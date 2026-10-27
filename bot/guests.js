/**
 * Guest invitations in Discord: the invitation DM with Accept/Decline buttons
 * and the answer to those buttons.
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { db, doc, getDoc, updateDoc } = require('../firebaseAdmin');
const { sendAutomaticDM } = require('../utils/botSettings');
const { buildEventUrl } = require('../utils/eventUrl');
const { parseTemplate } = require('../utils/template');
const { client, state } = require('./client');
const { TIMEZONE } = require('./constants');

/**
 * Send a guest invitation DM with Accept/Decline buttons
 * @param {string} guestUserId - Discord ID of the invited guest
 * @param {Object} registrant - {id, displayName} of the person sending the invite
 * @param {Object} event - event object with title and id
 * @param {string} registrationId - Firestore registration document ID
 */
async function sendGuestInvitation(guestUserId, registrant, event, registrationId) {
    if (!state.isReady) return false;
    try {
        const user = await client.users.fetch(guestUserId);

        const embed = new EmbedBuilder()
            .setTitle('🎟️ Gäste-Einladung erhalten')
            .setColor(0x8b5cf6)
            .setDescription(
                `**${registrant.displayName}** hat dich als Gast zum Event eingeladen.\n\n` +
                `**Event:** ${event.title}\n` +
                (event.startDate ? `**Datum:** ${new Date(event.startDate).toLocaleString('de-DE', { timeZone: TIMEZONE })}\n` : '') +
                `\nMöchtest du die Einladung annehmen?`
            )
            .addFields({ name: '🔗 Event', value: `[Zur Event-Seite](${buildEventUrl(event.id)})` })
            .setFooter({ text: 'DEMS — Event Management' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`guest_accept:${registrationId}:${guestUserId}`)
                .setLabel('Annehmen')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
            new ButtonBuilder()
                .setCustomId(`guest_decline:${registrationId}:${guestUserId}`)
                .setLabel('Ablehnen')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌')
        );

        await user.send({ embeds: [embed], components: [row] });
        state.dmsSent++;
        return true;
    } catch (err) {
        console.error(`Failed to send guest invitation to ${guestUserId}:`, err.message);
        return false;
    }
}

/**
 * Answer the Accept/Decline buttons of a guest invitation DM. Only the invited
 * user may answer; accepting adds the guest, declining frees the place.
 *
 * @param {Object} interaction -> Button interaction (`guest_accept:…` or `guest_decline:…`).
 * @param {string} action -> `guest_accept` or `guest_decline`.
 * @param {string} registrationId -> Registration of the inviting member.
 * @param {string} guestId -> Discord ID of the invited guest.
 */
async function handleGuestButton(interaction, action, registrationId, guestId) {
    // Only allow the invited user to respond
    if (interaction.user.id !== guestId) {
        return interaction.reply({ content: '❌ Diese Einladung ist nicht für dich.', flags: MessageFlags.Ephemeral });
    }
    try {
        const regRef = doc(db, 'registrations', registrationId);
        const regSnap = await getDoc(regRef);
        if (!regSnap.exists()) {
            return interaction.update({ content: '❌ Registrierung nicht mehr vorhanden.', components: [] });
        }
        const reg = regSnap.data();

        // Find this guest in pendingGuests
        const pendingGuests = reg.pendingGuests || [];
        const guestIndex = pendingGuests.findIndex(g => g.userId === guestId);
        if (guestIndex === -1) {
            return interaction.update({ content: '⚠️ Einladung bereits bearbeitet.', components: [] });
        }

        if (action === 'guest_accept') {
            // Move from pendingGuests to guests
            pendingGuests[guestIndex].status = 'accepted';
            const guests = reg.guests || [];
            if (!guests.includes(guestId)) guests.push(guestId);
            await updateDoc(regRef, { pendingGuests, guests });

            // Notify registrant
            const inviteeName = pendingGuests[guestIndex].displayName || guestId;
            await sendAutomaticDM(reg.userId, `✅ **${inviteeName}** hat deine Gäste-Einladung für das Event angenommen!`);

            // Send configured acceptance message to the guest
            try {
                const eventSnap = await getDoc(doc(db, 'events', reg.eventId));
                const event = eventSnap.exists() ? eventSnap.data() : {};
                const templateSnap = await getDoc(doc(db, 'botMessages', 'templates'));
                const globalTemplates = templateSnap.exists() ? templateSnap.data() : {};
                const customMsgs = event.customBotMessages || {};
                const eventUrl = buildEventUrl(reg.eventId);
                const vars = {
                    'user.id': guestId,
                    'user.name': inviteeName,
                    'user.mention': `<@${guestId}>`,
                    'event.title': event.title || 'Unbekanntes Event',
                    'event.url': eventUrl,
                    'role.name': '',
                    'role.mention': ''
                };
                const template = customMsgs.accepted || globalTemplates.accepted;
                const msg = template
                    ? parseTemplate(template, vars)
                    : `✅ Du wurdest als Gast für **${event.title || 'das Event'}** eingetragen!`;
                await sendAutomaticDM(guestId, msg);
            } catch (msgErr) {
                console.error('Failed to send guest acceptance message:', msgErr);
            }

            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Einladung angenommen')
                    .setColor(0x22c55e)
                    .setDescription('Du wurdest als Gast eingetragen. Viel Spaß beim Event!')
                ],
                components: []
            });
        } else {
            // Remove from pendingGuests
            pendingGuests.splice(guestIndex, 1);
            await updateDoc(regRef, { pendingGuests });
            // The open invitation no longer reserves a place
            require('../utils/announcementRefresh').notifyRegistrationsChanged(reg.eventId);

            // Notify registrant
            await sendAutomaticDM(reg.userId, `❌ Deine Gäste-Einladung wurde abgelehnt.`);

            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Einladung abgelehnt')
                    .setColor(0xef4444)
                    .setDescription('Du hast die Einladung abgelehnt.')
                ],
                components: []
            });

            // The declined invitation frees a place -> the waitlist may move up
            const declinedEventSnap = await getDoc(doc(db, 'events', reg.eventId));
            if (declinedEventSnap.exists()) {
                const { promoteFromWaitlist } = require('../utils/eventUtils');
                await promoteFromWaitlist(reg.eventId, declinedEventSnap.data());
            }
        }
    } catch (err) {
        console.error('Guest invitation button error:', err);
        try { await interaction.reply({ content: '❌ Fehler beim Verarbeiten der Einladung.', flags: MessageFlags.Ephemeral }); } catch {}
    }
}

module.exports = {
    sendGuestInvitation,
    handleGuestButton
};
