const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');
const { PERSONAS, ROLE_ID } = require('../dev/mockGuild');
const { EVENT_ID, SERIES_EVENT_IDS, CHECKIN_CODE } = require('../dev/seedData');

let server;
let uploadDir;

before(async () => {
    const tmpDir = createTempDir('dev-server');
    uploadDir = path.join(tmpDir, 'uploads');
    server = await startServer('dev/start.js', {
        DEV_SQLITE_PATH: path.join(tmpDir, 'dev.sqlite'),
        DEV_UPLOAD_DIR: uploadDir
    });
});

after(() => server.stop());

const personaById = (id) => PERSONAS.find(persona => persona.id === id);

async function loginAs(personaId, client = createClient(server.baseUrl)) {
    const res = await client.request(`/auth/dev-login/${personaId}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/#events');
    return client;
}

async function currentUser(client) {
    return (await client.request('/auth/me')).json();
}

test('the login button leads to the persona page', async () => {
    const client = createClient(server.baseUrl);

    const redirect = await client.request('/auth/discord');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/auth/dev-login');

    const page = await client.request('/auth/dev-login');
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const persona of PERSONAS) {
        assert.ok(html.includes(`/auth/dev-login/${persona.id}`), persona.id);
    }
});

test('the persona page takes its look from a stylesheet, as the policy allows no style element', async () => {
    const client = createClient(server.baseUrl);
    const html = await (await client.request('/auth/dev-login')).text();
    assert.doesNotMatch(html, /<style|\sstyle=/);
    assert.match(html, /<link rel="stylesheet" href="\/auth\/dev-login\.css">/);

    const css = await client.request('/auth/dev-login.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.match(await css.text(), /\.persona\s*\{/);
});

test('the Discord callback does not reach Discord in mock mode', async () => {
    const res = await createClient(server.baseUrl).request('/auth/discord/callback?code=abc');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/auth/dev-login');
});

test('the admin persona gets into the admin area', async () => {
    const client = await loginAs('admin');
    const me = await currentUser(client);
    assert.equal(me.id, personaById('admin').userId);
    assert.equal(me.isAdmin, true);
    assert.equal((await client.request('/api/admin/stats')).status, 200);
});

test('the member persona is refused by the admin area', async () => {
    const client = await loginAs('member');
    assert.equal((await currentUser(client)).isAdmin, false);
    assert.equal((await client.request('/api/admin/stats')).status, 403);
});

test('the raider persona carries the Raid-Team role', async () => {
    const me = await currentUser(await loginAs('raider'));
    assert.ok(me.roles.includes(ROLE_ID.RAID_TEAM));
    assert.equal(me.isAdmin, false);
});

test('the newbie persona is a new user on the first login only', async () => {
    const first = await loginAs('newbie');
    assert.equal((await currentUser(first)).isNewUser, true);
    assert.equal((await currentUser(first)).isNewUser, false);

    const second = await loginAs('newbie');
    assert.equal((await currentUser(second)).isNewUser, false);
});

test('a second login in the same browser replaces the persona', async () => {
    const client = await loginAs('admin');
    await loginAs('member', client);

    const me = await currentUser(client);
    assert.equal(me.id, personaById('member').userId);
    assert.equal(me.isAdmin, false);
    assert.equal((await client.request('/api/admin/stats')).status, 403);
});

test('the persona login starts a new session like the Discord login', async () => {
    const client = createClient(server.baseUrl);
    await client.request('/api/csrf-token');
    const sessionBeforeLogin = client.cookie('connect.sid');
    assert.ok(sessionBeforeLogin);

    await loginAs('member', client);
    assert.notEqual(client.cookie('connect.sid'), sessionBeforeLogin);
    assert.equal((await currentUser(client)).username, 'tom');
});

test('the server info names the Discord server and its icon without a login', async () => {
    const res = await fetch(`${server.baseUrl}/api/server-info`);
    assert.equal(res.status, 200);
    const info = await res.json();
    assert.equal(info.serverName, 'DEMS Dev Server');
    // The mock server has no icon -> the login card shows its initials
    assert.ok('iconUrl' in info);
    assert.equal(info.iconUrl, null);
});

test('requests without a session cookie store no session until the CSRF token is fetched', async () => {
    // Sessions live in the database -> pages, assets and crawlers must not create one each
    for (const url of ['/', '/css/style.css', '/irgendein/pfad', '/api/server-info', '/auth/me']) {
        const res = await fetch(server.baseUrl + url, { redirect: 'manual' });
        assert.equal(res.headers.getSetCookie().find(cookie => cookie.startsWith('connect.sid=')), undefined, url);
    }

    const tokenRes = await fetch(`${server.baseUrl}/api/csrf-token`);
    assert.ok(tokenRes.headers.getSetCookie().some(cookie => cookie.startsWith('connect.sid=')));
    assert.match((await tokenRes.json()).token, /^[0-9a-f]{64}$/);
});

test('parallel first changes after a login all pass the CSRF check', async () => {
    // Each send() fetches the token, then writes. Without a token minted by the login,
    // parallel requests each mint their own and all but the last stored one get 403.
    // Timing-dependent, hence several logins.
    for (let round = 0; round < 5; round++) {
        const raider = await loginAs('raider');
        const responses = await Promise.all([1, 2, 3].map(() => raider.send('PUT', '/api/user/settings', { acceptInvitations: true })));
        assert.deepEqual(responses.map(res => res.status), [200, 200, 200], `round ${round}`);
    }
});

test('an unknown persona is rejected', async () => {
    const client = createClient(server.baseUrl);
    assert.equal((await client.request('/auth/dev-login/nobody')).status, 404);
    assert.equal(await currentUser(client), null);
});

test('the content security policy allows only own scripts, styles and fonts, no eval and nothing inline', async () => {
    const res = await createClient(server.baseUrl).request('/');
    assert.equal(res.status, 200);
    const directives = Object.fromEntries(res.headers.get('content-security-policy').split(';')
        .map(part => part.trim().split(/\s+/))
        .map(([name, ...sources]) => [name, sources.join(' ')]));

    assert.equal(directives['script-src'], "'self'");
    assert.equal(directives['script-src-attr'], "'none'");
    assert.equal(directives['style-src'], "'self'");
    assert.equal(directives['style-src-attr'], "'none'");
    assert.equal(directives['font-src'], "'self'");
    assert.ok(!directives['connect-src'].includes('cdn.jsdelivr.net'), directives['connect-src']);
});

test('seeded events are served', async () => {
    const member = await loginAs('member');
    const res = await member.request('/api/events');
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.ok(data.some(event => event.id === EVENT_ID.OPEN));
    assert.ok(!data.some(event => event.id === EVENT_ID.DRAFT));
});

test('the dummy banners are served in mock mode', async () => {
    const member = await loginAs('member');
    const event = await (await member.request(`/api/events/${EVENT_ID.ROLE}`)).json();
    const { pathname } = new URL(event.bannerUrl);
    assert.equal(pathname, '/dev-banners/raid.svg');
    const res = await createClient(server.baseUrl).request(pathname);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^image\/svg\+xml/);
});

test('the routes read the mock Discord server', async () => {
    const admin = await loginAs('admin');
    const roles = await (await admin.request('/api/admin/roles')).json();
    assert.ok(roles.some(role => role.name === 'Raid-Team'));
    const channels = await (await admin.request('/api/admin/channels')).json();
    assert.ok(channels.some(channel => channel.name === 'mod-intern'));
    assert.equal((await (await admin.request('/api/admin/bot/status')).json()).online, true);

    const member = await loginAs('member');
    const options = await (await member.request('/api/events/form-options')).json();
    assert.ok(options.roles.some(role => role.name === 'Raid-Team'));
    assert.ok(!options.roles.some(role => role.name === 'DEMS Bot'));
    assert.ok(!options.channels.some(channel => channel.name === 'mod-intern'));
});

// The profile tests read the seed as it is, so they run before the tests below register, check in and duplicate
test('the profile lists upcoming events by start and the history newest first', async () => {
    await server.waitForOutput('Archived 1 ended event(s)');
    const res = await (await loginAs('member')).request('/api/user/profile');
    assert.equal(res.status, 200);
    const profile = await res.json();
    assert.equal('registrations' in profile, false);

    assert.deepEqual(profile.upcoming.map(entry => [entry.event.id, entry.status]), [
        [EVENT_ID.RUNNING, 'accepted'],
        [EVENT_ID.FULL, 'waitlisted'],
        [EVENT_ID.FORM, 'pending'],
        [EVENT_ID.BIG_FORM, 'rejected']
    ]);
    // Tom can still check in to the running event; the full event offers no check-in
    assert.deepEqual([profile.upcoming[0].checkedIn, profile.upcoming[0].event.checkinEnabled], [false, true]);
    assert.equal(profile.upcoming[1].event.checkinEnabled, false);

    assert.deepEqual(profile.history.map(entry => [entry.event.id, entry.event.status, entry.checkedIn]), [
        [EVENT_ID.PAST, 'archived', true],
        [EVENT_ID.CANCELLED, 'cancelled', false],
        [EVENT_ID.ARCHIVED, 'archived', false]
    ]);
});

test('a profile entry carries only what the page shows', async () => {
    await server.waitForOutput('Archived 1 ended event(s)');
    const profile = await (await (await loginAs('raider')).request('/api/user/profile')).json();
    const entries = [...profile.upcoming, ...profile.history];
    assert.equal(entries.length, profile.stats.total);
    for (const entry of entries) {
        assert.deepEqual(Object.keys(entry).sort(), ['checkedIn', 'createdAt', 'event', 'id', 'slot', 'status', 'waitlistPosition']);
        assert.deepEqual(Object.keys(entry.event).sort(), ['category', 'checkinEnabled', 'endDate', 'id', 'location', 'startDate', 'status', 'title']);
    }
    assert.equal(profile.upcoming.find(entry => entry.event.id === EVENT_ID.OPEN).event.location, 'Lobby');
    // Both dates of the series are listed, each with its own start
    const series = profile.upcoming.filter(entry => SERIES_EVENT_IDS.includes(entry.event.id));
    assert.equal(series.length, 2);
    assert.notEqual(series[0].event.startDate, series[1].event.startDate);
});

test('the profile tells the slot of a registration, a new member gets two empty lists', async () => {
    const admin = await (await (await loginAs('admin')).request('/api/user/profile')).json();
    const raid = admin.upcoming.find(entry => entry.event.id === EVENT_ID.ROLE);
    assert.deepEqual([raid.slot.name, raid.slot.wish], ['Schaden', false]);
    assert.notEqual(raid.slot.emoji, '');

    const newbie = await (await (await loginAs('newbie')).request('/api/user/profile')).json();
    assert.deepEqual([newbie.upcoming, newbie.history, newbie.stats.total], [[], [], 0]);
});

test('announcing an event is logged instead of sent to Discord', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.OPEN}/announce`, { text: 'Heute Abend geht es los!' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).success, true);
    await server.waitForOutput('Heute Abend geht es los!');
    assert.ok(server.output().includes('[MOCK-DISCORD]'));
});

test('announcing stores the message for live updates', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.OPEN}/announce`, { text: 'Live!' });
    assert.equal(res.status, 200);

    const events = await (await admin.request('/api/admin/all-events')).json();
    const announcements = events.find(event => event.id === EVENT_ID.OPEN).announcements;
    assert.ok(announcements.length >= 1);
    assert.match(announcements[announcements.length - 1].messageId, /^\d+$/);
});

test('starting a draft event works on SQLite', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.DRAFT}/start`);
    assert.equal(res.status, 200);

    const events = await (await admin.request('/api/admin/all-events')).json();
    assert.equal(events.find(event => event.id === EVENT_ID.DRAFT).status, 'active');
});

test('the member persona can check in to the running event', async () => {
    const member = await loginAs('member');
    const wrong = await member.send('POST', `/api/events/${EVENT_ID.RUNNING}/checkin`, { code: '000000' });
    assert.equal(wrong.status, 400);

    const right = await member.send('POST', `/api/events/${EVENT_ID.RUNNING}/checkin`, { code: CHECKIN_CODE });
    assert.equal(right.status, 200);
    assert.equal((await right.json()).success, true);
});

test('no event answer outside the admin area contains a check-in code', async () => {
    const admin = await loginAs('admin');
    assert.equal((await admin.send('POST', `/api/admin/events/${SERIES_EVENT_IDS[0]}/generate-checkin`)).status, 200);
    const member = await loginAs('member');
    const { seriesId } = await (await member.request(`/api/events/${SERIES_EVENT_IDS[0]}`)).json();

    const answers = {
        list: '/api/events',
        series: `/api/events/series/${seriesId}`,
        single: `/api/events/${EVENT_ID.RUNNING}`,
        registrations: '/api/user/registrations',
        profile: '/api/user/profile'
    };
    for (const [name, url] of Object.entries(answers)) {
        const res = await member.request(url);
        assert.equal(res.status, 200, name);
        const body = await res.text();
        assert.match(body, new RegExp(`"id":"(${EVENT_ID.RUNNING}|${SERIES_EVENT_IDS[0]})"`), `${name} lists an event with a code`);
        assert.doesNotMatch(body, /checkinCode/, name);
    }
});

test('a guest sees only status and id of the registration that invited them', async () => {
    const newbie = await loginAs('newbie');
    const res = await newbie.request(`/api/events/${EVENT_ID.BIG_FORM}/my-registration`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { registered: true, asGuest: true, id: 'dev-reg-bigform-chiara', status: 'pending' });
});

