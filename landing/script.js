// ============================================
// DEMS Landing Page - JavaScript
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    initMobileMenu();
    initGalleryTabs();
    initScrollAnimations();
    initSmoothScroll();
    initLightbox();
});

// ============================================
// Navbar Scroll Effect
// ============================================

function initNavbar() {
    const navbar = document.getElementById('navbar');
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.scrollY;

        if (currentScroll > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        lastScroll = currentScroll;
    });
}

// ============================================
// Mobile Menu
// ============================================

function initMobileMenu() {
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');

    if (!toggle || !links) return;

    toggle.addEventListener('click', () => {
        links.classList.toggle('open');
        toggle.classList.toggle('active');
    });

    links.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            links.classList.remove('open');
            toggle.classList.remove('active');
        });
    });
}

// ============================================
// Gallery Tab Filtering
// ============================================

function initGalleryTabs() {
    const tabs = document.querySelectorAll('.gallery-tab');
    const items = document.querySelectorAll('.gallery-item');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const category = tab.dataset.tab;

            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            items.forEach(item => {
                if (item.dataset.category === category) {
                    item.classList.remove('hidden');
                    item.style.opacity = '0';
                    item.style.transform = 'translateY(10px)';
                    requestAnimationFrame(() => {
                        item.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
                        item.style.opacity = '1';
                        item.style.transform = 'translateY(0)';
                    });
                } else {
                    item.classList.add('hidden');
                }
            });
        });
    });

    // Initialize: show first tab
    if (tabs.length > 0) {
        tabs[0].click();
    }
}

// ============================================
// Scroll Animations (Intersection Observer)
// ============================================

function initScrollAnimations() {
    const animatedElements = document.querySelectorAll(
        '.feature-card, .security-card, .gallery-item, .tech-category, .beta-card, .section-header'
    );

    animatedElements.forEach(el => {
        el.classList.add('fade-in');
    });

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry, index) => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        entry.target.classList.add('visible');
                    }, index * 60);
                    observer.unobserve(entry.target);
                }
            });
        },
        {
            threshold: 0.1,
            rootMargin: '0px 0px -40px 0px'
        }
    );

    animatedElements.forEach(el => observer.observe(el));
}

// ============================================
// Smooth Scroll for Anchor Links
// ============================================

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                const offset = 80;
                const top = target.getBoundingClientRect().top + window.scrollY - offset;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        });
    });
}

// ============================================
// Lightbox
// ============================================

function initLightbox() {
    // Create lightbox DOM
    const lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.innerHTML = `
        <div class="lb-backdrop"></div>
        <button class="lb-close" aria-label="Schließen"><i class="fas fa-times"></i></button>
        <button class="lb-prev" aria-label="Zurück"><i class="fas fa-chevron-left"></i></button>
        <div class="lb-img-wrap"><img class="lb-img" src="" alt=""></div>
        <button class="lb-next" aria-label="Weiter"><i class="fas fa-chevron-right"></i></button>
        <span class="lb-label"></span>
    `;
    document.body.appendChild(lb);

    let items = [];
    let current = 0;

    function getVisibleItems() {
        return [...document.querySelectorAll('.gallery-item:not(.hidden)')];
    }

    function open(index) {
        items = getVisibleItems();
        current = index;
        show();
        lb.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function close() {
        lb.classList.remove('active');
        document.body.style.overflow = '';
    }

    function show() {
        const item = items[current];
        const img = item.querySelector('img');
        lb.querySelector('.lb-img').src = img.src;
        lb.querySelector('.lb-img').alt = img.alt;
        lb.querySelector('.lb-label').textContent = item.querySelector('.gallery-label')?.textContent || '';
        lb.querySelector('.lb-prev').style.display = items.length > 1 ? '' : 'none';
        lb.querySelector('.lb-next').style.display = items.length > 1 ? '' : 'none';
    }

    function prev() { current = (current - 1 + items.length) % items.length; show(); }
    function next() { current = (current + 1) % items.length; show(); }

    // Click on gallery preview opens lightbox
    document.querySelector('.gallery-grid').addEventListener('click', (e) => {
        const preview = e.target.closest('.gallery-preview');
        if (!preview) return;
        const visibleItems = getVisibleItems();
        const item = preview.closest('.gallery-item');
        const index = visibleItems.indexOf(item);
        if (index !== -1) open(index);
    });

    lb.querySelector('.lb-backdrop').addEventListener('click', close);
    lb.querySelector('.lb-close').addEventListener('click', close);
    lb.querySelector('.lb-prev').addEventListener('click', prev);
    lb.querySelector('.lb-next').addEventListener('click', next);

    document.addEventListener('keydown', (e) => {
        if (!lb.classList.contains('active')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') prev();
        if (e.key === 'ArrowRight') next();
    });
}

// ============================================
// Copy .env to Clipboard
// ============================================

function copyEnv(btn) {
    const code = document.getElementById('env-code').innerText;
    navigator.clipboard.writeText(code).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i> Kopiert!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-copy"></i> Kopieren';
            btn.classList.remove('copied');
        }, 2000);
    });
}
