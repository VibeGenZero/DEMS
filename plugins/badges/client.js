/**
 * Client side of the official plugin „Badges“: the admin page.
 *
 * Admins create, edit and delete badges, look at the holders, award a badge
 * by member search, take it back and retry roles that could not be given.
 * Markup lives in `assets/view.js`; everything else comes through `ui`.
 */
import {
    renderAwardSearch,
    renderBadgeCards,
    renderEditor,
    renderHolders,
    renderPage,
    renderSearchResults
} from './assets/view.js';

const SEARCH_DELAY_MS = 300;

/**
 * @param {object} ui -> Plugin UI API of the host (`public/js/core/plugins.js`).
 * @returns {void}
 */
export function register(ui) {
    const view = {
        shown: false,
        badges: [],
        meta: { icons: [], categories: [], roles: [], eventRoleIds: [] },
        editing: null,
        open: null,
        holders: [],
        busy: false
    };
    let searchTimer = null;

    const toastError = (err) => ui.helpers.showToast(err.message, 'danger');
    const element = (id) => document.getElementById(id);
    const fieldValue = (id) => {
        const field = element(id);
        return field ? String(field.value || '') : '';
    };
    const badgeById = (id) => view.badges.find(badge => badge.id === id) || null;

    function details() {
        if (!view.open) return {};
        const badge = badgeById(view.open.id);
        if (!badge) return {};
        const html = view.open.kind === 'holders'
            ? renderHolders(badge, view.holders, ui.helpers)
            : renderAwardSearch(badge, ui.helpers);
        return { [badge.id]: html };
    }

    function draw() {
        const page = view.shown ? element('bd-page') : null;
        if (!page) return;
        const editing = view.editing === 'new' ? null : badgeById(view.editing);
        element('bd-editor').innerHTML = view.editing ? renderEditor(editing, view.meta, ui.helpers) : '';
        element('bd-list').innerHTML = renderBadgeCards(view.badges, view.meta, ui.helpers, details());
        ui.helpers.applyStyleData(page);
    }

    async function loadBadges() {
        const badges = await ui.api.get('/badges');
        view.badges = Array.isArray(badges) ? badges : [];
        if (view.open && view.open.kind === 'holders' && badgeById(view.open.id)) {
            view.holders = await ui.api.get(`/badges/${encodeURIComponent(view.open.id)}/holders`);
        }
    }

    async function reload() {
        try {
            await loadBadges();
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

    function readEditor() {
        const type = fieldValue('bd-rule') || 'manual';
        const icon = view.meta.icons.find(name => element(`bd-icon-${name}`)?.checked === true) || '';
        const rule = type === 'manual'
            ? { type }
            : { type, count: Number(fieldValue('bd-count')), category: fieldValue('bd-category') || null };
        return {
            name: fieldValue('bd-name'),
            description: fieldValue('bd-description'),
            icon,
            color: fieldValue('bd-color'),
            rule,
            roleId: fieldValue('bd-role') || null
        };
    }

    function newBadge() {
        view.editing = 'new';
        draw();
        element('bd-name')?.focus();
    }

    function editBadge(target) {
        const badge = badgeById(target?.dataset?.id);
        if (!badge) return;
        view.editing = badge.id;
        draw();
        element('bd-name')?.focus();
    }

    function cancelEdit() {
        view.editing = null;
        draw();
    }

    function changeRuleType() {
        ui.helpers.toggleElement(element('bd-count-row'), fieldValue('bd-rule') !== 'manual');
    }

    function changeRole() {
        const roleId = fieldValue('bd-role');
        ui.helpers.toggleElement(element('bd-role-hint'), Boolean(roleId) && view.meta.eventRoleIds.includes(roleId));
    }

    function saveBadge() {
        return once(async () => {
            const body = readEditor();
            if (view.editing === 'new') await ui.api.post('/badges', body);
            else await ui.api.put(`/badges/${encodeURIComponent(view.editing)}`, body);
            view.editing = null;
            ui.helpers.showToast('Badge gespeichert.', 'success');
            await reload();
        });
    }

    async function deleteBadge(target) {
        const badge = badgeById(target?.dataset?.id);
        if (!badge) return;
        const role = badge.roleId ? view.meta.roles.find(entry => entry.id === badge.roleId) : null;
        const holders = badge.holders === 1 ? '1 Mitglied hat' : `${badge.holders} Mitglieder haben`;
        const roleSentence = role ? ` Es wird bei allen entfernt, ebenso die Rolle „${role.name}“, wo das Badge sie vergeben hat.` : ' Es wird bei allen entfernt.';
        const confirmed = await ui.helpers.showConfirmDialog(`${holders} dieses Badge.${roleSentence}`, 'Badge löschen');
        if (!confirmed) return;
        await once(async () => {
            await ui.api.delete(`/badges/${encodeURIComponent(badge.id)}`);
            if (view.open && view.open.id === badge.id) view.open = null;
            if (view.editing === badge.id) view.editing = null;
            ui.helpers.showToast('Badge gelöscht.', 'success');
            await reload();
        });
    }

    function toggleDetail(target, kind) {
        const id = target?.dataset?.id;
        if (!badgeById(id)) return undefined;
        const same = view.open && view.open.id === id && view.open.kind === kind;
        view.open = same ? null : { id, kind };
        view.holders = [];
        if (same || kind !== 'holders') {
            draw();
            if (!same) element('bd-search')?.focus();
            return undefined;
        }
        return reload();
    }

    const showHolders = (target) => toggleDetail(target, 'holders');
    const showAward = (target) => toggleDetail(target, 'award');

    function revokeAward(target) {
        const { id, user } = target?.dataset || {};
        if (!id || !user) return undefined;
        return once(async () => {
            await ui.api.delete(`/badges/${encodeURIComponent(id)}/awards/${encodeURIComponent(user)}`);
            ui.helpers.showToast('Badge entzogen.', 'success');
            await reload();
        });
    }

    function searchMembers(target) {
        clearTimeout(searchTimer);
        const badgeId = target?.dataset?.id;
        const query = String(target?.value || '').trim();
        searchTimer = setTimeout(async () => {
            const results = element('bd-results');
            if (!results) return;
            if (query.length < 2) {
                results.innerHTML = '';
                return;
            }
            try {
                const hits = await ui.api.get(`/members?q=${encodeURIComponent(query)}`);
                const current = element('bd-results');
                if (current) current.innerHTML = renderSearchResults(badgeId, hits, ui.helpers);
            } catch (err) {
                toastError(err);
            }
        }, SEARCH_DELAY_MS);
    }

    function awardMember(target) {
        const { id, user } = target?.dataset || {};
        if (!id || !user) return undefined;
        return once(async () => {
            await ui.api.post(`/badges/${encodeURIComponent(id)}/awards`, { userId: user });
            ui.helpers.showToast('Badge vergeben.', 'success');
            view.open = null;
            await reload();
        });
    }

    function retryRoles(target) {
        const id = target?.dataset?.id;
        if (!id) return undefined;
        return once(async () => {
            const { queued } = await ui.api.post(`/badges/${encodeURIComponent(id)}/roles/retry`, {});
            ui.helpers.showToast(queued === 1 ? 'Rolle wird erneut vergeben.' : `${queued} Rollen werden erneut vergeben.`, 'info');
            await reload();
        });
    }

    ui.actions.register({
        newBadge, editBadge, cancelEdit, saveBadge, deleteBadge, changeRuleType, changeRole,
        showHolders, showAward, revokeAward, searchMembers, awardMember, retryRoles
    });

    ui.addPage({
        access: 'admin',
        title: 'Badges',
        tab: { label: 'Badges', icon: 'bi-award' },
        async render(container) {
            container.innerHTML = `<div id="bd-page" class="bd-page">${renderPage()}</div>`;
            view.shown = true;
            view.editing = null;
            view.open = null;
            try {
                const [meta] = await Promise.all([ui.api.get('/meta'), loadBadges()]);
                view.meta = { ...view.meta, ...(meta || {}) };
                draw();
            } catch (err) {
                toastError(err);
            }
        },
        leave() {
            view.shown = false;
            clearTimeout(searchTimer);
        }
    });
}