test('the overview gets only events that are not over, each with the own status', async () => {
    const upcomingFor = async (personaId) => {
        const res = await (await loginAs(personaId)).request('/api/events?upcoming=1&limit=100');
        assert.equal(res.status, 200);
        return (await res.json()).data;
    };
    const statusById = (events) => Object.fromEntries(events.map(event => [event.id, event.myStatus]));

    const raiderEvents = await upcomingFor('raider');
    const raider = statusById(raiderEvents);
    assert.ok(!(EVENT_ID.PAST in raider), 'the past event is left out');
    assert.equal(raider[EVENT_ID.RUNNING], 'accepted', 'the running event stays');
    assert.equal(raider[EVENT_ID.OPEN], 'accepted');
    assert.equal(raider[EVENT_ID.ROLE], null);
    assert.equal(raider[SERIES_EVENT_IDS[0]], 'accepted', 'a series carries the status of its next date');
    const series = raiderEvents.find(event => event.id === SERIES_EVENT_IDS[0]);
    assert.deepEqual(series.seriesDates.map(date => date.id), SERIES_EVENT_IDS);

    const member = statusById(await upcomingFor('member'));
    assert.equal(member[EVENT_ID.FULL], 'waitlisted');
    assert.equal(member[EVENT_ID.FORM], 'pending');
    assert.equal(member[EVENT_ID.OPEN], null);

    assert.equal(statusById(await upcomingFor('newbie'))[EVENT_ID.BIG_FORM], 'guest');

    // Without the parameter the list stays as before, past events included
    const { data: all } = await (await (await loginAs('member')).request('/api/events?limit=500')).json();
    assert.ok(all.some(event => event.id === EVENT_ID.ENDED));
    assert.ok(all.every(event => !('checkinCode' in event)));
});

test('list and event page tell the places of an event with the same sentence', async () => {
    const member = await loginAs('member');
    const { data } = await (await member.request('/api/events?upcoming=1&limit=100')).json();
    const expected = {
        // Jonas brought a guest, Aylin's invitation is still open: both reserve a place
        [EVENT_ID.OPEN]: { taken: 6, capacity: 20, guests: 2, pending: 0, waitlist: 0, text: '6 von 20 Plätzen belegt (inkl. 2 Gäste)', waitlistText: '' },
        [EVENT_ID.FORM]: { taken: 3, capacity: 16, guests: 0, pending: 2, waitlist: 0, text: '3 von 16 Plätzen belegt (2 Anfragen offen)', waitlistText: '' },
        [EVENT_ID.FULL]: { taken: 5, capacity: 5, guests: 0, pending: 0, waitlist: 3, text: '5 von 5 Plätzen belegt', waitlistText: '3 auf der Warteliste' },
        [EVENT_ID.BIG_FORM]: { taken: 2, capacity: 0, guests: 1, pending: 1, waitlist: 0, text: '2 Plätze belegt (inkl. 1 Gast, 1 Anfrage offen)', waitlistText: '' }
    };
    for (const [id, places] of Object.entries(expected)) {
        const listed = data.find(event => event.id === id);
        assert.deepEqual(listed.places, places, `list: ${id}`);
        assert.equal(listed.currentParticipants, places.taken, `list count: ${id}`);

        const single = await (await member.request(`/api/events/${id}`)).json();
        assert.deepEqual(single.places, places, `event page: ${id}`);
        assert.equal(single.currentParticipants, places.taken, `event page count: ${id}`);
        assert.equal(single.waitlistCount, places.waitlist, `waitlist: ${id}`);
    }
});

test('the admin list tells the places of every event like the event page', async () => {
    const admin = await loginAs('admin');
    const events = await (await admin.request('/api/admin/all-events')).json();
    assert.ok(events.length >= 10);
    for (const event of events) {
        assert.equal(typeof event.places.text, 'string', event.title);
        assert.equal(typeof event.places.waitlistText, 'string', event.title);
        for (const key of ['taken', 'capacity', 'guests', 'pending', 'waitlist']) {
            assert.equal(typeof event.places[key], 'number', `${event.title}: ${key}`);
        }
    }
    for (const id of [EVENT_ID.OPEN, EVENT_ID.FORM, EVENT_ID.FULL, EVENT_ID.BIG_FORM]) {
        const single = await (await admin.request(`/api/events/${id}`)).json();
        assert.deepEqual(events.find(event => event.id === id).places, single.places, id);
    }
    // Members never see the archive; the admin list counts it all the same
    assert.equal(events.find(event => event.id === EVENT_ID.ARCHIVED).places.text, '3 von 50 Plätzen belegt');
});

test('the event API answers only logged-in users', async () => {
    const admin = await loginAs('admin');
    const { seriesId } = await (await admin.request(`/api/events/${SERIES_EVENT_IDS[0]}`)).json();
    const anonymous = createClient(server.baseUrl);

    for (const url of ['/api/events', `/api/events/series/${seriesId}`, `/api/events/${EVENT_ID.OPEN}`]) {
        const res = await anonymous.request(url);
        assert.equal(res.status, 401, url);
    }
});

test('the category list of all events is gone', async () => {
    // It also showed the categories of drafts and archived events to members
    const res = await (await loginAs('member')).request('/api/events/categories');
    assert.equal(res.status, 404);
});

test('draft and archived events exist only for admins', async () => {
    const admin = await loginAs('admin');
    const member = await loginAs('member');
    const draftId = SERIES_EVENT_IDS[2];
    assert.equal((await admin.send('PUT', `/api/admin/events/${draftId}/status`, { status: 'draft' })).status, 200);
    try {
        for (const id of [draftId, EVENT_ID.ARCHIVED]) {
            const res = await member.request(`/api/events/${id}`);
            assert.equal(res.status, 404, id);
            assert.equal((await res.json()).error, 'Event nicht gefunden');
            assert.equal((await member.request(`/api/events/${id}/comments`)).status, 404, `${id}/comments`);
            assert.equal((await admin.request(`/api/events/${id}`)).status, 200, `${id} as admin`);
        }

        const { seriesId } = await (await admin.request(`/api/events/${draftId}`)).json();
        const seriesEventIds = async (client) => (await (await client.request(`/api/events/series/${seriesId}`)).json()).map(event => event.id);
        assert.ok(!(await seriesEventIds(member)).includes(draftId));
        assert.ok((await seriesEventIds(admin)).includes(draftId));
    } finally {
        await admin.send('PUT', `/api/admin/events/${draftId}/status`, { status: 'active' });
    }
});

test('wrong check-in codes are limited per member', async () => {
    const raider = await loginAs('raider');
    const tryCode = (client) => client.send('POST', `/api/events/${EVENT_ID.RUNNING}/checkin`, { code: '000000' });
    for (let attempt = 1; attempt <= 10; attempt++) {
        assert.equal((await tryCode(raider)).status, 400, `attempt ${attempt}`);
    }
    const blocked = await tryCode(raider);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error, 'Zu viele Check-in-Versuche. Bitte warte ein paar Minuten.');

    // Counted per member, not for everyone behind the same address
    assert.equal((await tryCode(await loginAs('member'))).status, 400);
});

