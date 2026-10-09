/**
 * Entry point: loads every module (registrations and the temporary window
 * bridge run on import) and starts the app.
 */
import './admin/bot-control.js';
import './admin/bot-messages.js';
import './admin/dashboard.js';
import './admin/discord-import.js';
import './admin/event-actions.js';
import './admin/maintenance.js';
import './admin/registrations.js';
import './admin/wizard-builders.js';
import './admin/wizard.js';
import './core/auth.js';
import './core/router.js';
import './core/ui.js';
import './events/checkin.js';
import './events/comments.js';
import './events/detail.js';
import './events/guests.js';
import './events/list.js';
import './events/registration-form.js';
import './events/slots.js';
import './pages/debug.js';
import './pages/profile.js';
import './polls/admin.js';
import './polls/polls.js';
import { initActions } from './core/actions.js';
import { createParticles, finishLoading, runBootAnimation } from './core/boot.js';
import { checkUpdates } from './core/updates.js';
import { showUserData } from './pages/info.js';

initActions(document);

document.addEventListener('DOMContentLoaded', () => {
    const lastBoot = localStorage.getItem('dems_boot_ts');
    const shouldSkip = lastBoot && (Date.now() - parseInt(lastBoot, 10)) < 86_400_000;

    if (shouldSkip) {
        document.getElementById('loading-screen').style.display = 'none';
        finishLoading();
    } else {
        createParticles();
        runBootAnimation();
    }
});

document.addEventListener('click', (e) => {
    const suggestionsEl = document.getElementById('location-suggestions');
    if (suggestionsEl && !e.target.closest('#event-location-text') && !e.target.closest('#location-suggestions')) {
        suggestionsEl.style.display = 'none';
    }
});

// Login state and routing belong to finishLoading() -> checkAuth(); a second
// /auth/me request here raced with it and swallowed the isNewUser flag
document.addEventListener('DOMContentLoaded', () => {
    checkUpdates();
});

// Attach event listener for data button
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('info-show-data-btn');
    if (btn) {
        btn.addEventListener('click', showUserData);
    }
});
