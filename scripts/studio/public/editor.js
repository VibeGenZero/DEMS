// Monaco editor of the studio page: loading (AMD build under /monaco/), models, themes and the
// type hints for `register(ctx)` / `register(ui)` from the plugin SDK types.

const LANGUAGES = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  css: 'css',
  json: 'json',
  md: 'markdown',
};

/** @returns {'javascript'|'css'|'json'|'markdown'|'plaintext'} */
export function editorLanguage(path) {
  const name = String(path).split('/').pop();
  const dot = name.lastIndexOf('.');
  return (dot > 0 && LANGUAGES[name.slice(dot + 1).toLowerCase()]) || 'plaintext';
}

/**
 * Tracks whether a model differs from its last saved state. `version()` taken before a save request is passed
 * to `markSaved(version)`, so edits typed while the request runs keep the model dirty.
 */
export function createDirtyTracker(model, onChange) {
  let saved = model.getAlternativeVersionId();
  let dirty = false;
  const update = () => {
    const now = model.getAlternativeVersionId() !== saved;
    if (now !== dirty) { dirty = now; onChange(now); }
  };
  const subscription = model.onDidChangeContent(update);
  return {
    version: () => model.getAlternativeVersionId(),
    markSaved(version = model.getAlternativeVersionId()) { saved = version; update(); },
    isDirty: () => dirty,
    dispose: () => subscription.dispose(),
  };
}

const HINT_TYPES = { server: 'DemsServerContext', client: 'DemsClientUi' };
const REGISTER = /(^|[^\w$.])((?:export\s+)?(?:async\s+)?(?:function\s+)?)register\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/m;

/**
 * The plugin code has no type annotation on the `register` parameter. For the language service a
 * JSDoc type is put in front of the declaration on the same line (line numbers stay).
 * @returns {{ text: string, at: number, shift: number }} `at`: where the hint went in, `shift`: its length (0 = none).
 */
