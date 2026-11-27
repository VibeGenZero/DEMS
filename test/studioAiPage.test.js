const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The AI parts of the studio page are plain ES modules; only their pure functions run here.
const load = (name) => import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'studio', 'public', name)).href);
const XSS = '<img src=x onerror=alert(1)>';

/** Feeds `stream` to parseSse cut at `cut`, the way chunks of a fetch body arrive. */
async function parseInTwo(stream, cut) {
  const { parseSse } = await load('ai.js');
  const events = [];
  let rest = '';
  for (const chunk of [stream.slice(0, cut), stream.slice(cut)]) {
    const out = parseSse(rest + chunk);
    events.push(...out.events);
    rest = out.rest;
  }
  return { events, rest };
}

test('parseSse handles frames split across chunks', async () => {
  const stream = 'event: token\ndata: {"text":"Hal"}\n\n: ping\n\nevent: status\ndata: {"text":"Prüfe den Vorschlag …"}\n\nevent: done\ndata: {"reply":"Hallo"}\n\n';
  const expected = [
    { event: 'token', data: { text: 'Hal' } },
    { event: 'status', data: { text: 'Prüfe den Vorschlag …' } },
    { event: 'done', data: { reply: 'Hallo' } },
  ];
  for (let cut = 0; cut <= stream.length; cut += 1) {
    const { events, rest } = await parseInTwo(stream, cut);
    assert.deepEqual(events, expected, `cut at ${cut}`);
    assert.equal(rest, '');
  }
  const crlf = stream.replace(/\n/g, '\r\n');
  for (let cut = 0; cut <= crlf.length; cut += 1) {
    assert.deepEqual((await parseInTwo(crlf, cut)).events, expected, `CRLF cut at ${cut}`);
  }
});

test('parseSse keeps an unfinished frame as rest and skips frames without valid JSON', async () => {
  const { parseSse } = await load('ai.js');
  const out = parseSse('event: token\ndata: nope\n\nevent: token\ndata: {"text":"a"}\n\nevent: done\ndata: {"re');
  assert.deepEqual(out.events, [{ event: 'token', data: { text: 'a' } }]);
  assert.equal(out.rest, 'event: done\ndata: {"re');
});

test('renderMessage escapes HTML', async () => {
  const { renderMessage } = await load('ai.js');
  const html = renderMessage({ role: 'assistant', text: `Nimm \`<b>ctx</b>\` und ${XSS}`, status: XSS });
  assert.ok(!html.includes('<img'), 'no raw img tag');
  assert.ok(!html.includes('<b>'), 'no raw b tag');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<code>&lt;b&gt;ctx&lt;\/b&gt;<\/code>/);
  assert.match(html, /KI/);
  assert.match(renderMessage({ role: 'user', text: 'Hallo' }), /Du/);
  const failed = renderMessage({ role: 'assistant', text: '', error: XSS });
  assert.ok(!failed.includes('<img'));
  assert.match(failed, /is-error|ai-error/);
});

const proposal = (over = {}) => ({
  id: 'p1',
  reply: 'Erledigt.',
  files: [
    { path: 'server.js', before: 'a', after: 'b', isNew: false },
    { path: 'lib/neu.js', before: '', after: 'c', isNew: true },
  ],
  dropped: [{ path: '../x.js', reason: `Unerlaubter Pfad: ../x.js ${XSS}` }],
  newProblems: [{ key: 'syntax:server.js', file: 'server.js', message: 'Syntaxfehler in server.js' }],
  oldProblems: [{ key: 'syntax:client.js', file: 'client.js', message: 'Alter Fehler in client.js' }],
  permissionChanges: { added: ['network', 'discord:dm', 'events:read'], sdk: null },
  unsaved: [],
  ...over,
});

test('renderProposalSummary marks network and discord permissions as risky and lists old problems separately', async () => {
  const { renderProposalSummary } = await load('ai.js');
  const html = renderProposalSummary(proposal(), { index: 3 });
  assert.match(html, /2 Dateien geändert/);
  assert.ok(!html.includes('<img'), 'dropped reason escaped');
  assert.match(html, /\.\.\/x\.js/);
  const lines = html.split('<li').slice(1);
  const network = lines.find((l) => l.includes('Neu: network'));
  assert.ok(network, 'network line');
  assert.match(network, /Neu: network — das Plugin darf ins Internet\./);
  assert.match(network, /is-risky/);
  assert.match(lines.find((l) => l.includes('Neu: discord:dm')), /is-risky/);
  assert.ok(!/is-risky/.test(lines.find((l) => l.includes('Neu: events:read'))));
  // Old problems sit in their own list under „bestand schon vorher“, the new one outside it
  const [before, old] = html.split('bestand schon vorher');
  assert.ok(old, 'old problems section');
  assert.match(old, /Alter Fehler in client\.js/);
  assert.ok(!old.includes('Syntaxfehler in server.js'));
  assert.match(before, /Syntaxfehler in server\.js/);
  for (const action of ['ai-view', 'ai-apply', 'ai-discard']) assert.match(html, new RegExp(`data-action="${action}" data-index="3"`));
  assert.ok(!html.includes('ai-undo'));

  const applied = renderProposalSummary(proposal(), { index: 3, applied: true });
  assert.match(applied, /data-action="ai-undo" data-index="3"/);
  assert.ok(!applied.includes('data-action="ai-apply"'));
  assert.ok(!applied.includes('data-action="ai-discard"'));
  const closed = renderProposalSummary(proposal(), { index: 3, closed: 'Verworfen.' });
  assert.match(closed, /Verworfen\./);
  assert.ok(!/data-action="ai-(apply|discard|undo)"/.test(closed));
  assert.match(renderProposalSummary(proposal({ files: [proposal().files[0]] })), /1 Datei geändert/);
});

