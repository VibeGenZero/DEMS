/**
 * „Vielleicht“ from a Discord announcement (B-17): the button puts the member
 * on the bench of the event. Events with a form or more than one role slot ask
 * in a modal first (form fields, wanted role). The bench takes no place, so
 * the answer is a private confirmation and nothing else.
 */
const { LabelBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextDisplayBuilder } = require('discord.js');
const { db, doc, getDoc } = require('../firebaseAdmin');
const { debugLog } = require('../utils/debugLog');
const { buildEventUrl } = require('../utils/eventUrl');
const { isEventOver, isRegistrationClosed, REGISTRATION_CLOSED_MESSAGE } = require('../utils/eventListing');
const { MODAL_MAX_FIELDS, getFormFields, getModalFieldLimit } = require('../utils/formFields');
const { getSlots, findSlot, formatSlotLabel } = require('../utils/slotService');
const { TENTATIVE_MODAL_PREFIX, MODAL_TITLE_MAX_LENGTH } = require('./constants');
const { canRegisterViaDiscord } = require('./messages');
const { addFormFieldLabels, parseModalAnswers } = require('./registrationModal');
const { resolveInteractionRoles, checkRegistrationConditions, ensureUserProfile } = require('./registration');

// Custom ID of the wanted role select in the modal
const WANTED_SLOT_FIELD_ID = 'wanted_slot';

/** Event data, or null when it does not exist. */
async function loadEvent(eventId) {
    const snap = await getDoc(doc(db, 'events', eventId));
    return snap.exists() ? snap.data() : null;
}

/**
 * Refusal of a „Vielleicht“ for this event before any input, or null.
 *
 * @param {Object|null} event -> Event data.
 * @param {string} eventId -> The event document ID.
 * @returns {string|null} -> German refusal.
 */
function tentativeRefusal(event, eventId) {
    const { TENTATIVE_NOT_ALLOWED_MESSAGE } = require('../utils/registrationService');
    if (!event) return 'Event nicht gefunden.';
    if (event.allowTentative !== true) return TENTATIVE_NOT_ALLOWED_MESSAGE;
    if (isEventOver(event)) return 'Das Event ist schon vorbei.';
    if (isRegistrationClosed(event)) return REGISTRATION_CLOSED_MESSAGE;
    // The form may not fit (any more) into a Discord modal
    if (!canRegisterViaDiscord(event)) return `Bitte antworte auf der Event-Seite: ${buildEventUrl(eventId)}`;
    return null;
}

/**
 * Modal of the „Vielleicht“ button: the wanted role (slot events with more
 * than one role) and the form fields; a short intro while a place is left.
 *
 * @param {Object} event -> Event data.
 * @param {string} eventId -> The event document ID.
 * @returns {ModalBuilder} -> Modal ready for interaction.showModal().
 */
function buildTentativeModal(event, eventId) {
    const modal = new ModalBuilder()
        .setCustomId(`${TENTATIVE_MODAL_PREFIX}:${eventId}`)
        .setTitle(`Vielleicht: ${event.title}`.substring(0, MODAL_TITLE_MAX_LENGTH));
    const slots = getSlots(event);
    const fields = getFormFields(event).slice(0, getModalFieldLimit(event));
    const askRole = slots.length > 1;

    if (fields.length + (askRole ? 1 : 0) < MODAL_MAX_FIELDS) {
        modal.addTextDisplayComponents(new TextDisplayBuilder()
            .setContent('🤔 Du sagst unverbindlich zu und kommst auf die Ersatzbank. Du belegst keinen Platz und kannst später auf der Event-Seite fest zusagen.'));
    }
    if (askRole) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(WANTED_SLOT_FIELD_ID)
            .setPlaceholder('Rolle wählen')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(slots.map(slot => ({
                label: slot.name,
                value: slot.id,
                ...(slot.emoji ? { emoji: { name: slot.emoji } } : {})
            })));
        modal.addLabelComponents(new LabelBuilder()
            .setLabel('Wunschrolle')
            .setDescription('Für diese Rolle stehst du bereit.')
            .setStringSelectMenuComponent(select));
    }
    addFormFieldLabels(modal, fields);
    return modal;
}

