/**
 * Release notes (D-13): data rules and markup of the news popup and the page
 * "Was ist neu" (#news). Pure functions without DOM; core/updates.js and
 * pages/news.js use them. Styles: NEWS in style.css.
 */
import { emptyState } from '../core/components.js';
import { escapeHtml } from '../core/ui.js';

const POPUP_ENTRIES = 3;
const DASH = '–';

function cleanEntries(news) {
    return (Array.isArray(news) ? news : [])
        .filter(entry => entry && typeof entry.title === 'string' && entry.title.trim())
        .map(entry => ({
            title: entry.title.trim(),
            content: typeof entry.content === 'string' ? entry.content.trim() : '',
            highlight: entry.highlight === true
        }));
}

function cleanRelease(release) {
    return { version: String(release.version || ''), date: String(release.date || ''), news: cleanEntries(release.news) };
}

/**
 * Release notes in one shape.
 *
 * @param {*} data -> Answer of GET /api/updates: `{ version, releases: [...] }`, or the old `{ version, date, news }`.
 * @returns {{ version: string, releases: Array<{ version, date, news }> }} -> Newest release first; empty for anything else.
 */
export function normalizeReleases(data) {
    if (!data || typeof data !== 'object') return { version: '', releases: [] };
    const releases = Array.isArray(data.releases)
        ? data.releases.filter(release => release && release.version).map(cleanRelease)
        : (data.version ? [cleanRelease(data)] : []);
    return { version: String(data.version || (releases[0] && releases[0].version) || ''), releases };
}

/**
 * Entries of the popup: the top features of one release.
 *
 * @param {Object|null} release -> Normalized release.
 * @returns {Array<Object>} -> Entries marked as highlight in their order, else the first ones; at most 3.
 */
export function popupEntries(release) {
    const news = release && Array.isArray(release.news) ? release.news : [];
    const marked = news.filter(entry => entry.highlight);
    return (marked.length ? marked : news).slice(0, POPUP_ENTRIES);
}

/**
 * Release day in German.
 *
 * @param {string} iso -> `YYYY-MM-DD`.
 * @returns {string} -> "03.10.2026", or a dash.
 */
export function formatReleaseDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return match ? `${match[3]}.${match[2]}.${match[1]}` : DASH;
}

function renderEntry(entry) {
    const text = entry.content ? `<p class="news-entry-text">${escapeHtml(entry.content)}</p>` : '';
    return `<div class="news-entry"><h3 class="news-entry-title">${escapeHtml(entry.title)}</h3>${text}</div>`;
}

/**
 * Body of the news popup.
 *
 * @param {Array<Object>} entries -> Result of popupEntries().
 * @returns {string} -> HTML for #updates-content.
 */
export function renderNewsPopup(entries) {
    return (Array.isArray(entries) ? entries : []).map(renderEntry).join('');
}

/**
 * All releases for the page, the newest one open.
 *
 * @param {Array<Object>} releases -> Normalized releases, newest first.
 * @returns {string} -> HTML for #news-list.
 */
export function renderReleaseList(releases) {
    if (!Array.isArray(releases) || !releases.length) {
        return emptyState({ icon: 'stars', title: 'Noch keine Neuigkeiten' });
    }
    return releases.map((release, index) => {
        const count = release.news.length;
        return `<details class="news-release"${index === 0 ? ' open' : ''}>`
            + '<summary class="news-release-summary">'
            + `<span class="chip chip-accent">v${escapeHtml(release.version)}</span>`
            + `<span class="news-release-date">${escapeHtml(formatReleaseDate(release.date))}</span>`
            + `<span class="news-release-count">${count} ${count === 1 ? 'Neuerung' : 'Neuerungen'}</span>`
            + '<i class="bi bi-chevron-down news-release-marker" aria-hidden="true"></i>'
            + '</summary>'
            + `<div class="news-release-body">${release.news.map(renderEntry).join('')}</div>`
            + '</details>';
    }).join('');
}
