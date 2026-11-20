/**
 * Client side of the official plugin „Event einreichen“.
 *
 * Members submit event ideas and see their own list; admins review all
 * submissions, take one over into the event editor or reject it with an
 * optional reason. Markup lives in `assets/view.js`; everything else comes
 * through `ui`.
 */
import {
    CATEGORIES,
    renderAdminList,
    renderAdminTabs,
    renderOwnList,
    renderSubmitForm
} from './assets/view.js';

/**
 * @param {object} ui -> Plugin UI API of the host (`public/js/core/plugins.js`).
 * @returns {void}
 */
export function register(ui) {
    const isAdmin = ui.user.isAdmin;
    const view = {
        shown: false,
        tab: isAdmin ? 'admin' : 'submit',
        filter: 'open',
        openCount: 0,
        ownItems: [],
        adminItems: [],
        rejectingId: '',
        busy: false
    };

    const toastError = (err) => ui.helpers.showToast(err.message, 'danger');

    const fieldValue = (id) => {
        const element = document.getElementById(id);
        return element ? String(element.value || '') : '';
    };

    // Admins only: open count for the tab badge and the „Alle Vorschläge“ pill
    async function refreshCounts() {
        if (!isAdmin) return;
        const counts = await ui.api.get('/counts');
        view.openCount = Number(counts && counts.open) || 0;
        ui.setTabBadge(view.openCount);
    }

    async function loadData() {
        if (isAdmin && view.tab === 'admin') {
            const [items] = await Promise.all([ui.api.get(`/?status=${encodeURIComponent(view.filter)}`), refreshCounts()]);
            view.adminItems = Array.isArray(items) ? items : [];
        } else {
            const [own] = await Promise.all([ui.api.get('/mine'), refreshCounts()]);
            view.ownItems = Array.isArray(own) ? own : [];
        }
    }

    // Draws into #es-page, the element render() put into the container of the host
    function draw() {
        const page = view.shown ? document.getElementById('es-page') : null;
        if (!page) return;
        const tabsHtml = isAdmin ? renderAdminTabs({ tab: view.tab, openCount: view.openCount }) : '';
        const bodyHtml = isAdmin && view.tab === 'admin'
            ? renderAdminList(view.adminItems, { filter: view.filter, rejectingId: view.rejectingId }, ui.helpers)
            : renderSubmitForm(CATEGORIES, ui.helpers) + renderOwnList(view.ownItems, ui.helpers);
        page.innerHTML = tabsHtml + bodyHtml;
    }

    async function reload() {
        try {
            await loadData();
            draw();
        } catch (err) {
            toastError(err);
        }
    }

    // One request at a time: a double click must not send the same action twice
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

    function submit() {
        return once(async () => {
            await ui.api.post('/', {
                title: fieldValue('es-title'),
                description: fieldValue('es-description'),
                wishedDate: fieldValue('es-wished-date'),
                category: fieldValue('es-category')
            });
            ui.helpers.showToast('Danke! Dein Vorschlag ist eingereicht.', 'success');
            await reload();
        });
    }

    function withdraw(element) {
        const id = element?.dataset?.id;
        if (!id) return undefined;
        return once(async () => {
            await ui.api.delete(`/${encodeURIComponent(id)}`);
            ui.helpers.showToast('Vorschlag zurückgezogen.', 'success');
            await reload();
        });
    }

    function filter(element) {
        const next = element?.dataset?.filter;
        if (!next) return undefined;
        view.filter = next;
        view.rejectingId = '';
        return reload();
    }

    function showTab(element) {
        const next = element?.dataset?.tab;
        if (next !== 'admin' && next !== 'submit') return undefined;
        view.tab = next;
        view.rejectingId = '';
        return reload();
    }

    function takeOver(element) {
        const item = view.adminItems.find(entry => entry.id === element?.dataset?.id);
        if (!item) return undefined;
        return ui.openEventEditor({
            prefill: {
                title: item.title || '',
                description: item.description || '',
                category: item.category || '',
                startDate: item.wishedDate ? item.wishedDate + 'T19:00' : ''
            },
            ref: item.id
        });
    }

    function askReject(element) {
        const id = element?.dataset?.id;
        if (!id) return;
        view.rejectingId = id;
        draw();
    }

    function cancelReject() {
        view.rejectingId = '';
        draw();
    }

    function reject(element) {
        const id = element?.dataset?.id;
        if (!id) return undefined;
        return once(async () => {
            await ui.api.post(`/${encodeURIComponent(id)}/reject`, { reason: fieldValue('es-reject-reason') });
            view.rejectingId = '';
            ui.helpers.showToast('Vorschlag abgelehnt.', 'success');
            await reload();
        });
    }

    ui.actions.register({ submit, withdraw, filter, showTab, takeOver, askReject, reject, cancelReject });

    ui.addPage({
        access: 'member',
        title: 'Event einreichen',
        tab: { label: 'Event einreichen', icon: 'bi-lightbulb' },
        render(container) {
            container.innerHTML = '<div id="es-page" class="es-page"></div>';
            view.shown = true;
            view.rejectingId = '';
            return reload();
        },
        leave() {
            view.shown = false;
            view.rejectingId = '';
        }
    });

    // Badge right after the login, before the tab is opened
    if (isAdmin) refreshCounts().catch(toastError);
}
