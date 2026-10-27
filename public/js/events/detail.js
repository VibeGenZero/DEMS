/**
 * Event page: banner, sidebar, participants, series dates.
 */
import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { registerActions } from '../core/actions.js';
import { applyStyleData, escapeHtml, isValidBannerUrl, renderMarkdownSafe, showElement, showToast, toggleElement } from '../core/ui.js';
import { avatar } from '../core/components.js';
import { renderCheckinSection } from './checkin.js';
import { loadComments } from './comments.js';
import { resetGuestSelection } from './guests.js';
import { renderFormFields, submitRegistration } from './registration-form.js';
import { eventHasSlots, renderOwnSlot, renderRoster, renderSlotPicker } from './slots.js';
import { eventEnd, isRegistrationClosed, isUnregisterClosed } from './cards.js';
import { startCountdown } from './countdown.js';
import { revealDetail } from './detail-motion.js';

export const GRADIENT_PRESETS = [
    'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)',
    'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
    'linear-gradient(135deg, #065f46 0%, #10b981 100%)',
    'linear-gradient(135deg, #92400e 0%, #f59e0b 100%)',
    'linear-gradient(135deg, #9d174d 0%, #ec4899 100%)'
];

export function getEventGradient(eventId) {
    const idx = (eventId || '').charCodeAt(0) % GRADIENT_PRESETS.length;
    return GRADIENT_PRESETS[isNaN(idx) ? 0 : idx];
}

export function renderDetailBanner(event) {
    const bannerArea = document.getElementById('detail-banner-area');
    if (!bannerArea) return;

    if (isValidBannerUrl(event.bannerUrl)) {
        bannerArea.style.background = '';
        bannerArea.innerHTML = `
            <img src="${escapeHtml(event.bannerUrl)}" class="event-detail-banner-img" alt="Banner">
            <div class="event-detail-banner-overlay"></div>`;
        bannerArea.querySelector('img').addEventListener('error', function () {
            this.style.display = 'none';
            bannerArea.style.background = event.accentColor
                ? `linear-gradient(135deg, ${escapeHtml(event.accentColor)}99 0%, ${escapeHtml(event.accentColor)} 100%)`
                : getEventGradient(event.id);
        });
    } else {
        bannerArea.innerHTML = '';
        bannerArea.style.background = event.accentColor
            ? `linear-gradient(135deg, ${escapeHtml(event.accentColor)}99 0%, ${escapeHtml(event.accentColor)} 100%)`
            : getEventGradient(event.id);
    }
}

export function setSidebarRow(rowId, icon, label, value, isHtml = false) {
    const el = document.getElementById(rowId);
    if (!el) return;
    el.style.display = 'flex';
    el.innerHTML = `
        <i class="bi ${icon} sidebar-icon"></i>
        <div>
            <div class="sidebar-label">${escapeHtml(label)}</div>
            <div class="sidebar-value">${isHtml ? value : escapeHtml(String(value))}</div>
        </div>`;
}

export function renderSidebarDetails(event) {
    const guildId = window._demsGuildId || '';

    if (event.startDate) {
        const safeStart = event.startDate.replace(' ', 'T');
        const d = new Date(safeStart);
        const dateStr = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
        setSidebarRow('sidebar-date-row', 'bi-calendar3', 'Datum', dateStr);
        setSidebarRow('sidebar-time-row', 'bi-clock', 'Uhrzeit', timeStr);

        if (event.endDate) {
            const safeEnd = event.endDate.replace(' ', 'T');
            const end = new Date(safeEnd);
            const diffMs = end - d;
            if (diffMs > 0) {
                const hours = Math.floor(diffMs / 3600000);
                const mins = Math.floor((diffMs % 3600000) / 60000);
                const durationStr = hours > 0
                    ? `${hours}h${mins > 0 ? ` ${mins}min` : ''}`
                    : `${mins}min`;
                setSidebarRow('sidebar-duration-row', 'bi-hourglass', 'Dauer', durationStr);
            }
        }
    }

    renderDeadlineRow('sidebar-registration-deadline-row', 'bi-alarm', 'Anmeldung bis', event.registrationDeadline);
    renderDeadlineRow('sidebar-unregister-deadline-row', 'bi-door-closed', 'Abmeldung bis', event.unregisterDeadline);

    if (event.location && event.location.text) {
        const locHtml = event.location.channelId && guildId
            ? `<a href="discord://channels/${guildId}/${escapeHtml(event.location.channelId)}">${escapeHtml(event.location.text)}</a>`
            : escapeHtml(event.location.text);
        setSidebarRow('sidebar-location-row', 'bi-geo-alt', 'Ort', locHtml, true);
    }

    renderThreadRow(event);

    if (event.createdByName) {
        setSidebarRow('sidebar-creator-row', 'bi-person', 'Erstellt von', event.createdByName);
    }

    renderSidebarCapacity(event);
}

