const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, frontendSources, isHidden, REPO_ROOT } = require('./helpers');

const NOW = new Date('2026-10-13T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const at = (hours) => new Date(NOW.getTime() + hours * HOUR).toISOString();
const EMOJI = /\p{Extended_Pictographic}/u;

const event = (fields = {}) => ({
    id: 'ev-1', title: 'Spieleabend', startDate: at(72), endDate: at(75), status: 'active', category: 'Gaming', location: '', checkinEnabled: false, ...fields
});
const entry = (fields = {}) => ({ id: 'r1', status: 'accepted', checkedIn: false, createdAt: at(-48), slot: null, event: event(), ...fields });

const BADGES = [
    { id: 'veteran', name: 'Veteran', description: '7/10 Events teilgenommen', icon: 'bi-trophy', color: '#a855f7', unlocked: false, progress: 0.7 },
    { id: 'newcomer', name: 'Newcomer', description: 'Erste Registrierung', icon: 'bi-flower1', color: '#22c55e', unlocked: true },
    { id: 'early-bird', name: 'Early Bird', description: 'Registriere dich früh', icon: 'bi-sunrise', color: '#eab308', unlocked: false },
    { id: 'regular', name: 'Regular', description: '7 Events teilgenommen', icon: 'bi-fire', color: '#f97316', unlocked: true, progress: 1 }
];

// The render functions are pure, so one load serves every markup test
const frontend = loadFrontendApp({});

test('an upcoming row links to the event and shows date tile, time line and status', async () => {
    const { app } = await frontend;
    const html = app.renderUpcomingRow(entry({ event: event({ location: 'Lobby' }) }), NOW, true);
    assert.match(html, /^<a class="glass-card profile-event" href="#event\/ev-1">/);
    assert.match(html, /<div class="date-tile">/);
    assert.match(html, /<h4 class="profile-event-title">Spieleabend<\/h4>/);
    assert.match(html, /<strong>in 3 Tagen<\/strong> · \d{2}:\d{2} · Lobby<\/p>/);
    assert.match(html, /chip-success"><i class="bi bi-check-circle-fill"><\/i>Angemeldet/);
    assert.match(html, /<i class="bi bi-chevron-right profile-event-action" aria-hidden="true"><\/i><\/a>$/);
    assert.doesNotMatch(html, /Einchecken|is-muted/);
});

test('the chip tells the status; a rejection is quieter and names no slot', async () => {
    const { app } = await frontend;
    const row = (fields) => app.renderUpcomingRow(entry(fields), NOW, true);
    assert.match(row({ status: 'pending' }), /chip-warning[^<]*<i[^>]*><\/i>Ausstehend/);
    assert.match(row({ status: 'waitlisted' }), /chip-info[^<]*<i[^>]*><\/i>Warteliste/);

    const rejected = row({ status: 'rejected', slot: { name: 'Tank', emoji: '', wish: true } });
    assert.match(rejected, /^<a class="glass-card profile-event is-muted"/);
    assert.match(rejected, /chip-danger[^<]*<i[^>]*><\/i>Abgelehnt/);
    assert.doesNotMatch(rejected, /Tank|Einchecken/);

    // Checked in replaces "Angemeldet"
    const checkedIn = row({ checkedIn: true, event: event({ checkinEnabled: true }) });
    assert.match(checkedIn, /chip-success[^<]*<i[^>]*><\/i>Eingecheckt/);
    assert.doesNotMatch(checkedIn, /Angemeldet|Einchecken/);
});

test('"Einchecken" shows only for an accepted registration that can still check in', async () => {
    const { app } = await frontend;
    const open = event({ checkinEnabled: true });
    const hasButton = (fields, canOpen = true) =>
        /<span class="btn btn-accent btn-sm profile-event-action"><i class="bi bi-qr-code-scan me-1"><\/i>Einchecken<\/span>/
            .test(app.renderUpcomingRow(entry(fields), NOW, canOpen));
    assert.equal(hasButton({ event: open }), true);
    assert.equal(hasButton({ event: event() }), false, 'check-in closed');
    assert.equal(hasButton({ event: open, checkedIn: true }), false, 'already checked in');
    for (const status of ['pending', 'waitlisted', 'rejected']) assert.equal(hasButton({ event: open, status }), false, status);
    assert.equal(hasButton({ event: open }, false), false, 'no link, no button');
    // The button stands where the arrow would be
    assert.doesNotMatch(app.renderUpcomingRow(entry({ event: open }), NOW, true), /bi-chevron-right/);
});

test('the slot follows the status chip, a wish is named as one', async () => {
    const { app } = await frontend;
    const row = (slot, fields = {}) => app.renderUpcomingRow(entry({ slot, ...fields }), NOW, true);
    assert.match(row({ name: 'Tank', emoji: '🛡️', wish: false }), /Angemeldet<\/span><span class="chip chip-sm">🛡️ Tank<\/span>/);
    assert.match(row({ name: 'Schaden', emoji: '', wish: false }), /<span class="chip chip-sm">Schaden<\/span>/);
    assert.match(row({ name: 'Heiler', emoji: '💚', wish: true }, { status: 'waitlisted' }), /<span class="chip chip-sm">Wunsch: 💚 Heiler<\/span>/);
    // No slot, a slot without a name or slot data of the wrong kind: no half chip
    for (const slot of [null, { name: '', emoji: '🛡️', wish: false }, 'tank']) {
        assert.doesNotMatch(row(slot), /<span class="chip chip-sm">/, JSON.stringify(slot));
    }
});

test('a row the user cannot open is no link and offers nothing to click', async () => {
    const { app } = await frontend;
    const html = app.renderUpcomingRow(entry({ event: event({ status: 'draft', checkinEnabled: true }) }), NOW, false);
    assert.match(html, /^<div class="glass-card profile-event">/);
    assert.match(html, /<\/div>$/);
    assert.doesNotMatch(html, /href=|bi-chevron-right|Einchecken/);
    assert.match(html, /Angemeldet/);
});

test('a history row shows the day of the event and one chip', async () => {
    const { app } = await frontend;
    const past = (fields = {}) => event({ startDate: '2026-10-06T12:00:00.000Z', endDate: '2026-10-06T15:00:00.000Z', ...fields });
    const row = (fields, canOpen = true) => app.renderHistoryRow(entry({ event: past(), ...fields }), canOpen);

    const attended = row({});
    assert.match(attended, /^<a class="profile-history-row" href="#event\/ev-1">/);
    assert.match(attended, /<span class="profile-history-date">06\. Okt\. 2026<\/span>/);
    assert.match(attended, /<span class="profile-history-title">Spieleabend<\/span>/);
    assert.match(attended, /<span class="chip chip-sm">Teilgenommen<\/span><\/a>$/);
    assert.doesNotMatch(attended, /bi-chevron-right|date-tile/);

    assert.match(row({ checkedIn: true }), /chip-success[^<]*<i[^>]*><\/i>Eingecheckt/);
    assert.match(row({ status: 'rejected' }), /<span class="chip chip-sm">Abgelehnt<\/span>/);
    assert.match(row({ status: 'waitlisted' }), /<span class="chip chip-sm">Warteliste<\/span>/);
    assert.match(row({ status: 'pending' }), /<span class="chip chip-sm">Nicht bestätigt<\/span>/);
    // A cancelled event says so, whatever the registration was
    const cancelled = row({ checkedIn: true, event: past({ status: 'cancelled' }) });
    assert.match(cancelled, /<span class="chip chip-sm">Abgesagt<\/span>/);
    assert.doesNotMatch(cancelled, /Eingecheckt|Teilgenommen/);
    // Archived for a member: listed, but no link
    assert.match(row({}, false), /^<div class="profile-history-row">/);
    assert.doesNotMatch(row({}, false), /href=/);
});

test('a deleted event keeps its row with the day of the registration and no link', async () => {
    const { app } = await frontend;
    const html = app.renderHistoryRow(entry({ event: null, createdAt: '2026-05-17T12:00:00.000Z' }), true);
    assert.match(html, /^<div class="profile-history-row">/);
    assert.match(html, /<span class="profile-history-date">17\. Mai 2026<\/span>/);
    assert.match(html, /Gelöschtes Event/);
    assert.match(html, /<span class="chip chip-sm">Teilgenommen<\/span>/);
    assert.doesNotMatch(html, /href=/);
});

test('the badge list puts reached badges first and shows progress for open ones', async () => {
    const { app } = await frontend;
    const rows = app.renderBadgeList(BADGES).split('<li ').slice(1);
    assert.deepEqual(rows.map(row => row.match(/badge-row-name">([^<]*)</)[1]), ['Newcomer', 'Regular', 'Veteran', 'Early Bird']);
    // Reached: coloured icon, no bar
    assert.match(rows[0], /^class="badge-row">/);
    assert.match(rows[0], /<span class="badge-row-icon" data-style-color="#22c55e"><i class="bi bi-flower1"><\/i><\/span>/);
    assert.match(rows[0], /<div class="badge-row-rule">Erste Registrierung<\/div>/);
    assert.doesNotMatch(rows[1], /<progress/);
    // Open: muted, a bar only with a progress value
    assert.match(rows[2], /^class="badge-row is-locked">/);
    assert.doesNotMatch(rows[2], /data-style-color/);
    assert.match(rows[2], /<progress class="capacity-meter" max="100" value="70" aria-label="Fortschritt: 7\/10 Events teilgenommen"><\/progress>/);
    assert.doesNotMatch(rows[3], /<progress/);
});

test('odd badge data is shown safely', async () => {
    const { app } = await frontend;
    assert.equal(app.renderBadgeList(undefined), '');
    const html = app.renderBadgeList([
        { name: '<b>Böse</b>', description: '"><script>', icon: 'bi-x" onclick="alert(1)', color: 'red', unlocked: true },
        { name: 'Zu viel', description: '', icon: 'bi-star-fill', unlocked: false, progress: 7 },
        { name: 'Negativ', description: '', icon: 'bi-star-fill', unlocked: false, progress: -1 },
        {}
    ]);
    assert.doesNotMatch(html, /<b>|<script|onclick|data-style-color|undefined/);
    assert.match(html, /<i class="bi bi-award"><\/i>/);
    assert.match(html, /value="100"/);
    assert.match(html, /value="0"/);
});

test('the profile card shows avatar, names and three numbers', async () => {
    const { app } = await frontend;
    const html = app.renderProfileCard({ displayName: 'Lena Raid', username: 'lena', avatar: '' }, { total: 8, accepted: 7, checkedIn: 2, pending: 1 });
    assert.match(html, /<span class="avatar avatar-lg avatar-initials" title="Lena Raid">LR<\/span>/);
    assert.match(html, /<div class="profile-name">Lena Raid<\/div>/);
    assert.match(html, /<div class="profile-handle">@lena<\/div>/);
    assert.deepEqual([...html.matchAll(/<dt>([^<]+)<\/dt><dd>([^<]+)<\/dd>/g)].map(match => [match[1], match[2]]),
        [['Anmeldungen', '8'], ['Teilnahmen', '7'], ['Check-ins', '2']]);
    assert.doesNotMatch(html, /Ausstehend|Discord ID/);

    const loading = app.renderProfileCard({ displayName: 'Tom', username: 'tom', avatar: 'https://cdn.example/a.png' }, null);
    assert.match(loading, /<img class="avatar avatar-lg" src="https:\/\/cdn\.example\/a\.png"/);
    // While loading or after an error the numbers are dashes
    assert.deepEqual([...loading.matchAll(/<dd>([^<]+)<\/dd>/g)].map(match => match[1]), ['–', '–', '–']);
});

test('texts from admins and Discord are escaped', async () => {
    const { app } = await frontend;
    const evil = '<img src=x onerror="alert(1)">';
    const upcoming = app.renderUpcomingRow(entry({
        slot: { name: evil, emoji: evil, wish: false },
        event: event({ id: 'a"b<c', title: evil, location: evil })
    }), NOW, true);
    assert.doesNotMatch(upcoming, /<img|href="#event\/a"/);
    assert.equal(upcoming.split('&lt;img src=x').length - 1, 4, 'title, place, slot emoji and slot name');

    const history = app.renderHistoryRow(entry({ event: event({ id: 'a"b<c', title: evil, startDate: at(-48) }) }), true);
    assert.doesNotMatch(history, /<img|href="#event\/a"/);

    const card = app.renderProfileCard({ displayName: evil, username: '"><i>', avatar: 'x" onerror="alert(1)' }, { total: 'viele' });
    assert.doesNotMatch(card, /<img src=x|<i>|" onerror="|NaN/);
    assert.doesNotMatch(app.renderProfileCard(undefined, {}), /undefined|NaN/);
});

test('an event without a readable date says "Termin folgt"; unknown values add nothing', async () => {
    const { app } = await frontend;
    const undated = app.renderUpcomingRow(entry({ event: event({ startDate: '', endDate: '' }) }), NOW, true);
    assert.match(undated, /<span class="date-tile-day">–<\/span>/);
    assert.match(undated, /Termin folgt/);

    const broken = app.renderUpcomingRow(entry({ status: 'paused', event: event({ startDate: 'kein Datum', title: undefined, location: undefined }) }), NOW, true);
    assert.match(broken, /Termin folgt/);
    assert.match(broken, /<div class="profile-event-facts"><\/div>/);
    assert.doesNotMatch(broken, /undefined|NaN|Invalid/);

    const history = app.renderHistoryRow(entry({ status: 'paused', event: event({ startDate: '' }) }), true);
    assert.match(history, /<span class="profile-history-date">–<\/span>/);
    assert.doesNotMatch(history, /chip|undefined|Invalid/);
});

test('placeholders stand in while the profile loads', async () => {
    const { app } = await frontend;
    const rows = app.renderProfileSkeleton(3);
    assert.equal(rows.split('<div class="glass-card profile-event" aria-hidden="true">').length - 1, 3);
    assert.match(rows, /class="skeleton /);
    assert.equal(app.renderBadgeSkeleton(4).split('<li class="badge-row" aria-hidden="true">').length - 1, 4);
});

test('the profile markup uses icons, never emojis', async () => {
    const { app } = await frontend;
    const statuses = ['accepted', 'pending', 'waitlisted', 'rejected'];
    const html = [
        app.renderProfileCard({ displayName: 'Tom', username: 'tom' }, { total: 1, accepted: 1, checkedIn: 1 }),
        ...statuses.map(status => app.renderUpcomingRow(entry({ status, event: event({ checkinEnabled: true }) }), NOW, true)),
        app.renderUpcomingRow(entry({ checkedIn: true }), NOW, true),
        ...statuses.map(status => app.renderHistoryRow(entry({ status }), true)),
        app.renderHistoryRow(entry({ event: null }), true),
        app.renderHistoryRow(entry({ event: event({ status: 'cancelled' }) }), true),
        app.renderBadgeList(BADGES),
        app.renderProfileSkeleton(3),
        app.renderBadgeSkeleton(4)
    ].join('');
    assert.doesNotMatch(html, EMOJI);
});

const MEMBER = { id: 'u-member', username: 'tom', displayName: 'Tom', avatar: '', roles: [], isAdmin: false };
const ADMIN = { ...MEMBER, id: 'u-admin', username: 'mori', displayName: 'Mori', isAdmin: true };

const pastEntry = (index) => entry({
    id: `h${index}`,
    event: event({ id: `past-${index}`, title: `Vergangen ${index}`, startDate: at(-24 * (index + 1)), endDate: at(-24 * (index + 1) + 2) })
});
const PROFILE = {
    stats: { total: 9, accepted: 7, pending: 1, rejected: 0, waitlisted: 1, checkedIn: 2 },
    badges: BADGES,
    unlockedBadges: 2,
    totalBadges: 4,
    upcoming: [entry({ id: 'r1' }), entry({ id: 'r2', event: event({ id: 'ev-2', title: 'Raid', status: 'draft' }) })],
    history: Array.from({ length: 12 }, (_, index) => pastEntry(index))
};
const countOf = (element, needle) => element.innerHTML.split(needle).length - 1;
const UPCOMING_ROW = 'class="glass-card profile-event';
const HISTORY_ROW = 'class="profile-history-row"';

/**
 * Open the profile page for a user.
 *
 * @param {Object|null} profile -> Answer of GET /api/user/profile; null leaves the route unanswered (404).
 * @param {Object} [user] -> Session user.
 * @param {Object} [options] -> Options of loadFrontendApp().
 * @returns {Promise<Object>} -> The harness of loadFrontendApp() plus `routes`.
 */
async function openProfile(profile, user = MEMBER, options = {}) {
    const routes = profile ? { '/api/user/profile': profile } : {};
    const harness = await loadFrontendApp(routes, options);
    harness.state.currentUser = user;
    await harness.app.showProfileSection();
    return { ...harness, routes };
}

test('the page fills card, upcoming events, history and badges', async () => {
    const { element, toasts } = await openProfile(PROFILE);
    assert.match(element('profile-card').innerHTML, /<div class="profile-name">Tom<\/div>/);
    assert.match(element('profile-card').innerHTML, /<dt>Anmeldungen<\/dt><dd>9<\/dd>/);
    assert.equal(countOf(element('profile-upcoming'), UPCOMING_ROW), 2);
    assert.equal(element('profile-upcoming-count').textContent, '2');
    assert.equal(isHidden(element('profile-history-block')), false);
    assert.equal(element('profile-history-count').textContent, '12');
    assert.equal(countOf(element('profile-history'), HISTORY_ROW), 5);
    assert.equal(isHidden(element('profile-history-more')), false);
    assert.equal(countOf(element('profile-badges'), '<li class="badge-row'), 4);
    assert.equal(element('profile-badge-count').textContent, '2 von 4');
    assert.deepEqual(toasts, []);
});

test('a member gets no link to a draft, an admin does', async () => {
    const draftRow = (harness) => harness.element('profile-upcoming').innerHTML.split(UPCOMING_ROW).find(html => html.includes('Raid'));
    const member = draftRow(await openProfile(PROFILE));
    assert.doesNotMatch(member, /href=|bi-chevron-right/);
    const admin = draftRow(await openProfile(PROFILE, ADMIN));
    assert.match(admin, /href="#event\/ev-2"/);
});

test('an archived event in the history links for admins only', async () => {
    const archived = entry({ id: 'h-old', event: event({ id: 'old-raid', title: 'Alter Raid', status: 'archived', startDate: at(-240), endDate: at(-238) }) });
    const historyOf = async (user) => (await openProfile({ ...PROFILE, history: [archived] }, user)).element('profile-history').innerHTML;

    const member = await historyOf(MEMBER);
    assert.match(member, /^<div class="profile-history-row">/);
    assert.match(member, /Alter Raid/);
    assert.doesNotMatch(member, /href=/);
    assert.match(await historyOf(ADMIN), /^<a class="profile-history-row" href="#event\/old-raid">/);
});

test('"Weitere anzeigen" shows five more rows without a request and disappears at the end', async () => {
    const { app, element, requests } = await openProfile(PROFILE);
    const loads = () => requests.filter(request => request.url === '/api/user/profile').length;
    assert.equal(loads(), 1);

    await app.runAction('showMoreProfileHistory', element('profile-history-more'));
    assert.equal(countOf(element('profile-history'), HISTORY_ROW), 10);
    assert.equal(isHidden(element('profile-history-more')), false);

    await app.runAction('showMoreProfileHistory', element('profile-history-more'));
    assert.equal(countOf(element('profile-history'), HISTORY_ROW), 12);
    assert.equal(isHidden(element('profile-history-more')), true);
    assert.equal(loads(), 1);

    // Opening the page again starts with five rows, and nothing is listed twice
    await app.showProfileSection();
    assert.equal(countOf(element('profile-history'), HISTORY_ROW), 5);
    assert.equal(isHidden(element('profile-history-more')), false);
    await Promise.all([app.showProfileSection(), app.showProfileSection()]);
    assert.equal(countOf(element('profile-upcoming'), UPCOMING_ROW), 2);
    assert.equal(countOf(element('profile-history'), HISTORY_ROW), 5);
});

test('a short history shows no button, an empty one no block', async () => {
    const short = await openProfile({ ...PROFILE, history: PROFILE.history.slice(0, 5) });
    assert.equal(countOf(short.element('profile-history'), HISTORY_ROW), 5);
    assert.equal(isHidden(short.element('profile-history-more')), true);

    const none = await openProfile({ ...PROFILE, history: [] });
    assert.equal(isHidden(none.element('profile-history-block')), true);
});

test('without upcoming events the page invites to the overview', async () => {
    const { element } = await openProfile({ ...PROFILE, upcoming: [] });
    const html = element('profile-upcoming').innerHTML;
    assert.match(html, /<h3 class="empty-state-title">Noch nichts geplant<\/h3>/);
    assert.match(html, /<a class="btn btn-accent" href="#events">/);
    assert.equal(element('profile-upcoming-count').textContent, '');
});

test('a failed answer offers to try again and still shows who is logged in', async () => {
    const { app, element, routes } = await openProfile(null);
    assert.match(element('profile-upcoming').innerHTML, /Profil konnte nicht geladen werden/);
    assert.match(element('profile-upcoming').innerHTML, /data-click="reloadProfile"/);
    assert.match(element('profile-card').innerHTML, /<div class="profile-name">Tom<\/div>/);
    assert.match(element('profile-card').innerHTML, /<dd>–<\/dd>/);
    assert.equal(element('profile-badges').innerHTML, '');
    assert.equal(isHidden(element('profile-history-block')), true);

    // No network at all looks the same
    routes['/api/user/profile'] = () => { throw new Error('offline'); };
    await app.runAction('reloadProfile', {});
    assert.match(element('profile-upcoming').innerHTML, /Profil konnte nicht geladen werden/);

    routes['/api/user/profile'] = PROFILE;
    await app.runAction('reloadProfile', {});
    assert.equal(countOf(element('profile-upcoming'), UPCOMING_ROW), 2);
    assert.match(element('profile-card').innerHTML, /<dt>Anmeldungen<\/dt><dd>9<\/dd>/);
});

test('an answer without lists shows empty lists instead of breaking', async () => {
    const { element } = await openProfile({});
    assert.match(element('profile-upcoming').innerHTML, /Noch nichts geplant/);
    assert.equal(isHidden(element('profile-history-block')), true);
    assert.equal(element('profile-badges').innerHTML, '');
    assert.equal(element('profile-badge-count').textContent, '0 von 0');
    assert.match(element('profile-card').innerHTML, /<dt>Anmeldungen<\/dt><dd>0<\/dd>/);
});

test('deleting the account asks once in the DEMS dialog', async () => {
    const dismissed = await openProfile(PROFILE, MEMBER, { confirm: false });
    await dismissed.app.deleteUserAccount();
    assert.deepEqual(dismissed.dialogs, [{
        text: 'Account und alle Anmeldungen dauerhaft löschen? Das lässt sich nicht rückgängig machen.',
        label: 'Account löschen',
        danger: true
    }]);
    assert.equal(dismissed.requests.some(request => request.method === 'DELETE'), false);

    const confirmed = await openProfile(PROFILE);
    confirmed.routes['/api/user/account'] = { success: true };
    confirmed.state.csrfToken = 'token-1';
    await confirmed.app.deleteUserAccount();
    assert.equal(confirmed.dialogs.length, 1);
    const sent = confirmed.requests.filter(request => request.method === 'DELETE');
    assert.deepEqual(sent.map(request => [request.url, request.headers['X-CSRF-TOKEN']]), [['/api/user/account', 'token-1']]);
    assert.deepEqual(confirmed.toasts, ['Account erfolgreich gelöscht.']);
});

test('the profile module asks no browser dialog, animates nothing and uses no emoji', async () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'pages', 'profile.js'), 'utf8');
    assert.doesNotMatch(source, /(?<![\w.])confirm\(/);
    assert.doesNotMatch(source, /gsap/);
    assert.doesNotMatch(source, EMOJI);

    const { app, toasts } = await openProfile(PROFILE);
    app.toggleVerboseLog(true);
    app.toggleVerboseLog(false);
    assert.deepEqual(toasts, ['Verbose-Logging aktiviert', 'Verbose-Logging deaktiviert']);
});

test('nothing uses the classes of the old profile any more', () => {
    const OLD_CLASSES = /profile-(?:reg-card|reg-info|badge-card|badges-grid|stats-grid|stat-card|stat-skeleton|header|avatar|meta)\b/;
    const sources = [
        ['index.html', fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8')],
        ['style.css', fs.readFileSync(path.join(REPO_ROOT, 'public', 'css', 'style.css'), 'utf8')],
        ...frontendSources().map(({ file, source }) => [file, source])
    ];
    for (const [file, source] of sources) assert.doesNotMatch(source, OLD_CLASSES, file);
});