test('renderProposalSummary names permissions a proposal adds to plugin.json', async () => {
  const { renderProposalSummary } = await load('ai.js');
  const manifest = (permissions) => JSON.stringify({ id: 'p', permissions });
  const html = renderProposalSummary(proposal({
    files: [{ path: 'plugin.json', before: manifest(['events:read']), after: manifest(['events:read', 'network']), isNew: false }],
    permissionChanges: { added: [], sdk: null },
    dropped: [],
  }));
  assert.match(html, /Neu: network — das Plugin darf ins Internet\./);
  assert.ok(!html.includes('Neu: events:read'), 'a permission declared before is not new');
});

test('renderApplyDialog checks every unsaved file by default', async () => {
  const { renderApplyDialog } = await load('ai-diff.js');
  const html = renderApplyDialog({ unsaved: ['client.js', 'a"b.js'], conflicts: [] });
  const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) || [];
  assert.equal(boxes.length, 2);
  for (const box of boxes) assert.match(box, /\schecked/);
  assert.match(html, /mit speichern/);
  assert.match(html, /Ungespeichert, die KI hat damit gearbeitet/);
  assert.ok(!html.includes('a"b.js'), 'path escaped');
  assert.match(html, /data-check="a&quot;b\.js"/);
  assert.ok(!html.includes('inzwischen geändert'));
  const conflict = renderApplyDialog({ unsaved: [], conflicts: ['server.js'] });
  assert.match(conflict, /Datei wurde inzwischen geändert/);
  assert.match(conflict, /server\.js/);
  assert.ok(!conflict.includes('checkbox'));
});

