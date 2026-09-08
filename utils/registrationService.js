const { db, collection, doc, getDoc, getDocs, addDoc, query, where } = require('../firebaseAdmin');
const { sendDM, assignRole, parseTemplate, getGuildRoles, addParticipantToEventChannels, sendGuestInvitation } = require('../bot');
const { debugLog } = require('./debugLog');

/** Registration sources — where a registration was created. */
const REGISTRATION_SOURCE = {
    WEB: 'web',
    DISCORD: 'discord'
};

/** Status values a fresh registration can receive. */
const REGISTRATION_STATUS = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    WAITLISTED: 'waitlisted'
};

/** Machine readable failure codes returned by registerUserForEvent(). */
const REGISTRATION_ERROR = {
    NOT_FOUND: 'event_not_found',
    INACTIVE: 'event_inactive',
    ALREADY_REGISTERED: 'already_registered',
    MISSING_ROLE: 'missing_role',
    GUESTS_NOT_ALLOWED: 'guests_not_allowed',
    MISSING_FIELDS: 'missing_fields',
    FAILED: 'registration_failed'
};

/** HTTP status codes mapped to the failure codes above. */
const ERROR_HTTP_STATUS = {
    [REGISTRATION_ERROR.NOT_FOUND]: 404,
    [REGISTRATION_ERROR.INACTIVE]: 400,
    [REGISTRATION_ERROR.ALREADY_REGISTERED]: 400,
    [REGISTRATION_ERROR.MISSING_ROLE]: 403,
    [REGISTRATION_ERROR.GUESTS_NOT_ALLOWED]: 400,
    [REGISTRATION_ERROR.MISSING_FIELDS]: 400,
    [REGISTRATION_ERROR.FAILED]: 500
};

/** Success messages shown to the user, keyed by resulting status. */
const STATUS_MESSAGES = {
    [REGISTRATION_STATUS.ACCEPTED]: 'Erfolgreich angemeldet!',
    [REGISTRATION_STATUS.PENDING]: 'Anfrage eingegangen.',
    [REGISTRATION_STATUS.WAITLISTED]: 'Auf die Warteliste gesetzt.'
};

const DEFAULT_BASE_URL = 'http://localhost:3000';

/**
 * Check whether an event requires the user to fill in a form.
 *
 * Only required fields count -> optional fields can be skipped, so a user can
 * still register without ever opening the web form.
 *
 * @param {Object} event -> The event document data.
 * @returns {boolean} -> True when at least one form field is mandatory.
 * @example
 * if (eventRequiresForm(event)) { showModalInstead(); }
 */
function eventRequiresForm(event) {
    const formFields = Array.isArray(event?.formFields) ? event.formFields : [];
    return formFields.some(field => field && field.required);
}

/**
 * Validate the submitted answers against the event form definition.
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
        if (field.type === 'checkbox') {
            if (answer !== true) missingFields.push(field.label);
        } else if (!answer || (typeof answer === 'string' && !answer.trim())) {
            missingFields.push(field.label);
        }
    });
    return missingFields;
}

/**
 * Count the slots that are currently taken for an event.
 *
 * Confirmed guests as well as guests that were invited but have not answered
 * yet block a slot, otherwise an event could be overbooked.
 *
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<number>} -> Number of occupied slots.
 */
async function countOccupiedSlots(eventId) {
    const regQ = query(
        collection(db, 'registrations'),
        where('eventId', '==', eventId),
        where('status', 'in', [REGISTRATION_STATUS.PENDING, REGISTRATION_STATUS.ACCEPTED])
    );
    const regSnap = await getDocs(regQ);

    let occupied = 0;
    regSnap.forEach(regDoc => {
        const registration = regDoc.data();
        const confirmedGuests = registration.guests ? registration.guests.length : 0;
        const pendingGuests = registration.pendingGuests
            ? registration.pendingGuests.filter(guest => guest.status === REGISTRATION_STATUS.PENDING).length
            : 0;
        occupied += 1 + confirmedGuests + pendingGuests;
    });
    return occupied;
}

/**
 * Resolve the template variables used in the bot messages.
 *
 * @param {Object} params -> Resolution input.
 * @param {Object} params.user -> The registering user ({ id, displayName }).
 * @param {string} params.eventId -> The event document ID.
 * @param {Object} params.event -> The event document data.
 * @returns {Promise<Object>} -> Variable map for parseTemplate().
 */
