/**
 * Pure markup of the official plugin „Event-Feedback“.
 *
 * Uses only the `helpers` of `ui.helpers` handed over by `client.js`; no DOM
 * access and no imports outside the plugin folder. Bar widths reach the page
 * only as `data-style-width` (set by `helpers.applyStyleData`).
 */

const STARS = [1, 2, 3, 4, 5];
const COMMENT_MAX = 1000;

const decimal = value => (typeof value === 'number' ? value.toFixed(1).replace('.', ',') : '–');
const STAR_ICON = '<i class="bi bi-star-fill" aria-hidden="true"></i>';

/** An average as star icon + number, with a spoken label. */
function averageMarkup(average) {
    const label = typeof average === 'number' ? `Durchschnitt ${decimal(average)} von 5 Sternen` : 'Noch keine Bewertung';
    return `<span class="ef-average" role="img" aria-label="${label}">${STAR_ICON}${decimal(average)}</span>`;
}
const answersText = count => (count === 1 ? '1 Antwort' : `${count} Antworten`);

function formatDay(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function eventLine(event, escapeHtml) {
    const day = formatDay(event.startDate);
    return `<span class="ef-event-title">${escapeHtml(event.title || '')}</span>${day ? `<span class="ef-event-day text-secondary">${escapeHtml(day)}</span>` : ''}`;
}

/**
 * Five stars: buttons to pick a rating (`input`) or read-only icons.
 *
 * @param {number} rating -> 0–5.
 * @param {{ input?: boolean }} [options]
 * @returns {string}
 */
export function renderStars(rating, { input = false } = {}) {
    const icon = n => `<i class="bi ${n <= rating ? 'bi-star-fill' : 'bi-star'}" aria-hidden="true"></i>`;
    if (!input) {
        return `<span class="ef-stars-static" role="img" aria-label="${rating} von 5 Sternen">${STARS.map(icon).join('')}</span>`;
    }
    // The id comes last in the tag (see the test DOM of test/helpers.js); focus returns to it after a pick
    return STARS.map(n => `<button type="button" class="ef-star${n <= rating ? ' is-on' : ''}" data-click="p:event-feedback:pickStar" data-rating="${n}" aria-pressed="${n === rating}" aria-label="${n === 1 ? '1 Stern' : `${n} Sterne`}" id="ef-star-${n}">${icon(n)}</button>`).join('');
}

/**
 * The form for one event (or the read-only answer outside the window).
 *
 * @param {{ event: object, editable: boolean, answer: { rating: number, comment: string }|null }} entry -> `GET /events/:id/mine`.
 * @param {object} helpers
 * @param {{ rating?: number }} [state] -> The stars picked so far.
 * @returns {string}
 */
export function renderForm(entry, helpers, { rating } = {}) {
    const { escapeHtml } = helpers;
    const answer = entry.answer;
    const picked = typeof rating === 'number' ? rating : (answer ? answer.rating : 0);
    const head = `<h4 class="ef-section-title">Wie war ${eventLine(entry.event, escapeHtml)}?</h4>`;
    if (!entry.editable) {
        const given = answer
            ? `${renderStars(answer.rating)}${answer.comment ? `<p class="ef-comment mb-0">${escapeHtml(answer.comment)}</p>` : ''}`
            : '';
        return `<section class="glass-card ef-card">${head}${given}<p class="text-secondary mb-0">Die Feedback-Zeit für dieses Event ist vorbei.</p></section>`;
    }
    const comment = answer ? answer.comment : '';
    return `<section class="glass-card ef-card">
        ${head}
        <div class="ef-stars" role="group" aria-label="Bewertung" id="ef-stars">${renderStars(picked, { input: true })}</div>
        <label class="form-label" for="ef-comment">Was war gut, was nicht? <span class="text-secondary">(optional)</span></label>
        <textarea class="form-control" rows="3" maxlength="${COMMENT_MAX}" data-input="p:event-feedback:countComment" placeholder="Dein Kommentar ist für das Team ohne Namen sichtbar." id="ef-comment">${escapeHtml(comment)}</textarea>
        <div class="ef-form-actions">
            <span class="ef-count text-secondary" id="ef-count">${comment.length} / ${COMMENT_MAX}</span>
            <button type="button" class="btn btn-primary" data-click="p:event-feedback:sendAnswer" id="ef-send"><i class="bi bi-send me-1" aria-hidden="true"></i>${answer ? 'Feedback ändern' : 'Feedback senden'}</button>
        </div>
    </section>`;
}

/**
 * The member's open feedbacks and own answers.
 *
 * @param {{ open: object[], done: object[] }} mine -> `GET /mine`.
 * @param {object} helpers
 * @returns {string}
 */
export function renderMine(mine, helpers) {
    const { escapeHtml, emptyState } = helpers;
    const link = event => `#p/event-feedback/${escapeHtml(event.id)}`;
    const open = (mine.open || []).length === 0
        ? emptyState({ icon: 'chat-heart', title: 'Gerade wartet kein Event auf dein Feedback.' })
        : `<ul class="ef-list">${mine.open.map(event => `<li class="glass-card ef-row">
            <div class="ef-row-main">${eventLine(event, escapeHtml)}</div>
            <a class="btn btn-sm btn-primary" href="${link(event)}"><i class="bi bi-chat-heart me-1" aria-hidden="true"></i>Feedback geben</a>
        </li>`).join('')}</ul>`;
    const done = (mine.done || []).length === 0 ? '' : `<h4 class="ef-section-title">Deine Bewertungen</h4>
        <ul class="ef-list">${mine.done.map(entry => `<li class="glass-card ef-row">
            <div class="ef-row-main">${eventLine(entry.event, escapeHtml)}${renderStars(entry.rating)}
                ${entry.comment ? `<p class="ef-comment mb-0">${escapeHtml(entry.comment)}</p>` : ''}</div>
            ${entry.editable ? `<a class="btn btn-sm btn-outline-secondary" href="${link(entry.event)}"><i class="bi bi-pencil me-1" aria-hidden="true"></i>Ändern</a>` : ''}
        </li>`).join('')}</ul>`;
    return `<h4 class="ef-section-title">Offen</h4>${open}${done}`;
}

function rateText({ count, eligible }) {
    if (!(eligible > 0)) return answersText(count);
    return `${count} von ${eligible} (${Math.round((count / eligible) * 100)} %)`;
}

function renderDetail(detail, escapeHtml) {
    const total = detail.count || 0;
    const bars = [5, 4, 3, 2, 1].map(stars => {
        const n = detail.distribution[stars - 1] || 0;
        const width = total ? Math.round((n / total) * 100) : 0;
        return `<div class="ef-bar"><span class="ef-bar-label" aria-label="${stars === 1 ? '1 Stern' : `${stars} Sterne`}">${stars} ${STAR_ICON}</span>
            <div class="ef-bar-track"><div class="ef-bar-fill" data-style-width="${width}"></div></div>
            <span class="ef-bar-count text-secondary">${n}</span></div>`;
    }).join('');
    const comments = (detail.comments || []).length === 0
        ? '<p class="text-secondary mb-0">Keine Kommentare.</p>'
        : `<ul class="ef-comments">${detail.comments.map(entry => `<li class="ef-comment-row">${renderStars(entry.rating)}<p class="ef-comment mb-0">${escapeHtml(entry.comment)}</p></li>`).join('')}</ul>`;
    return `<div class="ef-detail">${bars}${comments}</div>`;
}

/**
 * The admin summary: category averages, ended events with average and response rate, one opened detail.
 *
 * @param {{ events: object[], categories: object[] }} summary -> `GET /summary`.
 * @param {object} helpers
 * @param {{ openId?: string, detail?: object }} [open] -> The opened event and its `GET /events/:id/summary`.
 * @returns {string}
 */
export function renderSummary(summary, helpers, { openId, detail } = {}) {
    const { escapeHtml, emptyState } = helpers;
    if (!summary || (summary.events || []).length === 0) {
        return emptyState({ icon: 'chat-heart', title: 'Noch kein Feedback', text: 'Sobald Events vorbei sind, erscheinen hier die Bewertungen.' });
    }
    const categories = (summary.categories || []).length === 0 ? '' : `<div class="ef-categories">${summary.categories
        .map(entry => `<span class="chip chip-sm">${escapeHtml(entry.category)} ${STAR_ICON} ${decimal(entry.average)}</span>`).join('')}</div>`;
    const rows = summary.events.map(entry => {
        const isOpen = openId === entry.event.id;
        return `<li class="glass-card ef-row ef-summary-row">
            <button type="button" class="ef-summary-head" data-click="p:event-feedback:openEvent" data-id="${escapeHtml(entry.event.id)}" aria-expanded="${isOpen}" id="ef-open-${escapeHtml(entry.event.id)}">
                <span class="ef-row-main">${eventLine(entry.event, escapeHtml)}</span>
                ${averageMarkup(entry.average)}
                <span class="ef-rate text-secondary">${rateText(entry)}</span>
            </button>
            ${isOpen && detail ? renderDetail(detail, escapeHtml) : ''}
        </li>`;
    }).join('');
    return `${categories}<ul class="ef-list">${rows}</ul>`;
}

/**
 * Pills for admins: „Auswertung“ and „Mein Feedback“.
 *
 * @param {'summary'|'mine'} tab
 * @returns {string}
 */
export function renderAdminSwitch(tab) {
    const pill = (key, icon, label) => `<li class="nav-item" role="presentation">
        <button type="button" class="nav-link${tab === key ? ' active' : ''}" role="tab" aria-selected="${tab === key}" data-click="p:event-feedback:showTab" data-tab="${key}" id="ef-tab-${key}">
            <i class="bi ${icon} me-1" aria-hidden="true"></i>${label}
        </button></li>`;
    return `<ul class="nav nav-pills ef-tabs" role="tablist">${pill('summary', 'bi-bar-chart', 'Auswertung')}${pill('mine', 'bi-chat-heart', 'Mein Feedback')}</ul>`;
}
