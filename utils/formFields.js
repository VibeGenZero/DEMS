/**
 * Shared knowledge about event form fields.
 *
 * The web form builder, the web registration form and the Discord modal all
 * work with the same field definitions -> this module keeps the supported
 * types and the answer format in one place.
 */

/** Supported form field types. */
const FORM_FIELD_TYPE = {
    TEXT: 'text',
    TEXTAREA: 'textarea',
    DROPDOWN: 'dropdown',
    CHECKBOX: 'checkbox',
    USER: 'user',
    ROLE: 'role',
    CHANNEL: 'channel',
    MENTIONABLE: 'mentionable'
};

/** All known field types as a plain list. */
const FORM_FIELD_TYPES = Object.values(FORM_FIELD_TYPE);

/** Field types that resolve to a Discord entity (user, role, channel). */
const ENTITY_FIELD_TYPES = [
    FORM_FIELD_TYPE.USER,
    FORM_FIELD_TYPE.ROLE,
    FORM_FIELD_TYPE.CHANNEL,
    FORM_FIELD_TYPE.MENTIONABLE
];

/**
 * Discord allows at most five top level components inside one modal -> a form
 * with five fields fills the modal completely and leaves no room for extras.
 */
const MODAL_MAX_FIELDS = 5;

/** Prefix used when an answer references a user or a role. */
const MENTION_PREFIX = '@';

/** Prefix used when an answer references a channel. */
const CHANNEL_PREFIX = '#';

/**
 * Get the usable form fields of an event.
 *
 * @param {Object} event -> The event document data.
 * @returns {Array<Object>} -> Form fields that carry a label.
 */
function getFormFields(event) {
    if (!event || !Array.isArray(event.formFields)) return [];
    return event.formFields.filter(field => field && field.label);
}

/**
 * Read the type of a form field, falling back to a plain text field.
 *
 * @param {Object} field -> The form field definition.
 * @returns {string} -> One of FORM_FIELD_TYPE.
 */
function getFieldType(field) {
    const type = field && field.type;
    return FORM_FIELD_TYPES.includes(type) ? type : FORM_FIELD_TYPE.TEXT;
}

/**
 * Check whether a field type references a Discord entity.
 *
 * @param {string} type -> The field type to check.
 * @returns {boolean} -> True for user, role, channel and mentionable fields.
 */
function isEntityFieldType(type) {
    return ENTITY_FIELD_TYPES.includes(type);
}

/**
 * Format a selected Discord entity as a readable answer.
 *
 * The ID is kept in the answer so an admin can still identify the entity
 * after a rename -> the same format is produced by the web form and by the
 * Discord modal.
 *
 * @param {string} type -> The field type the entity was selected for.
 * @param {string} name -> Display name of the entity.
 * @param {string} id -> Discord snowflake of the entity.
 * @returns {string} -> For example `@Mori (123456789012345678)`.
 * @example
 * formatEntityAnswer('channel', 'allgemein', '42'); // '#allgemein (42)'
 */
function formatEntityAnswer(type, name, id) {
    const prefix = type === FORM_FIELD_TYPE.CHANNEL ? CHANNEL_PREFIX : MENTION_PREFIX;
    return `${prefix}${name} (${id})`;
}

/**
 * Check whether an event form fits into a single Discord modal.
 *
 * @param {Object} event -> The event document data.
 * @returns {boolean} -> True when the form can be shown as a Discord dialog.
 */
function fitsIntoDiscordModal(event) {
    const formFields = getFormFields(event);
    if (formFields.length > MODAL_MAX_FIELDS) return false;
    return formFields.every(field => FORM_FIELD_TYPES.includes(getFieldType(field)));
}

/**
 * Validate answers against the form definition.
 *
 * @param {Array<Object>} formFields -> Form field definitions of the event.
 * @param {Object} formAnswers -> Submitted answers keyed by field label.
 * @returns {string[]} -> Labels of all required fields that are still missing.
 */
function findMissingRequiredFields(formFields, formAnswers) {
    const missingFields = [];
    formFields.forEach(field => {
        if (!field || !field.required) return;
        const answer = formAnswers[field.label];
        if (getFieldType(field) === FORM_FIELD_TYPE.CHECKBOX) {
            if (answer !== true) missingFields.push(field.label);
        } else if (!answer || (typeof answer === 'string' && !answer.trim())) {
            missingFields.push(field.label);
        }
    });
    return missingFields;
}

module.exports = {
    FORM_FIELD_TYPE,
    FORM_FIELD_TYPES,
    ENTITY_FIELD_TYPES,
    MODAL_MAX_FIELDS,
    getFormFields,
    getFieldType,
    isEntityFieldType,
    formatEntityAnswer,
    fitsIntoDiscordModal,
    findMissingRequiredFields
};
