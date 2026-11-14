'use strict';

/**
 * The event fields the admin assistant may fill, how the model is told about
 * them, how a model patch is brought into the shape of the editor form
 * (`collectEventDraft()` in public/js/admin/wizard.js) and how a draft is
 * checked with the rules of a manual save. Pure apart from the banner check
 * inside checkEventFields (which never sees a banner from here).
 */
const { TEMPLATE_FIELDS } = require('../utils/eventTemplates');
const {
    checkEventFields, TITLE_MAX, DESCRIPTION_MAX, AI_NOTES_MAX, ACCESS_MODES, APPROVAL_MODES
} = require('../middleware/validators');
const {
    normalizeSlots, MAX_SLOTS, SLOT_NAME_MAX_LENGTH, SLOT_CAPACITY_MIN, SLOT_CAPACITY_MAX
} = require('../utils/slotService');
const { FORM_FIELD_TYPES, MODAL_MAX_FIELDS } = require('../utils/formFields');
const { normalizeReminderHours } = require('../utils/reminders');
const { parseLocalDateTime } = require('../utils/localDateTime');
const { getTimezone } = require('../utils/timezone');

const DATE_FIELDS = Object.freeze(['startDate', 'endDate', 'registrationDeadline', 'unregisterDeadline']);

/** Template fields without the banner, the four dates and aiNotes (already a template field). */
const ALLOWED_DRAFT_FIELDS = Object.freeze([
    ...new Set([...TEMPLATE_FIELDS.filter(field => field !== 'bannerUrl'), ...DATE_FIELDS, 'aiNotes'])
]);

/** German names of the fields as the reply names them („Nicht übernommen: …“). */
const FIELD_LABELS = Object.freeze({
    title: 'Titel', description: 'Beschreibung', aiNotes: 'Zusatzinfos', accentColor: 'Akzentfarbe',
    category: 'Kategorie', location: 'Ort', maxParticipants: 'Max. Teilnehmer', accessMode: 'Zugang',
    requiredRoles: 'Benötigte Rollen', approvalMode: 'Genehmigung', allowGuests: 'Gäste',
    allowTentative: '„Vielleicht“', slots: 'Slots', assignRoleId: 'Teilnehmerrolle', formFields: 'Anmeldeformular',
    reminderHours: 'Erinnerungen', checkinMessage: 'Check-in-Nachricht', autoCreateChannels: 'Event-Kanäle',
    channelConfig: 'Kanal-Einstellungen', customBotMessages: 'Bot-Nachrichten', announceChannelId: 'Ankündigungskanal',
    startDate: 'Beginn', endDate: 'Ende', registrationDeadline: 'Anmeldeschluss', unregisterDeadline: 'Abmeldeschluss'
});

/**
 * Which fields a sentence of checkEventFields is about, most specific first:
 * a patch that breaks a relation loses the first of them it touched. The
 * tripwire in test/aiEventDraft.test.js walks every sentence.
 */
const ERROR_FIELDS = Object.freeze([
    ['Titel ', ['title']],
    ['Maximale Teilnehmerzahl', ['maxParticipants']],
    ['Zugangsmodus', ['accessMode']],
    ['Genehmigungsmodus', ['approvalMode']],
    ['Ankündigungskanal', ['announceChannelId']],
    ['Die Zusatzinfos für den Event-Assistenten', ['aiNotes']],
    ['Status muss', ['status']],
    ['Aktive Events brauchen ein Startdatum.', ['startDate']],
    ['Das Ende liegt vor dem Start.', ['endDate', 'startDate']],
    ['Der Anmeldeschluss ist kein gültiges Datum.', ['registrationDeadline']],
    ['Der Anmeldeschluss liegt nach dem Ende', ['registrationDeadline', 'endDate', 'startDate']],
    ['Der Abmeldeschluss ist kein gültiges Datum.', ['unregisterDeadline']],
    ['Der Abmeldeschluss liegt nach dem Ende', ['unregisterDeadline', 'endDate', 'startDate']],
    ['Beschreibung darf', ['description']],
    ['Banner muss', ['bannerUrl']],
    ['Akzentfarbe muss', ['accentColor']]
]);

/** Fields of a draft checkEventFields reads (the banner stays out: the assistant never sets it). */
const CHECKED_FIELDS = [
    'title', 'description', 'aiNotes', 'maxParticipants', 'accessMode', 'approvalMode', 'announceChannelId',
    'accentColor', 'status', ...DATE_FIELDS
];

