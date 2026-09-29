/**
 * Persona login of the dev mock mode.
 *
 * Mounted in front of routes/auth.js only when DEV_MOCK=true. It replaces the
 * Discord OAuth2 round trip with a page listing the mock personas and creates
 * exactly the session the real OAuth2 callback creates.
 */
const express = require('express');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const { PERSONAS, defaultAvatar } = require('./mockGuild');

const router = express.Router();

/**
 * Escape text for use inside HTML.
 *
 * @param {string} value -> Raw text.
 * @returns {string} -> HTML-safe text.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Render the persona selection page.
 *
 * @returns {string} -> Complete HTML document.
 */
function renderPersonaPage() {
    const personas = PERSONAS.map(persona => `
        <a class="persona" href="/auth/dev-login/${encodeURIComponent(persona.id)}">
            <img src="${escapeHtml(defaultAvatar(persona.userId))}" alt="" width="48" height="48">
            <span>
                <strong>${escapeHtml(persona.displayName)}</strong>
                <small>${escapeHtml(persona.description)}</small>
            </span>
        </a>`).join('');

    return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DEMS Dev-Login</title>
<style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f0f1a; color: #e5e7eb; font-family: system-ui, sans-serif; }
    main { width: min(420px, calc(100% - 32px)); }
    h1 { font-size: 1.4rem; margin: 0 0 4px; }
    p { margin: 0 0 20px; color: #9ca3af; }
    .persona { display: flex; gap: 14px; align-items: center; padding: 12px 14px; margin-bottom: 10px; border-radius: 12px; background: #1c1c2e; border: 1px solid #2e2e48; color: inherit; text-decoration: none; }
    .persona:hover { border-color: #8b5cf6; }
    .persona img { border-radius: 50%; }
    .persona span { display: grid; gap: 2px; }
    small { color: #9ca3af; }
</style>
</head>
<body>
<main>
    <h1>🧪 Dev-Login</h1>
    <p>Mock-Modus — wähle, als wer du dich anmelden willst.</p>
    ${personas}
</main>
</body>
</html>`;
}

/**
 * Read the maintenance settings the same way routes/auth.js does.
 *
 * @returns {Promise<Object|null>} -> Settings, null when none are stored.
 */
async function getMaintenanceSettings() {
    try {
        const snap = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        return snap.exists() ? snap.data() : null;
    } catch {
        return null;
    }
}

/**
 * Create or refresh the users document of a persona.
 *
 * @param {Object} persona -> Persona from dev/mockGuild.js.
 * @param {string} avatar -> Avatar URL to store.
 * @returns {Promise<boolean>} -> True when the profile was created just now.
 */
async function upsertUserProfile(persona, avatar) {
    const userRef = doc(db, 'users', persona.userId);
    const snap = await getDoc(userRef);
    const now = new Date().toISOString();
    const profile = {
        id: persona.userId,
        username: persona.username,
        displayName: persona.displayName,
        avatar,
        updatedAt: now
    };

    if (!snap.exists()) {
        await setDoc(userRef, { ...profile, acceptInvitations: true, createdAt: now });
        return true;
    }
    await setDoc(userRef, { ...snap.data(), ...profile });
    return false;
}

/**
 * GET /auth/discord — the existing login buttons land on the persona page
 */
router.get('/discord', (req, res) => {
    res.redirect('/auth/dev-login');
});

/**
 * GET /auth/dev-login — persona selection
 */
router.get('/dev-login', (req, res) => {
    res.type('html').send(renderPersonaPage());
});

/**
 * GET /auth/dev-login/:personaId — sign in as a persona
 */
router.get('/dev-login/:personaId', async (req, res) => {
    const persona = PERSONAS.find(p => p.id === req.params.personaId);
    if (!persona) {
        return res.status(404).type('text').send('Unbekannte Persona.');
    }

    try {
        const isAdmin = persona.roles.includes(process.env.DISCORD_ADMIN_ROLE_ID);

        // Same maintenance rules as the real OAuth2 callback
        const maintenance = await getMaintenanceSettings();
        if (maintenance && !isAdmin) {
            if (maintenance.panicMode) return res.redirect('/?error=panic_mode');
            if (maintenance.loginDisabled) return res.redirect('/?error=maintenance_login_disabled');
        }

        const avatar = defaultAvatar(persona.userId);
        const isNewUser = await upsertUserProfile(persona, avatar);

        req.session.user = {
            id: persona.userId,
            username: persona.username,
            displayName: persona.displayName,
            avatar,
            roles: [...persona.roles],
            isAdmin,
            isNewUser
        };

        console.log(`🧪 Dev-Login als ${persona.displayName}`);
        res.redirect('/#events');
    } catch (err) {
        console.error('Dev login error:', err);
        res.redirect('/?error=server_error');
    }
});

module.exports = router;
