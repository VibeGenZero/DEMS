'use strict';

// Derives the permissions a plugin needs by reading its code (never running
// it). A developer help ("guard rail, not a wall"): what it cannot see, it
// reports as a warning instead of guessing.

const { tokenize } = require('./tokenize');
const { PERMISSIONS, SDK_1_1_PERMISSIONS } = require('./manifest');
const { HOOK_NAMES } = require('./hooks');
const { isClientAsset } = require('./files');

const AREAS = ['events', 'members', 'registrations', 'discord', 'hooks'];
const NETWORK_MODULE = /^(node:)?(http|https|http2|net|dgram|tls)$/;
const AREA_PERMISSIONS = {
  events: { get: 'events:read', list: 'events:read' },
  members: { get: 'members:read', search: 'members:read' },
  registrations: { list: 'registrations:read' },
  discord: {
    sendDM: 'discord:dm',
    sendChannelMessage: 'discord:channel',
    listRoles: 'discord:roles',
    addRole: 'discord:roles',
    removeRole: 'discord:roles',
  },
};
// Tokens that make a following `ctx`/`ui` a comparison or arrow, not an assignment.
const NOT_ASSIGNMENT = new Set(['=', '!', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '?']);

const DYNAMIC = (what) => `Dynamischer Zugriff auf ${what} – Berechtigung nicht erkennbar.`;
const PASSED = (what) => `${what} wird weitergegeben – Berechtigung nicht erkennbar.`;
const RENAMED = (what) => `${what} wird umbenannt oder zerlegt – Berechtigung nicht erkennbar.`;
const HOOK_DYNAMIC = 'Hook-Name ist kein fester Text – Berechtigung nicht erkennbar.';
const HOOK_UNKNOWN = (name) => `Unbekannter Hook „${name}“.`;
const COMPUTED_PATH = 'require/import mit berechnetem Pfad – nicht prüfbar.';

/**
 * @param {string} code
 * @param {{file: string, kind: 'server'|'client'}} opts
 * @returns {{permissions: Set<string>, warnings: {file: string, line: number, message: string}[], imports: string[]}}
 */
function scanSource(code, { file, kind }) {
  const t = tokenize(code);
  const permissions = new Set();
  const warnings = [];
  const imports = [];
  const warn = (line, message) => warnings.push({ file, line, message });
  const is = (k, type, value) => !!t[k] && t[k].type === type && (value === undefined || t[k].value === value);
  const punct = (k, value) => is(k, 'punct', value);
  const notMember = (k) => !punct(k - 1, '.');

  const addSpecifier = (spec) => {
    if (spec.startsWith('.')) imports.push(spec);
    if (kind === 'server' && NETWORK_MODULE.test(spec)) permissions.add('network');
  };

  for (let i = 0; i < t.length; i++) {
    const tok = t[i];
    if (tok.type !== 'name') continue;
    const name = tok.value;

    if ((name === 'ctx' || name === 'ui') && notMember(i)) {
      if (punct(i - 1, '=') && !punct(i + 1, '.') && !punct(i + 1, '[') && !(t[i - 2] && t[i - 2].type === 'punct' && NOT_ASSIGNMENT.has(t[i - 2].value))) {
        warn(tok.line, RENAMED(name));
      }
      if (punct(i + 1, '[')) { warn(tok.line, DYNAMIC(name)); continue; }
      if (!punct(i + 1, '.') || !is(i + 2, 'name')) continue;
      const member = t[i + 2].value;
      if (member === 'theme') { permissions.add('theme'); continue; }
      if (name === 'ui') {
        if (member === 'openEventEditor') permissions.add('events:draft');
        continue;
      }
      if (!AREAS.includes(member)) continue;
      const area = `ctx.${member}`;
      if (punct(i + 3, '[')) { warn(tok.line, DYNAMIC(area)); continue; }
      if (!punct(i + 3, '.')) { warn(tok.line, PASSED(area)); continue; }
      const method = is(i + 4, 'name') ? t[i + 4].value : null;
      if (member !== 'hooks') {
        const permission = method && AREA_PERMISSIONS[member][method];
        if (permission) permissions.add(permission);
        continue;
      }
      if (method !== 'on' || !punct(i + 5, '(')) continue;
      if (!(is(i + 6, 'string') && (punct(i + 7, ',') || punct(i + 7, ')')))) {
        warn(tok.line, HOOK_DYNAMIC);
      } else {
        const hook = t[i + 6].value;
        if (!HOOK_NAMES.includes(hook)) warn(tok.line, HOOK_UNKNOWN(hook));
        else if (hook.startsWith('event.')) permissions.add('events:read');
        else if (hook === 'registration.checkedIn') permissions.add('registrations:read');
      }
      continue;
    }

    if (!notMember(i)) continue;

    if (name === 'fetch' && kind === 'server' && punct(i + 1, '(')) permissions.add('network');
    else if (name === 'WebSocket' && kind === 'server') permissions.add('network');
    else if ((name === 'require' || name === 'import') && punct(i + 1, '(')) {
      if (is(i + 2, 'string') && (punct(i + 3, ')') || punct(i + 3, ','))) addSpecifier(t[i + 2].value);
      else warn(tok.line, COMPUTED_PATH);
    } else if (name === 'import' && is(i + 1, 'string')) {
      addSpecifier(t[i + 1].value);
    } else if (name === 'from' && is(i + 1, 'string')) {
      addSpecifier(t[i + 1].value);
    }
  }
  return { permissions, warnings, imports };
}

