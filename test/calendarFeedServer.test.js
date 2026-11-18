const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

// Calendar subscription (calendar-feed). The server and this test share one
// SQLite file: the test plants events with registrations of the member
// persona in every status, then the dev mock server seeds its own data next to them.
const tmpDir = createTempDir('calendar-feed-server');
const dbPath = path.join(tmpDir, 'dev.sqlite');
process.chdir(tmpDir);
process.env.SQLITE_PATH = dbPath;
for (const key of Object.keys(process.env)) {
    if (key === 'DATABASE_URL' || key.startsWith('PG')) delete process.env[key];
}

const { db, collection, doc, getDocs, setDoc } = require('../firebaseAdmin');
const { PERSONAS } = require('../dev/mockGuild');

const persona = (id) => PERSONAS.find(entry => entry.id === id);
const MEMBER = persona('member');
const DAY = 24 * 60 * 60 * 1000;
const at = (days) => new Date(Date.now() + days * DAY).toISOString();

// Planted events of the member, by registration status
const PLANTED = {
    'cf-accepted': { title: 'Kalender: Zusage', status: 'active', registration: 'accepted' },
    'cf-waitlisted': { title: 'Kalender: Warteliste', status: 'active', registration: 'waitlisted' },
    'cf-tentative': { title: 'Kalender: Vielleicht', status: 'active', registration: 'tentative' },
    'cf-cancelled': { title: 'Kalender: Abgesagt', status: 'cancelled', registration: 'accepted' },
    'cf-rejected': { title: 'Kalender: Abgelehnt', status: 'active', registration: 'rejected' },
    'cf-draft': { title: 'Kalender: Entwurf', status: 'draft', registration: 'accepted' }
};

let server;

before(async () => {
    let offset = 2;
    for (const [id, planted] of Object.entries(PLANTED)) {
        await setDoc(doc(db, 'events', id), {
            title: planted.title, status: planted.status, accessMode: 'open', approvalMode: 'instant', allowGuests: false,
            maxParticipants: 0, formFields: [], startDate: at(offset), endDate: '', location: { text: 'Discord', channelId: null, channelType: null },
            createdAt: at(-10), updatedAt: at(-1)
        });
        await setDoc(doc(db, 'registrations', `${id}-member`), {
            eventId: id, userId: MEMBER.userId, userName: MEMBER.displayName, status: planted.registration, source: 'web',
            createdAt: at(-5), formAnswers: {}, guests: [], pendingGuests: []
        });
        offset += 1;
    }
    server = await startServer('dev/start.js', { DEV_SQLITE_PATH: dbPath });
});

after(() => server?.stop());

async function loginAs(personaId) {
    const client = createClient(server.baseUrl);
    const res = await client.request(`/auth/dev-login/${personaId}`);
    assert.equal(res.status, 302);
    return client;
}

const tokenOf = (url) => url.match(/\/calendar\/([A-Za-z0-9_-]{43})\.ics$/)[1];

// ── Profile API ─────────────────────────────────────────────────────────

test('without a session the subscription endpoints answer 401', async () => {
    const visitor = createClient(server.baseUrl);
    assert.equal((await visitor.request('/api/user/calendar')).status, 401);
    assert.equal((await visitor.send('POST', '/api/user/calendar')).status, 401);
    assert.equal((await visitor.send('DELETE', '/api/user/calendar')).status, 401);
});

test('a member without a subscription has none', async () => {
    const raider = await loginAs('raider');
    const res = await raider.request('/api/user/calendar');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { enabled: false });
});

test('setting up needs the CSRF token', async () => {
    const raider = await loginAs('raider');
    const res = await raider.request('/api/user/calendar', { method: 'POST' });
    assert.equal(res.status, 403);
    assert.deepEqual(await (await raider.request('/api/user/calendar')).json(), { enabled: false });
});

