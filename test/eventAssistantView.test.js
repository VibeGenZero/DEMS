const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, streamAnswer, isHidden, REPO_ROOT } = require('./helpers');

// The chat bubble of the event page (events/assistant.js, events/assistant-stream.js)

// setImmediate runs after the microtask queue is drained, so every
// fire-and-forget chain inside the app has settled by then.
const settle = () => new Promise(resolve => setImmediate(resolve));

const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };
const EVENT = { id: 'ev', title: 'Raid-Abend: Nachtfestung', status: 'active', accessMode: 'open', maxParticipants: 0, currentParticipants: 0, formFields: [] };
const AI_ON = { memberAssistant: true, assistantName: 'Raid-Helfer', teaserText: 'Fragen zum Event? Frag mich einfach.', adminAssistant: false };
const ASK_URL = '/api/events/ev/ask';
const TEASER_KEY = 'dems_ai_teaser_seen';
const GREETING = 'Hi! Ich beantworte Fragen zu diesem Event. Was möchtest du wissen?';
const INTERRUPTED = 'Die Antwort wurde unterbrochen. Bitte versuche es noch einmal.';

/** One server-sent event as routes/eventAsk.js writes it. */
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
/** A finished streamed answer: one token event per text, then done. */
const answer = (tokens, source = '') => streamAnswer([...tokens.map(text => sse('token', { text })), sse('done', { source })]);

/**
 * A gate that holds a stream or a route back until release() is called.
 *
 * @returns {Object} -> `{ opened, release() }`.
 */
function createGate() {
    let release;
    const opened = new Promise(resolve => { release = resolve; });
    return { opened, release };
}

/**
 * Load the app and open the event page with the assistant on.
 *
 * @param {Object} [setup] -> `{ routes, ai, user, event, options }`.
 * @returns {Promise<Object>} -> The loadFrontendApp() harness.
 */
async function openEventPage({ routes = {}, ai = AI_ON, user = MEMBER, event = EVENT, options = {} } = {}) {
    const harness = await loadFrontendApp({
        '/api/events/ev': event,
        '/api/events/ev/my-registration': { registered: false },
        '/api/events/ev/participants': { participants: [], total: 0 },
        '/api/events/ev/comments': [],
        ...routes
    }, options);
    harness.state.aiInfo = ai;
    harness.state.currentUser = user;
    harness.state.csrfToken = 'csrf-1';
    harness.location.hash = '#event/ev';
    await harness.app.handleRoute();
    await settle();
    return harness;
}

/** Type a question and send it; resolves once the answer is shown. */
async function ask(harness, question) {
    harness.element('assistant-input').value = question;
    await harness.app.runAction('sendAssistantQuestion', harness.element('assistant-send'));
    await settle();
}

const message = (harness, n) => harness.element(`assistant-msg-${n}`);
const askRequests = (harness) => harness.requests.filter(request => request.url === ASK_URL);

test('no bubble while the assistant is off, for a logged-out visitor or a cancelled event', async () => {
    const off = await openEventPage({ ai: { ...AI_ON, memberAssistant: false } });
    assert.equal(isHidden(off.element('event-assistant')), true, 'assistant off');

    const visitor = await openEventPage({ user: null });
    // The router shows the login instead; drawn anyway, the page still shows no bubble
    await visitor.app.showEventDetail('ev');
    await settle();
    assert.equal(isHidden(visitor.element('event-assistant')), true, 'logged out');

    const cancelled = await openEventPage({ event: { ...EVENT, status: 'cancelled' } });
    assert.equal(isHidden(cancelled.element('event-assistant')), true, 'cancelled event');

    const shown = await openEventPage();
    assert.equal(isHidden(shown.element('event-assistant')), false, 'active event, member, assistant on');
    assert.equal(isHidden(shown.element('assistant-panel')), true, 'the panel starts closed');
    for (const harness of [off, visitor, cancelled, shown]) assert.deepEqual(askRequests(harness), []);
});

