/**
 * Bot control center: status, running events, settings.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { applyStyleData, escapeHtml, showToast } from '../core/ui.js';
import { avatar } from '../core/components.js';
import { isRunning } from '../events/cards.js';


export async function showBotControlSection() {
    const section = document.getElementById('bot-control-section');
    section.style.display = 'block';

    await Promise.all([loadBotStatus(), loadBotRunningEvents(), loadBotSettings()]);

    // Auto-refresh bot status every 30 seconds
    if (state.botStatusRefreshInterval) clearInterval(state.botStatusRefreshInterval);
    state.botStatusRefreshInterval = setInterval(loadBotStatus, 30000);

    // Setup form handler
    const form = document.getElementById('bot-settings-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        await saveBotSettingsForm();
    };
}

export function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
}

export async function loadBotStatus() {
    const panel = document.getElementById('bot-status-panel');
    try {
        const res = await fetch('/api/admin/bot/status');
        const status = await res.json();

        const statusText = status.online ? 'Online' : 'Offline';

        panel.innerHTML = `
            <div class="bot-status-header">
                <div class="d-flex align-items-center gap-3">
                    ${avatar({ url: status.avatarUrl, name: status.username || 'Bot', size: 'lg' })}
                    <div>
                        <h4 class="mb-0">${escapeHtml(status.username || 'Bot')}</h4>
                        <div class="d-flex align-items-center gap-2 mt-1">
                            <span class="bot-status-dot ${status.online ? 'is-online' : 'is-offline'}"></span>
                            <span class="text-secondary">${statusText}</span>
                            ${status.ping > 0 ? `<span class="bot-ping-badge">${status.ping}ms</span>` : ''}
                        </div>
                    </div>
                </div>
                ${status.guildName ? `<div class="bot-guild-info"><i class="bi bi-discord me-1"></i>${escapeHtml(status.guildName)} <span class="text-muted">(${status.guildMemberCount} Mitglieder)</span></div>` : ''}
            </div>
            <div class="bot-stats-grid mt-3">
                <div class="bot-stat-item">
                    <div class="bot-stat-icon"><i class="bi bi-clock-history"></i></div>
                    <div>
                        <div class="bot-stat-value">${status.online ? formatUptime(status.uptime) : '--'}</div>
                        <div class="bot-stat-label">Uptime</div>
                    </div>
                </div>
                <div class="bot-stat-item">
                    <div class="bot-stat-icon"><i class="bi bi-envelope-check"></i></div>
                    <div>
                        <div class="bot-stat-value">${status.dmsSent}</div>
                        <div class="bot-stat-label">DMs gesendet</div>
                    </div>
                </div>
                <div class="bot-stat-item">
                    <div class="bot-stat-icon"><i class="bi bi-terminal"></i></div>
                    <div>
                        <div class="bot-stat-value">${status.commandsProcessed}</div>
                        <div class="bot-stat-label">Befehle verarbeitet</div>
                    </div>
                </div>
                <div class="bot-stat-item">
                    <div class="bot-stat-icon"><i class="bi bi-bell${status.reminderSchedulerActive ? '' : '-slash'}"></i></div>
                    <div>
                        <div class="bot-stat-value">${status.reminderSchedulerActive ? 'Aktiv' : 'Inaktiv'}</div>
                        <div class="bot-stat-label">Erinnerungen</div>
                    </div>
                </div>
                <div class="bot-stat-item">
                    <div class="bot-stat-icon"><i class="bi bi-arrow-repeat${status.presenceAutoUpdate ? '' : ''}"></i></div>
                    <div>
                        <div class="bot-stat-value">${status.presenceAutoUpdate ? 'Aktiv' : 'Aus'}</div>
                        <div class="bot-stat-label">Auto-Update</div>
                    </div>
                </div>
            </div>
        `;

        gsap.fromTo('.bot-stat-item',
            { y: 10, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.25, stagger: 0.05, ease: 'power3.out' }
        );
    } catch {
        panel.innerHTML = '<div class="text-danger text-center py-3">Bot-Status konnte nicht geladen werden.</div>';
    }
}

export async function loadBotRunningEvents() {
    const container = document.getElementById('bot-running-events');
    container.innerHTML = '<div class="col-12 text-center py-3"><span class="spinner-border spinner-border-sm"></span> Laden...</div>';

    try {
        const res = await fetch('/api/admin/bot/running-events');
        const events = await res.json();

        if (!events.length) {
            container.innerHTML = '<div class="col-12"><div class="glass-card p-4 text-center text-muted"><i class="bi bi-calendar-x me-2"></i>Keine laufenden Events</div></div>';
            return;
        }

        container.innerHTML = events.map(event => {
            const stats = event.registrationStats || {};
            const startDate = event.startDate ? new Date(event.startDate).toLocaleString('de-DE', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
            }) : 'TBD';

            // LIVE only between start and end; the server leaves ended events out (W-01)
            const now = new Date();
            const start = event.startDate ? new Date(event.startDate) : null;
            let liveIndicator = '<span class="upcoming-indicator"><i class="bi bi-flag me-1"></i>Beendet</span>';
            if (isRunning(event, now)) liveIndicator = '<span class="live-indicator"><span class="live-dot"></span>LIVE</span>';
            else if (!start || start > now) liveIndicator = '<span class="upcoming-indicator"><i class="bi bi-clock me-1"></i>Bevorstehend</span>';

            const capacityPercent = event.maxParticipants > 0
                ? Math.round((stats.accepted / event.maxParticipants) * 100)
                : 0;
            const capacityBar = event.maxParticipants > 0
                ? `<div class="capacity-bar-container mt-2">
                     <div class="capacity-bar" data-style-width="${capacityPercent}"></div>
                   </div>
                   <small class="text-muted">${stats.accepted}/${event.maxParticipants} Plätze belegt (${capacityPercent}%)</small>`
                : `<small class="text-muted">${stats.accepted} Teilnehmer (unbegrenzt)</small>`;

            return `
                <div class="col-md-6 col-lg-4">
                    <div class="glass-card running-event-card p-3">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="mb-0">${escapeHtml(event.title)}</h6>
                            ${liveIndicator}
                        </div>
                        <div class="text-muted small mb-2"><i class="bi bi-calendar3 me-1"></i>${startDate}</div>
                        ${event.category ? `<span class="event-category-tag small mb-2 d-inline-block">${escapeHtml(event.category)}</span>` : ''}
                        ${capacityBar}
                        <div class="running-event-stats mt-2">
                            <span class="re-stat re-stat-accepted" title="Angenommen"><i class="bi bi-check-circle"></i> ${stats.accepted}</span>
                            <span class="re-stat re-stat-pending" title="Ausstehend"><i class="bi bi-hourglass-split"></i> ${stats.pending}</span>
                            <span class="re-stat re-stat-waitlisted" title="Warteliste"><i class="bi bi-list-nested"></i> ${stats.waitlisted}</span>
                        </div>
                        <div class="mt-2">
                            <a href="#event/${event.id}" class="btn btn-sm btn-outline-light w-100">
                                <i class="bi bi-eye me-1"></i>Details
                            </a>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        applyStyleData(container);

        gsap.fromTo('.running-event-card',
            { y: 15, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.3, stagger: 0.06, ease: 'power3.out' }
        );
    } catch {
        container.innerHTML = '<div class="col-12"><div class="alert alert-danger">Fehler beim Laden der Events.</div></div>';
    }
}

/**
 * Options of the announcement channel dropdown: the .env default, the text
 * channels of the server, and a stored channel the bot cannot list (offline).
 *
 * @param {Array<Object>} channels -> `GET /api/admin/channels` (`{ id, name, type }`).
 * @param {string} selected -> Stored channel id or ''.
 * @returns {string} -> Option elements.
 */
