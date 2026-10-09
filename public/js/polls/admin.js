/**
 * Date polls for admins: editor, announce, close, delete, decide.
 */
import { state } from '../core/state.js';
import { showCreateEventModal, wizardGoTo } from '../admin/wizard.js';
import { navigateTo } from '../core/router.js';
import { escapeHtml, showConfirmDialog, showToast } from '../core/ui.js';
import { DEFAULT_POLL_LABELS, formatPollOptionLabel, getPollLabels, renderPollCounts, showPollDetail } from './polls.js';

export let pollDeadlinePicker = null;

export const POLL_PICKER_CONFIG = { enableTime: true, dateFormat: 'Y-m-d H:i', time_24hr: true, locale: 'de' };

export async function renderPollRoleCheckboxes(selected, containerId = 'poll-role-checkboxes') {
    if (!state.cachedRoles.length) {
        try {
            state.cachedRoles = await (await fetch('/api/admin/roles')).json();
        } catch {
            state.cachedRoles = [];
        }
    }
    document.getElementById(containerId).innerHTML = state.cachedRoles.map(role => `
        <label class="badge-pill" style="cursor:pointer;border-color:${escapeHtml(role.color || '')}">
            <input type="checkbox" value="${escapeHtml(role.id)}"${selected.includes(role.id) ? ' checked' : ''} style="margin-right:4px;"> ${escapeHtml(role.name)}
        </label>`).join('');
}

export function togglePollRoles() {
    const restricted = document.getElementById('poll-access').value === 'role-required';
    document.getElementById('poll-role-area').style.display = restricted ? 'block' : 'none';
}

export async function showPollEditor(pollId = null) {
    let poll = null;
    if (pollId) {
        poll = state.currentPoll && state.currentPoll.id === pollId
            ? state.currentPoll
            : await (await fetch(`/api/polls/${encodeURIComponent(pollId)}`)).json();
    }
    document.getElementById('poll-edit-id').value = pollId || '';
    document.getElementById('poll-editor-title').textContent = pollId ? 'Abstimmung bearbeiten' : 'Neue Abstimmung';
    document.getElementById('poll-title').value = poll ? poll.title : '';
    document.getElementById('poll-description').value = poll ? poll.description || '' : '';
    document.getElementById('poll-access').value = poll ? poll.accessMode : 'open';
    // Empty fields fall back to the default answers -> only renamed answers are filled in
    ['yes', 'maybe', 'no'].forEach(answer => {
        const custom = poll ? getPollLabels(poll)[answer] : '';
        document.getElementById(`poll-label-${answer}`).value = custom === DEFAULT_POLL_LABELS[answer] ? '' : custom;
    });
    await renderPollRoleCheckboxes(poll ? poll.requiredRoles || [] : []);
    togglePollRoles();

    document.getElementById('poll-option-rows').innerHTML = '';
    (poll ? poll.options : [{}, {}]).forEach(option => addPollOptionRow(option));

    if (!pollDeadlinePicker) pollDeadlinePicker = flatpickr('#poll-deadline', POLL_PICKER_CONFIG);
    pollDeadlinePicker.clear();
    if (poll && poll.deadline) pollDeadlinePicker.setDate(new Date(poll.deadline));

    bootstrap.Modal.getOrCreateInstance(document.getElementById('pollEditorModal')).show();
}

export function addPollOptionRow(option = {}) {
    const rows = document.getElementById('poll-option-rows');
    if (rows.querySelectorAll('.poll-option-row').length >= 10) {
        showToast('Es sind höchstens 10 Termine möglich.', 'warning');
        return;
    }
    const row = document.createElement('div');
    row.className = 'poll-option-row';
    row.dataset.optionId = option.id || '';
    row.innerHTML = `
        <input type="text" class="form-control poll-option-start" placeholder="Beginn" aria-label="Beginn">
        <input type="text" class="form-control poll-option-end" placeholder="Ende (optional)" aria-label="Ende">
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.poll-option-row').remove()" title="Termin entfernen"><i class="bi bi-trash"></i></button>`;
    rows.appendChild(row);
    const startPicker = flatpickr(row.querySelector('.poll-option-start'), POLL_PICKER_CONFIG);
    const endPicker = flatpickr(row.querySelector('.poll-option-end'), POLL_PICKER_CONFIG);
    if (option.startDate) startPicker.setDate(new Date(option.startDate));
    if (option.endDate) endPicker.setDate(new Date(option.endDate));
}