test('the markup holds the bubble hidden inside the event page', () => {
    const section = INDEX_HTML.slice(INDEX_HTML.indexOf('<section id="event-detail-section"'), INDEX_HTML.indexOf('<section id="polls-section"'));
    for (const id of ['event-assistant', 'assistant-teaser', 'assistant-panel']) {
        assert.match(section, new RegExp(`id="${id}" class="[^"]*\\bis-hidden\\b`), id);
    }
    assert.match(section, /<button id="assistant-toggle"[^>]*aria-label="Event-Assistent öffnen"[^>]*aria-expanded="false"/);
    assert.match(section, /<section id="assistant-panel"[^>]*role="dialog"[^>]*aria-label="Event-Assistent"/);
    assert.match(section, /<div id="assistant-messages"[^>]*aria-live="polite"/);
    assert.match(section, /<input id="assistant-input"[^>]*maxlength="500"/);
    assert.match(section, /aria-label="Frage senden"/);
    assert.match(section, /aria-label="Hinweis schließen"/);
    assert.match(section, /bi-chat-dots/);
    assert.match(section, /bi-stars/);
    assert.ok(section.includes('KI-Antworten können Fehler enthalten. Im Zweifel gilt die Eventbeschreibung.'));
    for (const question of ['Wann geht es los?', 'Was sind die Regeln?', 'Darf ich mitmachen?']) {
        assert.ok(section.includes(`data-click="askSuggestedQuestion" data-question="${question}"`), question);
    }
});

test('the teaser appears after four seconds, once per browser', async () => {
    const harness = await openEventPage({ options: { timers: true } });
    const teaser = harness.element('assistant-teaser');
    assert.equal(isHidden(teaser), true);
    await harness.advance(3999);
    assert.equal(isHidden(teaser), true, 'not before four seconds');
    await harness.advance(1);
    assert.equal(isHidden(teaser), false, 'after four seconds');
    assert.equal(harness.element('assistant-teaser-name').textContent, 'Raid-Helfer');
    assert.equal(harness.element('assistant-teaser-text').textContent, 'Fragen zum Event? Frag mich einfach.');

    await harness.app.runAction('closeAssistantTeaser', {});
    assert.equal(isHidden(teaser), true);
    assert.notEqual(harness.localStorage.getItem(TEASER_KEY), null);

    const seen = await openEventPage({ options: { timers: true, storage: { [TEASER_KEY]: '1' } } });
    await seen.advance(10000);
    assert.equal(isHidden(seen.element('assistant-teaser')), true, 'seen in this browser');

    const silent = await openEventPage({ ai: { ...AI_ON, teaserText: '' }, options: { timers: true } });
    await silent.advance(10000);
    assert.equal(isHidden(silent.element('assistant-teaser')), true, 'no teaser text');

    // A blocked storage changes nothing but the memory
    const blocked = await openEventPage({ options: { timers: true, storage: 'throws' } });
    await blocked.advance(4000);
    assert.equal(isHidden(blocked.element('assistant-teaser')), false);
    await blocked.app.runAction('closeAssistantTeaser', {});
    assert.equal(isHidden(blocked.element('assistant-teaser')), true);
});

test('opening shows greeting and the three suggestions and marks the teaser as seen', async () => {
    const harness = await openEventPage({ options: { timers: true } });
    await harness.advance(4000);
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));

    assert.equal(isHidden(harness.element('assistant-panel')), false);
    assert.equal(isHidden(harness.element('assistant-teaser')), true, 'the teaser goes');
    assert.notEqual(harness.localStorage.getItem(TEASER_KEY), null);
    assert.equal(harness.element('assistant-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(harness.element('assistant-name').textContent, 'Raid-Helfer');
    assert.equal(harness.element('assistant-event-title').textContent, 'Antwortet zu: Raid-Abend: Nachtfestung');
    assert.equal(message(harness, 1).innerHTML, GREETING);
    assert.equal(harness.element('assistant-suggestions').disabled, false);

    // Esc closes and gives the focus back to the toggle; the page behind does not see the key
    let stopped = false;
    harness.element('event-assistant').onkeydown({ key: 'Escape', stopPropagation: () => { stopped = true; } });
    assert.equal(isHidden(harness.element('assistant-panel')), true);
    assert.equal(stopped, true);
    assert.equal(harness.element('assistant-toggle').getAttribute('aria-expanded'), 'false');
    assert.deepEqual(harness.element('assistant-toggle').calls.at(-1), ['focus']);

    // Opening again does not greet twice
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));
    assert.equal(message(harness, 2), null);
});

