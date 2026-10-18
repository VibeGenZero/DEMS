/**
 * Sets the colour scheme before the first paint, so a light choice never
 * flashes dark. A classic script in <head>: ES modules run too late.
 * Same rules as resolveTheme() in js/core/theme.js (test/theme.test.js
 * keeps both equal): 'light' or 'dark' as stored, anything else follows
 * the system.
 */
(function () {
    var stored = null;
    try {
        stored = localStorage.getItem('dems_theme');
    } catch (err) {
        stored = null;
    }
    var prefersLight = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
    var picked = stored === 'light' || stored === 'dark' ? stored : (prefersLight ? 'light' : 'dark');
    document.documentElement.setAttribute('data-bs-theme', picked);
})();
