// dotenv >= 17 logs every load by default -> keep the startup output as before
require('dotenv').config({ quiet: true });

// Dev mock mode (DEV_MOCK=true) -> has to adjust the environment before
// firebaseAdmin.js and bot.js read it (see dev/mockMode.js)
const { IS_MOCK_MODE } = require('./dev/mockMode');
const { debugLog, IS_DEBUG } = require('./utils/debugLog');

const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { startBot, whenBotSettled, startReminderScheduler, stopBot, getGuildName, getGuildIconUrl, fetchMemberRoleIds } = require('./bot');
const { startPollScheduler, stopPollScheduler } = require('./utils/pollStore');
const { startArchiveScheduler, stopArchiveScheduler } = require('./utils/eventArchive');
const { startOfferScheduler, stopOfferScheduler } = require('./utils/waitlistOffers');
const { startUpdateCheck, stopUpdateCheck } = require('./utils/updateCheck');
const { createCsrfToken, createRoleRefresh } = require('./middleware/auth');
const { createApiLimiter } = require('./middleware/rateLimits');
const { sharedSessionStore } = require('./utils/sessionStore');
const store = require('./firebaseAdmin');
const { runMigrations } = require('./db/migrate');
const { loadSystemConfig } = require('./utils/systemConfig');
const { loadAiSettings, publicAiInfo, isFeatureOn } = require('./ai/settings');
const { pruneUsage } = require('./ai/usage');
const { initSetupState, isSetupRequired } = require('./utils/setupState');
const { createSetupRouter } = require('./routes/setup');
const { privacyGate } = require('./middleware/privacy');
const { getPrivacyPolicy } = require('./utils/privacyPolicy');
const { BANNER_FILE, bannerDir, sweepOrphanBanners } = require('./utils/bannerStore');

// Production runs behind a TLS proxy (trust proxy below) -> cookies only over HTTPS
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Proxy (Railway, Heroku, etc.)
// Needed for correct IP addressing in rate limiting behind load balancers
app.set('trust proxy', 1);

// ── Validate required env vars ──────────────────────────────────────────
// A missing SESSION_SECRET is generated and stored at start (utils/systemConfig.js, #138);
// the placeholder from old examples would sign every session with a known secret
if (process.env.SESSION_SECRET === 'your_random_session_secret_here') {
    console.error('❌ SESSION_SECRET steht noch auf dem Standardwert. Bitte in .env ändern oder die Zeile löschen (DEMS erzeugt dann selbst eins).');
    process.exit(1);
}

// ── Health check ────────────────────────────────────────────────────────
// Registered before the session middleware so container health probes do
// not create a new session on every call.
app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
});

// ── Security ────────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // Libraries and fonts are vendored in public/vendor/, so no CDN host is allowed.
            // No inline scripts or handlers: actions run through data-click (public/js/core/actions.js).
            // No inline styles either: markup carries no style attribute and no style element
            // (test/cssRules.test.js). Styles that scripts set through the CSSOM (element.style.…) still work.
            scriptSrc: ["'self'"],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'"],
            styleSrcAttr: ["'none'"],
            fontSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https://discord.com", "https://cdn.discordapp.com"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'", "https://discord.com"]
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(cors({
    // Read per request: BASE_URL can come from the setup wizard or the admin "System" view (#138)
    origin: (origin, callback) => callback(null, process.env.BASE_URL || 'http://localhost:3000'),
    credentials: true
}));

// ── Rate limiting ───────────────────────────────────────────────────────
// /api/* is limited per user once the session is read (middleware/rateLimits.js, below)

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Zu viele Login-Versuche.' },
    skip: () => IS_MOCK_MODE
});
app.use('/auth/', authLimiter);

// ── Uploaded banners (W-12) ─────────────────────────────────────────────
// Public and read-only (Discord fetches them for embeds); before the session
// middleware so an image request creates no session. Only `<uuid>.<ext>` names.
app.use('/uploads/banners',
    (req, res, next) => (BANNER_FILE.test(req.path.slice(1)) ? next() : res.status(404).end()),
    (req, res, next) => express.static(bannerDir(), { index: false, dotfiles: 'deny', maxAge: '7d', immutable: true })(req, res, next),
    (req, res) => res.status(404).end());

