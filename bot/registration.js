/**
 * Registration through Discord: the "Anmelden" button and modal, the slot buttons
 * and modals, switching and leaving a slot.
 */
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { db, collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where } = require('../firebaseAdmin');
const { debugLog } = require('../utils/debugLog');
const { buildEventUrl } = require('../utils/eventUrl');
const { isEventOver, isRegistrationClosed, REGISTRATION_CLOSED_MESSAGE } = require('../utils/eventListing');
const { isRegistrationBlocked } = require('../middleware/maintenance');
const { MODAL_MAX_FIELDS, getFormFields, fitsIntoDiscordModal, getModalFieldLimit } = require('../utils/formFields');
const { getSlots, findSlot, formatSlotLabel } = require('../utils/slotService');
const { getUserRoles } = require('./guild');
const { buildRegistrationModal, buildSlotModal, readAltSlotIds, buildRegisteredSlotReply, parseModalAnswers } = require('./registrationModal');
const { canRegisterViaDiscord } = require('./messages');

// Registrations that are currently being processed -> guards against double clicks
const pendingDiscordRegistrations = new Set();

/**
 * Read the Discord role IDs of the interacting member.
 *
 * @param {import('discord.js').Interaction} interaction -> The interaction to inspect.
 * @returns {Promise<string[]>} -> Role IDs of the member, empty when unknown.
 */
async function resolveInteractionRoles(interaction) {
    const member = interaction.member;
    if (member && member.roles && member.roles.cache) {
        return member.roles.cache.map(role => role.id);
    }
    if (member && Array.isArray(member.roles)) {
        return member.roles;
    }
    const roles = await getUserRoles(interaction.user.id, process.env.DISCORD_GUILD_ID);
    return roles.map(role => role.id);
}

/**
 * Make sure the Discord user exists in the users collection.
 *
 * Users that register from Discord may never have logged into the web
 * interface -> without a profile they would show up without name and avatar
 * in the participant list.
 *
 * @param {import('discord.js').User} user -> The Discord user.
 * @param {string} displayName -> Display name to store.
 * @returns {Promise<void>} -> Resolves once the profile was written.
 */
async function ensureUserProfile(user, displayName) {
    try {
        const userRef = doc(db, 'users', user.id);
        const userSnap = await getDoc(userRef);
        const avatarUrl = typeof user.displayAvatarURL === 'function'
            ? user.displayAvatarURL({ extension: 'png', size: 128 })
            : '';
        const now = new Date().toISOString();

        if (!userSnap.exists()) {
            await setDoc(userRef, {
                id: user.id,
                username: user.username,
                displayName,
                avatar: avatarUrl,
                acceptInvitations: true,
                createdAt: now,
                updatedAt: now
            });
            return;
        }

        await updateDoc(userRef, {
            username: user.username,
            displayName,
            avatar: avatarUrl,
            updatedAt: now
        });
    } catch (err) {
        console.error('Failed to store user profile:', err.message);
    }
}

/**
 * Check the conditions that can be verified before the modal is shown.
 *
 * @param {Object} params -> Check input.
 * @param {Object} params.event -> The event document data.
 * @param {string} params.eventId -> The event document ID.
 * @param {string} params.userId -> Discord user ID.
 * @param {string[]} params.roleIds -> Discord role IDs of the user.
 * @returns {Promise<string|null>} -> Error message, or null when all conditions match.
 */