test('a generated check-in code has six digits', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.FULL}/generate-checkin`);
    assert.match((await res.json()).code, /^[1-9]\d{5}$/);
});

test('the CSV export defuses formulas in cells', async () => {
    const raider = await loginAs('raider');
    const formAnswers = { 'Ingame-Name': '=HYPERLINK("http://evil.example","Klick")', 'Bevorzugte Rolle': 'Tank', 'Regeln gelesen': true };
    const registration = await raider.send('POST', `/api/events/${EVENT_ID.FORM}/register`, { formAnswers });
    assert.equal(registration.status, 200, await registration.clone().text());

    const admin = await loginAs('admin');
    const csv = await (await admin.request(`/api/admin/events/${EVENT_ID.FORM}/registrations/export`)).text();
    assert.ok(csv.includes('"\'=HYPERLINK(""http://evil.example"",""Klick"")"'), csv);
    assert.doesNotMatch(csv, /(^|,)"?=/m);
});

test('events with an unsafe banner URL or colour are refused', async () => {
    const admin = await loginAs('admin');
    const create = (fields) => admin.send('POST', '/api/admin/events', { title: 'Härtungstest', status: 'draft', ...fields });

    for (const [fields, message] of [
        [{ bannerUrl: 'javascript:alert(1)' }, 'Banner muss eine http(s)-URL oder ein hochgeladenes Bild sein.'],
        [{ accentColor: 'red;background:url(https://evil.example)' }, 'Akzentfarbe muss ein Hex-Farbwert wie #8b5cf6 sein.']
    ]) {
        const res = await create(fields);
        assert.equal(res.status, 400, JSON.stringify(fields));
        assert.equal((await res.json()).error, message);
    }
    assert.equal((await create({ bannerUrl: 'https://example.com/banner.png', accentColor: '#8b5cf6' })).status, 200);
    assert.equal((await create({ bannerUrl: '', accentColor: '' })).status, 200);
});

test('an event takes an uploaded banner path, but no made-up or foreign path', async () => {
    const admin = await loginAs('admin');
    const { bannerUrl } = await (await uploadBanner(admin, PNG_BYTES)).json();
    const created = await admin.send('POST', '/api/admin/events', { title: 'Upload-Banner', status: 'draft', bannerUrl });
    assert.equal(created.status, 200);
    const { id } = await created.json();
    const stored = await (await admin.request(`/api/admin/all-events`)).json();
    assert.equal(stored.find(event => event.id === id).bannerUrl, bannerUrl);

    for (const value of ['/uploads/banners/0f8fad5b-d9cb-469f-a165-70867728950e.png', '/api/admin/reset', 'javascript:alert(1)', 'banner.png']) {
        const res = await admin.send('PUT', `/api/admin/events/${id}`, { title: 'Upload-Banner', status: 'draft', bannerUrl: value });
        assert.equal(res.status, 400, value);
        assert.equal((await res.json()).error, 'Banner muss eine http(s)-URL oder ein hochgeladenes Bild sein.');
    }
    const after = await (await admin.request(`/api/admin/all-events`)).json();
    assert.equal(after.find(event => event.id === id).bannerUrl, bannerUrl, 'refused edits change nothing');
});

test('an active event needs a start date, a draft does not', async () => {
    const admin = await loginAs('admin');
    const active = await admin.send('POST', '/api/admin/events', { title: 'Ohne Datum', status: 'active' });
    assert.equal(active.status, 400);
    assert.equal((await active.json()).error, 'Aktive Events brauchen ein Startdatum.');
    // Without a status the event becomes active, so it needs a date as well
    assert.equal((await admin.send('POST', '/api/admin/events', { title: 'Ohne Status' })).status, 400);

    const draft = await admin.send('POST', '/api/admin/events', { title: 'Entwurf ohne Datum', status: 'draft' });
    assert.equal(draft.status, 200);
    const { id } = await draft.json();

    const edited = await admin.send('PUT', `/api/admin/events/${id}`, { title: 'Entwurf ohne Datum', status: 'active' });
    assert.equal(edited.status, 400);
    assert.equal((await edited.json()).error, 'Aktive Events brauchen ein Startdatum.');

    const published = await admin.send('PUT', `/api/admin/events/${id}/status`, { status: 'active' });
    assert.equal(published.status, 400);
    assert.equal((await published.json()).error, 'Aktive Events brauchen ein Startdatum.');

    const dated = await admin.send('PUT', `/api/admin/events/${id}`, { title: 'Entwurf ohne Datum', status: 'draft', startDate: '2026-12-01T18:00:00.000Z' });
    assert.equal(dated.status, 200);
    assert.equal((await admin.send('PUT', `/api/admin/events/${id}/status`, { status: 'active' })).status, 200);
});

test('the wizard preview builds the Discord announcement of an unsaved event and stores nothing', async () => {
    const admin = await loginAs('admin');
    const countEvents = async () => (await (await admin.request('/api/admin/all-events')).json()).length;
    const before = await countEvents();
    const res = await admin.send('POST', '/api/admin/events/preview', {
        title: 'Vorschau-Raid', description: 'Bringt Tränke mit.', status: 'active', startDate: '2026-12-01T18:00:00.000Z',
        accessMode: 'open', slots: [{ name: 'Tank', emoji: '🛡️', capacity: 2 }, { name: 'Heiler', emoji: '💚', capacity: 3 }]
    });
    assert.equal(res.status, 200);
    const preview = await res.json();
    assert.equal(preview.embed.title, '🎉 Vorschau-Raid');
    assert.equal(preview.embed.description, 'Bringt Tränke mit.');
    assert.match(preview.embed.fields[0].name, /Datum$/);
    assert.match(preview.embed.fields[1].name, /Plätze$/);
    assert.equal(preview.embed.fields[1].value, '0 von 5 Plätzen belegt');
    assert.deepEqual(preview.components.flatMap(row => row.components).map(button => button.label), ['Tank', 'Heiler', 'Zum Event']);
    assert.equal(preview.places.text, '0 von 5 Plätzen belegt');
    assert.deepEqual(preview.bot, { name: 'DEMS Bot (Mock)', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png' });
    assert.equal(await countEvents(), before);
});

test('a half-done draft can be previewed; members and requests without a token cannot', async () => {
    const admin = await loginAs('admin');
    const draft = await admin.send('POST', '/api/admin/events/preview', { bannerUrl: 'https://' });
    assert.equal(draft.status, 200);
    const body = await draft.json();
    assert.equal(body.embed.image, undefined);
    assert.equal(body.places.text, '0 Plätze belegt');

    const member = await loginAs('member');
    assert.equal((await member.send('POST', '/api/admin/events/preview', { title: 'x' })).status, 403);
    const noToken = await admin.request('/api/admin/events/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' })
    });
    assert.equal(noToken.status, 403);
});

test('a description longer than Discord allows is cut in the announcement instead of breaking it', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/events/preview', { title: 'Lange Beschreibung', status: 'draft', description: `${'x'.repeat(4094)}🎉${'y'.repeat(400)}` });
    assert.equal(res.status, 200);
    const { embed } = await res.json();
    // 4096 characters at most; a cut emoji leaves no half character behind
    assert.ok(embed.description.length <= 4096, String(embed.description.length));
    assert.ok(embed.description.endsWith('…'));
    assert.doesNotMatch(embed.description, /[\uD800-\uDBFF]…$/);
});

test('the preview of a saved event counts its registrations, also after a slot was removed', async () => {
    const admin = await loginAs('admin');
    const full = await (await admin.request(`/api/events/${EVENT_ID.FULL}`)).json();
    const res = await admin.send('POST', '/api/admin/events/preview', { ...full, id: EVENT_ID.FULL });
    assert.equal(res.status, 200);
    const preview = await res.json();
    assert.equal(preview.places.taken, 5);
    assert.match(preview.places.text, /^5 von 5 Plätzen belegt/);

    const raid = await (await admin.request(`/api/events/${EVENT_ID.ROLE}`)).json();
    const fewer = await admin.send('POST', '/api/admin/events/preview', { ...raid, id: EVENT_ID.ROLE, slots: raid.slots.slice(1) });
    assert.equal(fewer.status, 200);
    assert.ok((await fewer.json()).places.taken >= 1);
});

test('the scheduler archives an event a day after its end and logs it', async () => {
    await server.waitForOutput('Archived 1 ended event(s)');
    const admin = await loginAs('admin');
    const status = Object.fromEntries((await (await admin.request('/api/admin/all-events')).json()).map(event => [event.id, event.status]));
    assert.deepEqual([status[EVENT_ID.PAST], status[EVENT_ID.ENDED]], ['archived', 'active']);
    const { data: logs } = await (await admin.request('/api/admin/audit-log?limit=100')).json();
    assert.ok(logs.some(log => log.action === 'AUTO_ARCHIVE_EVENT' && log.adminId === 'system' && log.targetId === EVENT_ID.PAST));
    assert.equal((await (await loginAs('member')).request(`/api/events/${EVENT_ID.PAST}`)).status, 404);
});

test('an ended event takes no registration', async () => {
    const member = await loginAs('member');
    const res = await member.send('POST', `/api/events/${EVENT_ID.ENDED}/register`, {});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Das Event ist schon vorbei.');
});

test('the running events of the bot control center leave ended events out', async () => {
    await server.waitForOutput('Archived 1 ended event(s)');
    const admin = await loginAs('admin');
    const ids = (await (await admin.request('/api/admin/bot/running-events')).json()).map(event => event.id);
    assert.ok(ids.includes(EVENT_ID.RUNNING));
    assert.ok(!ids.includes(EVENT_ID.PAST) && !ids.includes(EVENT_ID.ENDED));
});

test('an event cannot end before it starts', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Rückwärts', status: 'draft', startDate: '2026-12-01T18:00:00.000Z', endDate: '2026-12-01T17:00:00.000Z'
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Das Ende liegt vor dem Start.');
});

test('the rate limiters do not get in the way during development', async () => {
    const client = createClient(server.baseUrl);
    for (let i = 0; i < 40; i++) {
        assert.equal((await client.request('/auth/me')).status, 200, `request ${i + 1}`);
    }
});

test('members are locked out while login is disabled, admins are not', async () => {
    const admin = await loginAs('admin');
    const enable = await admin.send('PUT', '/api/admin/maintenance', { loginDisabled: true });
    assert.equal(enable.status, 200);

    try {
        const member = createClient(server.baseUrl);
        const res = await member.request('/auth/dev-login/member');
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), '/?error=maintenance_login_disabled');
        assert.equal(await currentUser(member), null);
        await loginAs('admin');
    } finally {
        await admin.send('PUT', '/api/admin/maintenance', { loginDisabled: false });
    }
});

test('members are locked out in panic mode, admins are not', async () => {
    const admin = await loginAs('admin');
    const activate = await admin.send('POST', '/api/admin/maintenance/panic');
    assert.equal(activate.status, 200);

    try {
        const member = createClient(server.baseUrl);
        const res = await member.request('/auth/dev-login/member');
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), '/?error=panic_mode');
        assert.equal(await currentUser(member), null);
        await loginAs('admin');
    } finally {
        const deactivate = await admin.send('POST', '/api/admin/maintenance/panic/deactivate', { password: 'dev' });
        assert.equal(deactivate.status, 200);
    }
});

// ── Role slots ──────────────────────────────────────────────────────────

const RAID_SLOTS = [
    { name: 'Tank', emoji: '🛡️', capacity: 1 },
    { name: 'Heiler', emoji: '💚', capacity: 1 }
];

/** Create an active instant-approval event with role slots; returns the API response. */
async function createSlotEvent(admin, title, slots, fields = {}) {
    const res = await admin.send('POST', '/api/admin/events', {
        title, status: 'active', accessMode: 'open', approvalMode: 'instant', startDate: '2026-12-01T18:00:00.000Z', slots, ...fields
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
}

test('a comment shows the avatar of its author', async () => {
    const member = await loginAs('member');
    const { avatar } = await currentUser(member);

    const res = await member.send('POST', `/api/events/${EVENT_ID.OPEN}/comments`, { text: 'Avatar-Test' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).userAvatar, avatar);

    const comments = await (await member.request(`/api/events/${EVENT_ID.OPEN}/comments`)).json();
    assert.equal(comments.find(comment => comment.text === 'Avatar-Test').userAvatar, avatar);
});

test('deleting an event deletes its Discord channels', async () => {
    const admin = await loginAs('admin');
    const created = await createSlotEvent(admin, 'Channel-Löschtest', [], { autoCreateChannels: true, channelConfig: { type: 'both' } });
    await server.waitForOutput('Event-Channels für "Channel-Löschtest" erstellt');

    assert.equal((await admin.send('DELETE', `/api/admin/events/${created.id}`)).status, 200);
    await server.waitForOutput('Event-Channels für "Channel-Löschtest" gelöscht');
});

test('deleting a series deletes the Discord channels of its events', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Serien-Löschtest', status: 'draft', accessMode: 'open', approvalMode: 'instant',
        autoCreateChannels: true, channelConfig: { type: 'voice' },
        recurring: true, recurringInterval: 'weekly', startDate: '2026-11-02T18:00:00.000Z', recurringUntil: '2026-11-10'
    });
    const { events } = await res.json();
    assert.equal(events.length, 2);
    // Channels appear when an instance becomes active
    assert.equal((await admin.send('PUT', `/api/admin/events/${events[0].id}/status`, { status: 'active' })).status, 200);
    await server.waitForOutput('Event-Channels für "Serien-Löschtest" erstellt');

    assert.equal((await admin.send('DELETE', `/api/admin/events/series/${events[0].seriesId}`)).status, 200);
    await server.waitForOutput('Event-Channels für "Serien-Löschtest" gelöscht');
});

test('a duplicated event gets its reminders and start notification again', async () => {
    const admin = await loginAs('admin');
    // Seed: the past event already sent its 24 h reminder and its start notification
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.PAST}/duplicate`);
    assert.equal(res.status, 200);
    const copy = await res.json();
    assert.deepEqual(copy.reminderHours, [{ hours: 24, sent: false }]);
    assert.equal(copy.eventStartNotificationSent, false);
});

test('saving an event keeps sent reminders sent until the start moves', async () => {
    const admin = await loginAs('admin');
    const storedReminders = async () => (await (await admin.request('/api/admin/all-events')).json())
        .find(event => event.id === EVENT_ID.PAST).reminderHours;
    const event = await (await admin.request(`/api/events/${EVENT_ID.PAST}`)).json();

    // The event form sends the reminder as a plain number
    assert.equal((await admin.send('PUT', `/api/admin/events/${EVENT_ID.PAST}`, { ...event, reminderHours: 24 })).status, 200);
    assert.deepEqual(await storedReminders(), [{ hours: 24, sent: true }]);

    // The end moves along: an end before the start is refused
    const week = 7 * 24 * 60 * 60 * 1000;
    const movedStart = new Date(new Date(event.startDate).getTime() + week).toISOString();
    const movedEnd = event.endDate ? new Date(new Date(event.endDate).getTime() + week).toISOString() : '';
    assert.equal((await admin.send('PUT', `/api/admin/events/${EVENT_ID.PAST}`, { ...event, startDate: movedStart, endDate: movedEnd, reminderHours: 24 })).status, 200);
    assert.deepEqual(await storedReminders(), [{ hours: 24, sent: false }]);
});

test('the event form saves several reminders and an empty field removes them', async () => {
    const admin = await loginAs('admin');
    const storedReminders = async () => (await (await admin.request('/api/admin/all-events')).json())
        .find(event => event.id === EVENT_ID.FULL).reminderHours;
    const event = await (await admin.request(`/api/events/${EVENT_ID.FULL}`)).json();

    assert.equal((await admin.send('PUT', `/api/admin/events/${EVENT_ID.FULL}`, { ...event, reminderHours: '24, 1' })).status, 200);
    assert.deepEqual(await storedReminders(), [{ hours: 24, sent: false }, { hours: 1, sent: false }]);

    assert.equal((await admin.send('PUT', `/api/admin/events/${EVENT_ID.FULL}`, { ...event, reminderHours: '' })).status, 200);
    assert.deepEqual(await storedReminders(), []);
});

test('admins create events with role slots', async () => {
    const admin = await loginAs('admin');
    const created = await createSlotEvent(admin, 'Slot-Anlage', [
        { name: 'Tank', emoji: '🛡️', capacity: 2 },
        { name: 'Heiler', emoji: '💚', capacity: 3 }
    ], { maxParticipants: 99, allowGuests: true });

    assert.equal(created.maxParticipants, 5);
    assert.equal(created.allowGuests, false);
    assert.deepEqual(created.slots.map(slot => slot.name), ['Tank', 'Heiler']);
    assert.ok(created.slots.every(slot => /^[0-9a-f]{8}$/.test(slot.id)));

    const detail = await (await admin.request(`/api/events/${created.id}`)).json();
    assert.deepEqual(detail.slots, created.slots);
});

test('invalid slots are rejected with a German message', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Kaputte Slots', status: 'active', startDate: '2026-12-01T18:00:00.000Z', slots: [{ name: 'Tank', emoji: ':shield:', capacity: 1 }]
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Das Emoji von Slot „Tank“ muss ein einzelnes Emoji sein.');
});

test('slots cannot be switched on while people are registered', async () => {
    const admin = await loginAs('admin');
    const event = await (await admin.request(`/api/events/${EVENT_ID.OPEN}`)).json();
    const res = await admin.send('PUT', `/api/admin/events/${EVENT_ID.OPEN}`, { ...event, slots: [{ name: 'Tank', capacity: 2 }] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Slots können nur aktiviert werden, solange es keine Anmeldungen gibt.');
});

test('duplicating keeps the slots but not the announcements', async () => {
    const admin = await loginAs('admin');
    const created = await createSlotEvent(admin, 'Slot-Kopie', RAID_SLOTS);
    assert.equal((await admin.send('POST', `/api/admin/events/${created.id}/announce`, {})).status, 200);

    const copy = await (await admin.send('POST', `/api/admin/events/${created.id}/duplicate`)).json();
    assert.deepEqual(copy.slots, created.slots);
    assert.deepEqual(copy.announcements, []);
});

test('a full main role falls back to the alternative, then to the waitlist', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Ausweich', RAID_SLOTS);
    const [tank, heal] = event.slots;
    const raider = await loginAs('raider');
    const member = await loginAs('member');
    const newbie = await loginAs('newbie');

    const first = await (await raider.send('POST', `/api/events/${event.id}/register`, { slotId: tank.id })).json();
    assert.deepEqual([first.status, first.slotId, first.isAlt], ['accepted', tank.id, false]);

    const second = await (await member.send('POST', `/api/events/${event.id}/register`, { slotId: tank.id, altSlotIds: [heal.id] })).json();
    assert.deepEqual([second.slotId, second.isAlt], [heal.id, true]);
    assert.ok(second.message.includes('🛡️ Tank war voll'));

    const third = await (await newbie.send('POST', `/api/events/${event.id}/register`, { slotId: tank.id, altSlotIds: [heal.id] })).json();
    assert.equal(third.status, 'waitlisted');

    const detail = await (await raider.request(`/api/events/${event.id}`)).json();
    assert.deepEqual(detail.slotSummary.map(slot => slot.taken), [1, 1]);

    assert.equal((await member.send('DELETE', `/api/events/${event.id}/register`)).status, 200);
    const promoted = await (await newbie.request(`/api/events/${event.id}/my-registration`)).json();
    assert.deepEqual([promoted.status, promoted.slotId], ['accepted', heal.id]);
});

test('registering for a slot event needs a valid slot', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Pflichtslot', RAID_SLOTS);
    const member = await loginAs('member');
    const res = await member.send('POST', `/api/events/${event.id}/register`, {});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Bitte wähle einen gültigen Slot.');
});

