/* ═══════════════════════════════════════════════ */
/*  DEMS — Main Application Logic                 */
/*  Boot Animation · SPA Router · Auth · Events    */
/* ═══════════════════════════════════════════════ */

let currentUser = null;
let cachedRoles = [];
let countdownTimers = [];
let activeCategory = '';
let csrfToken = '';
let descriptionEditor = null;
let startDatePicker = null;
let endDatePicker = null;
let searchDebounceTimer = null;
let currentView = 'grid';
let cachedEvents = [];
let serverName = 'DEMS'; // Default, will be loaded from API

// ─── Boot Animation ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    createParticles();
    runBootAnimation();
});

function createParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    for (let i = 0; i < 40; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.top = Math.random() * 100 + '%';
        container.appendChild(p);
    }
}

function runBootAnimation() {
    const tl = gsap.timeline({
        onComplete: () => {
            finishLoading();
        }
    });

    tl.to('.particle', {
        opacity: () => Math.random() * 0.6 + 0.2,
        duration: 0.5,
        stagger: { each: 0.02, from: 'random' }
    });

    tl.to('.loading-letter', {
        opacity: 1,
        y: 0,
        duration: 0.15,
        stagger: 0.06,
        ease: 'power3.out'
    }, '-=0.2');

    document.querySelectorAll('.loading-letter').forEach((letter, i) => {
        tl.to(letter, {
            keyframes: [
                { x: -2, duration: 0.04 },
                { x: 3, duration: 0.04 },
                { x: -1, duration: 0.04 },
                { x: 0, duration: 0.04 }
            ]
        }, 0.6 + i * 0.05);
    });

    tl.to('.loading-author', {
        opacity: 1,
        duration: 0.6,
        ease: 'power2.out'
    }, '-=0.3');

    tl.to('.loading-bar-container', {
        opacity: 1,
        duration: 0.3
    }, '-=0.4');

    tl.to('.loading-status', {
        opacity: 1,
        duration: 0.3
    }, '-=0.2');

    const statusEl = document.querySelector('.loading-status');
    const statusMessages = [
        'Initialisiere System...',
        'Verbinde mit Discord...',
        'Lade Module...',
        'Prüfe Authentifizierung...',
        'System bereit.'
    ];

    tl.to('.loading-bar', {
        width: '25%', duration: 0.4, ease: 'power1.inOut',
        onStart: () => { statusEl.textContent = statusMessages[1]; }
    });
    tl.to('.loading-bar', {
        width: '55%', duration: 0.3, ease: 'power1.inOut',
        onStart: () => { statusEl.textContent = statusMessages[2]; }
    });
    tl.to('.loading-bar', {
        width: '80%', duration: 0.3, ease: 'power1.inOut',
        onStart: () => { statusEl.textContent = statusMessages[3]; }
    });
    tl.to('.loading-bar', {
        width: '100%', duration: 0.4, ease: 'power2.out',
        onStart: () => { statusEl.textContent = statusMessages[4]; }
    });

    tl.to('.loading-content', {
        scale: 1.02, duration: 0.2, ease: 'power2.in'
    });

    tl.to('#loading-screen', {
        opacity: 0, duration: 0.5, ease: 'power2.inOut'
    });
}


async function fetchCSRFToken() {
    try {
        const res = await fetch('/api/csrf-token');
        const data = await res.json();
        csrfToken = data.token;
    } catch (e) {
        console.error('Failed to fetch CSRF token', e);
    }
}

async function loadServerInfo() {
    try {
        const res = await fetch('/api/server-info');
        const data = await res.json();
        serverName = data.serverName || 'DEMS';
        updateServerNameInUI();
    } catch (e) {
        console.error('Failed to fetch server info', e);
        serverName = 'DEMS';
    }
}

function updateServerNameInUI() {
    // Update navbar brand
    document.querySelectorAll('.navbar-brand').forEach(el => {
        el.innerHTML = `<i class="bi bi-moon-stars-fill me-2"></i>${serverName}`;
    });

    // Update page title
    document.title = `DEMS — ${serverName} Event Management`;

    // Update meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
        metaDesc.setAttribute('content', `Discord Event Management System für den ${serverName} Server`);
    }

    // Update login card heading (if visible)
    const loginCardHeading = document.querySelector('.login-card .brand-text');
    if (loginCardHeading) {
        loginCardHeading.textContent = serverName;
    }

    // Update events section description
    const eventsDesc = document.querySelector('#events-section .section-header p');
    if (eventsDesc) {
        eventsDesc.textContent = `Entdecke Events vom ${serverName} Server und registriere dich!`;
    }
}

async function finishLoading() {
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.style.display = 'none';
    document.getElementById('app').style.display = 'block';

    await fetchCSRFToken();
    await loadServerInfo();

    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
        showError(getErrorMessage(params.get('error')));
        window.history.replaceState({}, '', '/');
    }

    await checkAuth();
    handleRoute();
    window.addEventListener('hashchange', handleRoute);

    gsap.from('#main-navbar', {
        y: -60, opacity: 0, duration: 0.5, ease: 'power3.out'
    });
}

function getErrorMessage(code) {
    const messages = {
        'not_member': `Du bist kein Mitglied des ${serverName} Discord-Servers.`,
        'no_code': 'Authentifizierung fehlgeschlagen. Kein Code erhalten.',
        'token_failed': 'Token-Austausch fehlgeschlagen. Bitte versuche es erneut.',
        'server_error': 'Ein Serverfehler ist aufgetreten. Bitte versuche es später erneut.'
    };
    return messages[code] || 'Ein unbekannter Fehler ist aufgetreten.';
}

// ─── Auth ────────────────────────────────────────
async function checkAuth() {
    try {
        const res = await fetch('/auth/me');
        if (res.ok) {
            const data = await res.json();
            // Stricter check: must have at least an ID
            if (data && data.id) {
                currentUser = data;
                showLoggedIn();
            } else {
                currentUser = null;
                showLoggedOut();
            }
        } else {
            currentUser = null;
            showLoggedOut();
        }
    } catch {
        currentUser = null;
        showLoggedOut();
    }
}

function showLoggedIn() {
    document.getElementById('login-btn-container').style.display = 'none';
    const userInfo = document.getElementById('user-info');
    userInfo.style.display = 'flex';

    const avatarEl = document.getElementById('user-avatar');
    if (currentUser.avatar) {
        avatarEl.src = currentUser.avatar;
        avatarEl.style.display = 'block'; // Ensure it's visible if we have a src

        // Add error handler if not already present (to hide broken images)
        if (!avatarEl.onerror) {
            avatarEl.onerror = function () {
                this.style.display = 'none';
            };
        }
    } else {
        avatarEl.style.display = 'none';
    }

    document.getElementById('user-name').textContent = currentUser.displayName;
    document.getElementById('nav-profile').style.display = 'block';

    if (currentUser.isAdmin) {
        document.getElementById('nav-admin').style.display = 'block';
    }
}

function showLoggedOut() {
    document.getElementById('login-btn-container').style.display = 'block';
    document.getElementById('user-info').style.display = 'none';
    document.getElementById('nav-admin').style.display = 'none';
    document.getElementById('nav-profile').style.display = 'none';

    // Clear sensitive data from UI
    document.getElementById('user-avatar').src = '';
    document.getElementById('user-name').textContent = '';
}

function showUserData() {
    if (!currentUser) {
        showToast('Bitte melde dich zuerst an.', 'warning');
        return;
    }

    const content = document.getElementById('user-data-content');
    // Format JSON with 2-space indentation
    content.textContent = JSON.stringify(currentUser, null, 2);

    const modal = new bootstrap.Modal(document.getElementById('userDataModal'));
    modal.show();
}

// ─── SPA Router ──────────────────────────────────
function handleRoute() {
    // Clear countdown timers
    countdownTimers.forEach(t => clearInterval(t));
    countdownTimers = [];

    const hash = window.location.hash.replace('#', '') || 'events';
    const parts = hash.split('/');
    const route = parts[0];
    const param = parts[1];

    document.querySelectorAll('.app-section').forEach(s => s.style.display = 'none');

    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-section') === route + '-section') {
            link.classList.add('active');
        }
    });

    if (!currentUser && route !== 'login' && route !== 'info') {
        document.getElementById('login-section').style.display = 'block';
        return;
    }

    switch (route) {
        case 'events':
            showEventsSection();
            break;
        case 'event':
            showEventDetail(param);
            break;
        case 'profile':
            showProfileSection();
            break;
        case 'admin':
            if (currentUser && currentUser.isAdmin) {
                showAdminSection();
            } else {
                navigateTo('events');
            }
            break;
        case 'info':
            showInfoSection();
            break;
        default:
            showEventsSection();
    }
}

function navigateTo(route) {
    window.location.hash = '#' + route;
}

// ─── Countdown ───────────────────────────────────
function formatCountdown(targetDate) {
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

function renderCountdownHTML(cd) {
    if (!cd) return '<span class="countdown-expired"><i class="bi bi-clock-history me-1"></i>Event hat bereits begonnen</span>';
    return `
    <div class="countdown-item"><span class="countdown-value">${cd.days}</span><span class="countdown-label">Tage</span></div>
    <div class="countdown-item"><span class="countdown-value">${String(cd.hours).padStart(2, '0')}</span><span class="countdown-label">Std</span></div>
    <div class="countdown-item"><span class="countdown-value">${String(cd.mins).padStart(2, '0')}</span><span class="countdown-label">Min</span></div>
    <div class="countdown-item"><span class="countdown-value">${String(cd.secs).padStart(2, '0')}</span><span class="countdown-label">Sek</span></div>
  `;
}

function startCountdown(element, targetDate) {
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
        countdownTimers.push(timer);
        return timer;
    }
}

