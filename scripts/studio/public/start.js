// Start page: create a plugin, open a folder, recent list.
import { escapeHtml, showToast } from './ui.js';

function recentItem(entry) {
  const missing = entry.exists === false;
  const dir = escapeHtml(entry.dir);
  return `
    <li class="recent-item${missing ? ' is-missing' : ''}">
      <div class="recent-text">
        <strong>${escapeHtml(entry.name || entry.id)}</strong>
        <span class="recent-dir">${dir}</span>
        ${missing ? '<span class="recent-note">Ordner nicht gefunden</span>' : ''}
      </div>
      <div class="recent-actions">
        <button type="button" class="studio-btn is-primary" data-action="open" data-dir="${dir}"${missing ? ' disabled' : ''}>Öffnen</button>
        <button type="button" class="studio-btn" data-action="remove" data-dir="${dir}">Entfernen</button>
      </div>
    </li>`;
}

/** @returns {string} HTML of the start page. */
export function renderStartPage({ recent = [] } = {}) {
  const list = recent.length
    ? `<ul class="recent-list">${recent.map(recentItem).join('')}</ul>`
    : '<p class="studio-muted">Noch keine Plugins geöffnet.</p>';
  return `
    <main class="start">
      <header class="start-header">
        <i class="bi bi-puzzle"></i>
        <h1>DEMS Plugin-Studio</h1>
      </header>
      <div class="start-grid">
        <section class="studio-card">
          <h2>Neues Plugin</h2>
          <form data-form="new">
            <label class="studio-field"><span>Plugin-ID</span>
              <input type="text" class="studio-input" name="id" placeholder="mein-plugin" autocomplete="off" required></label>
            <label class="studio-field"><span>Ordner</span>
              <input type="text" class="studio-input" name="parentDir" placeholder="Übergeordneter Ordner, z. B. C:\Plugins" autocomplete="off" required></label>
            <button type="submit" class="studio-btn is-primary">Plugin anlegen</button>
          </form>
        </section>
        <section class="studio-card">
          <h2>Plugin öffnen</h2>
          <form data-form="open">
            <label class="studio-field"><span>Pfad zum Plugin-Ordner</span>
              <input type="text" class="studio-input" name="dir" placeholder="C:\Plugins\mein-plugin" autocomplete="off" required></label>
            <button type="submit" class="studio-btn is-primary">Öffnen</button>
          </form>
        </section>
      </div>
      <section class="studio-card">
        <h2>Zuletzt geöffnet</h2>
        ${list}
      </section>
    </main>`;
}

/**
 * Renders the start page into `root`; `onOpened(plugin)` runs when a plugin was opened or created.
 * @returns {() => void} Removes the listeners again.
 */
export function mountStart(root, { api, recent, onOpened }) {
  const controller = new AbortController();
  const { signal } = controller;
  let current = recent;
  const render = () => { root.innerHTML = renderStartPage({ recent: current }); };
  render();

  let busy = false; // a double-click sends one request
  async function run(task) {
    if (busy) return;
    busy = true;
    try {
      const { plugin } = await task();
      if (!signal.aborted) onOpened(plugin);
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      busy = false;
    }
  }

  root.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === 'new') run(() => api.create(String(data.get('id')).trim(), String(data.get('parentDir')).trim()));
    else run(() => api.open(String(data.get('dir')).trim()));
  }, { signal });

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const dir = button.dataset.dir;
    if (button.dataset.action === 'open') run(() => api.open(dir));
    if (button.dataset.action === 'remove') {
      try {
        ({ recent: current } = await api.removeRecent(dir));
        render();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    }
  }, { signal });
  return () => controller.abort();
}
