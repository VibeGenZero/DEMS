/**
 * Input validation middleware for DEMS
 * Pure JS validation without external libraries
 */

const { parseDate, eventEndTime } = require('../utils/eventListing');
const { isStoredBanner } = require('../utils/bannerStore');

/**
 * Whether a value is an absolute http(s) URL of at most 2000 characters.
 *
 * @param {*} value -> Submitted value.
 * @returns {boolean} -> True for http:// and https:// URLs.
 */
function isHttpUrl(value) {
    if (typeof value !== 'string' || value.length > 2000) return false;
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

/**
 * Check the fields of an event body. Templates (W-10) store no dates or status
 * and may have no title, so those rules are skipped for them.
 *
 * @param {Object} body -> Event fields as POST/PUT /api/admin/events or a template send them.
 * @param {Object} [options] -> `{ template }` for the settings of an event template.
 * @returns {Promise<string[]>} -> German error sentences, empty when everything is fine.
 */
const AI_NOTES_MAX = 4000;

async function checkEventFields(body, { template = false } = {}) {
    const { title, maxParticipants, accessMode, status, approvalMode } = body;

    const errors = [];

    // Title is required and must be non-empty string
    if (title !== undefined && title !== null && typeof title !== 'string') {
        errors.push('Titel ist erforderlich.');
    } else if (!template && (!title || title.trim().length === 0)) {
        errors.push('Titel ist erforderlich.');
    } else if (title && title.trim().length > 200) {
        errors.push('Titel darf maximal 200 Zeichen lang sein.');
    }

    // maxParticipants must be a valid number >= 0
    if (maxParticipants !== undefined && maxParticipants !== null && maxParticipants !== '') {
        const parsed = parseInt(maxParticipants);
        if (isNaN(parsed) || parsed < 0) {
            errors.push('Maximale Teilnehmerzahl muss eine Zahl >= 0 sein.');
        }
    }

    // accessMode must be valid enum
    const validAccessModes = ['open', 'role-required'];
    if (accessMode && !validAccessModes.includes(accessMode)) {
        errors.push(`Zugangsmodus muss einer der folgenden sein: ${validAccessModes.join(', ')}`);
    }

    // approvalMode must be valid enum
    const validApprovalModes = ['manual', 'instant'];
    if (approvalMode && !validApprovalModes.includes(approvalMode)) {
        errors.push(`Genehmigungsmodus muss einer der folgenden sein: ${validApprovalModes.join(', ')}`);
    }

    // Own announcement channel of the event or template, '' = default (B-11)
    const { announceChannelId } = body;
    if (announceChannelId !== undefined && announceChannelId !== null && announceChannelId !== ''
        && !(typeof announceChannelId === 'string' && /^\d{17,20}$/.test(announceChannelId))) {
        errors.push('Ankündigungskanal ist ungültig.');
    }

    // Extra details only the AI assistant reads
    const { aiNotes } = body;
    if (aiNotes !== undefined && aiNotes !== null && (typeof aiNotes !== 'string' || aiNotes.length > AI_NOTES_MAX)) {
        errors.push(`Die Zusatzinfos für den Event-Assistenten dürfen höchstens ${AI_NOTES_MAX} Zeichen lang sein.`);
    }

    // Templates store no status, dates or deadlines (W-10)
    if (template) return checkContentFields(body, errors);

    // status must be valid enum
    const validStatuses = ['draft', 'active', 'archived', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
        errors.push(`Status muss einer der folgenden sein: ${validStatuses.join(', ')}`);
    }

    // Members plan by the start date; reminders and the overview need it too (D-10)
    const { startDate, endDate } = body;
    if ((status || 'active') === 'active' && !startDate) {
        errors.push('Aktive Events brauchen ein Startdatum.');
    }
    if (startDate && endDate && new Date(endDate).getTime() < new Date(startDate).getTime()) {
        errors.push('Das Ende liegt vor dem Start.');
    }

    // Deadlines are optional, but must lie before the end (end date, else start + 2 h) (W-03)
    const end = startDate ? eventEndTime({ startDate, endDate }) : null;
    const deadlines = [['registrationDeadline', 'Der Anmeldeschluss'], ['unregisterDeadline', 'Der Abmeldeschluss']];
    for (const [field, name] of deadlines) {
        const value = body[field];
        if (!value) continue;
        const deadline = parseDate(value);
        if (!deadline) errors.push(`${name} ist kein gültiges Datum.`);
        else if (end && deadline > end) errors.push(`${name} liegt nach dem Ende des Events.`);
    }

    return checkContentFields(body, errors);
}

/**
 * Rules events and templates share: description, banner, accent colour.
 *
 * @param {Object} body -> Event fields.
 * @param {string[]} errors -> Errors found so far; extended in place.
 * @returns {Promise<string[]>} -> The same list.
 */
async function checkContentFields(body, errors) {
    // Description length check
    if (body.description && typeof body.description === 'string' && body.description.length > 5000) {
        errors.push('Beschreibung darf maximal 5000 Zeichen lang sein.');
    }

    // Banner and colour end up in <img src> and inline CSS -> only http(s) URLs,
    // uploaded banners whose file exists (W-12) and hex colours
    const { bannerUrl, accentColor } = body;
    if (bannerUrl && !isHttpUrl(bannerUrl) && !(await isStoredBanner(bannerUrl))) {
        errors.push('Banner muss eine http(s)-URL oder ein hochgeladenes Bild sein.');
    }
    if (accentColor && !(typeof accentColor === 'string' && /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(accentColor))) {
        errors.push('Akzentfarbe muss ein Hex-Farbwert wie #8b5cf6 sein.');
    }

    return errors;
}

/**
 * Validate event creation/update body
 */
async function validateEvent(req, res, next) {
    const errors = await checkEventFields(req.body);
    if (errors.length > 0) {
        console.log('[validateEvent] 400 error — body:', JSON.stringify(req.body), '— errors:', errors);
        return res.status(400).json({ error: errors.join(' ') });
    }

    next();
}

/**
 * Validate registration status update
 */
function validateRegStatus(req, res, next) {
    const { status } = req.body;
    const validStatuses = ['accepted', 'rejected', 'waitlisted'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: `Status muss einer der folgenden sein: ${validStatuses.join(', ')}` });
    }
    next();
}

/**
 * Validate bot message templates
 */
function validateBotMessages(req, res, next) {
    const { registration, accepted, rejected } = req.body;
    const maxLen = 2000;

    if (registration && registration.length > maxLen) {
        return res.status(400).json({ error: `Registrierungs-Nachricht darf max. ${maxLen} Zeichen sein.` });
    }
    if (accepted && accepted.length > maxLen) {
        return res.status(400).json({ error: `Angenommen-Nachricht darf max. ${maxLen} Zeichen sein.` });
    }
    if (rejected && rejected.length > maxLen) {
        return res.status(400).json({ error: `Abgelehnt-Nachricht darf max. ${maxLen} Zeichen sein.` });
    }

    next();
}

module.exports = { checkEventFields, validateEvent, validateRegStatus, validateBotMessages };
