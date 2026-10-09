/**
 * Boot animation, CSRF token, server info and the startup sequence
 * (finishLoading).
 */
import { state } from './state.js';
import { checkMaintenanceStatus } from '../admin/maintenance.js';
import { checkAuth } from './auth.js';
import { handleRoute, restorePendingRoute } from './router.js';
import { getErrorMessage, showError, showToast } from './ui.js';


export function createParticles() {
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

export function runBootAnimation() {
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

export async function fetchCSRFToken() {
    try {
        const res = await fetch('/api/csrf-token');
        if (res.status === 429) {
            showToast('Zu viele Anfragen – bitte Seite in einem Moment neu laden.', 'warning');
            return;
        }
        const data = await res.json();
        state.csrfToken = data.token;
    } catch (e) {
        console.error('Failed to fetch CSRF token', e);
    }
}

export async function loadServerInfo() {
    try {
        const res = await fetch('/api/server-info');
        if (res.status === 429) return;
        const data = await res.json();
        if (window.VERBOSE_LOG) console.log('[VERBOSE] GET /api/server-info', data);
        state.serverName = data.serverName || 'DEMS';
        window._demsGuildId = data.guildId || '';
        window.DEBUG_MODE = data.debugMode === true;
        if (window.DEBUG_MODE) {
            document.getElementById('nav-debug').style.display = 'block';
        }
        if (!window.DEBUG_MODE) {
            localStorage.removeItem('dems_verbose_log');
            window.VERBOSE_LOG = false;
        }
        updateServerNameInUI();
    } catch (e) {
        console.error('Failed to fetch server info', e);
        state.serverName = 'DEMS';
    }
}

export function updateServerNameInUI() {
    // Update navbar brand
    document.querySelectorAll('.navbar-brand').forEach(el => {
        el.innerHTML = `<i class="bi bi-moon-stars-fill me-2"></i>${state.serverName}`;
    });

    // Update page title
    document.title = `DEMS — ${state.serverName} Event Management`;

    // Update meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
        metaDesc.setAttribute('content', `Dein Event-Management-System für den ${state.serverName} Server`);
    }

    // Update login card heading (if visible)
    const loginCardHeading = document.querySelector('.login-card .brand-text');
    if (loginCardHeading) {
        loginCardHeading.textContent = state.serverName;
    }

    // Update events section description
    const eventsDesc = document.querySelector('#events-section .section-header p');
    if (eventsDesc) {
        eventsDesc.textContent = `Entdecke Events vom ${state.serverName} Server und registriere dich!`;
    }
}

export async function finishLoading() {
    localStorage.setItem('dems_boot_ts', Date.now().toString());
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
    await checkMaintenanceStatus();
    restorePendingRoute();
    handleRoute();
    window.addEventListener('hashchange', handleRoute);

    gsap.from('#main-navbar', {
        y: -60, opacity: 0, duration: 0.5, ease: 'power3.out'
    });
}
