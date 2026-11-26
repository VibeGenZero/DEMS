// Workspace: file list, editor tabs, save/dirty handling and the area for the preview (next to the editor).
import { createEditorHost } from './editor.js';
import { askConfirm, askText, confirmDiscard, escapeHtml, showToast } from './ui.js';

/** 'client' for the manifest client entry and `assets/*.js`, 'server' for other .js files, else null. */
export function typeLibFor(path, manifest) {
  if (!/\.(js|mjs|cjs)$/i.test(path)) return null;
  if ((manifest && manifest.client === path) || path.startsWith('assets/')) return 'client';
  return 'server';
}

const baseName = (path) => path.split('/').pop();

/** @returns {string} HTML list of the plugin files. */
export function renderFileList(files, { active = null, dirty = new Set() } = {}) {
  if (!files.length) return '<p class="studio-muted">Keine Dateien.</p>';
  const items = files.map((file) => {
    const path = escapeHtml(file.path);
    const openable = file.text && file.allowed;
    const classes = ['file-item'];
    if (file.path === active) classes.push('is-active');
    if (dirty.has(file.path)) classes.push('is-dirty');
    if (!openable) classes.push('is-binary');
    return `
      <li class="${classes.join(' ')}">
        <button type="button" class="file-open" data-action="file" data-path="${path}" title="${path}">
          <i class="bi ${openable ? 'bi-file-earmark-code' : 'bi-file-earmark'}"></i>
          <span class="file-name">${path}</span>${dirty.has(file.path) ? '<span class="dirty-dot" aria-label="Ungespeichert">●</span>' : ''}
        </button>
        <button type="button" class="file-tool" data-action="rename" data-path="${path}" title="Umbenennen" aria-label="Umbenennen"><i class="bi bi-pencil"></i></button>
        <button type="button" class="file-tool" data-action="delete" data-path="${path}" title="Löschen" aria-label="Löschen"><i class="bi bi-trash"></i></button>
      </li>`;
  });
  return `<ul class="file-list">${items.join('')}</ul>`;
}

