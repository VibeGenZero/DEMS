const { db, collection, doc, getDoc, addDoc, updateDoc, deleteDoc } = require('../firebaseAdmin');
const {
    sendDM, assignRole, removeRole, parseTemplate, getGuildRoles,
    addParticipantToEventChannels, removeParticipantFromEventChannels, sendGuestInvitation
} = require('../bot');
const { debugLog } = require('./debugLog');
const { findMissingRequiredFields } = require('./formFields');
const { buildEventUrl } = require('./eventUrl');
const { withEventLock } = require('./eventLock');
const { notifyRegistrationsChanged } = require('./announcementRefresh');
const { OCCUPYING_STATUSES, countOccupiedPlaces } = require('./capacity');
const {
    getSlots, findSlot, formatSlotLabel, sanitizeAltSlotIds, countSlotOccupancy, hasFreePlace, pickSlot
} = require('./slotService');
const {
    loadEventRegistrations, promoteFromWaitlist, promoteFromWaitlistLocked, announcePromotions
} = require('./eventUtils');

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

/** Machine readable failure codes returned by the functions of this module. */
const REGISTRATION_ERROR = {
    NOT_FOUND: 'event_not_found',
    INACTIVE: 'event_inactive',
    ALREADY_REGISTERED: 'already_registered',
    MISSING_ROLE: 'missing_role',
    GUESTS_NOT_ALLOWED: 'guests_not_allowed',
    MISSING_FIELDS: 'missing_fields',
    INVALID_SLOT: 'invalid_slot',
    SLOT_FULL: 'slot_full',
    NOT_REGISTERED: 'not_registered',
    NOT_MOVABLE: 'not_movable',
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
    [REGISTRATION_ERROR.INVALID_SLOT]: 400,
    [REGISTRATION_ERROR.SLOT_FULL]: 409,
    [REGISTRATION_ERROR.NOT_REGISTERED]: 404,
    [REGISTRATION_ERROR.NOT_MOVABLE]: 400,
    [REGISTRATION_ERROR.FAILED]: 500
};

/** Success messages shown to the user, keyed by resulting status. */
const STATUS_MESSAGES = {
    [REGISTRATION_STATUS.ACCEPTED]: 'Erfolgreich angemeldet!',
    [REGISTRATION_STATUS.PENDING]: 'Anfrage eingegangen.',
    [REGISTRATION_STATUS.WAITLISTED]: 'Auf die Warteliste gesetzt.'
};

/**
 * Resolve the template variables used in the bot messages.
 *
 * @param {Object} params -> Resolution input.
 * @param {Object} params.user -> The user ({ id, displayName }).
 * @param {string} params.eventId -> The event document ID.
 * @param {Object} params.event -> The event document data.
 * @param {Object|null} [params.slot] -> The slot of the registration.
 * @returns {Promise<Object>} -> Variable map for parseTemplate().
 */
