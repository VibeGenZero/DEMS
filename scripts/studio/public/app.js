// Entry of the studio page: start page or workspace, depending on the studio state.
import { createApi, takeToken } from './api.js';
import { mountStart } from './start.js';
import { mountWorkspace } from './workspace.js';
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
  let workspace = null;

  async function showStart() {
    if (workspace) { workspace.dispose(); workspace = null; }
    const state = await api.state();
    mountStart(root, { api, recent: state.recent, onOpened: showWorkspace });
  }

  async function showWorkspace(plugin) {
    try {
      workspace = await mountWorkspace(root, { api, plugin, onLeave: showStart });
      window.studio = { api, workspace, root };
      document.dispatchEvent(new CustomEvent('studio:workspace', { detail: { api, plugin, workspace } }));
    } catch (err) {
      showToast(err.message, 'danger');
      await showStart();
    }
  }

  const state = await api.state();
  if (state.plugin) await showWorkspace(state.plugin);
  else mountStart(root, { api, recent: state.recent, onOpened: showWorkspace });
}

main().catch((err) => fail(err.message));
