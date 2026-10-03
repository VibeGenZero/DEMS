/**
 * Serialize work per event inside this process.
 *
 * DEMS runs as one Node.js process, so an in-memory promise chain per event
 * is enough to stop two registrations from taking the same last place.
 * The lock is NOT reentrant -> code that already holds it must not call
 * withEventLock() for the same event again, it would wait for itself.
 */
const chains = new Map();

/**
 * Run `fn` once all earlier work for the same event has finished.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Function} fn -> Async work to run exclusively.
 * @returns {Promise<*>} -> Result (or error) of `fn`.
 * @example
 * const result = await withEventLock(eventId, () => createRegistration(params));
 */
function withEventLock(eventId, fn) {
    const previous = chains.get(eventId) || Promise.resolve();
    const result = previous.then(() => fn());
    const tail = result.then(() => undefined, () => undefined);
    chains.set(eventId, tail);
    tail.then(() => {
        if (chains.get(eventId) === tail) chains.delete(eventId);
    });
    return result;
}

module.exports = { withEventLock };
