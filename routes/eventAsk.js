const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { isFeatureOn } = require('../ai/settings');
const { prepareEventQuestion, AskRefusal } = require('../ai/memberAssistant');

// The member is looking at the event when the assistant goes off: say what is off (same sentence as Discord)
const SWITCHED_OFF = 'Der Event-Assistent ist gerade ausgeschaltet.';
const UNAVAILABLE = 'Der Event-Assistent ist gerade nicht erreichbar. Bitte versuche es später noch einmal.';

/** One server-sent event, terminated by a blank line. */
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * POST /api/events/:id/ask — a member asks the assistant about one event.
 * Every refusal the service can know before the provider call is a normal JSON
 * answer; only after that the response becomes an event stream.
 */
function createAskRouter({ prepare = prepareEventQuestion, featureOn = () => isFeatureOn('memberWeb') } = {}) {
    const router = express.Router();
    router.post('/:id/ask', requireAuth, async (req, res) => {
        let prepared = null;
        // Attached before prepare: a disconnect while it runs must be seen too. Never use
        // req 'close' for this: it fires as soon as the JSON body is read, without a disconnect.
        const controller = new AbortController();
        let finished = false;
        res.on('close', () => { if (!finished) controller.abort(); });
        try {
            if (!featureOn()) return res.status(404).json({ error: SWITCHED_OFF });
            const { id, roles, isAdmin } = req.session.user;
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            prepared = await prepare({
                eventId: req.params.id,
                user: { id, roles, isAdmin },
                question: body.question,
                history: body.history
            });
        } catch (err) {
            if (err instanceof AskRefusal) return res.status(err.status).json({ error: err.error });
            console.error('Event ask error:', (err && err.code) || (err && err.name) || 'Error');
            return res.status(500).json({ error: 'Die Frage konnte nicht verarbeitet werden.' });
        }

        if (res.destroyed || res.writableEnded) {
            prepared.cancel();
            return;
        }

        try {
            res.status(200);
            res.set({
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Accel-Buffering': 'no'
            });
            res.flushHeaders();
        } catch (err) {
            console.error('Event ask header error:', (err && err.code) || (err && err.name) || 'Error');
            prepared.cancel();
            return;
        }

        const write = (event, data) => {
            if (controller.signal.aborted || res.writableEnded || res.destroyed) return;
            res.write(sse(event, data));
        };
        try {
            const answer = await prepared.run({ signal: controller.signal, onToken: (text) => write('token', { text }) });
            write('done', { source: answer.source });
        } catch (err) {
            if (err instanceof AskRefusal) {
                write('error', { error: err.error });
            } else {
                if (!controller.signal.aborted) console.error('Event ask stream error:', (err && err.code) || (err && err.name) || 'Error');
                write('error', { error: UNAVAILABLE });
            }
        } finally {
            finished = true;
            if (!res.writableEnded && !res.destroyed) res.end();
        }
    });

    return router;
}

module.exports = createAskRouter();
module.exports.createAskRouter = createAskRouter;
