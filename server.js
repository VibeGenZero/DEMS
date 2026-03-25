require('dotenv').config();

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { startBot, startReminderScheduler, stopBot, getGuildName } = require('./bot');

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

// ── Security ────────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://npmcdn.com", "https://unpkg.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://npmcdn.com", "https://unpkg.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "https://npmcdn.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https://discord.com", "https://cdn.discordapp.com", "https://cdn.jsdelivr.net"], // easyMDE might fetch icons
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
    legacyHeaders: false
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Zu viele Login-Versuche.' }
});
app.use('/auth/', authLimiter);

// ── Middleware ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// ── CSRF Protection (Double-Submit Cookie) ──────────────────────────────
// Generate a CSRF token per session and validate on mutating requests
app.use((req, res, next) => {
    // Initialize CSRF token in session
    if (req.session && !req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }

    // Expose token via a dedicated endpoint and in a cookie
    if (req.session && req.session.csrfToken) {
        res.cookie('XSRF-TOKEN', req.session.csrfToken, {
            httpOnly: false, // JS needs to read it
            sameSite: 'strict'
        });
    }

    // Validate on mutating requests to /api/
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.path.startsWith('/api/')) {
        const token = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
        if (!token || token !== req.session.csrfToken) {
            return res.status(403).json({ error: 'Ungültiges CSRF-Token. Bitte Seite neu laden.' });
        }
    }

    next();
});

// ── Static files ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ──────────────────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
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
    try {
        // Priority 1: Environment variable override
        if (process.env.SERVER_NAME) {
            return res.json({ serverName: process.env.SERVER_NAME });
        }

        // Priority 2: Fetch from Discord API
        const guildId = process.env.DISCORD_GUILD_ID;
        if (guildId) {
            const serverName = await getGuildName(guildId);
            if (serverName) {
                return res.json({ serverName });
            }
        }

        // Fallback
        res.json({ serverName: 'DEMS' });
    } catch (err) {
        console.error('Error fetching server info:', err);
        res.json({ serverName: 'DEMS' });
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

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`\n🌐 DEMS Server running at http://localhost:${PORT}\n`);
});

// Start Discord bot
startBot(process.env.DISCORD_BOT_TOKEN);

// Start reminder scheduler (checks every 5 min)
startReminderScheduler();

// ── Graceful Shutdown ───────────────────────────────────────────────────
function gracefulShutdown(signal) {
    console.log(`\n⏹️ ${signal} empfangen. Server wird heruntergefahren...`);
    server.close(() => {
        console.log('✅ HTTP Server geschlossen.');
        stopBot();
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
