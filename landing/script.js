// ============================================
// DEMS Landing Page - JavaScript
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    initMobileMenu();
    initGalleryTabs();
    initScrollAnimations();
    initSmoothScroll();
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