test('a question is sent with CSRF token and history and the streamed answer is shown', async () => {
    const bodies = [];
    const gate = createGate();
    // The first answer is split inside an event and inside the two bytes of "ü"; the line ends are CRLF
    const first = Buffer.from((sse('token', { text: 'Grüße, ' }) + sse('token', { text: 'um 20 Uhr.' }) + sse('done', { source: 'Termin' })).replace(/\n/g, '\r\n'));
    const umlaut = first.indexOf(Buffer.from('ü')) + 1;
    const middle = first.indexOf(Buffer.from('event: token'), umlaut) + 4;
    const answers = [
        streamAnswer([first.subarray(0, umlaut), first.subarray(umlaut, middle), gate.opened.then(() => first.subarray(middle))]),
        answer(['Ja.'])
    ];
    const harness = await openEventPage({ routes: { [ASK_URL]: (options) => { bodies.push(JSON.parse(options.body)); return answers.shift(); } } });
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));

    harness.element('assistant-input').value = '  Wann geht es los?  ';
    const sending = harness.app.runAction('sendAssistantQuestion', harness.element('assistant-send'));
    await settle();
    const [request] = askRequests(harness);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['X-CSRF-TOKEN'], 'csrf-1');
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.deepEqual(bodies[0], { question: 'Wann geht es los?', history: [] });
    assert.equal(harness.element('assistant-input').value, '', 'the input is emptied');
    assert.equal(message(harness, 2).innerHTML, 'Wann geht es los?');
    // Mid-stream: the first token is shown as text, the answer is still busy
    assert.equal(message(harness, 3).innerHTML, 'Grüße, ');
    assert.equal(message(harness, 3).getAttribute('aria-busy'), 'true');

    gate.release();
    await sending;
    await settle();
    assert.equal(message(harness, 3).getAttribute('aria-busy'), 'false');
    assert.match(message(harness, 3).innerHTML, /^Grüße, um 20 Uhr\./);

    await ask(harness, 'Und danach?');
    assert.deepEqual(bodies[1], {
        question: 'Und danach?',
        history: [{ role: 'user', text: 'Wann geht es los?' }, { role: 'assistant', text: 'Grüße, um 20 Uhr.' }]
    });
    assert.match(message(harness, 5).innerHTML, /^Ja\./);
});

test('only the last six finished turns go along as history', async () => {
    const bodies = [];
    const harness = await openEventPage({ routes: { [ASK_URL]: (options) => { bodies.push(JSON.parse(options.body)); return answer([`Antwort ${bodies.length}`]); } } });
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));
    for (const n of [1, 2, 3, 4, 5]) await ask(harness, `Frage ${n}`);
    assert.deepEqual(bodies[4].history.map(turn => turn.text), ['Frage 2', 'Antwort 2', 'Frage 3', 'Antwort 3', 'Frage 4', 'Antwort 4']);
    assert.deepEqual(bodies[4].history.map(turn => turn.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
});

test('the source becomes a chip; no source, no chip', async () => {
    const bodies = [];
    const answers = [answer(['Ab 20 Uhr.'], 'Beschreibung'), answer(['Keine Ahnung.'], '')];
    const harness = await openEventPage({ routes: { [ASK_URL]: (options) => { bodies.push(JSON.parse(options.body)); return answers.shift(); } } });
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));

    await ask(harness, 'Wann?');
    assert.match(message(harness, 3).innerHTML, /<span class="chip chip-sm chip-accent assistant-source">.*Quelle: Beschreibung<\/span>/);
    await ask(harness, 'Wo?');
    assert.doesNotMatch(message(harness, 5).innerHTML, /Quelle|assistant-source/);
    assert.equal(harness.element('assistant-messages').innerHTML.includes('Quelle'), false);
    // The chip is not part of the answer the next question carries
    assert.deepEqual(bodies[1].history[1], { role: 'assistant', text: 'Ab 20 Uhr.' });
});