test('members switch into free slots only and the line-up follows', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Wechsel', [
        { name: 'Alpha', capacity: 1 }, { name: 'Beta', capacity: 1 }, { name: 'Gamma', capacity: 1 }
    ]);
    const [alpha, beta, gamma] = event.slots;
    const raider = await loginAs('raider');
    const member = await loginAs('member');
    await raider.send('POST', `/api/events/${event.id}/register`, { slotId: alpha.id });
    await member.send('POST', `/api/events/${event.id}/register`, { slotId: beta.id });

    const full = await raider.send('PUT', `/api/events/${event.id}/register/slot`, { slotId: beta.id });
    assert.equal(full.status, 409);
    assert.equal((await full.json()).error, 'Dieser Slot ist bereits voll.');

    const moved = await raider.send('PUT', `/api/events/${event.id}/register/slot`, { slotId: gamma.id });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).slotId, gamma.id);

    const participants = await (await raider.request(`/api/events/${event.id}/participants`)).json();
    assert.deepEqual(participants.slots.map(slot => slot.taken), [0, 1, 1]);
    assert.equal(participants.slots[2].members[0].displayName, personaById('raider').displayName);
    assert.deepEqual(participants.waitlist, []);
});

test('a slot that still has registrations cannot be removed', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Umbau', RAID_SLOTS);
    const raider = await loginAs('raider');
    await raider.send('POST', `/api/events/${event.id}/register`, { slotId: event.slots[0].id });

    const removed = await admin.send('PUT', `/api/admin/events/${event.id}`, { ...event, slots: event.slots.slice(1) });
    assert.equal(removed.status, 400);
    assert.equal((await removed.json()).error, 'Slot „Tank“ hat noch 1 Anmeldung – bitte zuerst verschieben.');

    const grown = await admin.send('PUT', `/api/admin/events/${event.id}`, {
        ...event, slots: event.slots.map(slot => ({ ...slot, capacity: 3 }))
    });
    assert.equal(grown.status, 200);
    assert.equal((await grown.json()).maxParticipants, 6);
});

test('a new registration refreshes the live announcement', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Live-Embed-Test', RAID_SLOTS);
    assert.equal((await admin.send('POST', `/api/admin/events/${event.id}/announce`, {})).status, 200);

    const raider = await loginAs('raider');
    await raider.send('POST', `/api/events/${event.id}/register`, { slotId: event.slots[0].id });
    await server.waitForOutput('Ankündigung von "Live-Embed-Test" aktualisiert', 6000);
});

/** Registration of a persona in the admin list of an event. */
async function adminRegistrationOf(admin, eventId, personaId) {
    const result = await (await admin.request(`/api/admin/events/${eventId}/registrations`)).json();
    return { registration: result.data.find(entry => entry.userId === personaById(personaId).userId), slots: result.slots };
}

test('admins move a registration into a full slot with a warning', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Verschieben', RAID_SLOTS);
    const [tank, heal] = event.slots;
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });
    await (await loginAs('member')).send('POST', `/api/events/${event.id}/register`, { slotId: heal.id });

    const { registration, slots } = await adminRegistrationOf(admin, event.id, 'member');
    assert.deepEqual(slots, event.slots);
    const res = await admin.send('PUT', `/api/admin/registrations/${registration.id}/slot`, { slotId: tank.id });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).warning, 'Slot „Tank“ ist jetzt überbucht.');

    const detail = await (await admin.request(`/api/events/${event.id}`)).json();
    assert.deepEqual(detail.slotSummary.map(slot => slot.taken), [2, 0]);
});

test('accepting a waitlisted registration gives it a slot', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Annehmen', RAID_SLOTS);
    const [tank] = event.slots;
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });
    await (await loginAs('member')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });

    const { registration } = await adminRegistrationOf(admin, event.id, 'member');
    assert.equal(registration.status, 'waitlisted');
    const res = await admin.send('PUT', `/api/admin/registrations/${registration.id}/status`, { status: 'accepted' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.slotId, tank.id);
    assert.equal(body.warning, 'Slot „Tank“ ist jetzt überbucht.');
});

test('the export lists slot and wish of every registration', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Export', RAID_SLOTS);
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: event.slots[0].id });

    const csv = await (await admin.request(`/api/admin/events/${event.id}/registrations/export`)).text();
    // Every cell is quoted, headers included (form field labels are admin input)
    assert.ok(csv.split('\n')[0].includes('"Slot","Wunschrolle"'));
    assert.ok(csv.includes('"🛡️ Tank","🛡️ Tank"'));
});

test('re-accepting a rejected registration does not silently overbook its old slot', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Wiederaufnahme', [{ name: 'Tank', emoji: '🛡️', capacity: 1 }]);
    const [tank] = event.slots;
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });
    const { registration } = await adminRegistrationOf(admin, event.id, 'raider');

    assert.equal((await admin.send('PUT', `/api/admin/registrations/${registration.id}/status`, { status: 'rejected' })).status, 200);
    await (await loginAs('member')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });

    const res = await admin.send('PUT', `/api/admin/registrations/${registration.id}/status`, { status: 'accepted' });
    const body = await res.json();
    assert.equal(body.slotId, tank.id);
    assert.equal(body.warning, 'Slot „Tank“ ist jetzt überbucht.');
});

// ── Date polls ──────────────────────────────────────────────────────────

/** ISO date `days` from now at `hour` UTC. */
function futureDate(days, hour = 18) {
    const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
}

/** Create a date poll with two dates; returns the API response. */
async function createPollViaApi(admin, title, fields = {}) {
    const res = await admin.send('POST', '/api/admin/polls', {
        title, description: 'Wann passt es euch?',
        options: [{ startDate: futureDate(8) }, { startDate: futureDate(9) }],
        ...fields
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
}

test('admins create date polls', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Neue Abstimmung');
    assert.equal(poll.status, 'open');
    assert.equal(poll.options.length, 2);
    assert.ok(poll.options.every(option => /^[0-9a-f]{8}$/.test(option.id)));
    assert.equal(poll.createdBy, personaById('admin').userId);
});

test('admins choose their own answers for a poll', async () => {
    const admin = await loginAs('admin');
    const labels = { yes: 'Bin dabei', maybe: 'Vielleicht', no: 'Kann nicht' };
    const poll = await createPollViaApi(admin, 'Antwort-Abstimmung', { labels });
    assert.deepEqual(poll.labels, labels);

    const raider = await loginAs('raider');
    assert.deepEqual((await (await raider.request(`/api/polls/${poll.id}`)).json()).labels, labels);
    const entry = (await (await raider.request('/api/polls')).json()).find(item => item.id === poll.id);
    assert.deepEqual(entry.labels, labels);

    const renamed = await admin.send('PUT', `/api/admin/polls/${poll.id}`, {
        title: poll.title, options: poll.options, labels: { ...labels, no: 'Bin raus' }
    });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).labels.no, 'Bin raus');
});

test('invalid date polls are refused with a German message', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/polls', { title: 'Zu wenig', options: [{ startDate: futureDate(8) }] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Eine Abstimmung braucht 2–10 Termine.');
});

test('posting a poll to Discord is logged', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Poster-Abstimmung');
    const res = await admin.send('POST', `/api/admin/polls/${poll.id}/announce`, { text: 'Stimmt ab, Leute!' });
    assert.equal(res.status, 200);
    await server.waitForOutput('Stimmt ab, Leute!');
});

test('a poll can only be turned into an event once', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Event-Abstimmung');
    const [first] = poll.options;
    const body = { title: 'Aus der Abstimmung', status: 'active', startDate: first.startDate, fromPoll: { pollId: poll.id, optionId: first.id } };

    const created = await admin.send('POST', '/api/admin/events', body);
    assert.equal(created.status, 200);
    assert.equal((await created.json()).sourcePollId, poll.id);

    const again = await admin.send('POST', '/api/admin/events', body);
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, 'Diese Abstimmung ist bereits entschieden.');

    const other = await createPollViaApi(admin, 'Falscher Termin');
    const wrong = await admin.send('POST', '/api/admin/events', { ...body, fromPoll: { pollId: other.id, optionId: 'nope' } });
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error, 'Termin nicht gefunden');
});

test('a poll can only become an active event', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Entwurf-Abstimmung');
    const [first] = poll.options;

    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Entwurf aus Abstimmung', status: 'draft', startDate: first.startDate,
        fromPoll: { pollId: poll.id, optionId: first.id }
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Ein Event aus einer Abstimmung muss aktiv sein.');
    assert.equal((await (await admin.request(`/api/polls/${poll.id}`)).json()).status, 'open');
    const events = await (await admin.request('/api/admin/all-events')).json();
    assert.equal(events.some(event => event.title === 'Entwurf aus Abstimmung'), false);
});

test('admins close and delete polls', async () => {

    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Weg damit');
    assert.equal((await admin.send('POST', `/api/admin/polls/${poll.id}/close`)).status, 200);
    assert.equal((await admin.send('DELETE', `/api/admin/polls/${poll.id}`)).status, 200);
    assert.equal((await admin.send('DELETE', `/api/admin/polls/${poll.id}`)).status, 404);
});

test('members vote on the web and see the tally', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Web-Abstimmung');
    const [first, second] = poll.options;
    const raider = await loginAs('raider');
    const member = await loginAs('member');

    const res = await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [first.id], maybe: [second.id] });
    assert.equal(res.status, 200);
    const voted = await res.json();
    assert.deepEqual(voted.myVote, { yes: [first.id], maybe: [second.id] });
    assert.deepEqual(voted.tally.options.map(o => [o.yes, o.maybe]), [[1, 0], [0, 1]]);
    assert.equal(voted.tally.options[0].yesVoters[0].displayName, personaById('raider').displayName);
    assert.equal(voted.favoriteOptionId, first.id);
    assert.equal(voted.announcements, undefined);

    const memberList = await (await member.request('/api/polls')).json();
    const entry = memberList.find(item => item.id === poll.id);
    assert.deepEqual([entry.myVoteStatus, entry.canVote, entry.voterCount, entry.status], ['open', true, 1, 'open']);
    const raiderList = await (await raider.request('/api/polls')).json();
    assert.equal(raiderList.find(item => item.id === poll.id).myVoteStatus, 'voted');
});

test('fast per-date clicks on the web keep every change', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Klick-Abstimmung');
    const [first, second] = poll.options;
    const raider = await loginAs('raider');
    const url = `/api/polls/${poll.id}/vote`;

    const responses = await Promise.all([
        raider.send('PUT', url, { optionId: first.id, state: 'yes' }),
        raider.send('PUT', url, { optionId: second.id, state: 'maybe' })
    ]);
    assert.deepEqual(responses.map(res => res.status), [200, 200]);
    const stored = await (await raider.request(`/api/polls/${poll.id}`)).json();
    assert.deepEqual(stored.myVote, { yes: [first.id], maybe: [second.id] });

    const invalid = await raider.send('PUT', url, { optionId: first.id, state: 'egal' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'Ungültige Auswahl');
});

test('role-restricted polls refuse other members', async () => {

    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Raid-Abstimmung', { accessMode: 'role-required', requiredRoles: [ROLE_ID.RAID_TEAM] });
    const member = await loginAs('member');
    const refused = await member.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).error, 'Du hast nicht die erforderliche Rolle für diese Abstimmung.');
    assert.equal((await (await member.request(`/api/polls/${poll.id}`)).json()).canVote, false);

    const raider = await loginAs('raider');
    assert.equal((await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] })).status, 200);
});

test('closed polls refuse votes', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Geschlossene Abstimmung');
    await admin.send('POST', `/api/admin/polls/${poll.id}/close`);
    const raider = await loginAs('raider');
    const res = await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Die Abstimmung ist beendet.');
    assert.equal((await raider.request('/api/polls/does-not-exist')).status, 404);
});

test('a date with votes cannot be removed', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Bearbeiten-Abstimmung');
    const raider = await loginAs('raider');
    await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });

    const res = await admin.send('PUT', `/api/admin/polls/${poll.id}`, {
        title: poll.title, options: [poll.options[1], { startDate: futureDate(10) }]
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /hat bereits Stimmen/);
});

test('a vote refreshes the posted poll message', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Live-Abstimmung');
    await admin.send('POST', `/api/admin/polls/${poll.id}/announce`, {});
    const raider = await loginAs('raider');
    await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    await server.waitForOutput('Abstimmung "Live-Abstimmung" aktualisiert', 6000);
});

test('deciding a poll tells the voters by DM', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'DM-Abstimmung');
    const raider = await loginAs('raider');
    await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });

    const res = await admin.send('POST', '/api/admin/events', {
        title: 'DM-Event', status: 'active', startDate: poll.options[0].startDate,
        fromPoll: { pollId: poll.id, optionId: poll.options[0].id }
    });
    const event = await res.json();
    await server.waitForOutput('Der Termin für **DM-Abstimmung** steht');

    const decided = await (await raider.request(`/api/polls/${poll.id}`)).json();
    assert.deepEqual([decided.status, decided.eventId, decided.winnerOptionId], ['decided', event.id, poll.options[0].id]);
});

