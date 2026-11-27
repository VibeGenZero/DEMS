// API client of the studio page. The token arrives once in the URL fragment, is removed from the
// address bar right away and lives only in this module's memory.

/** Reads `#token=<hex>` once and clears the fragment; null when there is none. */
export function takeToken(location, history) {
  const match = /(?:^#|&)token=([0-9a-f]+)(?:&|$)/i.exec(location.hash || '');
  if (!match) return null;
  history.replaceState(null, '', `${location.pathname}${location.search || ''}`);
  return match[1];
}

export function createApi({ token, fetchFn = (...args) => fetch(...args) }) {
  /** `signal` (optional) aborts the request; the AbortError is passed on unchanged. */
  async function request(method, path, body, { signal } = {}) {
    const headers = { 'X-Studio-Token': token };
    const init = { method, headers };
    if (signal) init.signal = signal;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetchFn(path, init);
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error('Das Studio ist nicht erreichbar.');
    }
    if (!response.ok) {
      let message = `Fehler (${response.status}).`;
      const extra = { status: response.status };
      try {
        const data = await response.json();
        if (data && typeof data.error === 'string') message = data.error;
        // A refused AI apply names the files that changed meanwhile
        if (data && Array.isArray(data.conflicts)) extra.conflicts = data.conflicts;
      } catch { /* keep the generic message */ }
      throw Object.assign(new Error(message), extra);
    }
    return response;
  }
  const json = async (method, path, body) => (await request(method, path, body)).json();
  /** Content and sha256 of the file as it is on disk. */
  async function readFileInfo(path) {
    const { content, hash } = await json('GET', `/api/file?path=${encodeURIComponent(path).replace(/%2F/gi, '/')}`);
    return { content, hash };
  }

  return {
    request,
    state: () => json('GET', '/api/state'),
    open: (dir) => json('POST', '/api/open', { dir }),
    create: (id, parentDir) => json('POST', '/api/new', { id, parentDir }),
    removeRecent: (dir) => json('POST', '/api/recent/remove', { dir }),
    listFiles: () => json('GET', '/api/files'),
    readFile: async (path) => (await readFileInfo(path)).content,
    readFileInfo,
    /** `baseHash`: the disk state the edit started from; a file changed since then fails with status 409. */
    saveFile: (path, content, baseHash) => json('PUT', '/api/file', baseHash === undefined ? { path, content } : { path, content, baseHash }),
    createFile: (path) => json('POST', '/api/file', { path }),
    uploadFile: (path, base64) => json('POST', '/api/file', { path, base64 }),
    renameFile: (from, to) => json('POST', '/api/file/rename', { from, to }),
    deleteFile: (path) => json('DELETE', '/api/file', { path }),
    // EventSource cannot send headers, so the stream takes the token as its only query parameter.
    eventsUrl: () => `/api/events?token=${encodeURIComponent(token)}`,
    clearEvents: () => json('POST', '/api/events/clear', {}),
    check: () => json('POST', '/api/check', {}),
    buildPreview: () => json('POST', '/api/build', { apply: false }),
    async buildDownload() {
      const response = await request('POST', '/api/build', { apply: true });
      const match = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '');
      return { blob: await response.blob(), fileName: match ? match[1] : 'plugin.dems' };
    },
    trigger: (action) => json('POST', '/api/trigger', { action }),
    vscode: () => json('GET', '/api/vscode'),
    aiSettings: () => json('GET', '/api/ai/settings'),
    saveAiSettings: (body) => json('PUT', '/api/ai/settings', body),
    testAi: (body) => json('POST', '/api/ai/test', body),
    aiModels: (body) => json('POST', '/api/ai/models', body),
    /** The chat answers an event stream: the caller reads `response.body`. */
    aiChat: (body, { signal } = {}) => request('POST', '/api/ai/chat', body, { signal }),
    /** A refused apply rejects with `conflicts` (paths changed since the proposal). */
    aiApply: (body) => json('POST', '/api/ai/apply', body),
    aiUndo: () => json('POST', '/api/ai/undo', {}),
  };
}
