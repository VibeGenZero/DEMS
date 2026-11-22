/**
 * Server side of „Event-Feedback“: members who took part rate an event in
 * the 7 days after its end; admins see averages, response rates and the
 * comments without names.
 *
 * Member routes check eligibility and the window live on every request.
 * When an event ends, its eligible members are asked once per DM (unless
 * the setting „noDm“ is on); `requests/<eventId>` remembers that, so an
 * event archived again asks nobody twice. Admin answers never carry user
 * ids, names or times. Uses only the `ctx` it is given and `rules.js`.
 */
const {
    ERRORS, eventEnd, feedbackWindow, isOpen, isEligible, validateAnswer, answerId, summarize, toEventView, requestDm
} = require('./rules');

const ANSWERS = 'answers';
const REQUESTS = 'requests';
const MEMBER = { access: 'member' };
const ADMIN = { access: 'admin' };
const MAX_SUMMARY_EVENTS = 100;
const MAX_ID_LENGTH = 128;
const NOT_FOUND = 'Event nicht gefunden.';

const nowIso = () => new Date().toISOString();
const isDocId = id => typeof id === 'string' && id.length >= 1 && id.length <= MAX_ID_LENGTH && !id.includes('/');
const newestFirst = (a, b) => String(b.startDate || '').localeCompare(String(a.startDate || ''));

/** Whether an event is over: archived, or its end has passed. */
function hasEnded(event, now) {
    if (!feedbackWindow(event)) return false;
    return event.status === 'archived' || eventEnd(event) <= now;
}

/**
 * @param {object} ctx -> The plugin context of the SDK.
 */