test('deleting an account removes the own poll votes', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Konto-Abstimmung');
    const newbie = await loginAs('newbie');
    await newbie.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    assert.equal((await (await admin.request(`/api/polls/${poll.id}`)).json()).tally.voterCount, 1);

    assert.equal((await newbie.send('DELETE', '/api/user/account')).status, 200);
    assert.equal((await (await admin.request(`/api/polls/${poll.id}`)).json()).tally.voterCount, 0);
});

// Keep this test last -> it deletes the newbie persona's account
test('deleting an account lets the waitlist move up', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Konto', [{ name: 'Tank', emoji: '🛡️', capacity: 1 }]);
    const slotId = event.slots[0].id;
    const newbie = await loginAs('newbie');
    const member = await loginAs('member');
    await newbie.send('POST', `/api/events/${event.id}/register`, { slotId });
    await member.send('POST', `/api/events/${event.id}/register`, { slotId });

    assert.equal((await newbie.send('DELETE', '/api/user/account')).status, 200);
    const promoted = await (await member.request(`/api/events/${event.id}/my-registration`)).json();
    assert.deepEqual([promoted.status, promoted.slotId], ['accepted', slotId]);
});

// ── Registration and unregister deadlines (W-03) ────────────────────────

test('admins set, change and clear both deadlines', async () => {
    const admin = await loginAs('admin');
    const base = { title: 'Mit Fristen', status: 'active', startDate: futureDate(5), endDate: futureDate(5, 21) };
    const created = await admin.send('POST', '/api/admin/events', {
        ...base, registrationDeadline: futureDate(4), unregisterDeadline: futureDate(3)
    });
    assert.equal(created.status, 200);
    const { id } = await created.json();
    const read = async () => (await admin.request(`/api/events/${id}`)).json();
    let event = await read();
    assert.equal(event.registrationDeadline, futureDate(4));
    assert.equal(event.unregisterDeadline, futureDate(3));

    const changed = await admin.send('PUT', `/api/admin/events/${id}`, { ...base, registrationDeadline: futureDate(2), unregisterDeadline: '' });
    assert.equal(changed.status, 200);
    event = await read();
    assert.equal(event.registrationDeadline, futureDate(2));
    assert.equal(event.unregisterDeadline, '');

    // Fields left out of an edit are cleared like every other whitelisted field
    await admin.send('PUT', `/api/admin/events/${id}`, base);
    assert.equal((await read()).registrationDeadline, '');
});

test('a deadline must be a date before the end of the event', async () => {
    const admin = await loginAs('admin');
    const base = { title: 'Falsche Frist', status: 'draft', startDate: futureDate(5), endDate: futureDate(5, 21) };
    const late = await admin.send('POST', '/api/admin/events', { ...base, unregisterDeadline: futureDate(6) });
    assert.equal(late.status, 400);
    assert.equal((await late.json()).error, 'Der Abmeldeschluss liegt nach dem Ende des Events.');

    const broken = await admin.send('POST', '/api/admin/events', { ...base, registrationDeadline: 'morgen' });
    assert.equal(broken.status, 400);
    assert.equal((await broken.json()).error, 'Der Anmeldeschluss ist kein gültiges Datum.');

    // Without an end date the event lasts two hours
    const noEnd = await admin.send('POST', '/api/admin/events', { title: 'Ohne Ende', status: 'draft', startDate: futureDate(5), registrationDeadline: futureDate(5, 21) });
    assert.equal(noEnd.status, 400);
    assert.equal((await noEnd.json()).error, 'Der Anmeldeschluss liegt nach dem Ende des Events.');
});

test('every date of a series keeps the distance between deadline and start', async () => {
    const admin = await loginAs('admin');
    const start = futureDate(3, 20);
    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Wöchentliche Frist', status: 'draft', startDate: start,
        registrationDeadline: futureDate(2, 20), unregisterDeadline: '',
        recurring: true, recurringInterval: 'weekly', recurringUntil: futureDate(17).substring(0, 10)
    });
    assert.equal(res.status, 200);
    const { events } = await res.json();
    assert.ok(events.length >= 2);
    for (const instance of events) {
        assert.equal(new Date(instance.startDate) - new Date(instance.registrationDeadline), 24 * 60 * 60 * 1000, instance.startDate);
        assert.equal(instance.unregisterDeadline, '');
    }
});

test('a new event starts with an announcement that was not refreshed for its deadline', async () => {
    const admin = await loginAs('admin');
    const base = { title: 'Frist neu', status: 'draft', startDate: futureDate(5), registrationDeadline: futureDate(4) };
    const { id } = await (await admin.send('POST', '/api/admin/events', base)).json();
    assert.equal((await (await admin.request(`/api/events/${id}`)).json()).registrationClosedRefreshed, false);
});

test('members can neither register after the deadline nor unregister after theirs', async () => {
    const admin = await loginAs('admin');
    const passed = new Date(Date.now() - 60 * 1000).toISOString();
    const closed = await (await admin.send('POST', '/api/admin/events', {
        title: 'Anmeldung zu', status: 'active', approvalMode: 'instant', startDate: futureDate(5)
    })).json();
    // The API refuses a deadline in the past only after the end; set it directly like a deadline that passed
    await admin.send('PUT', `/api/admin/events/${closed.id}`, {
        title: 'Anmeldung zu', status: 'active', approvalMode: 'instant', startDate: futureDate(5), registrationDeadline: passed
    });
    const member = await loginAs('member');
    const refused = await member.send('POST', `/api/events/${closed.id}/register`, { formAnswers: {} });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error, 'Die Anmeldung für dieses Event ist geschlossen.');

    const fixed = await (await admin.send('POST', '/api/admin/events', {
        title: 'Abmeldung zu', status: 'active', approvalMode: 'instant', startDate: futureDate(5)
    })).json();
    const raider = await loginAs('raider');
    assert.equal((await raider.send('POST', `/api/events/${fixed.id}/register`, { formAnswers: {} })).status, 200);
    await admin.send('PUT', `/api/admin/events/${fixed.id}`, {
        title: 'Abmeldung zu', status: 'active', approvalMode: 'instant', startDate: futureDate(5), unregisterDeadline: passed
    });
    const stay = await raider.send('DELETE', `/api/events/${fixed.id}/register`);
    assert.equal(stay.status, 400);
    assert.equal((await stay.json()).error, 'Abmelden ist nicht mehr möglich. Wende dich an einen Admin.');
    assert.equal((await (await raider.request(`/api/events/${fixed.id}/my-registration`)).json()).registered, true);
});

// ── Admin check-in (W-07) ───────────────────────────────────────────────

const setCheckin = (admin, registrationId, checkedIn) =>
    admin.send('PUT', `/api/admin/registrations/${registrationId}/checkin`, { checkedIn });

async function storedRegistration(admin, eventId, registrationId) {
    const result = await (await admin.request(`/api/admin/events/${eventId}/registrations`)).json();
    return result.data.find(entry => entry.id === registrationId);
}

test('admins check an accepted registration in and out without a code', async () => {
    const admin = await loginAs('admin');
    const id = 'dev-reg-running-jonas';

    const first = await setCheckin(admin, id, true);
    assert.equal(first.status, 200, await first.clone().text());
    const body = await first.json();
    assert.equal(body.checkedIn, true);
    assert.ok(body.checkedInAt);
    assert.equal((await storedRegistration(admin, EVENT_ID.RUNNING, id)).checkedIn, true);

    // A repeat keeps the state and the time
    const again = await (await setCheckin(admin, id, true)).json();
    assert.deepEqual([again.checkedIn, again.checkedInAt], [true, body.checkedInAt]);

    const back = await setCheckin(admin, id, false);
    assert.equal(back.status, 200);
    const stored = await storedRegistration(admin, EVENT_ID.RUNNING, id);
    assert.deepEqual([stored.checkedIn, stored.checkedInAt], [false, null]);

    const { data: logs } = await (await admin.request('/api/admin/audit-log?limit=100')).json();
    const adminId = personaById('admin').userId;
    for (const action of ['CHECKIN_REGISTRATION', 'UNDO_CHECKIN_REGISTRATION']) {
        assert.ok(logs.some(log => log.action === action && log.adminId === adminId && log.targetId === id), action);
    }
});

test('admins can check in to an archived event', async () => {
    const admin = await loginAs('admin');
    const res = await setCheckin(admin, 'dev-reg-archived-kira', true);
    assert.equal(res.status, 200);
    assert.equal((await storedRegistration(admin, EVENT_ID.ARCHIVED, 'dev-reg-archived-kira')).checkedIn, true);
});

test('the admin check-in refuses open requests, unknown ids and missing values', async () => {
    const admin = await loginAs('admin');

    const pending = await setCheckin(admin, 'dev-reg-form-tom', true);
    assert.equal(pending.status, 400);
    assert.equal((await pending.json()).error, 'Nur angenommene Anmeldungen können eingecheckt werden.');
    assert.notEqual((await storedRegistration(admin, EVENT_ID.FORM, 'dev-reg-form-tom')).checkedIn, true);

    const unknown = await setCheckin(admin, 'dev-reg-does-not-exist', true);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, 'Anmeldung nicht gefunden');

    for (const value of [undefined, 'true', 1]) {
        const res = await admin.send('PUT', '/api/admin/registrations/dev-reg-running-jonas/checkin', value === undefined ? {} : { checkedIn: value });
        assert.equal(res.status, 400, String(value));
        assert.equal((await res.json()).error, 'Bitte gib an, ob eingecheckt werden soll.');
    }
});

test('members cannot use the admin check-in', async () => {
    const member = await loginAs('member');
    assert.equal((await setCheckin(member, 'dev-reg-running-jonas', true)).status, 403);
    const admin = await loginAs('admin');
    assert.notEqual((await storedRegistration(admin, EVENT_ID.RUNNING, 'dev-reg-running-jonas')).checkedIn, true);
});

test('an admin check-in counts like a code check-in and can be redone with the code', async () => {
    const admin = await loginAs('admin');
    const member = await loginAs('member');
    const checkins = async () => (await (await member.request('/api/user/profile')).json()).stats.checkedIn;

    const before = await checkins();
    assert.equal((await setCheckin(admin, 'dev-reg-archived-tom', true)).status, 200);
    assert.equal(await checkins(), before + 1);
    assert.equal((await setCheckin(admin, 'dev-reg-archived-tom', false)).status, 200);
    assert.equal(await checkins(), before);

    assert.equal((await setCheckin(admin, 'dev-reg-running-tom', true)).status, 200);
    const mine = await (await member.request(`/api/events/${EVENT_ID.RUNNING}/my-registration`)).json();
    assert.equal(mine.checkedIn, true);

    assert.equal((await setCheckin(admin, 'dev-reg-running-tom', false)).status, 200);
    const code = await member.send('POST', `/api/events/${EVENT_ID.RUNNING}/checkin`, { code: CHECKIN_CODE });
    assert.equal(code.status, 200);
    assert.equal((await code.json()).alreadyCheckedIn, undefined);
});

test('leaving the accepted status clears the check-in', async () => {
    const admin = await loginAs('admin');
    for (const [id, eventId, status] of [['dev-reg-series1-lena', SERIES_EVENT_IDS[0], 'waitlisted'], ['dev-reg-series1-ben', SERIES_EVENT_IDS[0], 'rejected']]) {
        assert.equal((await setCheckin(admin, id, true)).status, 200);
        assert.equal((await admin.send('PUT', `/api/admin/registrations/${id}/status`, { status })).status, 200);
        const stored = await storedRegistration(admin, eventId, id);
        assert.deepEqual([stored.status, stored.checkedIn, stored.checkedInAt], [status, false, null], status);
    }
});

test('the export says who is checked in', async () => {
    const admin = await loginAs('admin');
    assert.equal((await setCheckin(admin, 'dev-reg-archived-lena', true)).status, 200);
    assert.equal((await setCheckin(admin, 'dev-reg-archived-tom', false)).status, 200);
    const lines = (await (await admin.request(`/api/admin/events/${EVENT_ID.ARCHIVED}/registrations/export`)).text()).split('\n');
    assert.ok(lines[0].includes('"Status","Eingecheckt","Quelle"'), lines[0]);
    const rowOf = async (id) => {
        const { userName } = await storedRegistration(admin, EVENT_ID.ARCHIVED, id);
        return lines.find(line => line.replace('﻿', '').startsWith(`"${userName}",`));
    };
    assert.match(await rowOf('dev-reg-archived-lena'), /,"accepted","Ja",/);
    assert.match(await rowOf('dev-reg-archived-tom'), /,"accepted","Nein",/);
});

// ── Admin adds members (W-06) ───────────────────────────────────────────

const MEMBER_ID = { KIRA: '200000000000000011', DENNIS: '200000000000000016', ELIF: '200000000000000017', GRETA: '200000000000000019' };
const memberSearch = async (client, eventId, q) => client.request(`/api/admin/events/${eventId}/member-search?q=${encodeURIComponent(q)}`);
const addMember = (admin, eventId, body) => admin.send('POST', `/api/admin/events/${eventId}/registrations`, body);
const dmCount = (name) => server.output().split(`DM an ${name}`).length - 1;

async function createEventAs(admin, fields) {
    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Nachtrag', status: 'active', accessMode: 'open', approvalMode: 'instant', startDate: futureDate(5), ...fields
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
}

