/**
 * Client side of the official plugin „Event-Feedback“.
 *
 * One page `#p/event-feedback[/<eventId>]` for every member: with an event id
 * the feedback form, without it the open feedbacks and the member's own
 * answers; admins first see the summary and switch to their own feedback.
 * The tab badge counts open feedbacks. Markup lives in `assets/view.js`.
 */
import { renderAdminSwitch, renderForm, renderMine, renderStars, renderSummary } from './assets/view.js';

const COMMENT_MAX = 1000;

/**
 * @param {object} ui -> Plugin UI API of the host (`public/js/core/plugins.js`).
 * @returns {void}
 */
export function register(ui) {
    const isAdmin = ui.user.isAdmin;
    const view = {
        shown: false,
        eventId: '',
        tab: isAdmin ? 'summary' : 'mine',
        entry: null,
        rating: 0,
        mine: { open: [], done: [] },
        summary: null,
        openId: '',
        detail: null,
        error: '',
        busy: false
    };

    const toastError = (err) => ui.helpers.showToast(err.message, 'danger');
    const element = (id) => document.getElementById(id);
    const fieldValue = (id) => {
        const field = element(id);
        return field ? String(field.value || '') : '';
    };

    async function refreshBadge() {
        const mine = await ui.api.get('/mine');
        view.mine = { open: Array.isArray(mine && mine.open) ? mine.open : [], done: Array.isArray(mine && mine.done) ? mine.done : [] };
        ui.setTabBadge(view.mine.open.length);
    }

    async function loadData() {
        view.error = '';
        if (view.eventId) {
            view.entry = await ui.api.get(`/events/${encodeURIComponent(view.eventId)}/mine`);
            view.rating = view.entry.answer ? view.entry.answer.rating : 0;
            return;
        }
        if (isAdmin && view.tab === 'summary') {
            view.summary = await ui.api.get('/summary');
            return;
        }
        await refreshBadge();
    }

    function draw() {
        const page = view.shown ? element('ef-page') : null;
        if (!page) return;
        if (view.error) {
            page.innerHTML = ui.helpers.emptyState({ icon: 'chat-heart', title: view.error, text: '' });
            return;
        }
        if (view.eventId && view.entry) {
            page.innerHTML = renderForm(view.entry, ui.helpers, { rating: view.rating });
            return;
        }
        const head = isAdmin ? renderAdminSwitch(view.tab) : '';
        const body = isAdmin && view.tab === 'summary'
            ? renderSummary(view.summary, ui.helpers, { openId: view.openId, detail: view.detail })
            : renderMine(view.mine, ui.helpers);
        page.innerHTML = head + body;
        ui.helpers.applyStyleData(page);
    }

    async function reload() {
        try {
            await loadData();
        } catch (err) {
            view.error = err.message;
        }
        draw();
    }

    // One request at a time: a double click must not send the same answer twice
    async function once(work) {
        if (view.busy) return;
        view.busy = true;
        try {
            await work();
        } catch (err) {
            toastError(err);
        } finally {
            view.busy = false;
        }
    }

    function pickStar(target) {
        const rating = Number(target?.dataset?.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;
        view.rating = rating;
        const stars = element('ef-stars');
        if (stars) stars.innerHTML = renderStars(rating, { input: true });
        // The redraw removed the pressed button: keep the keyboard on the same star
        element(`ef-star-${rating}`)?.focus();
    }

    function countComment(target) {
        const counter = element('ef-count');
        if (counter) counter.textContent = `${String(target?.value || '').length} / ${COMMENT_MAX}`;
    }

    function sendAnswer() {
        if (!view.eventId) return undefined;
        return once(async () => {
            await ui.api.put(`/events/${encodeURIComponent(view.eventId)}/mine`, { rating: view.rating, comment: fieldValue('ef-comment') });
            ui.helpers.showToast('Danke für dein Feedback!', 'success');
            await refreshBadge();
            await reload();
            element('ef-send')?.focus();
        });
    }

    function showTab(target) {
        const next = target?.dataset?.tab;
        if (next !== 'summary' && next !== 'mine') return undefined;
        view.tab = next;
        view.openId = '';
        view.detail = null;
        return reload().then(() => element(`ef-tab-${next}`)?.focus());
    }

    function openEvent(target) {
        const id = target?.dataset?.id;
        if (!id) return undefined;
        if (view.openId === id) {
            view.openId = '';
            view.detail = null;
            draw();
            element(`ef-open-${id}`)?.focus();
            return undefined;
        }
        return once(async () => {
            view.detail = await ui.api.get(`/events/${encodeURIComponent(id)}/summary`);
            view.openId = id;
            draw();
            element(`ef-open-${id}`)?.focus();
        });
    }

    ui.actions.register({ pickStar, countComment, sendAnswer, showTab, openEvent });

    ui.addPage({
        access: 'member',
        title: 'Feedback',
        tab: { label: 'Feedback', icon: 'bi-chat-heart' },
        async render(container, param) {
            container.innerHTML = '<div id="ef-page" class="ef-page"></div>';
            view.shown = true;
            view.eventId = typeof param === 'string' ? param : '';
            view.openId = '';
            view.detail = null;
            await reload();
        },
        leave() {
            view.shown = false;
        }
    });

    // Badge right after the login, before the tab is opened
    refreshBadge().catch(() => {});
}
