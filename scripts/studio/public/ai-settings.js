// „KI-Einstellungen“ of the studio: provider, address, key, model and limits of the studio's own AI
// connection. The key is typed here and sent once; the page never gets it back (`apiKeySet` only).
import { escapeHtml, showToast } from './ui.js';

const OLLAMA_HINT = 'Lokale Modelle brauchen viel Kontext. Setze in Ollama die Kontextlänge mindestens auf den Wert „Kontextlänge“ hier (Standard 32768, <code>OLLAMA_CONTEXT_LENGTH</code>), sonst schneidet Ollama das SDK-Wissen ab.';
const defaultContext = (provider) => (provider === 'ollama' ? 32768 : 128000);
const providerOf = (view, id) => (Array.isArray(view.providers) ? view.providers.find((p) => p.id === id) : null) || null;
const endpointOf = (view, provider, baseUrl) => {
  const entry = providerOf(view, provider);
  return String(baseUrl || (entry ? entry.defaultBaseUrl : '')).trim().replace(/\/+$/, '');
};

/**
 * True when saving `typed` keeps the stored key: same provider and address, as `save` in settings.js decides.
 * @param {object} stored -> The settings view (`apiKeySet`, `provider`, `baseUrl`, `providers`).
 * @param {{ provider: string, baseUrl: string }} typed
 */
export function keyKept(stored, typed) {
  return Boolean(stored && stored.apiKeySet && typed.provider === stored.provider
    && endpointOf(stored, typed.provider, typed.baseUrl) === endpointOf(stored, stored.provider, stored.baseUrl));
}

/** @returns {string} -> Placeholder of the key field: „gespeichert“ only while the stored key stays. */
export function keyHint(view) {
  const entry = providerOf(view, view.provider);
  if (view.apiKeySet) return 'gespeichert';
  if (entry && !entry.keyRequired) return 'nur für die Cloud nötig';
  return 'API-Schlüssel';
}

/** True when a chat can start: provider, model and, where the provider needs one, a stored key. */
export function isConfiguredView(view) {
  const entry = view && providerOf(view, view.provider);
  return Boolean(entry && view.model && (!entry.keyRequired || view.apiKeySet));
}

const input = (name, label, attrs = '') => `
  <label class="studio-field">
    <span>${escapeHtml(label)}</span>
    <input class="studio-input" data-field="${name}" autocomplete="off" ${attrs}>
  </label>`;