// ── Middleware ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Express 5 leaves req.body undefined when a request carries no body ->
// restore the Express 4 default so handlers can keep destructuring it.
app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};
    next();
});
// The secret may come from the database (#138), so the session middleware is
// built in start() once the configuration is loaded; nothing listens before that
let sessionMiddleware = null;
function createSessionMiddleware() {
    return session({
        // Sessions in the database (PostgreSQL/SQLite) -> logins survive restarts and deploys
        store: sharedSessionStore(),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: IS_PRODUCTION,
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    });
}
app.use((req, res, next) => sessionMiddleware(req, res, next));
// Per logged-in user, else per IP; dev mock mode: frequent reloads while developing must not hit the limit
app.use('/api/', createApiLimiter({ skip: IS_MOCK_MODE }));

// ── CSRF Protection (Double-Submit Cookie) ──────────────────────────────
// Generate a CSRF token per session and validate on mutating requests
app.use((req, res, next) => {
    // The token is minted only where the SPA asks for it (and at login, startUserSession):
    // sessions are stored in the database, so minting it on every cookie-less request
    // (pages, assets, crawlers) would write a session document each time
    if (req.session && !req.session.csrfToken && req.method === 'GET' && req.path === '/api/csrf-token') {
        req.session.csrfToken = createCsrfToken();
    }

    // Expose token via a dedicated endpoint and in a cookie
    if (req.session && req.session.csrfToken) {
        res.cookie('XSRF-TOKEN', req.session.csrfToken, {
            httpOnly: false, // JS needs to read it
            sameSite: 'strict',
            secure: IS_PRODUCTION
        });
    }

    // Validate on mutating requests to /api/ and /auth/ (logout)
    const isProtectedPath = req.path.startsWith('/api/') || req.path.startsWith('/auth/');
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && isProtectedPath) {
        const token = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
        if (!token || token !== req.session.csrfToken) {
            return res.status(403).json({ error: 'Ungültiges CSRF-Token. Bitte Seite neu laden.' });
        }
    }

    next();
});

// ── Static files ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
// Dev mock mode: banners of the dummy events (dev/banners, see dev/seedData.js)
if (IS_MOCK_MODE) app.use('/dev-banners', express.static(path.join(__dirname, 'dev', 'banners')));

// Roles and admin right of logged-in users are re-read from Discord at most every
// 5 minutes (after static files, so assets never wait for Discord)
app.use(createRoleRefresh({ fetchMemberRoleIds }));

// ── Debug HTTP logging ───────────────────────────────────────────────────
if (IS_DEBUG) {
    app.use((req, res, next) => {
        const start = Date.now();
        const sensitiveFields = ['password', 'token', 'secret', 'key', 'csrftoken'];

        // Sanitize body for logging
        let safeBody = null;
        if (req.body && Object.keys(req.body).length) {
            safeBody = Object.fromEntries(
                Object.entries(req.body).map(([k, v]) =>
                    [k, sensitiveFields.includes(k.toLowerCase()) ? '[REDACTED]' : v]
                )
            );
        }

        res.on('finish', () => {
            const ms = Date.now() - start;
            const status = res.statusCode;
            const color = status >= 500 ? '\x1b[31m'
                        : status >= 400 ? '\x1b[33m'
                        : '\x1b[32m';
            const reset = '\x1b[0m';
            const ip = req.ip || req.connection?.remoteAddress || '-';
            console.log(
                `\x1b[90m[DEBUG ${new Date().toTimeString().slice(0,8)}]\x1b[0m` +
                ` \x1b[36m${req.method}\x1b[0m ${req.originalUrl}` +
                ` → ${color}${status}${reset} (${ms}ms) — ${ip}`
            );
            if (safeBody) debugLog('  body', safeBody);
        });

        next();
    });
}

