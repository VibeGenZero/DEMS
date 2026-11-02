/**
 * Unsaved event for the wizard preview (POST /api/admin/events/preview): the
 * fields the overview card and the Discord announcement show, with the
 * defaults of POST /api/admin/events. Pure, no database.
 */
const { normalizeSlots, sumCapacity } = require('./slotService');
const { isBannerPath } = require('./bannerStore');

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;
const STATUSES = ['draft', 'active', 'archived', 'cancelled'];
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

const textOf = (value, max = 2000) => (typeof value === 'string' ? value.slice(0, max) : '');

/**
 * Banner address the announcement may show: an http(s) URL or an uploaded banner path
 * (buildEventAnnouncement makes it absolute); discord.js refuses everything else.
 *
 * @param {*} value -> Banner URL from the wizard.
 * @returns {string} -> The URL, or '' when it is none.
 */
function bannerOf(value) {
    const url = textOf(value).trim();
    if (!url) return '';
    if (isBannerPath(url)) return url;
    try {
        return ['http:', 'https:'].includes(new URL(url).protocol) ? url : '';
    } catch {
        return '';
    }
}

/**
 * Event as the preview builders need it.
 *
 * @param {Object} [body] -> Draft of collectEventDraft() (public/js/admin/wizard.js), may be incomplete.
 * @returns {Object} -> `{ title, description, startDate, endDate, registrationDeadline, unregisterDeadline, bannerUrl, category, status, accessMode, allowGuests, allowTentative, formFields, accentColor, slots, maxParticipants }`; broken slots are left out (the wizard reports them).
 */
function buildPreviewEvent(body = {}) {
    const slotResult = normalizeSlots(body.slots);
    const slots = slotResult.error ? [] : slotResult.slots;
    return {
        title: textOf(body.title, TITLE_MAX),
        description: textOf(body.description, DESCRIPTION_MAX),
        startDate: textOf(body.startDate, 40),
        endDate: textOf(body.endDate, 40),
        registrationDeadline: textOf(body.registrationDeadline, 40),
        unregisterDeadline: textOf(body.unregisterDeadline, 40),
        bannerUrl: bannerOf(body.bannerUrl),
        category: textOf(body.category, 100),
        status: STATUSES.includes(body.status) ? body.status : 'active',
        accessMode: body.accessMode === 'role-required' ? 'role-required' : 'open',
        allowGuests: slots.length > 0 ? false : body.allowGuests !== false,
        // „Vielleicht“ button in the preview (B-17)
        allowTentative: body.allowTentative === true,
        formFields: Array.isArray(body.formFields)
            ? body.formFields.filter(field => field && typeof field === 'object' && typeof field.label === 'string' && field.label.trim())
            : [],
        accentColor: typeof body.accentColor === 'string' && HEX_COLOR.test(body.accentColor) ? body.accentColor : '',
        slots,
        maxParticipants: slots.length > 0 ? sumCapacity(slots) : Math.max(0, parseInt(body.maxParticipants, 10) || 0)
    };
}

module.exports = { buildPreviewEvent };