test('admins search server members, also those who never logged in, and see who is on the list', async () => {
    const admin = await loginAs('admin');
    const fresh = await createEventAs(admin, { title: 'Suche' });

    const hits = await (await memberSearch(admin, fresh.id, 'gre')).json();
    assert.deepEqual(hits, [{ id: MEMBER_ID.GRETA, username: 'greta', displayName: 'Greta', avatar: '', alreadyRegistered: false }]);

    const running = await (await memberSearch(admin, EVENT_ID.RUNNING, 'jon')).json();
    assert.equal(running.find(hit => hit.username === 'jonas').alreadyRegistered, true);
    // Greta is Jonas' guest at the open event
    const guest = await (await memberSearch(admin, EVENT_ID.OPEN, 'gre')).json();
    assert.equal(guest[0].alreadyRegistered, true);

    assert.deepEqual(await (await memberSearch(admin, fresh.id, 'g')).json(), []);
    assert.equal((await memberSearch(await loginAs('member'), fresh.id, 'gre')).status, 403);
});

test('an admin entry is accepted at once, with source admin, a DM and an audit entry', async () => {
    const admin = await loginAs('admin');
    const event = await createEventAs(admin, { title: 'Freigabe nötig', approvalMode: 'manual' });
    const before = dmCount('Elif');

    const res = await addMember(admin, event.id, { userId: MEMBER_ID.ELIF });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.status, 'accepted');
    assert.equal(body.warning, undefined);
    const stored = await storedRegistration(admin, event.id, body.id);
    assert.deepEqual([stored.userId, stored.userName, stored.status, stored.source], [MEMBER_ID.ELIF, 'Elif', 'accepted', 'admin']);
    assert.deepEqual([stored.formAnswers, stored.guests], [{}, []]);
    assert.equal(dmCount('Elif'), before + 1);

    const { data: logs } = await (await admin.request('/api/admin/audit-log?limit=100')).json();
    assert.ok(logs.some(log => log.action === 'ADD_REGISTRATION' && log.adminId === personaById('admin').userId
        && log.targetId === event.id && log.details.includes('Elif')));

    const again = await addMember(admin, event.id, { userId: MEMBER_ID.ELIF });
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, 'Dieses Mitglied ist schon angemeldet.');
});

test('an admin entry overrides role, required fields, deadline, end and archive', async () => {
    const admin = await loginAs('admin');
    const fields = {
        title: 'Nur VIP', accessMode: 'role-required', requiredRoles: [ROLE_ID.VIP],
        formFields: [{ label: 'Ingame-Name', type: 'text', required: true }]
    };
    const event = await createEventAs(admin, fields);
    const deadline = await admin.send('PUT', `/api/admin/events/${event.id}`, {
        status: 'active', approvalMode: 'instant', startDate: futureDate(5), ...fields,
        registrationDeadline: new Date(Date.now() - 60 * 1000).toISOString()
    });
    assert.equal(deadline.status, 200, await deadline.clone().text());
    const closed = await addMember(admin, event.id, { userId: MEMBER_ID.DENNIS });
    assert.equal(closed.status, 201, await closed.clone().text());

    const archived = await addMember(admin, EVENT_ID.ARCHIVED, { userId: MEMBER_ID.DENNIS });
    assert.equal(archived.status, 201, await archived.clone().text());

    // After the end only the entry is written, no DM
    const before = dmCount('Greta');
    const ended = await addMember(admin, EVENT_ID.ENDED, { userId: MEMBER_ID.GRETA });
    assert.equal(ended.status, 201, await ended.clone().text());
    assert.equal(dmCount('Greta'), before);
});

test('drafts, cancelled events, unknown users and missing ids take no admin entry', async () => {
    const admin = await loginAs('admin');
    const draft = await createEventAs(admin, { title: 'Entwurf', status: 'draft' });
    for (const eventId of [draft.id, EVENT_ID.CANCELLED]) {
        const res = await addMember(admin, eventId, { userId: MEMBER_ID.DENNIS });
        assert.equal(res.status, 400, eventId);
        assert.equal((await res.json()).error, 'Für Entwürfe und abgesagte Events kann niemand eingetragen werden.');
    }
    const fresh = await createEventAs(admin, { title: 'Fremde' });
    const unknown = await addMember(admin, fresh.id, { userId: '1' });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, 'Mitglied nicht gefunden.');
    for (const body of [{}, { userId: '' }, { userId: 'abc' }]) {
        const res = await addMember(admin, fresh.id, body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal((await res.json()).error, 'Bitte wähle ein Mitglied aus.');
    }
    assert.equal((await addMember(await loginAs('member'), fresh.id, { userId: MEMBER_ID.DENNIS })).status, 403);
    const { data } = await (await admin.request(`/api/admin/events/${fresh.id}/registrations`)).json();
    assert.deepEqual(data, []);
});

test('a full event or slot is overbooked with a warning', async () => {
    const admin = await loginAs('admin');
    const full = await createEventAs(admin, { title: 'Ein Platz', maxParticipants: 1 });
    assert.equal((await (await loginAs('raider')).send('POST', `/api/events/${full.id}/register`, { formAnswers: {} })).status, 200);
    const over = await (await addMember(admin, full.id, { userId: MEMBER_ID.DENNIS })).json();
    assert.equal(over.status, 'accepted');
    assert.equal(over.warning, 'Das Event ist jetzt überbucht (2 von 1 Plätzen).');

    const raid = await createSlotEvent(admin, 'Raid-Nachtrag', RAID_SLOTS);
    const [tank] = raid.slots;
    await (await loginAs('raider')).send('POST', `/api/events/${raid.id}/register`, { slotId: tank.id });
    const noSlot = await addMember(admin, raid.id, { userId: MEMBER_ID.DENNIS });
    assert.equal(noSlot.status, 400);
    assert.equal((await noSlot.json()).error, 'Bitte wähle einen gültigen Slot.');
    const slotted = await (await addMember(admin, raid.id, { userId: MEMBER_ID.DENNIS, slotId: tank.id })).json();
    assert.deepEqual([slotted.status, slotted.slotId, slotted.warning], ['accepted', tank.id, 'Slot „Tank“ ist jetzt überbucht.']);
});

test('the registrations list tells the event status and the export names admin entries', async () => {
    const admin = await loginAs('admin');
    const event = await createEventAs(admin, { title: 'Quelle' });
    await addMember(admin, event.id, { userId: MEMBER_ID.GRETA });
    const list = await (await admin.request(`/api/admin/events/${event.id}/registrations`)).json();
    assert.equal(list.eventStatus, 'active');
    const csv = await (await admin.request(`/api/admin/events/${event.id}/registrations/export`)).text();
    assert.match(csv, /"Greta","200000000000000019","accepted","Nein","Admin"/);
});

// ── Waitlist position (W-05) ────────────────────────────────────────────

test('a waitlisted member learns their own place, everyone else none', async () => {
    // Seed: Elif, Greta and Tom wait for the full event, Tom registered last
    const member = await loginAs('member');
    const mine = await (await member.request(`/api/events/${EVENT_ID.FULL}/my-registration`)).json();
    assert.equal(mine.status, 'waitlisted');
    assert.deepEqual(mine.waitlistPosition, { position: 3, total: 3 });

    const accepted = await (await (await loginAs('raider')).request(`/api/events/${EVENT_ID.RUNNING}/my-registration`)).json();
    assert.equal(accepted.status, 'accepted');
    assert.equal('waitlistPosition' in accepted, false);

    const profile = await (await member.request('/api/user/profile')).json();
    const full = profile.upcoming.find(entry => entry.event.id === EVENT_ID.FULL);
    assert.deepEqual(full.waitlistPosition, { position: 3, total: 3 });
    assert.ok([...profile.upcoming, ...profile.history]
        .filter(entry => entry.event.id !== EVENT_ID.FULL)
        .every(entry => entry.waitlistPosition === null));
});

test('admins see the waitlist order, and it moves up when someone ahead is accepted', async () => {
    const admin = await loginAs('admin');
    const list = async () => (await (await admin.request(`/api/admin/events/${EVENT_ID.FULL}/registrations`)).json()).data;
    const waiting = (await list())
        .filter(entry => entry.status === 'waitlisted')
        .sort((a, b) => a.waitlistPosition.position - b.waitlistPosition.position);
    assert.deepEqual(waiting.map(entry => [entry.userName, entry.waitlistPosition.position, entry.waitlistPosition.total]),
        [['Elif', 1, 3], ['Greta', 2, 3], ['Tom', 3, 3]]);
    assert.ok((await list()).filter(entry => entry.status !== 'waitlisted').every(entry => !('waitlistPosition' in entry)));

    assert.equal((await admin.send('PUT', `/api/admin/registrations/${waiting[0].id}/status`, { status: 'accepted' })).status, 200);
    const mine = await (await (await loginAs('member')).request(`/api/events/${EVENT_ID.FULL}/my-registration`)).json();
    assert.deepEqual(mine.waitlistPosition, { position: 2, total: 2 });
});

// ── Change DMs (W-04) ───────────────────────────────────────────────────

const botDmsSent = async (admin) => (await (await admin.request('/api/admin/bot/status')).json()).dmsSent;
const changeNotices = async (admin, eventId) => {
    const { data: logs } = await (await admin.request('/api/admin/audit-log?limit=500')).json();
    return logs.filter(log => log.action === 'NOTIFY_EVENT_CHANGE' && log.targetId === eventId);
};

/**
 * Own event with one accepted (Dennis), one pending (Tom) and one waitlisted registration (Neo).
 *
 * @param {Object} admin -> Admin client.
 * @returns {Promise<Object>} -> `{ id, fields }`: event id and the fields a PUT must repeat.
 */
async function createChangeEvent(admin) {
    const fields = { title: 'Termin wackelt', status: 'active', accessMode: 'open', approvalMode: 'manual', maxParticipants: 2, startDate: futureDate(5) };
    const event = await createEventAs(admin, fields);
    assert.equal((await addMember(admin, event.id, { userId: MEMBER_ID.DENNIS })).status, 201);
    const pending = await (await (await loginAs('member')).send('POST', `/api/events/${event.id}/register`, {})).json();
    assert.equal(pending.status, 'pending', JSON.stringify(pending));
    const waiting = await (await (await loginAs('newbie')).send('POST', `/api/events/${event.id}/register`, {})).json();
    assert.equal(waiting.status, 'waitlisted', JSON.stringify(waiting));
    return { id: event.id, fields };
}

test('a flagged new start reaches only accepted members, is counted and logged', async () => {
    const admin = await loginAs('admin');
    const { id, fields } = await createChangeEvent(admin);
    const before = { dennis: dmCount('Dennis'), tom: dmCount('Tom'), neo: dmCount('Neo'), total: await botDmsSent(admin) };

    const res = await admin.send('PUT', `/api/admin/events/${id}`, { ...fields, startDate: futureDate(6), notifyParticipants: true });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.notifiedCount, 1);
    assert.equal(dmCount('Dennis'), before.dennis + 1);
    assert.equal(dmCount('Tom'), before.tom);
    assert.equal(dmCount('Neo'), before.neo);
    assert.equal(await botDmsSent(admin), before.total + 1);
    assert.match(server.output(), /Das Event \*\*Termin wackelt\*\* wurde geändert/);
    assert.match(server.output(), new RegExp(`Alle Infos: http://[^\\s"]+/#event/${id}`));

    const notices = await changeNotices(admin, id);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].adminId, personaById('admin').userId);
    assert.match(notices[0].details, /1 of 1 participants/);
    assert.match(notices[0].details, /Beginn/);
});

test('without the flag, with false or a string nothing is sent', async () => {
    const admin = await loginAs('admin');
    const { id, fields } = await createChangeEvent(admin);
    const before = dmCount('Dennis');

    const variants = [{}, { notifyParticipants: false }, { notifyParticipants: 'true' }];
    for (const [index, flag] of variants.entries()) {
        const res = await admin.send('PUT', `/api/admin/events/${id}`, { ...fields, startDate: futureDate(6 + index), ...flag });
        const body = await res.json();
        assert.equal(res.status, 200, JSON.stringify(body));
        assert.equal(body.notifiedCount, 0, JSON.stringify(flag));
    }
    assert.equal(dmCount('Dennis'), before);
    assert.equal((await changeNotices(admin, id)).length, 0);
});

test('a flagged edit of other fields or into a draft sends nothing, and the flag is never stored', async () => {
    const admin = await loginAs('admin');
    const { id, fields } = await createChangeEvent(admin);
    const before = dmCount('Dennis');

    const titleOnly = await admin.send('PUT', `/api/admin/events/${id}`, { ...fields, title: 'Neuer Titel', maxParticipants: 3, notifyParticipants: true });
    assert.equal((await titleOnly.json()).notifiedCount, 0);
    const draft = await admin.send('PUT', `/api/admin/events/${id}`, { ...fields, status: 'draft', startDate: futureDate(7), notifyParticipants: true });
    assert.equal((await draft.json()).notifiedCount, 0);
    assert.equal(dmCount('Dennis'), before);
    assert.equal((await changeNotices(admin, id)).length, 0);

    const stored = await (await admin.request(`/api/events/${id}?status=all`)).json();
    assert.equal('notifyParticipants' in stored, false);
});

test('a flagged change of an event without participants writes no audit entry', async () => {
    const admin = await loginAs('admin');
    const fields = { title: 'Noch leer', status: 'active', accessMode: 'open', approvalMode: 'instant', startDate: futureDate(5) };
    const event = await createEventAs(admin, fields);
    const res = await admin.send('PUT', `/api/admin/events/${event.id}`, { ...fields, startDate: futureDate(6), notifyParticipants: true });
    assert.equal((await res.json()).notifiedCount, 0);
    assert.equal((await changeNotices(admin, event.id)).length, 0);
});