test('setting up gives the links, and the profile shows them again', async () => {
    const raider = await loginAs('raider');
    const res = await raider.send('POST', '/api/user/calendar');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enabled, true);
    assert.match(body.url, /^http:\/\/localhost:\d+\/calendar\/[A-Za-z0-9_-]{43}\.ics$|^https?:\/\/[^/]+\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    assert.equal(body.webcalUrl, body.url.replace(/^https?:\/\//, 'webcal://'));
    assert.equal(body.googleUrl, `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(body.webcalUrl)}`);
    assert.ok(!Number.isNaN(Date.parse(body.createdAt)));
    assert.deepEqual(await (await raider.request('/api/user/calendar')).json(), body);
});

test('renewing gives a new link, ending removes it', async () => {
    const raider = await loginAs('raider');
    const first = await (await raider.send('POST', '/api/user/calendar')).json();
    const second = await (await raider.send('POST', '/api/user/calendar')).json();
    assert.notEqual(tokenOf(first.url), tokenOf(second.url));
    const ended = await raider.send('DELETE', '/api/user/calendar');
    assert.equal(ended.status, 200);
    assert.deepEqual(await ended.json(), { enabled: false });
    assert.deepEqual(await (await raider.request('/api/user/calendar')).json(), { enabled: false });
});

test('the secret appears in no other answer, also not for admins', async () => {
    const member = await loginAs('member');
    const { url } = await (await member.send('POST', '/api/user/calendar')).json();
    const token = tokenOf(url);
    const admin = await loginAs('admin');
    for (const [client, pathname] of [
        [admin, '/api/admin/members'],
        [admin, '/api/admin/insights'],
        [admin, `/api/admin/members/${MEMBER.userId}`],
        [member, '/api/user/profile'],
        [member, '/api/user/settings'],
        [member, '/auth/me']
    ]) {
        const res = await client.request(pathname);
        assert.equal(res.status, 200, pathname);
        assert.ok(!(await res.text()).includes(token), pathname);
    }
});

// ── Public feed ─────────────────────────────────────────────────────────

/** Fetch a feed link like a calendar app: no cookies, no CSRF token. */
const fetchFeed = (url) => fetch(`${server.baseUrl}${new URL(url).pathname}`);
const unfold = (text) => text.replace(/\r\n /g, '');
const countSessions = async () => (await getDocs(collection(db, 'sessions'))).size;

test('a calendar app fetches the member\'s events without a session', async () => {
    const member = await loginAs('member');
    const { url } = await (await member.send('POST', '/api/user/calendar')).json();
    const sessionsBefore = await countSessions();

    const res = await fetchFeed(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'private, max-age=300');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    assert.equal(res.headers.get('set-cookie'), null);
    const lines = unfold(await res.text()).split('\r\n');
    assert.equal(lines[0], 'BEGIN:VCALENDAR');
    assert.ok(lines.includes('SUMMARY:Kalender: Zusage'));
    assert.ok(lines.includes('SUMMARY:[Warteliste] Kalender: Warteliste'));
    assert.ok(lines.includes('SUMMARY:[Vielleicht] Kalender: Vielleicht'));
    assert.ok(lines.includes('SUMMARY:[Abgesagt] Kalender: Abgesagt'));
    assert.ok(lines.some(line => /^UID:cf-accepted@[^@\s]+$/.test(line)));
    assert.ok(!lines.some(line => line.includes('Kalender: Abgelehnt')));
    assert.ok(!lines.some(line => line.includes('Kalender: Entwurf')));
    assert.equal(await countSessions(), sessionsBefore, 'the fetch stores no session');
});

test('unknown and malformed links answer 404 as plain text', async () => {
    for (const pathname of [`/calendar/${'A'.repeat(43)}.ics`, '/calendar/abc.ics', `/calendar/${'A'.repeat(43)}`, `/calendar/${'A'.repeat(43)}.txt`]) {
        const res = await fetch(`${server.baseUrl}${pathname}`);
        assert.equal(res.status, 404, pathname);
        assert.match(res.headers.get('content-type'), /^text\/plain/, pathname);
        assert.equal(await res.text(), 'Kalender nicht gefunden.', pathname);
    }
});

test('a renewed or ended link answers 404', async () => {
    const raider = await loginAs('raider');
    const first = await (await raider.send('POST', '/api/user/calendar')).json();
    const second = await (await raider.send('POST', '/api/user/calendar')).json();
    assert.equal((await fetchFeed(first.url)).status, 404);
    assert.equal((await fetchFeed(second.url)).status, 200);
    await raider.send('DELETE', '/api/user/calendar');
    assert.equal((await fetchFeed(second.url)).status, 404);
});

test('maintenance mode does not stop the feed', async () => {
    const admin = await loginAs('admin');
    const { url } = await (await admin.send('POST', '/api/user/calendar')).json();
    assert.equal((await admin.send('PUT', '/api/admin/maintenance', { loginDisabled: true, registrationDisabled: true, warningEnabled: true, warningText: 'Wartung' })).status, 200);
    try {
        const res = await fetchFeed(url);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8');
    } finally {
        await admin.send('PUT', '/api/admin/maintenance', { loginDisabled: false, registrationDisabled: false, warningEnabled: false });
    }
});

test('one link fetched too often answers 429 while another link still answers', async () => {
    const member = await loginAs('member');
    const { url } = await (await member.send('POST', '/api/user/calendar')).json();
    const raider = await loginAs('raider');
    const other = await (await raider.send('POST', '/api/user/calendar')).json();
    for (let i = 0; i < 30; i++) assert.equal((await fetchFeed(url)).status, 200, `fetch ${i + 1}`);
    assert.equal((await fetchFeed(url)).status, 429);
    assert.equal((await fetchFeed(other.url)).status, 200);
});

test('deleting the account ends the subscription', async () => {
    const newbie = await loginAs('newbie');
    const { url } = await (await newbie.send('POST', '/api/user/calendar')).json();
    assert.equal((await fetchFeed(url)).status, 200);
    assert.equal((await newbie.send('DELETE', '/api/user/account')).status, 200);
    assert.equal((await fetchFeed(url)).status, 404);
});