const CHANNEL_CONFIG_TYPES = ['voice', 'text', 'both'];
const CHANNEL_CONFIG_KEYS = ['type', 'voiceName', 'textName'];
const BOT_MESSAGE_KEYS = ['registration', 'accepted', 'rejected'];
const TEXT_FIELDS = ['title', 'description', 'aiNotes', 'category', 'checkinMessage', 'accentColor', 'accessMode', 'approvalMode'];
const BOOLEAN_FIELDS = ['allowGuests', 'allowTentative', 'autoCreateChannels'];
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?$/;

const FORM_RULES = Object.freeze({
    label: 'Jedes Feld braucht ein Label.',
    labelTaken: (label) => `Das Label „${label}“ gibt es schon. Antworten werden nach dem Label gespeichert.`,
    options: 'Ein Auswahlfeld braucht mindestens eine Option.'
});

/** An object literal or JSON object (not an array, date, null, …). */
function isPlainObject(value) {
    return !!value && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

const str = (value) => (typeof value === 'string' ? value : '');
const list = (value) => (Array.isArray(value) ? value : []);
const quoted = (values) => values.map(value => `"${value}"`).join(' | ');

/** The field description given to the model; limits come from the validators' own constants. */
function describeDraftFields() {
    return [
        `- title: Text, höchstens ${TITLE_MAX} Zeichen.`,
        `- description: Beschreibung in Markdown, höchstens ${DESCRIPTION_MAX} Zeichen.`,
        `- aiNotes: Zusatzinfos, die nur der Event-Assistent für Mitglieder liest, höchstens ${AI_NOTES_MAX} Zeichen.`,
        '- category: kurzer Text, z. B. "Raid".',
        '- startDate, endDate: lokale Zeit "YYYY-MM-DDTHH:mm" oder "" für leer; das Ende liegt nicht vor dem Beginn.',
        '- registrationDeadline, unregisterDeadline: Anmelde-/Abmeldeschluss, lokale Zeit "YYYY-MM-DDTHH:mm" oder ""; vor dem Ende (ohne Ende: Beginn + 2 Stunden).',
        '- maxParticipants: ganze Zahl ab 0 (0 = unbegrenzt); bei Slots die Summe der Slot-Plätze.',
        `- accessMode: ${quoted(ACCESS_MODES)}; bei "role-required" gehören die Rollen in requiredRoles.`,
        '- requiredRoles: Liste von Rollen-IDs aus der Rollenliste.',
        `- approvalMode: ${quoted(APPROVAL_MODES)} ("manual" = Orga bestätigt jede Anmeldung).`,
        '- allowGuests, allowTentative, autoCreateChannels: true oder false (Gäste erlaubt, „Vielleicht“ erlaubt, eigene Event-Kanäle anlegen).',
        `- slots: höchstens ${MAX_SLOTS} Slots [{ "name": 1–${SLOT_NAME_MAX_LENGTH} Zeichen, eindeutig, "emoji": ein Emoji oder "", "capacity": ${SLOT_CAPACITY_MIN}–${SLOT_CAPACITY_MAX} Plätze }]; mit Slots sind keine Gäste möglich.`,
        '- assignRoleId: Rollen-ID aus der Rollenliste, die angenommene Teilnehmer bekommen, oder "".',
        `- formFields: Anmeldeformular [{ "label": eindeutiger Text, "type": ${quoted(FORM_FIELD_TYPES)}, "required": true/false, "description": optionaler Hinweis, "options": [Texte] nur bei "dropdown" }]; in den Discord-Dialog passen höchstens ${MODAL_MAX_FIELDS} Felder.`,
        '- reminderHours: Erinnerungen in Stunden vor dem Beginn als Text, z. B. "24, 1", oder "".',
        '- checkinMessage: Text der Check-in-Nachricht.',
        `- channelConfig: { "type": ${quoted(CHANNEL_CONFIG_TYPES)}, "voiceName": Text, "textName": Text } für die Event-Kanäle.`,
        '- customBotMessages: { "registration": Text, "accepted": Text, "rejected": Text } eigene Bot-Nachrichten.',
        '- announceChannelId: Textkanal-ID aus der Kanalliste für die Ankündigung oder "" (Standardkanal).',
        '- location: { "text": Ort als Text, "channelId": Kanal-ID aus der Kanalliste oder "" } oder null.',
        '- accentColor: Farbe als Hex-Wert wie "#8b5cf6".'
    ].join('\n');
}

/** Fields a sentence of checkEventFields is about (most specific first), or null when unknown. */
function blameFields(sentence) {
    const entry = ERROR_FIELDS.find(([prefix]) => typeof sentence === 'string' && sentence.startsWith(prefix));
    return entry ? [...entry[1]] : null;
}

/** Local `YYYY-MM-DDTHH:mm` -> ISO string in the time zone; '' stays ''; null when unreadable or impossible. */
function toIsoDate(value, timezone) {
    if (value === '') return '';
    const match = typeof value === 'string' ? value.trim().match(LOCAL_DATE_TIME) : null;
    if (!match) return null;
    const [, year, month, day, hour, minute] = match;
    const date = parseLocalDateTime(`${day}.${month}.${year} ${hour}:${minute}`, timezone);
    return date ? date.toISOString() : null;
}

/** Reminder hours as the form text ("24, 1"); null when an entry is not a positive number of hours. */
function reminderText(value) {
    let entries;
    if (Array.isArray(value)) entries = value.map(entry => (isPlainObject(entry) ? entry.hours : entry));
    else if (typeof value === 'string' || typeof value === 'number') entries = String(value).split(/[\s,;]+/).filter(Boolean);
    else return null;
    if (!entries.every(entry => (typeof entry === 'number' || typeof entry === 'string') && Number(entry) > 0)) return null;
    return normalizeReminderHours(entries.join(',')).map(({ hours }) => hours).join(', ');
}

function slotShape(raw) {
    const slot = isPlainObject(raw) ? raw : {};
    const shaped = {};
    if (typeof slot.id === 'string' && slot.id) shaped.id = slot.id;
    return Object.assign(shaped, { name: str(slot.name), emoji: str(slot.emoji), capacity: Number(slot.capacity) });
}

function formFieldShape(raw) {
    const field = isPlainObject(raw) ? raw : {};
    const type = FORM_FIELD_TYPES.includes(field.type) ? field.type : 'text';
    const shaped = { label: str(field.label), type, required: field.required === true };
    if (str(field.description).trim()) shaped.description = field.description.trim();
    if (type === 'dropdown') shaped.options = list(field.options).filter(option => typeof option === 'string' && option.trim()).map(option => option.trim());
    return shaped;
}

/** Only the given keys of a nested setting, each a string; draftEvent completes them from the form. */
function pickStrings(raw, keys) {
    const picked = {};
    for (const key of keys) if (typeof raw[key] === 'string') picked[key] = raw[key];
    return picked;
}

/**
 * One sanitizer per allowed field: `{ value }` keeps the field, `{ reason }`
 * drops it, both together keep a reduced value and report what went.
 */
function sanitizeField(field, value, { roleIds, channelById, timezone }) {
    if (TEXT_FIELDS.includes(field)) return typeof value === 'string' ? { value } : { reason: 'invalid' };
    if (BOOLEAN_FIELDS.includes(field)) return typeof value === 'boolean' ? { value } : { reason: 'invalid' };
    if (DATE_FIELDS.includes(field)) {
        const iso = toIsoDate(value, timezone);
        return iso === null ? { reason: 'invalid_date' } : { value: iso };
    }
    switch (field) {
        case 'maxParticipants':
            if (typeof value === 'number' && Number.isFinite(value)) return { value: String(value) };
            return typeof value === 'string' ? { value: value.trim() } : { reason: 'invalid' };
        case 'reminderHours': {
            const text = reminderText(value);
            return text === null ? { reason: 'invalid' } : { value: text };
        }
        case 'requiredRoles': {
            if (!Array.isArray(value)) return { reason: 'invalid' };
            const known = value.filter(id => typeof id === 'string' && roleIds.has(id));
            if (known.length === value.length) return { value: known };
            return known.length ? { value: known, reason: 'unknown_role' } : { reason: 'unknown_role' };
        }
        case 'assignRoleId':
            if (typeof value !== 'string') return { reason: 'invalid' };
            return value === '' || roleIds.has(value) ? { value } : { reason: 'unknown_role' };
        case 'announceChannelId': {
            if (typeof value !== 'string') return { reason: 'invalid' };
            const channel = channelById.get(value);
            return value === '' || (channel && channel.type === 'text') ? { value } : { reason: 'unknown_channel' };
        }
        case 'location': {
            if (value === null) return { value: null };
            const raw = typeof value === 'string' ? { text: value } : value;
            if (!isPlainObject(raw) || typeof raw.text !== 'string') return { reason: 'invalid' };
            const text = raw.text.trim();
            if (!text) return { value: null };
            const channel = typeof raw.channelId === 'string' && raw.channelId ? channelById.get(raw.channelId) : null;
            const located = { text, channelId: channel ? String(channel.id) : '', channelType: channel ? str(channel.type) : '' };
            return typeof raw.channelId === 'string' && raw.channelId && !channel ? { value: located, reason: 'unknown_channel' } : { value: located };
        }
        case 'slots':
            return Array.isArray(value) ? { value: value.map(slotShape) } : { reason: 'invalid' };
        case 'formFields':
            return Array.isArray(value) ? { value: value.map(formFieldShape) } : { reason: 'invalid' };
        case 'channelConfig': {
            if (!isPlainObject(value)) return { reason: 'invalid' };
            if (value.type !== undefined && !CHANNEL_CONFIG_TYPES.includes(value.type)) return { reason: 'invalid' };
            return { value: pickStrings(value, CHANNEL_CONFIG_KEYS) };
        }
        case 'customBotMessages':
            return isPlainObject(value) ? { value: pickStrings(value, BOT_MESSAGE_KEYS) } : { reason: 'invalid' };
        default:
            return { reason: 'invalid' };
    }
}

/**
 * Bring a model patch into the shape of the editor form. Works on own
 * enumerable keys of a plain object only; results are built by assigning
 * allowed field names, so `__proto__` or `constructor` can never be set.
 *
 * @param {*} raw -> The `patch` of the model answer.
 * @param {Object} [options]
 * @param {Array<{ id: string }>} [options.roles] -> Guild roles.
 * @param {Array<{ id: string, type: string }>} [options.channels] -> Guild channels ('text' | 'voice').
 * @param {string} [options.timezone] -> IANA time zone of the local date-times.
 * @returns {{ patch: Object, dropped: Array<{ field: string, reason: string }> }}
 */
function sanitizePatch(raw, { roles = [], channels = [], timezone = getTimezone() } = {}) {
    const patch = {};
    const dropped = [];
    if (!isPlainObject(raw)) return { patch, dropped };
    const context = {
        roleIds: new Set(list(roles).filter(Boolean).map(role => String(role.id))),
        channelById: new Map(list(channels).filter(Boolean).map(channel => [String(channel.id), channel])),
        timezone
    };
    for (const key of Object.keys(raw)) {
        const field = ALLOWED_DRAFT_FIELDS.find(name => name === key);
        if (!field) {
            dropped.push({ field: key, reason: 'not_allowed' });
            continue;
        }
        const result = sanitizeField(field, raw[key], context);
        if (Object.hasOwn(result, 'value')) patch[field] = result.value;
        if (result.reason) dropped.push({ field, reason: result.reason });
    }
    return { patch, dropped };
}

/** The wizard's rules for the registration form (labels, unique labels, dropdown options). */
function formFieldErrors(formFields) {
    const errors = [];
    const labels = new Set();
    for (const field of list(formFields)) {
        const label = str(field && field.label).trim();
        if (!label) {
            errors.push(FORM_RULES.label);
            continue;
        }
        if (labels.has(label.toLowerCase())) errors.push(FORM_RULES.labelTaken(label));
        labels.add(label.toLowerCase());
        if (field.type === 'dropdown' && !(Array.isArray(field.options) && field.options.length > 0)) errors.push(FORM_RULES.options);
    }
    return [...new Set(errors)];
}

/**
 * Check a whole draft with the rules of a manual save: checkEventFields on the
 * fields it reads, normalizeSlots and the form field rules.
 *
 * @param {Object} draft -> Draft in the shape of collectEventDraft().
 * @returns {Promise<Array<{ message: string, fields: string[]|null }>>} -> German sentences with the fields they are about.
 */
async function draftErrors(draft) {
    const input = {};
    for (const key of CHECKED_FIELDS) if (Object.hasOwn(draft, key)) input[key] = draft[key];
    const errors = (await checkEventFields(input)).map(message => ({ message, fields: blameFields(message) }));
    const slotResult = normalizeSlots(draft.slots);
    if (slotResult.error) errors.push({ message: slotResult.error, fields: ['slots'] });
    for (const message of formFieldErrors(draft.formFields)) errors.push({ message, fields: ['formFields'] });
    return errors;
}

module.exports = {
    ALLOWED_DRAFT_FIELDS, DATE_FIELDS, FIELD_LABELS, CHANNEL_CONFIG_KEYS, BOT_MESSAGE_KEYS,
    describeDraftFields, blameFields, sanitizePatch, draftErrors, isPlainObject
};
