/**
 * In-memory store of checked plugin uploads (System › Plugins).
 *
 * `POST /api/admin/plugins/upload/check` keeps the package bytes here under a
 * random id, so install works on exactly the bytes the admin saw in the
 * report. An upload belongs to one session, is taken once and expires;
 * a session keeps at most a few. Nothing is written to disk.
 */
const crypto = require('crypto');

/**
 * Create an upload store.
 *
 * @param {object} [options]
 * @param {number} [options.ttlMs=600000] -> Lifetime of an upload (10 minutes).
 * @param {number} [options.maxPerSession=3] -> A further put drops the session's oldest upload.
 * @param {() => number} [options.now=Date.now]
 * @returns {{ put: (sessionId: string, buffer: Buffer) => string, take: (sessionId: string, uploadId: unknown) => Buffer|null }}
 * @example
 * const store = createUploadStore();
 * const uploadId = store.put(req.sessionID, buffer);
 * store.take(req.sessionID, uploadId); // the buffer, then null
 */
function createUploadStore({ ttlMs = 600000, maxPerSession = 3, now = Date.now } = {}) {
    /** @type {Map<string, Map<string, { buffer: Buffer, at: number }>>} session -> uploads in put order */
    const sessions = new Map();

    const isExpired = upload => now() - upload.at >= ttlMs;

    /** Drop every expired upload, so idle sessions do not keep their buffers. */
    function sweep() {
        for (const [sessionId, uploads] of sessions) {
            for (const [uploadId, upload] of uploads) {
                if (isExpired(upload)) uploads.delete(uploadId);
            }
            if (uploads.size === 0) sessions.delete(sessionId);
        }
    }

    function put(sessionId, buffer) {
        sweep();
        const key = String(sessionId);
        const uploads = sessions.get(key) || new Map();
        while (uploads.size >= maxPerSession) uploads.delete(uploads.keys().next().value);
        const uploadId = crypto.randomBytes(16).toString('hex');
        uploads.set(uploadId, { buffer, at: now() });
        sessions.set(key, uploads);
        return uploadId;
    }

    function take(sessionId, uploadId) {
        if (typeof uploadId !== 'string') return null;
        const key = String(sessionId);
        const uploads = sessions.get(key);
        const upload = uploads && uploads.get(uploadId);
        if (!upload) return null;
        uploads.delete(uploadId);
        if (uploads.size === 0) sessions.delete(key);
        return isExpired(upload) ? null : upload.buffer;
    }

    return { put, take };
}

module.exports = { createUploadStore };
