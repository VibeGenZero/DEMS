// What the studio AI proposes: the notes above a proposal (permissions, problems, dropped files), the dialog
// of „Übernehmen“ and the Monaco diff view (one tab per file, new files against empty).
import { editorLanguage, loadMonaco } from './editor.js';
import { escapeHtml } from './ui.js';

/** What a permission allows, completing „das Plugin darf …“ (labels of plugin-sdk/manifest.js PERMISSIONS). */
export const PERMISSION_TEXT = {
  'events:read': 'Events lesen',
  'events:draft': 'Events für das Team vorbereiten',
  'members:read': 'Mitgliedernamen und Avatare lesen',
  'discord:dm': 'Direktnachrichten über den Bot senden',
  'discord:channel': 'Nachrichten in Discord-Kanäle posten',
  network: 'ins Internet',
  theme: 'das Aussehen der ganzen Seite ändern',
  'registrations:read': 'Anmeldungen lesen',
  'discord:roles': 'Discord-Rollen vergeben und entziehen',
};
const isRisky = (permission) => permission === 'network' || permission.startsWith('discord:');

function declaredPermissions(text) {
  try {
    const raw = JSON.parse(text);
    return raw && Array.isArray(raw.permissions) ? raw.permissions.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Permissions the plugin gains with the proposal: newly declared in plugin.json, plus those its code now
 * needs that the manifest still lacks (`permissionChanges.added`).
 */
export function newPermissions(proposal) {
  const manifest = (proposal.files || []).find((f) => f.path === 'plugin.json');
  const declared = manifest ? declaredPermissions(manifest.after) : [];
  const before = new Set(manifest && !manifest.isNew ? declaredPermissions(manifest.before) : []);
  const added = (proposal.permissionChanges && Array.isArray(proposal.permissionChanges.added)) ? proposal.permissionChanges.added : [];
  return [...new Set([...declared.filter((p) => !before.has(p)), ...added])];
}

const list = (className, items) => (items.length ? `<ul class="ai-notes ${className}">${items.join('')}</ul>` : '');

/** @returns {string} HTML of the permission changes, problems and dropped files of a proposal (escaped). */
export function renderProposalNotes(proposal) {
  const permissions = newPermissions(proposal).map((p) => {
    const what = PERMISSION_TEXT[p];
    return `<li class="ai-permission${isRisky(p) ? ' is-risky' : ''}"><i class="bi ${isRisky(p) ? 'bi-exclamation-triangle-fill' : 'bi-shield-check'}"></i> Neu: ${escapeHtml(p)}${what ? ` — das Plugin darf ${escapeHtml(what)}` : ''}.</li>`;
  });
  const sdk = proposal.permissionChanges && proposal.permissionChanges.sdk;
  if (sdk) permissions.push(`<li class="ai-permission"><i class="bi bi-info-circle"></i> plugin.json braucht „sdk“: ${escapeHtml(sdk)}.</li>`);
  const problem = (p) => `<li>${p.file ? `<code>${escapeHtml(p.file)}</code> ` : ''}${escapeHtml(p.message)}</li>`;
  const fresh = (proposal.newProblems || []).map(problem);
  const dropped = (proposal.dropped || []).map((d) => `<li><code>${escapeHtml(d.path)}</code> nicht übernommen: ${escapeHtml(d.reason)}</li>`);
  const old = (proposal.oldProblems || []).map(problem);
  return [
    list('ai-permissions', permissions),
    fresh.length ? `<p class="ai-notes-title is-danger">Probleme im Vorschlag</p>${list('ai-problems', fresh)}` : '',
    dropped.length ? `<p class="ai-notes-title is-warning">Verworfen</p>${list('ai-dropped', dropped)}` : '',
    old.length ? `<details class="ai-old"><summary class="studio-muted">Nicht neu, bestand schon vorher (${old.length})</summary>${list('ai-old-problems', old)}</details>` : '',
  ].join('');
}

/**
 * @param {{ unsaved?: string[], conflicts?: string[] }} options -> `unsaved`: other files whose unsaved buffer the
 *   AI worked with (one checkbox „mit speichern“ each, on); `conflicts`: files changed since the proposal (skipped).
 * @returns {string} HTML for showDialog; the checked boxes come back as `checked` (their data-check paths).
 */
export function renderApplyDialog({ unsaved = [], conflicts = [] }) {
  const parts = [];
  if (conflicts.length) {
    parts.push(`<p class="ai-conflict"><i class="bi bi-exclamation-triangle-fill"></i> Datei wurde inzwischen geändert: ${conflicts.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ')}</p>`);
    parts.push('<p class="studio-muted">Diese Dateien werden übersprungen, deine Fassung bleibt.</p>');
  }
  if (unsaved.length) {
    parts.push('<p>Ungespeichert, die KI hat damit gearbeitet:</p>');
    parts.push(`<ul class="ai-checks">${unsaved.map((p) => `<li><label class="ai-check"><input type="checkbox" data-check="${escapeHtml(p)}" checked> <code>${escapeHtml(p)}</code> mit speichern</label></li>`).join('')}</ul>`);
  }
  return parts.join('');
}

const baseName = (path) => path.split('/').pop();

function renderDiffTabs(files, active) {
  return files.map((f, i) => `
    <div class="editor-tab${i === active ? ' is-active' : ''}">
      <button type="button" class="tab-open" data-diff-tab="${i}" title="${escapeHtml(f.path)}">${escapeHtml(baseName(f.path))}${f.isNew ? ' <span class="ai-badge">neu</span>' : ''}</button>
    </div>`).join('');
}

/**
 * Shows the diff view of a proposal. Resolves 'apply', 'discard' or null (closed, Escape, `signal` aborted).
 * @param {{ proposal: object, signal?: AbortSignal, actions?: boolean }} options -> `actions`: offer
 *   „Übernehmen“/„Verwerfen“ (false for a proposal that is no longer open).
 */
export function openDiffView({ proposal, signal, actions = true }) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(null); return; }
    const files = proposal.files || [];
    const overlay = document.createElement('div');
    overlay.className = 'studio-dialog-overlay';
    overlay.innerHTML = `
      <div class="ai-diff" role="dialog" aria-modal="true" aria-label="Vorschlag der KI">
        <div class="ai-diff-head">
          <h2>Vorschlag der KI</h2>
          <button type="button" class="studio-btn" data-diff="close" title="Schließen" aria-label="Schließen"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="ai-diff-notes">${renderProposalNotes(proposal)}</div>
        <div class="editor-tabs ai-diff-tabs">${renderDiffTabs(files, 0)}</div>
        <div class="ai-diff-stage">
          <div class="ai-diff-host"></div>
          <p class="editor-message${files.length ? ' is-hidden' : ''}">Keine Datei geändert.</p>
        </div>
        <div class="studio-dialog-actions">
          ${actions ? `<button type="button" class="studio-btn" data-diff="discard">Verwerfen</button>
          <button type="button" class="studio-btn is-primary" data-diff="apply"><i class="bi bi-check2"></i> Übernehmen</button>` : ''}
        </div>
      </div>`;
    const tabsEl = overlay.querySelector('.ai-diff-tabs');
    const hostEl = overlay.querySelector('.ai-diff-host');
    const messageEl = overlay.querySelector('.editor-message');
    let monaco = null;
    let diff = null;
    let closed = false;
    const models = new Map(); // index -> { original, modified }

    function show(index) {
      tabsEl.innerHTML = renderDiffTabs(files, index);
      if (!diff || !files[index]) return;
      if (!models.has(index)) {
        const f = files[index];
        const language = editorLanguage(f.path);
        models.set(index, { original: monaco.editor.createModel(f.before || '', language), modified: monaco.editor.createModel(f.after || '', language) });
      }
      diff.setModel(models.get(index));
    }

    function finish(value) {
      if (closed) return;
      closed = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      document.removeEventListener('keydown', onKey, true);
      if (diff) diff.dispose();
      for (const { original, modified } of models.values()) { original.dispose(); modified.dispose(); }
      overlay.remove();
      resolve(value);
    }
    function onAbort() { finish(null); }
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); }
    }

    overlay.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-diff-tab]');
      if (tab) { show(Number(tab.dataset.diffTab)); return; }
      const button = event.target.closest('[data-diff]');
      if (button) finish(button.dataset.diff === 'close' ? null : button.dataset.diff);
    });
    document.addEventListener('keydown', onKey, true);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    document.body.appendChild(overlay);
    (overlay.querySelector('[data-diff="apply"]') || overlay.querySelector('[data-diff="close"]')).focus();

    if (!files.length) return;
    loadMonaco().then((loaded) => {
      if (closed) return;
      monaco = loaded;
      diff = monaco.editor.createDiffEditor(hostEl, {
        theme: 'dems',
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 14,
      });
      show(0);
    }).catch((err) => {
      if (closed) return;
      messageEl.textContent = err.message;
      messageEl.classList.remove('is-hidden');
    });
  });
}
