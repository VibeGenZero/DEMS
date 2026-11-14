/**
 * Handlers shared by the admin API (routes/adminAi.js) and the setup wizard
 * (routes/setup.js) that try typed, unsaved AI connection values: the
 * connection test and the model list. Each router applies its own guard.
 * No answer ever contains the stored API key.
 */
const { AiError, AI_ERROR_MESSAGES, logAiFailure } = require('../ai/errors');
const { PROVIDERS, getAiClient, testConnection } = require('../ai/client');

const text = (value) => (typeof value === 'string' ? value : '');

/** The unsaved connection values of a test/models request; anything but strings is dropped. */
function overridesOf(body) {
    const input = body && typeof body === 'object' ? body : {};
    return { provider: text(input.provider), baseUrl: text(input.baseUrl), apiKey: text(input.apiKey), model: text(input.model) };
}

/**
 * The provider table for a select: id, label, default address, whether a key is needed.
 *
 * @returns {Array<{ id: string, label: string, defaultBaseUrl: string, keyRequired: boolean }>}
 */
function providerList() {
    return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, defaultBaseUrl: p.defaultBaseUrl, keyRequired: p.keyRequired }));
}

/** POST …/ai/test — `{ provider, baseUrl, apiKey, model }` -> `{ ok, ms }` or `{ ok: false, error }`; always 200 */
async function answerConnectionTest(req, res) {
    try {
        const result = await testConnection(overridesOf(req.body));
        res.json(result.ok ? { ok: true, ms: result.ms } : { ok: false, error: result.error });
    } catch (err) {
        console.error('AI test error:', err.message);
        res.json({ ok: false, error: AI_ERROR_MESSAGES.unreachable });
    }
}

/** POST …/ai/models — `{ provider, baseUrl, apiKey }` -> `{ models }`; 502 with the German sentence */
async function answerModelList(req, res) {
    try {
        const overrides = overridesOf(req.body);
        // Listing needs no model; a placeholder keeps the client usable before one is chosen
        if (!overrides.model) overrides.model = '-';
        const models = await getAiClient({ overrides }).listModels();
        res.json({ models });
    } catch (err) {
        const code = err instanceof AiError ? err.code : 'unreachable';
        logAiFailure('Modellliste', err);
        res.status(502).json({ error: AI_ERROR_MESSAGES[code] });
    }
}

module.exports = { providerList, answerConnectionTest, answerModelList };