async function buildTemplateVars({ user, eventId, event }) {
    const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
    let roleName = '';
    let roleMention = '';

    if (event.assignRoleId) {
        const roles = await getGuildRoles(process.env.DISCORD_GUILD_ID);
        const role = roles.find(r => r.id === event.assignRoleId);
        if (role) {
            roleName = role.name;
            roleMention = `<@&${role.id}>`;
        } else {
            roleName = 'Unbekannte Rolle';
            roleMention = 'Unbekannte Rolle';
        }
    }

    return {
        'user.id': user.id,
        'user.name': user.displayName,
        'user.mention': `<@${user.id}>`,
        'event.title': event.title || 'Unbekanntes Event',
        'event.url': `${baseUrl}/#events/${eventId}`,
        'role.name': roleName,
        'role.mention': roleMention
    };
}

/**
 * Send the confirmation DM and apply role/channel side effects.
 *
 * Failures are logged but never abort the registration -> the registration
 * itself is already persisted at this point.
 *
 * @param {Object} params -> Notification input.
 * @param {Object} params.user -> The registering user ({ id, displayName }).
 * @param {string} params.eventId -> The event document ID.
 * @param {Object} params.event -> The event document data.
 * @param {string} params.status -> The resulting registration status.
 * @returns {Promise<void>} -> Resolves once all notifications were attempted.
 */
async function notifyRegistration({ user, eventId, event, status }) {
    try {
        const templateSnap = await getDoc(doc(db, 'botMessages', 'templates'));
        const globalTemplates = templateSnap.exists() ? templateSnap.data() : {};
        const customMessages = event.customBotMessages || {};
        const vars = await buildTemplateVars({ user, eventId, event });

        if (status === REGISTRATION_STATUS.WAITLISTED) {
            await sendDM(user.id, `📋 Das Event **${event.title}** ist aktuell voll. Du wurdest auf die **Warteliste** gesetzt. Wir benachrichtigen dich, sobald ein Platz frei wird!`);
            return;
        }

        if (status === REGISTRATION_STATUS.ACCEPTED) {
            const template = customMessages.accepted || globalTemplates.accepted;
            const message = template
                ? parseTemplate(template, vars)
                : `✅ Du wurdest automatisch für **${event.title}** angenommen!`;
            await sendDM(user.id, message);

            if (event.assignRoleId) {
                await assignRole(user.id, event.assignRoleId, process.env.DISCORD_GUILD_ID);
            }
            if (event.discordChannelId || event.discordTextChannelId) {
                await addParticipantToEventChannels(event, user.id);
            }
            return;
        }

        const template = customMessages.registration || globalTemplates.registration;
        const message = template
            ? parseTemplate(template, vars)
            : `📋 Deine Anfrage für **${event.title}** ist eingegangen. Bitte warte auf die Bestätigung.`;
        await sendDM(user.id, message);
    } catch (err) {
        console.error('[registrationService] notifyRegistration failed:', err.message);
    }
}

/**
 * Register a user for an event after validating every access condition.
 *
 * This is the single source of truth for registrations -> both the web UI and
 * the Discord "Anmelden" button call it, so the same conditions (event status,
 * role requirement, guest rules, required form fields, capacity and approval
 * mode) apply everywhere and every registration shows up in the web interface.
 *
 * @param {Object} params -> Registration input.
 * @param {string} params.eventId -> The event document ID.
 * @param {Object} params.user -> The registering user.
 * @param {string} params.user.id -> Discord user ID.
 * @param {string} params.user.displayName -> Display name shown in the UI.
 * @param {string[]} [params.user.roles] -> Discord role IDs of the user.
 * @param {Object} [params.formAnswers] -> Answers keyed by form field label.
 * @param {Array<Object>} [params.guests] -> Guests to invite ({ id, displayName, avatar }).
 * @param {string} [params.source] -> Where the registration came from ("web" or "discord").
 * @returns {Promise<Object>} -> `{ ok: true, id, status, message }` on success,
 *   `{ ok: false, code, httpStatus, error }` when a condition is not met.
 * @example
 * const result = await registerUserForEvent({
 *     eventId: 'abc123',
 *     user: { id: '1234', displayName: 'Mori', roles: ['5678'] },
 *     source: 'discord'
 * });
 * if (!result.ok) console.error(result.error);
 */