function renderTabs(tabs, { active, dirty }) {
  return tabs.map((path) => `
    <div class="editor-tab${path === active ? ' is-active' : ''}">
      <button type="button" class="tab-open" data-action="tab" data-path="${escapeHtml(path)}" title="${escapeHtml(path)}">${escapeHtml(baseName(path))}${dirty.has(path) ? ' <span class="dirty-dot" aria-label="Ungespeichert">●</span>' : ''}</button>
      <button type="button" class="tab-close" data-action="close" data-path="${escapeHtml(path)}" title="Schließen" aria-label="Schließen"><i class="bi bi-x"></i></button>
    </div>`).join('');
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * @param {HTMLElement} root
 * @param {{ api: object, plugin: { name: string, version: string, id: string }, onLeave(): void }} options
 * @returns {Promise<{ previewArea: HTMLElement, toolbarArea: HTMLElement, dirtyCount(): number, dispose(): void }>}
 *   `previewArea` and `toolbarArea` are left empty for the preview, debug panel and toolbar.
 */
export async function mountWorkspace(root, { api, plugin, onLeave }) {
  root.innerHTML = `
    <div class="workspace">
      <header class="ws-header">
        <div class="ws-title"><i class="bi bi-puzzle"></i> <strong>${escapeHtml(plugin.name || plugin.id)}</strong> <span class="studio-muted">${escapeHtml(plugin.version || '')}</span></div>
        <div class="ws-toolbar" id="studio-toolbar"></div>
        <button type="button" class="studio-btn" data-action="leave">Plugin wechseln</button>
      </header>
      <div class="ws-columns">
        <aside class="ws-files">
          <div class="ws-files-head">
            <strong>Dateien</strong>
            <span>
              <button type="button" class="studio-btn" data-action="new-file"><i class="bi bi-plus-lg"></i> Datei</button>
              <button type="button" class="studio-btn" data-action="upload" title="Datei hochladen" aria-label="Datei hochladen"><i class="bi bi-upload"></i></button>
            </span>
          </div>
          <div id="file-list"></div>
          <input type="file" id="upload-input" class="is-hidden">
        </aside>
        <section class="ws-editor">
          <div class="editor-tabs" id="editor-tabs"></div>
          <div class="editor-stage">
            <div id="editor-host"></div>
            <div id="editor-message" class="editor-message is-hidden"></div>
          </div>
        </section>
        <section class="ws-preview" id="studio-preview">
          <p class="studio-muted">Die Vorschau erscheint hier.</p>
        </section>
      </div>
    </div>`;

  const $ = (selector) => root.querySelector(selector);
  const fileListEl = $('#file-list');
  const tabsEl = $('#editor-tabs');
  const messageEl = $('#editor-message');
  const hostEl = $('#editor-host');

  const dirty = new Set();
  let files = [];
  let tabs = [];
  let active = null;
  let manifest = null;

  const editorHost = await createEditorHost(hostEl, {
    onDirty(path, isDirty) {
      if (isDirty) dirty.add(path); else dirty.delete(path);
      render();
    },
    onSave: (path) => save(path),
  });

  function render() {
    fileListEl.innerHTML = renderFileList(files, { active, dirty });
    tabsEl.innerHTML = renderTabs(tabs, { active, dirty });
  }

  function showMessage(text) {
    messageEl.textContent = text;
    messageEl.classList.toggle('is-hidden', !text);
    hostEl.classList.toggle('is-hidden', Boolean(text));
  }

  async function refreshFiles() {
    ({ files } = await api.listFiles());
    render();
  }

  async function loadManifest() {
    try {
      manifest = JSON.parse(await api.readFile('plugin.json'));
    } catch { manifest = null; }
  }

  async function openFile(path) {
    const info = files.find((f) => f.path === path);
    if (!info || !info.text || !info.allowed) {
      active = null;
      editorHost.show(null);
      showMessage(`Kann nicht im Editor geöffnet werden: ${path}`);
      render();
      return;
    }
    if (!editorHost.has(path)) {
      try {
        editorHost.add(path, await api.readFile(path), typeLibFor(path, manifest));
      } catch (err) {
        showMessage(err.message);
        return;
      }
      tabs.push(path);
    }
    active = path;
    showMessage('');
    editorHost.show(path);
    render();
  }

  async function save(path = active) {
    if (!path || !editorHost.has(path)) return;
    try {
      await api.saveFile(path, editorHost.value(path));
      editorHost.markSaved(path);
      if (path === 'plugin.json') await loadManifest();
      showToast(`Gespeichert: ${path}`, 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  async function closeTab(path) {
    if (dirty.has(path) && !(await confirmDiscard())) return;
    editorHost.close(path);
    dirty.delete(path);
    tabs = tabs.filter((p) => p !== path);
    if (active === path) {
      active = tabs[tabs.length - 1] || null;
      editorHost.show(active);
      if (!active) showMessage('');
    }
    render();
  }

  async function createFile() {
    const name = await askText({ title: 'Neue Datei', label: 'Dateiname (z. B. lib/helfer.js)', confirmLabel: 'Anlegen' });
    if (!name) return;
    try {
      await api.createFile(name);
      await refreshFiles();
      await openFile(name);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  async function renameFile(path) {
    if (dirty.has(path)) { showToast('Bitte die Datei zuerst speichern oder verwerfen.', 'warning'); return; }
    const to = await askText({ title: 'Datei umbenennen', label: 'Neuer Name', value: path, confirmLabel: 'Umbenennen' });
    if (!to || to === path) return;
    try {
      await api.renameFile(path, to);
      if (editorHost.has(path)) await closeTab(path);
      await refreshFiles();
      if (path === 'plugin.json' || to === 'plugin.json') await loadManifest();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  async function deleteFile(path) {
    if (!(await askConfirm({ title: 'Datei löschen?', message: `${path} wird gelöscht.`, confirmLabel: 'Löschen' }))) return;
    try {
      await api.deleteFile(path);
      if (editorHost.has(path)) { dirty.delete(path); await closeTab(path); }
      await refreshFiles();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  async function upload(file) {
    const target = await askText({ title: 'Datei hochladen', label: 'Zielpfad im Plugin', value: `assets/${file.name}`, confirmLabel: 'Hochladen' });
    if (!target) return;
    try {
      await api.uploadFile(target, toBase64(await file.arrayBuffer()));
      await refreshFiles();
      showToast(`Hochgeladen: ${target}`, 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  const handlers = {
    file: (path) => openFile(path),
    tab: (path) => openFile(path),
    close: (path) => closeTab(path),
    rename: (path) => renameFile(path),
    delete: (path) => deleteFile(path),
    'new-file': () => createFile(),
    upload: () => $('#upload-input').click(),
    async leave() {
      if (dirty.size && !(await confirmDiscard())) return;
      onLeave();
    },
  };

  root.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    const handler = button && handlers[button.dataset.action];
    if (handler) handler(button.dataset.path);
  });
  $('#upload-input').addEventListener('change', (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (file) upload(file);
  });

  const onKey = (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
      // Monaco handles Ctrl+S itself while the editor has focus (and marks the event); elsewhere the page does.
      if (!event.defaultPrevented) { event.preventDefault(); save(); }
    }
  };
  const onBeforeUnload = (event) => {
    if (dirty.size) { event.preventDefault(); event.returnValue = ''; }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onBeforeUnload);

  await loadManifest();
  await refreshFiles();
  const first = ['server.js', 'plugin.json'].find((p) => files.some((f) => f.path === p));
  if (first) await openFile(first);

  return {
    previewArea: $('#studio-preview'),
    toolbarArea: $('#studio-toolbar'),
    dirtyCount: () => dirty.size,
    dispose() {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
      editorHost.closeAll();
      editorHost.editor.dispose();
    },
  };
}