async function buildTemplateVars({ user, eventId, event, slot = null }) {
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
        'event.url': buildEventUrl(eventId),
        'role.name': roleName,
        'role.mention': roleMention,
        'slot.name': slot ? slot.name : '',
        'slot.emoji': slot ? slot.emoji : ''
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
 * @param {Object|null} [params.slot] -> The slot the user got.
 * @param {boolean} [params.isAlt] -> Whether the slot is a fallback role.
 * @returns {Promise<void>} -> Resolves once all notifications were attempted.
 */
async function notifyRegistration({ user, eventId, event, status, slot = null, isAlt = false }) {
    try {
        const templateSnap = await getDoc(doc(db, 'botMessages', 'templates'));
        const globalTemplates = templateSnap.exists() ? templateSnap.data() : {};
        const customMessages = event.customBotMessages || {};
        const vars = await buildTemplateVars({ user, eventId, event, slot });
        const slotLine = slot ? `\n🎯 Dein Slot: **${formatSlotLabel(slot)}**${isAlt ? ' (Ausweichrolle)' : ''}` : '';

        if (status === REGISTRATION_STATUS.WAITLISTED) {
            const text = getSlots(event).length > 0
                ? `📋 Für **${event.title}** sind gerade alle gewünschten Slots belegt. Du wurdest auf die **Warteliste** gesetzt und rückst automatisch nach, sobald ein passender Platz frei wird!`
                : `📋 Das Event **${event.title}** ist aktuell voll. Du wurdest auf die **Warteliste** gesetzt. Wir benachrichtigen dich, sobald ein Platz frei wird!`;
            await sendDM(user.id, text);
            return;
        }

        if (status === REGISTRATION_STATUS.ACCEPTED) {
            const template = customMessages.accepted || globalTemplates.accepted;
            const message = template
                ? parseTemplate(template, vars)
                : `✅ Du wurdest automatisch für **${event.title}** angenommen!${slotLine}`;
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
            : `📋 Deine Anfrage für **${event.title}** ist eingegangen. Bitte warte auf die Bestätigung.${slotLine}`;
        await sendDM(user.id, message);
    } catch (err) {
        console.error('[registrationService] notifyRegistration failed:', err.message);
    }
}

/**
 * Success message including the slot, e.g.
 * "Erfolgreich angemeldet! Dein Slot: 💚 Heiler (🛡️ Tank war voll)."
 *
 * @param {string} status -> Resulting status.
 * @param {Object|null} slot -> Slot the user got.
 * @param {Object|null} fullPreferredSlot -> Main role that was full, if a fallback was used.
 * @returns {string} -> German message.
 */
function buildStatusMessage(status, slot, fullPreferredSlot) {
    const base = STATUS_MESSAGES[status];
    if (!slot) return base;
    const note = fullPreferredSlot ? ` (${formatSlotLabel(fullPreferredSlot)} war voll)` : '';
    return `${base} Dein Slot: ${formatSlotLabel(slot)}${note}.`;
}

/**
 * Validate a registration and write it. The caller holds the event lock.
 *
 * @param {Object} params -> Same input as registerUserForEvent().
 * @returns {Promise<Object>} -> `{ ok: true, event, registrationId, registration }` or a failure.
 */
async function createRegistration({ eventId, user, formAnswers, guests, source, slotId, altSlotIds }) {
    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return buildFailure(REGISTRATION_ERROR.NOT_FOUND, 'Event nicht gefunden');
    }

    const event = eventSnap.data();

    if (event.status && event.status !== 'active') {
        return buildFailure(REGISTRATION_ERROR.INACTIVE, 'Dieses Event akzeptiert keine Anmeldungen.');
    }

    const registrations = await loadEventRegistrations(eventId);
    if (registrations.some(registration => registration.userId === user.id)) {
        return buildFailure(REGISTRATION_ERROR.ALREADY_REGISTERED, 'Du bist bereits registriert.');
    }

    if (event.accessMode === 'role-required' && Array.isArray(event.requiredRoles) && event.requiredRoles.length > 0) {
        const userRoles = Array.isArray(user.roles) ? user.roles : [];
        const hasRole = event.requiredRoles.some(roleId => userRoles.includes(roleId));
        if (!hasRole) {
            return buildFailure(REGISTRATION_ERROR.MISSING_ROLE, 'Du hast nicht die erforderliche Rolle.');
        }
    }

    const slots = getSlots(event);
    const rawGuests = Array.isArray(guests) ? guests : [];
    if ((event.allowGuests === false || slots.length > 0) && rawGuests.length > 0) {
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

    // Guests reserve a place each until they accept or decline the invitation
    const incomingGuests = rawGuests.filter(guest => guest && typeof guest.id === 'string' && guest.id.trim());

    let isWaitlisted = false;
    let slotFields = {};
    if (slots.length > 0) {
        const preferredSlot = findSlot(slots, slotId);
        if (!preferredSlot) {
            return buildFailure(REGISTRATION_ERROR.INVALID_SLOT, 'Bitte wähle einen gültigen Slot.');
        }
        const cleanAltSlotIds = sanitizeAltSlotIds(slots, preferredSlot.id, altSlotIds);
        const assignedSlotId = pickSlot(slots, countSlotOccupancy(slots, registrations), preferredSlot.id, cleanAltSlotIds);
        slotFields = { slotId: assignedSlotId, preferredSlotId: preferredSlot.id, altSlotIds: cleanAltSlotIds };
        isWaitlisted = !assignedSlotId;
    } else if (event.maxParticipants > 0) {
        isWaitlisted = countOccupiedPlaces(registrations) + 1 + incomingGuests.length > event.maxParticipants;
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
        createdAt: new Date().toISOString(),
        ...slotFields
    };

    const registrationRef = await addDoc(collection(db, 'registrations'), registration);
    return { ok: true, event, registrationId: registrationRef.id, registration };
}

/**
 * Register a user for an event after validating every access condition.
 *
 * This is the single source of truth for registrations -> both the web UI and
 * the Discord buttons call it, so the same conditions (event status, role
 * requirement, guest rules, required form fields, slots, capacity and
 * approval mode) apply everywhere. Validation and writing run under the
 * event lock, notifications afterwards.
 *
 * @param {Object} params -> Registration input.
 * @param {string} params.eventId -> The event document ID.
 * @param {Object} params.user -> The registering user ({ id, displayName, roles }).
 * @param {Object} [params.formAnswers] -> Answers keyed by form field label.
 * @param {Array<Object>} [params.guests] -> Guests to invite ({ id, displayName, avatar }).
 * @param {string} [params.source] -> Where the registration came from ("web" or "discord").
 * @param {string|null} [params.slotId] -> Wanted main role of a slot event.
 * @param {string[]} [params.altSlotIds] -> Fallback roles of a slot event.
 * @returns {Promise<Object>} -> `{ ok: true, id, status, message, event, slotId, isAlt }` on success,
 *   `{ ok: false, code, httpStatus, error }` when a condition is not met.
 * @example
 * const result = await registerUserForEvent({
 *     eventId: 'abc123',
 *     user: { id: '1234', displayName: 'Mori', roles: ['5678'] },
 *     slotId: 'tank',
 *     altSlotIds: ['heal'],
 *     source: 'discord'
 * });
 */
async function registerUserForEvent({ eventId, user, formAnswers = {}, guests = [], source = REGISTRATION_SOURCE.WEB, slotId = null, altSlotIds = [] }) {
    debugLog('registrationService.register', { eventId, userId: user?.id, source, slotId });

    const outcome = await withEventLock(eventId, () =>
        createRegistration({ eventId, user, formAnswers, guests, source, slotId, altSlotIds }));
    if (!outcome.ok) return outcome;

    const { event, registrationId, registration } = outcome;

    // Guest invitations are fire and forget -> a failing DM must not block the registration
    const eventData = { id: eventId, title: event.title, startDate: event.startDate };
    for (const guest of registration.pendingGuests) {
        sendGuestInvitation(guest.userId, { id: user.id, displayName: user.displayName }, eventData, registrationId)
            .catch(err => console.error('[registrationService] sendGuestInvitation failed:', err.message));
    }

    const slots = getSlots(event);
    const slot = findSlot(slots, registration.slotId);
    const isAlt = !!slot && registration.slotId !== registration.preferredSlotId;
    await notifyRegistration({ user, eventId, event, status: registration.status, slot, isAlt });
    notifyRegistrationsChanged(eventId);

    return {
        ok: true,
        id: registrationId,
        status: registration.status,
        message: buildStatusMessage(registration.status, slot, isAlt ? findSlot(slots, registration.preferredSlotId) : null),
        event,
        slotId: registration.slotId || null,
        isAlt
    };
}

/**
 * Let a member move into another slot of the same event.
 *
 * Only free slots are allowed. The chosen slot becomes the new main role;
 * a waitlisted member gets the place directly. The freed place goes to the
 * waitlist.
 *
 * @param {Object} params -> Switch input.
 * @param {string} params.eventId -> The event document ID.
 * @param {string} params.userId -> Discord user ID.
 * @param {string} params.slotId -> Target slot.
 * @returns {Promise<Object>} -> `{ ok: true, status, slotId, message }` or a failure.
 */
async function switchOwnSlot({ eventId, userId, slotId }) {
    const outcome = await withEventLock(eventId, async () => {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists()) {
            return buildFailure(REGISTRATION_ERROR.NOT_FOUND, 'Event nicht gefunden');
        }
        const event = eventSnap.data();
        if (event.status && event.status !== 'active') {
            return buildFailure(REGISTRATION_ERROR.INACTIVE, 'Dieses Event akzeptiert keine Anmeldungen.');
        }

        const slots = getSlots(event);
        const target = findSlot(slots, slotId);
        if (!target) {
            return buildFailure(REGISTRATION_ERROR.INVALID_SLOT, 'Bitte wähle einen gültigen Slot.');
        }

        const registrations = await loadEventRegistrations(eventId);
        const registration = registrations.find(entry => entry.userId === userId);
        if (!registration || registration.status === 'rejected') {
            return buildFailure(REGISTRATION_ERROR.NOT_REGISTERED, 'Du bist für dieses Event nicht angemeldet.');
        }
        if (registration.slotId === target.id) {
            return { ok: true, event, registration, changed: false, wasWaitlisted: false, promotions: [] };
        }
        if (!hasFreePlace(target, countSlotOccupancy(slots, registrations))) {
            return buildFailure(REGISTRATION_ERROR.SLOT_FULL, 'Dieser Slot ist bereits voll.');
        }

        const wasWaitlisted = registration.status === REGISTRATION_STATUS.WAITLISTED;
        const update = {
            slotId: target.id,
            preferredSlotId: target.id,
            altSlotIds: (registration.altSlotIds || []).filter(id => id !== target.id)
        };
        if (wasWaitlisted) {
            update.status = event.approvalMode === 'instant' ? REGISTRATION_STATUS.ACCEPTED : REGISTRATION_STATUS.PENDING;
        }
        await updateDoc(doc(db, 'registrations', registration.id), update);

        const promotions = wasWaitlisted ? [] : await promoteFromWaitlistLocked(eventId, event);
        return { ok: true, event, registration: { ...registration, ...update }, changed: true, wasWaitlisted, promotions };
    });
    if (!outcome.ok) return outcome;

    const { event, registration } = outcome;
    const slot = findSlot(getSlots(event), registration.slotId);
    if (outcome.changed) {
        if (outcome.wasWaitlisted) {
            await notifyRegistration({
                user: { id: userId, displayName: registration.userName },
                eventId, event, status: registration.status, slot
            });
        }
        await announcePromotions(eventId, event, outcome.promotions);
        notifyRegistrationsChanged(eventId);
    }

    return {
        ok: true,
        status: registration.status,
        slotId: slot.id,
        message: `Du bist jetzt als ${formatSlotLabel(slot)} eingeplant.`
    };
}

/**
 * Move a registration into another slot (admin action).
 *
 * Admins may overbook a slot on purpose; the result then carries a warning.
 * The freed place goes to the waitlist.
 *
 * @param {Object} params -> Move input.
 * @param {string} params.registrationId -> Registration document ID.
 * @param {string} params.slotId -> Target slot.
 * @returns {Promise<Object>} -> `{ ok: true, slotId, slotName, userName, warning }` or a failure.
 */
async function moveRegistrationToSlot({ registrationId, slotId }) {
    const registrationSnap = await getDoc(doc(db, 'registrations', registrationId));
    if (!registrationSnap.exists()) {
        return buildFailure(REGISTRATION_ERROR.NOT_REGISTERED, 'Anmeldung nicht gefunden');
    }
    const { eventId } = registrationSnap.data();

    const outcome = await withEventLock(eventId, async () => {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists()) {
            return buildFailure(REGISTRATION_ERROR.NOT_FOUND, 'Event nicht gefunden');
        }
        const event = eventSnap.data();
        const slots = getSlots(event);
        const target = findSlot(slots, slotId);
        if (!target) {
            return buildFailure(REGISTRATION_ERROR.INVALID_SLOT, 'Bitte wähle einen gültigen Slot.');
        }

        const registrations = await loadEventRegistrations(eventId);
        const registration = registrations.find(entry => entry.id === registrationId);
        if (!registration) {
            return buildFailure(REGISTRATION_ERROR.NOT_REGISTERED, 'Anmeldung nicht gefunden');
        }
        if (!OCCUPYING_STATUSES.includes(registration.status)) {
            return buildFailure(REGISTRATION_ERROR.NOT_MOVABLE, 'Nur angenommene oder ausstehende Anmeldungen können verschoben werden.');
        }
        if (registration.slotId === target.id) {
            return { ok: true, event, registration, target, warning: null, promotions: [] };
        }

        const overbooked = !hasFreePlace(target, countSlotOccupancy(slots, registrations));
        await updateDoc(doc(db, 'registrations', registrationId), { slotId: target.id });
        const promotions = await promoteFromWaitlistLocked(eventId, event);
        return {
            ok: true, event, registration, target, promotions,
            warning: overbooked ? `Slot „${target.name}“ ist jetzt überbucht.` : null
        };
    });
    if (!outcome.ok) return outcome;

    await announcePromotions(eventId, outcome.event, outcome.promotions);
    notifyRegistrationsChanged(eventId);

    return {
        ok: true,
        slotId: outcome.target.id,
        slotName: outcome.target.name,
        userName: outcome.registration.userName,
        warning: outcome.warning
    };
}

