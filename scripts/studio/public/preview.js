// Preview of the studio: the DEMS child in an iframe, persona switch, reload and the hook buttons.
import { escapeHtml, showToast } from './ui.js';

// Ids from dev/mockGuild.js PERSONAS.
export const PERSONAS = [
  { id: 'admin', label: 'Admin' },
  { id: 'raider', label: 'Lena' },
  { id: 'member', label: 'Tom' },
  { id: 'newbie', label: 'Neo' },
];

export const HOOK_BUTTONS = [
  { action: 'create', label: 'Event erstellen' },
  { action: 'publish', label: 'Veröffentlichen' },
  { action: 'end', label: 'Beenden' },
  { action: 'cancel', label: 'Absagen' },
  { action: 'delete', label: 'Löschen' },
  { action: 'checkin', label: 'Check-in' },
];

/** The overlay text for a child status; null when the preview is usable. */
export function statusOverlay(status) {
  if (status === 'starting') return 'DEMS startet neu …';
  if (status === 'failed') return 'DEMS konnte nicht starten – siehe Debug';
  return null;
}

/** Address that logs the preview in as a persona and lands on the start page. */
export function personaUrl(origin, id) {
  return `${String(origin).replace(/\/+$/, '')}/auth/dev-login/${encodeURIComponent(id)}`;
}

/**
 * Builds the preview column in `area` (frame, hook buttons, room for the debug panel).
 * @param {HTMLElement} area
 * @param {{ api: object, previewUrl: string, status: string, signal: AbortSignal }} options
 * @returns {{ debugArea: HTMLElement, setStatus(status: string): void }}
 */
export function mountPreview(area, { api, previewUrl, status, signal }) {
  area.innerHTML = `
    <div class="pv-head">
      <label class="studio-muted" for="pv-persona">Ansicht als</label>
      <select id="pv-persona" class="studio-input pv-persona">${PERSONAS.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join('')}</select>
      <button type="button" class="studio-btn" data-pv="reload" title="Neu laden" aria-label="Neu laden"><i class="bi bi-arrow-clockwise"></i></button>
    </div>
    <div class="pv-stage">
      <iframe class="pv-frame" title="Vorschau"></iframe>
      <div class="pv-overlay is-hidden" role="status"></div>
    </div>
    <div class="pv-hooks">${HOOK_BUTTONS.map((b) => `<button type="button" class="studio-btn" data-hook="${escapeHtml(b.action)}">${escapeHtml(b.label)}</button>`).join('')}</div>
    <div class="pv-debug"></div>`;
  const frame = area.querySelector('.pv-frame');
  const overlay = area.querySelector('.pv-overlay');
  const persona = area.querySelector('.pv-persona');
  let current = previewUrl;
  let needsReload = false;

  const navigate = (url) => { current = url; frame.src = url; };

  function setStatus(next) {
    if (signal.aborted) return;
    const text = statusOverlay(next);
    overlay.textContent = text || '';
    overlay.classList.toggle('is-hidden', !text);
    if (next === 'starting') needsReload = true;
    if (next === 'running' && needsReload) { needsReload = false; navigate(current); }
  }

  if (previewUrl) navigate(previewUrl);
  setStatus(status);

  persona.addEventListener('change', () => {
    if (previewUrl) navigate(personaUrl(previewUrl, persona.value));
  }, { signal });

  area.addEventListener('click', async (event) => {
    const reload = event.target.closest('[data-pv="reload"]');
    if (reload) { if (current) navigate(current); return; }
    const hook = event.target.closest('[data-hook]');
    if (!hook) return;
    hook.disabled = true;
    try {
      const answer = await api.trigger(hook.dataset.hook);
      if (!signal.aborted) showToast(answer.message || 'Erledigt.', 'success');
    } catch (err) {
      if (!signal.aborted) showToast(err.message, 'danger');
    } finally {
      hook.disabled = false;
    }
  }, { signal });

  return { debugArea: area.querySelector('.pv-debug'), setStatus };
}
