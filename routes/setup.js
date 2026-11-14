/**
 * Setup wizard API (#138), mounted at /api/setup. Answers only while DEMS
 * runs in setup mode (utils/setupState.js); every step except the status
 * needs a session that entered the setup PIN.
 *
 * The Discord calls are injectable (createSetupRouter(deps)) so the tests can
 * run the steps without Discord; server.js mounts the router with the defaults.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createCsrfToken } = require('../middleware/auth');
const { buildBotInviteUrl } = require('../utils/botPermissions');
const { checkClientCredentials } = require('../utils/discordFetch');
const { DEFAULT_TIMEZONE } = require('../utils/timezone');
const systemConfig = require('../utils/systemConfig');
const setupState = require('../utils/setupState');
const { savePrivacyPolicy, PRIVACY_MAX_LENGTH } = require('../utils/privacyPolicy');
const { SNOWFLAKE, RESET_PASSWORD_MIN, SYSTEM_VALUE_ERRORS, normalizeSystemValue, dropsStoredAiKey, botLoginError } = require('../utils/systemValues');
const { providerList, answerConnectionTest, answerModelList } = require('./aiConnection');

const UNLOCK_WINDOW_MS = 15 * 60 * 1000;
const UNLOCK_LIMIT = 5;
const SETUP_ACTOR = 'setup';
const SECRET_FIELDS = ['clientSecret', 'botToken'];
const DISCORD_KEYS = {
    clientId: 'DISCORD_CLIENT_ID',
    clientSecret: 'DISCORD_CLIENT_SECRET',
    botToken: 'DISCORD_BOT_TOKEN',
    guildId: 'DISCORD_GUILD_ID'
};

const MESSAGES = {
    done: 'Die Einrichtung ist bereits abgeschlossen.',
    locked: 'Bitte zuerst die Setup-PIN eingeben.',
    wrongPin: 'Falsche Setup-PIN.',
    tooMany: 'Zu viele Versuche. Bitte warte 15 Minuten und versuche es erneut.',
    clientId: 'Bitte eine gültige Client ID eintragen (17–20 Ziffern, Schritt 2 der Anleitung).',
    clientSecret: 'Bitte das Client Secret eintragen (Schritt 2 der Anleitung).',
    botToken: 'Bitte den Bot-Token eintragen (Schritt 3 der Anleitung).',
    guildId: 'Bitte eine gültige Server-ID eintragen (17–20 Ziffern, Schritt 5 der Anleitung).',
    invalidClient: 'Discord lehnt Client ID oder Client Secret ab. Prüfe beide Werte unter „OAuth2“ (Schritt 2 der Anleitung); ein neues Secret bekommst du mit „Reset Secret“.',
    unreachable: 'Discord ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
    notOnGuild: 'Der Bot ist nicht auf dem Server mit dieser ID. Lade ihn mit dem Einladungslink ein (Schritt 4 der Anleitung) und prüfe die Server-ID (Schritt 5).',
    discordFirst: 'Bitte zuerst den Discord-Schritt abschließen.',
    aiModel: 'Bitte wähle ein KI-Modell oder überspringe den KI-Schritt.',
    privacy: `Die Datenschutzerklärung darf höchstens ${PRIVACY_MAX_LENGTH} Zeichen lang sein.`,
    failed: 'Die Einrichtung ist fehlgeschlagen. Bitte versuche es erneut.'
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// Field of the complete request -> stored key of the optional AI step
const AI_FIELDS = { aiProvider: 'AI_PROVIDER', aiBaseUrl: 'AI_BASE_URL', aiApiKey: 'AI_API_KEY', aiModel: 'AI_MODEL' };

/** Default Discord helpers; required late so the tests never load the bot. */
function defaultDeps() {
    const bot = () => require('../bot');
    return {
        checkClientCredentials,
        restartBot: (token) => bot().restartBot(token),
        getGuildName: (guildId) => bot().getGuildName(guildId),
        getGuildRoles: (guildId) => bot().getGuildRoles(guildId),
        getGuildChannels: (guildId) => bot().getGuildChannels(guildId),
        getGuildCategories: (guildId) => bot().getGuildCategories(guildId)
    };
}

