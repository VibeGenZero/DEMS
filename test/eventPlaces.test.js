const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, frontendSources, REPO_ROOT } = require('./helpers');

const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

// `places` as GET /api/events answers it (utils/capacity.js builds the texts)
const places = (fields = {}) => ({
    taken: 5, capacity: 20, guests: 1, pending: 0, waitlist: 0,
    text: '5 von 20 Plätzen belegt (inkl. 1 Gast)', waitlistText: '', ...fields
});
const sidebar = async (event) => {
    const { app, element } = await loadFrontendApp({});
    app.renderSidebarCapacity(event);
    return element('sidebar-capacity-content').innerHTML;
};

test('the event page shows the places sentence and how many places are free', async () => {
    const html = await sidebar({ maxParticipants: 20, places: places() });
    assert.match(html, /<div class="capacity-label">5 von 20 Plätzen belegt \(inkl\. 1 Gast\)<\/div>/);
    assert.match(html, /<progress class="capacity-meter" max="20" value="5"/);
    assert.match(html, /<div class="capacity-sublabel">15 Plätze frei<\/div>/);
    assert.doesNotMatch(html, /Anmeldungen|max\.|style="/);
});

test('the event page names the waitlist beside the free places, also when it is not full', async () => {
    const waiting = places({ waitlist: 2, waitlistText: '2 auf der Warteliste' });
    assert.match(await sidebar({ maxParticipants: 20, places: waiting }), /15 Plätze frei · 2 auf der Warteliste/);

    const full = places({ taken: 20, guests: 0, text: '20 von 20 Plätzen belegt', waitlist: 3, waitlistText: '3 auf der Warteliste' });
    const html = await sidebar({ maxParticipants: 20, places: full });
    assert.match(html, /<div class="capacity is-full">/);
    assert.match(html, /<div class="capacity-sublabel">Ausgebucht · 3 auf der Warteliste<\/div>/);

    const one = places({ taken: 19, text: '19 von 20 Plätzen belegt (inkl. 1 Gast)' });
    assert.match(await sidebar({ maxParticipants: 20, places: one }), /<div class="capacity-sublabel">1 Platz frei<\/div>/);
});

test('an event without a limit shows the sentence and no bar', async () => {
    const html = await sidebar({ maxParticipants: 0, places: places({ capacity: 0, text: '5 Plätze belegt (inkl. 1 Gast)' }) });
    assert.match(html, /<div class="capacity-label">5 Plätze belegt \(inkl\. 1 Gast\)<\/div>/);
    assert.match(html, /<div class="capacity-sublabel">Unbegrenzt<\/div>/);
    assert.doesNotMatch(html, /<progress/);
});

test('the places sentence of the event page is escaped', async () => {
    const html = await sidebar({ maxParticipants: 20, places: places({ text: '<b>5</b>', waitlistText: '<i>2</i>', waitlist: 2 }) });
    assert.doesNotMatch(html, /<b>|<i>/);
});

test('the participants heading carries no number of its own', () => {
    // "TEILNEHMER (4)" counted accepted members only and contradicted the places sentence
    assert.doesNotMatch(INDEX_HTML, /detail-participants-count/);
    for (const { file, source } of frontendSources()) assert.doesNotMatch(source, /detail-participants-count/, file);
});