async function checkRegistrationConditions({ event, eventId, userId, roleIds }) {
    if (await isRegistrationBlocked()) {
        return 'Event-Registrierungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.';
    }

    if (event.status && event.status !== 'active') {
        return 'Dieses Event akzeptiert keine Anmeldungen.';
    }

    if (isEventOver(event)) {
        return 'Das Event ist schon vorbei.';
    }

    if (isRegistrationClosed(event)) {
        return REGISTRATION_CLOSED_MESSAGE;
    }

    const existingQ = query(
        collection(db, 'registrations'),
        where('eventId', '==', eventId),
        where('userId', '==', userId)
    );
    const existingSnap = await getDocs(existingQ);
    if (!existingSnap.empty) {
        return 'Du bist bereits für dieses Event registriert.';
    }

    if (event.accessMode === 'role-required' && Array.isArray(event.requiredRoles) && event.requiredRoles.length > 0) {
        const hasRole = event.requiredRoles.some(roleId => roleIds.includes(roleId));
        if (!hasRole) {
            return 'Du hast nicht die erforderliche Rolle für dieses Event.';
        }
    }

    return null;
}

/**
 * Create the registration and answer the interaction with the result.
 *
 * @param {import('discord.js').Interaction} interaction -> Button or modal interaction.
 * @param {Object} params -> Registration input.
 * @param {string} params.eventId -> The event document ID.
 * @param {Object} params.event -> The event document data.
 * @param {string[]} params.roleIds -> Discord role IDs of the user.
 * @param {Object} params.formAnswers -> Answers keyed by form field label.
 * @returns {Promise<void>} -> Resolves once the interaction was answered.
 */