// ─── Events Section ──────────────────────────────
async function showEventsSection() {
    const section = document.getElementById('events-section');
    section.style.display = 'block';

    // Load categories
    await loadCategories();

    const grid = document.getElementById('events-grid');
    const empty = document.getElementById('events-empty');

    // Skeleton Loading
    renderSkeletonEvents(grid, 6);
    empty.style.display = 'none';

    try {
        let url = '/api/events';
        const params = [];
        if (activeCategory) params.push(`category=${encodeURIComponent(activeCategory)}`);
        const searchTerm = document.getElementById('events-search')?.value?.trim();
        if (searchTerm) params.push(`search=${encodeURIComponent(searchTerm)}`);
        if (params.length) url += '?' + params.join('&');

        const res = await fetch(url);
        const result = await res.json();
        const events = result.data || result;

        if (!Array.isArray(events)) {
            console.error('API response is not an array:', events);
            throw new Error('Ungültige API-Antwort');
        }

        cachedEvents = events;

        if (!events.length) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            document.getElementById('events-calendar').style.display = 'none';
            return;
        }

        empty.style.display = 'none';
        grid.innerHTML = events.map(event => {
            const bannerHtml = isValidBannerUrl(event.bannerUrl)
                ? `<img src="${escapeHtml(event.bannerUrl)}" class="event-banner" alt="Banner">`
                : '';

            const categoryHtml = event.category
                ? `<span class="event-category-tag">${escapeHtml(event.category)}</span>`
                : '';

            // Sanitize date (replace space with T for ISO compatibility)
            const safeDate = event.startDate ? event.startDate.replace(' ', 'T') : null;
            let dateHtml = '';
            try {
                dateHtml = safeDate
                    ? `<div class="event-date-info"><i class="bi bi-calendar3"></i>${new Date(safeDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>`
                    : '';
            } catch (e) {
                console.warn('Date parse error:', e);
            }

            const countdownId = `cd-${event.id}`;

            return `
        <div class="col-md-6 col-lg-4">
          <div class="glass-card event-card" onclick="navigateTo('event/${event.id}')">
            ${bannerHtml}
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <h5 class="mb-0">${escapeHtml(event.title)}</h5>
                ${categoryHtml}
              </div>
              <p>${escapeHtml(event.description || '').substring(0, 120)}${(event.description || '').length > 120 ? '...' : ''}</p>
              ${dateHtml}
              ${safeDate ? `<div class="countdown" id="${countdownId}" data-date="${safeDate}"></div>` : ''}
              <div class="d-flex flex-wrap gap-2 mt-3">
                <span class="badge-pill">
                  <i class="bi bi-${event.accessMode === 'open' ? 'unlock' : 'lock'}"></i>
                  ${event.accessMode === 'open' ? 'Offen' : 'Rolle nötig'}
                </span>
                <span class="badge-pill">
                  <i class="bi bi-${event.approvalMode === 'instant' ? 'lightning' : 'hourglass-split'}"></i>
                  ${event.approvalMode === 'instant' ? 'Instant' : 'Manuell'}
                </span>
                ${event.maxParticipants > 0 ? `
                  <span class="badge-pill">
                    <i class="bi bi-people"></i>Max ${event.maxParticipants}
                  </span>
                ` : ''}
                ${getParticipantWarningBadge(event)}
              </div>
            </div>
          </div>
        </div>
      `;
        }).join('');

        // Handle image error fallbacks
        grid.querySelectorAll('.event-banner').forEach(img => {
            img.addEventListener('error', () => { img.style.display = 'none'; });
        });

        // Start countdowns
        events.forEach(event => {
            if (event.startDate) {
                const safeDate = event.startDate.replace(' ', 'T');
                const el = document.getElementById(`cd-${event.id}`);
                if (el) startCountdown(el, safeDate);
            }
        });

        gsap.fromTo('.event-card',
            { y: 30, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: 'power3.out' }
        );

    } catch (err) {
        console.error('Error rendering events:', err);
        grid.innerHTML = '<div class="col-12"><div class="alert alert-danger">Fehler beim Laden der Events. Check Console.</div></div>';
    }
}

// ─── Category Filter ────────────────────────────
async function loadCategories() {
    try {
        const res = await fetch('/api/events/categories');
        const categories = await res.json();

        const bar = document.getElementById('category-filter-bar');
        if (!categories.length) {
            bar.innerHTML = '';
            return;
        }

        bar.innerHTML = `
      <button class="category-pill ${!activeCategory ? 'active' : ''}" onclick="filterByCategory('')">
        <i class="bi bi-grid-3x3-gap"></i>Alle
      </button>
      ${categories.map(cat => `
        <button class="category-pill ${activeCategory === cat ? 'active' : ''}" onclick="filterByCategory('${escapeHtml(cat)}')">
          <i class="bi bi-tag"></i>${escapeHtml(cat)}
        </button>
      `).join('')}
    `;
    } catch {
        document.getElementById('category-filter-bar').innerHTML = '';
    }
}

function filterByCategory(cat) {
    activeCategory = cat;
    showEventsSection();
}

// ─── Event Detail ────────────────────────────────
async function showEventDetail(eventId) {
    if (!eventId) return navigateTo('events');

    const section = document.getElementById('event-detail-section');
    section.style.display = 'block';

    try {
        const res = await fetch(`/api/events/${eventId}`);
        if (!res.ok) throw new Error('Not found');
        const event = await res.json();

        // Banner
        const bannerArea = document.getElementById('detail-banner-area');
        if (isValidBannerUrl(event.bannerUrl)) {
            bannerArea.innerHTML = `<img src="${escapeHtml(event.bannerUrl)}" class="event-banner-detail" alt="Banner">`;
            bannerArea.querySelector('img').addEventListener('error', function () { this.style.display = 'none'; });
        } else {
            bannerArea.innerHTML = '';
        }

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

        // Badges
        document.getElementById('detail-access-badge').innerHTML = `
      <i class="bi bi-${event.accessMode === 'open' ? 'unlock' : 'lock'}"></i>
      ${event.accessMode === 'open' ? 'Jeder darf teilnehmen' : 'Rollen-Requirement'}
    `;
        document.getElementById('detail-approval-badge').innerHTML = `
      <i class="bi bi-${event.approvalMode === 'instant' ? 'lightning' : 'hourglass-split'}"></i>
      ${event.approvalMode === 'instant' ? 'Instant Access' : 'Manuelle Prüfung'}
    `;
        document.getElementById('detail-participants-badge').innerHTML = `
      <i class="bi bi-people"></i>
      ${event.currentParticipants || 0}${event.maxParticipants > 0 ? '/' + event.maxParticipants : ''} Teilnehmer
    `;

        // Date badge
        const dateBadge = document.getElementById('detail-date-badge');
        if (event.startDate) {
            dateBadge.style.display = 'inline-flex';
            const dateStr = new Date(event.startDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            dateBadge.innerHTML = `<i class="bi bi-calendar3"></i>${dateStr}`;
        } else {
            dateBadge.style.display = 'none';
        }

        // Check areas
        const registerArea = document.getElementById('detail-register-area');
        const registeredArea = document.getElementById('detail-registered');
        const noAccessArea = document.getElementById('detail-no-access');
        const waitlistArea = document.getElementById('detail-waitlist');
        registerArea.style.display = 'none';
        registeredArea.style.display = 'none';
        noAccessArea.style.display = 'none';
        waitlistArea.style.display = 'none';

        if (!currentUser) {
            gsap.from('#event-detail-card', { y: 20, opacity: 0, duration: 0.5, ease: 'power3.out' });
            return;
        }

        // Check existing registration
        const regRes = await fetch(`/api/events/${eventId}/my-registration`);
        const regData = await regRes.json();

        if (regData.registered) {
            registeredArea.style.display = 'block';
            const statusEl = document.getElementById('detail-reg-status');
            const statusTexts = { pending: 'Ausstehend', accepted: 'Angenommen', rejected: 'Abgelehnt', waitlisted: 'Warteliste' };
            const statusColors = { pending: 'warning', accepted: 'success', rejected: 'danger', waitlisted: 'info' };
            statusEl.textContent = statusTexts[regData.status] || regData.status;
            statusEl.className = 'fw-bold text-' + (statusColors[regData.status] || 'secondary');

            gsap.from('#event-detail-card', { y: 20, opacity: 0, duration: 0.5, ease: 'power3.out' });
            loadComments(eventId);
            renderCheckinSection(eventId, event, regData);
            return;
        }

        // Check role requirement
        if (event.accessMode === 'role-required' && event.requiredRoles && event.requiredRoles.length > 0) {
            // Safety check: ensure currentUser.roles is an array
            const userRoles = Array.isArray(currentUser.roles) ? currentUser.roles : [];
            const hasRole = event.requiredRoles.some(r => userRoles.includes(r));
            if (!hasRole) {
                noAccessArea.style.display = 'block';
                document.getElementById('no-access-text').textContent = 'Du hast nicht die erforderliche Rolle für dieses Event.';
                gsap.from('#event-detail-card', { y: 20, opacity: 0, duration: 0.5, ease: 'power3.out' });
                return;
            }
        }

        // Check capacity — show waitlist if full
        const isFull = event.maxParticipants > 0 && event.currentParticipants >= event.maxParticipants;

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
        } else {
            // Show registration form
            registerArea.style.display = 'block';
            renderFormFields(event.formFields || []);

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
        }

        gsap.from('#event-detail-card', { y: 20, opacity: 0, duration: 0.5, ease: 'power3.out' });

        // Load comments section
        loadComments(eventId);

    } catch {
        showToast('Event nicht gefunden.', 'danger');
        navigateTo('events');
    }
}

// ─── Check-in System ─────────────────────────────
async function renderCheckinSection(eventId, event, registration) {
    let container = document.getElementById('checkin-section');
    if (!container) {
        container = document.createElement('div');
        container.id = 'checkin-section';
        container.className = 'mt-4 glass-card p-4';
        container.style.background = 'rgba(139,92,246,0.05)';
        document.querySelector('#event-detail-card .p-4.p-md-5')?.insertBefore(
            container,
            document.getElementById('comments-section')
        );
    }

    // Admin view: show code generation + stats
    if (currentUser?.isAdmin) {
        try {
            const statsRes = await fetch(`/api/admin/events/${eventId}/checkin-stats`, {
                headers: { 'X-CSRF-TOKEN': csrfToken }
            });
            const stats = await statsRes.json();

            container.innerHTML = `
                <h5><i class="bi bi-qr-code me-2"></i>Check-in (Admin)</h5>
                <div class="row g-3 align-items-center">
                    <div class="col-md-4">
                        <p class="mb-1 text-secondary">Aktueller Code:</p>
                        <h3 class="mb-0 font-monospace">${stats.code || '<span class="text-muted">Keiner</span>'}</h3>
                    </div>
                    <div class="col-md-4">
                        <p class="mb-1 text-secondary">Check-in Status:</p>
                        <div class="d-flex align-items-center gap-2">
                            <span class="badge-pill" style="font-size:1rem;">${stats.checkedIn} / ${stats.total}</span>
                            <span class="text-muted">eingecheckt</span>
                        </div>
                    </div>
                    <div class="col-md-4 text-end">
                        <button class="btn btn-accent" onclick="generateCheckinCode('${eventId}')">
                            <i class="bi bi-arrow-clockwise me-1"></i>Neuen Code generieren
                        </button>
                    </div>
                </div>
            `;
        } catch {
            container.innerHTML = '<p class="text-muted">Check-in konnte nicht geladen werden.</p>';
        }
        return;
    }

    // User view: show check-in code input if accepted
    if (registration?.status === 'accepted') {
        if (registration.checkedIn) {
            container.innerHTML = `
                <div class="text-center py-3">
                    <i class="bi bi-check-circle-fill text-success" style="font-size:2rem;"></i>
                    <p class="mt-2 mb-0">Du bist eingecheckt! ✅</p>
                </div>`;
        } else if (event.checkinEnabled) {
            container.innerHTML = `
                <h5><i class="bi bi-qr-code-scan me-2"></i>Check-in</h5>
                <p class="text-secondary small">Gib den Check-in Code ein, den du vom Veranstalter erhalten hast.</p>
                <div class="d-flex gap-2">
                    <input type="text" class="form-control font-monospace" id="checkin-code-input" 
                        placeholder="6-stelliger Code" maxlength="6" style="max-width:200px;letter-spacing:3px;text-align:center;">
                    <button class="btn btn-accent" onclick="submitCheckin('${eventId}')">
                        <i class="bi bi-check-lg me-1"></i>Einchecken
                    </button>
                </div>`;
        } else {
            container.style.display = 'none';
        }
    } else {
        container.style.display = 'none';
    }
}

