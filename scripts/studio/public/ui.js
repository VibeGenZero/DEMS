// Small UI helpers of the studio page: escaping, in-page dialogs and toasts (no confirm()/alert()).

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Shows a modal dialog and resolves with the pressed button's value (null on Escape).
 * `fields` (optional) are text inputs; then the result is `{ value, fields }` for the confirm button.
 * `signal` (optional): aborting it closes the dialog (resolves null), e.g. when the view that opened it goes away.
 */
export function showDialog({ title, message = '', buttons, fields = [], signal }) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(null); return; }
    const overlay = document.createElement('div');
    overlay.className = 'studio-dialog-overlay';
    const inputs = fields.map((f, i) => `
      <label class="studio-field">
        <span>${escapeHtml(f.label)}</span>
        <input type="text" class="studio-input" data-field="${i}" value="${escapeHtml(f.value || '')}" placeholder="${escapeHtml(f.placeholder || '')}" autocomplete="off">
      </label>`).join('');
    const actions = buttons.map((b, i) => `<button type="button" class="studio-btn ${escapeHtml(b.className || '')}" data-button="${i}">${escapeHtml(b.label)}</button>`).join('');
    overlay.innerHTML = `
      <div class="studio-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <h2>${escapeHtml(title)}</h2>
        ${message ? `<p>${escapeHtml(message)}</p>` : ''}
        ${inputs}
        <div class="studio-dialog-actions">${actions}</div>
      </div>`;
    const finish = (value) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };
    const read = () => fields.map((f, i) => overlay.querySelector(`[data-field="${i}"]`).value);
    const press = (i) => finish({ value: buttons[i].value, fields: read() });
    function onAbort() { finish(null); }
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); }
      if (event.key === 'Enter' && fields.length && event.target && event.target.matches && event.target.matches('input')) {
        event.preventDefault();
        const primary = buttons.findIndex((b) => b.primary);
        if (primary >= 0) press(primary);
      }
    }
    overlay.addEventListener('click', (event) => {
      const button = event.target.closest('[data-button]');
      if (button) press(Number(button.dataset.button));
    });
    document.addEventListener('keydown', onKey, true);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    document.body.appendChild(overlay);
    const first = overlay.querySelector('input') || overlay.querySelector('[data-button]:last-child');
    if (first) first.focus();
  });
}

/** „Ungespeicherte Änderungen verwerfen?“ -> true when the user agrees. */
export async function confirmDiscard(signal) {
  const answer = await showDialog({
    signal,
    title: 'Ungespeicherte Änderungen verwerfen?',
    message: 'Einige Dateien sind nicht gespeichert. Wenn du fortfährst, gehen die Änderungen verloren.',
    buttons: [
      { label: 'Abbrechen', value: false },
      { label: 'Verwerfen', value: true, className: 'is-danger', primary: true },
    ],
  });
  return Boolean(answer && answer.value);
}

export async function askText({ title, label, value = '', confirmLabel = 'OK', signal }) {
  const answer = await showDialog({
    signal,
    title,
    fields: [{ label, value }],
    buttons: [
      { label: 'Abbrechen', value: false },
      { label: confirmLabel, value: true, className: 'is-primary', primary: true },
    ],
  });
  return answer && answer.value ? answer.fields[0].trim() : null;
}

export async function askConfirm({ title, message, confirmLabel, signal }) {
  const answer = await showDialog({
    signal,
    title,
    message,
    buttons: [
      { label: 'Abbrechen', value: false },
      { label: confirmLabel, value: true, className: 'is-danger', primary: true },
    ],
  });
  return Boolean(answer && answer.value);
}

export function showToast(message, kind = 'info') {
  let host = document.getElementById('studio-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'studio-toasts';
    host.setAttribute('role', 'status');
    document.body.appendChild(host);
  }
  const toast = document.createElement('div');
  toast.className = `studio-toast is-${kind}`;
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), kind === 'danger' ? 6000 : 3000);
}
