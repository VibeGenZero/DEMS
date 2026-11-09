/**
 * Privacy policy of this installation (#138): the public page #privacy, the
 * "Datenschutz" links on the login and info pages, and the consent dialog a
 * member must answer while the current version is not accepted.
 */
import { registerActions } from '../core/actions.js';
import { logout, showLoginPopups } from '../core/auth.js';
import { emptyState } from '../core/components.js';
import { handleRoute } from '../core/router.js';
import { state } from '../core/state.js';
import { renderMarkdownSafe, showToast, toggleElement } from '../core/ui.js';

const consent = { open: false, version: 0, waiters: [] };

const formatDay = (iso) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

async function fetchPolicy() {
    try {
        const res = await fetch('/api/privacy');
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

function consentDialog() {
    return bootstrap.Modal.getOrCreateInstance(document.getElementById('privacyConsentModal'));
}

/**
 * Show the "Datenschutz" links of the login and info pages while a policy exists.
 *
 * @returns {Promise<void>}
 */
export async function loadPrivacyLinks() {
    const policy = await fetchPolicy();
    for (const id of ['login-privacy-link', 'info-privacy-link']) toggleElement(document.getElementById(id), !!policy);
}

/**
 * Public page #privacy.
 *
 * @returns {Promise<void>}
 */
export async function showPrivacySection() {
    document.getElementById('privacy-section').style.display = 'block';
    const content = document.getElementById('privacy-content');
    const policy = await fetchPolicy();
    if (!policy) {
        document.getElementById('privacy-updated').textContent = '';
        content.innerHTML = emptyState({ icon: 'file-earmark-lock', title: 'Keine Datenschutzerklärung', text: 'Diese Installation hat noch keine Datenschutzerklärung veröffentlicht.' });
        return;
    }
    document.getElementById('privacy-updated').textContent = `Stand: ${formatDay(policy.updatedAt)} · Fassung ${policy.version}`;
    content.innerHTML = renderMarkdownSafe(policy.markdown);
}

function finishConsent() {
    consent.open = false;
    const waiters = consent.waiters.splice(0);
    waiters.forEach(resolve => resolve());
}

async function loadConsentDialog() {
    const policy = await fetchPolicy();
    if (!policy) {
        // The policy was removed meanwhile: nothing to accept
        if (state.currentUser) state.currentUser.privacyRequired = false;
        consentDialog().hide();
        finishConsent();
        return;
    }
    consent.version = policy.version;
    document.getElementById('privacy-consent-text').innerHTML = renderMarkdownSafe(policy.markdown);
    document.getElementById('privacy-consent-version').textContent = `Fassung ${policy.version} vom ${formatDay(policy.updatedAt)}.`;
    consentDialog().show();
}

/**
 * Show the consent dialog and wait until the member accepted. Declining logs out.
 *
 * @returns {Promise<void>} -> Resolves once the current version is accepted.
 */
export function requirePrivacyConsent() {
    const accepted = new Promise(resolve => consent.waiters.push(resolve));
    if (!consent.open) {
        consent.open = true;
        loadConsentDialog();
    }
    return accepted;
}

async function acceptPrivacy() {
    const button = document.getElementById('privacy-accept-btn');
    button.disabled = true;
    try {
        const res = await fetch('/api/user/privacy/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ version: consent.version })
        });
        const data = await res.json();
        if (res.status === 409) {
            // A newer version was published while the dialog was open
            showToast(data.error, 'warning');
            await loadConsentDialog();
            return;
        }
        if (!res.ok) return showToast(data.error || 'Die Zustimmung konnte nicht gespeichert werden.', 'danger');
        if (state.currentUser) state.currentUser.privacyRequired = false;
        consentDialog().hide();
        finishConsent();
    } catch {
        showToast('Die Zustimmung konnte nicht gespeichert werden.', 'danger');
    } finally {
        button.disabled = false;
    }
}

/**
 * Reopen the dialog when any API answer says the policy must be accepted
 * (a new version published during the visit). Called once at start.
 */
export function watchPrivacyAnswers() {
    const original = window.fetch;
    window.fetch = async (...args) => {
        const res = await original(...args);
        if (res.status === 403 && state.currentUser && !consent.open) {
            try {
                const data = await (typeof res.clone === 'function' ? res.clone() : res).json();
                if (data && data.privacyRequired) {
                    state.currentUser.privacyRequired = true;
                    requirePrivacyConsent().then(() => handleRoute());
                }
            } catch {
                // not JSON: nothing to do
            }
        }
        return res;
    };
}

/**
 * After the login: the consent first, then the popups the login would show.
 *
 * @returns {Promise<void>}
 */
export async function settlePrivacyConsent() {
    if (!state.currentUser || !state.currentUser.privacyRequired) return;
    await requirePrivacyConsent();
    showLoginPopups(state.currentUser.isNewUser);
}

registerActions({
    acceptPrivacy,
    declinePrivacy: () => logout()
});
