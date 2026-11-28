'use strict';
/**
 * Builds the prompt of one studio chat request within the model's context budget.
 *
 * system   = German rules (incl. the file-block answer format) + sdk-guide.md + dems-plugin.d.ts
 * messages = the last chat turns (file blocks of assistant turns compacted) + one user message
 *            with the plugin files, the current errors and, last, the author's message.
 *
 * Budget = contextTokens - maxTokens, counted as characters / 3. The SDK knowledge is never cut:
 * if it alone does not fit, `buildPrompt` throws. Otherwise it cuts, in this order: the oldest
 * turns, the largest files not open in the editor (listed by name only), error lines beyond the
 * first five. `buildPrompt` is pure; `loadKnowledge` is the only I/O.
 */

const fs = require('fs');
const path = require('path');
const { SDK_1_1_PERMISSIONS } = require('../../../plugin-sdk/manifest');
const { TEXT_EXTENSIONS, ASSET_NAME, CONTENT_TYPES } = require('../../../plugin-sdk/files');
const { FILE_START, FILE_END, compactTurn } = require('./answer');

const FILE_TEXT_CAP = 200 * 1024;
const MAX_TURNS = 10;
const MAX_ERRORS = 20;
const KEPT_ERRORS = 5;

const CONTEXT_TOO_SMALL = 'Die Kontextlänge reicht nicht für das SDK-Wissen. Erhöhe sie in den KI-Einstellungen (und in Ollama).';

class PromptError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'PromptError';
    this.code = code;
  }
}

/** Rough token count, on the safe side for code and German text. */
const estimateTokens = (text) => Math.ceil(String(text).length / 3);

const sdk11 = SDK_1_1_PERMISSIONS.map((name) => `\`${name}\``).join(' oder ');

// The file rule follows the SDK allow-list: its text extensions outside assets/ and, inside, the asset
// types served with a charset (text); the model cannot write binary files. The name characters mirror
// ASSET_NAME (checked by a drift test).
const orList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} oder ${items[items.length - 1]}` : items.join(''));
const TEXT_ASSETS = Object.keys(CONTENT_TYPES).filter((ext) => ASSET_NAME.test(`a${ext}`) && /charset=/.test(CONTENT_TYPES[ext]));
const FILE_RULE = `- Keine HTML- oder SVG-Dateien. Außerhalb von \`assets/\` nur ${[...TEXT_EXTENSIONS].join(', ')}; in \`assets/\` nur flache Namen aus [A-Za-z0-9_-] mit ${orList(TEXT_ASSETS)}. Binärdateien (Bilder, Schriften) kannst du nicht schreiben. Keine Pfade mit \`..\`, \`\\\`, \`/\` am Anfang, Punkt-Dateien oder \`node_modules\`.`;

const RULES = `Du schreibst Plugins für DEMS (Event-Verwaltung für Discord-Communities) im lokalen Plugin-Studio. Der SDK-Leitfaden und die Typbeschreibung unten sind dein Wissen über das SDK.

Antwortformat:
- Zuerst eine kurze Erklärung auf Deutsch, was du änderst. Eine Antwort ohne Dateien (Erklärung, Rückfrage) ist erlaubt.
- Danach jede neue oder geänderte Datei als Block: eine Zeile \`${FILE_START}<pfad>\` (Pfad relativ zum Plugin-Ordner, z. B. \`${FILE_START}server.js\`), dann der vollständige Inhalt, dann eine Zeile \`${FILE_END}\`. Beide Marker stehen allein am Zeilenanfang; keine Code-Zäune (\`\`\`) um den Inhalt.
- Nur Dateien, die sich ändern, jede vollständig: nie gekürzt, kein „…“, kein „Rest unverändert“.
- Löschen kannst du keine Datei; bitte den Autor in der Erklärung darum.

Regeln:
- Texte für Nutzer (Oberfläche, \`{ error }\`-Meldungen, Discord-Nachrichten, Einstellungen, name und description in plugin.json) auf Deutsch; Code und Kommentare auf Englisch.
${FILE_RULE}
- Im Client-Code kein \`style="…"\`, kein \`<style>\`, keine Inline-Handler wie \`onclick=\` (die CSP von DEMS blockiert sie); Aktionen über \`data-click\`/\`data-change\`/\`data-input\` und \`ui.actions.register\`.
- Symbole nur als Bootstrap Icons (\`bi-*\`), keine Emojis.
- Erfinde keine SDK-Methoden: nutze nur, was die Typbeschreibung auflistet. Keine npm-Pakete, keine DEMS-Dateien.
- Deklariere in plugin.json jede Berechtigung, die der Code nutzt, und nur diese. Für ${sdk11} braucht plugin.json \`"sdk": 1.1\`.
- plugin.json ist gültiges JSON ohne Kommentare; \`id\` gleich dem Ordnernamen, \`version\` x.y.z, \`server\`/\`client\` nur für Dateien, die es gibt.
- server.js ist CommonJS (\`module.exports = { register }\`), client.js ein ES-Modul (\`export function register(ui)\`); den Parameter immer \`ctx\` bzw. \`ui\` nennen.
- Stehen unten „Aktuelle Fehler“, behebe sie zuerst. Dateien unter „Nicht mitgeschickt“ kennst du nicht: schreibe sie nicht neu.`;

/**
 * Reads the SDK knowledge on every call, so edits to the guide or the types need no restart.
 *
 * @param {string} repoRoot
 * @returns {{ guide: string, types: string }}
 */
function loadKnowledge(repoRoot) {
  // A Windows checkout has CRLF line ends: send LF only, the model gains nothing from "\r"
  const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8').replace(/\r\n/g, '\n');
  return {
    guide: read('scripts', 'studio', 'ai', 'sdk-guide.md'),
    types: read('plugin-sdk', 'types', 'dems-plugin.d.ts')
  };
}