// Discord ids are snowflakes: digits only
const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Sidebar row with the event's discussion thread in Discord (B-14); hidden
 * without a thread, so the row of a previous event does not stay.
 *
 * @param {Object} event -> Event with optional `discordThread: { guildId, threadId }`.
 * @returns {void}
 */
function renderThreadRow(event) {
    const thread = event.discordThread;
    if (!thread || !SNOWFLAKE.test(String(thread.guildId)) || !SNOWFLAKE.test(String(thread.threadId))) {
        const row = document.getElementById('sidebar-thread-row');
        if (row) row.style.display = 'none';
        return;
    }
    const url = `https://discord.com/channels/${thread.guildId}/${thread.threadId}`;
    setSidebarRow('sidebar-thread-row', 'bi-chat-dots', 'Diskussion',
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Im Discord-Thread mitreden</a>`, true);
}

/**
 * Sidebar row of an optional deadline (W-03); hidden without one, so the row of a previous event does not stay.
 *
 * @param {string} rowId -> Id of the row.
 * @param {string} icon -> Bootstrap icon class.
 * @param {string} label -> German label.
 * @param {string} value -> ISO date or ''.
 * @returns {void}
 */
function renderDeadlineRow(rowId, icon, label, value) {
    const date = value ? new Date(String(value).replace(' ', 'T')) : null;
    if (!date || Number.isNaN(date.getTime())) {
        const row = document.getElementById(rowId);
        if (row) row.style.display = 'none';
        return;
    }
    const text = date.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
    setSidebarRow(rowId, icon, label, text);
}

// Disabled status button of the action area per state
const STATUS_ACTIONS = {
    registered: { html: '<i class="bi bi-check-circle me-2"></i>Angemeldet', cls: 'btn-outline-success' },
    noaccess: { html: '<i class="bi bi-lock me-2"></i>Kein Zugang', cls: 'btn-outline-danger' }
};

/**
 * Show the one action of the event page (D-05). #register-btn and #waitlist-btn
 * submit their form through the form attribute; on phones the action area is
 * a bar at the bottom while one of them shows (.has-action-bar).
 *
 * @param {'register'|'waitlist'|'registered'|'noaccess'|'none'} mode -> State of the page.
 * @returns {void}
 */
export function renderSidebarAction(mode) {
    for (const [id, visible] of [['register-btn', mode === 'register'], ['waitlist-btn', mode === 'waitlist']]) {
        const button = document.getElementById(id);
        if (button) toggleElement(button, visible);
    }
    const statusButton = document.getElementById('sidebar-status-btn');
    if (statusButton) {
        const status = STATUS_ACTIONS[mode];
        statusButton.className = `btn w-100 ${status ? status.cls : ''}`.trim();
        statusButton.innerHTML = status ? status.html : '';
        toggleElement(statusButton, Boolean(status));
    }
    document.getElementById('event-detail-section')?.classList.toggle('has-action-bar', mode === 'register' || mode === 'waitlist');
}

/**
 * Whether the registration needs the "Anmeldung" card: form fields, a role
 * picker or guests to add. Without any, the action button alone registers.
 *
 * @param {Object} event -> Event of the page.
 * @returns {boolean}
 */
export function hasRegistrationInputs(event) {
    return (Array.isArray(event.formFields) && event.formFields.length > 0) || eventHasSlots(event) || event.allowGuests !== false;
}

export function renderSidebarCapacity(event) {
    const panel = document.getElementById('sidebar-capacity-panel');
    const content = document.getElementById('sidebar-capacity-content');
    if (!panel || !content) return;

    panel.style.display = 'block';
    // The sentence comes from the API (utils/capacity.js), the same one cards and Discord show
    const places = event.places || {};
    const taken = Math.max(0, Number(places.taken ?? event.currentParticipants) || 0);
    const max = event.maxParticipants > 0 ? event.maxParticipants : 0;
    const sentence = escapeHtml(typeof places.text === 'string' ? places.text : '');
    const free = max - taken;
    const freeText = max === 0 ? 'Unbegrenzt' : (free > 0 ? `${free} ${free === 1 ? 'Platz' : 'Plätze'} frei` : 'Ausgebucht');
    const sublabel = escapeHtml([freeText, places.waitlistText].filter(Boolean).join(' · '));
    const bar = max > 0
        ? `<div class="capacity${free <= 0 ? ' is-full' : ''}"><progress class="capacity-meter" max="${max}" value="${Math.min(taken, max)}" aria-label="${sentence}"></progress></div>`
        : '';
    content.innerHTML = `
        <div class="capacity-label">${sentence}</div>
        ${bar}
        <div class="capacity-sublabel">${sublabel}</div>`;
}

export async function loadDetailParticipants(eventId) {
    if (!state.currentUser) return;
    try {
        const res = await fetch(`/api/events/${eventId}/participants`);
        if (!res.ok) return;
        const data = await res.json();
        if (state.detailEventId !== eventId) return;
        const section = document.getElementById('detail-participants-section');
        const avatarsEl = document.getElementById('detail-participants-avatars');
        if (!section || !avatarsEl) return;

        section.style.display = 'block';
        const rosterEl = document.getElementById('detail-roster');
        const titleEl = document.getElementById('detail-participants-title');
        if (Array.isArray(data.slots)) {
            if (titleEl) titleEl.textContent = 'AUFSTELLUNG';
            avatarsEl.style.display = 'none';
            rosterEl.style.display = 'block';
            rosterEl.innerHTML = renderRoster(data);
            applyStyleData(rosterEl);
            return;
        }
        if (titleEl) titleEl.textContent = 'TEILNEHMER';
        showElement(avatarsEl);
        if (rosterEl) {
            rosterEl.style.display = 'none';
            rosterEl.innerHTML = '';
        }

        if (!data.participants.length) {
            avatarsEl.innerHTML = '<span class="text-muted small">Noch keine bestätigten Teilnehmer.</span>';
            return;
        }

        const overflow = data.total > 20 ? data.total - 20 : 0;
        avatarsEl.innerHTML = data.participants.map(p => avatar({ url: p.avatar, name: p.displayName })).join('')
            + (overflow > 0 ? `<span class="avatar avatar-more">+${overflow}</span>` : '');
    } catch { /* non-fatal */ }
}

// Clears what the previously opened event left on the page; the early returns
// below (no access, not logged in) never reach the code that refills it
export function resetEventDetailAreas() {
    ['detail-register-area', 'detail-registered', 'detail-no-access', 'detail-waitlist', 'detail-ended', 'detail-registration-closed',
        'detail-participants-section', 'comments-section', 'checkin-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    ['detail-participants-avatars', 'detail-roster', 'detail-reg-slot',
        'comments-section', 'checkin-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    renderSidebarAction('none');
}

/**
 * Show an event page.
 *
 * @param {string} eventId -> Event id.
 * @param {Object} [options] -> `{ celebrate, fromTaken }`: after a registration or a check-in the page updates in place with the success moment (detail-motion.js).
 * @returns {Promise<void>}
 */
export async function showEventDetail(eventId, { celebrate, fromTaken } = {}) {
    if (!eventId) return navigateTo('events');

    // Reset guest selection for fresh start
    resetGuestSelection();
    resetEventDetailAreas();
    state.detailEventId = eventId;

    const section = document.getElementById('event-detail-section');
    section.style.display = 'block';

    try {
        const res = await fetch(`/api/events/${eventId}`);
        if (!res.ok) throw new Error('Not found');
        const event = await res.json();
        if (state.detailEventId !== eventId) return;

        // Banner
        renderDetailBanner(event);

        // Category & Status tags
        const catTag = document.getElementById('detail-category-tag');
        catTag.innerHTML = event.category ? `<span class="event-category-tag">${escapeHtml(event.category)}</span>` : '';

        const statusTag = document.getElementById('detail-status-tag');
        const statusMap = { active: 'Aktiv', draft: 'Entwurf', archived: 'Archiviert' };
        if (event.status && event.status !== 'active') {
            statusTag.innerHTML = `<span class="event-status-badge event-status-${event.status}">${statusMap[event.status] || event.status}</span>`;
        } else {
            statusTag.innerHTML = '';
        }

        document.getElementById('detail-title').textContent = event.title;
        // Render Markdown description safely
        const descriptionEl = document.getElementById('detail-description');
        descriptionEl.innerHTML = renderMarkdownSafe(event.description || '');
        descriptionEl.classList.add('markdown-body');

        // Countdown
        const cdArea = document.getElementById('detail-countdown-area');
        const isOver = !!eventEnd(event) && eventEnd(event) < new Date();
        cdArea.style.display = event.startDate && !isOver ? 'flex' : 'none';
        if (event.startDate && !isOver) startCountdown(cdArea, event.startDate);

        // Sidebar details
        renderSidebarDetails(event);

        // Render series dates section if this event belongs to a series
        const seriesContainer = document.getElementById('detail-series-section');
        if (event.seriesId) {
            try {
                const seriesRes = await fetch(`/api/events/series/${event.seriesId}`);
                const seriesEvents = await seriesRes.json();
                if (state.detailEventId !== eventId) return;
                if (Array.isArray(seriesEvents) && seriesEvents.length > 1) {
                    const maxVisible = 5;
                    const visibleSeries = seriesEvents.slice(0, maxVisible);
                    const hiddenSeries = seriesEvents.slice(maxVisible);
                    const hiddenCount = hiddenSeries.length;

                    const renderSeriesItem = (se) => {
                        const isCurrent = se.id === eventId;
                        const safeD = se.startDate ? se.startDate.replace(' ', 'T') : null;
                        const dateStr = safeD ? new Date(safeD).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                        return `
                            <a class="series-date-item ${isCurrent ? 'active' : ''}" href="#" data-click="navigateTo" data-route="event/${escapeHtml(se.id)}">
                                <span><i class="bi bi-calendar-event me-2"></i>${dateStr}</span>
                                <span class="series-date-participants"><i class="bi bi-people me-1"></i>${se.currentParticipants || 0}${se.maxParticipants > 0 ? '/' + se.maxParticipants : ''}</span>
                            </a>`;
                    };

                    seriesContainer.innerHTML = `
                        <div class="series-detail-section mt-4">
                            <h6 class="mb-3"><i class="bi bi-arrow-repeat me-2"></i>Termine der Serie</h6>
                            <div class="series-dates-list">
                                ${visibleSeries.map(renderSeriesItem).join('')}
                                ${hiddenCount > 0 ? `
                                    <div id="detail-series-hidden" class="is-hidden">
                                        ${hiddenSeries.map(renderSeriesItem).join('')}
                                    </div>
                                    <a class="series-dates-toggle" href="#" data-click="toggleDetailSeriesDates">
                                        <i class="bi bi-chevron-down me-1" id="detail-series-icon"></i>
                                        <span id="detail-series-toggle-text">${hiddenCount} weitere Termine anzeigen</span>
                                    </a>` : ''}
                            </div>
                        </div>`;
                } else {
                    seriesContainer.innerHTML = '';
                }
            } catch {
                seriesContainer.innerHTML = '';
            }
        } else {
            seriesContainer.innerHTML = '';
        }

        // Check areas
        const registerArea = document.getElementById('detail-register-area');
        const registeredArea = document.getElementById('detail-registered');
        const noAccessArea = document.getElementById('detail-no-access');
        const waitlistArea = document.getElementById('detail-waitlist');

        if (!state.currentUser) {
            renderSidebarAction('none');
            revealDetail();
            return;
        }

        // Check existing registration
        const regRes = await fetch(`/api/events/${eventId}/my-registration`);
        const regData = await regRes.json();
        if (state.detailEventId !== eventId) return;

        if (regData.registered) {
            registeredArea.style.display = 'block';
            const statusEl = document.getElementById('detail-reg-status');
            const statusTexts = { pending: 'Ausstehend', accepted: 'Angenommen', rejected: 'Abgelehnt', waitlisted: 'Warteliste' };
            const statusColors = { pending: 'warning', accepted: 'success', rejected: 'danger', waitlisted: 'info' };
            const place = regData.status === 'waitlisted' && regData.waitlistPosition;
            statusEl.textContent = regData.asGuest
                ? 'Angenommen (Gast)'
                : place
                    // Own place on the waitlist (W-05)
                    ? `Platz ${place.position} von ${place.total} auf der Warteliste`
                    : (statusTexts[regData.status] || regData.status);
            statusEl.className = 'fw-bold text-' + (statusColors[regData.status] || 'secondary');
            renderOwnSlot(event, regData);
            // After the unregister deadline only an admin takes the registration back (W-03)
            const unregisterClosed = isUnregisterClosed(event);
            toggleElement(document.getElementById('unregister-btn'), !unregisterClosed);
            toggleElement(document.getElementById('detail-unregister-closed'), unregisterClosed);

            renderSidebarAction('registered');
            // The check-in box exists after this call: the success moment of a check-in springs it
            renderCheckinSection(eventId, event, regData);
            revealDetail(celebrate, { fromTaken });
            loadDetailParticipants(eventId);
            loadComments(eventId);
            return;
        }

        // Over: the form is closed, the scheduler archives the event a day later (W-01)
        if (isOver) {
            document.getElementById('detail-ended').style.display = 'block';
            renderSidebarAction('none');
            loadDetailParticipants(eventId);
            loadComments(eventId);
            return;
        }

        // Registration deadline passed: the form is closed, the event still comes (W-03)
        if (isRegistrationClosed(event)) {
            document.getElementById('detail-registration-closed').style.display = 'block';
            renderSidebarAction('none');
            loadDetailParticipants(eventId);
            loadComments(eventId);
            return;
        }

        // Check role requirement
        if (event.accessMode === 'role-required' && event.requiredRoles && event.requiredRoles.length > 0) {
            // Safety check: ensure currentUser.roles is an array
            const userRoles = Array.isArray(state.currentUser.roles) ? state.currentUser.roles : [];
            const hasRole = event.requiredRoles.some(r => userRoles.includes(r));
            if (!hasRole) {
                noAccessArea.style.display = 'block';
                document.getElementById('no-access-text').textContent = 'Du hast nicht die erforderliche Rolle für dieses Event.';
                renderSidebarAction('noaccess');
                revealDetail();
                return;
            }
        }

        // Check capacity — show waitlist if full
        // Slot events always show the form -> the server picks slot, fallback or waitlist
        const isFull = !eventHasSlots(event) && event.maxParticipants > 0 && event.currentParticipants >= event.maxParticipants;

        if (isFull) {
            waitlistArea.style.display = 'block';
            const waitCountEl = document.getElementById('detail-waitlist-count');
            waitCountEl.textContent = event.waitlistCount > 0 ? `(${event.waitlistCount} auf der Warteliste)` : '';

            renderFormFields(event.formFields || [], 'waitlist-form-fields');

            const waitForm = document.getElementById('waitlist-form');

            // Reset button state
            const waitBtn = document.getElementById('waitlist-btn');
            if (waitBtn) {
                waitBtn.disabled = false;
                waitBtn.innerHTML = '<i class="bi bi-list-nested me-2"></i>Auf Warteliste setzen';
            }

            waitForm.onsubmit = async (e) => {
                e.preventDefault();
                await submitRegistration(eventId, event, 'waitlist-btn', 'waitlist-form-fields');
            };
            renderSidebarAction('waitlist');
        } else {
            // Show registration form
            // Without fields, roles or guests the action button alone registers (D-05)
            registerArea.style.display = hasRegistrationInputs(event) ? 'block' : 'none';
            renderFormFields(event.formFields || []);
            renderSlotPicker(event);

            const guestArea = document.getElementById('guest-tickets-area');
            if (guestArea) {
                guestArea.style.display = event.allowGuests === false || eventHasSlots(event) ? 'none' : 'block';
            }

            const form = document.getElementById('registration-form');

            // Reset button state ensures we don't show "Wird gesendet..." from a previous cancelled attempt
            const regBtn = document.getElementById('register-btn');
            if (regBtn) {
                regBtn.disabled = false;
                regBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Teilnehmen';
            }

            form.onsubmit = async (e) => {
                e.preventDefault();
                await submitRegistration(eventId, event, 'register-btn', 'dynamic-form-fields');
            };
            renderSidebarAction('register');
        }

        revealDetail();

        // Load comments section
        loadDetailParticipants(eventId);
        loadComments(eventId);

    } catch {
        if (state.detailEventId !== eventId) return;
        showToast('Event nicht gefunden.', 'danger');
        navigateTo('events');
    }
}

export function toggleDetailSeriesDates() {
    const hidden = document.getElementById('detail-series-hidden');
    const icon = document.getElementById('detail-series-icon');
    const text = document.getElementById('detail-series-toggle-text');
    if (!hidden) return;
    const isOpen = !hidden.classList.contains('is-hidden');
    hidden.classList.toggle('is-hidden', isOpen);
    icon.className = isOpen ? 'bi bi-chevron-down me-1' : 'bi bi-chevron-up me-1';
    const count = hidden.querySelectorAll('.series-date-item').length;
    text.textContent = isOpen ? `${count} weitere Termine anzeigen` : 'Weniger anzeigen';
}

registerActions({ toggleDetailSeriesDates: () => toggleDetailSeriesDates() });
