/**
 * Shared UI helpers: escaping, Markdown, toasts, error banner, confirm dialog,
 * skeletons.
 */
import { state } from './state.js';


export function getErrorMessage(code) {
    const messages = {
        'not_member': `Du bist kein Mitglied des ${state.serverName} Discord-Servers.`,
        'no_code': 'Authentifizierung fehlgeschlagen. Kein Code erhalten.',
        'token_failed': 'Token-Austausch fehlgeschlagen. Bitte versuche es erneut.',
        'invalid_state': 'Die Anmeldung ist abgelaufen oder wurde nicht in diesem Browser gestartet. Bitte melde dich erneut an.',
        'server_error': 'Ein Serverfehler ist aufgetreten. Bitte versuche es später erneut.',
        'maintenance_login_disabled': 'Der Login ist wegen Wartungsarbeiten vorübergehend deaktiviert. Nur Admins können sich anmelden.',
        'panic_mode': 'Das System befindet sich im Notfall-Lockdown. Der Login ist gesperrt.'
    };
    return messages[code] || 'Ein unbekannter Fehler ist aufgetreten.';
}

export function showConfirmDialog(message, confirmLabel = 'Bestätigen') {
    return new Promise(resolve => {
        const modalEl = document.getElementById('confirmModal');
        const confirmBtn = document.getElementById('confirm-modal-ok');
        document.getElementById('confirm-modal-text').textContent = message;
        confirmBtn.textContent = confirmLabel;
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        let confirmed = false;
        confirmBtn.onclick = () => { confirmed = true; modal.hide(); };
        modalEl.addEventListener('hidden.bs.modal', () => resolve(confirmed), { once: true });
        modal.show();
    });
}

export function showError(message) {
    const banner = document.getElementById('error-banner');
    document.getElementById('error-message').textContent = message;
    banner.style.display = 'block';
    setTimeout(() => {
        gsap.to(banner, { opacity: 0, duration: 0.5, onComplete: () => banner.style.display = 'none' });
    }, 8000);
}

export function showToast(message, type = 'info') {
    const toastEl = document.getElementById('app-toast');
    const msgEl = document.getElementById('toast-message');

    // Remove old classes
    toastEl.className = 'toast align-items-center border-0';
    toastEl.classList.add(`text-bg-${type}`);

    msgEl.textContent = message;
    const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
    toast.show();

    // GSAP Animation
    gsap.fromTo(toastEl,
        { x: 50, opacity: 0, scale: 0.9 },
        { x: 0, opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.5)" }
    );
}

export function renderSkeletonEvents(container, count, isAdmin = false) {
    container.innerHTML = Array(count).fill(0).map(() => `
        <div class="col-md-6">
            <div class="glass-card skeleton-card p-0">
                <div class="skeleton skeleton-img"></div>
                <div class="p-4" style="height:200px; display:flex; flex-direction:column; justify-content:space-between;">
                    <div>
                        <div class="skeleton skeleton-title mb-3"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text" style="width:80%"></div>
                    </div>
                    <div class="d-flex gap-2 mt-3">
                        <div class="skeleton" style="width:60px; height:24px; border-radius:99px;"></div>
                        <div class="skeleton" style="width:60px; height:24px; border-radius:99px;"></div>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

export function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Render Markdown string to safe HTML using marked + DOMPurify
 */
export function renderMarkdownSafe(mdString) {
    if (typeof mdString !== 'string' || !mdString.trim()) return '';
    try {
        const rawHtml = marked.parse(mdString);
        return DOMPurify.sanitize(rawHtml);
    } catch (e) {
        console.warn('Markdown parse error:', e);
        return escapeHtml(mdString).replace(/\n/g, '<br>');
    }
}

/**
 * One line of plain text from Markdown for card previews, cut on a word.
 * Returns raw text: escape it (escapeHtml) after cutting, never before,
 * so an entity like &amp; is never cut in half.
 */
export function markdownPreview(mdString, maxLength = 120) {
    const text = String(mdString ?? '')
        .replace(/```[\s\S]*?```/g, ' ')                          // code blocks
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')                 // images -> alt text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                  // links -> link text
        .replace(/^ {0,3}(?:#{1,6}|>|[-*+]|\d+[.)]) +/gm, '')     // headings, quotes, list markers
        .replace(/^ {0,3}(?:[-*_] *){3,}$/gm, ' ')                // horizontal rules
        .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')       // bold, strikethrough
        .replace(/(?<![\w*])([*_])(?=\S)([\s\S]*?\S)\1(?![\w*])/g, '$2') // italics, not snake_case or 5 * 3
        .replace(/`([^`]*)`/g, '$1')                              // inline code
        .replace(/\s+/g, ' ')
        .trim();
    if (text.length <= maxLength) return text;
    const cut = text.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Validate a banner URL (must be a valid http/https URL)
 */
export function isValidBannerUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}
