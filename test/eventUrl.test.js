const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildEventUrl, buildSiteUrl, buildCalendarFeedUrls } = require('../utils/eventUrl');

const REPO_ROOT = path.join(__dirname, '..');
const originalBaseUrl = process.env.BASE_URL;

afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = originalBaseUrl;
});

/** All JavaScript files of a directory, relative to the repository root (none when it does not exist). */
function jsFilesIn(dir) {
    if (!fs.existsSync(path.join(REPO_ROOT, dir))) return [];
    return fs.readdirSync(path.join(REPO_ROOT, dir))
        .filter(name => name.endsWith('.js'))
        .map(name => `${dir}/${name}`);
}

test('event links open the detail page of the web interface', () => {
    process.env.BASE_URL = 'https://dms.example.org';
    assert.equal(buildEventUrl('JxxAbqZYBPnvMwjcU1qm'), 'https://dms.example.org/#event/JxxAbqZYBPnvMwjcU1qm');
});

test('event links fall back to localhost without BASE_URL', () => {
    delete process.env.BASE_URL;
    assert.equal(buildEventUrl('abc'), 'http://localhost:3000/#event/abc');
});

test('site links open a page of the web interface', () => {
    process.env.BASE_URL = 'https://dms.example.org';
    assert.equal(buildSiteUrl('profile'), 'https://dms.example.org/#profile');
    delete process.env.BASE_URL;
    assert.equal(buildSiteUrl('events'), 'http://localhost:3000/#events');
});

test('no server code links an event to the list route #events/<id>', () => {
    const files = ['bot.js', ...jsFilesIn('bot'), 'server.js', ...jsFilesIn('routes'), ...jsFilesIn('utils'), ...jsFilesIn('dev')];
    const offenders = files.filter(file => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').includes('#events/${'));
    assert.deepEqual(offenders, []);
});

test('calendar feed links come as https, webcal and Google subscribe link', () => {
    process.env.BASE_URL = 'https://dms.example.org';
    const token = 'A'.repeat(43);
    const urls = buildCalendarFeedUrls(token);
    assert.equal(urls.url, `https://dms.example.org/calendar/${token}.ics`);
    assert.equal(urls.webcalUrl, `webcal://dms.example.org/calendar/${token}.ics`);
    assert.equal(urls.googleUrl, `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(urls.webcalUrl)}`);
});

test('calendar feed links of a plain-HTTP installation still get a webcal variant', () => {
    process.env.BASE_URL = 'http://localhost:3000';
    const urls = buildCalendarFeedUrls('tok');
    assert.equal(urls.url, 'http://localhost:3000/calendar/tok.ics');
    assert.equal(urls.webcalUrl, 'webcal://localhost:3000/calendar/tok.ics');
});