async function completeDiscordRegistration(interaction, { eventId, event, roleIds, formAnswers, slotId = null, altSlotIds = [] }) {
    const { registerUserForEvent, REGISTRATION_SOURCE } = require('../utils/registrationService');
    const displayName = interaction.member?.displayName
        || interaction.user.globalName
        || interaction.user.username;

    const pendingKey = `${eventId}:${interaction.user.id}`;
    if (pendingDiscordRegistrations.has(pendingKey)) {
        await interaction.editReply({ content: '⏳ Deine Anmeldung wird bereits verarbeitet.' });
        return;
    }
    pendingDiscordRegistrations.add(pendingKey);

    let result;
    try {
        result = await registerUserForEvent({
            eventId,
            user: { id: interaction.user.id, displayName, roles: roleIds },
            formAnswers,
            guests: [],
            source: REGISTRATION_SOURCE.DISCORD,
            slotId,
            altSlotIds
        });
    } finally {
        pendingDiscordRegistrations.delete(pendingKey);
    }

    if (!result.ok) {
        await interaction.editReply({ content: `❌ ${result.error}` });
        return;
    }

    // Store the profile so the participant shows up with name and avatar in the web interface
    await ensureUserProfile(interaction.user, displayName);

    const slots = getSlots(event);
    const slot = findSlot(slots, result.slotId);
    const wantedSlot = findSlot(slots, slotId);
    const placement = slot ? ` als **${formatSlotLabel(slot)}**` : '';
    const altNote = result.isAlt && wantedSlot ? ` (${formatSlotLabel(wantedSlot)} war voll)` : '';
    const statusDescriptions = {
        accepted: `Du bist für **${event.title}**${placement} angemeldet${altNote}. Deine Anmeldung ist ab sofort auch im Event-System sichtbar.`,
        pending: `Deine Anfrage für **${event.title}**${placement}${altNote} ist eingegangen und wartet auf Bestätigung. Du siehst den Status im Event-System.`,
        waitlisted: slots.length > 0
            ? `Für **${event.title}** sind gerade alle gewünschten Slots belegt — du stehst auf der Warteliste und rückst automatisch nach.`
            : `**${event.title}** ist aktuell voll — du stehst auf der Warteliste und rückst automatisch nach.`
    };
    const statusColors = { accepted: 0x22c55e, pending: 0xf59e0b, waitlisted: 0x8b5cf6 };
    const statusTitles = {
        accepted: '✅ Anmeldung bestätigt',
        pending: '📋 Anfrage eingegangen',
        waitlisted: '🕒 Auf der Warteliste'
    };

    const embed = new EmbedBuilder()
        .setTitle(statusTitles[result.status] || '✅ Anmeldung')
        .setColor(statusColors[result.status] || 0x8b5cf6)
        .setDescription(statusDescriptions[result.status] || result.message)
        .addFields({ name: '🔗 Event-Seite', value: `[Zur Übersicht](${buildEventUrl(eventId)})` })
        .setFooter({ text: 'DEMS — Event Management' })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle a click on the "Anmelden" button of an event announcement.
 *
 * All conditions are checked before a form is shown, so nobody fills in a
 * modal just to be rejected afterwards.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID from the custom ID.
 * @returns {Promise<void>} -> Resolves once the interaction was answered.
 */
async function handleEventRegisterButton(interaction, eventId) {
    debugLog('bot.registerButton', { eventId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }

    const event = eventSnap.data();
    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });

    if (conditionError) {
        return interaction.reply({ content: `❌ ${conditionError}`, flags: MessageFlags.Ephemeral });
    }

    const formFields = getFormFields(event);

    if (formFields.length > 0) {
        if (!fitsIntoDiscordModal(event)) {
            return interaction.reply({
                content: `📝 Für dieses Event ist das Formular zu umfangreich für Discord (max. ${MODAL_MAX_FIELDS} Felder). Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
                flags: MessageFlags.Ephemeral
            });
        }
        return interaction.showModal(buildRegistrationModal(event, eventId));
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await completeDiscordRegistration(interaction, { eventId, event, roleIds, formAnswers: {} });
}

/**
 * Handle the submitted registration modal of an event.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @param {string} eventId -> The event document ID from the custom ID.
 * @returns {Promise<void>} -> Resolves once the interaction was answered.
 */
async function handleEventRegisterModal(interaction, eventId) {
    debugLog('bot.registerModal', { eventId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }

    const event = eventSnap.data();

    if (isEventOver(event)) {
        return interaction.reply({ content: 'Das Event ist schon vorbei.', flags: MessageFlags.Ephemeral });
    }
    // The modal may have been opened before the registration deadline (W-03)
    if (isRegistrationClosed(event)) {
        return interaction.reply({ content: REGISTRATION_CLOSED_MESSAGE, flags: MessageFlags.Ephemeral });
    }

    // The form may have been changed while the modal was open
    if (!canRegisterViaDiscord(event)) {
        return interaction.reply({
            content: `📝 Das Formular dieses Events hat sich geändert. Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const { answers, errors } = parseModalAnswers(interaction, event);

    if (errors.length > 0) {
        return interaction.reply({
            content: `❌ Bitte korrigiere deine Angaben:\n${errors.map(e => `• ${e}`).join('\n')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) {
        return interaction.editReply({ content: `❌ ${conditionError}` });
    }

    await completeDiscordRegistration(interaction, { eventId, event, roleIds, formAnswers: answers });
}

/**
 * Answer a failed interaction without throwing.
 *
 * @param {import('discord.js').Interaction} interaction -> The interaction.
 * @param {string} [content] -> Error text.
 * @returns {Promise<void>}
 */
async function replyWithFailure(interaction, content = '❌ Fehler bei der Anmeldung.') {
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content });
        } else {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
    } catch { /* interaction already expired */ }
}

/**
 * Handle a click on a slot button of an event announcement.
 *
 * Registered members get their status with switch/leave buttons; everybody
 * else is checked and gets the slot modal (or is registered directly when
 * there is nothing to ask).
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @param {string} slotId -> The clicked slot.
 * @returns {Promise<void>}
 */
async function handleEventSlotButton(interaction, eventId, slotId) {
    debugLog('bot.slotButton', { eventId, slotId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }
    const event = eventSnap.data();
    const slot = findSlot(getSlots(event), slotId);
    if (!slot) {
        return interaction.reply({
            content: `❌ Diesen Slot gibt es nicht mehr. Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const { loadEventRegistrations } = require('../utils/eventUtils');
    const registrations = await loadEventRegistrations(eventId);
    const registration = registrations.find(entry => entry.userId === interaction.user.id);
    if (registration) {
        return interaction.reply(buildRegisteredSlotReply(event, eventId, registration, slot, registrations));
    }

    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) {
        return interaction.reply({ content: `❌ ${conditionError}`, flags: MessageFlags.Ephemeral });
    }

    const needsModal = getFormFields(event).length > 0 || getSlots(event).length > 1;
    if (needsModal) {
        if (!fitsIntoDiscordModal(event)) {
            return interaction.reply({
                content: `📝 Für dieses Event ist das Formular zu umfangreich für Discord (max. ${getModalFieldLimit(event)} Felder). Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
                flags: MessageFlags.Ephemeral
            });
        }
        return interaction.showModal(buildSlotModal(event, eventId, slot));
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await completeDiscordRegistration(interaction, { eventId, event, roleIds, formAnswers: {}, slotId, altSlotIds: [] });
}

/**
 * Handle the submitted slot modal.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @param {string} eventId -> The event document ID.
 * @param {string} slotId -> The slot of the clicked button.
 * @returns {Promise<void>}
 */
async function handleEventSlotModal(interaction, eventId, slotId) {
    debugLog('bot.slotModal', { eventId, slotId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }
    const event = eventSnap.data();

    if (isEventOver(event)) {
        return interaction.reply({ content: 'Das Event ist schon vorbei.', flags: MessageFlags.Ephemeral });
    }
    // The modal may have been opened before the registration deadline (W-03)
    if (isRegistrationClosed(event)) {
        return interaction.reply({ content: REGISTRATION_CLOSED_MESSAGE, flags: MessageFlags.Ephemeral });
    }

    // Slots or the form may have changed while the modal was open
    if (!canRegisterViaDiscord(event) || !findSlot(getSlots(event), slotId)) {
        return interaction.reply({
            content: `📝 Das Event hat sich geändert. Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const { answers, errors } = parseModalAnswers(interaction, event);
    if (errors.length > 0) {
        return interaction.reply({
            content: `❌ Bitte korrigiere deine Angaben:\n${errors.map(e => `• ${e}`).join('\n')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) {
        return interaction.editReply({ content: `❌ ${conditionError}` });
    }

    await completeDiscordRegistration(interaction, {
        eventId, event, roleIds, formAnswers: answers, slotId, altSlotIds: readAltSlotIds(interaction)
    });
}

/**
 * Handle "Zu <Slot> wechseln" in the ephemeral status answer.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @param {string} slotId -> Target slot.
 * @returns {Promise<void>}
 */
async function handleSlotSwitchButton(interaction, eventId, slotId) {
    // Acknowledge first -> DMs and role changes can exceed Discord's 3 second limit
    await interaction.deferUpdate();
    if (await isRegistrationBlocked()) {
        return interaction.editReply({ content: '❌ Event-Registrierungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.', components: [] });
    }
    const { switchOwnSlot } = require('../utils/registrationService');
    const result = await switchOwnSlot({ eventId, userId: interaction.user.id, slotId });
    await interaction.editReply({ content: result.ok ? `✅ ${result.message}` : `❌ ${result.error}`, components: [] });
}

/**
 * Handle "Abmelden" in the ephemeral status answer.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<void>}
 */
async function handleSlotLeaveButton(interaction, eventId) {
    // Acknowledge first -> removing roles and promoting the waitlist can take a while
    await interaction.deferUpdate();
    const { unregisterUserFromEvent } = require('../utils/registrationService');
    const result = await unregisterUserFromEvent({ eventId, userId: interaction.user.id });
    const title = result.event && result.event.title ? result.event.title : 'dem Event';
    await interaction.editReply({
        content: result.ok ? `✅ Du wurdest von **${title}** abgemeldet.` : `❌ ${result.error}`,
        components: []
    });
}

module.exports = {
    resolveInteractionRoles,
    ensureUserProfile,
    checkRegistrationConditions,
    handleEventRegisterButton,
    handleEventRegisterModal,
    replyWithFailure,
    handleEventSlotButton,
    handleEventSlotModal,
    handleSlotSwitchButton,
    handleSlotLeaveButton
};
