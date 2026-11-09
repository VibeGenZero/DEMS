/**
 * Setup wizard of a fresh installation (#138): PIN → Discord → Server →
 * Sicherheit → Datenschutz → Fertig. finishLoading() asks /api/setup/status
 * first; while DEMS is not set up, this page replaces login and router.
 */
import { registerActions } from '../core/actions.js';
import { state } from '../core/state.js';
import { escapeHtml, renderMarkdownSafe, showElement, toggleElement } from '../core/ui.js';
import { GUIDE_FIELD_STEPS, guideStepLink, mountDiscordGuide, openGuideStep, resetDiscordGuide, updateGuideInviteUrl } from './discord-guide.js';

const STEPS = [['pin', 'PIN'], ['discord', 'Discord'], ['server', 'Server'], ['security', 'Sicherheit'], ['privacy', 'Datenschutz'], ['done', 'Fertig']];
const SNOWFLAKE = /^\d{17,20}$/;
const RESET_PASSWORD_MIN = 12;
const INVITE_DELAY_MS = 400;

const wizard = { status: null, step: 'pin', guild: null, server: {}, password: '', inviteTimer: null };

const isLocked = (key) => !!(wizard.status && wizard.status.locked.includes(key));
const valueOf = (key) => ((wizard.status && wizard.status.values) || {})[key] || '';
const inputValue = (id) => {
    const element = document.getElementById(id);
    return element ? String(element.value || '').trim() : '';
};

async function setupRequest(method, url, body) {
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let data = {};
        try { data = await res.json(); } catch { data = {}; }
        return { ok: res.ok, data };
    } catch {
        return { ok: false, data: { error: 'Keine Verbindung zum Server. Bitte versuche es erneut.' } };
    }
}

