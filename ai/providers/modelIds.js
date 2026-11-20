'use strict';

/**
 * The model list goes back to the admin as it is, so it carries model ids
 * only: an internal service behind the base URL must not get any other text
 * of its answer relayed (security report 2026-11).
 */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const MAX_MODELS = 1000;

/**
 * Sorted model ids of a provider answer's `data` list, at most 1000.
 *
 * @param {Array<Object>} entries -> `data` of the answer (`[{ id }, …]`).
 * @returns {string[]}
 */
function modelIdsOf(entries) {
    return (Array.isArray(entries) ? entries : [])
        .map((entry) => entry && entry.id)
        .filter((id) => typeof id === 'string' && MODEL_ID.test(id))
        .sort()
        .slice(0, MAX_MODELS);
}

module.exports = { modelIdsOf };
