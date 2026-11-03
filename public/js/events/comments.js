/**
 * Comments and questions on the event page.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showElement, showToast } from '../core/ui.js';
import { avatar } from '../core/components.js';

export async function loadComments(eventId) {
    // Check if comment area exists, if not create it
    let commentSection = document.getElementById('comments-section');
    if (!commentSection) {
        commentSection = document.createElement('div');
        commentSection.id = 'comments-section';
        commentSection.className = 'comments-section';
        document.getElementById('detail-main')?.appendChild(commentSection);
    }
    if (!commentSection) return;

    // Clear previous comments and show loading state
    showElement(commentSection);
    commentSection.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-accent" role="status"><span class="visually-hidden">Laden...</span></div></div>';

    const isLoggedIn = !!state.currentUser;

    try {
        const res = await fetch(`/api/events/${eventId}/comments`);
        const comments = await res.json();
        if (state.detailEventId !== eventId) return;

        let html = `<h5><i class="bi bi-chat-dots me-2"></i>Kommentare & Fragen (${comments.length})</h5>`;

        // Comment form (only if logged in)
        if (isLoggedIn) {
            html += `
            <div class="comment-form">
                <textarea class="form-control" id="comment-input" rows="2" placeholder="Frage oder Kommentar schreiben..." maxlength="1000"></textarea>
                <button class="btn btn-accent" data-click="postComment" data-event-id="${escapeHtml(eventId)}">
                    <i class="bi bi-send"></i>
                </button>
            </div>`;
        } else {
            html += `<p class="text-muted small mb-3"><i class="bi bi-lock me-1"></i>Einloggen um zu kommentieren.</p>`;
        }

        // Comments list
        if (comments.length === 0) {
            html += `<p class="text-muted text-center py-3">Noch keine Kommentare.</p>`;
        } else {
            // Separate top-level comments and replies
            const topLevel = comments.filter(c => !c.replyTo);
            const replies = comments.filter(c => c.replyTo);

            topLevel.forEach(comment => {
                html += renderComment(comment, eventId, isLoggedIn);
                // Show replies
                replies.filter(r => r.replyTo === comment.id).forEach(reply => {
                    html += `<div class="comment-reply">${renderComment(reply, eventId, isLoggedIn)}</div>`;
                });
            });
        }

        commentSection.innerHTML = html;
    } catch {
        commentSection.innerHTML = '<p class="text-muted">Kommentare konnten nicht geladen werden.</p>';
    }
}

export function renderComment(comment, eventId, isLoggedIn) {
    const isOwn = state.currentUser && state.currentUser.id === comment.userId;
    const isAdmin = state.currentUser && state.currentUser.isAdmin;
    const dateStr = new Date(comment.createdAt).toLocaleDateString('de-DE', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    return `
    <div class="comment-card ${comment.isAdmin ? 'comment-admin-reply' : ''}">
        <div class="comment-header">
            ${avatar({ url: comment.userAvatar, name: comment.userName, size: 'sm' })}
            <span class="comment-username">${escapeHtml(comment.userName)}</span>
            ${comment.isAdmin ? '<span class="comment-admin-badge">ADMIN</span>' : ''}
            ${comment.source === 'discord' ? '<span class="chip chip-sm chip-info"><i class="bi bi-discord me-1"></i>Discord</span>' : ''}
            <span class="comment-date">${dateStr}${comment.editedAt ? ' (bearbeitet)' : ''}</span>
        </div>
        <div class="comment-text">${escapeHtml(comment.text).replace(/\n/g, '<br>')}</div>
        <div class="comment-actions">
            ${isLoggedIn && !comment.replyTo ? `<button data-click="replyToComment" data-comment-id="${escapeHtml(comment.id)}" data-user-name="${escapeHtml(comment.userName)}"><i class="bi bi-reply me-1"></i>Antworten</button>` : ''}
            ${isOwn || isAdmin ? `<button data-click="deleteComment" data-event-id="${escapeHtml(eventId)}" data-comment-id="${escapeHtml(comment.id)}"><i class="bi bi-trash me-1"></i>Löschen</button>` : ''}
        </div>
    </div>`;
}

export async function postComment(eventId, replyTo = null) {
    const input = document.getElementById('comment-input');
    const text = input.value.trim();
    if (!text) return;

    try {
        const res = await fetch(`/api/events/${eventId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            body: JSON.stringify({ text, replyTo })
        });
        if (res.ok) {
            loadComments(eventId);
        } else {
            const data = await res.json();
            showToast(data.error || 'Fehler beim Posten.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export function replyToComment(commentId, userName) {
    const input = document.getElementById('comment-input');
    if (!input) return;
    input.value = `@${userName} `;
    input.focus();
    // The postComment action sends the next comment as a reply to this one
    input.dataset.replyTo = commentId;
}

export async function deleteComment(eventId, commentId) {
    if (!confirm('Kommentar löschen?')) return;
    try {
        const res = await fetch(`/api/events/${eventId}/comments/${commentId}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        if (res.ok) {
            loadComments(eventId);
        } else {
            showToast('Fehler beim Löschen.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

registerActions({
    postComment: (el) => {
        // A reply target set by replyToComment applies to the next post only
        const input = document.getElementById('comment-input');
        const replyTo = input?.dataset.replyTo || null;
        if (input) delete input.dataset.replyTo;
        return postComment(el.dataset.eventId, replyTo);
    },
    replyToComment: (el) => replyToComment(el.dataset.commentId, el.dataset.userName),
    deleteComment: (el) => deleteComment(el.dataset.eventId, el.dataset.commentId)
});
