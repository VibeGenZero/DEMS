// Toolbar of the studio: check, build and the VS Code link.
import { escapeHtml, showDialog, showToast } from './ui.js';

const lineList = (lines) => (lines.length ? `<ul class="report-lines">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '');
// Errors from check and build already start with „Fehler: “.
const errorList = (errors) => (errors.length ? `<ul class="report-lines report-errors">${errors.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '');

/** @returns {string} HTML of the check result (message body of the dialog). */
export function renderCheckDialog({ lines = [], errors = [] }) {
  if (!lines.length && !errors.length) return '<p>Alles in Ordnung.</p>';
  return `${lineList(lines)}${errorList(errors)}`;
}

/** @returns {string} HTML of the build preview: what goes into the package. */
export function renderBuildPreview({ lines = [] }) {
  return `${lineList(lines)}<p class="studio-muted">Die Datei wird über den Download deines Browsers gespeichert.</p>`;
}

/**
 * Dialog of „Bauen“: the package preview and, with unsaved tabs, the hint that the disk state is built
 * plus „Alle speichern und bauen“ (also when the disk state is blocked: saving may fix it).
 * @returns {{ html: string, buttons: Array<{ label: string, value: string|false, className?: string, primary?: boolean }> }}
 */
export function buildDialog(preview, dirty = 0) {
  const blocked = preview.errors.length > 0;
  const unsaved = dirty > 0
    ? `<p class="report-unsaved">${escapeHtml(dirty)} ungespeicherte Datei(en) \u2013 gebaut wird der Stand auf der Platte.</p>`
    : '';
  const buttons = [{ label: 'Abbrechen', value: false }];
  if (!blocked) buttons.push({ label: '\u00dcbernehmen und bauen', value: 'build', ...(dirty ? {} : { className: 'is-primary', primary: true }) });
  if (dirty) buttons.push({ label: 'Alle speichern und bauen', value: 'save-all', className: 'is-primary', primary: true });
  return { html: `${unsaved}${renderBuildPreview(preview)}${errorList(preview.errors)}`, buttons };
}

/** Only links into VS Code's `file` handler are followed. */
export function isVscodeUrl(url) {
  return typeof url === 'string' && url.startsWith('vscode://file/');
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * @param {HTMLElement} area
 * @param {{ api: object, signal: AbortSignal, dirtyCount?: () => number, saveAll?: () => Promise<boolean> }} options
 *   -> `dirtyCount`/`saveAll`: the workspace's unsaved tabs, for „Bauen“.
 */
export function mountToolbar(area, { api, signal, dirtyCount = () => 0, saveAll = async () => true }) {
  area.innerHTML = `
    <button type="button" class="studio-btn" data-tool="check"><i class="bi bi-check2-circle"></i> Prüfen</button>
    <button type="button" class="studio-btn is-primary" data-tool="build"><i class="bi bi-box-seam"></i> Bauen</button>
    <button type="button" class="studio-btn" data-tool="vscode"><i class="bi bi-code-slash"></i> In VS Code öffnen</button>`;

  async function check() {
    const report = await api.check();
    if (signal.aborted) return;
    await showDialog({
      title: report.errors.length ? 'Prüfung: Fehler gefunden' : 'Prüfung',
      html: renderCheckDialog(report),
      buttons: [{ label: 'Schließen', value: true, className: 'is-primary', primary: true }],
      signal,
    });
  }

  async function build() {
    const preview = await api.buildPreview();
    if (signal.aborted) return;
    const { html, buttons } = buildDialog(preview, dirtyCount());
    const answer = await showDialog({ title: 'Bauen', html, buttons, signal });
    if (signal.aborted || !answer || !answer.value) return;
    if (answer.value === 'save-all') {
      const saved = await saveAll();
      if (signal.aborted) return;
      if (!saved) { showToast('Nicht alle Dateien wurden gespeichert \u2013 es wird nicht gebaut.', 'warning'); return; }
    }
    const { blob, fileName } = await api.buildDownload();
    if (signal.aborted) return;
    saveBlob(blob, fileName);
    showToast(`Gebaut: ${fileName}`, 'success');
  }

  async function vscode() {
    const { url } = await api.vscode();
    if (signal.aborted) return;
    if (!isVscodeUrl(url)) { showToast('VS Code konnte nicht geöffnet werden.', 'danger'); return; }
    location.href = url;
  }

  const tools = { check, build, vscode };
  area.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-tool]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await tools[button.dataset.tool]();
    } catch (err) {
      if (!signal.aborted) showToast(err.message, 'danger');
    } finally {
      button.disabled = false;
    }
  }, { signal });
}