export function withTypeHint(text, kind) {
  const type = HINT_TYPES[kind];
  const match = type && REGISTER.exec(text);
  if (!match) return { text, at: 0, shift: 0 };
  const at = match.index + match[1].length;
  const hint = `/** @param {${type}} ${match[3]} */ `;
  return { text: text.slice(0, at) + hint + text.slice(at), at, shift: hint.length };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Der Editor konnte nicht geladen werden (${src}).`));
    document.head.appendChild(script);
  });
}

/**
 * Monaco builds style elements at runtime and (0.58) has no option for a CSP nonce, while the page CSP only
 * accepts nonce'd style elements. So every style element created through document.createElement gets the page nonce.
 * The patch is global but only touches elements named 'style' and only adds the nonce attribute.
 */
function allowMonacoStyles() {
  const meta = document.querySelector('meta[name="csp-nonce"]');
  const nonce = meta && meta.content;
  if (!nonce || nonce === '__NONCE__') return;
  const create = document.createElement.bind(document);
  document.createElement = (name, ...rest) => {
    const element = create(name, ...rest);
    if (typeof name === 'string' && name.toLowerCase() === 'style') element.setAttribute('nonce', nonce);
    return element;
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const token = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return HEX.test(value) ? value : fallback;
};

function defineThemes(monaco) {
  const dark = document.documentElement.dataset.bsTheme !== 'light';
  const bg = token('--bg-card', dark ? '#16161f' : '#ffffff');
  const fg = token('--text-primary', dark ? '#e4e4e7' : '#313338');
  const accent = token('--accent', '#8b5cf6');
  const muted = token('--text-muted', dark ? '#8f8f9a' : '#5c5e66');
  monaco.editor.defineTheme('dems', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': muted,
      'editorCursor.foreground': accent,
      'editor.selectionBackground': `${accent}44`,
      'editor.lineHighlightBackground': `${accent}14`,
    },
  });
  monaco.editor.setTheme('dems');
}

const KINDS = {
  method: 'Method', function: 'Function', 'local function': 'Function', property: 'Property', getter: 'Property',
  setter: 'Property', var: 'Variable', let: 'Variable', const: 'Variable', parameter: 'Variable', class: 'Class',
  interface: 'Interface', keyword: 'Keyword', module: 'Module', enum: 'Enum', type: 'TypeParameter',
};

const partsText = (parts) => (Array.isArray(parts) ? parts.map((p) => p.text).join('') : String(parts || ''));

function describe(info) {
  const tags = (info.tags || []).map((t) => `*@${t.name}* ${partsText(t.text)}`.trim());
  return [partsText(info.documentation), ...tags].filter(Boolean).join('\n\n');
}

/** Completion and hover on the real model are answered by the language service from its hinted twin (the "shadow" model). */
function registerHintProviders(monaco, hints) {
  const ts = monaco.languages.typescript || monaco.typescript;
  const workerFor = async (hint) => (await ts.getJavaScriptWorker())(hint.shadow.uri);
  const shadowOffset = (hint, model, position) => {
    const offset = model.getOffsetAt(position);
    return offset >= hint.at ? offset + hint.shift : offset;
  };
  const activeHint = (model) => {
    const hint = hints.get(model.uri.toString());
    return hint && hint.shift ? hint : null;
  };

  const disposables = [];
  disposables.push(monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, position) {
      const hint = activeHint(model);
      if (!hint) return null;
      const offset = shadowOffset(hint, model, position);
      const result = await (await workerFor(hint)).getCompletionsAtPosition(hint.shadow.uri.toString(), offset);
      if (!result) return null;
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      return {
        suggestions: result.entries.map((entry) => ({
          label: entry.name,
          kind: monaco.languages.CompletionItemKind[KINDS[entry.kind] || 'Text'],
          insertText: entry.insertText || entry.name,
          sortText: entry.sortText,
          range,
          studio: { uri: hint.shadow.uri.toString(), offset },
        })),
      };
    },
    async resolveCompletionItem(item) {
      const hint = item.studio && [...hints.values()].find((h) => h.shadow.uri.toString() === item.studio.uri);
      if (!hint) return item;
      const details = await (await workerFor(hint)).getCompletionEntryDetails(item.studio.uri, item.studio.offset, item.label);
      if (details) {
        item.detail = partsText(details.displayParts);
        item.documentation = { value: describe(details) };
      }
      return item;
    },
  }));

  disposables.push(monaco.languages.registerHoverProvider('javascript', {
    async provideHover(model, position) {
      const hint = activeHint(model);
      if (!hint) return null;
      const info = await (await workerFor(hint)).getQuickInfoAtPosition(hint.shadow.uri.toString(), shadowOffset(hint, model, position));
      if (!info) return null;
      const start = info.textSpan.start >= hint.at + hint.shift ? info.textSpan.start - hint.shift : info.textSpan.start;
      const from = model.getPositionAt(start);
      const to = model.getPositionAt(start + info.textSpan.length);
      const fence = '```';
      return {
        range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column },
        contents: [{ value: `${fence}ts\n${partsText(info.displayParts)}\n${fence}` }, { value: describe(info) }].filter((c) => c.value),
      };
    },
  }));
  return { dispose: () => disposables.forEach((d) => d.dispose()) };
}

let monacoPromise = null;

/** Loads Monaco once; resolves with the global `monaco`. */
export function loadMonaco() {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      allowMonacoStyles();
      await loadScript('/monaco/vs/loader.js');
      window.require.config({ paths: { vs: '/monaco/vs' } });
      await new Promise((resolve, reject) => window.require(['vs/editor/editor.main'], resolve, reject));
      const monaco = window.monaco;
      const ts = monaco.languages.typescript || monaco.typescript;
      ts.javascriptDefaults.setCompilerOptions({ allowJs: true, checkJs: false, allowNonTsExtensions: true, target: 99, noLib: false });
      ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
      ts.javascriptDefaults.setEagerModelSync(true);
      try {
        const response = await fetch('/types/dems-plugin.d.ts');
        if (response.ok) ts.javascriptDefaults.addExtraLib(await response.text(), 'file:///dems-plugin.d.ts');
      } catch { /* completion for ctx/ui is missing, editing still works */ }
      defineThemes(monaco);
      const scheme = window.matchMedia('(prefers-color-scheme: dark)');
      scheme.addEventListener('change', () => {
        document.documentElement.dataset.bsTheme = scheme.matches ? 'dark' : 'light';
        defineThemes(monaco);
      });
      return monaco;
    })();
    monacoPromise.catch(() => { monacoPromise = null; });
  }
  return monacoPromise;
}

