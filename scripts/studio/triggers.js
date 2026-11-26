'use strict';
// Hook buttons of the plugin studio: act as dev personas against the DEMS child through its
// existing API (dev login, CSRF token, admin routes), so the core fires the plugin hooks.
const { StudioError } = require('./files');
const { PERSONAS } = require('../../dev/mockGuild');

const HOUR = 3600 * 1000;
const TIMEOUT_MS = 15000;
const TITLE = 'Studio-Test';
const MEMBER = 'member';

const persona = (id) => PERSONAS.find((p) => p.id === id);

/** One browser-like session of a persona: own cookies, CSRF token after the dev login. */
function createSession(personaId) {
  const cookies = new Map();
  let csrf = null;

  function remember(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async function raw(base, method, pathname, { body, headers = {} } = {}) {
    const all = { ...headers };
    if (cookies.size) all.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) all['Content-Type'] = 'application/json';
    const res = await fetch(base + pathname, {
      method,
      headers: all,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    remember(res);
    return res;
  }

  async function login(base) {
    cookies.clear();
    csrf = null;
    const res = await raw(base, 'GET', `/auth/dev-login/${encodeURIComponent(personaId)}`);
    await res.arrayBuffer();
    // The dev login answers with a redirect into the app; anything else (an error redirect included) is a failure
    const location = res.headers.get('location') || '';
    if (res.status !== 302 || location.includes('error=') || !cookies.has('connect.sid')) {
      throw new StudioError('Die Anmeldung bei DEMS ist fehlgeschlagen.', 502);
    }
    // Same endpoint the DEMS frontend asks (public/js/core/boot.js fetchCSRFToken)
    const tokenRes = await raw(base, 'GET', '/api/csrf-token');
    const data = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || typeof data.token !== 'string') throw new StudioError('DEMS hat kein CSRF-Token geliefert.', 502);
    csrf = data.token;
  }

  /** JSON request as this persona; logs in first and once more when the session has gone. */
  async function request(base, method, pathname, body) {
    for (let attempt = 0; ; attempt += 1) {
      if (!csrf) await login(base);
      const res = await raw(base, method, pathname, { body, headers: method === 'GET' ? {} : { 'X-CSRF-TOKEN': csrf } });
      const data = await res.json().catch(() => null);
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        csrf = null;
        continue;
      }
      if (!res.ok) {
        const text = data && typeof data.error === 'string' ? data.error : `DEMS antwortete mit ${res.status}.`;
        throw new StudioError(text, 502);
      }
      return data;
    }
  }

  return { request };
}

/**
 * @param {object} options
 * @param {number|(() => number|null)} [options.childPort] -> Port of the DEMS child (null while it does not run).
 * @param {string|(() => string)} [options.baseUrl] -> Base URL of DEMS instead of `http://127.0.0.1:<childPort>` (tests).
 * @returns {{ run(action: string): Promise<{ ok: true, eventId?: string, message: string }>, lastEventId(): string|null }}
 */
function createTriggers({ childPort, baseUrl } = {}) {
  const sessions = new Map();
  let eventId = null;

  const session = (id) => {
    if (!sessions.has(id)) sessions.set(id, createSession(id));
    return sessions.get(id);
  };

  function base() {
    const explicit = typeof baseUrl === 'function' ? baseUrl() : baseUrl;
    if (explicit) return explicit;
    const port = typeof childPort === 'function' ? childPort() : childPort;
    if (!port) throw new StudioError('DEMS läuft gerade nicht. Warte, bis die Vorschau gestartet ist.', 503);
    return `http://127.0.0.1:${port}`;
  }

  async function call(personaId, method, pathname, body) {
    const url = base();
    try {
      return await session(personaId).request(url, method, pathname, body);
    } catch (err) {
      if (err instanceof StudioError) throw err;
      // fetch failures (child restarting, timeout) carry no path worth showing
      throw new StudioError('DEMS ist nicht erreichbar.', 502);
    }
  }

  const admin = (method, pathname, body) => call('admin', method, pathname, body);

  function current() {
    if (!eventId) throw new StudioError('Erstelle zuerst ein Test-Event.', 409);
    return eventId;
  }

  /** The category of the oldest event (the first seeded one), '' when none has one. */
  async function firstCategory() {
    const events = await admin('GET', '/api/admin/all-events');
    const withCategory = (Array.isArray(events) ? events : [])
      .filter((e) => e && typeof e.category === 'string' && e.category)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return withCategory.length ? withCategory[0].category : '';
  }

  async function memberRegistration(id) {
    try {
      return await call(MEMBER, 'POST', `/api/events/${encodeURIComponent(id)}/register`, {});
    } catch (err) {
      // Already registered (a second click): take the existing registration
      const mine = await call(MEMBER, 'GET', `/api/events/${encodeURIComponent(id)}/my-registration`).catch(() => null);
      if (mine && mine.registered && mine.id) return mine;
      throw err;
    }
  }

  const ACTIONS = {
    async create() {
      const now = Date.now();
      const created = await admin('POST', '/api/admin/events', {
        title: TITLE,
        description: 'Test-Event aus dem Plugin-Studio.',
        startDate: new Date(now + HOUR).toISOString(),
        endDate: new Date(now + 3 * HOUR).toISOString(),
        category: await firstCategory(),
        status: 'draft',
      });
      if (!created || typeof created.id !== 'string') throw new StudioError('DEMS hat keine Event-ID geliefert.', 502);
      eventId = created.id;
      return `Test-Event „${TITLE}“ als Entwurf erstellt.`;
    },
    async publish() {
      await admin('PUT', `/api/admin/events/${encodeURIComponent(current())}/status`, { status: 'active' });
      return 'Test-Event veröffentlicht.';
    },
    async end() {
      await admin('POST', `/api/admin/events/${encodeURIComponent(current())}/end`, {});
      return 'Test-Event beendet.';
    },
    async cancel() {
      await admin('PUT', `/api/admin/events/${encodeURIComponent(current())}/cancel`, {});
      return 'Test-Event abgesagt.';
    },
    async delete() {
      await admin('DELETE', `/api/admin/events/${encodeURIComponent(current())}`);
      eventId = null;
      return 'Test-Event gelöscht.';
    },
    async checkin() {
      const id = current();
      const registration = await memberRegistration(id);
      if (registration.status !== 'accepted') {
        await admin('PUT', `/api/admin/registrations/${encodeURIComponent(registration.id)}/status`, { status: 'accepted' });
      }
      await admin('PUT', `/api/admin/registrations/${encodeURIComponent(registration.id)}/checkin`, { checkedIn: true });
      return `${persona(MEMBER).displayName} ist angemeldet und eingecheckt.`;
    },
  };

  return {
    async run(action) {
      if (typeof action !== 'string' || !Object.hasOwn(ACTIONS, action)) throw new StudioError('Unbekannte Aktion.', 400);
      const target = action === 'create' ? null : current();
      const message = await ACTIONS[action]();
      const id = action === 'create' ? eventId : target;
      return id ? { ok: true, eventId: id, message } : { ok: true, message };
    },
    lastEventId: () => eventId,
  };
}

module.exports = { createTriggers };