/**
 * Wanted role from the modal; a single role is wanted without asking.
 *
 * @param {Object} event -> Event data.
 * @param {Object|null} interaction -> Submitted modal, null for a direct click.
 * @returns {string|null} -> Slot ID, null on events without slots.
 */
function readWantedSlot(event, interaction) {
    const slots = getSlots(event);
    if (slots.length === 0) return null;
    if (slots.length === 1 || !interaction) return slots[0].id;
    try {
        const [selected] = interaction.fields.getStringSelectValues(WANTED_SLOT_FIELD_ID) || [];
        return selected || null;
    } catch {
        return null;
    }
}

/**
 * Store the „Vielleicht“ and answer the deferred interaction privately.
 *
 * @param {Object} interaction -> Deferred button or modal interaction.
 * @param {Object} params -> `{ eventId, event, roleIds, formAnswers, slotId }`.
 * @returns {Promise<void>}
 */
async function completeTentative(interaction, { eventId, event, roleIds, formAnswers, slotId }) {
    const { registerUserForEvent, REGISTRATION_SOURCE } = require('../utils/registrationService');
    const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
    const result = await registerUserForEvent({
        eventId,
        user: { id: interaction.user.id, displayName, roles: roleIds },
        formAnswers,
        source: REGISTRATION_SOURCE.DISCORD,
        slotId,
        tentative: true
    });
    if (!result.ok) {
        await interaction.editReply({ content: `❌ ${result.error}` });
        return;
    }
    await ensureUserProfile(interaction.user, displayName);
    const slot = findSlot(getSlots(event), slotId);
    const role = slot ? ` als **${formatSlotLabel(slot)}**` : '';
    await interaction.editReply({
        content: `🤔 Du stehst auf der Ersatzbank für **${event.title}**${role}. Du belegst keinen Platz. Fest zusagen kannst du auf der Event-Seite: ${buildEventUrl(eventId)}`
    });
}

/**
 * Click on „Vielleicht“ of an announcement.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID from the custom ID.
 * @returns {Promise<void>}
 */
async function handleTentativeButton(interaction, eventId) {
    debugLog('bot.tentativeButton', { eventId, userId: interaction.user.id });
    const event = await loadEvent(eventId);
    const refusal = tentativeRefusal(event, eventId);
    if (refusal) return interaction.reply({ content: `❌ ${refusal}`, flags: MessageFlags.Ephemeral });

    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) return interaction.reply({ content: `❌ ${conditionError}`, flags: MessageFlags.Ephemeral });

    if (getFormFields(event).length > 0 || getSlots(event).length > 1) {
        return interaction.showModal(buildTentativeModal(event, eventId));
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await completeTentative(interaction, { eventId, event, roleIds, formAnswers: {}, slotId: readWantedSlot(event, null) });
}

/**
 * Submitted „Vielleicht“ modal.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @param {string} eventId -> The event document ID from the custom ID.
 * @returns {Promise<void>}
 */
async function handleTentativeModal(interaction, eventId) {
    debugLog('bot.tentativeModal', { eventId, userId: interaction.user.id });
    const event = await loadEvent(eventId);
    // The event may have changed while the modal was open
    const refusal = tentativeRefusal(event, eventId);
    if (refusal) return interaction.reply({ content: `❌ ${refusal}`, flags: MessageFlags.Ephemeral });

    const { answers, errors } = parseModalAnswers(interaction, event);
    if (errors.length > 0) {
        return interaction.reply({
            content: `❌ Bitte korrigiere deine Angaben:\n${errors.map(error => `• ${error}`).join('\n')}`,
            flags: MessageFlags.Ephemeral
        });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) return interaction.editReply({ content: `❌ ${conditionError}` });
    await completeTentative(interaction, { eventId, event, roleIds, formAnswers: answers, slotId: readWantedSlot(event, interaction) });
}

module.exports = { buildTentativeModal, handleTentativeButton, handleTentativeModal };