function showSetupError(message) {
    const box = document.getElementById('setup-error');
    if (!message) {
        toggleElement(box, false);
        return;
    }
    const step = (String(message).match(/Schritt (\d)/) || [])[1];
    box.innerHTML = `<i class="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>${escapeHtml(message)}${step && wizard.step === 'discord' ? ` ${guideStepLink(step)}` : ''}`;
    showElement(box);
    if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function renderStepList() {
    const current = STEPS.findIndex(([name]) => name === wizard.step);
    document.getElementById('setup-steps').innerHTML = STEPS.map(([, label], index) => {
        const cls = index < current ? 'is-done' : (index === current ? 'is-active' : '');
        const icon = index < current ? 'bi-check-circle-fill' : `bi-${index + 1}-circle`;
        return `<li class="setup-steps-item ${cls}"${index === current ? ' aria-current="step"' : ''}><i class="bi ${icon}" aria-hidden="true"></i><span>${escapeHtml(label)}</span></li>`;
    }).join('');
}

/**
 * One labelled input; a value from .env is read-only with the chip "aus .env".
 *
 * @param {Object} field -> `{ id, key, label, type, value, hint, guideStep, watchClientId, placeholder, secret }`.
 * @returns {string}
 */
function fieldHtml({ id, key, label, type = 'text', value = '', hint = '', guideStep = 0, watchClientId = false, placeholder = '', secret = false }) {
    const locked = key && isLocked(key);
    const shown = locked && secret ? '' : (locked ? valueOf(key) : value);
    const stored = !locked && secret && key && ((wizard.status && wizard.status.secretsSet) || {})[key];
    const lockedPlaceholder = locked && secret ? 'gesetzt (aus .env)' : (stored ? 'gespeichert – leer lassen zum Behalten' : placeholder);
    return `<div class="setup-field">
        <label class="form-label" for="${id}">${escapeHtml(label)}${locked ? ' <span class="chip chip-sm chip-info">aus .env</span>' : ''}</label>
        <input type="${type}" class="form-control" id="${id}" value="${escapeHtml(shown)}" placeholder="${escapeHtml(lockedPlaceholder)}"${locked ? ' readonly' : ''}${watchClientId && !locked ? ' data-input="setupClientIdChanged"' : ''} autocomplete="off" spellcheck="false">
        <div class="setup-hint">${escapeHtml(hint)}${guideStep ? ` ${guideStepLink(guideStep)}` : ''}</div>
    </div>`;
}

function selectHtml({ id, key, label, options, value, hint, emptyLabel }) {
    if (isLocked(key)) return fieldHtml({ id, key, label, hint });
    if (!options.length) return fieldHtml({ id, key, label, value, hint: `${hint} Discord hat keine Liste geliefert; trag die ID von Hand ein.` });
    const items = [`<option value="">${escapeHtml(emptyLabel)}</option>`, ...options.map(option =>
        `<option value="${escapeHtml(option.id)}"${option.id === value ? ' selected' : ''}>${escapeHtml(option.name)}</option>`)];
    return `<div class="setup-field">
        <label class="form-label" for="${id}">${escapeHtml(label)}</label>
        <select class="form-select" id="${id}">${items.join('')}</select>
        <div class="setup-hint">${escapeHtml(hint)}</div>
    </div>`;
}

function renderDiscordFields() {
    document.getElementById('setup-discord-fields').innerHTML = [
        fieldHtml({ id: 'setup-client-id', key: 'DISCORD_CLIENT_ID', label: 'Client ID', value: inputValue('setup-client-id') || valueOf('DISCORD_CLIENT_ID'), watchClientId: true, hint: 'Zahl unter „OAuth2“ > „Client ID“.', guideStep: GUIDE_FIELD_STEPS.clientId }),
        fieldHtml({ id: 'setup-client-secret', key: 'DISCORD_CLIENT_SECRET', label: 'Client Secret', type: 'password', secret: true, hint: 'Unter „OAuth2“ mit „Reset Secret“ erzeugen.', guideStep: GUIDE_FIELD_STEPS.clientSecret }),
        fieldHtml({ id: 'setup-bot-token', key: 'DISCORD_BOT_TOKEN', label: 'Bot-Token', type: 'password', secret: true, hint: 'Unter „Bot“ mit „Reset Token“ erzeugen.', guideStep: GUIDE_FIELD_STEPS.botToken }),
        fieldHtml({ id: 'setup-guild-id', key: 'DISCORD_GUILD_ID', label: 'Server-ID', value: inputValue('setup-guild-id') || valueOf('DISCORD_GUILD_ID'), hint: 'Rechtsklick auf deinen Server > „Server-ID kopieren“.', guideStep: GUIDE_FIELD_STEPS.guildId })
    ].join('');
}

function timezoneOptions(selected) {
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    const list = zones.includes(selected) ? zones : [selected, ...zones];
    return list.map(zone => ({ id: zone, name: zone }));
}

function renderServerFields() {
    const guild = wizard.guild || { roles: [], channels: [], categories: [], guildName: '' };
    const defaults = wizard.status.defaults || {};
    const zone = valueOf('TIMEZONE') || defaults.TIMEZONE || 'Europe/Berlin';
    const zoneField = isLocked('TIMEZONE')
        ? fieldHtml({ id: 'setup-timezone', key: 'TIMEZONE', label: 'Zeitzone', hint: 'Für Datum und Uhrzeit in Discord-Nachrichten.' })
        : selectHtml({ id: 'setup-timezone', key: 'TIMEZONE', label: 'Zeitzone', options: timezoneOptions(zone), value: wizard.server.timezone || zone, hint: 'Für Datum und Uhrzeit in Discord-Nachrichten.', emptyLabel: 'Europe/Berlin (Standard)' });
    document.getElementById('setup-server-intro').textContent = guild.guildName
        ? `Der Bot ist auf „${guild.guildName}“ angemeldet. Jetzt Adresse, Name und Rollen festlegen.`
        : 'Adresse, Name und Rollen für DEMS.';
    document.getElementById('setup-server-fields').innerHTML = [
        fieldHtml({ id: 'setup-base-url', key: 'BASE_URL', label: 'Adresse (BASE_URL)', value: wizard.server.baseUrl || valueOf('BASE_URL') || defaults.BASE_URL || '', hint: 'Unter dieser Adresse erreichen Mitglieder DEMS, mit https://. Änderst du sie, trag im Developer Portal die neue Redirect-URL <Adresse>/auth/discord/callback ein (Schritt 2).' }),
        fieldHtml({ id: 'setup-server-name', key: 'SERVER_NAME', label: 'Anzeigename (optional)', value: wizard.server.serverName || valueOf('SERVER_NAME'), placeholder: guild.guildName || '', hint: 'Leer lassen = Name des Discord-Servers.' }),
        zoneField,
        selectHtml({ id: 'setup-admin-role', key: 'DISCORD_ADMIN_ROLE_ID', label: 'Admin-Rolle', options: guild.roles.filter(role => !role.managed), value: wizard.server.adminRoleId || '', hint: 'Mitglieder mit dieser Rolle verwalten Events. Wer auf dem Server „Administrator“ ist, ist immer Admin.', emptyLabel: 'Keine (nur Discord-Administratoren)' }),
        selectHtml({ id: 'setup-announce-channel', key: 'DISCORD_ANNOUNCE_CHANNEL_ID', label: 'Ankündigungskanal', options: guild.channels.filter(channel => channel.type === 'text'), value: wizard.server.announceChannelId || '', hint: 'Hier kündigt der Bot Events an. Später auch in der Bot-Zentrale änderbar.', emptyLabel: 'Später in der Bot-Zentrale wählen' }),
        selectHtml({ id: 'setup-event-category', key: 'DISCORD_EVENT_CATEGORY_ID', label: 'Kategorie für Event-Kanäle', options: guild.categories, value: wizard.server.eventCategoryId || '', hint: 'In dieser Kategorie legt der Bot private Event-Kanäle an.', emptyLabel: 'Keine Kategorie' }),
        isLocked('DISCORD_THREAD_SYNC') ? '' : `<div class="form-check setup-field">
            <input class="form-check-input" type="checkbox" id="setup-thread-sync"${wizard.server.threadSync ? ' checked' : ''}>
            <label class="form-check-label" for="setup-thread-sync">Kommentare mit Discord-Threads spiegeln</label>
            <div class="setup-hint">Braucht den „Message Content Intent“ (Schritt 3 der Anleitung) und wirkt erst nach einem Neustart.</div>
        </div>`
    ].join('');
}

function renderSecurityFields() {
    document.getElementById('setup-security-fields').innerHTML = isLocked('ADMIN_RESET_PASSWORD')
        ? fieldHtml({ id: 'setup-reset-password', key: 'ADMIN_RESET_PASSWORD', label: 'Admin-Reset-Passwort', type: 'password', secret: true, hint: 'Steht in .env und bleibt dort.' })
        : [
            fieldHtml({ id: 'setup-reset-password', label: 'Admin-Reset-Passwort', type: 'password', hint: `Mindestens ${RESET_PASSWORD_MIN} Zeichen.` }),
            fieldHtml({ id: 'setup-reset-password-repeat', label: 'Passwort wiederholen', type: 'password' })
        ].join('');
}

/**
 * Show one step of the wizard.
 *
 * @param {string} step -> Name from STEPS.
 */
export function showSetupStep(step) {
    wizard.step = step;
    showSetupError('');
    for (const [name] of STEPS) toggleElement(document.getElementById(`setup-step-${name}`), name === step);
    renderStepList();
    if (step === 'discord') {
        renderDiscordFields();
        const defaults = wizard.status.defaults || {};
        mountDiscordGuide('setup-guide', { baseUrl: valueOf('BASE_URL') || defaults.BASE_URL || '', inviteUrl: '' });
        refreshInviteUrl(inputValue('setup-client-id') || valueOf('DISCORD_CLIENT_ID'));
    }
    if (step === 'server') renderServerFields();
    if (step === 'security') renderSecurityFields();
}

async function refreshInviteUrl(clientId) {
    if (!SNOWFLAKE.test(clientId)) {
        updateGuideInviteUrl('');
        return;
    }
    const { ok, data } = await setupRequest('GET', `/api/setup/invite-url?clientId=${encodeURIComponent(clientId)}`);
    updateGuideInviteUrl(ok ? data.url : '');
}

async function reloadStatus() {
    const { ok, data } = await setupRequest('GET', '/api/setup/status');
    if (ok) wizard.status = data;
    return ok;
}

/**
 * Start the wizard when DEMS is not set up yet.
 *
 * @returns {Promise<boolean>} -> True when the wizard took over the page.
 */
export async function checkSetupMode() {
    try {
        const res = await fetch('/api/setup/status');
        if (!res.ok) return false;
        const status = await res.json();
        if (!status || !status.required) return false;
        await startSetupWizard(status);
        return true;
    } catch {
        return false;
    }
}

async function startSetupWizard(status) {
    wizard.status = status;
    resetDiscordGuide();
    const navbar = document.getElementById('main-navbar');
    if (navbar) navbar.style.display = 'none';
    document.getElementById('setup-section').style.display = 'block';
    toggleElement(document.getElementById('setup-https-warning'), !!status.httpsRequired);
    if (!status.unlocked) return showSetupStep('pin');
    if (status.discordDone) {
        const { ok, data } = await setupRequest('GET', '/api/setup/guild');
        if (ok) wizard.guild = data;
        return showSetupStep('server');
    }
    showSetupStep('discord');
}

async function submitSetupPin() {
    const { ok, data } = await setupRequest('POST', '/api/setup/unlock', { pin: inputValue('setup-pin') });
    if (!ok) return showSetupError(data.error || 'Die PIN konnte nicht geprüft werden.');
    if (data.csrfToken) state.csrfToken = data.csrfToken;
    await reloadStatus();
    showSetupStep(wizard.status.discordDone ? 'server' : 'discord');
}

async function submitSetupDiscord() {
    const button = document.getElementById('setup-discord-submit');
    button.disabled = true;
    const { ok, data } = await setupRequest('POST', '/api/setup/discord', {
        clientId: inputValue('setup-client-id'),
        clientSecret: inputValue('setup-client-secret'),
        botToken: inputValue('setup-bot-token'),
        guildId: inputValue('setup-guild-id')
    });
    button.disabled = false;
    if (!ok) {
        if (data.inviteUrl) {
            updateGuideInviteUrl(data.inviteUrl);
            openGuideStep(4);
        }
        return showSetupError(data.error || 'Die Discord-Werte konnten nicht geprüft werden.');
    }
    wizard.guild = data;
    await reloadStatus();
    showSetupStep('server');
}

function submitSetupServer() {
    const baseUrl = inputValue('setup-base-url');
    if (!isLocked('BASE_URL') && !/^https?:\/\/\S+$/.test(baseUrl)) {
        return showSetupError('Bitte die vollständige Adresse mit http:// oder https:// eintragen.');
    }
    const thread = document.getElementById('setup-thread-sync');
    wizard.server = {
        baseUrl,
        serverName: inputValue('setup-server-name'),
        timezone: inputValue('setup-timezone'),
        adminRoleId: inputValue('setup-admin-role'),
        announceChannelId: inputValue('setup-announce-channel'),
        eventCategoryId: inputValue('setup-event-category'),
        threadSync: !!(thread && thread.checked)
    };
    showSetupStep('security');
}

function submitSetupSecurity() {
    if (!isLocked('ADMIN_RESET_PASSWORD')) {
        const password = inputValue('setup-reset-password');
        if (password.length < RESET_PASSWORD_MIN) return showSetupError(`Das Passwort braucht mindestens ${RESET_PASSWORD_MIN} Zeichen.`);
        if (password !== inputValue('setup-reset-password-repeat')) return showSetupError('Die beiden Passwörter stimmen nicht überein.');
        wizard.password = password;
    }
    showSetupStep('privacy');
}

// The server answers with the field that failed -> back to the step that has it
const ERROR_STEPS = [[/Discord-Schritt|Bot|Client|Server-ID/, 'discord'], [/BASE_URL|Zeitzone|ID für/, 'server'], [/Reset-Passwort/, 'security']];

async function completeSetup() {
    const button = document.getElementById('setup-complete-submit');
    button.disabled = true;
    const { ok, data } = await setupRequest('POST', '/api/setup/complete', {
        ...wizard.server,
        adminResetPassword: wizard.password,
        privacyMarkdown: inputValue('setup-privacy-text')
    });
    button.disabled = false;
    if (!ok) {
        const target = (ERROR_STEPS.find(([pattern]) => pattern.test(data.error || '')) || [])[1];
        if (target) showSetupStep(target);
        return showSetupError(data.error || 'Die Einrichtung konnte nicht abgeschlossen werden.');
    }
    wizard.password = '';
    showSetupStep('done');
    toggleElement(document.getElementById('setup-done-restart'), !!data.restartRequired);
}

function previewSetupPrivacy() {
    const text = inputValue('setup-privacy-text');
    document.getElementById('setup-privacy-preview').innerHTML = text
        ? renderMarkdownSafe(text)
        : '<p class="text-secondary">Ohne Text gibt es keine Datenschutzseite, und niemand muss etwas akzeptieren.</p>';
}

function setupClientIdChanged(element) {
    clearTimeout(wizard.inviteTimer);
    wizard.inviteTimer = setTimeout(() => refreshInviteUrl(String(element.value || '').trim()), INVITE_DELAY_MS);
}

registerActions({
    submitSetupPin,
    submitSetupDiscord,
    submitSetupServer,
    submitSetupSecurity,
    completeSetup,
    previewSetupPrivacy,
    setupClientIdChanged: (el) => setupClientIdChanged(el),
    setupBack: (el) => showSetupStep(el.dataset.setupStep)
});
