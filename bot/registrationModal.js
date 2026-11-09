/**
 * Registration modal of the bot: builds the registration and slot modals from
 * the form fields of an event and reads the submitted answers.
 */
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, LabelBuilder, TextDisplayBuilder,
    TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder, MentionableSelectMenuBuilder, MessageFlags
} = require('discord.js');
const { debugLog } = require('../utils/debugLog');
const { isRegistrationClosed, isUnregisterClosed, UNREGISTER_CLOSED_MESSAGE } = require('../utils/eventListing');
const { FORM_FIELD_TYPE, MODAL_MAX_FIELDS, getFormFields, getFieldType, formatEntityAnswer, getModalFieldLimit } = require('../utils/formFields');
const { getSlots, findSlot, formatSlotLabel, countSlotOccupancy, hasFreePlace } = require('../utils/slotService');
const {
    MODAL_TITLE_MAX_LENGTH, MODAL_LABEL_MAX_LENGTH, MODAL_DESCRIPTION_MAX_LENGTH,
    MODAL_PLACEHOLDER_MAX_LENGTH, SELECT_OPTION_LABEL_MAX_LENGTH, CHECKBOX_VALUE_YES, CHECKBOX_VALUE_NO,
    SELECTABLE_CHANNEL_TYPES, REGISTER_MODAL_PREFIX, MODAL_FIELD_PREFIX, SLOT_MODAL_PREFIX,
    SLOT_SWITCH_PREFIX, SLOT_LEAVE_PREFIX, ALT_SLOTS_FIELD_ID
} = require('./constants');
const { getTimezone } = require('../utils/timezone');

/**
 * Build the custom ID of a modal field.
 *
 * @param {number} index -> Index of the form field.
 * @returns {string} -> Custom ID used inside the modal.
 */
function buildFieldCustomId(index) {
    return `${MODAL_FIELD_PREFIX}:${index}`;
}

/**
 * Build the info text shown at the top of the registration modal.
 *
 * @param {Object} event -> The event document data.
 * @returns {TextDisplayBuilder} -> Text display component with markdown content.
 */
function buildModalIntro(event) {
    const lines = [`### ${event.title}`];

    if (event.startDate) {
        lines.push(`📅 ${new Date(event.startDate).toLocaleString('de-DE', { timeZone: getTimezone() })}`);
    }
    if (event.maxParticipants > 0) {
        lines.push(`👥 Maximal ${event.maxParticipants} Teilnehmer`);
    }
    lines.push('-# Deine Angaben werden direkt im Event-System gespeichert.');

    return new TextDisplayBuilder().setContent(lines.join('\n'));
}

/**
 * Build the description line of a label component.
 *
 * @param {Object} field -> The form field definition.
 * @returns {string} -> Description text for the label.
 */
function buildFieldDescription(field) {
    if (field.description) {
        return String(field.description).substring(0, MODAL_DESCRIPTION_MAX_LENGTH);
    }
    return field.required ? 'Pflichtfeld' : 'Optional';
}

/**
 * Apply the selection constraints shared by every modal select menu.
 *
 * Discord rejects a select that is marked as required but still allows zero
 * values, so both flags are always set together -> required selects need at
 * least one value, optional ones must not be marked required.
 *
 * @param {Object} select -> The select menu builder to configure.
 * @param {boolean} required -> Whether the field has to be answered.
 * @returns {Object} -> The same builder, for chaining.
 */
function applySelectConstraints(select, required) {
    return select
        .setRequired(required)
        .setMinValues(required ? 1 : 0)
        .setMaxValues(1);
}

/**
 * Build the input component of a single form field.
 *
 * Every field type is mapped onto the component Discord provides for it:
 * text fields become text inputs, dropdowns and checkboxes become string
 * selects and the entity fields become user, role, channel or mentionable
 * selects.
 *
 * @param {LabelBuilder} label -> The label the component belongs to.
 * @param {Object} field -> The form field definition.
 * @param {number} index -> Index of the form field.
 * @returns {LabelBuilder} -> The label with its component set.
 */
