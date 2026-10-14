/**
 * Role slots on the event page: picker, roster, own slot.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast } from '../core/ui.js';
import { avatar } from '../core/components.js';
import { showEventDetail } from './detail.js';

export let slotPickerSlots = [];

export function eventHasSlots(event) {
    return !!event && Array.isArray(event.slots) && event.slots.length > 0;
}

export function renderSlotPicker(event) {
    const area = document.getElementById('slot-picker-area');
    if (!area) return;
    state.selectedSlotId = null;
    state.selectedAltSlotIds = [];
    slotPickerSlots = eventHasSlots(event) ? event.slots : [];
    if (slotPickerSlots.length === 0) {
        area.style.display = 'none';
        area.innerHTML = '';
        return;
    }

    const summary = Array.isArray(event.slotSummary)
        ? event.slotSummary
        : event.slots.map(slot => ({ ...slot, taken: 0 }));
    area.style.display = 'block';
    area.innerHTML = `
        <label class="form-label mb-2"><i class="bi bi-diagram-3 me-1"></i>Deine Rolle <span class="text-danger">*</span></label>
        <div class="slot-picker" id="slot-picker-cards">
            ${summary.map(slot => {
                const full = slot.taken >= slot.capacity;
                return `
                <button type="button" class="slot-card${full ? ' full' : ''}" data-slot-id="${escapeHtml(slot.id)}" data-click="selectPrimarySlot">
                    <span class="slot-card-emoji">${escapeHtml(slot.emoji || '🎯')}</span>
                    <span class="slot-card-name">${escapeHtml(slot.name)}</span>
                    <span class="slot-card-count">${slot.taken}/${slot.capacity}</span>
                    ${full ? '<span class="slot-card-hint">voll – Ausweich/Warteliste</span>' : ''}
                </button>`;
            }).join('')}
        </div>
        <div id="slot-alt-area" class="mt-3 is-hidden">
            <label class="form-label mb-1">Ausweichrollen <small class="text-muted">(optional – falls deine Rolle voll ist)</small></label>
            <div class="d-flex flex-wrap gap-2" id="slot-alt-chips"></div>
        </div>`;
}

export function selectPrimarySlot(slotId) {
    state.selectedSlotId = slotId;
    state.selectedAltSlotIds = state.selectedAltSlotIds.filter(id => id !== slotId);
    document.querySelectorAll('#slot-picker-cards .slot-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.slotId === slotId);
    });
    renderAltSlotChips();
}

export function renderAltSlotChips() {
    const area = document.getElementById('slot-alt-area');
    const chips = document.getElementById('slot-alt-chips');
    if (!area || !chips) return;
    const others = slotPickerSlots.filter(slot => slot.id !== state.selectedSlotId);
    if (!state.selectedSlotId || others.length === 0) {
        area.style.display = 'none';
        return;
    }
    area.style.display = 'block';
    chips.innerHTML = others.map(slot => `
        <button type="button" class="slot-alt-chip${state.selectedAltSlotIds.includes(slot.id) ? ' selected' : ''}" data-slot-id="${escapeHtml(slot.id)}" data-click="toggleAltSlot">
            ${escapeHtml(formatSlotLabel(slot))}
        </button>`).join('');
}

export function toggleAltSlot(slotId) {
    state.selectedAltSlotIds = state.selectedAltSlotIds.includes(slotId)
        ? state.selectedAltSlotIds.filter(id => id !== slotId)
        : [...state.selectedAltSlotIds, slotId];
    renderAltSlotChips();
}

// Line-up, waitlist and poll votes: a person in a list next to the name
export function renderRosterAvatar(person) {
    return avatar({ url: person.avatar, name: person.displayName, size: 'sm' });
}

export function renderRoster(data) {
    const maxFreeSeats = 5;
    const slotsHtml = data.slots.map(slot => {
        const overbooked = slot.taken > slot.capacity;
        const pct = Math.min(100, Math.round((slot.taken / slot.capacity) * 100));
        const members = slot.members.map(member => `
            <div class="roster-member">
                ${renderRosterAvatar(member)}
                <span class="roster-name">${escapeHtml(member.displayName)}</span>
                ${member.pending ? '<span class="roster-tag" title="Anfrage ausstehend"><i class="bi bi-hourglass-split"></i></span>' : ''}
                ${member.isAlt ? '<span class="roster-tag roster-tag-alt">Ausweich</span>' : ''}
            </div>`).join('');
        const freeSeats = Math.max(0, slot.capacity - slot.taken);
        const seats = Array.from({ length: Math.min(freeSeats, maxFreeSeats) }, () =>
            '<div class="roster-member roster-seat-free"><span class="roster-seat-dot"></span><span class="roster-name text-muted">frei</span></div>'
        ).join('');
        const moreFree = freeSeats > maxFreeSeats
            ? `<div class="text-muted small">+${freeSeats - maxFreeSeats} weitere freie Plätze</div>`
            : '';
        return `
            <div class="roster-slot${overbooked ? ' overbooked' : ''}">
                <div class="roster-slot-head">
                    <span>${escapeHtml(formatSlotLabel(slot))}</span>
                    <span class="roster-slot-count">${slot.taken}/${slot.capacity}</span>
                </div>
                <div class="capacity-progress"><div class="capacity-progress-bar${pct >= 100 ? ' danger' : ''}" data-style-width="${pct}"></div></div>
                <div class="roster-members">${members}${seats}${moreFree}</div>
            </div>`;
    }).join('');

    const slotById = Object.fromEntries(data.slots.map(slot => [slot.id, slot]));
    const waitlist = data.waitlist.length === 0 ? '' : `
        <div class="mt-3">
            <div class="section-label mb-2"><i class="bi bi-hourglass-split me-1"></i>WARTELISTE (${data.waitlist.length})</div>
            ${data.waitlist.map(entry => {
                const wishes = [entry.preferredSlotId, ...entry.altSlotIds]
                    .map(id => slotById[id])
                    .filter(Boolean)
                    .map(slot => escapeHtml(slot.emoji || slot.name))
                    .join(' ');
                return `<div class="roster-member">${renderRosterAvatar(entry)}<span class="roster-name">${escapeHtml(entry.displayName)}</span><span class="roster-wishes">${wishes}</span></div>`;
            }).join('')}
        </div>`;

    return `<div class="roster-grid">${slotsHtml}</div>${waitlist}`;
}

export function renderOwnSlot(event, registration) {
    const area = document.getElementById('detail-reg-slot');
    if (!area) return;
    if (!eventHasSlots(event) || registration.asGuest || registration.status === 'rejected') {
        area.innerHTML = '';
        return;
    }
    const summary = Array.isArray(event.slotSummary) ? event.slotSummary : [];
    const current = summary.find(slot => slot.id === registration.slotId);
    const isAlt = !!current && registration.slotId !== registration.preferredSlotId;
    const freeSlots = summary.filter(slot => slot.id !== registration.slotId && slot.taken < slot.capacity);
    const placement = current
        ? `Du bist als <strong>${escapeHtml(formatSlotLabel(current))}</strong> eingeplant${isAlt ? ' <span class="roster-tag roster-tag-alt">Ausweich</span>' : ''}.`
        : 'Du stehst auf der Warteliste.';
    const switcher = freeSlots.length === 0 ? '' : `
        <div class="input-group input-group-sm mt-2">
            <select class="form-select" id="own-slot-select" aria-label="Neuer Slot">
                ${freeSlots.map(slot => `<option value="${escapeHtml(slot.id)}">${escapeHtml(formatSlotLabel(slot))} (${slot.taken}/${slot.capacity})</option>`).join('')}
            </select>
            <button class="btn btn-outline-light" type="button" data-event-id="${escapeHtml(event.id)}" data-click="switchMySlot">Slot wechseln</button>
        </div>`;
    area.innerHTML = `<div class="small">${placement}</div>${switcher}`;
}

export async function switchMySlot(eventId) {
    const select = document.getElementById('own-slot-select');
    if (!select || !select.value) return;
    try {
        const res = await fetch(`/api/events/${eventId}/register/slot`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ slotId: select.value })
        });
        const result = await res.json();
        if (res.ok) {
            showToast(result.message || 'Slot gewechselt.', 'success');
            showEventDetail(eventId);
        } else {
            showToast(result.error || 'Slot konnte nicht gewechselt werden.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export function formatSlotLabel(slot) {
    if (!slot) return '';
    return slot.emoji ? `${slot.emoji} ${slot.name}` : slot.name;
}

registerActions({
    selectPrimarySlot: (el) => selectPrimarySlot(el.dataset.slotId),
    toggleAltSlot: (el) => toggleAltSlot(el.dataset.slotId),
    switchMySlot: (el) => switchMySlot(el.dataset.eventId)
});
