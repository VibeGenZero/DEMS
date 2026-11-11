/**
 * Switch of the dev mock mode.
 *
 * With DEV_MOCK=true DEMS runs without Discord, OAuth and PostgreSQL: a local
 * SQLite file, a simulated Discord server and a persona login. Loading this
 * module forces the environment into that state -> it has to be required
 * before firebaseAdmin.js and bot.js read the environment.
 *
 * The mode refuses to run with NODE_ENV=production, because the persona login
 * would let anybody sign in as admin.
 */
const path = require('path');
require('dotenv').config({ quiet: true });
const MOCK_GUILD = require('./mockGuild');

const IS_MOCK_MODE = process.env.DEV_MOCK === 'true';

const DEFAULT_DEV_DB = path.join(__dirname, '..', 'data', 'dems.dev.sqlite');
// Own folder for uploaded banners, so mock uploads never mix with real ones
const DEFAULT_DEV_UPLOADS = path.join(__dirname, '..', 'data', 'dev-uploads');
// Blanked so firebaseAdmin.js always picks SQLite in mock mode
const POSTGRES_KEYS = [
    'DATABASE_URL',
    'PGHOST',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGPASSWORD_FILE'
];

/**
 * Force the environment of the mock mode, overriding values from .env.
 */
function applyMockEnvironment() {
    const env = process.env;

    if (env.NODE_ENV === 'production') {
        console.error('❌ DEV_MOCK=true ist in Produktion (NODE_ENV=production) nicht erlaubt. Server wird nicht gestartet.');
        process.exit(1);
    }

    env.SQLITE_PATH = env.DEV_SQLITE_PATH || DEFAULT_DEV_DB;
    env.UPLOAD_DIR = env.DEV_UPLOAD_DIR || DEFAULT_DEV_UPLOADS;
    POSTGRES_KEYS.forEach(key => { env[key] = ''; });
    env.DISCORD_BOT_TOKEN = '';
    env.DISCORD_GUILD_ID = MOCK_GUILD.GUILD.id;
    env.DISCORD_ADMIN_ROLE_ID = MOCK_GUILD.ROLE_ID.ADMIN;
    env.DISCORD_ANNOUNCE_CHANNEL_ID = MOCK_GUILD.CHANNEL_ID.ANNOUNCEMENTS;
    env.DISCORD_EVENT_CATEGORY_ID = '';
    env.BASE_URL = `http://localhost:${env.PORT || 3000}`;

    // Comment ↔ thread sync (B-16) on, so the mock log shows it; DISCORD_THREAD_SYNC=false turns it off
    if (!env.DISCORD_THREAD_SYNC) env.DISCORD_THREAD_SYNC = 'true';
    if (!env.SESSION_SECRET) env.SESSION_SECRET = 'dems-dev-mock-secret';
    if (!env.ADMIN_RESET_PASSWORD) env.ADMIN_RESET_PASSWORD = 'dev';

    console.log(`🧪 DEV-MOCK-MODUS aktiv — kein Discord, SQLite: ${env.SQLITE_PATH}`);
}

if (IS_MOCK_MODE) applyMockEnvironment();

module.exports = { IS_MOCK_MODE, MOCK_GUILD };