/**
 * Remove the registration of a user (web, /unregister and the Discord button).
 *
 * Accepted members lose the event role and the access to the event channels;
 * a freed place goes to the waitlist.
 *
 * @param {Object} params -> Unregister input.
 * @param {string} params.eventId -> The event document ID.
 * @param {string} params.userId -> Discord user ID.
 * @returns {Promise<Object>} -> `{ ok: true, registration, event }` or a failure.
 */
async function unregisterUserFromEvent({ eventId, userId }) {
    const outcome = await withEventLock(eventId, async () => {
        const registrations = await loadEventRegistrations(eventId);
        const registration = registrations.find(entry => entry.userId === userId);
        if (!registration) {
            return buildFailure(REGISTRATION_ERROR.NOT_REGISTERED, 'Du bist für dieses Event nicht angemeldet.');
        }
        await deleteDoc(doc(db, 'registrations', registration.id));
        return { ok: true, registration };
    });
    if (!outcome.ok) return outcome;

    const { registration } = outcome;
    debugLog('registrationService.unregister', { eventId, userId, status: registration.status });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    const event = eventSnap.exists() ? eventSnap.data() : null;
    if (event) {
        try {
            if (registration.status === REGISTRATION_STATUS.ACCEPTED) {
                if (event.assignRoleId) {
                    await removeRole(userId, event.assignRoleId, process.env.DISCORD_GUILD_ID);
                }
                if (event.discordChannelId || event.discordTextChannelId) {
                    await removeParticipantFromEventChannels(event, userId);
                }
            }
        } catch (err) {
            console.error('[registrationService] cleanup after unregister failed:', err.message);
        }
        if (OCCUPYING_STATUSES.includes(registration.status)) {
            await promoteFromWaitlist(eventId, event);
        }
    }

    notifyRegistrationsChanged(eventId);
    return { ok: true, registration, event };
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
    switchOwnSlot,
    moveRegistrationToSlot,
    unregisterUserFromEvent,
    buildTemplateVars,
    REGISTRATION_SOURCE,
    REGISTRATION_STATUS,
    REGISTRATION_ERROR
};