/** Resolve a relative specifier against the importing file; `.js` appended when missing. */
function resolveImport(fromFile, spec, sources) {
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  const base = parts.join('/');
  if (sources.has(base)) return base;
  return sources.has(`${base}.js`) ? `${base}.js` : null;
}

/**
 * @param {Map<string, string>} sources -> relative posix path to text
 * @param {{server: string, client: string}} manifest
 * @returns {{permissions: string[], warnings: {file: string, line: number, message: string}[]}}
 */
function scanPlugin(sources, manifest) {
  const results = new Map();
  const client = new Set();
  const scanFile = (file, kind) => {
    if (!sources.has(file) || !file.endsWith('.js')) return;
    if (!results.has(file) || (kind === 'client' && !client.has(file))) {
      results.set(file, scanSource(sources.get(file), { file, kind }));
    }
    return results.get(file);
  };

  // Client files first: manifest.client, every client asset, and what they import (transitively).
  const queue = [manifest.client, ...[...sources.keys()].filter(isClientAsset)];
  while (queue.length) {
    const file = queue.shift();
    if (client.has(file) || !sources.has(file) || !file.endsWith('.js')) continue;
    client.add(file);
    const result = scanFile(file, 'client');
    for (const spec of result.imports) {
      const target = resolveImport(file, spec, sources);
      if (target) queue.push(target);
    }
  }
  for (const file of sources.keys()) {
    if (file.endsWith('.js') && !client.has(file)) scanFile(file, 'server');
  }

  const found = new Set();
  const warnings = [];
  for (const file of sources.keys()) {
    const r = results.get(file);
    if (!r) continue;
    r.permissions.forEach(p => found.add(p));
    warnings.push(...r.warnings);
  }
  return { permissions: Object.keys(PERMISSIONS).filter(p => found.has(p)), warnings };
}

/** @returns {{missing: string[], unused: string[]}} -> missing: found but not declared; unused: declared but not found. */
function comparePermissions(declared, found) {
  return {
    missing: found.filter(p => !declared.includes(p)),
    unused: declared.filter(p => !found.includes(p)),
  };
}

/** @returns {number} -> 1.1 when a permission needs it, else `current` (never lowers). */
function requiredSdk(permissions, current) {
  return permissions.some(p => SDK_1_1_PERMISSIONS.includes(p)) ? Math.max(1.1, current) : current;
}

function formatWarning(w) {
  return `${w.file}:${w.line}: ${w.message}`;
}

module.exports = { scanSource, scanPlugin, comparePermissions, requiredSdk, formatWarning, HOOK_NAMES };