/** @returns {string} HTML of the settings form; the key field never carries a value. */
export function renderSettingsForm(view) {
  const providers = Array.isArray(view.providers) ? view.providers : [];
  const entry = providerOf(view, view.provider);
  const options = [
    `<option value=""${entry ? '' : ' selected'}>Bitte wählen …</option>`,
    ...providers.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === view.provider ? ' selected' : ''}>${escapeHtml(p.label)}</option>`),
  ].join('');
  const ollama = view.provider === 'ollama';
  return `
    <label class="studio-field">
      <span>Anbieter</span>
      <select class="studio-input" data-field="provider">${options}</select>
    </label>
    ${ollama ? `<div class="ai-presets"><span class="studio-muted">Ollama:</span>
      <button type="button" class="studio-btn" data-preset="local">Lokal</button>
      <button type="button" class="studio-btn" data-preset="cloud">Cloud</button></div>` : ''}
    ${input('baseUrl', 'Adresse (Base URL)', `type="url" value="${escapeHtml(view.baseUrl || '')}" placeholder="${escapeHtml(entry ? entry.defaultBaseUrl : '')}"`)}
    ${input('apiKey', 'API-Schlüssel', `type="password" placeholder="${escapeHtml(keyHint(view))}"`)}
    <label class="studio-field">
      <span>Modell</span>
      <span class="ai-model-row">
        <input class="studio-input" data-field="model" list="ai-model-options" autocomplete="off" value="${escapeHtml(view.model || '')}">
        <button type="button" class="studio-btn" data-ai-settings="models"><i class="bi bi-list-ul"></i> Modelle laden</button>
      </span>
      <datalist id="ai-model-options"></datalist>
    </label>
    <div class="ai-number-row">
      ${input('maxTokens', 'Maximale Antwortlänge (Tokens)', `type="number" min="1024" max="64000" step="1" value="${escapeHtml(view.maxTokens)}"`)}
      ${input('contextTokens', 'Kontextlänge (Tokens)', `type="number" min="8192" max="1000000" step="1" value="${escapeHtml(view.contextTokens)}"`)}
    </div>
    ${ollama ? `<p class="ai-hint"><i class="bi bi-info-circle"></i> ${OLLAMA_HINT}</p>` : ''}
    <div class="ai-test-row">
      <button type="button" class="studio-btn" data-ai-settings="test"><i class="bi bi-plug"></i> Verbindung testen</button>
      <span class="ai-test-result" role="status"></span>
    </div>
    <p class="ai-form-error is-hidden" role="alert"></p>`;
}

/**
 * Opens the settings dialog. Resolves true after a successful save, false on cancel (or when `signal` aborts).
 * @param {{ api: object, signal?: AbortSignal }} options
 */
export async function openAiSettings({ api, signal }) {
  const stored = await api.aiSettings();
  if (signal && signal.aborted) return false;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'studio-dialog-overlay';
    overlay.innerHTML = `
      <div class="studio-dialog ai-settings" role="dialog" aria-modal="true" aria-label="KI-Einstellungen">
        <h2>KI-Einstellungen</h2>
        <div class="ai-settings-form"></div>
        <div class="studio-dialog-actions">
          <button type="button" class="studio-btn" data-ai-settings="cancel">Abbrechen</button>
          <button type="button" class="studio-btn is-primary" data-ai-settings="save">Speichern</button>
        </div>
      </div>`;
    const formEl = overlay.querySelector('.ai-settings-form');
    let view = { ...stored };
    const field = (name) => formEl.querySelector(`[data-field="${name}"]`);
    const read = () => ({
      provider: field('provider').value,
      baseUrl: field('baseUrl').value.trim(),
      apiKey: field('apiKey').value.trim(),
      model: field('model').value.trim(),
      maxTokens: field('maxTokens').value.trim(),
      contextTokens: field('contextTokens').value.trim(),
    });
    const connection = () => {
      const { provider, baseUrl, apiKey, model } = read();
      return { provider, baseUrl, apiKey, model };
    };
    const draw = () => { formEl.innerHTML = renderSettingsForm(view); };
    const setError = (text) => {
      const el = formEl.querySelector('.ai-form-error');
      el.textContent = text || '';
      el.classList.toggle('is-hidden', !text);
    };
    const setResult = (text, kind) => {
      const el = formEl.querySelector('.ai-test-result');
      el.textContent = text;
      el.className = `ai-test-result${kind ? ` is-${kind}` : ''}`;
    };

    function finish(saved) {
      if (signal) signal.removeEventListener('abort', onAbort);
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(saved);
    }
    function onAbort() { finish(false); }
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
    }

    // Another provider: its default address and context length; a stored key belongs to the stored connection only
    function providerChanged() {
      const typed = read();
      const next = providerOf(view, typed.provider);
      const contextWasDefault = Number(typed.contextTokens) === defaultContext(view.provider);
      const baseUrl = next ? next.defaultBaseUrl : '';
      view = {
        ...view,
        ...typed,
        baseUrl,
        contextTokens: contextWasDefault ? defaultContext(typed.provider) : typed.contextTokens,
        apiKeySet: keyKept(stored, { provider: typed.provider, baseUrl }),
      };
      draw();
    }
    // Another address (typed or a preset): the key placeholder follows what a save would do with the key
    function addressChanged() {
      const typed = read();
      view = { ...view, apiKeySet: keyKept(stored, typed) };
      field('apiKey').placeholder = keyHint({ ...view, provider: typed.provider });
    }

    async function run(action, button) {
      if (action === 'cancel') { finish(false); return; }
      button.disabled = true;
      setError('');
      try {
        if (action === 'test') {
          setResult('Teste …', '');
          const result = await api.testAi(connection());
          if (!overlay.isConnected) return;
          if (result.ok) setResult(`Verbindung steht${result.ms !== undefined ? ` (${result.ms} ms)` : ''}.`, 'success');
          else setResult(result.error || 'Die Verbindung ist fehlgeschlagen.', 'danger');
        } else if (action === 'models') {
          const { models } = await api.aiModels(connection());
          if (!overlay.isConnected) return;
          const list = Array.isArray(models) ? models.filter((m) => typeof m === 'string') : [];
          formEl.querySelector('#ai-model-options').innerHTML = list.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
          setResult(list.length ? `${list.length} Modelle gefunden – wähle eins im Feld „Modell“.` : 'Keine Modelle gefunden.', list.length ? 'success' : 'warning');
        } else if (action === 'save') {
          await api.saveAiSettings(read());
          if (!overlay.isConnected) return;
          showToast('KI-Einstellungen gespeichert.', 'success');
          finish(true);
          return;
        }
      } catch (err) {
        if (overlay.isConnected) {
          if (action === 'save') setError(err.message);
          else setResult(err.message, 'danger');
        }
      }
      button.disabled = false;
    }

    overlay.addEventListener('click', (event) => {
      const preset = event.target.closest('[data-preset]');
      if (preset) {
        const url = (stored.ollamaPresets || {})[preset.dataset.preset];
        if (url) { field('baseUrl').value = url; addressChanged(); }
        return;
      }
      const button = event.target.closest('[data-ai-settings]');
      if (button && !button.disabled) run(button.dataset.aiSettings, button);
    });
    overlay.addEventListener('change', (event) => {
      if (event.target.matches('[data-field="provider"]')) providerChanged();
    });
    overlay.addEventListener('input', (event) => {
      if (event.target.matches('[data-field="baseUrl"]')) addressChanged();
    });
    document.addEventListener('keydown', onKey, true);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    draw();
    document.body.appendChild(overlay);
    field('provider').focus();
  });
}
