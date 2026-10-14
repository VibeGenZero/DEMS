/**
 * Event page: banner, sidebar, participants, series dates.
 */
import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { registerActions } from '../core/actions.js';
import { applyStyleData, escapeHtml, isValidBannerUrl, renderMarkdownSafe, showElement, showToast } from '../core/ui.js';
import { avatar } from '../core/components.js';
import { renderCheckinSection } from './checkin.js';
import { loadComments } from './comments.js';
import { resetGuestSelection } from './guests.js';
import { renderFormFields, submitRegistration } from './registration-form.js';
import { eventHasSlots, renderOwnSlot, renderRoster, renderSlotPicker } from './slots.js';

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

export function formatCountdown(targetDate) {
    const now = new Date();
    const target = new Date(targetDate);
    const diff = target - now;

    if (diff <= 0) return null;

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    return { days, hours, mins, secs };
}

export function renderCountdownHTML(cd) {
    if (!cd) return '<span class="countdown-expired"><i class="bi bi-clock-history me-1"></i>Event hat bereits begonnen</span>';
    return `
    <div class="countdown-item"><span class="countdown-value">${cd.days}</span><span class="countdown-label">Tage</span></div>
    <div class="countdown-item"><span class="countdown-value">${String(cd.hours).padStart(2, '0')}</span><span class="countdown-label">Std</span></div>
    <div class="countdown-item"><span class="countdown-value">${String(cd.mins).padStart(2, '0')}</span><span class="countdown-label">Min</span></div>
    <div class="countdown-item"><span class="countdown-value">${String(cd.secs).padStart(2, '0')}</span><span class="countdown-label">Sek</span></div>
  `;
}

export function startCountdown(element, targetDate) {
    let timer; // Declare first to avoid TDZ
    const update = () => {
        const cd = formatCountdown(targetDate);
        element.innerHTML = renderCountdownHTML(cd);
        if (!cd) {
            if (timer) clearInterval(timer);
            element.classList.remove('countdown-live');
            return false;
        }
        return true;
    };

    // Run once immediately
    if (update()) {
        timer = setInterval(update, 1000);
        state.countdownTimers.push(timer);
        return timer;
    }
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

    if (event.location && event.location.text) {
        const locHtml = event.location.channelId && guildId
            ? `<a href="discord://channels/${guildId}/${escapeHtml(event.location.channelId)}">${escapeHtml(event.location.text)}</a>`
            : escapeHtml(event.location.text);
        setSidebarRow('sidebar-location-row', 'bi-geo-alt', 'Ort', locHtml, true);
    }

    if (event.createdByName) {
        setSidebarRow('sidebar-creator-row', 'bi-person', 'Erstellt von', event.createdByName);
    }

    renderSidebarCapacity(event);
}

export function renderSidebarAction(mode, event = null) {
    const area = document.getElementById('sidebar-action-area');
    if (!area) return;

    // Slot events need the role picker in the form -> the sidebar scrolls there instead of submitting
    const hasFormFields = event && ((Array.isArray(event.formFields) && event.formFields.length > 0) || eventHasSlots(event));

    if (mode === 'register' || mode === 'waitlist') {
        const isWaitlist = mode === 'waitlist';
        const label = isWaitlist
            ? '<i class="bi bi-list-nested me-2"></i>Auf Warteliste setzen'
            : '<i class="bi bi-pencil-square me-2"></i>Jetzt anmelden';
        const cls = isWaitlist ? 'btn-outline-secondary w-100' : 'btn-accent w-100';

        if (hasFormFields) {
            // Scroll to form so required fields can be filled
            area.innerHTML = `<button class="btn ${cls} mt-2" data-click="scrollTo" data-target="detail-register-area">${label}</button>`;
        } else {
            // No custom fields — submit directly from sidebar
            const btnId = 'sidebar-register-btn';
            const formContainer = isWaitlist ? 'waitlist-form-fields' : 'dynamic-form-fields';
            area.innerHTML = `<button id="${btnId}" class="btn ${cls} mt-2">${label}</button>`;
            document.getElementById(btnId).addEventListener('click', () => {
                submitRegistration(event.id, event, btnId, formContainer);
            });
        }
        return;
    }

    const configs = {
        registered: { label: '<i class="bi bi-check-circle me-2"></i>Angemeldet', cls: 'btn-outline-success w-100', disabled: true },
        noaccess:   { label: '<i class="bi bi-lock me-2"></i>Kein Zugang',         cls: 'btn-outline-danger w-100',  disabled: true },
        none:       { label: '',                                                    cls: '',                          disabled: true }
    };
    const cfg = configs[mode] || configs.none;
    if (!cfg.label) { area.innerHTML = ''; return; }
    area.innerHTML = `<button class="btn ${cfg.cls} mt-2" disabled>${cfg.label}</button>`;
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
    ['detail-register-area', 'detail-registered', 'detail-no-access', 'detail-waitlist',
        'detail-participants-section', 'comments-section', 'checkin-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    ['detail-participants-avatars', 'detail-roster', 'detail-reg-slot',
        'comments-section', 'checkin-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
}

export async function showEventDetail(eventId) {
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
        if (event.startDate) {
            cdArea.style.display = 'flex';
            startCountdown(cdArea, event.startDate);
        } else {
            cdArea.style.display = 'none';
        }

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
            gsap.from('.col-lg-8', { y: 20, opacity: 0, duration: 0.4, ease: 'power3.out' });
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
            statusEl.textContent = regData.asGuest
                ? 'Angenommen (Gast)'
                : (statusTexts[regData.status] || regData.status);
            statusEl.className = 'fw-bold text-' + (statusColors[regData.status] || 'secondary');
            renderOwnSlot(event, regData);

            renderSidebarAction('registered');
            gsap.from('.col-lg-8', { y: 20, opacity: 0, duration: 0.4, ease: 'power3.out' });
            loadDetailParticipants(eventId);
            loadComments(eventId);
            renderCheckinSection(eventId, event, regData);
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
                gsap.from('.col-lg-8', { y: 20, opacity: 0, duration: 0.4, ease: 'power3.out' });
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
            renderSidebarAction('waitlist', event);
        } else {
            // Show registration form
            registerArea.style.display = 'block';
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
            renderSidebarAction('register', event);
        }

        gsap.from('.col-lg-8', { y: 20, opacity: 0, duration: 0.4, ease: 'power3.out' });

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
