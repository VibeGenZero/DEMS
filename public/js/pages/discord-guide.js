/**
 * Step-by-step guide for creating the Discord application and bot (#138).
 * The setup wizard shows it in its Discord step, the admin "System" view in a
 * dialog. All texts live here; the labels of the Developer Portal are quoted
 * in English exactly as Discord shows them, so they are easy to find.
 * Done marks live in this module while the page is open, never in storage.
 */
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast } from '../core/ui.js';

const PORTAL_URL = 'https://discord.com/developers/applications';
const STEP_COUNT = 5;

/** Guide step of each input of the Discord step. */
export const GUIDE_FIELD_STEPS = Object.freeze({ clientId: 2, clientSecret: 2, botToken: 3, guildId: 5 });

const guide = { containerId: '', baseUrl: '', inviteUrl: '', done: new Set(), open: 1 };

const q = (label) => `<strong>„${escapeHtml(label)}“</strong>`;

function copyRow(value) {
    const safe = escapeHtml(value);
    return `<div class="setup-guide-copy">
        <code>${safe}</code>
        <button type="button" class="btn btn-secondary btn-sm" data-click="copyGuideValue" data-copy-value="${safe}">
            <i class="bi bi-clipboard me-1" aria-hidden="true"></i>Kopieren
        </button>
    </div>`;
}

function inviteBlock(inviteUrl) {
    if (!inviteUrl) {
        return `<p class="setup-guide-hint"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>Trag zuerst die Client ID ein (Schritt 2), dann erscheint hier der Einladungslink.</p>`;
    }
    return `<p><a href="${escapeHtml(inviteUrl)}" class="btn btn-discord setup-guide-invite" target="_blank" rel="noopener noreferrer">
        <i class="bi bi-box-arrow-up-right me-2" aria-hidden="true"></i>Einladungslink öffnen</a></p>`;
}

/** Title and body HTML of every step. */
function stepContents({ baseUrl, inviteUrl }) {
    const redirect = `${baseUrl}/auth/discord/callback`;
    return [
        {
            title: 'Anwendung anlegen',
            body: `<ol>
                <li>Öffne das <a href="${PORTAL_URL}" target="_blank" rel="noopener noreferrer">Discord Developer Portal <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a> und melde dich mit deinem Discord-Konto an.</li>
                <li>Klicke oben rechts auf ${q('New Application')}.</li>
                <li>Gib einen Namen ein, z. B. den Namen deines Servers. So heißt später auch der Bot.</li>
                <li>Bestätige die Bedingungen und klicke auf ${q('Create')}.</li>
            </ol>`
        },
        {
            title: 'OAuth2: Client ID, Client Secret und Redirect-URL',
            body: `<ol>
                <li>Öffne links im Menü ${q('OAuth2')}.</li>
                <li>Kopiere die ${q('Client ID')} und füge sie unten ins Feld <em>Client ID</em> ein.</li>
                <li>Klicke bei „Client Secret“ auf ${q('Reset Secret')}, bestätige und kopiere das Secret sofort ins Feld <em>Client Secret</em>. Discord zeigt es nur dieses eine Mal.</li>
                <li>Klicke unter „Redirects“ auf ${q('Add Redirect')} und füge genau diese Adresse ein:${copyRow(redirect)}</li>
                <li>Klicke unten auf ${q('Save Changes')}. Weicht die Adresse ab, schlägt später jeder Login fehl.</li>
            </ol>`
        },
        {
            title: 'Bot: Token und Intents',
            body: `<ol>
                <li>Öffne links im Menü „Bot“.</li>
                <li>Klicke auf ${q('Reset Token')}, bestätige und kopiere den Token ins Feld <em>Bot-Token</em>. Auch er ist nur einmal sichtbar. Gib ihn niemals weiter.</li>
                <li>Schalte unter ${q('Privileged Gateway Intents')} den ${q('Server Members Intent')} ein. Ohne ihn lehnt Discord die Anmeldung des Bots ab, denn DEMS liest Mitglieder und Rollen.</li>
                <li>Den ${q('Message Content Intent')} brauchst du nur, wenn du später den Kommentar-Sync mit Discord-Threads einschaltest.</li>
                <li>Schalte ${q('Public Bot')} aus (empfohlen), damit niemand sonst den Bot auf einen anderen Server holen kann.</li>
                <li>Klicke auf ${q('Save Changes')}.</li>
            </ol>`
        },
        {
            title: 'Bot auf deinen Server einladen',
            body: `${inviteBlock(inviteUrl)}
            <ol>
                <li>Wähle im Fenster von Discord deinen Server aus. Dafür brauchst du auf dem Server das Recht „Server verwalten“.</li>
                <li>Lass alle vorgeschlagenen Berechtigungen angehakt: Der Link enthält genau die Rechte, die DEMS braucht.</li>
                <li>Klicke auf „Autorisieren“. Der Bot erscheint danach offline in der Mitgliederliste, bis du unten auf <em>Prüfen</em> klickst.</li>
            </ol>`
        },
        {
            title: 'Server-ID kopieren',
            body: `<ol>
                <li>Öffne in Discord die Benutzereinstellungen (Zahnrad unten links) und dort „Erweitert“.</li>
                <li>Schalte den ${q('Entwicklermodus')} ein.</li>
                <li>Klicke mit der rechten Maustaste (am Handy: lange tippen) auf das Symbol deines Servers in der linken Leiste und wähle ${q('Server-ID kopieren')}.</li>
                <li>Füge die Zahl unten ins Feld <em>Server-ID</em> ein.</li>
            </ol>`
        }
    ];
}

