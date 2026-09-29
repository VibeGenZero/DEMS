/**
 * Switch of the dev mock mode.
 *
 * With DEV_MOCK=true DEMS runs without Discord, OAuth and Firebase: a local
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
const FIREBASE_KEYS = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID'
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
    FIREBASE_KEYS.forEach(key => { env[key] = ''; });
    env.DISCORD_BOT_TOKEN = '';
    env.DISCORD_GUILD_ID = MOCK_GUILD.GUILD.id;
    env.DISCORD_ADMIN_ROLE_ID = MOCK_GUILD.ROLE_ID.ADMIN;
    env.DISCORD_ANNOUNCE_CHANNEL_ID = MOCK_GUILD.CHANNEL_ID.ANNOUNCEMENTS;
    env.DISCORD_EVENT_CATEGORY_ID = '';
    env.BASE_URL = `http://localhost:${env.PORT || 3000}`;

    if (!env.SESSION_SECRET) env.SESSION_SECRET = 'dems-dev-mock-secret';
    if (!env.ADMIN_RESET_PASSWORD) env.ADMIN_RESET_PASSWORD = 'dev';

    console.log(`🧪 DEV-MOCK-MODUS aktiv — kein Discord, kein Firebase, DB: ${env.SQLITE_PATH}`);
}

if (IS_MOCK_MODE) applyMockEnvironment();

module.exports = { IS_MOCK_MODE, MOCK_GUILD };
