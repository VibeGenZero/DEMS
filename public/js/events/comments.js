/**
 * Comments and questions on the event page.
 */
import { state } from '../core/state.js';
import { escapeHtml, inlineArg, showToast } from '../core/ui.js';

export async function loadComments(eventId) {
    // Check if comment area exists, if not create it
    let commentSection = document.getElementById('comments-section');
    if (!commentSection) {
        commentSection = document.createElement('div');
        commentSection.id = 'comments-section';
        commentSection.className = 'comments-section';
        document.querySelector('.col-lg-8')?.appendChild(commentSection);
    }
    if (!commentSection) return;

    // Clear previous comments and show loading state
    commentSection.style.display = '';
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
                <button class="btn btn-accent" onclick="postComment('${eventId}')">
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
            <img class="comment-avatar" src="${escapeHtml(comment.userAvatar || '')}" alt="" onerror="this.style.display='none'">
            <span class="comment-username">${escapeHtml(comment.userName)}</span>
            ${comment.isAdmin ? '<span class="comment-admin-badge">ADMIN</span>' : ''}
            <span class="comment-date">${dateStr}</span>
        </div>
        <div class="comment-text">${escapeHtml(comment.text).replace(/\n/g, '<br>')}</div>
        <div class="comment-actions">
            ${isLoggedIn && !comment.replyTo ? `<button onclick="replyToComment('${eventId}', '${comment.id}', ${inlineArg(comment.userName)})"><i class="bi bi-reply me-1"></i>Antworten</button>` : ''}
            ${isOwn || isAdmin ? `<button onclick="deleteComment('${eventId}', '${comment.id}')"><i class="bi bi-trash me-1"></i>Löschen</button>` : ''}
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

export function replyToComment(eventId, commentId, userName) {
    const input = document.getElementById('comment-input');
    if (input) {
        input.value = `@${userName} `;
        input.focus();
        // Store reply target
        input.dataset.replyTo = commentId;
        // Override the send button
        const btn = input.nextElementSibling;
        if (btn) {
            btn.onclick = () => {
                postComment(eventId, commentId);
                delete input.dataset.replyTo;
                btn.onclick = () => postComment(eventId);
            };
        }
    }
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

// Temporary bridge for inline handlers; D-01 replaces them with data-click and removes it
Object.assign(window, { postComment, replyToComment, deleteComment });
