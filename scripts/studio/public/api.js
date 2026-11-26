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
  async function request(method, path, body) {
    const headers = { 'X-Studio-Token': token };
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetchFn(path, init);
    } catch {
      throw new Error('Das Studio ist nicht erreichbar.');
    }
    if (!response.ok) {
      let message = `Fehler (${response.status}).`;
      try {
        const data = await response.json();
        if (data && typeof data.error === 'string') message = data.error;
      } catch { /* keep the generic message */ }
      throw new Error(message);
    }
    return response;
  }
  const json = async (method, path, body) => (await request(method, path, body)).json();

  return {
    request,
    state: () => json('GET', '/api/state'),
    open: (dir) => json('POST', '/api/open', { dir }),
    create: (id, parentDir) => json('POST', '/api/new', { id, parentDir }),
    removeRecent: (dir) => json('POST', '/api/recent/remove', { dir }),
    listFiles: () => json('GET', '/api/files'),
    async readFile(path) {
      return (await json('GET', `/api/file?path=${encodeURIComponent(path).replace(/%2F/gi, '/')}`)).content;
    },
    saveFile: (path, content) => json('PUT', '/api/file', { path, content }),
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
  };
}