test('a new location of the seeded open event reaches the accepted guest but not the open invitation', async () => {
    const admin = await loginAs('admin');
    const event = await (await admin.request(`/api/events/${EVENT_ID.OPEN}?status=all`)).json();
    const { data: registrations } = await (await admin.request(`/api/admin/events/${EVENT_ID.OPEN}/registrations`)).json();
    const expected = new Set(registrations.filter(entry => entry.status === 'accepted').flatMap(entry => [entry.userId, ...(entry.guests || [])]));
    assert.ok(expected.has(MEMBER_ID.GRETA));
    assert.equal(expected.has(MEMBER_ID.ELIF), false);
    // Kira switched change DMs off in the seed data (W-16)
    assert.ok(expected.delete(MEMBER_ID.KIRA));
    const before = { greta: dmCount('Greta'), elif: dmCount('Elif'), kira: dmCount('Kira') };

    const moved = await admin.send('PUT', `/api/admin/events/${EVENT_ID.OPEN}`, { ...event, location: { text: 'Garten', channelId: '', channelType: '' }, notifyParticipants: true });
    const body = await moved.json();
    assert.equal(moved.status, 200, JSON.stringify(body));
    assert.equal(body.notifiedCount, expected.size);
    assert.equal(dmCount('Greta'), before.greta + 1);
    assert.equal(dmCount('Elif'), before.elif);
    assert.equal(dmCount('Kira'), before.kira);
    assert.match(server.output(), /\*\*Ort:\*\* ~~Lobby~~ → \*\*Garten\*\*/);

    // Back to the seeded place, silently
    const restored = await admin.send('PUT', `/api/admin/events/${EVENT_ID.OPEN}`, event);
    assert.equal((await restored.json()).notifiedCount, 0);
});

// ── DM choices (W-16) ───────────────────────────────────────────────────

const ALL_DMS = { reminders: true, changes: true, waitlist: true };
const settingsOf = async (client) => (await client.request('/api/user/settings')).json();
const saveSettings = (client, body) => client.send('PUT', '/api/user/settings', body);

test('settings report every DM kind as on until the member chooses', async () => {
    const newbie = await loginAs('newbie');
    assert.deepEqual(await settingsOf(newbie), { acceptInvitations: true, notifications: ALL_DMS });
});

test('saving one DM kind keeps invitations and the other kinds', async () => {
    const newbie = await loginAs('newbie');
    const off = await saveSettings(newbie, { notifications: { waitlist: false } });
    assert.equal(off.status, 200);
    const expected = { acceptInvitations: true, notifications: { ...ALL_DMS, waitlist: false } };
    assert.deepEqual(await off.json(), expected);
    assert.deepEqual(await settingsOf(newbie), expected);

    // The first-login dialog sends only acceptInvitations
    await saveSettings(newbie, { acceptInvitations: false });
    assert.deepEqual(await settingsOf(newbie), { acceptInvitations: false, notifications: { ...ALL_DMS, waitlist: false } });

    // Saving a kind no longer turns invitations back on
    await saveSettings(newbie, { notifications: { changes: false } });
    assert.deepEqual(await settingsOf(newbie), { acceptInvitations: false, notifications: { reminders: true, changes: false, waitlist: false } });

    // Text values and unknown kinds change nothing
    const ignored = await saveSettings(newbie, { acceptInvitations: 'true', notifications: { changes: 'true', waitlist: 1, polls: false } });
    assert.equal(ignored.status, 200);
    assert.deepEqual(await settingsOf(newbie), { acceptInvitations: false, notifications: { reminders: true, changes: false, waitlist: false } });

    // Back to the defaults for the tests that follow
    await saveSettings(newbie, { acceptInvitations: true, notifications: ALL_DMS });
    assert.deepEqual(await settingsOf(newbie), { acceptInvitations: true, notifications: ALL_DMS });
});

test('saving DM choices needs the CSRF token', async () => {
    const newbie = await loginAs('newbie');
    const res = await newbie.request('/api/user/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notifications: { changes: false } })
    });
    assert.equal(res.status, 403);
    assert.equal((await settingsOf(newbie)).notifications.changes, true);
});

const RAIDER_ID = personaById('raider').userId;
const MEMBER_PERSONA_ID = personaById('member').userId;

test('a member with change DMs off gets neither the change DM nor the cancellation (W-16)', async () => {
    const admin = await loginAs('admin');
    const raider = await loginAs('raider');
    await saveSettings(raider, { notifications: { changes: false } });
    try {
        const fields = { title: 'Wackelkandidat', status: 'active', accessMode: 'open', approvalMode: 'instant', startDate: futureDate(5) };
        const event = await createEventAs(admin, fields);
        assert.equal((await addMember(admin, event.id, { userId: MEMBER_ID.DENNIS })).status, 201);
        assert.equal((await addMember(admin, event.id, { userId: RAIDER_ID })).status, 201);
        const before = { dennis: dmCount('Dennis'), lena: dmCount('Lena') };

        const moved = await admin.send('PUT', `/api/admin/events/${event.id}`, { ...fields, startDate: futureDate(6), notifyParticipants: true });
        assert.equal((await moved.json()).notifiedCount, 1);
        assert.deepEqual([dmCount('Dennis'), dmCount('Lena')], [before.dennis + 1, before.lena]);
        const [notice] = await changeNotices(admin, event.id);
        assert.match(notice.details, /^Notified 1 of 1 participants about changed Beginn; 1 opted out$/);

        const cancelled = await admin.send('PUT', `/api/admin/events/${event.id}/cancel`);
        assert.equal((await cancelled.json()).notifiedCount, 1);
        assert.deepEqual([dmCount('Dennis'), dmCount('Lena')], [before.dennis + 2, before.lena]);
        assert.equal((await (await admin.request(`/api/events/${event.id}?status=all`)).json()).status, 'cancelled');
        const { data: logs } = await (await admin.request('/api/admin/audit-log?limit=500')).json();
        assert.ok(logs.some(log => log.action === 'CANCEL_EVENT' && log.targetId === event.id && /notified 1 users; 1 opted out$/.test(log.details)));
    } finally {
        await saveSettings(raider, { notifications: ALL_DMS });
    }
});

test('waitlist DMs off: no DM for the waitlist, but the move-up DM still comes (W-16)', async () => {
    const admin = await loginAs('admin');
    const member = await loginAs('member');
    await saveSettings(member, { notifications: { waitlist: false } });
    try {
        const event = await createEventAs(admin, { title: 'Ein Platz', maxParticipants: 1 });
        const taken = await (await addMember(admin, event.id, { userId: MEMBER_ID.DENNIS })).json();
        const before = dmCount('Tom');

        const waiting = await (await member.send('POST', `/api/events/${event.id}/register`, {})).json();
        assert.equal(waiting.status, 'waitlisted', JSON.stringify(waiting));
        assert.equal(dmCount('Tom'), before);

        assert.equal((await admin.send('PUT', `/api/admin/registrations/${taken.id}/status`, { status: 'rejected' })).status, 200);
        const mine = await (await member.request(`/api/events/${event.id}/my-registration`)).json();
        assert.equal(mine.status, 'accepted');
        assert.equal(dmCount('Tom'), before + 1);
        assert.match(server.output().split(`DM an Tom (${MEMBER_PERSONA_ID})`).at(-1), /Ein Platz wurde frei/);
    } finally {
        await saveSettings(member, { notifications: ALL_DMS });
    }
});

test('status DMs still come with every DM kind switched off (W-16)', async () => {
    const admin = await loginAs('admin');
    const newbie = await loginAs('newbie');
    await saveSettings(newbie, { notifications: { reminders: false, changes: false, waitlist: false } });
    try {
        const event = await createEventAs(admin, { title: 'Mit Freigabe', approvalMode: 'manual' });
        const before = dmCount('Neo');
        const pending = await (await newbie.send('POST', `/api/events/${event.id}/register`, {})).json();
        assert.equal(pending.status, 'pending', JSON.stringify(pending));
        assert.equal(dmCount('Neo'), before + 1);

        assert.equal((await admin.send('PUT', `/api/admin/registrations/${pending.id}/status`, { status: 'accepted' })).status, 200);
        assert.equal(dmCount('Neo'), before + 2);
        assert.match(server.output().split('DM an Neo').at(-1), /du bist bei \*\*Mit Freigabe\*\* dabei/);
    } finally {
        await saveSettings(newbie, { notifications: ALL_DMS });
    }
});

// ── Member overview for admins (W-15) ─────────────────────────

const KIRA_ID = '200000000000000011';

test('the member list is for admins only', async () => {
    const visitor = createClient(server.baseUrl);
    assert.equal((await visitor.request('/api/admin/members')).status, 401);
    assert.equal((await visitor.request(`/api/admin/members/${KIRA_ID}`)).status, 401);
    const member = await loginAs('member');
    assert.equal((await member.request('/api/admin/members')).status, 403);
    assert.equal((await member.request(`/api/admin/members/${KIRA_ID}`)).status, 403);
});

test('admins get every stored member with numbers and last activity', async () => {
    const admin = await loginAs('admin');
    const res = await admin.request('/api/admin/members');
    assert.equal(res.status, 200);
    const text = await res.text();
    const { members } = JSON.parse(text);
    for (const id of [personaById('admin').userId, personaById('raider').userId, KIRA_ID]) {
        assert.ok(members.some(m => m.id === id), `missing ${id}`);
    }
    const kira = members.find(m => m.id === KIRA_ID);
    assert.equal(kira.displayName, 'Kira');
    assert.equal(kira.username, 'kira');
    assert.ok(kira.stats.registrations >= 2, 'Kira has seeded registrations');
    assert.deepEqual(Object.keys(kira.stats).sort(), ['attended', 'checkedIn', 'noShows', 'registrations']);
    assert.ok(kira.lastActiveAt, 'last activity is set');
    assert.ok(!text.includes(CHECKIN_CODE), 'no check-in code');
    assert.ok(!text.includes('notifications'), 'no DM choices in the list');
});

test('a member page shows account info and the full history without secrets', async () => {
    const admin = await loginAs('admin');
    const res = await admin.request(`/api/admin/members/${KIRA_ID}`);
    assert.equal(res.status, 200);
    const text = await res.text();
    const detail = JSON.parse(text);
    assert.equal(detail.member.id, KIRA_ID);
    assert.equal(detail.member.acceptInvitations, true);
    assert.deepEqual(detail.member.notifications, { reminders: true, changes: false, waitlist: true });
    assert.ok(detail.member.createdAt);
    assert.equal(detail.stats.registrations, detail.history.length);
    assert.ok(detail.history.some(row => row.source === 'discord'), 'Kira registered through Discord');
    for (const row of detail.history) {
        assert.equal(typeof row.noShow, 'boolean');
        assert.ok(['web', 'discord', 'admin'].includes(row.source));
    }
    for (const secret of [CHECKIN_CODE, '481516', 'formAnswers', 'KiraX', 'checkinCode']) {
        assert.ok(!text.includes(secret), `detail leaks ${secret}`);
    }
});

test('an unknown member is answered with 404', async () => {
    const admin = await loginAs('admin');
    const res = await admin.request('/api/admin/members/123');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Mitglied nicht gefunden.' });
});

// ── Evaluations for admins (W-14) ─────────────────────────────

test('the evaluations are for admins only', async () => {
    assert.equal((await createClient(server.baseUrl).request('/api/admin/insights')).status, 401);
    const member = await loginAs('member');
    assert.equal((await member.request('/api/admin/insights')).status, 403);
});

test('admins get the evaluations of 90 days by default and of every past event with range all', async () => {
    const admin = await loginAs('admin');
    const res = await admin.request('/api/admin/insights');
    assert.equal(res.status, 200);
    const recent = await res.json();
    assert.equal(recent.range, '90');
    assert.deepEqual(Object.keys(recent).sort(), ['categories', 'events', 'members', 'range', 'totals']);
    assert.equal(recent.totals.events, recent.events.length);

    const allRes = await admin.request('/api/admin/insights?range=all');
    const text = await allRes.text();
    const all = JSON.parse(text);
    assert.equal(all.range, 'all');
    assert.ok(all.events.some(row => row.title === 'Sommerfest'), 'the archived summer party is evaluated');
    assert.ok(all.totals.events >= recent.totals.events);
    assert.ok(all.categories.length >= 1);
    for (const secret of [CHECKIN_CODE, '481516', 'KiraX', 'formAnswers', 'checkinCode', 'notifications']) {
        assert.ok(!text.includes(secret), `evaluations leak ${secret}`);
    }
});

test('an unknown range is refused', async () => {
    const admin = await loginAs('admin');
    const res = await admin.request('/api/admin/insights?range=7');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Ungültiger Zeitraum.' });
});

// ── Message to all participants (W-09) ────────────────────────

test('the recipient counts are for admins and contain only numbers', async () => {
    const member = await loginAs('member');
    assert.equal((await member.request(`/api/admin/events/${EVENT_ID.OPEN}/message-recipients`)).status, 403);
    const admin = await loginAs('admin');
    const res = await admin.request(`/api/admin/events/${EVENT_ID.OPEN}/message-recipients`);
    assert.equal(res.status, 200);
    const counts = await res.json();
    assert.deepEqual(Object.keys(counts).sort(), ['accepted', 'all']);
    assert.ok(Number.isInteger(counts.accepted) && counts.accepted > 0);
    assert.ok(counts.all >= counts.accepted);
    assert.equal((await admin.request('/api/admin/events/gibt-es-nicht/message-recipients')).status, 404);
});

