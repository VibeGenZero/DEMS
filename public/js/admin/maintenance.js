/**
 * Maintenance mode and panic mode.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { showToast } from '../core/ui.js';


// ═══════════════════════════════════════════════════════════
// MAINTENANCE MODE (Wartungsmodus)
// ═══════════════════════════════════════════════════════════

export async function checkMaintenanceStatus() {
    try {
        const res = await fetch('/api/maintenance/status');
        const data = await res.json();

        const banner = document.getElementById('maintenance-banner');
        const bannerText = document.getElementById('maintenance-banner-text');
        const plannedBanner = document.getElementById('planned-maintenance-banner');
        const plannedText = document.getElementById('planned-maintenance-banner-text');
        const lockdown = document.getElementById('panic-lockdown-overlay');

        // Panic mode lockdown for non-admin users
        if (data.panicMode && (!state.currentUser || !state.currentUser.isAdmin)) {
            lockdown.style.display = 'flex';
            const lockdownMsg = document.getElementById('panic-lockdown-message');
            if (data.warningText) lockdownMsg.textContent = data.warningText;
            return;
        } else {
            lockdown.style.display = 'none';
        }

        // Warning banner
        if (data.warningEnabled && data.warningText) {
            banner.style.display = 'block';
            bannerText.textContent = data.warningText;
        } else {
            banner.style.display = 'none';
        }

        // Planned maintenance banner
        if (data.plannedMaintenance && data.plannedMaintenanceText) {
            plannedBanner.style.display = 'block';
            let text = data.plannedMaintenanceText;
            if (data.plannedMaintenanceStart || data.plannedMaintenanceEnd) {
                const start = data.plannedMaintenanceStart ? new Date(data.plannedMaintenanceStart).toLocaleString('de-DE') : '';
                const end = data.plannedMaintenanceEnd ? new Date(data.plannedMaintenanceEnd).toLocaleString('de-DE') : '';
                if (start && end) text += ` (${start} — ${end})`;
                else if (start) text += ` (ab ${start})`;
                else if (end) text += ` (bis ${end})`;
            }
            plannedText.textContent = text;
            // Stack below warning banner if both visible
            plannedBanner.style.top = (data.warningEnabled && data.warningText) ? '96px' : '56px';
        } else {
            plannedBanner.style.display = 'none';
        }
    } catch {
        // Silently fail
    }
}

export async function showMaintenanceModal() {
    try {
        const res = await fetch('/api/admin/maintenance');
        const data = await res.json();

        document.getElementById('maint-warning-enabled').checked = data.warningEnabled;
        document.getElementById('maint-warning-text').value = data.warningText || '';
        document.getElementById('maint-login-disabled').checked = data.loginDisabled;
        document.getElementById('maint-registration-disabled').checked = data.registrationDisabled;
        document.getElementById('maint-planned').checked = data.plannedMaintenance;
        document.getElementById('maint-planned-start').value = data.plannedMaintenanceStart ? data.plannedMaintenanceStart.slice(0, 16) : '';
        document.getElementById('maint-planned-end').value = data.plannedMaintenanceEnd ? data.plannedMaintenanceEnd.slice(0, 16) : '';
        document.getElementById('maint-planned-text').value = data.plannedMaintenanceText || '';

        // Show/hide panic mode info
        const panicInfo = document.getElementById('maintenance-panic-active');
        if (data.panicMode) {
            panicInfo.classList.remove('d-none');
            document.getElementById('panic-activated-at').textContent =
                data.panicActivatedAt ? new Date(data.panicActivatedAt).toLocaleString('de-DE') : 'Unbekannt';
            document.getElementById('panic-activated-by').textContent = data.panicActivatedBy || 'Unbekannt';
            document.getElementById('panic-deactivate-password').value = '';
        } else {
            panicInfo.classList.add('d-none');
        }

        const modal = new bootstrap.Modal(document.getElementById('maintenanceModal'));
        modal.show();
    } catch {
        showToast('Fehler beim Laden der Wartungseinstellungen.', 'danger');
    }
}

export async function saveMaintenanceSettings() {
    const settings = {
        warningEnabled: document.getElementById('maint-warning-enabled').checked,
        warningText: document.getElementById('maint-warning-text').value,
        loginDisabled: document.getElementById('maint-login-disabled').checked,
        registrationDisabled: document.getElementById('maint-registration-disabled').checked,
        plannedMaintenance: document.getElementById('maint-planned').checked,
        plannedMaintenanceStart: document.getElementById('maint-planned-start').value || '',
        plannedMaintenanceEnd: document.getElementById('maint-planned-end').value || '',
        plannedMaintenanceText: document.getElementById('maint-planned-text').value
    };

    try {
        const res = await fetch('/api/admin/maintenance', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify(settings)
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Wartungseinstellungen gespeichert.', 'success');
            bootstrap.Modal.getInstance(document.getElementById('maintenanceModal'))?.hide();
            checkMaintenanceStatus();
        } else {
            showToast(data.error || 'Fehler beim Speichern.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export async function activatePanicMode() {
    if (!confirm('⚠️ ACHTUNG: Panic Mode aktiviert einen KOMPLETTEN LOCKDOWN!\n\nAlle Logins und Registrierungen werden sofort gesperrt.\nNur mit dem Admin-Reset-Passwort kann der Lockdown aufgehoben werden.\n\nBist du sicher?')) return;
    if (!confirm('🚨 LETZTE WARNUNG: Dies sperrt das gesamte System sofort!\n\nWirklich fortfahren?')) return;

    try {
        const res = await fetch('/api/admin/maintenance/panic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken }
        });
        const data = await res.json();

        if (res.ok) {
            showToast('🚨 PANIC MODE AKTIVIERT — System ist gesperrt.', 'danger');
            checkMaintenanceStatus();
        } else {
            showToast(data.error || 'Fehler.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export async function deactivatePanicMode() {
    const password = document.getElementById('panic-deactivate-password').value;
    if (!password) {
        showToast('Bitte Admin-Reset-Passwort eingeben.', 'warning');
        return;
    }

    try {
        const res = await fetch('/api/admin/maintenance/panic/deactivate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Panic Mode deaktiviert. System ist wieder normal.', 'success');
            bootstrap.Modal.getInstance(document.getElementById('maintenanceModal'))?.hide();
            checkMaintenanceStatus();
        } else {
            showToast(data.error || 'Falsches Passwort.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

registerActions({
    showMaintenanceModal: () => showMaintenanceModal(),
    saveMaintenanceSettings: () => saveMaintenanceSettings(),
    activatePanicMode: () => activatePanicMode(),
    deactivatePanicMode: () => deactivatePanicMode()
});
