/**
 * Debug styling guide (#debug).
 */

export function showDebugSection() {
    if (!window.DEBUG_MODE) return;
    const section = document.getElementById('debug-section');
    section.style.display = 'block';

    // ── 1. Farben ──────────────────────────────────
    const colorVars = [
        { name: '--bg-primary',     label: 'bg-primary' },
        { name: '--bg-secondary',   label: 'bg-secondary' },
        { name: '--bg-card',        label: 'bg-card' },
        { name: '--bg-glass',       label: 'bg-glass' },
        { name: '--accent',         label: 'accent' },
        { name: '--accent-light',   label: 'accent-light' },
        { name: '--accent-dark',    label: 'accent-dark' },
        { name: '--danger',         label: 'danger' },
        { name: '--success',        label: 'success' },
        { name: '--warning',        label: 'warning' },
        { name: '--info',           label: 'info' },
        { name: '--text-primary',   label: 'text-primary' },
        { name: '--text-secondary', label: 'text-secondary' },
        { name: '--text-muted',     label: 'text-muted' },
        { name: '--border-subtle',  label: 'border-subtle' },
        { name: '--border-accent',  label: 'border-accent' },
    ];
    const root = getComputedStyle(document.documentElement);
    document.getElementById('sg-colors').innerHTML = colorVars.map(c => {
        const val = root.getPropertyValue(c.name).trim();
        return `
      <div class="sg-color-swatch">
        <div class="sg-color-block" style="background:var(${c.name});"></div>
        <div class="sg-color-name">${c.label}</div>
        <div class="sg-color-val">${val}</div>
      </div>`;
    }).join('');

    // ── 2. Buttons ─────────────────────────────────
    const btns = [
        { cls: 'btn-primary',          label: 'btn-primary' },
        { cls: 'btn-outline-primary',  label: 'outline-primary' },
        { cls: 'btn-accent',           label: 'btn-accent' },
        { cls: 'btn-outline-secondary',label: 'outline-secondary' },
        { cls: 'btn-outline-light',    label: 'outline-light' },
        { cls: 'btn-danger',           label: 'btn-danger' },
        { cls: 'btn-outline-danger',   label: 'outline-danger' },
        { cls: 'btn-discord',          label: 'btn-discord' },
        { cls: 'btn-primary btn-sm',   label: 'btn-sm' },
        { cls: 'btn-primary btn-lg',   label: 'btn-lg' },
    ];
    document.getElementById('sg-buttons').innerHTML = btns.map(b =>
        `<button class="btn ${b.cls}">${b.label}</button>`
    ).join('');

    // ── 3. Badges & Pills ──────────────────────────
    const badges = [
        { cls: 'badge-pill status-pending',    label: '⏳ Ausstehend' },
        { cls: 'badge-pill status-accepted',   label: '✅ Angenommen' },
        { cls: 'badge-pill status-rejected',   label: '❌ Abgelehnt' },
        { cls: 'badge-pill status-waitlisted', label: '📋 Warteliste' },
        { cls: 'badge text-bg-primary',        label: 'primary' },
        { cls: 'badge text-bg-secondary',      label: 'secondary' },
        { cls: 'badge text-bg-success',        label: 'success' },
        { cls: 'badge text-bg-danger',         label: 'danger' },
        { cls: 'badge text-bg-warning',        label: 'warning' },
        { cls: 'badge text-bg-info',           label: 'info' },
    ];
    document.getElementById('sg-badges').innerHTML = badges.map(b =>
        `<span class="${b.cls}">${b.label}</span>`
    ).join('');

    // ── 4. Cards ───────────────────────────────────
    document.getElementById('sg-cards').innerHTML = `
      <div class="row g-3 mb-4">
        <div class="col-md-4">
          <div class="glass-card p-4"><div class="fw-semibold mb-1">glass-card</div><small class="text-muted">Standard-Kartenstil mit Glassmorphism</small></div>
        </div>
        <div class="col-md-4">
          <div class="stat-card">
            <div class="stat-icon"><i class="bi bi-star" style="color:var(--accent);"></i></div>
            <div class="stat-value">42</div>
            <div class="stat-label">stat-card</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="profile-reg-card">
            <div class="profile-reg-info">
              <h6>profile-reg-card</h6>
              <small>Kategorie · 01. Jan 2026</small>
            </div>
            <span class="badge-pill status-accepted">✅ Angenommen</span>
          </div>
        </div>
        <div class="col-md-4">
          <div class="profile-badge-card unlocked p-3 text-center">
            <div style="font-size:2rem;">🏆</div>
            <div class="fw-semibold mt-1">badge-card</div>
            <small class="text-muted">unlocked</small>
          </div>
        </div>
        <div class="col-md-4">
          <div class="profile-badge-card locked p-3 text-center">
            <div style="font-size:2rem;">🔒</div>
            <div class="fw-semibold mt-1">badge-card</div>
            <small class="text-muted">locked</small>
          </div>
        </div>
      </div>`;

    // ── 5. Spinners ────────────────────────────────
    document.getElementById('sg-spinners').innerHTML = `
      <div class="spinner-border spinner-border-sm text-secondary" title="spinner-border sm"></div>
      <div class="spinner-border" style="color:var(--accent);" title="spinner-border md"></div>
      <div class="spinner-grow spinner-grow-sm text-success" title="spinner-grow sm"></div>
      <div class="spinner-grow text-warning" title="spinner-grow md"></div>`;

    // ── 6. Alerts ──────────────────────────────────
    document.getElementById('sg-alerts').innerHTML = `
      <div class="alert alert-success mb-2">✅ alert-success — Aktion erfolgreich abgeschlossen.</div>
      <div class="alert alert-warning mb-2">⚠️ alert-warning — Bitte beachte diesen Hinweis.</div>
      <div class="alert alert-danger mb-2">❌ alert-danger — Ein Fehler ist aufgetreten.</div>
      <div class="alert alert-info mb-0">ℹ️ alert-info — Informationstext für den Nutzer.</div>`;

    // ── 7. Animationen ─────────────────────────────
    const animations = [
        { label: 'Fade In',  fn: () => gsap.fromTo('.sg-anim-demo-item', { opacity: 0 }, { opacity: 1, duration: 0.6, stagger: 0.1 }) },
        { label: 'Slide Up', fn: () => gsap.fromTo('.sg-anim-demo-item', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: 'power3.out' }) },
        { label: 'Stagger',  fn: () => gsap.from('.sg-anim-demo-item', { scale: 0.8, opacity: 0, duration: 0.4, stagger: 0.15, ease: 'back.out(1.7)' }) },
        { label: 'Bounce',   fn: () => gsap.from('.sg-anim-demo-item', { y: -30, duration: 0.5, stagger: 0.1, ease: 'bounce.out' }) },
        { label: 'Shake',    fn: () => gsap.to('.sg-anim-demo-item', { x: 10, duration: 0.07, repeat: 5, yoyo: true, ease: 'power1.inOut', stagger: 0.05 }) },
        { label: 'Pulse',    fn: () => gsap.to('.sg-anim-demo-item', { scale: 1.05, duration: 0.3, repeat: 3, yoyo: true, ease: 'power1.inOut', stagger: 0.1 }) },
    ];
    document.getElementById('sg-anim-buttons').innerHTML = animations.map((a, i) =>
        `<button class="btn btn-outline-secondary btn-sm" onclick="sgRunAnimation(${i})">${a.label}</button>`
    ).join('');
    window._sgAnimations = animations;

    // ── 8. Icons ───────────────────────────────────
    const icons = [
        'calendar-event','calendar-check','calendar-x','people','person','person-fill',
        'gear','gear-fill','star','star-fill','trophy','trophy-fill',
        'check-circle','check-circle-fill','x-circle','x-circle-fill',
        'exclamation-triangle','exclamation-triangle-fill','info-circle','info-circle-fill',
        'bell','bell-fill','chat-dots','chat-dots-fill','discord','robot',
        'moon-stars','moon-stars-fill','sun','lightning','lightning-fill',
        'list-check','journal-text','inbox','hourglass-split','shield-check',
        'bug','bug-fill','palette','palette-fill','code-slash','terminal',
    ];
    document.getElementById('sg-icons').innerHTML = icons.map(ic =>
        `<div class="sg-icon-item" title="bi-${ic}">
          <i class="bi bi-${ic}"></i>
          <span>${ic}</span>
        </div>`
    ).join('');

    // Animate section entrance
    if (typeof gsap !== 'undefined') {
        gsap.from('.sg-section-title', { y: 15, opacity: 0, duration: 0.3, stagger: 0.05, ease: 'power3.out' });
    }
}

export function sgRunAnimation(index) {
    if (window._sgAnimations && window._sgAnimations[index]) {
        window._sgAnimations[index].fn();
    }
}

// Temporary bridge for inline handlers; D-01 replaces them with data-click and removes it
Object.assign(window, { sgRunAnimation });
