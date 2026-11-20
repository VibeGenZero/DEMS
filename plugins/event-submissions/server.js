/**
 * Server side of „Event einreichen“: members submit event ideas, the team
 * turns them into events („Übernehmen“) or rejects them.
 *
 * Uses only the `ctx` it is given and its own `rules.js`. Routes live below
 * `/api/plugins/event-submissions`; the event hooks follow a submission from
 * the draft (`planning`) to the published event (`accepted`). A hook whose
 * origin names an unknown, withdrawn or already decided submission is
 * ignored without a trace, so a stale „Übernehmen“ changes nothing.
 */
const {
    MAX_OPEN,
    OPEN_STATUSES,
    validateSubmission,
    validateReason,
    acceptedDm,
    rejectedDm,
    newSubmissionPost,
    statusFilter
} = require('./rules');

const PLUGIN_ID = 'event-submissions';
const COLLECTION = 'submissions';
const MAX_ID_LENGTH = 128;

const MESSAGES = {
    invalid: 'Ungültige Eingabe.',
    notFound: 'Vorschlag nicht gefunden.',
    limit: `Du hast schon ${MAX_OPEN} offene Vorschläge. Warte, bis das Team sie bearbeitet hat.`,
    notWithdrawable: 'Nur offene Vorschläge lassen sich zurückziehen.',
    alreadyDecided: 'Dieser Vorschlag wurde schon bearbeitet.'
};

const nowIso = () => new Date().toISOString();
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDocId = id => typeof id === 'string' && id.length >= 1 && id.length <= MAX_ID_LENGTH && !id.includes('/');

/**
 * Run `task` after every earlier task of the same key; the map entry is
 * released once the chain of that key is idle.
 *
 * @returns {(key: string, task: () => Promise<unknown>) => Promise<unknown>}
 */
function createKeyedQueue() {
    /** @type {Map<string, Promise<void>>} key -> tail of its chain */
    const chains = new Map();
    return (key, task) => {
        const run = (chains.get(key) || Promise.resolve()).then(task);
        const tail = run.then(() => {}, () => {});
        chains.set(key, tail);
        tail.then(() => {
            if (chains.get(key) === tail) chains.delete(key);
        });
        return run;
    };
}

/**
 * @param {object} ctx -> The plugin context of the SDK.
 */