export function announceChannelOptions(channels, selected) {
    const text = (Array.isArray(channels) ? channels : []).filter(channel => channel.type === 'text');
    const options = ['<option value="">Standard aus .env</option>']
        .concat(text.map(channel => `<option value="${escapeHtml(channel.id)}">#${escapeHtml(channel.name)}</option>`));
    if (selected && !text.some(channel => channel.id === selected)) {
        options.push(`<option value="${escapeHtml(selected)}">Gespeicherter Kanal (${escapeHtml(selected)})</option>`);
    }
    return options.join('');
}

async function loadChannelList() {
    try {
        const res = await fetch('/api/admin/channels');
        return res.ok ? await res.json() : [];
    } catch {
        return [];
    }
}

export async function loadBotSettings() {
    try {
        const [res, channels] = await Promise.all([fetch('/api/admin/bot/settings'), loadChannelList()]);
        const settings = await res.json();
        const select = document.getElementById('bot-announce-channel');
        select.innerHTML = announceChannelOptions(channels, settings.announceChannel || '');
        select.value = settings.announceChannel || '';

        document.getElementById('bot-status-type').value = settings.statusType || 'online';
        document.getElementById('bot-activity-type').value = settings.activityType || 'WATCHING';
        document.getElementById('bot-activity-text').value = settings.activityText || '';
        document.getElementById('bot-auto-update-presence').checked = !!settings.autoUpdatePresence;
        document.getElementById('bot-auto-status-calendar').checked = !!settings.autoStatusCalendarEvents;
        document.getElementById('bot-dm-notifications').checked = settings.dmNotifications !== false;
        document.getElementById('bot-reminder-enabled').checked = settings.reminderEnabled !== false;
        document.getElementById('bot-event-start-notifications').checked = settings.eventStartNotifications !== false;
        document.getElementById('bot-auto-channel-creation').checked = settings.autoChannelCreation !== false;
        document.getElementById('bot-welcome-message').value = settings.welcomeMessage || '';
    } catch {
        showToast('Bot-Einstellungen konnten nicht geladen werden.', 'danger');
    }
}

export async function saveBotSettingsForm() {
    const settings = {
        statusType: document.getElementById('bot-status-type').value,
        activityType: document.getElementById('bot-activity-type').value,
        activityText: document.getElementById('bot-activity-text').value,
        autoUpdatePresence: document.getElementById('bot-auto-update-presence').checked,
        autoStatusCalendarEvents: document.getElementById('bot-auto-status-calendar').checked,
        dmNotifications: document.getElementById('bot-dm-notifications').checked,
        reminderEnabled: document.getElementById('bot-reminder-enabled').checked,
        eventStartNotifications: document.getElementById('bot-event-start-notifications').checked,
        autoChannelCreation: document.getElementById('bot-auto-channel-creation').checked,
        welcomeMessage: document.getElementById('bot-welcome-message').value,
        announceChannel: document.getElementById('bot-announce-channel').value,
    };

    try {
        const res = await fetch('/api/admin/bot/settings', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            body: JSON.stringify(settings)
        });

        if (res.ok) {
            showToast('Bot-Einstellungen gespeichert!', 'success');
            await loadBotStatus();
        } else {
            const data = await res.json();
            showToast(data.error || 'Fehler beim Speichern.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler beim Speichern.', 'danger');
    }
}

registerActions({ loadBotSettings: () => loadBotSettings() });