test('question and answer are escaped while streaming and markdown-rendered safely at the end', async () => {
    const gate = createGate();
    const harness = await openEventPage({
        routes: { [ASK_URL]: streamAnswer([sse('token', { text: '**fett** <script>alert(1)</script>' }), gate.opened.then(() => sse('done', { source: '' }))]) }
    });
    // Like the real libraries: marked turns ** into <strong>, DOMPurify drops the script element
    const sanitized = [];
    harness.window.marked = { parse: (text) => text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') };
    harness.window.DOMPurify = { sanitize: (html) => { sanitized.push(html); return html.replace(/<script>[\s\S]*?<\/script>/g, ''); } };
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));

    harness.element('assistant-input').value = '<img src=x onerror=1>';
    const sending = harness.app.runAction('sendAssistantQuestion', harness.element('assistant-send'));
    await settle();
    assert.equal(message(harness, 2).innerHTML, '&lt;img src=x onerror=1&gt;');
    assert.equal(message(harness, 3).innerHTML, '**fett** &lt;script&gt;alert(1)&lt;/script&gt;');

    gate.release();
    await sending;
    await settle();
    assert.equal(sanitized.length, 1, 'the final answer goes through the sanitizer');
    assert.match(message(harness, 3).innerHTML, /<strong>fett<\/strong>/);
    assert.doesNotMatch(message(harness, 3).innerHTML, /<script/);
});

test('a 429 shows the server sentence and keeps the bubble; a 404 removes it', async () => {
    const LIMIT = 'Du hast in dieser Stunde schon viele Fragen gestellt. Versuche es später noch einmal.';
    const answers = [httpAnswer(429, { error: LIMIT }), streamAnswer([sse('token', { text: 'Halb' }), sse('error', { error: 'Der Event-Assistent ist gerade nicht erreichbar.' })]), httpAnswer(404, { error: 'Event nicht gefunden.' })];
    const bodies = [];
    const harness = await openEventPage({ routes: { [ASK_URL]: (options) => { bodies.push(JSON.parse(options.body)); return answers.shift(); } } });
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));

    await ask(harness, 'Frage eins');
    assert.equal(message(harness, 3).innerHTML, LIMIT);
    assert.match(message(harness, 3).className, /\bis-warning\b/);
    assert.equal(isHidden(harness.element('event-assistant')), false, '429 keeps the bubble');
    assert.equal(harness.element('assistant-input').disabled, false);

    await ask(harness, 'Frage zwei');
    assert.equal(message(harness, 5).innerHTML, 'Der Event-Assistent ist gerade nicht erreichbar.');
    assert.match(message(harness, 5).className, /\bis-warning\b/);
    assert.equal(isHidden(harness.element('event-assistant')), false, 'a stream error keeps the bubble');

    await ask(harness, 'Frage drei');
    // Failed answers never go along as history
    assert.deepEqual(bodies[2].history, []);
    assert.equal(isHidden(harness.element('event-assistant')), true, '404 removes the bubble');
    assert.deepEqual(harness.toasts, ['Event nicht gefunden.']);
});

test('a stream that ends without done is reported as interrupted', async () => {
    const harness = await openEventPage({ routes: { [ASK_URL]: streamAnswer([sse('token', { text: 'Am Sam' })]) } });
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));
    await ask(harness, 'Wann?');
    assert.equal(message(harness, 3).innerHTML, INTERRUPTED);
    assert.match(message(harness, 3).className, /\bis-warning\b/);
});

test('readEventStream hands tokens, the source and errors to its callbacks', async () => {
    const { app } = await loadFrontendApp({});
    const read = async (chunks) => {
        const calls = [];
        await app.readEventStream(streamAnswer(chunks).toResponse(), {
            onToken: (text) => calls.push(['token', text]),
            onDone: (result) => calls.push(['done', result.source]),
            onError: (error) => calls.push(['error', error])
        });
        return calls;
    };
    assert.deepEqual(await read([sse('token', { text: 'a' }) + sse('token', { text: 'b' }), sse('done', { source: 'Plätze' })]), [['token', 'a'], ['token', 'b'], ['done', 'Plätze']]);
    // CRLF, a line end split between two chunks, a comment line and an unknown event
    assert.deepEqual(await read([': ping\r\n\r\nevent: token\r', '\ndata: {"text":"x"}\r\n\r\nevent: other\r\ndata: {}\r\n\r\n', 'event: done\r\ndata: {"source":""}\r\n\r\n']), [['token', 'x'], ['done', '']]);
    assert.deepEqual(await read([sse('token', { text: 'a' }), sse('error', { error: 'Kaputt.' })]), [['token', 'a'], ['error', 'Kaputt.']]);
    assert.deepEqual(await read([sse('token', { text: 'a' })]), [['token', 'a'], ['error', INTERRUPTED]]);
    // A last event without the closing blank line still counts
    assert.deepEqual(await read(['event: done\ndata: {"source":"Termin"}']), [['done', 'Termin']]);
});