const pathUri = (monaco, prefix, path) => monaco.Uri.parse(`file:///${prefix}${path.split('/').map(encodeURIComponent).join('/')}`);

/**
 * One editor instance with one model per open file.
 * @param {HTMLElement} container
 * @param {{ onDirty(path: string, dirty: boolean): void, onSave(path: string): void }} handlers
 */
export async function createEditorHost(container, { onDirty, onSave }) {
  const monaco = await loadMonaco();
  const hints = new Map(); // real model uri -> { shadow, at, shift, kind }
  const providers = registerHintProviders(monaco, hints);
  const editor = monaco.editor.create(container, {
    model: null,
    theme: 'dems',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    tabSize: 4,
    scrollBeyondLastLine: false,
  });
  const entries = new Map(); // path -> { model, saved, viewState, kind, dirty, listener }

  function refreshHint(entry) {
    const hint = hints.get(entry.model.uri.toString());
    const next = withTypeHint(entry.model.getValue(), hint.kind);
    hint.at = next.at;
    hint.shift = next.shift;
    hint.shadow.setValue(next.text);
  }

  // addCommand has no disposable (its keybinding would outlive the editor); an action does.
  const saveAction = editor.addAction({
    id: 'studio.save',
    label: 'Speichern',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
    run() {
      const active = [...entries.entries()].find(([, e]) => e.model === editor.getModel());
      if (active) onSave(active[0]);
    },
  });
  let disposed = false;

  const host = {
    editor,
    has: (path) => entries.has(path),
    /** Adds a model for `path` (no-op when open). `kind`: 'server' | 'client' | null. */
    add(path, content, kind) {
      if (disposed || entries.has(path)) return;
      const model = monaco.editor.createModel(content, editorLanguage(path), pathUri(monaco, '', path));
      const entry = { model, viewState: null };
      entry.tracker = createDirtyTracker(model, (dirty) => onDirty(path, dirty));
      entry.listener = model.onDidChangeContent(() => {
        if (hints.has(model.uri.toString())) refreshHint(entry);
      });
      entries.set(path, entry);
      if (kind && editorLanguage(path) === 'javascript') {
        const start = withTypeHint(content, kind);
        const shadow = monaco.editor.createModel(start.text, 'javascript', pathUri(monaco, '__studio_hint__/', path));
        hints.set(model.uri.toString(), { shadow, kind, at: start.at, shift: start.shift });
      }
    },
    show(path) {
      if (disposed) return;
      const current = [...entries.values()].find((e) => e.model === editor.getModel());
      if (current) current.viewState = editor.saveViewState();
      const entry = path && entries.get(path);
      editor.setModel(entry ? entry.model : null);
      if (entry) {
        if (entry.viewState) editor.restoreViewState(entry.viewState);
        editor.focus();
      }
    },
    value: (path) => entries.get(path).model.getValue(),
    /** Replaces the content with the file as it is on disk; the tab is clean afterwards. */
    reload(path, content) {
      const entry = entries.get(path);
      if (disposed || !entry) return;
      if (entry.model.getValue() !== content) entry.model.setValue(content);
      entry.tracker.markSaved();
    },
    /** Version id of the model now; take it before a save request and pass it to markSaved. */
    version: (path) => entries.get(path).tracker.version(),
    markSaved: (path, version) => entries.get(path).tracker.markSaved(version),
    close(path) {
      const entry = entries.get(path);
      if (!entry) return;
      if (editor.getModel() === entry.model) editor.setModel(null);
      entry.listener.dispose();
      entry.tracker.dispose();
      const key = entry.model.uri.toString();
      if (hints.has(key)) { hints.get(key).shadow.dispose(); hints.delete(key); }
      entry.model.dispose();
      entries.delete(path);
    },
    closeAll() { [...entries.keys()].forEach((p) => host.close(p)); },
    /** Closes all models and removes the editor and the completion/hover providers. */
    dispose() {
      host.closeAll();
      disposed = true;
      saveAction.dispose();
      providers.dispose();
      editor.dispose();
    },
  };
  return host;
}