async function registerUserForEvent({ eventId, user, formAnswers = {}, guests = [], source = REGISTRATION_SOURCE.WEB }) {
    debugLog('registrationService.register', { eventId, userId: user?.id, source });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return buildFailure(REGISTRATION_ERROR.NOT_FOUND, 'Event nicht gefunden');
    }

    const event = eventSnap.data();

    if (event.status && event.status !== 'active') {
        return buildFailure(REGISTRATION_ERROR.INACTIVE, 'Dieses Event akzeptiert keine Anmeldungen.');
    }

    const existingQ = query(
        collection(db, 'registrations'),
        where('eventId', '==', eventId),
        where('userId', '==', user.id)
    );
    const existingSnap = await getDocs(existingQ);
    if (!existingSnap.empty) {
        return buildFailure(REGISTRATION_ERROR.ALREADY_REGISTERED, 'Du bist bereits registriert.');
    }

    if (event.accessMode === 'role-required' && Array.isArray(event.requiredRoles) && event.requiredRoles.length > 0) {
        const userRoles = Array.isArray(user.roles) ? user.roles : [];
        const hasRole = event.requiredRoles.some(roleId => userRoles.includes(roleId));
        if (!hasRole) {
            return buildFailure(REGISTRATION_ERROR.MISSING_ROLE, 'Du hast nicht die erforderliche Rolle.');
        }
    }

    const rawGuests = Array.isArray(guests) ? guests : [];
    if (event.allowGuests === false && rawGuests.length > 0) {
        return buildFailure(REGISTRATION_ERROR.GUESTS_NOT_ALLOWED, 'Gäste sind für dieses Event nicht zugelassen.');
    }

    const formFields = Array.isArray(event.formFields) ? event.formFields : [];
    const missingFields = findMissingRequiredFields(formFields, formAnswers);
    if (missingFields.length > 0) {
        return buildFailure(
            REGISTRATION_ERROR.MISSING_FIELDS,
            `Bitte fülle alle Pflichtfelder aus: ${missingFields.join(', ')}`
        );
    }

    // Guests reserve a slot each until they accept or decline the invitation
    const incomingGuests = rawGuests.filter(guest => guest && typeof guest.id === 'string' && guest.id.trim());
    const requiredSlots = 1 + incomingGuests.length;

    let isWaitlisted = false;
    if (event.maxParticipants > 0) {
        const occupiedSlots = await countOccupiedSlots(eventId);
        isWaitlisted = occupiedSlots + requiredSlots > event.maxParticipants;
    }

    let status;
    if (isWaitlisted) {
        status = REGISTRATION_STATUS.WAITLISTED;
    } else {
        status = event.approvalMode === 'instant' ? REGISTRATION_STATUS.ACCEPTED : REGISTRATION_STATUS.PENDING;
    }

    const pendingGuests = incomingGuests.map(guest => ({
        userId: guest.id,
        displayName: guest.displayName || guest.id,
        avatar: guest.avatar || '',
        status: REGISTRATION_STATUS.PENDING
    }));

    const registration = {
        eventId,
        userId: user.id,
        userName: user.displayName,
        status,
        formAnswers,
        guests: [],
        pendingGuests,
        source,
        createdAt: new Date().toISOString()
    };

    const registrationRef = await addDoc(collection(db, 'registrations'), registration);

    // Guest invitations are fire and forget -> a failing DM must not block the registration
    const eventData = { id: eventId, title: event.title, startDate: event.startDate };
    for (const guest of pendingGuests) {
        sendGuestInvitation(guest.userId, { id: user.id, displayName: user.displayName }, eventData, registrationRef.id)
            .catch(err => console.error('[registrationService] sendGuestInvitation failed:', err.message));
    }

    await notifyRegistration({ user, eventId, event, status });

    return {
        ok: true,
        id: registrationRef.id,
        status,
        message: STATUS_MESSAGES[status],
        event
    };
}

/**
 * Build a normalized failure result.
 *
 * @param {string} code -> One of REGISTRATION_ERROR.
 * @param {string} error -> German message shown to the user.
 * @returns {Object} -> `{ ok: false, code, httpStatus, error }`.
 */
function buildFailure(code, error) {
    return {
        ok: false,
        code,
        httpStatus: ERROR_HTTP_STATUS[code] || 400,
        error
    };
}

module.exports = {
    registerUserForEvent,
    eventRequiresForm,
    findMissingRequiredFields,
    REGISTRATION_SOURCE,
    REGISTRATION_STATUS,
    REGISTRATION_ERROR
};
