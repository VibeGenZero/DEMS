/**
 * Page "Was ist neu" (#news, D-13): every release, newest first. Public like
 * #info; opening it marks the current version as read (unread dot on Info).
 */
import { registerActions } from '../core/actions.js';
import { emptyState } from '../core/components.js';
import { getNews, markNewsRead } from '../core/updates.js';
import { renderReleaseList } from './news-view.js';

/**
 * Show the page and render all releases.
 *
 * @returns {Promise<void>}
 */
export async function showNewsSection() {
    document.getElementById('news-section').style.display = 'block';
    const list = document.getElementById('news-list');
    const { version, releases } = await getNews();
    if (!version) {
        list.innerHTML = emptyState({
            icon: 'exclamation-triangle',
            title: 'Neuigkeiten konnten nicht geladen werden',
            action: '<button type="button" class="btn btn-secondary btn-sm" data-click="reloadNews">Erneut versuchen</button>'
        });
        return;
    }
    list.innerHTML = renderReleaseList(releases);
    markNewsRead(version);
}

registerActions({ reloadNews: () => showNewsSection() });
