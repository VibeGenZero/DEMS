/**
 * Date polls: overview, detail page, votes.
 */
import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, renderMarkdownSafe, showToast } from '../core/ui.js';
import { renderRosterAvatar } from '../events/slots.js';
import { renderPollAdminBar } from './admin.js';


export function formatPollDate(isoDate) {
    const date = new Date(isoDate);
    const day = date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.,', ',');
    const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `${day} · ${time}`;
}

export function formatPollOptionLabel(option) {
    let label = formatPollDate(option.startDate);
    if (option.endDate) {
        const end = new Date(option.endDate);
        const sameDay = new Date(option.startDate).toDateString() === end.toDateString();
        label += sameDay
            ? `–${end.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
            : ` – ${formatPollDate(option.endDate)}`;
    }
    return label;
}

// Answers of a date poll -> fixed icons, the texts come from the poll (admins can rename them)
export const POLL_ANSWER_ICONS = { yes: 'bi-check-circle', maybe: 'bi-question-circle', no: 'bi-x-circle' };

export const DEFAULT_POLL_LABELS = { yes: 'passt', maybe: 'wenn nötig', no: 'passt nicht' };

export function getPollLabels(poll) {
    const labels = { ...DEFAULT_POLL_LABELS };
    Object.keys(labels).forEach(key => {
        if (poll && poll.labels && poll.labels[key]) labels[key] = poll.labels[key];
    });
    return labels;
}

export function renderPollAnswerIcon(answer, colored = true) {
    return `<i class="bi ${POLL_ANSWER_ICONS[answer]}${colored ? ` poll-icon-${answer}` : ''}" aria-hidden="true"></i>`;
}

export function renderPollCounts(entry, labels) {
    return ['yes', 'maybe'].map(answer => `
        <span class="poll-count" title="${escapeHtml(labels[answer])}">${renderPollAnswerIcon(answer)} ${entry[answer]}<span class="visually-hidden"> ${escapeHtml(labels[answer])}</span></span>`).join('');
}

export async function refreshPollBadge() {
    const badge = document.getElementById('nav-polls-badge');
    if (!badge || !state.currentUser) return;
    try {
        const res = await fetch('/api/polls');
        if (!res.ok) return;
        const polls = await res.json();
        const pending = polls.filter(poll => poll.status === 'open' && poll.canVote && poll.myVoteStatus === 'open').length;
        badge.textContent = pending;
        badge.style.display = pending > 0 ? 'inline-block' : 'none';
    } catch { /* non-fatal */ }
}

export async function showPollsSection() {
    document.getElementById('polls-section').style.display = 'block';
    const createBtn = document.getElementById('polls-create-btn');
    if (createBtn) createBtn.style.display = state.currentUser && state.currentUser.isAdmin ? '' : 'none';

    const openGrid = document.getElementById('polls-open');
    const closedGrid = document.getElementById('polls-closed');
    openGrid.innerHTML = '<div class="col-12 text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div></div>';
    try {
        const res = await fetch('/api/polls');
        if (!res.ok) throw new Error('load failed');
        const polls = await res.json();
        const open = polls.filter(poll => poll.status === 'open');
        const done = polls.filter(poll => poll.status !== 'open');
        openGrid.innerHTML = open.length
            ? open.map(renderPollCard).join('')
            : '<div class="col-12"><div class="glass-card p-4 text-center text-secondary">Gerade läuft keine Abstimmung.</div></div>';
        closedGrid.innerHTML = done.map(renderPollCard).join('');
        document.getElementById('polls-closed-wrapper').style.display = done.length ? '' : 'none';
        refreshPollBadge();
    } catch {
        openGrid.innerHTML = '<div class="col-12 text-danger">Abstimmungen konnten nicht geladen werden.</div>';
    }
}

export function renderPollCard(poll) {
    const statusBadges = {
        open: '<span class="badge-pill status-accepted">Offen</span>',
        closed: '<span class="badge-pill">Beendet</span>',
        decided: '<span class="badge-pill status-accepted">Entschieden</span>'
    };
    let voteBadge = '';
    if (poll.status === 'open') {
        if (!poll.canVote) {
            voteBadge = '<span class="badge-pill"><i class="bi bi-lock"></i>Nur für bestimmte Rollen</span>';
        } else if (poll.myVoteStatus === 'voted') {
            voteBadge = '<span class="badge-pill status-accepted"><i class="bi bi-check2"></i>Abgestimmt</span>';
        } else {
            voteBadge = '<span class="badge-pill status-pending"><i class="bi bi-hourglass-split"></i>Noch nicht abgestimmt</span>';
        }
    }
    const favorite = poll.favorite
        ? `<div class="poll-card-favorite"><i class="bi bi-trophy poll-icon-favorite me-1" title="Favorit"></i>${escapeHtml(formatPollOptionLabel(poll.favorite))} <span class="poll-counts ms-2">${renderPollCounts(poll.favorite, getPollLabels(poll))}</span></div>`
        : '<div class="poll-card-favorite text-secondary">Noch keine Stimmen</div>';
    let deadline = '';
    if (poll.status === 'open') deadline = poll.deadline ? ` · bis ${escapeHtml(formatPollDate(poll.deadline))}` : ' · ohne Deadline';
    return `
        <div class="col-md-6 col-lg-4">
            <a class="poll-card glass-card" href="#poll/${escapeHtml(poll.id)}">
                <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                    <h5 class="mb-0">${escapeHtml(poll.title)}</h5>${statusBadges[poll.status] || ''}
                </div>
                <div class="text-secondary small mb-2"><i class="bi bi-calendar3 me-1"></i>${poll.optionCount} Termine · ${poll.voterCount} ${poll.voterCount === 1 ? 'Stimme' : 'Stimmen'}${deadline}</div>
                ${favorite}
                <div class="mt-2">${voteBadge}</div>
            </a>
        </div>`;
}

export async function showPollDetail(pollId) {
    document.getElementById('poll-detail-section').style.display = 'block';
    const container = document.getElementById('poll-detail');
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-secondary"></div></div>';
    try {
        const res = await fetch(`/api/polls/${encodeURIComponent(pollId)}`);
        if (!res.ok) throw new Error('not found');
        state.currentPoll = await res.json();
        renderPollDetail(state.currentPoll);
    } catch {
        showToast('Abstimmung nicht gefunden.', 'danger');
        navigateTo('polls');
    }
}

export function renderPollDetail(poll) {
    const container = document.getElementById('poll-detail');
    const winner = poll.options.find(option => option.id === poll.winnerOptionId);
    let banner = '';
    if (poll.status === 'decided' && winner) {
        banner = `<div class="poll-banner poll-banner-decided"><div><strong><i class="bi bi-calendar-check me-1"></i>Termin steht:</strong> ${escapeHtml(formatPollOptionLabel(winner))}</div>${poll.eventId ? `<a class="btn btn-sm btn-accent" href="#event/${escapeHtml(poll.eventId)}">Zum Event</a>` : ''}</div>`;
    } else if (poll.status === 'closed') {
        banner = '<div class="poll-banner"><strong><i class="bi bi-lock me-1"></i>Abstimmung beendet</strong></div>';
    } else if (!poll.canVote) {
        banner = '<div class="poll-banner"><i class="bi bi-lock me-1"></i>Nur Mitglieder mit der erforderlichen Rolle können abstimmen.</div>';
    }
    const voters = poll.tally.voterCount;
    const deadline = poll.deadline
        ? `<span><i class="bi bi-alarm me-1"></i>${poll.status === 'open' ? 'Abstimmung bis' : 'Deadline'} ${escapeHtml(formatPollDate(poll.deadline))}</span>`
        : '';
    container.innerHTML = `
        <div class="glass-card p-4 mb-4">
            <h2 class="mb-2">${escapeHtml(poll.title)}</h2>
            <div class="text-secondary small d-flex flex-wrap gap-3 mb-3">${deadline}<span><i class="bi bi-people me-1"></i>${voters} ${voters === 1 ? 'Stimme' : 'Stimmen'}</span></div>
            ${poll.description ? `<div class="markdown-body mb-3">${renderMarkdownSafe(poll.description)}</div>` : ''}
            ${banner}
            <div id="poll-admin-bar"></div>
        </div>
        <div class="poll-options">${poll.tally.options.map(entry => renderPollOptionRow(poll, entry)).join('')}</div>`;
    renderPollAdminBar(poll);
}

export function renderPollOptionRow(poll, entry) {
    const option = poll.options.find(candidate => candidate.id === entry.optionId);
    const total = Math.max(poll.tally.voterCount, 1);
    const isWinner = poll.status === 'decided' && entry.optionId === poll.winnerOptionId;
    const isFavorite = poll.status !== 'decided' && entry.optionId === poll.favoriteOptionId;
    let myState = 'no';
    if (poll.myVote.yes.includes(entry.optionId)) myState = 'yes';
    else if (poll.myVote.maybe.includes(entry.optionId)) myState = 'maybe';

    const labels = getPollLabels(poll);
    const avatars = [...entry.yesVoters, ...entry.maybeVoters].slice(0, 8).map(renderRosterAvatar).join('');
    const names = (list) => list.map(voter => escapeHtml(voter.displayName)).join(', ') || '—';
    const toggle = poll.isOpen && poll.canVote ? `
        <div class="btn-group btn-group-sm poll-vote-toggle" role="group" aria-label="Deine Stimme">
            ${['yes', 'maybe', 'no'].map(answer => `
                <button type="button" class="btn ${myState === answer ? 'btn-accent' : 'btn-outline-light'}" data-option-id="${escapeHtml(entry.optionId)}" data-state="${answer}" aria-pressed="${myState === answer}" data-click="setPollVote">${renderPollAnswerIcon(answer, false)}<span class="ms-1">${escapeHtml(labels[answer])}</span></button>`).join('')}
        </div>` : '';
    let marker = '';
    if (isWinner) marker = '<i class="bi bi-calendar-check poll-icon-yes me-1" title="Gewählter Termin"></i>';
    else if (isFavorite) marker = '<i class="bi bi-trophy poll-icon-favorite me-1" title="Favorit"></i>';

    return `
        <div class="poll-option glass-card${isWinner || isFavorite ? ' highlight' : ''}">
            <div class="poll-option-head">
                <span class="poll-option-date">${marker}${escapeHtml(formatPollOptionLabel(option))}</span>
                <span class="poll-option-count poll-counts">${renderPollCounts(entry, labels)}</span>
            </div>
            <div class="poll-bar">
                <div class="poll-bar-yes" style="width:${Math.round((entry.yes / total) * 100)}%"></div>
                <div class="poll-bar-maybe" style="width:${Math.round((entry.maybe / total) * 100)}%"></div>
            </div>
            <div class="poll-option-foot">
                <div class="poll-voters">${avatars}</div>
                ${toggle}
            </div>
            ${entry.yes + entry.maybe > 0 ? `<details class="poll-voter-names"><summary>Namen anzeigen</summary><div>${renderPollAnswerIcon('yes')} <strong>${escapeHtml(labels.yes)}:</strong> ${names(entry.yesVoters)}</div><div>${renderPollAnswerIcon('maybe')} <strong>${escapeHtml(labels.maybe)}:</strong> ${names(entry.maybeVoters)}</div></details>` : ''}
        </div>`;
}

export let pollVoteSequence = 0;

export async function setPollVote(optionId, answer) {
    if (!state.currentPoll) return;
    const pollId = state.currentPoll.id;
    const sequence = ++pollVoteSequence;
    try {
        // Only the clicked date is sent -> the server merges it, so fast clicks keep each other
        const res = await fetch(`/api/polls/${encodeURIComponent(pollId)}/vote`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ optionId, state: answer })
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Stimme konnte nicht gespeichert werden.', 'danger');
            return;
        }
        // An older, slower answer must not paint over a newer click
        if (sequence !== pollVoteSequence || state.currentPoll?.id !== pollId) return;
        state.currentPoll = result;
        renderPollDetail(state.currentPoll);
        refreshPollBadge();
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

registerActions({ setPollVote: (el) => setPollVote(el.dataset.optionId, el.dataset.state) });