const view = (over = {}) => ({
  provider: 'ollama',
  baseUrl: '',
  model: 'qwen3-coder',
  maxTokens: 8192,
  contextTokens: 32768,
  apiKeySet: false,
  providers: [
    { id: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', keyRequired: true },
    { id: 'ollama', label: 'Ollama (lokal oder Cloud)', defaultBaseUrl: 'http://localhost:11434/v1', keyRequired: false },
  ],
  ollamaPresets: { local: 'http://localhost:11434/v1', cloud: 'https://ollama.com/v1' },
  ...over,
});

test('renderSettingsForm shows the ollama hint only for ollama and never a key value', async () => {
  const { renderSettingsForm } = await load('ai-settings.js');
  const ollama = renderSettingsForm(view());
  assert.match(ollama, /Lokale Modelle brauchen viel Kontext/);
  assert.match(ollama, /OLLAMA_CONTEXT_LENGTH/);
  assert.match(ollama, /data-preset="local"[^>]*>[^<]*Lokal/);
  assert.match(ollama, /data-preset="cloud"[^>]*>[^<]*Cloud/);
  assert.match(ollama, /Modelle laden/);
  assert.match(ollama, /Verbindung testen/);
  assert.match(ollama, /value="8192"/);
  assert.match(ollama, /value="32768"/);
  assert.match(ollama, /<option value="ollama" selected>/);

  const cloud = renderSettingsForm(view({ provider: 'openrouter', apiKeySet: true, contextTokens: 128000, apiKey: 'sk-or-secret-123456' }));
  assert.ok(!cloud.includes('Lokale Modelle brauchen viel Kontext'));
  assert.ok(!cloud.includes('data-preset'));
  assert.ok(!cloud.includes('sk-or-secret-123456'), 'the key is never rendered');
  const key = cloud.match(/<input[^>]*data-field="apiKey"[^>]*>/)[0];
  assert.match(key, /type="password"/);
  assert.match(key, /placeholder="gespeichert"/);
  assert.ok(!/\svalue=/.test(key), 'the key field has no value');
  assert.ok(!/placeholder="gespeichert"/.test(renderSettingsForm(view({ provider: 'openrouter' }))));

  const hostile = renderSettingsForm(view({ model: `"${XSS}`, baseUrl: XSS }));
  assert.ok(!hostile.includes('<img'));
});

test('emptyStateHtml offers „KI einrichten“', async () => {
  const { emptyStateHtml } = await load('ai.js');
  const html = emptyStateHtml();
  assert.match(html, /data-action="ai-setup"/);
  assert.match(html, /KI einrichten/);
});

test('isConfiguredView needs provider, model and a key where the provider needs one', async () => {
  const { isConfiguredView } = await load('ai-settings.js');
  assert.equal(isConfiguredView(view()), true);
  assert.equal(isConfiguredView(view({ model: '' })), false);
  assert.equal(isConfiguredView(view({ provider: '' })), false);
  assert.equal(isConfiguredView(view({ provider: 'openrouter' })), false);
  assert.equal(isConfiguredView(view({ provider: 'openrouter', apiKeySet: true })), true);
});

test('chatHistory sends the last 10 turns and names the files of earlier proposals', async () => {
  const { chatHistory } = await load('ai.js');
  const messages = [
    { role: 'user', text: 'Mach was' },
    { role: 'assistant', text: 'Fertig.', proposal: { files: [{ path: 'server.js' }, { path: 'client.js' }] } },
    { role: 'assistant', text: '', error: 'Kaputt.' },
  ];
  for (let i = 0; i < 12; i += 1) messages.push({ role: 'user', text: `Frage ${i}` }, { role: 'assistant', text: `Antwort ${i}` });
  const history = chatHistory(messages);
  assert.equal(history.length, 20);
  assert.deepEqual(history[0], { role: 'user', text: 'Frage 2' });
  assert.deepEqual(history[19], { role: 'assistant', text: 'Antwort 11' });
  assert.deepEqual(chatHistory(messages.slice(0, 3)), [
    { role: 'user', text: 'Mach was' },
    { role: 'assistant', text: 'Fertig.\n\n[Dateien: server.js, client.js]' },
  ]);
});

test('createApi streams the chat with the abort signal and keeps the conflicts of a refused apply', async () => {
  const { createApi } = await load('api.js');
  const seen = [];
  const streamResponse = { ok: true, status: 200, body: 'stream' };
  const answers = [
    streamResponse,
    { ok: false, status: 409, json: async () => ({ error: 'Datei wurde inzwischen geändert', conflicts: ['server.js'] }) },
    { ok: true, status: 200, json: async () => ({ ok: true, restored: ['server.js'], conflicts: [] }) },
  ];
  const api = createApi({ token: 'tok', fetchFn: async (url, init) => { seen.push([url, init]); return answers.shift(); } });
  const controller = new AbortController();
  assert.equal(await api.aiChat({ message: 'Hi' }, { signal: controller.signal }), streamResponse);
  assert.equal(seen[0][0], '/api/ai/chat');
  assert.equal(seen[0][1].method, 'POST');
  assert.equal(seen[0][1].signal, controller.signal);
  assert.equal(seen[0][1].headers['X-Studio-Token'], 'tok');
  await assert.rejects(api.aiApply({ id: 'p1', save: [], skip: [] }), (err) => {
    assert.equal(err.message, 'Datei wurde inzwischen geändert');
    assert.deepEqual(err.conflicts, ['server.js']);
    return true;
  });
  assert.equal(seen[1][0], '/api/ai/apply');
  assert.deepEqual((await api.aiUndo()).restored, ['server.js']);
  assert.equal(seen[2][0], '/api/ai/undo');

  const aborting = createApi({ token: 't', fetchFn: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } });
  await assert.rejects(aborting.aiChat({ message: 'x' }, {}), { name: 'AbortError' });
});

test('mountDebug reports new plugin errors to onError once, also after a reconnect replay', async () => {
  const { mountDebug } = await load('debug.js');
  const sources = [];
  class FakeSource {
    constructor() { this.listeners = {}; sources.push(this); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    close() {}
    emit(event) { this.listeners.studio({ data: JSON.stringify(event) }); }
  }
  const errors = [];
  const controller = new AbortController();
  mountDebug({ innerHTML: '', querySelector: () => null }, {
    api: { eventsUrl: () => 'u', clearEvents: async () => {} },
    signal: controller.signal,
    createEventSource: () => new FakeSource(),
    onError: (event) => errors.push(event.data.message),
  });
  const error = (message, at) => ({ type: 'error', pluginId: 'p', at, data: { where: 'hook', message } });
  sources[0].emit(error('kaputt', '2026-11-27T10:00:00.000Z'));
  sources[0].emit({ type: 'log', pluginId: 'p', at: '2026-11-27T10:00:01.000Z', data: { level: 'info', text: 'x' } });
  sources[0].listeners.open(); // reconnect: the server replays its log
  sources[0].emit(error('kaputt', '2026-11-27T10:00:00.000Z'));
  sources[0].emit(error('wieder', '2026-11-27T10:00:02.000Z'));
  assert.deepEqual(errors, ['kaputt', 'wieder']);
  controller.abort();
});

test('the permission texts of the diff view cover exactly the SDK permissions', async () => {
  const { PERMISSION_TEXT } = await load('ai-diff.js');
  const { PERMISSIONS } = require('../plugin-sdk/manifest');
  assert.deepEqual(Object.keys(PERMISSION_TEXT).sort(), Object.keys(PERMISSIONS).sort());
});