/**
 * HTML of the guide.
 *
 * @param {Object} options -> `{ baseUrl, inviteUrl, done: Set<number>, open: number|null }`.
 * @returns {string}
 */
export function renderDiscordGuide({ baseUrl = '', inviteUrl = '', done = new Set(), open = null } = {}) {
    return stepContents({ baseUrl, inviteUrl }).map(({ title, body }, index) => {
        const step = index + 1;
        const isDone = done.has(step);
        const icon = isDone ? 'bi-check-circle-fill' : `bi-${step}-circle`;
        return `<details class="setup-guide-step${isDone ? ' is-done' : ''}" id="guide-step-${step}"${step === open ? ' open' : ''}>
            <summary class="setup-guide-summary">
                <i class="bi ${icon} setup-guide-icon" aria-hidden="true"></i>
                <span class="setup-guide-title">${escapeHtml(title)}</span>
                ${isDone ? '<span class="chip chip-sm chip-success">Erledigt</span>' : ''}
            </summary>
            <div class="setup-guide-body">
                ${body}
                <button type="button" class="btn btn-secondary btn-sm" data-click="markGuideStepDone" data-guide-step="${step}">
                    <i class="bi bi-check2 me-1" aria-hidden="true"></i>${isDone ? 'Erledigt' : 'Erledigt, weiter'}
                </button>
            </div>
        </details>`;
    }).join('');
}

/**
 * Link next to an input that opens its guide step.
 *
 * @param {number} step -> Guide step (GUIDE_FIELD_STEPS).
 * @returns {string} -> Button HTML.
 */
export function guideStepLink(step) {
    const number = Number(step) || 1;
    return `<button type="button" class="btn btn-link btn-sm setup-guide-link" data-click="openGuideStep" data-guide-step="${number}">Wo finde ich das? (Schritt ${number})</button>`;
}

function rerender() {
    const container = document.getElementById(guide.containerId);
    if (container) container.innerHTML = renderDiscordGuide(guide);
}

/**
 * Show the guide in a container and keep it up to date.
 *
 * @param {string} containerId -> Element that receives the guide.
 * @param {Object} options -> `{ baseUrl, inviteUrl }`.
 */
export function mountDiscordGuide(containerId, { baseUrl = '', inviteUrl = '' } = {}) {
    Object.assign(guide, { containerId, baseUrl: String(baseUrl).replace(/\/+$/, ''), inviteUrl });
    rerender();
}

/** New invite link (client id changed). */
export function updateGuideInviteUrl(inviteUrl) {
    guide.inviteUrl = inviteUrl || '';
    rerender();
}

/** Open one step and bring it into view (links next to the inputs, errors). */
export function openGuideStep(step) {
    guide.open = Number(step) || 1;
    rerender();
    const element = document.getElementById(`guide-step-${guide.open}`);
    if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** Forget the done marks (a new wizard or dialog). */
export function resetDiscordGuide() {
    guide.done = new Set();
    guide.open = 1;
}

async function copyGuideValue(value) {
    try {
        await navigator.clipboard.writeText(value);
        showToast('In die Zwischenablage kopiert.', 'success');
    } catch {
        showToast('Kopieren ging nicht – bitte die Adresse markieren und kopieren.', 'warning');
    }
}

registerActions({
    markGuideStepDone: (el) => {
        const step = Number(el.dataset.guideStep);
        guide.done.add(step);
        guide.open = step < STEP_COUNT ? step + 1 : null;
        rerender();
    },
    openGuideStep: (el) => openGuideStep(el.dataset.guideStep),
    copyGuideValue: (el) => copyGuideValue(el.dataset.copyValue)
});
