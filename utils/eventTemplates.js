/**
 * Event templates (W-10): which event settings a template keeps and how its
 * name is checked. Pure, no database; the routes live in routes/admin.js.
 */

const { normalizeSlots, sumCapacity } = require('./slotService');
const { normalizeReminderHours } = require('./reminders');

/**
 * Event settings a template stores. Date, lifecycle and Discord fields stay out.
 * Mirrored in public/js/admin/wizard-templates.js (a test keeps both equal).
 */
const TEMPLATE_FIELDS = [
    'title', 'description', 'bannerUrl', 'accentColor', 'category', 'location',
    'maxParticipants', 'accessMode', 'requiredRoles', 'approvalMode', 'allowGuests', 'allowTentative',
    'slots', 'assignRoleId', 'formFields', 'reminderHours', 'checkinMessage',
    'autoCreateChannels', 'channelConfig', 'customBotMessages', 'announceChannelId'
];

const TEMPLATE_NAME_MAX = 80;
const MAX_TEMPLATES = 50;

const NAME_ERROR = `Der Name der Vorlage muss 1 bis ${TEMPLATE_NAME_MAX} Zeichen lang sein.`;

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value : '');

/**
 * Keep the template fields of an input and give them the defaults of a new event.
 *
 * @param {Object} input -> Wizard draft or stored settings.
 * @returns {{ settings: Object } | { error: string }} -> Settings, or the German slot error.
 */
function pickTemplateSettings(input) {
    const source = isObject(input) ? input : {};
    const slotResult = normalizeSlots(source.slots);
    if (slotResult.error) return { error: slotResult.error };
    const { slots } = slotResult;

    const settings = {
        title: text(source.title),
        description: text(source.description),
        bannerUrl: text(source.bannerUrl),
        accentColor: text(source.accentColor),
        category: text(source.category),
        location: isObject(source.location) ? source.location : null,
        maxParticipants: slots.length > 0 ? sumCapacity(slots) : (parseInt(source.maxParticipants) || 0),
        accessMode: source.accessMode || 'open',
        requiredRoles: Array.isArray(source.requiredRoles) ? source.requiredRoles : [],
        approvalMode: source.approvalMode || 'manual',
        allowGuests: slots.length > 0 ? false : source.allowGuests !== false,
        allowTentative: source.allowTentative === true,
        slots,
        assignRoleId: text(source.assignRoleId),
        formFields: Array.isArray(source.formFields) ? source.formFields : [],
        // Only the hours: nothing has been sent for an event that does not exist yet
        reminderHours: normalizeReminderHours(source.reminderHours).map(({ hours }) => ({ hours })),
        checkinMessage: text(source.checkinMessage),
        autoCreateChannels: !!source.autoCreateChannels,
        channelConfig: isObject(source.channelConfig) ? source.channelConfig : {},
        customBotMessages: isObject(source.customBotMessages) ? source.customBotMessages : {},
        // Own announcement channel, '' = default (B-11)
        announceChannelId: text(source.announceChannelId)
    };
    return { settings };
}

/**
 * Trim a template name and check its length.
 *
 * @param {*} name -> Submitted name.
 * @returns {{ name: string } | { error: string }} -> Trimmed name or the German error.
 */
function normalizeTemplateName(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > TEMPLATE_NAME_MAX) return { error: NAME_ERROR };
    return { name: trimmed };
}

/**
 * Whether another template already has this name (case does not matter).
 *
 * @param {Array<Object>} templates -> Stored templates `{ id, name }`.
 * @param {string} name -> Trimmed name.
 * @param {string} [exceptId] -> Template being overwritten.
 * @returns {boolean} -> True when the name is taken.
 */
function nameTaken(templates, name, exceptId) {
    const key = name.toLocaleLowerCase('de');
    return templates.some(template => template.id !== exceptId && String(template.name || '').toLocaleLowerCase('de') === key);
}

module.exports = { TEMPLATE_FIELDS, TEMPLATE_NAME_MAX, MAX_TEMPLATES, pickTemplateSettings, normalizeTemplateName, nameTaken };
