/**
 * Colour scheme: light, dark or system (default). The choice lives in this
 * browser only (localStorage.dems_theme); the scheme is the attribute
 * data-bs-theme on <html>, which drives Bootstrap and the tokens in
 * tokens.css. public/theme-boot.js sets it before the first paint with the
 * same rules as resolveTheme() (test/theme.test.js keeps both equal).
 */
import { registerActions } from './actions.js';

export const THEME_STORAGE_KEY = 'dems_theme';
export const THEME_CHOICES = ['light', 'dark', 'system'];
const LIGHT_QUERY = '(prefers-color-scheme: light)';

const themeListeners = [];
// Choice of this page while the storage is blocked; null = none made
let pageChoice = null;

/**
 * @param {*} value -> Stored or chosen value.
 * @returns {'light'|'dark'|'system'} -> The value if it is one of the three choices, else 'system'.
 */
export function normalizeThemeChoice(value) {
    return THEME_CHOICES.includes(value) ? value : 'system';
}

/**
 * @param {string} choice -> 'light', 'dark' or 'system'.
 * @param {boolean} prefersLight -> Whether the system asks for a light scheme.
 * @returns {'light'|'dark'} -> Scheme to show.
 */
export function resolveTheme(choice, prefersLight) {
    if (choice === 'light' || choice === 'dark') return choice;
    return prefersLight ? 'light' : 'dark';
}

/**
 * @returns {'light'|'dark'|'system'} -> Stored choice; 'system' when nothing or nonsense is stored. With a blocked storage the choice made on this page, else 'system'.
 */
export function readThemeChoice() {
    try {
        return normalizeThemeChoice(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
        return pageChoice ?? 'system';
    }
}

/**
 * Store a choice. A blocked storage keeps the choice for this page only.
 *
 * @param {string} choice -> 'light', 'dark' or 'system'.
 * @returns {void}
 */
export function saveThemeChoice(choice) {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, normalizeThemeChoice(choice));
    } catch {
        // Blocked site data: the choice holds for this page until the next reload
        pageChoice = normalizeThemeChoice(choice);
    }
}

function systemPrefersLight() {
    return typeof matchMedia === 'function' && matchMedia(LIGHT_QUERY).matches;
}

/**
 * Show a scheme at once: transitions are off for the switch (tokens.css,
 * :root.is-theme-switching) and back on two frames later.
 *
 * @param {'light'|'dark'} scheme -> Scheme to show.
 * @returns {void}
 */
export function applyTheme(scheme) {
    const root = document.documentElement;
    root.classList.add('is-theme-switching');
    root.setAttribute('data-bs-theme', scheme);
    const pickerTheme = document.getElementById('flatpickr-dark-css');
    if (pickerTheme) pickerTheme.disabled = scheme === 'light';
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('is-theme-switching')));
    for (const listener of themeListeners) listener(scheme);
}

/**
 * @param {(scheme: 'light'|'dark') => void} listener -> Called after every applied scheme.
 * @returns {void}
 */
export function onThemeChange(listener) {
    themeListeners.push(listener);
}

/**
 * Store a choice and show its scheme.
 *
 * @param {string} choice -> 'light', 'dark' or 'system'; anything else counts as 'system'.
 * @returns {void}
 */
export function setThemeChoice(choice) {
    const normalized = normalizeThemeChoice(choice);
    saveThemeChoice(normalized);
    applyTheme(resolveTheme(normalized, systemPrefersLight()));
}

/**
 * Check the profile radio of the stored choice.
 *
 * @returns {void}
 */
export function syncThemeRadios() {
    const choice = readThemeChoice();
    for (const value of THEME_CHOICES) {
        const radio = document.getElementById(`theme-choice-${value}`);
        if (radio) radio.checked = value === choice;
    }
}

/**
 * Show the stored scheme and follow the system while the choice is 'system'.
 *
 * @returns {void}
 */
export function initTheme() {
    applyTheme(resolveTheme(readThemeChoice(), systemPrefersLight()));
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(LIGHT_QUERY);
    if (typeof query.addEventListener !== 'function') return;
    query.addEventListener('change', (event) => {
        if (readThemeChoice() === 'system') applyTheme(event.matches ? 'light' : 'dark');
    });
}

registerActions({
    setThemeChoice: (el) => setThemeChoice(el.value)
});
