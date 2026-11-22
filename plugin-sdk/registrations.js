/**
 * Registrations for plugins (`ctx.registrations`, SDK 1.1, permission
 * `registrations:read`).
 *
 * A plugin gets attendance, not what a member typed: the plugin shape keeps
 * status, source, dates, check-in and slot, never form answers, guests,
 * guest check-ins, waitlist offers or the check-in invitation time.
 */
const { db, collection, getDocs } = require('../firebaseAdmin');
const { PluginPermissionError } = require('./errors');

const PERMISSION = 'registrations:read';
const MAX_ID_LENGTH = 128;

const isDocId = id => typeof id === 'string' && id.length >= 1 && id.length <= MAX_ID_LENGTH && !id.includes('/');
const orNull = value => (value === undefined || value === null || value === '' ? null : value);

/**
 * A stored registration in the shape plugins see.
 *
 * @param {string} id -> Registration document id.
 * @param {object} data -> Stored registration data.
 * @returns {{ id: string, eventId: string, userId: string, status: string, source: string|null, createdAt: string|null,
 *   checkedIn: boolean, checkedInAt: string|null, slotId: string|null }}
 */
function toPluginRegistration(id, data) {
    return {
        id,
        eventId: data.eventId,
        userId: data.userId,
        status: data.status,
        source: orNull(data.source),
        createdAt: orNull(data.createdAt),
        checkedIn: data.checkedIn === true,
        checkedInAt: orNull(data.checkedInAt),
        slotId: orNull(data.slotId)
    };
}

/**
 * Build `ctx.registrations` for one plugin.
 *
 * @param {{ granted: Set<string> }} options -> Granted manifest permissions.
 * @returns {{ list: (filter?: { eventId?: string, userId?: string }) => Promise<object[]> }}
 */
function createRegistrationsApi({ granted }) {
    return Object.freeze({
        /**
         * Registrations sorted by `createdAt`; `eventId` and `userId` filter and combine.
         * A filter that is no document id matches nothing.
         */
        async list({ eventId, userId } = {}) {
            if (!granted.has(PERMISSION)) throw new PluginPermissionError(PERMISSION);
            if (eventId !== undefined && !isDocId(eventId)) return [];
            if (userId !== undefined && !isDocId(userId)) return [];
            const snapshot = await getDocs(collection(db, 'registrations'));
            return snapshot.docs
                .map(item => toPluginRegistration(item.id, item.data()))
                .filter(item => (eventId === undefined || item.eventId === eventId)
                    && (userId === undefined || item.userId === userId))
                .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
        }
    });
}

module.exports = { createRegistrationsApi, toPluginRegistration };