function register(ctx) {
    /** @returns {Promise<object>} -> The event; a 404 answer when there is none. */
    async function findEvent(eventId) {
        const event = isDocId(eventId) ? await ctx.events.get(eventId) : null;
        if (!event) throw ctx.httpError(404, NOT_FOUND);
        return event;
    }

    /** The member's own registration for an event, or null. */
    async function ownRegistration(eventId, userId) {
        return (await ctx.registrations.list({ eventId, userId }))[0] || null;
    }

    /** The event, when the member may give feedback for it at all (a 403 answer otherwise). */
    async function eligibleEvent(eventId, userId) {
        const event = await findEvent(eventId);
        if (!feedbackWindow(event) || !isEligible(event, await ownRegistration(eventId, userId))) {
            throw ctx.httpError(403, ERRORS.notEligible);
        }
        return event;
    }

    const plainAnswer = answer => (answer ? { rating: answer.rating, comment: answer.comment } : null);

    /** Eligible user ids of one event among `registrations`. */
    function eligibleIds(event, registrations) {
        return [...new Set(registrations.filter(entry => entry.eventId === event.id && isEligible(event, entry)).map(entry => entry.userId))];
    }

    /** DMs in the background: a message never delays or fails the hook. */
    function askPerDm(event, userIds) {
        const message = {
            text: requestDm(event),
            link: { label: 'Feedback geben', url: ctx.siteUrl(`p/event-feedback/${event.id}`) }
        };
        for (const userId of userIds) {
            ctx.discord.sendDM(userId, message)
                .catch(err => ctx.log.error('Feedback-Anfrage fehlgeschlagen:', err && err.message ? err.message : err));
        }
    }

    ctx.hooks.on('event.ended', async ({ event }) => {
        if (await ctx.data.get(REQUESTS, event.id)) return;
        const userIds = eligibleIds(event, await ctx.registrations.list({ eventId: event.id }));
        await ctx.data.set(REQUESTS, event.id, { eventId: event.id, sentAt: nowIso(), count: userIds.length });
        const { noDm } = await ctx.settings.get();
        if (noDm !== true) askPerDm(event, userIds);
    });

    ctx.hooks.on('event.deleted', async ({ eventId }) => {
        for (const answer of await ctx.data.where(ANSWERS, 'eventId', '==', eventId)) await ctx.data.delete(ANSWERS, answer.id);
        if (await ctx.data.get(REQUESTS, eventId)) await ctx.data.delete(REQUESTS, eventId);
    });

    // ── Members ─────────────────────────────────────────────────────────

    ctx.routes.get('/mine', MEMBER, async ({ user }) => {
        const now = new Date();
        const [events, registrations, answers] = await Promise.all([
            ctx.events.list(), ctx.registrations.list({ userId: user.id }), ctx.data.where(ANSWERS, 'userId', '==', user.id)
        ]);
        const own = new Map(registrations.map(entry => [entry.eventId, entry]));
        const answered = new Map(answers.map(answer => [answer.eventId, answer]));
        const mayAnswer = event => isOpen(event, now) && isEligible(event, own.get(event.id) || null);
        const open = events.filter(event => mayAnswer(event) && !answered.has(event.id)).sort(newestFirst).map(toEventView);
        const done = events.filter(event => answered.has(event.id)).sort(newestFirst).map(event => ({
            event: toEventView(event),
            ...plainAnswer(answered.get(event.id)),
            editable: mayAnswer(event)
        }));
        return { open, done };
    });

    ctx.routes.get('/events/:eventId/mine', MEMBER, async ({ user, params }) => {
        const event = await eligibleEvent(params.eventId, user.id);
        const answer = await ctx.data.get(ANSWERS, answerId(event.id, user.id));
        return { event: toEventView(event), editable: isOpen(event, new Date()), answer: plainAnswer(answer) };
    });

    ctx.routes.put('/events/:eventId/mine', MEMBER, async ({ user, params, body }) => {
        const event = await eligibleEvent(params.eventId, user.id);
        if (!isOpen(event, new Date())) throw ctx.httpError(409, ERRORS.closed);
        const result = validateAnswer(body);
        if (!result.ok) throw ctx.httpError(400, result.error);
        const id = answerId(event.id, user.id);
        const existing = await ctx.data.get(ANSWERS, id);
        const at = nowIso();
        const stored = await ctx.data.set(ANSWERS, id, {
            eventId: event.id, userId: user.id, ...result.value, createdAt: existing ? existing.createdAt : at, updatedAt: at
        });
        return plainAnswer(stored);
    });

    // ── Admins (no ids, names or times in any answer) ───────────────────

    ctx.routes.get('/summary', ADMIN, async () => {
        const now = new Date();
        const [events, registrations, answers] = await Promise.all([ctx.events.list(), ctx.registrations.list(), ctx.data.list(ANSWERS)]);
        const answersOf = new Map();
        for (const answer of answers) {
            if (!answersOf.has(answer.eventId)) answersOf.set(answer.eventId, []);
            answersOf.get(answer.eventId).push(answer);
        }
        const rows = events.filter(event => hasEnded(event, now))
            .map(event => ({ event, eligible: eligibleIds(event, registrations).length, own: answersOf.get(event.id) || [] }))
            .filter(row => row.eligible > 0 || row.own.length > 0)
            .sort((a, b) => newestFirst(a.event, b.event))
            .slice(0, MAX_SUMMARY_EVENTS);
        const byCategory = new Map();
        for (const row of rows) {
            const category = row.event.category || '';
            if (!category || row.own.length === 0) continue;
            byCategory.set(category, [...(byCategory.get(category) || []), ...row.own]);
        }
        return {
            events: rows.map(({ event, eligible, own }) => {
                const { count, average } = summarize(own);
                return { event: toEventView(event), count, eligible, average };
            }),
            categories: [...byCategory].sort(([a], [b]) => a.localeCompare(b, 'de')).map(([category, own]) => {
                const { count, average } = summarize(own);
                return { category, count, average };
            })
        };
    });

    ctx.routes.get('/events/:eventId/summary', ADMIN, async ({ params }) => {
        const event = await findEvent(params.eventId);
        const [registrations, answers] = await Promise.all([
            ctx.registrations.list({ eventId: event.id }), ctx.data.where(ANSWERS, 'eventId', '==', event.id)
        ]);
        const { count, average, distribution } = summarize(answers);
        const comments = answers.filter(answer => answer.comment)
            .map(answer => ({ rating: answer.rating, comment: answer.comment }))
            .sort((a, b) => a.rating - b.rating || a.comment.localeCompare(b.comment, 'de'));
        return { event: toEventView(event), count, eligible: eligibleIds(event, registrations).length, average, distribution, comments };
    });
}

module.exports = { register };