function register(ctx) {
    const serializeByMember = createKeyedQueue();

    /** @returns {Promise<object>} -> The submission; a 404 answer when there is none. */
    async function findSubmission(id) {
        const submission = isDocId(id) ? await ctx.data.get(COLLECTION, id) : null;
        if (!submission) throw ctx.httpError(404, MESSAGES.notFound);
        return submission;
    }

    /** Fire and forget: a message never fails or delays the request. */
    function send(what, promise) {
        promise.catch(err => ctx.log.error(`${what} fehlgeschlagen:`, err && err.message ? err.message : err));
    }

    /** Tell the team about a new submission, only when a channel is set. */
    async function postNewSubmission(user, title) {
        const { notifyChannel } = await ctx.settings.get();
        if (!notifyChannel) return;
        await ctx.discord.sendChannelMessage('notifyChannel', {
            text: newSubmissionPost(user.name, title),
            link: { label: 'Vorschläge ansehen', url: ctx.siteUrl('p/event-submissions') }
        });
    }

    // ── Member routes ───────────────────────────────────────────────────

    ctx.routes.get('/mine', { access: 'member' }, async ({ user }) => {
        const own = await ctx.data.where(COLLECTION, 'userId', '==', user.id);
        return statusFilter(own, '');
    });

    ctx.routes.post('/', { access: 'member' }, async ({ user, body }) => {
        const result = validateSubmission(body, nowIso().slice(0, 10));
        if (!result.ok) throw ctx.httpError(400, result.error);

        // Count and add in one link of the member's chain, so parallel submits cannot pass the limit
        const created = await serializeByMember(user.id, async () => {
            const own = await ctx.data.where(COLLECTION, 'userId', '==', user.id);
            if (own.filter(item => OPEN_STATUSES.includes(item.status)).length >= MAX_OPEN) {
                throw ctx.httpError(409, MESSAGES.limit);
            }
            const now = nowIso();
            return ctx.data.add(COLLECTION, {
                userId: user.id,
                userName: user.name,
                userAvatar: user.avatar,
                ...result.value,
                status: 'open',
                reason: '',
                eventId: '',
                createdAt: now,
                updatedAt: now,
                decidedBy: '',
                decidedAt: ''
            });
        });

        send('Kanalnachricht', postNewSubmission(user, created.title));
        return created;
    });

    // ── Admin routes (static paths before /:id) ─────────────────────────

    ctx.routes.get('/counts', { access: 'admin' }, async () => {
        const all = await ctx.data.list(COLLECTION);
        return { open: all.filter(item => item.status === 'open').length };
    });

    ctx.routes.get('/', { access: 'admin' }, async ({ query }) => {
        const filter = typeof query.status === 'string' ? query.status : '';
        return statusFilter(await ctx.data.list(COLLECTION), filter);
    });

    ctx.routes.delete('/:id', { access: 'member' }, async ({ user, params }) => {
        const submission = await findSubmission(params.id);
        if (submission.userId !== user.id || submission.status !== 'open') {
            throw ctx.httpError(409, MESSAGES.notWithdrawable);
        }
        await ctx.data.delete(COLLECTION, submission.id);
        return { success: true };
    });

    ctx.routes.post('/:id/reject', { access: 'admin' }, async ({ user, params, body }) => {
        if (!isPlainObject(body)) throw ctx.httpError(400, MESSAGES.invalid);
        const reason = validateReason(body.reason);
        if (!reason.ok) throw ctx.httpError(400, reason.error);
        const submission = await findSubmission(params.id);
        if (!OPEN_STATUSES.includes(submission.status)) throw ctx.httpError(409, MESSAGES.alreadyDecided);

        const now = nowIso();
        const rejected = await ctx.data.update(COLLECTION, submission.id, {
            status: 'rejected',
            reason: reason.value,
            decidedBy: user.id,
            decidedAt: now,
            updatedAt: now
        });
        await ctx.audit('reject', user.id, `Vorschlag „${submission.title}“ abgelehnt`, submission.id);
        send('Direktnachricht', ctx.discord.sendDM(submission.userId, { text: rejectedDm(submission.title, reason.value) }));
        return rejected;
    });

    // ── Hooks ───────────────────────────────────────────────────────────

    /** The submission an event origin names, only when it is in one of `statuses`; else null. */
    async function submissionOf(eventOrigin, statuses) {
        if (!eventOrigin || eventOrigin.plugin !== PLUGIN_ID || !isDocId(eventOrigin.ref)) return null;
        const submission = await ctx.data.get(COLLECTION, eventOrigin.ref);
        return submission && statuses.includes(submission.status) ? submission : null;
    }

    ctx.hooks.on('event.created', async ({ event }) => {
        const submission = await submissionOf(event && event.origin, ['open']);
        if (!submission) return;
        await ctx.data.update(COLLECTION, submission.id, { status: 'planning', eventId: event.id, updatedAt: nowIso() });
    });

    ctx.hooks.on('event.published', async ({ event }) => {
        const submission = await submissionOf(event && event.origin, OPEN_STATUSES);
        if (!submission) return;
        const now = nowIso();
        // The hook does not say who published, so decidedBy stays empty
        await ctx.data.update(COLLECTION, submission.id, {
            status: 'accepted', eventId: event.id, decidedAt: now, updatedAt: now
        });
        await ctx.discord.sendDM(submission.userId, {
            text: acceptedDm(submission.title),
            link: { label: 'Zum Event', url: ctx.events.url(event.id) }
        });
    });

    ctx.hooks.on('event.deleted', async ({ eventId, origin }) => {
        const submission = await submissionOf(origin, ['planning']);
        // Only the draft this submission is planned with opens it again
        if (!submission || submission.eventId !== eventId) return;
        await ctx.data.update(COLLECTION, submission.id, { status: 'open', eventId: '', updatedAt: nowIso() });
    });
}

module.exports = { register };
