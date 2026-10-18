/**
 * Info page and "Meine Daten".
 */
import { state } from '../core/state.js';
import { escapeHtml, showElement } from '../core/ui.js';

export function showInfoSection() {
    document.getElementById('info-section').style.display = 'block';

    // Show data button only if logged in
    const mydataArea = document.getElementById('info-mydata-area');
    if (state.currentUser) {
        showElement(mydataArea);
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
    if (state.currentUser) {
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

export function spawnInfoParticles() {
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

export async function showUserData() {
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
                <h4 class="mb-3"><i class="bi bi-database me-2 text-accent"></i>Deine gespeicherten Daten</h4>

                <div class="info-data-group">
                    <h6><i class="bi bi-person-fill me-1"></i>Profildaten</h6>
                    <table class="table table-sm">
                        <tbody>
                            <tr><td class="text-muted info-data-key">Discord ID</td><td><code>${escapeHtml(profile.id)}</code></td></tr>
                            <tr><td class="text-muted">Username</td><td>${escapeHtml(profile.username)}</td></tr>
                            <tr><td class="text-muted">Anzeigename</td><td>${escapeHtml(profile.displayName)}</td></tr>
                            <tr><td class="text-muted">Avatar-URL</td><td class="info-data-long"><small>${escapeHtml(profile.avatar)}</small></td></tr>
                            <tr><td class="text-muted">Rollen</td><td><code>${profile.roles ? profile.roles.length + ' Rollen' : '0'}</code></td></tr>
                            <tr><td class="text-muted">Admin</td><td>${profile.isAdmin ? '<span class="text-success">Ja</span>' : '<span class="text-muted">Nein</span>'}</td></tr>
                        </tbody>
                    </table>
                </div>

                <div class="info-data-group mt-3">
                    <h6><i class="bi bi-card-checklist me-1"></i>Event-Registrierungen (${Array.isArray(registrations) ? registrations.length : 0})</h6>
                    ${Array.isArray(registrations) && registrations.length > 0 ? `
                        <div class="table-responsive">
                            <table class="table table-sm">
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
