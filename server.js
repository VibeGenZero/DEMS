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
const { startBot, startReminderScheduler, stopBot, getGuildName, fetchMemberRoleIds } = require('./bot');
const { startPollScheduler, stopPollScheduler } = require('./utils/pollStore');
const { createCsrfToken, createRoleRefresh } = require('./middleware/auth');
const { PersistentSessionStore } = require('./utils/sessionStore');

// Production runs behind a TLS proxy (trust proxy below) -> cookies only over HTTPS
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Proxy (Railway, Heroku, etc.)
// Needed for correct IP addressing in rate limiting behind load balancers
app.set('trust proxy', 1);

// ── Validate required env vars ──────────────────────────────────────────
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'your_random_session_secret_here') {
    console.error('❌ SESSION_SECRET ist nicht gesetzt oder noch auf dem Standardwert. Bitte in .env setzen.');
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
            // No inline scripts or handlers: actions run through data-click (public/js/core/actions.js);
            // styles keep 'unsafe-inline' until D-02 removes the style attributes.
            scriptSrc: ["'self'"],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
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
    origin: process.env.BASE_URL || 'http://localhost:3000',
    credentials: true
}));

// ── Rate limiting ───────────────────────────────────────────────────────
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    message: { error: 'Zu viele Anfragen. Bitte versuche es später erneut.' },
    standardHeaders: true,
    legacyHeaders: false,
    // Dev mock mode: frequent reloads while developing must not hit the limit
    skip: () => IS_MOCK_MODE
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Zu viele Login-Versuche.' },
    skip: () => IS_MOCK_MODE
});
app.use('/auth/', authLimiter);

// ── Middleware ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Express 5 leaves req.body undefined when a request carries no body ->
// restore the Express 4 default so handlers can keep destructuring it.
app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};
    next();
});
app.use(session({
    // Sessions in the database (SQLite/Firestore) -> logins survive restarts and deploys
    store: new PersistentSessionStore(),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: IS_PRODUCTION,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

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

// ── Routes ──────────────────────────────────────────────────────────────
// Dev mock mode: persona login instead of Discord OAuth2 (see dev/devAuth.js)
if (IS_MOCK_MODE) app.use('/auth', require('./dev/devAuth'));
app.use('/auth', require('./routes/auth'));
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

// Server info endpoint - returns server name (env override or Discord API)
app.get('/api/server-info', async (req, res) => {
    const debugMode = IS_DEBUG;
    try {
        const guildId = process.env.DISCORD_GUILD_ID || '';
        if (process.env.SERVER_NAME) {
            return res.json({ serverName: process.env.SERVER_NAME, guildId, debugMode });
        }

        if (guildId) {
            const serverName = await getGuildName(guildId);
            if (serverName) {
                return res.json({ serverName, guildId, debugMode });
            }
        }

        res.json({ serverName: 'DEMS', guildId, debugMode });
    } catch (err) {
        console.error('Error fetching server info:', err);
        res.json({ serverName: 'DEMS', guildId: '', debugMode });
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
const server = app.listen(PORT, (err) => {
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

// ── Graceful Shutdown ───────────────────────────────────────────────────
function gracefulShutdown(signal) {
    console.log(`\n⏹️ ${signal} empfangen. Server wird heruntergefahren...`);
    server.close(() => {
        console.log('✅ HTTP Server geschlossen.');
        stopBot();
        stopPollScheduler();
        console.log('✅ Bot & Scheduler gestoppt. Auf Wiedersehen!');
        process.exit(0);
    });
    // Force exit after 10 seconds
    setTimeout(() => {
        console.error('⚠️ Erzwungener Shutdown nach Timeout.');
        process.exit(1);
    }, 10000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