async function generateCheckinCode(eventId) {
    try {
        const res = await fetch(`/api/admin/events/${eventId}/generate-checkin`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': csrfToken }
        });
        if (res.ok) {
            const data = await res.json();
            showToast(`Neuer Check-in Code: ${data.code}`, 'success');
            renderCheckinSection(eventId);
        } else {
            showToast('Fehler beim Generieren.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

async function submitCheckin(eventId) {
    const codeInput = document.getElementById('checkin-code-input');
    const code = codeInput?.value?.trim();
    if (!code || code.length !== 6) {
        showToast('Bitte einen 6-stelligen Code eingeben.', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/events/${eventId}/checkin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken
            },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (res.ok) {
            if (data.alreadyCheckedIn) {
                showToast('Du bist bereits eingecheckt!', 'info');
            } else {
                showToast('Erfolgreich eingecheckt! ✅', 'success');
            }

            // Display check-in message if present
            if (data.checkinMessage && data.checkinMessage.trim()) {
                // Create a modal to display the check-in message
                const messageModal = document.createElement('div');
                messageModal.className = 'modal fade';
                messageModal.setAttribute('tabindex', '-1');
                messageModal.innerHTML = `
                    <div class="modal-dialog modal-dialog-centered">
                        <div class="modal-content glass-modal">
                            <div class="modal-header border-0">
                                <h5 class="modal-title"><i class="bi bi-info-circle me-2"></i>Event-Information</h5>
                                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body markdown-body"></div>
                            <div class="modal-footer border-0">
                                <button type="button" class="btn btn-accent" data-bs-dismiss="modal">Verstanden</button>
                            </div>
                        </div>
                    </div>
                `;
                document.body.appendChild(messageModal);

                // Render Markdown safely
                const modalBody = messageModal.querySelector('.modal-body');
                modalBody.innerHTML = renderMarkdownSafe(data.checkinMessage);

                const modal = new bootstrap.Modal(messageModal);
                modal.show();

                // Remove modal from DOM after it's hidden
                messageModal.addEventListener('hidden.bs.modal', () => {
                    messageModal.remove();
                });
            }

            showEventDetail(eventId);
        } else {
            showToast(data.error || 'Fehler beim Check-in.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

// ─── Event Comments ──────────────────────────────
async function loadComments(eventId) {
    // Check if comment area exists, if not create it
    let commentSection = document.getElementById('comments-section');
    if (!commentSection) {
        commentSection = document.createElement('div');
        commentSection.id = 'comments-section';
        commentSection.className = 'comments-section';
        document.querySelector('#event-detail-card .p-4.p-md-5')?.appendChild(commentSection);
    }
    if (!commentSection) return;

    const isLoggedIn = !!currentUser;

    try {
        const res = await fetch(`/api/events/${eventId}/comments`);
        const comments = await res.json();

        let html = `<h5><i class="bi bi-chat-dots me-2"></i>Kommentare & Fragen (${comments.length})</h5>`;

        // Comment form (only if logged in)
        if (isLoggedIn) {
            html += `
            <div class="comment-form">
                <textarea class="form-control" id="comment-input" rows="2" placeholder="Frage oder Kommentar schreiben..." maxlength="1000"></textarea>
                <button class="btn btn-accent" onclick="postComment('${eventId}')">
                    <i class="bi bi-send"></i>
                </button>
            </div>`;
        } else {
            html += `<p class="text-muted small mb-3"><i class="bi bi-lock me-1"></i>Einloggen um zu kommentieren.</p>`;
        }

        // Comments list
        if (comments.length === 0) {
            html += `<p class="text-muted text-center py-3">Noch keine Kommentare.</p>`;
        } else {
            // Separate top-level comments and replies
            const topLevel = comments.filter(c => !c.replyTo);
            const replies = comments.filter(c => c.replyTo);

            topLevel.forEach(comment => {
                html += renderComment(comment, eventId, isLoggedIn);
                // Show replies
                replies.filter(r => r.replyTo === comment.id).forEach(reply => {
                    html += `<div class="comment-reply">${renderComment(reply, eventId, isLoggedIn)}</div>`;
                });
            });
        }

        commentSection.innerHTML = html;
    } catch {
        commentSection.innerHTML = '<p class="text-muted">Kommentare konnten nicht geladen werden.</p>';
    }
}

function renderComment(comment, eventId, isLoggedIn) {
    const isOwn = currentUser && currentUser.id === comment.userId;
    const isAdmin = currentUser && currentUser.isAdmin;
    const dateStr = new Date(comment.createdAt).toLocaleDateString('de-DE', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    return `
    <div class="comment-card ${comment.isAdmin ? 'comment-admin-reply' : ''}">
        <div class="comment-header">
            <img class="comment-avatar" src="${escapeHtml(comment.userAvatar || '')}" alt="" onerror="this.style.display='none'">
            <span class="comment-username">${escapeHtml(comment.userName)}</span>
            ${comment.isAdmin ? '<span class="comment-admin-badge">ADMIN</span>' : ''}
            <span class="comment-date">${dateStr}</span>
        </div>
        <div class="comment-text">${escapeHtml(comment.text).replace(/\n/g, '<br>')}</div>
        <div class="comment-actions">
            ${isLoggedIn && !comment.replyTo ? `<button onclick="replyToComment('${eventId}', '${comment.id}', '${escapeHtml(comment.userName).replace(/'/g, "\\'")}')"><i class="bi bi-reply me-1"></i>Antworten</button>` : ''}
            ${isOwn || isAdmin ? `<button onclick="deleteComment('${eventId}', '${comment.id}')"><i class="bi bi-trash me-1"></i>Löschen</button>` : ''}
        </div>
    </div>`;
}

async function postComment(eventId, replyTo = null) {
    const input = document.getElementById('comment-input');
    const text = input.value.trim();
    if (!text) return;

    try {
        const res = await fetch(`/api/events/${eventId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken
            },
            body: JSON.stringify({ text, replyTo })
        });
        if (res.ok) {
            loadComments(eventId);
        } else {
            const data = await res.json();
            showToast(data.error || 'Fehler beim Posten.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

function replyToComment(eventId, commentId, userName) {
    const input = document.getElementById('comment-input');
    if (input) {
        input.value = `@${userName} `;
        input.focus();
        // Store reply target
        input.dataset.replyTo = commentId;
        // Override the send button
        const btn = input.nextElementSibling;
        if (btn) {
            btn.onclick = () => {
                postComment(eventId, commentId);
                delete input.dataset.replyTo;
                btn.onclick = () => postComment(eventId);
            };
        }
    }
}

async function deleteComment(eventId, commentId) {
    if (!confirm('Kommentar löschen?')) return;
    try {
        const res = await fetch(`/api/events/${eventId}/comments/${commentId}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': csrfToken }
        });
        if (res.ok) {
            loadComments(eventId);
        } else {
            showToast('Fehler beim Löschen.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

async function submitRegistration(eventId, event, btnId, formContainerId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    // Save original text to restore later
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Wird gesendet...';

    const formAnswers = collectFormAnswers(event.formFields || [], formContainerId);

    // Create an abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
        const submitRes = await fetch(`/api/events/${eventId}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken
            },
            body: JSON.stringify({ formAnswers }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const result = await submitRes.json();

        if (submitRes.ok) {
            showToast(result.message || 'Erfolgreich!', 'success');
            showEventDetail(eventId);
        } else {
            showToast(result.error || 'Fehler bei der Anmeldung.', 'danger');
            // Allow retry by not reloading the whole page, just resetting button
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            showToast('Zeitüberschreitung bei der Anfrage. Bitte versuche es erneut.', 'danger');
        } else {
            console.error('Registration error:', error);
            showToast('Netzwerkfehler. Bitte versuche es später erneut.', 'danger');
        }
    } finally {
        // Always re-enable button and restore text if we didn't navigate away
        if (document.body.contains(btn)) {
            btn.disabled = false;
            // Restore original icon if it was lost, or just set safer default
            if (btnId === 'waitlist-btn') {
                btn.innerHTML = '<i class="bi bi-list-nested me-2"></i>Auf Warteliste setzen';
            } else {
                btn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Teilnehmen';
            }
        }
    }
}

async function unregisterFromEvent() {
    const hash = window.location.hash.replace('#', '');
    const parts = hash.split('/');
    const eventId = parts[1]; // Get event ID from URL hash

    if (!eventId) {
        showToast('Fehler: Event ID nicht gefunden.', 'danger');
        return;
    }

    if (!confirm('Möchtest du dich wirklich von diesem Event abmelden?')) {
        return;
    }

    const btn = document.getElementById('unregister-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Wird abgemeldet...';

    try {
        const res = await fetch(`/api/events/${eventId}/register`, {
            method: 'DELETE',
            headers: {
                'X-CSRF-TOKEN': csrfToken
            }
        });
        const result = await res.json();

        if (res.ok) {
            showToast(result.message || 'Erfolgreich abgemeldet!', 'success');
            // Reload the event detail to show registration form again
            showEventDetail(eventId);
        } else {
            showToast(result.error || 'Fehler bei der Abmeldung.', 'danger');
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-x-circle me-1"></i>Abmelden';
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-x-circle me-1"></i>Abmelden';
    }
}

function renderFormFields(fields, containerId = 'dynamic-form-fields') {
    const container = document.getElementById(containerId);
    if (!fields.length) {
        container.innerHTML = '';
        return;
    }
    const prefix = containerId === 'dynamic-form-fields' ? 'form-field' : 'wl-field';
    container.innerHTML = fields.map((field, i) => {
        const id = `${prefix}-${i}`;
        let input = '';
        switch (field.type) {
            case 'text':
                input = `<input type="text" class="form-control" id="${id}" ${field.required ? 'required' : ''} placeholder="${escapeHtml(field.label)}">`;
                break;
            case 'dropdown':
                input = `<select class="form-select" id="${id}" ${field.required ? 'required' : ''}>
          <option value="">Bitte wählen...</option>
          ${(field.options || []).map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('')}
        </select>`;
                break;
            case 'checkbox':
                input = `<div class="form-check">
          <input type="checkbox" class="form-check-input" id="${id}">
          <label class="form-check-label" for="${id}">${escapeHtml(field.label)}</label>
        </div>`;
                return `<div class="mb-3">${input}</div>`;
        }
        return `<div class="mb-3">
      <label class="form-label" for="${id}">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>
      ${input}
    </div>`;
    }).join('');
}

function collectFormAnswers(fields, containerId = 'dynamic-form-fields') {
    const prefix = containerId === 'dynamic-form-fields' ? 'form-field' : 'wl-field';
    const answers = {};
    fields.forEach((field, i) => {
        const el = document.getElementById(`${prefix}-${i}`);
        if (!el) return;
        if (field.type === 'checkbox') {
            answers[field.label] = el.checked;
        } else {
            answers[field.label] = el.value;
        }
    });
    return answers;
}

// ─── Discord Import ──────────────────────────────
async function showImportDiscordEventsModal() {
    const modal = new bootstrap.Modal(document.getElementById('importDiscordEventsModal'));
    modal.show();
    await fetchDiscordEvents();
}

async function fetchDiscordEvents() {
    const list = document.getElementById('discord-events-list');
    list.innerHTML = '<div class="text-center py-5"><span class="spinner-border text-primary"></span><p class="mt-2 text-muted">Lade Events...</p></div>';

    try {
        const res = await fetch('/api/admin/import/discord-events');
        const events = await res.json();

        if (!events || events.length === 0) {
            list.innerHTML = '<div class="text-center py-5"><i class="bi bi-calendar-x" style="font-size: 2rem; color: var(--text-muted);"></i><p class="mt-2 text-muted">Keine geplanten Events im Discord gefunden.</p></div>';
            return;
        }

        list.innerHTML = events.map(ev => `
            <a href="#" class="list-group-item list-group-item-action d-flex gap-3 py-3" onclick="selectDiscordEvent(this)" data-event='${JSON.stringify(ev).replace(/'/g, "&apos;")}'>
                ${ev.image ? `<img src="${ev.image}" alt="Event Image" width="48" height="48" class="rounded-circle flex-shrink-0" style="object-fit:cover;">` : '<div class="rounded-circle bg-secondary d-flex align-items-center justify-content-center flex-shrink-0" style="width:48px;height:48px;"><i class="bi bi-discord"></i></div>'}
                <div class="d-flex gap-2 w-100 justify-content-between">
                    <div>
                        <h6 class="mb-0 text-white">${escapeHtml(ev.name)}</h6>
                        <p class="mb-0 opacity-75 small text-white-50">${ev.description ? escapeHtml(ev.description).substring(0, 100) + '...' : 'Keine Beschreibung'}</p>
                    </div>
                    <small class="opacity-50 text-nowrap text-white-50">${new Date(ev.scheduledStartTimestamp).toLocaleDateString()}</small>
                </div>
            </a>
        `).join('');
    } catch (err) {
        console.error(err);
        list.innerHTML = '<div class="alert alert-danger">Fehler beim Laden der Events.</div>';
    }
}

function selectDiscordEvent(el) {
    const eventData = JSON.parse(el.getAttribute('data-event'));

    // Close import modal
    const importModalEl = document.getElementById('importDiscordEventsModal');
    const importModal = bootstrap.Modal.getInstance(importModalEl);
    importModal.hide();

    // Open create modal
    showCreateEventModal().then(() => {
        // Fill form
        document.getElementById('event-title').value = eventData.name || '';
        if (descriptionEditor) {
            descriptionEditor.value(eventData.description || '');
        } else {
            document.getElementById('event-description').value = eventData.description || '';
        }

        if (eventData.image) {
            document.getElementById('event-banner-url').value = eventData.image;
            updateBannerPreview();
        }

        if (eventData.scheduledStartTimestamp) {
            const startDate = new Date(eventData.scheduledStartTimestamp);
            if (startDatePicker) startDatePicker.setDate(startDate);
        }

        if (eventData.scheduledEndTimestamp) {
            const endDate = new Date(eventData.scheduledEndTimestamp);
            if (endDatePicker) endDatePicker.setDate(endDate);
        }

        showToast('Event-Daten übernommen!', 'success');
    });
}

// ─── Profile Section ─────────────────────────────
async function showProfileSection() {
    const section = document.getElementById('profile-section');
    section.style.display = 'block';

    if (!currentUser) return navigateTo('events');

    // Show loading state
    const header = document.getElementById('profile-header');
    const statsContainer = document.getElementById('profile-stats');
    const badgesContainer = document.getElementById('profile-badges');
    const regContainer = document.getElementById('profile-registrations');
    const emptyEl = document.getElementById('profile-empty');
    const badgeCountEl = document.getElementById('profile-badge-count');

    header.innerHTML = `
    <img src="${escapeHtml(currentUser.avatar)}" class="profile-avatar" alt="Avatar">
    <div>
      <div class="profile-name">${escapeHtml(currentUser.displayName)}</div>
      <div class="profile-meta">@${escapeHtml(currentUser.username)} · Discord ID: ${currentUser.id}</div>
    </div>
  `;

    statsContainer.innerHTML = Array(4).fill('').map(() => `
    <div class="stat-card"><div class="skeleton-block" style="height:60px;"></div></div>
  `).join('');
    badgesContainer.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-secondary spinner-border-sm"></div></div>';
    regContainer.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-secondary spinner-border-sm"></div></div>';
    emptyEl.style.display = 'none';

    try {
        const res = await fetch('/api/user/profile');
        const data = await res.json();
        const { stats, badges, registrations, unlockedBadges, totalBadges } = data;

        // ── Stats Grid ──────────────────────────────────────
        const statItems = [
            { icon: 'bi-calendar-check', label: 'Events', value: stats.total, color: 'var(--accent-light)' },
            { icon: 'bi-check-circle', label: 'Angenommen', value: stats.accepted, color: 'var(--success)' },
            { icon: 'bi-qr-code', label: 'Eingecheckt', value: stats.checkedIn, color: 'var(--info)' },
            { icon: 'bi-hourglass-split', label: 'Ausstehend', value: stats.pending, color: 'var(--warning)' }
        ];

        statsContainer.innerHTML = statItems.map(s => `
      <div class="stat-card profile-stat-card">
        <div class="stat-icon"><i class="bi ${s.icon}" style="color:${s.color};"></i></div>
        <div class="stat-value" data-target="${s.value}">0</div>
        <div class="stat-label">${s.label}</div>
      </div>
    `).join('');

        if (typeof gsap !== 'undefined') {
            // Animate stat counters
            statsContainer.querySelectorAll('.stat-value').forEach(el => {
                const target = parseInt(el.dataset.target) || 0;
                gsap.to(el, {
                    textContent: target,
                    duration: 1.2,
                    ease: 'power2.out',
                    snap: { textContent: 1 },
                    delay: 0.2
                });
            });

            gsap.from('.profile-stat-card', {
                y: 20, duration: 0.4,
                stagger: 0.08, ease: 'power3.out'
            });
        }

        // ── Badges ──────────────────────────────────────────
        badgeCountEl.textContent = `${unlockedBadges} / ${totalBadges} freigeschaltet`;

        badgesContainer.innerHTML = badges.map(badge => `
      <div class="profile-badge-card ${badge.unlocked ? 'unlocked' : 'locked'}">
        <div class="profile-badge-icon" style="${badge.unlocked ? `color:${badge.color};text-shadow:0 0 20px ${badge.color}40;` : ''}">
          <i class="bi ${badge.icon}"></i>
        </div>
        <div class="profile-badge-name">${escapeHtml(badge.name)}</div>
        <div class="profile-badge-desc">${escapeHtml(badge.description)}</div>
        ${badge.progress !== undefined && !badge.unlocked ? `
          <div class="profile-badge-progress">
            <div class="profile-badge-progress-bar" style="width:${Math.round(badge.progress * 100)}%;background:${badge.color};"></div>
          </div>
        ` : ''}
      </div>
    `).join('');

        if (typeof gsap !== 'undefined') {
            gsap.from('.profile-badge-card', {
                scale: 0.8, duration: 0.4,
                stagger: 0.06, ease: 'back.out(1.4)',
                delay: 0.3
            });
        }

        // ── Registrations ───────────────────────────────────
        if (!registrations.length) {
            regContainer.innerHTML = '';
            emptyEl.style.display = 'block';
        } else {
            const statusTexts = { pending: '⏳ Ausstehend', accepted: '✅ Angenommen', rejected: '❌ Abgelehnt', waitlisted: '📋 Warteliste' };

            regContainer.innerHTML = registrations.map(reg => `
        <div class="profile-reg-card" onclick="${reg.event ? `navigateTo('event/${reg.event.id}')` : ''}">
          <div class="profile-reg-info">
            <h6>${reg.event ? escapeHtml(reg.event.title) : '<span class="text-muted">Gelöschtes Event</span>'}</h6>
            <small>
              ${reg.createdAt ? new Date(reg.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
              ${reg.event && reg.event.category ? ` · ${escapeHtml(reg.event.category)}` : ''}
              ${reg.checkedIn ? ' · <span class="text-success">✓ Eingecheckt</span>' : ''}
            </small>
          </div>
          <span class="badge-pill status-${reg.status}">
            ${statusTexts[reg.status] || reg.status}
          </span>
        </div>
      `).join('');

            if (typeof gsap !== 'undefined') {
                gsap.from('.profile-reg-card', {
                    y: 15, duration: 0.3,
                    stagger: 0.05, ease: 'power3.out',
                    delay: 0.5
                });
            }
        }

        // Animate the header card
        if (typeof gsap !== 'undefined') {
            gsap.from('#profile-header-card', {
                y: 20, duration: 0.5, ease: 'power3.out'
            });
        }

    } catch {
        regContainer.innerHTML = '<div class="alert alert-danger">Fehler beim Laden des Profils.</div>';
        statsContainer.innerHTML = '';
        badgesContainer.innerHTML = '';
    }
}


// ─── Admin Section ───────────────────────────────
async function showAdminSection() {
    const section = document.getElementById('admin-section');
    section.style.display = 'block';
    await Promise.all([loadAdminStats(), loadAdminEvents()]);
}

async function loadAdminStats() {
    const container = document.getElementById('admin-stats');
    try {
        const res = await fetch('/api/admin/stats');
        const stats = await res.json();

        container.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-calendar-event"></i></div>
        <div class="stat-value">${stats.events.total}</div>
        <div class="stat-label">Events Gesamt</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-play-circle"></i></div>
        <div class="stat-value">${stats.events.active}</div>
        <div class="stat-label">Aktive Events</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-people"></i></div>
        <div class="stat-value">${stats.registrations.total}</div>
        <div class="stat-label">Registrierungen</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-hourglass-split"></i></div>
        <div class="stat-value">${stats.registrations.pending}</div>
        <div class="stat-label">Ausstehend</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-check-circle"></i></div>
        <div class="stat-value">${stats.registrations.accepted}</div>
        <div class="stat-label">Angenommen</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-list-nested"></i></div>
        <div class="stat-value">${stats.registrations.waitlisted}</div>
        <div class="stat-label">Warteliste</div>
      </div>
    `;

        gsap.fromTo('.stat-card',
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.3, stagger: 0.05, ease: 'power3.out' }
        );
    } catch {
        container.innerHTML = '<div class="text-muted text-center py-3">Statistiken konnten nicht geladen werden.</div>';
    }
}

async function loadAdminEvents() {
    const grid = document.getElementById('admin-events-grid');
    renderSkeletonEvents(grid, 4, true);

    try {
        const res = await fetch('/api/admin/all-events');
        const events = await res.json();

        if (!events.length) {
            grid.innerHTML = '<div class="col-12 text-center py-5"><p class="text-muted">Noch keine Events erstellt.</p></div>';
            return;
        }

        const statusMap = { active: 'Aktiv', draft: 'Entwurf', archived: 'Archiviert' };

        grid.innerHTML = events.map(event => {
            const status = event.status || 'active';
            const bannerHtml = isValidBannerUrl(event.bannerUrl)
                ? `<img src="${escapeHtml(event.bannerUrl)}" class="event-banner" alt="Banner" style="border-radius: var(--radius-lg) var(--radius-lg) 0 0;">`
                : '';

            return `
        <div class="col-md-6">
          <div class="glass-card admin-event-card">
            ${bannerHtml}
            <div class="p-4">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <h5 class="mb-0">${escapeHtml(event.title)}</h5>
                <span class="event-status-badge event-status-${status}">${statusMap[status] || status}</span>
              </div>
              <p class="text-secondary small mb-2">${escapeHtml(event.description || '').substring(0, 120)}${(event.description || '').length > 120 ? '...' : ''}</p>
              ${event.category ? `<span class="event-category-tag mb-2 d-inline-block">${escapeHtml(event.category)}</span>` : ''}
              ${event.startDate ? `<div class="event-date-info mb-2"><i class="bi bi-calendar3"></i>${new Date(event.startDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>` : ''}
              <div class="d-flex flex-wrap gap-2 mb-3">
                <span class="badge-pill"><i class="bi bi-${event.accessMode === 'open' ? 'unlock' : 'lock'}"></i>${event.accessMode === 'open' ? 'Offen' : 'Rollen'}</span>
                <span class="badge-pill"><i class="bi bi-${event.approvalMode === 'instant' ? 'lightning' : 'hourglass-split'}"></i>${event.approvalMode === 'instant' ? 'Instant' : 'Manuell'}</span>
                ${event.maxParticipants > 0 ? `<span class="badge-pill"><i class="bi bi-people"></i>Max ${event.maxParticipants}</span>` : ''}
                <span class="badge-pill"><i class="bi bi-ui-checks"></i>${(event.formFields || []).length} Felder</span>
                ${event.reminderHours > 0 ? `<span class="badge-pill"><i class="bi bi-bell"></i>${event.reminderHours}h</span>` : ''}
              </div>
              <div class="admin-actions">
                <button class="btn btn-sm btn-outline-light" onclick="showRegistrations('${event.id}', '${escapeHtml(event.title).replace(/'/g, "\\\'")}')">
                  <i class="bi bi-list-check me-1"></i>Anmeldungen
                </button>
                <button class="btn btn-sm btn-outline-light" onclick="exportRegistrations('${event.id}')">
                  <i class="bi bi-download me-1"></i>CSV
                </button>
                <button class="btn btn-sm btn-outline-light" onclick="announceEvent('${event.id}')">
                  <i class="bi bi-megaphone me-1"></i>Ankündigen
                </button>
                <button class="btn btn-sm btn-outline-light" onclick="duplicateEvent('${event.id}')">
                  <i class="bi bi-copy me-1"></i>Duplizieren
                </button>
                <button class="btn btn-sm btn-outline-light" onclick="editEvent('${event.id}')">
                  <i class="bi bi-pencil me-1"></i>Bearbeiten
                </button>
                <div class="dropdown d-inline-block status-dropdown">
                  <button class="btn btn-sm btn-outline-light dropdown-toggle" data-bs-toggle="dropdown">
                    <i class="bi bi-toggle-on me-1"></i>Status
                  </button>
                  <ul class="dropdown-menu">
                    <li><a class="dropdown-item" href="#" onclick="changeEventStatus('${event.id}', 'active'); return false;">✅ Aktiv</a></li>
                    <li><a class="dropdown-item" href="#" onclick="changeEventStatus('${event.id}', 'draft'); return false;">📝 Entwurf</a></li>
                    <li><a class="dropdown-item" href="#" onclick="changeEventStatus('${event.id}', 'archived'); return false;">📦 Archiviert</a></li>
                  </ul>
                </div>
                ${event.status === 'draft' ? `
                <button class="btn btn-sm btn-outline-success" onclick="startEvent('${event.id}')" title="Event starten (Status Aktiv + Startzeit jetzt)">
                  <i class="bi bi-play-fill"></i>
                </button>
                ` : ''}
                ${event.status === 'active' ? `
                <button class="btn btn-sm btn-outline-warning" onclick="endEvent('${event.id}')" title="Event beenden (Status Archiviert + Endzeit jetzt)">
                  <i class="bi bi-stop-fill"></i>
                </button>
                ` : ''}
                <button class="btn btn-sm btn-outline-danger" onclick="deleteEvent('${event.id}')">
                  <i class="bi bi-trash me-1"></i>Löschen
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
        }).join('');

        // Handle image error fallbacks for admin cards
        grid.querySelectorAll('.event-banner').forEach(img => {
            img.addEventListener('error', () => { img.style.display = 'none'; });
        });

        gsap.fromTo('.admin-event-card',
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.3, stagger: 0.06, ease: 'power3.out' }
        );
    } catch {
        grid.innerHTML = '<div class="col-12"><div class="alert alert-danger">Fehler beim Laden.</div></div>';
    }
}

// ─── Audit Log ───────────────────────────────────
async function loadAuditLog() {
    const container = document.getElementById('audit-log-container');
    const entries = document.getElementById('audit-log-entries');
    container.style.display = 'block';
    entries.innerHTML = '<div class="text-center py-3"><span class="spinner-border spinner-border-sm"></span> Laden...</div>';

    try {
        const res = await fetch('/api/admin/audit-log?limit=100');
        const data = await res.json();

        if (!data.data || data.data.length === 0) {
            entries.innerHTML = '<p class="text-muted text-center">Keine Log-Einträge vorhanden.</p>';
            return;
        }

        const actionColors = {
            CREATE_EVENT: '#22c55e', UPDATE_EVENT: '#3b82f6', DELETE_EVENT: '#ef4444',
            CANCEL_EVENT: '#f59e0b', DUPLICATE_EVENT: '#8b5cf6', GENERATE_CHECKIN: '#06b6d4',
            UPDATE_REGISTRATION_STATUS: '#6366f1', ANNOUNCE_EVENT: '#ec4899',
            UPDATE_EVENT_STATUS: '#f97316', UPDATE_TEMPLATES: '#14b8a6',
            EXPORT_REGISTRATIONS: '#6b7280'
        };

        let html = `<div class="table-responsive"><table class="table table-sm table-dark table-hover" style="background:transparent;">
            <thead><tr>
                <th>Zeitpunkt</th>
                <th>Aktion</th>
                <th>Details</th>
                <th>Admin</th>
            </tr></thead><tbody>`;

        data.data.forEach(log => {
            const date = new Date(log.timestamp).toLocaleString('de-DE', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
            });
            const color = actionColors[log.action] || '#9ca3af';
            html += `<tr>
                <td class="text-muted small">${date}</td>
                <td><span class="badge" style="background:${color};font-size:0.7rem;">${log.action}</span></td>
                <td class="small">${escapeHtml(log.details || '')}</td>
                <td class="text-muted small font-monospace">${(log.adminId || '').substring(0, 8)}…</td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        if (data.meta.totalPages > 1) {
            html += `<p class="text-muted small text-center">Zeige ${data.data.length} von ${data.meta.total} Einträgen</p>`;
        }
        entries.innerHTML = html;

        // Scroll to audit log
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
        entries.innerHTML = '<p class="text-danger">Fehler beim Laden der Logs.</p>';
    }
}

// ─── System Reset ────────────────────────────────
function showResetModal() {
    document.getElementById('reset-password').value = '';
    const modal = new bootstrap.Modal(document.getElementById('resetModal'));
    modal.show();
}

async function performSystemReset() {
    const password = document.getElementById('reset-password').value;
    if (!password) {
        showToast('Bitte Passwort eingeben.', 'warning');
        return;
    }

    const targets = [];
    if (document.getElementById('reset-events').checked) targets.push('events');
    if (document.getElementById('reset-registrations').checked) targets.push('registrations');
    if (document.getElementById('reset-comments').checked) targets.push('comments');
    if (document.getElementById('reset-auditLogs').checked) targets.push('auditLogs');
    if (document.getElementById('reset-users').checked) targets.push('users');

    if (targets.length === 0) {
        showToast('Keine Bereiche ausgewählt.', 'warning');
        return;
    }

    if (!confirm(`Bist du sicher? Dies löscht ${targets.length} Bereiche UNWIDERRUFLICH!`)) return;

    try {
        const res = await fetch('/api/admin/reset', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken
            },
            body: JSON.stringify({ password, targets })
        });
        const data = await res.json();

        if (res.ok) {
            showToast(`Reset erfolgreich! ${data.count} Dokumente gelöscht.`, 'success');
            setTimeout(() => window.location.reload(), 2000);
        } else {
            showToast(data.error || 'Reset fehlgeschlagen.', 'danger');
        }
    } catch (err) {
        showToast('Netzwerkfehler beim Reset.', 'danger');
    }
}

// ─── Participant Warning Badge ───────────────────
function getParticipantWarningBadge(event) {
    if (!event.maxParticipants || event.maxParticipants <= 0) return '';
    const current = event.currentParticipants || 0;
    const remaining = event.maxParticipants - current;
    const ratio = current / event.maxParticipants;

    if (remaining <= 0) {
        return `<span class="badge-pill spots-full"><i class="bi bi-x-circle"></i>Ausgebucht</span>`;
    } else if (ratio >= 0.8) {
        return `<span class="badge-pill spots-warning"><i class="bi bi-exclamation-triangle"></i>Nur noch ${remaining} ${remaining === 1 ? 'Platz' : 'Plätze'}!</span>`;
    }
    return '';
}

// ─── Debounced Search ─────────────────────────────
function debouncedSearch() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        showEventsSection();
    }, 300);
}

// ─── View Toggle (Grid / Calendar) ───────────────
function switchView(view) {
    currentView = view;
    const gridBtn = document.getElementById('view-grid-btn');
    const calBtn = document.getElementById('view-calendar-btn');
    const grid = document.getElementById('events-grid');
    const calendar = document.getElementById('events-calendar');

    if (view === 'grid') {
        gridBtn.classList.add('active');
        calBtn.classList.remove('active');
        grid.style.display = '';
        calendar.style.display = 'none';
    } else {
        gridBtn.classList.remove('active');
        calBtn.classList.add('active');
        grid.style.display = 'none';
        calendar.style.display = '';
        renderCalendar(cachedEvents);
    }
}

// ─── Duplicate Event ─────────────────────────────
async function duplicateEvent(eventId) {
    if (!confirm('Event duplizieren?')) return;
    try {
        const res = await fetch(`/api/admin/events/${eventId}/duplicate`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': csrfToken }
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Event dupliziert: ${data.title}`, 'success');
            loadAdminEvents();
        } else {
            showToast(data.error || 'Fehler beim Duplizieren.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

// ─── Calendar View ──────────────────────────────
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();

function renderCalendar(events) {
    const container = document.getElementById('events-calendar');
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

    // Group events by date
    const eventsByDate = {};
    events.forEach(ev => {
        if (ev.startDate) {
            const d = new Date(ev.startDate);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (!eventsByDate[key]) eventsByDate[key] = [];
            eventsByDate[key].push(ev);
        }
    });

    // First day of month and days in month
    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    let startDayOfWeek = firstDay.getDay(); // 0=Sun
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // Convert to Mon=0

    // Days from previous month to fill
    const prevMonthDays = new Date(calendarYear, calendarMonth, 0).getDate();

    let html = `
    <div class="calendar-container">
      <div class="calendar-header">
        <button class="btn btn-sm btn-outline-light" onclick="calendarMonth--; if(calendarMonth<0){calendarMonth=11;calendarYear--} renderCalendar(cachedEvents)">
          <i class="bi bi-chevron-left"></i>
        </button>
        <h4>${monthNames[calendarMonth]} ${calendarYear}</h4>
        <button class="btn btn-sm btn-outline-light" onclick="calendarMonth++; if(calendarMonth>11){calendarMonth=0;calendarYear++} renderCalendar(cachedEvents)">
          <i class="bi bi-chevron-right"></i>
        </button>
      </div>
      <div class="calendar-grid">
    `;

    // Day names
    dayNames.forEach(d => {
        html += `<div class="calendar-day-name">${d}</div>`;
    });

    // Previous month filler days
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const day = prevMonthDays - i;
        html += `<div class="calendar-day other-month"><span class="day-number">${day}</span></div>`;
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = dateKey === todayStr;
        const dayEvents = eventsByDate[dateKey] || [];

        let eventsHtml = '';
        if (dayEvents.length > 0) {
            eventsHtml = '<div class="calendar-day-events">';
            dayEvents.slice(0, 3).forEach(ev => {
                eventsHtml += `<div class="calendar-day-event" onclick="event.stopPropagation();navigateTo('event/${ev.id}')">${escapeHtml(ev.title)}</div>`;
            });
            if (dayEvents.length > 3) {
                eventsHtml += `<div class="calendar-day-event" style="opacity:0.6">+${dayEvents.length - 3} mehr</div>`;
            }
            eventsHtml += '</div>';
        }

        html += `<div class="calendar-day ${isToday ? 'today' : ''}">
            <span class="day-number">${day}</span>
            ${eventsHtml}
        </div>`;
    }

    // Next month filler days
    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remainingCells; i++) {
        html += `<div class="calendar-day other-month"><span class="day-number">${i}</span></div>`;
    }

    html += '</div></div>';
    container.innerHTML = html;
}

// ─── Event CRUD ──────────────────────────────────
async function showCreateEventModal() {
    document.getElementById('eventModalTitle').textContent = 'Neues Event erstellen';
    document.getElementById('event-edit-id').value = '';
    document.getElementById('event-title').value = '';
    document.getElementById('event-description').value = '';
    document.getElementById('event-banner-url').value = '';
    document.getElementById('event-start-date').value = '';
    document.getElementById('event-end-date').value = '';
    document.getElementById('event-max').value = '0';
    document.getElementById('event-category').value = '';
    document.getElementById('event-access').value = 'open';
    document.getElementById('event-approval').value = 'manual';
    document.getElementById('event-status').value = 'active';
    document.getElementById('event-reminder').value = '0';
    document.getElementById('event-assign-role').value = '';
    document.getElementById('form-fields-builder').innerHTML = '';
    document.getElementById('role-requirement-area').style.display = 'none';

    // Reset Custom Messages
    document.getElementById('event-custom-msg-toggle').checked = false;
    document.getElementById('custom-msg-options').style.display = 'none';
    document.getElementById('event-msg-registration').value = '';
    document.getElementById('event-msg-accepted').value = '';
    document.getElementById('event-msg-rejected').value = '';

    // Initialize EasyMDE if not exists
    if (!descriptionEditor) {
        descriptionEditor = new EasyMDE({
            element: document.getElementById('event-description'),
            spellChecker: false,
            status: false,
            maxHeight: "200px",
            autoDownloadFontAwesome: false,
        });
    }
    descriptionEditor.value('');

    // Initialize Flatpickr if not exists
    if (!startDatePicker) {
        startDatePicker = flatpickr("#event-start-date", {
            enableTime: true,
            dateFormat: "Y-m-d H:i",
            time_24hr: true,
            locale: "de"
        });
    }
    startDatePicker.clear();

    if (!endDatePicker) {
        endDatePicker = flatpickr("#event-end-date", {
            enableTime: true,
            dateFormat: "Y-m-d H:i",
            time_24hr: true,
            locale: "de"
        });
    }
    endDatePicker.clear();

    // Banner Preview Setup
    const bannerInput = document.getElementById('event-banner-url');
    bannerInput.removeEventListener('input', updateBannerPreview); // Avoid duplicates
    bannerInput.addEventListener('input', updateBannerPreview);
    updateBannerPreview();

    await loadRoles();

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('eventModal'));
    modal.show();

    // Fix for EasyMDE rendering in modal
    setTimeout(() => {
        descriptionEditor.codemirror.refresh();
    }, 200);

    document.getElementById('event-access').onchange = function () {
        document.getElementById('role-requirement-area').style.display = this.value === 'role-required' ? 'block' : 'none';
    };
}

function updateBannerPreview() {
    const url = document.getElementById('event-banner-url').value;
    const container = document.getElementById('banner-preview-container');
    const img = document.getElementById('banner-preview');

    if (url) {
        container.style.display = 'block';
        img.src = url;
    } else {
        container.style.display = 'none';
        img.src = '';
    }
}

async function editEvent(eventId) {
    try {
        const res = await fetch(`/api/events/${eventId}?status=all`);
        const event = await res.json();

        document.getElementById('eventModalTitle').textContent = 'Event bearbeiten';
        document.getElementById('event-edit-id').value = eventId;
        document.getElementById('event-title').value = event.title || '';

        // Update EasyMDE
        if (!descriptionEditor) {
            descriptionEditor = new EasyMDE({
                element: document.getElementById('event-description'),
                spellChecker: false,
                status: false,
                maxHeight: "200px",
                autoDownloadFontAwesome: false,
            });
        }
        descriptionEditor.value(event.description || '');

        document.getElementById('event-banner-url').value = event.bannerUrl || '';

        // Update Flatpickr
        if (!startDatePicker) {
            startDatePicker = flatpickr("#event-start-date", { enableTime: true, dateFormat: "Y-m-d H:i", time_24hr: true, locale: "de" });
        }
        startDatePicker.setDate(event.startDate || null);

        if (!endDatePicker) {
            endDatePicker = flatpickr("#event-end-date", { enableTime: true, dateFormat: "Y-m-d H:i", time_24hr: true, locale: "de" });
        }
        endDatePicker.setDate(event.endDate || null);

        // Banner Preview
        const bannerInput = document.getElementById('event-banner-url');
        bannerInput.removeEventListener('input', updateBannerPreview);
        bannerInput.addEventListener('input', updateBannerPreview);
        updateBannerPreview();
        document.getElementById('event-max').value = event.maxParticipants || 0;
        document.getElementById('event-category').value = event.category || '';
        document.getElementById('event-access').value = event.accessMode || 'open';
        document.getElementById('event-approval').value = event.approvalMode || 'manual';
        document.getElementById('event-status').value = event.status || 'active';
        document.getElementById('event-reminder').value = event.reminderHours || 0;
        document.getElementById('event-checkin-message').value = event.checkinMessage || '';

        // Recurring fields
        const recurringCb = document.getElementById('event-recurring');
        recurringCb.checked = !!event.recurring;
        document.getElementById('recurring-options').style.display = event.recurring ? '' : 'none';
        document.getElementById('event-recurring-interval').value = event.recurringInterval || 'weekly';
        document.getElementById('event-recurring-until').value = event.recurringUntil || '';

        await loadRoles();

        document.getElementById('event-assign-role').value = event.assignRoleId || '';

        // Custom Messages
        const customMsgs = event.customBotMessages || {};
        const hasCustom = customMsgs.registration || customMsgs.accepted || customMsgs.rejected;
        document.getElementById('event-custom-msg-toggle').checked = !!hasCustom;
        document.getElementById('custom-msg-options').style.display = hasCustom ? 'block' : 'none';
        document.getElementById('event-msg-registration').value = customMsgs.registration || '';
        document.getElementById('event-msg-accepted').value = customMsgs.accepted || '';
        document.getElementById('event-msg-rejected').value = customMsgs.rejected || '';

        document.getElementById('role-requirement-area').style.display = event.accessMode === 'role-required' ? 'block' : 'none';
        if (event.requiredRoles) {
            event.requiredRoles.forEach(roleId => {
                const cb = document.querySelector(`#role-checkboxes input[value="${roleId}"]`);
                if (cb) cb.checked = true;
            });
        }

        const builder = document.getElementById('form-fields-builder');
        builder.innerHTML = '';
        (event.formFields || []).forEach(field => addFormField(field));

        document.getElementById('event-access').onchange = function () {
            document.getElementById('role-requirement-area').style.display = this.value === 'role-required' ? 'block' : 'none';
        };

        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('eventModal'));
        modal.show();

        setTimeout(() => {
            descriptionEditor.codemirror.refresh();
        }, 200);
    } catch {
        showToast('Fehler beim Laden des Events.', 'danger');
    }
}

async function saveEvent() {
    const editId = document.getElementById('event-edit-id').value;
    const data = {
        title: document.getElementById('event-title').value,
        description: descriptionEditor ? descriptionEditor.value() : document.getElementById('event-description').value,
        bannerUrl: document.getElementById('event-banner-url').value,
        startDate: document.getElementById('event-start-date').value,
        endDate: document.getElementById('event-end-date').value,
        maxParticipants: document.getElementById('event-max').value,
        category: document.getElementById('event-category').value,
        accessMode: document.getElementById('event-access').value,
        approvalMode: document.getElementById('event-approval').value,
        status: document.getElementById('event-status').value,
        reminderHours: document.getElementById('event-reminder').value,
        assignRoleId: document.getElementById('event-assign-role').value,
        requiredRoles: getSelectedRoles(),
        formFields: getFormFieldsFromBuilder(),
        recurring: document.getElementById('event-recurring').checked,
        recurringInterval: document.getElementById('event-recurring-interval').value,
        recurringUntil: document.getElementById('event-recurring-until').value,
        checkinMessage: document.getElementById('event-checkin-message').value,
        customBotMessages: {
            registration: document.getElementById('event-msg-registration').value,
            accepted: document.getElementById('event-msg-accepted').value,
            rejected: document.getElementById('event-msg-rejected').value
        }
    };

    try {
        const url = editId ? `/api/admin/events/${editId}` : '/api/admin/events';
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken
            },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
            showToast(editId ? 'Event aktualisiert!' : 'Event erstellt!', 'success');
            loadAdminEvents();
            loadAdminStats();
        } else {
            const err = await res.json();
            showToast(err.error || 'Fehler', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

async function deleteEvent(eventId) {
    if (!confirm('Event wirklich löschen? Alle Anmeldungen werden ebenfalls gelöscht.')) return;
    try {
        await fetch(`/api/admin/events/${eventId}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': csrfToken }
        });
        showToast('Event gelöscht.', 'success');
        loadAdminEvents();
        loadAdminStats();
    } catch {
        showToast('Fehler beim Löschen.', 'danger');
    }
}

async function changeEventStatus(eventId, status) {
    try {
        const res = await fetch(`/api/admin/events/${eventId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken
            },
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            const statusNames = { active: 'Aktiv', draft: 'Entwurf', archived: 'Archiviert' };
            showToast(`Status geändert: ${statusNames[status]}`, 'success');
            loadAdminEvents();
            loadAdminStats();
        } else {
            const err = await res.json();
            showToast(err.error, 'danger');
        }
    } catch {
        showToast('Fehler.', 'danger');
    }
}

async function announceEvent(eventId) {
    // Open the announce modal instead of a simple confirm
    document.getElementById('announce-event-id').value = eventId;
    document.getElementById('announce-text').value = '';
    document.getElementById('announce-everyone').checked = false;

    // Load roles for checkboxes
    const container = document.getElementById('announce-role-checkboxes');
    container.innerHTML = '<span class="text-muted">Rollen werden geladen...</span>';

    try {
        const res = await fetch('/api/admin/roles', {
            headers: { 'X-CSRF-TOKEN': csrfToken }
        });
        if (res.ok) {
            const roles = await res.json();
            // Filter out @everyone (id === guildId) and managed/bot roles
            const selectableRoles = roles.filter(r => r.name !== '@everyone' && !r.managed);

            if (selectableRoles.length === 0) {
                container.innerHTML = '<span class="text-muted">Keine Rollen verfügbar.</span>';
            } else {
                container.innerHTML = selectableRoles.map(role => {
                    const color = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'var(--text-secondary)';
                    return `
                        <div class="form-check">
                            <input type="checkbox" class="form-check-input announce-role-cb" 
                                id="announce-role-${role.id}" value="${role.id}">
                            <label class="form-check-label" for="announce-role-${role.id}" 
                                style="color: ${color}; font-weight: 500;">
                                ${escapeHtml(role.name)}
                            </label>
                        </div>
                    `;
                }).join('');
            }
        } else {
            container.innerHTML = '<span class="text-danger">Fehler beim Laden der Rollen.</span>';
        }
    } catch {
        container.innerHTML = '<span class="text-danger">Netzwerkfehler.</span>';
    }

    const modal = new bootstrap.Modal(document.getElementById('announceModal'));
    modal.show();
}

async function sendAnnouncement() {
    const eventId = document.getElementById('announce-event-id').value;
    const text = document.getElementById('announce-text').value.trim();
    const pingEveryone = document.getElementById('announce-everyone').checked;

    // Collect selected role IDs
    const roleCheckboxes = document.querySelectorAll('.announce-role-cb:checked');
    const roleIds = Array.from(roleCheckboxes).map(cb => cb.value);

    const btn = document.getElementById('announce-send-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Wird gesendet...';

    try {
        const res = await fetch(`/api/admin/events/${eventId}/announce`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken
            },
            body: JSON.stringify({ text, roleIds, pingEveryone })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || 'Angekündigt!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('announceModal')).hide();
        } else {
            showToast(data.error || 'Fehler beim Ankündigen.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-megaphone me-1"></i>Ankündigen';
    }
}

async function startEvent(eventId) {
    if (!confirm('Event jetzt starten? Status wird auf "Aktiv" gesetzt und Startzeit aktualisiert (falls leer).')) return;
    try {
        const res = await fetch(`/api/admin/events/${eventId}/start`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': csrfToken }
        });
        if (res.ok) {
            showToast('Event gestartet!', 'success');
            loadAdminEvents();
            loadAdminStats();
        } else {
            showToast('Fehler beim Starten.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

async function endEvent(eventId) {
    if (!confirm('Event jetzt beenden? Status wird auf "Archiviert" gesetzt und Endzeit aktualisiert.')) return;
    try {
        const res = await fetch(`/api/admin/events/${eventId}/end`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': csrfToken }
        });
        if (res.ok) {
            showToast('Event beendet!', 'success');
            loadAdminEvents();
            loadAdminStats();
        } else {
            showToast('Fehler beim Beenden.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

function exportRegistrations(eventId) {
    window.open(`/api/admin/events/${eventId}/registrations/export`, '_blank');
}

// ─── Roles ───────────────────────────────────────
async function loadRoles() {
    if (cachedRoles.length) {
        populateRoles(cachedRoles);
        return;
    }
    try {
        const res = await fetch('/api/admin/roles');
        cachedRoles = await res.json();
        populateRoles(cachedRoles);
    } catch {
        console.warn('Could not load roles');
    }
}

function populateRoles(roles) {
    const container = document.getElementById('role-checkboxes');
    container.innerHTML = roles.map(r => `
    <label class="badge-pill" style="cursor:pointer;border-color:${r.color}">
      <input type="checkbox" value="${r.id}" style="margin-right:4px;"> ${escapeHtml(r.name)}
    </label>
  `).join('');

    const select = document.getElementById('event-assign-role');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Keine Rolle zuweisen</option>' +
        roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    select.value = currentVal;
}

function getSelectedRoles() {
    const checkboxes = document.querySelectorAll('#role-checkboxes input:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// ─── Form Builder ────────────────────────────────
function addFormField(existing = null) {
    const builder = document.getElementById('form-fields-builder');
    const row = document.createElement('div');
    row.className = 'form-field-row';

    const label = existing ? existing.label : '';
    const type = existing ? existing.type : 'text';
    const options = existing && existing.options ? existing.options.join(', ') : '';
    const required = existing ? existing.required : false;

    row.innerHTML = `
    <input type="text" class="form-control ff-label" placeholder="Feldname" value="${escapeHtml(label)}" style="flex:2">
    <select class="form-select ff-type" style="flex:1" onchange="toggleOptionsInput(this)">
      <option value="text" ${type === 'text' ? 'selected' : ''}>Text</option>
      <option value="dropdown" ${type === 'dropdown' ? 'selected' : ''}>Dropdown</option>
      <option value="checkbox" ${type === 'checkbox' ? 'selected' : ''}>Checkbox</option>
    </select>
    <input type="text" class="form-control ff-options" placeholder="Optionen (kommagetrennt)" value="${escapeHtml(options)}" style="flex:2;${type === 'dropdown' ? '' : 'display:none'}">
    <label class="d-flex align-items-center gap-1" style="white-space:nowrap;font-size:0.8rem;color:var(--text-muted);">
      <input type="checkbox" class="form-check-input ff-required" ${required ? 'checked' : ''}> Pflicht
    </label>
    <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.parentElement.remove()">
      <i class="bi bi-x"></i>
    </button>
  `;

    builder.appendChild(row);
}

function toggleOptionsInput(selectEl) {
    const row = selectEl.closest('.form-field-row');
    const optionsInput = row.querySelector('.ff-options');
    optionsInput.style.display = selectEl.value === 'dropdown' ? 'block' : 'none';
}

function getFormFieldsFromBuilder() {
    const rows = document.querySelectorAll('.form-field-row');
    return Array.from(rows).map(row => {
        const type = row.querySelector('.ff-type').value;
        const field = {
            label: row.querySelector('.ff-label').value,
            type,
            required: row.querySelector('.ff-required').checked
        };
        if (type === 'dropdown') {
            field.options = row.querySelector('.ff-options').value.split(',').map(s => s.trim()).filter(Boolean);
        }
        return field;
    }).filter(f => f.label);
}

// ─── Registrations ───────────────────────────────
async function showRegistrations(eventId, eventTitle) {
    document.getElementById('reg-event-title').textContent = eventTitle;
    const tbody = document.getElementById('registrations-tbody');
    const empty = document.getElementById('registrations-empty');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div></td></tr>';
    empty.style.display = 'none';

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('registrationsModal'));
    modal.show();

    try {
        const res = await fetch(`/api/admin/events/${eventId}/registrations`);
        const result = await res.json();
        const regs = result.data || result;

        if (!regs.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        const statusTexts = { pending: '⏳ Ausstehend', accepted: '✅ Angenommen', rejected: '❌ Abgelehnt', waitlisted: '📋 Warteliste' };

        tbody.innerHTML = regs.map(reg => `
      <tr>
        <td>
          <strong>${escapeHtml(reg.userName)}</strong>
          <br><small class="text-muted">${reg.userId}</small>
        </td>
        <td>
          <span class="badge-pill status-${reg.status}">
            ${statusTexts[reg.status] || reg.status}
          </span>
        </td>
        <td>
          ${Object.entries(reg.formAnswers || {}).map(([k, v]) =>
            `<small><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</small>`
        ).join('<br>') || '<small class="text-muted">—</small>'}
        </td>
        <td><small>${new Date(reg.createdAt).toLocaleDateString('de-DE')}</small></td>
        <td>
          ${reg.status === 'pending' || reg.status === 'waitlisted' ? `
            <button class="btn btn-sm btn-outline-success me-1" onclick="updateRegStatus('${reg.id}', 'accepted', '${eventId}', '${escapeHtml(eventTitle).replace(/'/g, "\\'")}')">
              <i class="bi bi-check"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="updateRegStatus('${reg.id}', 'rejected', '${eventId}', '${escapeHtml(eventTitle).replace(/'/g, "\\'")}')">
              <i class="bi bi-x"></i>
            </button>
          ` : '—'}
        </td>
      </tr>
    `).join('');
    } catch {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Fehler</td></tr>';
    }
}

async function updateRegStatus(regId, status, eventId, eventTitle) {
    try {
        const res = await fetch(`/api/admin/registrations/${regId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken
            },
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            showToast(status === 'accepted' ? 'Angenommen!' : 'Abgelehnt.', status === 'accepted' ? 'success' : 'warning');
            showRegistrations(eventId, eventTitle);
        } else {
            const err = await res.json();
            showToast(err.error, 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

// ─── Bot Messages ────────────────────────────────
async function showBotMessagesModal() {
    try {
        const res = await fetch('/api/admin/bot-messages');
        const data = await res.json();
        document.getElementById('msg-registration').value = data.registration || '';
        document.getElementById('msg-accepted').value = data.accepted || '';
        document.getElementById('msg-rejected').value = data.rejected || '';
    } catch {
        // Use defaults
    }
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('botMessagesModal'));
    modal.show();
}

async function saveBotMessages() {
    try {
        const res = await fetch('/api/admin/bot-messages', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken
            },
            body: JSON.stringify({
                registration: document.getElementById('msg-registration').value,
                accepted: document.getElementById('msg-accepted').value,
                rejected: document.getElementById('msg-rejected').value
            })
        });
        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('botMessagesModal')).hide();
            showToast('Bot-Nachrichten gespeichert!', 'success');
        }
    } catch {
        showToast('Fehler beim Speichern.', 'danger');
    }
}

// ─── Utilities ───────────────────────────────────
function showError(message) {
    const banner = document.getElementById('error-banner');
    document.getElementById('error-message').textContent = message;
    banner.style.display = 'block';
    setTimeout(() => {
        gsap.to(banner, { opacity: 0, duration: 0.5, onComplete: () => banner.style.display = 'none' });
    }, 8000);
}

function showToast(message, type = 'info') {
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

function renderSkeletonEvents(container, count, isAdmin = false) {
    container.innerHTML = Array(count).fill(0).map(() => `
        <div class="col-md-6 ${isAdmin ? '' : 'col-lg-4'}">
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

function escapeHtml(str) {
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
function renderMarkdownSafe(mdString) {
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
 * Validate a banner URL (must be a valid http/https URL)
 */
function isValidBannerUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

// ─── Info Section ────────────────────────────────
function showInfoSection() {
    document.getElementById('info-section').style.display = 'block';

    // Show data button only if logged in
    const mydataArea = document.getElementById('info-mydata-area');
    if (currentUser) {
        mydataArea.style.display = '';
    } else {
        mydataArea.style.display = 'none';
    }

    // Reset data display
    document.getElementById('info-user-data').style.display = 'none';

    // Spawn particles
    spawnInfoParticles();

    // GSAP animation timeline
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    // Logo glow pulse
    tl.fromTo('#info-logo-glow',
        { scale: 0, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.8 }
    );

    // Title entrance
    tl.fromTo('#info-title',
        { y: -40, opacity: 0, scale: 0.8 },
        { y: 0, opacity: 1, scale: 1, duration: 0.6 },
        '-=0.4'
    );

    // Subtitle slide up
    tl.fromTo('#info-subtitle',
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4 },
        '-=0.2'
    );

    // Version badge
    tl.fromTo('#info-version',
        { scale: 0, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.3 },
        '-=0.1'
    );

    // Divider expand
    tl.fromTo('#info-divider',
        { scaleX: 0, opacity: 0 },
        { scaleX: 1, opacity: 1, duration: 0.5 },
        '-=0.1'
    );

    // Cards stagger
    tl.fromTo('.info-card',
        { y: 40, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, stagger: 0.15 },
        '-=0.2'
    );

    // Data button area
    if (currentUser) {
        tl.fromTo('#info-mydata-area',
            { y: 30, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.4 },
            '-=0.1'
        );
    }

    // Continuous glow pulse
    gsap.to('#info-logo-glow', {
        scale: 1.1, opacity: 0.6, duration: 2,
        yoyo: true, repeat: -1, ease: 'sine.inOut'
    });
}

function spawnInfoParticles() {
    const container = document.getElementById('info-particles');
    container.innerHTML = '';

    for (let i = 0; i < 30; i++) {
        const p = document.createElement('div');
        p.className = 'info-particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.top = Math.random() * 100 + '%';
        container.appendChild(p);

        gsap.fromTo(p,
            { opacity: 0, scale: 0 },
            {
                opacity: Math.random() * 0.5 + 0.2,
                scale: Math.random() * 1.5 + 0.5,
                duration: Math.random() * 2 + 1,
                delay: Math.random() * 1.5,
                ease: 'power2.out'
            }
        );

        gsap.to(p, {
            y: (Math.random() - 0.5) * 80,
            x: (Math.random() - 0.5) * 80,
            duration: Math.random() * 6 + 4,
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut',
            delay: Math.random() * 2
        });
    }
}

async function showUserData() {
    const container = document.getElementById('info-user-data');
    container.style.display = 'flex';
    container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-secondary"></div><span class="text-muted ms-2">Daten werden geladen...</span></div>';

    try {
        const [profileRes, regsRes] = await Promise.all([
            fetch('/auth/me'),
            fetch('/api/user/registrations')
        ]);

        const profile = await profileRes.json();
        const registrations = await regsRes.json();

        if (!profile) {
            container.innerHTML = '<div class="alert alert-warning">Nicht eingeloggt.</div>';
            return;
        }

        container.innerHTML = `
            <div class="glass-card p-4 text-start" id="info-data-card">
                <h4 class="mb-3"><i class="bi bi-database me-2" style="color:var(--accent-light);"></i>Deine gespeicherten Daten</h4>

                <div class="info-data-group">
                    <h6><i class="bi bi-person-fill me-1"></i>Profildaten</h6>
                    <table class="table table-dark table-sm">
                        <tbody>
                            <tr><td class="text-muted" style="width:35%;">Discord ID</td><td><code>${escapeHtml(profile.id)}</code></td></tr>
                            <tr><td class="text-muted">Username</td><td>${escapeHtml(profile.username)}</td></tr>
                            <tr><td class="text-muted">Anzeigename</td><td>${escapeHtml(profile.displayName)}</td></tr>
                            <tr><td class="text-muted">Avatar-URL</td><td style="word-break:break-all;"><small>${escapeHtml(profile.avatar)}</small></td></tr>
                            <tr><td class="text-muted">Rollen</td><td><code>${profile.roles ? profile.roles.length + ' Rollen' : '0'}</code></td></tr>
                            <tr><td class="text-muted">Admin</td><td>${profile.isAdmin ? '<span class="text-success">Ja</span>' : '<span class="text-muted">Nein</span>'}</td></tr>
                        </tbody>
                    </table>
                </div>

                <div class="info-data-group mt-3">
                    <h6><i class="bi bi-card-checklist me-1"></i>Event-Registrierungen (${Array.isArray(registrations) ? registrations.length : 0})</h6>
                    ${Array.isArray(registrations) && registrations.length > 0 ? `
                        <div class="table-responsive">
                            <table class="table table-dark table-sm">
                                <thead>
                                    <tr>
                                        <th>Event</th>
                                        <th>Status</th>
                                        <th>Datum</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${registrations.map(reg => `
                                        <tr>
                                            <td>${escapeHtml(reg.event ? reg.event.title : 'Unbekannt')}</td>
                                            <td><span class="badge-pill status-${reg.status}">${escapeHtml(reg.status)}</span></td>
                                            <td><small>${new Date(reg.createdAt).toLocaleDateString('de-DE')}</small></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : '<p class="text-muted"><small>Keine Registrierungen vorhanden.</small></p>'}
                </div>

                <div class="info-data-note mt-3">
                    <i class="bi bi-info-circle me-1"></i>
                    <small class="text-muted">Diese Daten werden auf dem Server gespeichert, um die Event-Verwaltung zu ermöglichen. Session-Daten werden nach 24 Stunden automatisch gelöscht.</small>
                </div>
            </div>
        `;

        gsap.fromTo('#info-data-card',
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }
        );
    } catch {
        container.innerHTML = '<div class="alert alert-danger">Fehler beim Laden der Daten.</div>';
    }
}

// Attach event listener for data button
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('info-show-data-btn');
    if (btn) {
        btn.addEventListener('click', showUserData);
    }
});
