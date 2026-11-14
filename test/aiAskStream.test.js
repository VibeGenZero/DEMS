const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { createAskRouter } = require('../routes/eventAsk');
const { AskRefusal } = require('../ai/memberAssistant');

// Failure paths of the event stream with fake `prepare` functions: the dev
// mock answers synchronously and ignores the abort signal.
let prepare;
let server;
let port;
before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { user: { id: 'u1', roles: [], isAdmin: false } }; next(); });
    app.use('/api/events', createAskRouter({ prepare: (params) => prepare(params), featureOn: () => true }));
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
});
after(() => { server.closeAllConnections(); server.close(); });

const tick = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (condition) => { for (let i = 0; i < 100 && !condition(); i++) await tick(20); };

/** POST a question; resolves { req, res, body() } once the response headers arrive, or { req } with `waitHeaders: false`. */
function ask({ waitHeaders = true } = {}) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ question: 'Hallo?' });
        const req = http.request({
            host: '127.0.0.1', port, path: '/api/events/e1/ask', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        });
        req.on('error', () => {});
        req.on('response', (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { text += chunk; });
            res.on('error', () => {});
            resolve({ req, res, text: () => text, ended: new Promise(done => res.on('end', done)) });
        });
        req.end(payload);
        if (!waitHeaders) setTimeout(() => resolve({ req }), 0);
        setTimeout(() => reject(new Error('no response')), 5000).unref();
    });
}

test('a refusal of run after the first byte becomes an error event with its sentence', async () => {
    prepare = async () => ({
        cancel() {},
        async run({ onToken }) { onToken('Hallo '); throw new AskRefusal(503, 'Satz vom Dienst.'); }
    });
    const r = await ask();
    await r.ended;
    assert.equal(r.res.statusCode, 200);
    assert.equal(r.text(), 'event: token\ndata: {"text":"Hallo "}\n\nevent: error\ndata: {"error":"Satz vom Dienst."}\n\n');
});

test('any other error becomes the 503 sentence without its raw message', async () => {
    prepare = async () => ({ cancel() {}, async run() { throw new Error('secret detail'); } });
    const r = await ask();
    await r.ended;
    assert.equal(r.text().includes('secret detail'), false);
    assert.match(r.text(), /event: error\ndata: \{"error":"Der Event-Assistent ist gerade nicht erreichbar\. Bitte versuche es später noch einmal\."\}/);
});

test('a raw error of prepare answers 500 JSON', async () => {
    prepare = async () => { throw new Error('db down'); };
    const r = await ask();
    await r.ended;
    assert.equal(r.res.statusCode, 500);
    assert.deepEqual(JSON.parse(r.text()), { error: 'Die Frage konnte nicht verarbeitet werden.' });
});

test('a client disconnect during the stream aborts the provider call and writes nothing more', async () => {
    const seen = { aborted: false, finished: false, writes: 0 };
    prepare = async () => ({
        cancel() {},
        async run({ onToken, signal }) {
            onToken('Eins ');
            await new Promise(resolve => signal.addEventListener('abort', () => { seen.aborted = true; resolve(); }));
            onToken('Zwei');
            seen.finished = true;
            throw new Error('aborted');
        }
    });
    const r = await ask();
    await until(() => r.text().includes('Eins'));
    r.req.destroy();
    await until(() => seen.finished);
    assert.equal(seen.aborted, true);
    assert.equal(r.text().includes('Zwei'), false);
});

test('a client disconnect while prepare runs: run is never called, cancel is', async () => {
    const seen = { run: 0, cancel: 0, release: null };
    const gate = new Promise(resolve => { seen.release = resolve; });
    prepare = async () => {
        await gate;
        return { cancel() { seen.cancel++; }, async run() { seen.run++; return { text: '', source: '' }; } };
    };
    const r = await ask({ waitHeaders: false });
    await tick(100);
    r.req.destroy();
    await tick(100);
    seen.release();
    await until(() => seen.cancel > 0);
    assert.equal(seen.cancel, 1);
    assert.equal(seen.run, 0);
});