export function collectPollEditor() {
    const options = [...document.querySelectorAll('#poll-option-rows .poll-option-row')].map(row => {
        const start = row.querySelector('.poll-option-start')._flatpickr.selectedDates[0];
        const end = row.querySelector('.poll-option-end')._flatpickr.selectedDates[0];
        return {
            id: row.dataset.optionId || undefined,
            startDate: start ? start.toISOString() : '',
            endDate: end ? end.toISOString() : ''
        };
    });
    const deadline = pollDeadlinePicker && pollDeadlinePicker.selectedDates[0];
    const accessMode = document.getElementById('poll-access').value;
    return {
        title: document.getElementById('poll-title').value,
        description: document.getElementById('poll-description').value,
        options,
        deadline: deadline ? deadline.toISOString() : '',
        accessMode,
        labels: {
            yes: document.getElementById('poll-label-yes').value,
            maybe: document.getElementById('poll-label-maybe').value,
            no: document.getElementById('poll-label-no').value
        },
        requiredRoles: accessMode === 'role-required'
            ? [...document.querySelectorAll('#poll-role-checkboxes input:checked')].map(cb => cb.value)
            : []
    };
}

export async function savePoll() {
    const pollId = document.getElementById('poll-edit-id').value;
    try {
        const res = await fetch(pollId ? `/api/admin/polls/${encodeURIComponent(pollId)}` : '/api/admin/polls', {
            method: pollId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify(collectPollEditor())
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Abstimmung konnte nicht gespeichert werden.', 'danger');
            return;
        }
        bootstrap.Modal.getInstance(document.getElementById('pollEditorModal')).hide();
        showToast(pollId ? 'Abstimmung gespeichert!' : 'Abstimmung erstellt!', 'success');
        if (pollId) {
            showPollDetail(result.id);
        } else {
            navigateTo(`poll/${result.id}`);
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export function renderPollAdminBar(poll) {
    const bar = document.getElementById('poll-admin-bar');
    if (!bar) return;
    if (!state.currentUser || !state.currentUser.isAdmin) {
        bar.innerHTML = '';
        return;
    }
    const id = escapeHtml(poll.id);
    const button = (cls, handler, icon, label) =>
        `<button class="btn btn-sm ${cls}" data-poll-id="${id}" onclick="${handler}(this.dataset.pollId)"><i class="bi ${icon} me-1"></i>${label}</button>`;
    const buttons = [button('btn-outline-light', 'showPollAnnounceDialog', 'bi-discord', 'In Discord posten')];
    if (poll.status === 'open') {
        buttons.push(button('btn-outline-light', 'showPollEditor', 'bi-pencil', 'Bearbeiten'));
        buttons.push(button('btn-outline-light', 'closePollFromUi', 'bi-lock', 'Abstimmung beenden'));
    }
    if (poll.status !== 'decided') {
        buttons.push(button('btn-accent', 'showPollDecideDialog', 'bi-calendar-plus', 'Event erstellen'));
    }
    buttons.push(button('btn-outline-danger', 'deletePollFromUi', 'bi-trash', 'Löschen'));
    bar.innerHTML = `<div class="poll-admin-bar">${buttons.join('')}</div>`;
}

export async function showPollAnnounceDialog(pollId) {
    document.getElementById('poll-announce-id').value = pollId;
    document.getElementById('poll-announce-text').value = '';
    document.getElementById('poll-announce-everyone').checked = false;
    await renderPollRoleCheckboxes([], 'poll-announce-roles');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('pollAnnounceModal')).show();
}

export async function sendPollAnnouncement() {
    const pollId = document.getElementById('poll-announce-id').value;
    try {
        const res = await fetch(`/api/admin/polls/${encodeURIComponent(pollId)}/announce`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({
                text: document.getElementById('poll-announce-text').value,
                roleIds: [...document.querySelectorAll('#poll-announce-roles input:checked')].map(cb => cb.value),
                pingEveryone: document.getElementById('poll-announce-everyone').checked
            })
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Abstimmung konnte nicht gepostet werden.', 'danger');
            return;
        }
        bootstrap.Modal.getInstance(document.getElementById('pollAnnounceModal')).hide();
        showToast(result.message || 'Gepostet!', 'success');
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export async function closePollFromUi(pollId) {
    if (!await showConfirmDialog('Abstimmung jetzt beenden? Danach sind keine Stimmen mehr möglich.', 'Beenden')) return;
    try {
        const res = await fetch(`/api/admin/polls/${encodeURIComponent(pollId)}/close`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Abstimmung konnte nicht beendet werden.', 'danger');
            return;
        }
        showToast('Abstimmung beendet.', 'success');
        showPollDetail(pollId);
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export async function deletePollFromUi(pollId) {
    if (!await showConfirmDialog('Abstimmung mit allen Stimmen löschen? Das lässt sich nicht rückgängig machen.', 'Löschen')) return;
    try {
        const res = await fetch(`/api/admin/polls/${encodeURIComponent(pollId)}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Abstimmung konnte nicht gelöscht werden.', 'danger');
            return;
        }
        showToast('Abstimmung gelöscht.', 'success');
        navigateTo('polls');
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export function showPollDecideDialog(pollId) {
    const poll = state.currentPoll;
    if (!poll || poll.id !== pollId) return;
    const preselected = poll.favoriteOptionId || poll.options[0].id;
    document.getElementById('poll-decide-options').innerHTML = poll.tally.options.map(entry => {
        const option = poll.options.find(candidate => candidate.id === entry.optionId);
        return `
            <label class="poll-decide-option">
                <input class="form-check-input me-2" type="radio" name="poll-decide" value="${escapeHtml(entry.optionId)}"${entry.optionId === preselected ? ' checked' : ''}>
                <span>${escapeHtml(formatPollOptionLabel(option))}</span>
                <span class="text-secondary ms-auto poll-counts">${renderPollCounts(entry, getPollLabels(poll))}</span>
            </label>`;
    }).join('');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('pollDecideModal')).show();
}

export async function startEventFromPoll() {
    const poll = state.currentPoll;
    const selected = document.querySelector('input[name="poll-decide"]:checked');
    if (!poll || !selected) return;
    const option = poll.options.find(candidate => candidate.id === selected.value);
    bootstrap.Modal.getInstance(document.getElementById('pollDecideModal')).hide();

    await showCreateEventModal();
    document.getElementById('event-title').value = poll.title;
    // Voters are notified with the event link -> the event is created active
    document.getElementById('event-status').value = 'active';
    if (state.descriptionEditor) state.descriptionEditor.value(poll.description || '');
    // The date pickers are created when step 2 is shown for the first time
    wizardGoTo(2);
    state.startDatePicker.setDate(new Date(option.startDate));
    if (option.endDate) state.endDatePicker.setDate(new Date(option.endDate));
    wizardGoTo(1);

    state.pendingPollDecision = { pollId: poll.id, optionId: option.id };
    showToast('Termin übernommen – richte das Event ein und speichere es.', 'info');
}

// Temporary bridge for inline handlers; D-01 replaces them with data-click and removes it
Object.assign(window, { togglePollRoles, showPollEditor, addPollOptionRow, savePoll, showPollAnnounceDialog, sendPollAnnouncement, closePollFromUi, deletePollFromUi, showPollDecideDialog, startEventFromPoll });
