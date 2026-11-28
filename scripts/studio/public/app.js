// Entry of the studio page: start page or workspace, depending on the studio state.
import { createApi, takeToken } from './api.js';
import { mountStart } from './start.js';
import { mountWorkspace } from './workspace.js';
import { mountPreview } from './preview.js';
import { mountDebug } from './debug.js';
import { mountToolbar } from './toolbar.js';
import { escapeHtml, showToast } from './ui.js';

const root = document.getElementById('app');
const scheme = window.matchMedia('(prefers-color-scheme: dark)');
const applyScheme = () => { document.documentElement.dataset.bsTheme = scheme.matches ? 'dark' : 'light'; };
applyScheme();
scheme.addEventListener('change', applyScheme);

function fail(message) {
  root.innerHTML = `<main class="start"><section class="studio-card"><h2>Das Studio ist nicht verbunden</h2><p>${escapeHtml(message)}</p></section></main>`;
}

async function main() {
  const token = takeToken(window.location, window.history);
  if (!token) return fail('Der Zugangsschlüssel fehlt. Öffne das Studio über den Link, den „npm run plugin -- studio“ ausgibt.');
  const api = createApi({ token });
  let disposeView = () => {}; // removes listeners and editor of the view on screen
  let opening = false;

  function swapView(dispose) {
    disposeView();
    disposeView = dispose;
  }

  async function showStart() {
    const state = await api.state();
    swapView(() => {});
    swapView(mountStart(root, { api, recent: state.recent, onOpened: showWorkspace }));
  }

  // Preview, debug panel and toolbar share one lifetime (signal) with the workspace; returns the joint disposer.
  async function mountTools(workspace) {
    const controller = new AbortController();
    const { signal } = controller;
    const dispose = () => { controller.abort(); workspace.dispose(); };
    try {
      const state = await api.state();
      const preview = mountPreview(workspace.previewArea, { api, previewUrl: state.previewUrl, status: state.child, signal });
      mountDebug(preview.debugArea, {
        api,
        signal,
        onLifecycle: (data) => preview.setStatus(data.status),
        onFiles: () => { workspace.diskChanged(); },
        onError: () => workspace.ai.pluginError(),
      });
      mountToolbar(workspace.toolbarArea, { api, signal, dirtyCount: workspace.dirtyCount, saveAll: workspace.saveAll, openAiSettings: workspace.ai.openSettings });
    } catch (err) {
      dispose();
      throw err;
    }
    return dispose;
  }

  async function showWorkspace(plugin) {
    if (opening) return;
    opening = true;
    try {
      swapView(() => {});
      const workspace = await mountWorkspace(root, { api, plugin, onLeave: showStart });
      swapView(await mountTools(workspace));
      document.dispatchEvent(new CustomEvent('studio:workspace', { detail: { api, plugin, workspace } }));
    } catch (err) {
      showToast(err.message, 'danger');
      try { await showStart(); } catch (again) { fail(again.message); }
    } finally {
      opening = false;
    }
  }

  const state = await api.state();
  if (state.plugin) await showWorkspace(state.plugin);
  else swapView(mountStart(root, { api, recent: state.recent, onOpened: showWorkspace }));
}

main().catch((err) => fail(err.message));