// ── Setup mode (#138) ───────────────────────────────────────────────────
// A fresh installation answers only the setup wizard and the endpoints the
// start page needs until the wizard is completed
const SETUP_OPEN_PATHS = ['/api/csrf-token', '/api/server-info', '/api/maintenance/status', '/api/privacy', '/api/updates'];
app.use((req, res, next) => {
    if (!isSetupRequired()) return next();
    const isApi = req.path.startsWith('/api/') || req.path.startsWith('/auth/');
    if (!isApi || req.path.startsWith('/api/setup/') || SETUP_OPEN_PATHS.includes(req.path)) return next();
    res.status(503).json({ error: 'DEMS ist noch nicht eingerichtet.', setupRequired: true });
});
app.use('/api/setup', createSetupRouter());

// Members accept the current privacy policy before anything else (#138)
app.use(privacyGate);

// ── Routes ──────────────────────────────────────────────────────────────
// Dev mock mode: persona login instead of Discord OAuth2 (see dev/devAuth.js)
if (IS_MOCK_MODE) app.use('/auth', require('./dev/devAuth'));
app.use('/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/eventAsk'));
app.use('/api/events', require('./routes/events'));
app.use('/api/polls', require('./routes/polls'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/user', require('./routes/user'));

// CSRF token endpoint (for frontend to fetch)
app.get('/api/csrf-token', (req, res) => {
    res.json({ token: req.session.csrfToken });
});

// Public maintenance status endpoint (no auth required)
app.get('/api/maintenance/status', async (req, res) => {
    try {
        const { db, doc, getDoc } = require('./firebaseAdmin');
        const snap = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        if (!snap.exists()) {
            return res.json({ active: false });
        }
        const data = snap.data();
        res.json({
            active: !!(data.warningEnabled || data.panicMode),
            warningEnabled: !!data.warningEnabled,
            warningText: data.warningText || '',
            loginDisabled: !!data.loginDisabled,
            registrationDisabled: !!data.registrationDisabled,
            plannedMaintenance: !!data.plannedMaintenance,
            plannedMaintenanceStart: data.plannedMaintenanceStart || '',
            plannedMaintenanceEnd: data.plannedMaintenanceEnd || '',
            plannedMaintenanceText: data.plannedMaintenanceText || '',
            panicMode: !!data.panicMode
        });
    } catch (err) {
        console.error('Maintenance status error:', err);
        res.json({ active: false });
    }
});

// Server info endpoint - server name (env override or Discord API) and icon for the login page
app.get('/api/server-info', async (req, res) => {
    const debugMode = IS_DEBUG;
    let info;
    let ai = { memberAssistant: false, assistantName: '', teaserText: '', adminAssistant: false };
    try {
        ai = { ...publicAiInfo(), adminAssistant: isFeatureOn('adminAssistant') };
        const guildId = process.env.DISCORD_GUILD_ID || '';
        // The icon comes from Discord even when SERVER_NAME overrides the name
        const iconUrl = guildId ? await getGuildIconUrl(guildId) : null;
        // SERVER_NAME overrides the Discord name
        const serverName = process.env.SERVER_NAME || (guildId ? await getGuildName(guildId) : '') || 'DEMS';
        info = { serverName, iconUrl, guildId, debugMode };
    } catch (err) {
        console.error('Error fetching server info:', err);
        info = { serverName: 'DEMS', iconUrl: null, guildId: '', debugMode };
        ai = { memberAssistant: false, assistantName: '', teaserText: '', adminAssistant: false };
    }
    res.json({ ...info, ai });
});

// Privacy policy of this installation (#138): public, linked from the login page
app.get('/api/privacy', async (req, res) => {
    try {
        const policy = await getPrivacyPolicy();
        if (!policy) return res.status(404).json({ error: 'Es gibt keine Datenschutzerklärung.' });
        res.json({ markdown: policy.markdown, version: policy.version, updatedAt: policy.updatedAt });
    } catch (err) {
        console.error('Privacy policy error:', err);
        res.status(500).json({ error: 'Die Datenschutzerklärung konnte nicht geladen werden.' });
    }
});

// Updates endpoint
app.get('/api/updates', (req, res) => {
    try {
        const updatesPath = path.join(__dirname, 'updates.json');
        res.sendFile(updatesPath);
    } catch (err) {
        console.error('Updates error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Updates' });
    }
});

// SPA fallback (Express 5 path syntax: named wildcard, braces make it match "/" too)
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ────────────────────────────────────────────────────────
// The database comes first: connect, run pending migrations, then open HTTP,
// the bot and the schedulers -> no request ever meets a half-migrated store
let server = null;

async function start() {
    await store.ready();
    await runMigrations(store);
    // Stored configuration (setup wizard, admin "System" view) fills what .env leaves empty
    const loaded = await loadSystemConfig();
    console.log(`⚙️ Konfiguration: ${loaded.fromDb} Werte aus der Datenbank, ${loaded.fromEnv} aus der Umgebung (.env).`);
    await loadAiSettings();
    sessionMiddleware = createSessionMiddleware();
    // Setup mode: no Discord values yet -> the wizard runs, the PIN goes to the log
    await initSetupState({ mockMode: IS_MOCK_MODE });

    server = app.listen(PORT, (err) => {
        // Express 5 hands listen errors (e.g. EADDRINUSE) to this callback instead
        // of crashing -> exit so a supervisor like Docker can restart the process.
        if (err) {
            console.error(`❌ Server konnte nicht auf Port ${PORT} starten:`, err.message);
            process.exit(1);
        }
        console.log(`\n🌐 DEMS Server running at http://localhost:${PORT}\n`);
    });

    // Start Discord bot
    startBot(process.env.DISCORD_BOT_TOKEN);

    // Start reminder scheduler (checks every 5 min)
    startReminderScheduler();
    startPollScheduler();
    // Archives events a day after their end; the first run catches up after a pause and
    // waits for the bot, so the Discord announcements of archived events get refreshed (W-01)
    startArchiveScheduler({ waitFor: whenBotSettled() });
    // Waitlist offers that were not confirmed in time go to the next member (B-15)
    startOfferScheduler({ waitFor: whenBotSettled() });
    // Tells admins about a newer DEMS release (GitHub releases, every 12 h; off in mock mode)
    startUpdateCheck({ mockMode: IS_MOCK_MODE });
    // AI usage counters are kept 90 days: prune at start, then every 6 h like expired sessions
    const pruneAiUsage = () => pruneUsage().catch((err) => console.error('KI-Nutzung konnte nicht bereinigt werden:', err.message));
    pruneAiUsage();
    setInterval(pruneAiUsage, 6 * 60 * 60 * 1000).unref();
    // Uploaded banners no event uses and older than a day (wizard closed without saving, W-12)
    sweepOrphanBanners().then((count) => {
        if (count > 0) console.log(`🧹 ${count} verwaiste Banner gelöscht.`);
    });
}

start().catch((err) => {
    console.error(`❌ Start abgebrochen: ${err.message}`);
    process.exit(1);
});

// ── Graceful Shutdown ───────────────────────────────────────────────────
function gracefulShutdown(signal) {
    console.log(`\n⏹️ ${signal} empfangen. Server wird heruntergefahren...`);
    const finish = async () => {
        stopBot();
        stopPollScheduler();
        stopArchiveScheduler();
        stopOfferScheduler();
        stopUpdateCheck();
        await store.close().catch((err) => console.error('⚠️ Datenbank konnte nicht sauber geschlossen werden:', err.message));
        console.log('✅ Bot, Scheduler & Datenbank gestoppt. Auf Wiedersehen!');
        process.exit(0);
    };
    // A signal during startup: nothing listens yet
    if (!server) return finish();
    server.close(() => {
        console.log('✅ HTTP Server geschlossen.');
        finish();
    });
    // Force exit after 10 seconds
    setTimeout(() => {
        console.error('⚠️ Erzwungener Shutdown nach Timeout.');
        process.exit(1);
    }, 10000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