test('sending a message is refused without CSRF token, for members and for bad input', async () => {
    const url = `/api/admin/events/${EVENT_ID.OPEN}/message`;
    const member = await loginAs('member');
    assert.equal((await member.send('POST', url, { text: 'Hi', group: 'accepted' })).status, 403);
    const admin = await loginAs('admin');
    const noToken = await admin.request(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hi', group: 'accepted' })
    });
    assert.equal(noToken.status, 403);

    const badGroup = await admin.send('POST', url, { text: 'Hi', group: 'x' });
    assert.equal(badGroup.status, 400);
    assert.deepEqual(await badGroup.json(), { error: 'Ungültige Empfängerauswahl.' });
    const blank = await admin.send('POST', url, { text: '   ', group: 'accepted' });
    assert.equal(blank.status, 400);
    assert.deepEqual(await blank.json(), { error: 'Bitte gib eine Nachricht ein.' });
    const missing = await admin.send('POST', '/api/admin/events/gibt-es-nicht/message', { text: 'Hi', group: 'accepted' });
    assert.equal(missing.status, 404);
});

test('a message to an event without accepted participants is refused and not logged', async () => {
    const admin = await loginAs('admin');
    const before = (await (await admin.request('/api/admin/audit-log?limit=100')).json()).data
        .filter(entry => entry.action === 'MESSAGE_PARTICIPANTS').length;
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.DRAFT}/message`, { text: 'Niemand da?', group: 'accepted' });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Niemand in dieser Auswahl.' });
    const after = (await (await admin.request('/api/admin/audit-log?limit=100')).json()).data
        .filter(entry => entry.action === 'MESSAGE_PARTICIPANTS').length;
    assert.equal(after, before);
});

test('a message reaches every accepted participant, also with DM choices off, and is logged (W-09)', async () => {
    const admin = await loginAs('admin');
    const counts = await (await admin.request(`/api/admin/events/${EVENT_ID.OPEN}/message-recipients`)).json();
    const text = `Treffpunkt ist heute Tor 2 (${Date.now()}).`;
    const outputBefore = server.output().length;

    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.OPEN}/message`, { text, group: 'accepted' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { recipients: counts.accepted, delivered: counts.accepted });

    const log = server.output().slice(outputBefore);
    assert.equal(log.split('DM an ').length - 1, counts.accepted);
    assert.match(log, /DM an Kira/, 'Kira switched change DMs off and still gets the message');
    assert.ok(log.includes(text));
    assert.match(log, /Nachricht zum Event/);
    assert.match(log, /Mori \(Admin\)/);

    const { data: logs } = await (await admin.request('/api/admin/audit-log?limit=100')).json();
    const entry = logs.find(item => item.action === 'MESSAGE_PARTICIPANTS' && item.details.includes(text.slice(0, 20)));
    assert.ok(entry, 'audit entry written');
    assert.equal(entry.targetId, EVENT_ID.OPEN);
    assert.match(entry.details, new RegExp(`${counts.accepted}/${counts.accepted} zugestellt`));
});

// ── Banner upload (W-12) ────────────────────────────────────────────────

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const UPLOAD_TYPE_ERROR = 'Nur PNG-, JPEG-, WebP- oder GIF-Bilder sind erlaubt.';

const bannerFiles = () => (fs.existsSync(path.join(uploadDir, 'banners')) ? fs.readdirSync(path.join(uploadDir, 'banners')).sort() : []);

/** POST raw bytes to the banner upload with the CSRF token of the session. */
async function uploadBanner(client, body, contentType = 'image/png', { csrf = true } = {}) {
    const { token } = await (await client.request('/api/csrf-token')).json();
    const headers = { 'Content-Type': contentType };
    if (csrf) headers['X-CSRF-TOKEN'] = token;
    return client.request('/api/admin/uploads/banner', { method: 'POST', headers, body });
}

test('an admin uploads a PNG banner that everyone can fetch', async () => {
    const admin = await loginAs('admin');
    const res = await uploadBanner(admin, PNG_BYTES);
    assert.equal(res.status, 200);
    const { bannerUrl } = await res.json();
    assert.match(bannerUrl, /^\/uploads\/banners\/[0-9a-f-]{36}\.png$/);

    const image = await createClient(server.baseUrl).request(bannerUrl);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /^image\/png/);
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(image.headers.get('set-cookie'), null, 'fetching a banner creates no session');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG_BYTES);

    const { data: logs } = await (await admin.request('/api/admin/audit-log?limit=100')).json();
    assert.ok(logs.some(item => item.action === 'UPLOAD_BANNER' && item.details.includes(path.basename(bannerUrl))), 'audit entry');
});

test('the stored type follows the content, not the declared type', async () => {
    const admin = await loginAs('admin');
    const res = await uploadBanner(admin, JPEG_BYTES, 'image/png');
    assert.equal(res.status, 200);
    assert.match((await res.json()).bannerUrl, /\.jpg$/);
});

test('uploads that are no allowed image, too large or empty are refused and leave no file', async () => {
    const admin = await loginAs('admin');
    const before = bannerFiles();
    const cases = [
        [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/png', 400, UPLOAD_TYPE_ERROR],
        [Buffer.from('<!doctype html><p>hi</p>'), 'text/html', 400, UPLOAD_TYPE_ERROR],
        [Buffer.concat([PNG_BYTES, Buffer.alloc(5 * 1024 * 1024)]), 'image/png', 413, 'Das Bild darf höchstens 5 MB groß sein.'],
        [Buffer.alloc(0), 'image/png', 400, 'Keine Bilddatei empfangen.']
    ];
    for (const [body, type, status, error] of cases) {
        const res = await uploadBanner(admin, body, type);
        assert.equal(res.status, status, error);
        assert.deepEqual(await res.json(), { error });
    }
    assert.deepEqual(bannerFiles(), before);
});

test('only admins with a CSRF token can upload a banner', async () => {
    const before = bannerFiles();
    const member = await loginAs('member');
    assert.equal((await uploadBanner(member, PNG_BYTES)).status, 403);
    const admin = await loginAs('admin');
    const noToken = await uploadBanner(admin, PNG_BYTES, 'image/png', { csrf: false });
    assert.equal(noToken.status, 403);
    assert.match((await noToken.json()).error, /CSRF/);
    assert.deepEqual(bannerFiles(), before);
});

test('the banner folder serves nothing but uploaded banners', async () => {
    fs.mkdirSync(path.join(uploadDir, 'banners'), { recursive: true });
    fs.writeFileSync(path.join(uploadDir, 'banners', 'notes.txt'), 'secret');
    const client = createClient(server.baseUrl);
    for (const pathname of ['/uploads/banners/notes.txt', '/uploads/banners/', '/uploads/banners/..%2Fdems.sqlite',
        '/uploads/banners/x%2F..%2F..%2Fpackage.json', '/uploads/banners/0f8fad5b-d9cb-469f-a165-70867728950e.png']) {
        assert.equal((await client.request(pathname)).status, 404, pathname);
    }
});

// ── Banner clean-up (W-12) ──────────────────────────────────────────────

const bannerExists = (bannerUrl) => fs.existsSync(path.join(uploadDir, 'banners', path.basename(bannerUrl)));

async function eventWithUpload(admin, fields = {}) {
    const { bannerUrl } = await (await uploadBanner(admin, PNG_BYTES)).json();
    const res = await admin.send('POST', '/api/admin/events', { title: 'Aufräumtest', status: 'draft', bannerUrl, ...fields });
    assert.equal(res.status, 200);
    return { bannerUrl, body: await res.json() };
}

test('replacing or clearing an uploaded banner deletes the old file', async () => {
    const admin = await loginAs('admin');
    const { bannerUrl: first, body } = await eventWithUpload(admin);
    const { bannerUrl: second } = await (await uploadBanner(admin, PNG_BYTES)).json();

    const replaced = await admin.send('PUT', `/api/admin/events/${body.id}`, { title: 'Aufräumtest', status: 'draft', bannerUrl: second });
    assert.equal(replaced.status, 200);
    assert.equal(bannerExists(first), false, 'old banner deleted');
    assert.equal(bannerExists(second), true);

    const unchanged = await admin.send('PUT', `/api/admin/events/${body.id}`, { title: 'Aufräumtest 2', status: 'draft', bannerUrl: second });
    assert.equal(unchanged.status, 200);
    assert.equal(bannerExists(second), true, 'saving the same banner keeps it');

    const cleared = await admin.send('PUT', `/api/admin/events/${body.id}`, { title: 'Aufräumtest', status: 'draft', bannerUrl: '' });
    assert.equal(cleared.status, 200);
    assert.equal(bannerExists(second), false);
});

test('deleting an event deletes its banner unless a duplicate still uses it', async () => {
    const admin = await loginAs('admin');
    const { bannerUrl, body } = await eventWithUpload(admin);
    const copy = await (await admin.send('POST', `/api/admin/events/${body.id}/duplicate`)).json();
    assert.equal(copy.bannerUrl, bannerUrl);

    assert.equal((await admin.send('DELETE', `/api/admin/events/${body.id}`)).status, 200);
    assert.equal(bannerExists(bannerUrl), true, 'the copy still uses it');
    assert.equal((await admin.send('DELETE', `/api/admin/events/${copy.id}`)).status, 200);
    assert.equal(bannerExists(bannerUrl), false);
});

test('deleting a series deletes the banner its dates share', async () => {
    const admin = await loginAs('admin');
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const until = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { bannerUrl, body } = await eventWithUpload(admin, {
        status: 'active', startDate: start.toISOString(), recurring: true, recurringInterval: 'weekly', recurringUntil: until
    });
    assert.equal(body.count, 3);
    const seriesId = body.events[0].seriesId;
    assert.equal((await admin.send('DELETE', `/api/admin/events/series/${seriesId}`)).status, 200);
    assert.equal(bannerExists(bannerUrl), false);
});

test('an external banner URL never touches the banner folder', async () => {
    const admin = await loginAs('admin');
    const before = bannerFiles();
    const res = await admin.send('POST', '/api/admin/events', { title: 'Extern', status: 'draft', bannerUrl: 'https://example.com/a.png' });
    const { id } = await res.json();
    await admin.send('PUT', `/api/admin/events/${id}`, { title: 'Extern', status: 'draft', bannerUrl: '' });
    await admin.send('DELETE', `/api/admin/events/${id}`);
    assert.deepEqual(bannerFiles(), before);
});

test('the system reset of the events deletes their uploaded banners', async () => {
    // Own server: the reset wipes every event
    const tmpDir = createTempDir('reset-banners');
    const ownUploads = path.join(tmpDir, 'uploads');
    const own = await startServer('dev/start.js', { DEV_SQLITE_PATH: path.join(tmpDir, 'dev.sqlite'), DEV_UPLOAD_DIR: ownUploads });
    try {
        const admin = createClient(own.baseUrl);
        assert.equal((await admin.request('/auth/dev-login/admin')).status, 302);
        const { bannerUrl } = await (await uploadBanner(admin, PNG_BYTES)).json();
        assert.equal((await admin.send('POST', '/api/admin/events', { title: 'Reset', status: 'draft', bannerUrl })).status, 200);
        const file = path.join(ownUploads, 'banners', path.basename(bannerUrl));
        assert.equal(fs.existsSync(file), true);

        const res = await admin.send('DELETE', '/api/admin/reset', { password: 'dev', targets: ['events'] });
        assert.equal(res.status, 200);
        assert.equal(fs.existsSync(file), false);
    } finally {
        await own.stop();
    }
});

test('the startup sweep deletes old unused uploads and keeps young ones', async () => {
    const tmpDir = createTempDir('sweep-banners');
    const ownUploads = path.join(tmpDir, 'uploads');
    const dir = path.join(ownUploads, 'banners');
    fs.mkdirSync(dir, { recursive: true });
    const oldFile = path.join(dir, '0f8fad5b-d9cb-469f-a165-70867728950e.png');
    const youngFile = path.join(dir, '1f8fad5b-d9cb-469f-a165-70867728950e.png');
    fs.writeFileSync(oldFile, PNG_BYTES);
    fs.writeFileSync(youngFile, PNG_BYTES);
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, longAgo, longAgo);

    const own = await startServer('dev/start.js', { DEV_SQLITE_PATH: path.join(tmpDir, 'dev.sqlite'), DEV_UPLOAD_DIR: ownUploads });
    try {
        await own.waitForOutput('verwaiste Banner', 10000);
        assert.equal(fs.existsSync(oldFile), false);
        assert.equal(fs.existsSync(youngFile), true);
    } finally {
        await own.stop();
    }
});

test('the wizard preview shows an uploaded banner with its absolute address', async () => {
    const admin = await loginAs('admin');
    const { bannerUrl } = await (await uploadBanner(admin, PNG_BYTES)).json();
    const res = await admin.send('POST', '/api/admin/events/preview', { title: 'Vorschau', bannerUrl });
    assert.equal(res.status, 200);
    const { embed } = await res.json();
    assert.ok(embed.image.url.endsWith(bannerUrl), embed.image.url);
    assert.match(embed.image.url, /^http:\/\/localhost:\d+\/uploads\/banners\//);
});