test('a second question cannot be sent while the first is running', async () => {
    const gate = createGate();
    const harness = await openEventPage({ routes: { [ASK_URL]: () => gate.opened.then(() => answer(['Gleich.'])) } });
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));

    harness.element('assistant-input').value = 'Erste Frage';
    const sending = harness.app.runAction('sendAssistantQuestion', harness.element('assistant-send'));
    await settle();
    assert.equal(harness.element('assistant-input').disabled, true);
    assert.equal(harness.element('assistant-send').disabled, true);
    assert.equal(harness.element('assistant-suggestions').disabled, true);

    harness.element('assistant-input').value = 'Zweite Frage';
    await harness.app.runAction('sendAssistantQuestion', harness.element('assistant-send'));
    await harness.app.runAction('askSuggestedQuestion', { dataset: { question: 'Was sind die Regeln?' } });
    // Enter in the input submits the form; that is no way around it either
    let prevented = false;
    harness.element('assistant-form').onsubmit({ preventDefault: () => { prevented = true; } });
    await settle();
    assert.equal(prevented, true);
    assert.equal(askRequests(harness).length, 1);

    gate.release();
    await sending;
    await settle();
    assert.equal(harness.element('assistant-input').disabled, false);
    assert.equal(harness.element('assistant-suggestions').disabled, false);
    await harness.app.runAction('askSuggestedQuestion', { dataset: { question: 'Was sind die Regeln?' } });
    await settle();
    assert.equal(askRequests(harness).length, 2);
    assert.equal(JSON.parse(askRequests(harness)[1].body).question, 'Was sind die Regeln?');
});

test('closing the panel while an answer runs stops it without an error message', async () => {
    let signal = null;
    const harness = await openEventPage({ routes: { [ASK_URL]: (options) => { signal = options.signal; return streamAnswer([sse('token', { text: 'Am' }), new Promise(() => {})]); } } });
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));
    harness.element('assistant-input').value = 'Wann?';
    const sending = harness.app.runAction('sendAssistantQuestion', harness.element('assistant-send'));
    await settle();

    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));
    await sending;
    await settle();
    assert.equal(signal.aborted, true);
    assert.doesNotMatch(message(harness, 3).innerHTML, /unterbrochen|Fehler/);
    assert.deepEqual(harness.toasts, []);
    assert.equal(harness.element('assistant-input').disabled, false, 'the input is free again');
});

test('leaving the event page forgets the conversation', async () => {
    const bodies = [];
    let signal = null;
    const answers = [
        () => answer(['Um 20 Uhr.'], 'Termin'),
        (options) => { signal = options.signal; return streamAnswer([sse('token', { text: 'Am' }), new Promise(() => {})]); },
        () => answer(['Neu.'])
    ];
    const harness = await openEventPage({ routes: { [ASK_URL]: (options) => { bodies.push(JSON.parse(options.body)); return answers.shift()(options); } } });
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));
    await ask(harness, 'Wann?');
    harness.element('assistant-input').value = 'Und wo?';
    const sending = harness.app.runAction('sendAssistantQuestion', harness.element('assistant-send'));
    await settle();

    harness.location.hash = '#events';
    await harness.app.handleRoute();
    await sending;
    await settle();
    assert.equal(signal.aborted, true, 'the running answer is stopped');
    assert.equal(isHidden(harness.element('event-assistant')), true);
    assert.equal(isHidden(harness.element('assistant-panel')), true);
    assert.equal(harness.element('assistant-toggle').getAttribute('aria-expanded'), 'false');

    harness.location.hash = '#event/ev';
    await harness.app.handleRoute();
    await settle();
    assert.equal(isHidden(harness.element('event-assistant')), false);
    assert.equal(isHidden(harness.element('assistant-panel')), true, 'the panel starts closed again');
    await harness.app.runAction('toggleAssistant', harness.element('assistant-toggle'));
    assert.equal(message(harness, 1).innerHTML, GREETING);
    await ask(harness, 'Noch mal?');
    assert.deepEqual(bodies[2], { question: 'Noch mal?', history: [] });
});