function applyFieldComponent(label, field, index) {
    const customId = buildFieldCustomId(index);
    const required = !!field.required;
    const type = getFieldType(field);
    const options = Array.isArray(field.options) ? field.options.filter(Boolean) : [];

    switch (type) {
        case FORM_FIELD_TYPE.TEXTAREA:
            return label.setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId(customId)
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(required)
            );

        case FORM_FIELD_TYPE.DROPDOWN:
            // A select needs at least one option -> fall back to free text otherwise
            if (options.length === 0) break;
            return label.setStringSelectMenuComponent(
                applySelectConstraints(new StringSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setPlaceholder('Bitte wählen')
                    .addOptions(options.map((option, optionIndex) => ({
                        label: String(option).substring(0, SELECT_OPTION_LABEL_MAX_LENGTH),
                        value: String(optionIndex)
                    })))
            );

        case FORM_FIELD_TYPE.CHECKBOX:
            return label.setStringSelectMenuComponent(
                applySelectConstraints(new StringSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setPlaceholder(required ? 'Zum Bestätigen "Ja" wählen' : 'Ja oder Nein')
                    .addOptions([
                        { label: 'Ja', value: CHECKBOX_VALUE_YES },
                        { label: 'Nein', value: CHECKBOX_VALUE_NO }
                    ])
            );

        case FORM_FIELD_TYPE.USER:
            return label.setUserSelectMenuComponent(
                applySelectConstraints(new UserSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setPlaceholder('Mitglied auswählen')
            );

        case FORM_FIELD_TYPE.ROLE:
            return label.setRoleSelectMenuComponent(
                applySelectConstraints(new RoleSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setPlaceholder('Rolle auswählen')
            );

        case FORM_FIELD_TYPE.CHANNEL:
            return label.setChannelSelectMenuComponent(
                applySelectConstraints(new ChannelSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setChannelTypes(SELECTABLE_CHANNEL_TYPES)
                    .setPlaceholder('Channel auswählen')
            );

        case FORM_FIELD_TYPE.MENTIONABLE:
            return label.setMentionableSelectMenuComponent(
                applySelectConstraints(new MentionableSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setPlaceholder('Mitglied oder Rolle auswählen')
            );

        default:
            break;
    }

    return label.setTextInputComponent(
        new TextInputBuilder()
            .setCustomId(customId)
            .setStyle(TextInputStyle.Short)
            .setRequired(required)
            .setPlaceholder(String(field.label).substring(0, MODAL_PLACEHOLDER_MAX_LENGTH))
    );
}

/**
 * Add one label per form field to a modal.
 *
 * @param {ModalBuilder} modal -> The modal to extend.
 * @param {Array<Object>} fields -> Form fields that fit into the modal.
 * @returns {void}
 */
function addFormFieldLabels(modal, fields) {
    fields.forEach((field, index) => {
        const label = new LabelBuilder()
            .setLabel(String(field.label).substring(0, MODAL_LABEL_MAX_LENGTH))
            .setDescription(buildFieldDescription(field));

        modal.addLabelComponents(applyFieldComponent(label, field, index));
    });
}

/**
 * Build the registration modal for an event form.
 *
 * The modal shows one label per form field, each carrying the component that
 * matches the field type. A text display repeating the event data is put in
 * front of them whenever the form leaves a component slot free -> Discord
 * counts it as one of the five top level components of the modal.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @returns {ModalBuilder} -> Modal ready for interaction.showModal().
 * @example
 * await interaction.showModal(buildRegistrationModal(event, eventId));
 */
function buildRegistrationModal(event, eventId) {
    const modal = new ModalBuilder()
        .setCustomId(`${REGISTER_MODAL_PREFIX}:${eventId}`)
        .setTitle(`Anmeldung: ${event.title}`.substring(0, MODAL_TITLE_MAX_LENGTH));

    const fields = getFormFields(event).slice(0, getModalFieldLimit(event));

    // The intro shares the five top level component slots with the fields ->
    // it is only added while a slot is left over, otherwise Discord rejects
    // the modal with error 50035.
    if (fields.length < MODAL_MAX_FIELDS) {
        modal.addTextDisplayComponents(buildModalIntro(event));
    }

    addFormFieldLabels(modal, fields);

    return modal;
}

/**
 * Build the registration modal behind a slot button.
 *
 * It starts with a select for the fallback roles (all other slots) when the
 * event has more than one slot, followed by the form fields. The intro text
 * is only added while one of the five component places is left.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} slot -> The slot the user clicked.
 * @returns {ModalBuilder} -> Modal ready for interaction.showModal().
 */
function buildSlotModal(event, eventId, slot) {
    const modal = new ModalBuilder()
        .setCustomId(`${SLOT_MODAL_PREFIX}:${eventId}:${slot.id}`)
        .setTitle(`${slot.name}: ${event.title}`.substring(0, MODAL_TITLE_MAX_LENGTH));

    const otherSlots = getSlots(event).filter(entry => entry.id !== slot.id);
    const fields = getFormFields(event).slice(0, getModalFieldLimit(event));
    const usedComponents = fields.length + (otherSlots.length > 0 ? 1 : 0);

    if (usedComponents < MODAL_MAX_FIELDS) {
        modal.addTextDisplayComponents(buildModalIntro(event));
    }

    if (otherSlots.length > 0) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(ALT_SLOTS_FIELD_ID)
            .setPlaceholder('Keine Ausweichrolle')
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(otherSlots.length)
            .addOptions(otherSlots.map(entry => ({
                label: entry.name,
                value: entry.id,
                ...(entry.emoji ? { emoji: { name: entry.emoji } } : {})
            })));
        modal.addLabelComponents(
            new LabelBuilder()
                .setLabel('Ausweichrollen (optional)')
                .setDescription(`Falls ${slot.name} voll ist, wirst du hier eingeplant.`.substring(0, MODAL_DESCRIPTION_MAX_LENGTH))
                .setStringSelectMenuComponent(select)
        );
    }

    addFormFieldLabels(modal, fields);
    return modal;
}

/**
 * Read the fallback roles chosen in a slot modal.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @returns {string[]} -> Selected slot IDs, empty when the select is missing.
 */
function readAltSlotIds(interaction) {
    try {
        return interaction.fields.getStringSelectValues(ALT_SLOTS_FIELD_ID) || [];
    } catch {
        return [];
    }
}

/**
 * Answer for a member who clicks a slot button while already registered.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} registration -> The member's registration.
 * @param {Object} clickedSlot -> The slot behind the clicked button.
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @returns {Object} -> Ephemeral reply payload.
 */
function buildRegisteredSlotReply(event, eventId, registration, clickedSlot, registrations) {
    const slots = getSlots(event);

    if (registration.status === 'rejected') {
        return {
            content: `❌ Deine Anmeldung für **${event.title}** wurde abgelehnt.`,
            components: [],
            flags: MessageFlags.Ephemeral
        };
    }

    const current = findSlot(slots, registration.slotId);
    const onBench = registration.status === 'tentative';
    const wished = findSlot(slots, registration.preferredSlotId);
    let status;
    if (onBench) {
        // „Vielleicht“ holds no slot (B-17)
        status = `🤔 Du stehst für **${event.title}** auf der Ersatzbank${wished ? ` (Wunschrolle ${formatSlotLabel(wished)})` : ''}.`;
    } else {
        status = registration.status === 'waitlisted' || !current
            ? `⏳ Du stehst für **${event.title}** auf der Warteliste.`
            : `Du bist für **${event.title}** als **${formatSlotLabel(current)}** eingeplant${registration.status === 'pending' ? ' (Anfrage ausstehend)' : ''}.`;
    }
    // Deadlines take the switch and the leave button away (W-03); the bench may always leave
    const canLeave = onBench || !isUnregisterClosed(event);
    const content = canLeave ? status : `${status}
${UNREGISTER_CLOSED_MESSAGE}`;

    const row = new ActionRowBuilder();
    // The bench changes only its wish, so a full role is no obstacle there
    const canSwitch = clickedSlot.id !== (onBench ? registration.preferredSlotId : registration.slotId)
        && !isRegistrationClosed(event)
        && (onBench || hasFreePlace(clickedSlot, countSlotOccupancy(slots, registrations)));
    if (canSwitch) {
        const switchButton = new ButtonBuilder()
            .setCustomId(`${SLOT_SWITCH_PREFIX}:${eventId}:${clickedSlot.id}`)
            .setLabel(`Zu ${clickedSlot.name} wechseln`)
            .setStyle(ButtonStyle.Primary);
        if (clickedSlot.emoji) switchButton.setEmoji(clickedSlot.emoji);
        row.addComponents(switchButton);
    }
    if (canLeave) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${SLOT_LEAVE_PREFIX}:${eventId}`)
                .setLabel('Abmelden')
                .setStyle(ButtonStyle.Danger)
        );
    }

    return { content, components: row.components.length > 0 ? [row] : [], flags: MessageFlags.Ephemeral };
}

/**
 * Read the display name of a selected guild member.
 *
 * @param {Object} user -> The selected Discord user.
 * @param {Object|null} member -> The matching guild member, when resolved.
 * @returns {string} -> Nickname, global name or username.
 */
function resolveSelectedUserName(user, member) {
    if (member) {
        if (member.displayName) return member.displayName;
        if (member.nick) return member.nick;
    }
    return user.globalName || user.username || user.id;
}

/**
 * Read the answer of a single modal field.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @param {Object} field -> The form field definition.
 * @param {number} index -> Index of the form field.
 * @returns {{ value: (string|boolean), error: (string|null) }} -> Answer and validation error.
 */
function readModalField(interaction, field, index) {
    const customId = buildFieldCustomId(index);
    const type = getFieldType(field);
    const { fields } = interaction;

    if (type === FORM_FIELD_TYPE.DROPDOWN) {
        const options = Array.isArray(field.options) ? field.options.filter(Boolean) : [];
        if (options.length === 0) {
            return { value: (fields.getTextInputValue(customId) || '').trim(), error: null };
        }
        const [selected] = fields.getStringSelectValues(customId) || [];
        if (selected === undefined) return { value: '', error: null };
        const option = options[Number(selected)];
        if (option === undefined) {
            return { value: '', error: `"${field.label}": Die Auswahl ist nicht mehr verfügbar.` };
        }
        return { value: option, error: null };
    }

    if (type === FORM_FIELD_TYPE.CHECKBOX) {
        const [selected] = fields.getStringSelectValues(customId) || [];
        const value = selected === CHECKBOX_VALUE_YES;
        if (field.required && !value) {
            return { value, error: `"${field.label}": Bitte mit "Ja" bestätigen.` };
        }
        return { value, error: null };
    }

    if (type === FORM_FIELD_TYPE.USER) {
        const users = fields.getSelectedUsers(customId);
        const user = users ? users.first() : null;
        if (!user) return { value: '', error: null };
        const members = fields.getSelectedMembers(customId);
        const member = members ? members.get(user.id) : null;
        return { value: formatEntityAnswer(type, resolveSelectedUserName(user, member), user.id), error: null };
    }

    if (type === FORM_FIELD_TYPE.ROLE) {
        const roles = fields.getSelectedRoles(customId);
        const role = roles ? roles.first() : null;
        if (!role) return { value: '', error: null };
        return { value: formatEntityAnswer(type, role.name, role.id), error: null };
    }

    if (type === FORM_FIELD_TYPE.CHANNEL) {
        const channels = fields.getSelectedChannels(customId);
        const channel = channels ? channels.first() : null;
        if (!channel) return { value: '', error: null };
        return { value: formatEntityAnswer(type, channel.name, channel.id), error: null };
    }

    if (type === FORM_FIELD_TYPE.MENTIONABLE) {
        const mentionables = fields.getSelectedMentionables(customId);
        const user = mentionables && mentionables.users ? mentionables.users.first() : null;
        if (user) {
            const member = mentionables.members ? mentionables.members.get(user.id) : null;
            return { value: formatEntityAnswer(type, resolveSelectedUserName(user, member), user.id), error: null };
        }
        const role = mentionables && mentionables.roles ? mentionables.roles.first() : null;
        if (role) {
            return { value: formatEntityAnswer(type, role.name, role.id), error: null };
        }
        return { value: '', error: null };
    }

    return { value: (fields.getTextInputValue(customId) || '').trim(), error: null };
}

/**
 * Convert the modal input into form answers of the web interface format.
 *
 * Text stays a string, dropdown answers are mapped back onto the configured
 * option, checkboxes become booleans and selected users, roles or channels
 * become a readable reference including their ID -> the result looks exactly
 * like an answer set submitted through the website.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @param {Object} event -> The event document data.
 * @returns {{ answers: Object, errors: string[] }} -> Parsed answers and validation errors.
 */
function parseModalAnswers(interaction, event) {
    const answers = {};
    const errors = [];

    getFormFields(event).slice(0, getModalFieldLimit(event)).forEach((field, index) => {
        const type = getFieldType(field);
        try {
            const { value, error } = readModalField(interaction, field, index);
            answers[field.label] = value;
            if (error) errors.push(error);
        } catch (err) {
            // A field can be missing when the form was changed while the modal was open
            debugLog('bot.readModalField', { label: field.label, error: err.message });
            answers[field.label] = type === FORM_FIELD_TYPE.CHECKBOX ? false : '';
        }
    });

    return { answers, errors };
}

module.exports = {
    addFormFieldLabels,
    buildRegistrationModal,
    buildSlotModal,
    readAltSlotIds,
    buildRegisteredSlotReply,
    parseModalAnswers
};