/**
 * Whether the Discord step is done: all values the login and the bot need are set.
 *
 * @returns {boolean}
 */
function isDiscordDone() {
    return systemConfig.hasRequiredDiscordValues(process.env) && !!text(process.env.DISCORD_BOT_TOKEN);
}

/**
 * The setup router.
 *
 * @param {Object} [deps] -> Replacements for the Discord helpers, plus `unlockLimit` (PIN attempts per 15 min and IP)
 *   and `isProduction` (default NODE_ENV=production: the session cookie is Secure, so the wizard needs HTTPS).
 * @returns {express.Router}
 */
function createSetupRouter(deps = {}) {
    const discord = { ...defaultDeps(), ...deps };
    const isProduction = deps.isProduction ?? process.env.NODE_ENV === 'production';
    const router = express.Router();

    const unlockLimiter = rateLimit({
        windowMs: UNLOCK_WINDOW_MS,
        limit: deps.unlockLimit || UNLOCK_LIMIT,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => res.status(429).json({ error: MESSAGES.tooMany })
    });

    // Every step after the PIN: only in setup mode and only for the session that entered it
    function requireUnlocked(req, res, next) {
        if (!setupState.isSetupRequired()) return res.status(409).json({ error: MESSAGES.done });
        if (!req.session || !req.session.setupUnlocked) return res.status(403).json({ error: MESSAGES.locked });
        next();
    }

    async function guildLists(guildId) {
        const [roles, channels, categories] = await Promise.all([
            discord.getGuildRoles(guildId),
            discord.getGuildChannels(guildId),
            discord.getGuildCategories(guildId)
        ]);
        return { roles, channels, categories };
    }

    /**
     * GET /api/setup/status — setup mode, unlock state, locked keys; after the PIN also the current values
     */
    router.get('/status', (req, res) => {
        try {
            const required = setupState.isSetupRequired();
            const unlocked = required && !!(req.session && req.session.setupUnlocked);
            const settings = systemConfig.listSystemSettings();
            const body = {
                required,
                unlocked,
                locked: settings.filter(entry => entry.locked).map(entry => entry.key),
                // Production cookies are Secure: over plain HTTP the PIN would never stick
                httpsRequired: isProduction && !req.secure,
                defaults: {
                    BASE_URL: process.env.BASE_URL || `${req.protocol}://${req.get('host')}`,
                    TIMEZONE: process.env.TIMEZONE || DEFAULT_TIMEZONE
                }
            };
            if (unlocked) {
                body.discordDone = isDiscordDone();
                body.values = Object.fromEntries(settings.filter(entry => !entry.secret).map(entry => [entry.key, entry.value]));
                body.secretsSet = Object.fromEntries(settings.filter(entry => entry.secret).map(entry => [entry.key, entry.isSet]));
                body.aiProviders = providerList();
            }
            res.json(body);
        } catch (err) {
            console.error('Setup status error:', err);
            res.status(500).json({ error: MESSAGES.failed });
        }
    });

    /**
     * POST /api/setup/unlock — { pin } → unlocks the wizard for this session
     */
    router.post('/unlock', unlockLimiter, async (req, res) => {
        try {
            if (!setupState.isSetupRequired()) return res.status(409).json({ error: MESSAGES.done });
            if (!setupState.checkSetupPin(req.body.pin)) return res.status(401).json({ error: MESSAGES.wrongPin });

            // A new session, like a login: a cookie planted before the PIN is useless
            await new Promise((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));
            req.session.setupUnlocked = true;
            req.session.csrfToken = createCsrfToken();
            await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));
            console.log('🔓 Einrichtungsassistent mit der Setup-PIN geöffnet.');
            res.json({ success: true, csrfToken: req.session.csrfToken });
        } catch (err) {
            console.error('Setup unlock error:', err);
            res.status(500).json({ error: MESSAGES.failed });
        }
    });

    /**
     * GET /api/setup/invite-url?clientId= — bot invite link with every permission DEMS needs
     */
    router.get('/invite-url', requireUnlocked, (req, res) => {
        try {
            const clientId = text(req.query.clientId);
            if (!SNOWFLAKE.test(clientId)) return res.status(400).json({ error: MESSAGES.clientId });
            res.json({ url: buildBotInviteUrl(clientId) });
        } catch (err) {
            console.error('Setup invite URL error:', err);
            res.status(500).json({ error: MESSAGES.failed });
        }
    });

    /**
     * POST /api/setup/discord — { clientId, clientSecret, botToken, guildId }
     * Checks the values against Discord, logs the bot in and stores them.
     */
    router.post('/discord', requireUnlocked, async (req, res) => {
        try {
            // A value from .env wins; the field in the request is ignored. An empty secret
            // keeps the one of an earlier Discord step (the wizard went back a step)
            const values = {};
            for (const [field, key] of Object.entries(DISCORD_KEYS)) {
                const keepStored = SECRET_FIELDS.includes(field) && !text(req.body[field]);
                values[key] = systemConfig.isLocked(key) || keepStored ? text(process.env[key]) : text(req.body[field]);
            }
            if (!SNOWFLAKE.test(values.DISCORD_CLIENT_ID)) return res.status(400).json({ error: MESSAGES.clientId });
            if (!values.DISCORD_CLIENT_SECRET) return res.status(400).json({ error: MESSAGES.clientSecret });
            if (!values.DISCORD_BOT_TOKEN) return res.status(400).json({ error: MESSAGES.botToken });
            if (!SNOWFLAKE.test(values.DISCORD_GUILD_ID)) return res.status(400).json({ error: MESSAGES.guildId });

            const credentials = await discord.checkClientCredentials(values.DISCORD_CLIENT_ID, values.DISCORD_CLIENT_SECRET);
            if (!credentials.ok) {
                return credentials.error === 'invalid_client'
                    ? res.status(400).json({ error: MESSAGES.invalidClient })
                    : res.status(502).json({ error: MESSAGES.unreachable });
            }

            // The ready handler registers the slash commands from process.env -> set the
            // values for the login, and take them back when Discord refuses
            const previous = Object.fromEntries(Object.values(DISCORD_KEYS).map(key => [key, process.env[key]]));
            const restore = () => {
                for (const [key, value] of Object.entries(previous)) {
                    if (value === undefined) delete process.env[key];
                    else process.env[key] = value;
                }
            };
            Object.assign(process.env, values);

            const login = await discord.restartBot(values.DISCORD_BOT_TOKEN);
            if (!login.ok) {
                restore();
                const [status, error] = botLoginError(login.error);
                return res.status(status).json({ error });
            }
            const guildName = await discord.getGuildName(values.DISCORD_GUILD_ID);
            if (!guildName) {
                restore();
                return res.status(400).json({ error: MESSAGES.notOnGuild, inviteUrl: buildBotInviteUrl(values.DISCORD_CLIENT_ID) });
            }

            const unlocked = Object.fromEntries(Object.entries(values).filter(([key]) => !systemConfig.isLocked(key)));
            await systemConfig.saveSystemValues(unlocked, { by: SETUP_ACTOR });
            console.log(`🤖 Einrichtung: Bot ist auf "${guildName}" angemeldet, Discord-Werte gespeichert.`);
            res.json({ guildName, ...(await guildLists(values.DISCORD_GUILD_ID)) });
        } catch (err) {
            console.error('Setup Discord step error:', err);
            res.status(500).json({ error: MESSAGES.failed });
        }
    });

    /**
     * GET /api/setup/guild — roles, channels and categories again (wizard reloaded after the Discord step)
     */
    router.get('/guild', requireUnlocked, async (req, res) => {
        try {
            if (!isDiscordDone()) return res.status(400).json({ error: MESSAGES.discordFirst });
            const guildId = process.env.DISCORD_GUILD_ID;
            res.json({ guildName: await discord.getGuildName(guildId), ...(await guildLists(guildId)) });
        } catch (err) {
            console.error('Setup guild error:', err);
            res.status(500).json({ error: MESSAGES.failed });
        }
    });

    /**
     * POST /api/setup/ai/test and /api/setup/ai/models — the typed, unsaved AI values of the optional step
     * (same answers as /api/admin/ai/test and /api/admin/ai/models)
     */
    router.post('/ai/test', requireUnlocked, answerConnectionTest);
    router.post('/ai/models', requireUnlocked, answerModelList);

    /**
     * Changes of the optional AI step. Without a provider (typed or from .env) nothing of the AI is stored.
     *
     * @param {Object} body -> Request body with aiProvider, aiBaseUrl, aiApiKey, aiModel.
     * @returns {{ changes: Object }|{ error: string }}
     */
    function aiChanges(body) {
        const changes = {};
        for (const [field, key] of Object.entries(AI_FIELDS)) {
            if (systemConfig.isLocked(key)) continue;
            const result = normalizeSystemValue(key, body[field]);
            if (result.error) return { error: result.error };
            if (!result.skip) changes[key] = result.value;
        }
        const provider = systemConfig.isLocked('AI_PROVIDER') ? text(process.env.AI_PROVIDER) : changes.AI_PROVIDER;
        if (!provider) return { changes: {} };
        const model = systemConfig.isLocked('AI_MODEL') ? text(process.env.AI_MODEL) : changes.AI_MODEL;
        if (!model) return { error: MESSAGES.aiModel };
        return { changes };
    }

    /**
     * POST /api/setup/complete — server values, reset password, optional AI connection and privacy policy; ends setup mode
     */
    router.post('/complete', requireUnlocked, async (req, res) => {
        try {
            if (!isDiscordDone()) return res.status(400).json({ error: MESSAGES.discordFirst });
            const body = req.body;
            const changes = {};
            const unlocked = (key) => !systemConfig.isLocked(key);

            // Field of the request -> stored key; a key set by .env keeps its value
            const fields = {
                BASE_URL: body.baseUrl,
                SERVER_NAME: body.serverName,
                TIMEZONE: text(body.timezone) || DEFAULT_TIMEZONE,
                DISCORD_ADMIN_ROLE_ID: body.adminRoleId,
                DISCORD_ANNOUNCE_CHANNEL_ID: body.announceChannelId,
                DISCORD_EVENT_CATEGORY_ID: body.eventCategoryId,
                DISCORD_THREAD_SYNC: body.threadSync === true,
                ADMIN_RESET_PASSWORD: body.adminResetPassword
            };
            for (const [key, raw] of Object.entries(fields)) {
                if (!unlocked(key)) continue;
                // The wizard always needs a reset password; the "System" view may keep the old one
                if (key === 'ADMIN_RESET_PASSWORD' && text(raw).length < RESET_PASSWORD_MIN) {
                    return res.status(400).json({ error: SYSTEM_VALUE_ERRORS.ADMIN_RESET_PASSWORD });
                }
                const result = normalizeSystemValue(key, raw);
                if (result.error) return res.status(400).json({ error: result.error });
                changes[key] = result.value;
            }
            const ai = aiChanges(body);
            if (ai.error) return res.status(400).json({ error: ai.error });
            Object.assign(changes, ai.changes);
            // A stored key never follows a new provider or address
            if (!systemConfig.isLocked('AI_API_KEY') && dropsStoredAiKey(changes)) changes.AI_API_KEY = '';
            const privacyMarkdown = text(body.privacyMarkdown);
            if (privacyMarkdown.length > PRIVACY_MAX_LENGTH) return res.status(400).json({ error: MESSAGES.privacy });

            const saved = await systemConfig.saveSystemValues(changes, { by: SETUP_ACTOR });
            if (privacyMarkdown) await savePrivacyPolicy(privacyMarkdown, SETUP_ACTOR);
            await systemConfig.markSetupCompleted('wizard', SETUP_ACTOR);
            setupState.endSetupMode();
            console.log('✅ Einrichtung abgeschlossen. Mitglieder können sich jetzt mit Discord anmelden.');

            // The setup session has done its job; the admin logs in with Discord next
            await new Promise(resolve => req.session.destroy(() => resolve()));
            res.json({ success: true, restartRequired: saved.applies.has('restart') });
        } catch (err) {
            console.error('Setup complete error:', err);
            res.status(500).json({ error: MESSAGES.failed });
        }
    });

    return router;
}

module.exports = { createSetupRouter, SETUP_MESSAGES: MESSAGES };