/** A backtick fence longer than any backtick run inside `text`. */
function fenceFor(text) {
  const longest = (String(text).match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

const LANGUAGES = { '.js': 'js', '.json': 'json', '.css': 'css', '.md': 'markdown' };

function fenced(text, language = '') {
  const body = String(text);
  const fence = fenceFor(body);
  return `${fence}${language}\n${body}${body.endsWith('\n') || body === '' ? '' : '\n'}${fence}`;
}

const bySizeDesc = (a, b) => b.size - a.size || a.path.localeCompare(b.path);

/** Applies the 200 kB file text cap: largest closed files go first, then largest open ones. */
function capFiles(files) {
  const kept = files.map((file) => ({ ...file, size: Buffer.byteLength(file.content, 'utf8') }));
  const dropped = [];
  let total = kept.reduce((sum, file) => sum + file.size, 0);
  const order = [...kept.filter((file) => !file.open).sort(bySizeDesc), ...kept.filter((file) => file.open).sort(bySizeDesc)];
  for (const file of order) {
    if (total <= FILE_TEXT_CAP) break;
    total -= file.size;
    kept.splice(kept.indexOf(file), 1);
    dropped.push(file.path);
  }
  return { kept, dropped };
}

function userMessage({ files, skipped, errors, message }) {
  const parts = [];
  if (files.length) {
    parts.push('Aktuelle Dateien des Plugins:');
    for (const file of files) {
      parts.push(`### ${file.path}\n${fenced(file.content, LANGUAGES[path.posix.extname(file.path).toLowerCase()] || '')}`);
    }
  } else {
    parts.push('Das Plugin hat noch keine Dateien.');
  }
  if (skipped.length) parts.push(`Nicht mitgeschickt: ${skipped.join(', ')} (zu groß; nur der Name)`);
  if (errors.length) parts.push(`Aktuelle Fehler:\n${errors.map((line) => `- ${line}`).join('\n')}`);
  parts.push(`Auftrag:\n${message}`);
  return parts.join('\n\n');
}

/** Drops assistant turns at the front: a conversation starts with the author. */
function startWithUser(turns) {
  let dropped = 0;
  while (turns.length && turns[0].role !== 'user') {
    turns.shift();
    dropped++;
  }
  return dropped;
}

/**
 * @param {object} input
 * @param {{ guide: string, types: string }} input.knowledge
 * @param {Array<{ path: string, content: string, open: boolean }>} input.files -> editor buffers already merged over disk
 * @param {Array<{ role: 'user'|'assistant', text: string }>} input.history -> oldest first
 * @param {string} input.message -> the author's new message
 * @param {string[]} input.errors -> error lines to send, most important first
 * @param {number} input.contextTokens
 * @param {number} input.maxTokens
 * @returns {{ system: string, messages: Array<{ role: string, text: string }>, omitted: { turns: number, files: string[], errors: number } }}
 *   `omitted.turns` counts only the turns cut for lack of space, not the fixed cap of MAX_TURNS.
 * @throws {PromptError} code 'context_too_small' when rules, guide and types alone exceed the budget
 */
function buildPrompt({ knowledge, files = [], history = [], message = '', errors = [], contextTokens, maxTokens }) {
  const system = [
    RULES,
    String(knowledge.guide),
    `# Typbeschreibung (plugin-sdk/types/dems-plugin.d.ts)\n\n${fenced(knowledge.types, 'ts')}`
  ].join('\n\n');
  const budget = Number(contextTokens) - Number(maxTokens);
  const systemTokens = estimateTokens(system);
  if (!(systemTokens <= budget)) throw new PromptError('context_too_small', CONTEXT_TOO_SMALL);

  const omitted = { turns: 0, files: [], errors: 0 };

  const valid = history.filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string');
  const turns = valid.slice(-MAX_TURNS).map((turn) => ({
    role: turn.role,
    text: turn.role === 'assistant' ? compactTurn(turn.text) : turn.text
  }));
  startWithUser(turns); // neither the fixed cap nor a leading AI turn is a lack of space: not counted

  const { kept, dropped } = capFiles(files.map((file) => ({ path: String(file.path), content: String(file.content), open: file.open === true })));
  omitted.files.push(...dropped);

  const allErrors = errors.map(String);
  let errorLines = allErrors.slice(0, MAX_ERRORS);
  omitted.errors = allErrors.length - errorLines.length;

  const text = String(message);
  const render = () => userMessage({ files: kept, skipped: omitted.files, errors: errorLines, message: text });
  const total = () => systemTokens + turns.reduce((sum, turn) => sum + estimateTokens(turn.text), 0) + estimateTokens(render());

  while (total() > budget) {
    if (turns.length) {
      turns.shift();
      omitted.turns += 1 + startWithUser(turns);
      continue;
    }
    const closed = kept.filter((file) => !file.open).sort(bySizeDesc)[0];
    if (closed) {
      kept.splice(kept.indexOf(closed), 1);
      omitted.files.push(closed.path);
      continue;
    }
    if (errorLines.length > KEPT_ERRORS) {
      omitted.errors += errorLines.length - KEPT_ERRORS;
      errorLines = errorLines.slice(0, KEPT_ERRORS);
      continue;
    }
    break; // only the open files and the message are left: send them, the provider decides
  }

  return { system, messages: [...turns, { role: 'user', text: render() }], omitted };
}

module.exports = { loadKnowledge, buildPrompt, estimateTokens, PromptError, FILE_TEXT_CAP, MAX_TURNS, MAX_ERRORS };
