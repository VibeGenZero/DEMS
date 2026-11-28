/**
 * In-memory store of checked plugin uploads (System › Plugins).
 *
 * `POST /api/admin/plugins/upload/check` keeps the package bytes here under a
 * random id, so install works on exactly the bytes the admin saw in the
 * report. An upload belongs to one session, is taken once and expires; a
 * session keeps at most a few and the whole store a fixed number (each up
 * to 5 MB), the oldest going first. Nothing is written to disk.
 */
const crypto = require('crypto');

/**
 * Create an upload store.
 *
 * @param {object} [options]
 * @param {number} [options.ttlMs=600000] -> Lifetime of an upload (10 minutes).
 * @param {number} [options.maxPerSession=3] -> A further put drops the session's oldest upload.
 * @param {number} [options.maxTotal=20] -> A further put drops the oldest upload of any session.
 * @param {() => number} [options.now=Date.now]
 * @returns {{ put: (sessionId: string, buffer: Buffer) => string, take: (sessionId: string, uploadId: unknown) => Buffer|null, size: () => number }}
 * @example
 * const store = createUploadStore();
 * const uploadId = store.put(req.sessionID, buffer);
 * store.take(req.sessionID, uploadId); // the buffer, then null
 */
function createUploadStore({ ttlMs = 600000, maxPerSession = 3, maxTotal = 20, now = Date.now } = {}) {
    /** @type {Map<string, { sessionId: string, buffer: Buffer, at: number }>} upload id -> upload, in put order */
    const uploads = new Map();

    /** Drop every expired upload, so idle sessions do not keep their buffers. */
    function sweep() {
        const time = now();
        for (const [uploadId, upload] of uploads) {
            if (time - upload.at >= ttlMs) uploads.delete(uploadId);
        }
    }

    /** Drop the oldest upload matching `belongs` (put order). */
    function dropOldest(belongs) {
        for (const [uploadId, upload] of uploads) {
            if (belongs(upload)) {
                uploads.delete(uploadId);
                return;
            }
        }
    }

    function put(sessionId, buffer) {
        sweep();
        const key = String(sessionId);
        const ofSession = upload => upload.sessionId === key;
        while ([...uploads.values()].filter(ofSession).length >= maxPerSession) dropOldest(ofSession);
        while (uploads.size >= maxTotal) dropOldest(() => true);
        const uploadId = crypto.randomBytes(16).toString('hex');
        uploads.set(uploadId, { sessionId: key, buffer, at: now() });
        return uploadId;
    }

    function take(sessionId, uploadId) {
        sweep();
        if (typeof uploadId !== 'string') return null;
        const upload = uploads.get(uploadId);
        if (!upload || upload.sessionId !== String(sessionId)) return null;
        uploads.delete(uploadId);
        return upload.buffer;
    }

    return { put, take, size: () => uploads.size };
}

module.exports = { createUploadStore };
