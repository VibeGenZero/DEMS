const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPreviewEvent } = require('../utils/eventPreview');

test('the preview event takes the defaults of a new event', () => {
    assert.deepEqual(buildPreviewEvent({ title: 'Raidnacht' }), {
        title: 'Raidnacht', description: '', startDate: '', endDate: '', registrationDeadline: '', unregisterDeadline: '', bannerUrl: '', category: '',
        status: 'active', accessMode: 'open', allowGuests: true, formFields: [], accentColor: '', slots: [], maxParticipants: 0
    });
    assert.equal(buildPreviewEvent().title, '');
});

test('slots set the places and switch guests off; broken slots are left out', () => {
    const withSlots = buildPreviewEvent({ title: 'Raid', maxParticipants: '50', allowGuests: true, slots: [{ name: 'Tank', emoji: '🛡️', capacity: 2 }, { name: 'Heiler', capacity: 3 }] });
    assert.equal(withSlots.maxParticipants, 5);
    assert.equal(withSlots.allowGuests, false);
    assert.deepEqual(withSlots.slots.map(slot => [slot.name, slot.capacity]), [['Tank', 2], ['Heiler', 3]]);

    const broken = buildPreviewEvent({ title: 'Raid', maxParticipants: '12', slots: [{ name: '', capacity: 2 }] });
    assert.deepEqual([broken.slots, broken.maxParticipants, broken.allowGuests], [[], 12, true]);
});

test('only values the Discord builders accept reach them', () => {
    const event = buildPreviewEvent({
        title: 'x'.repeat(300), description: 'y'.repeat(6000), accentColor: 'red', status: 'kaputt',
        accessMode: 'role-required', maxParticipants: '-3', category: 42,
        formFields: [{ label: '' }, { label: 'Name', type: 'text' }, null, 'Feld']
    });
    assert.equal(event.title.length, 200);
    assert.equal(event.description.length, 5000);
    assert.deepEqual([event.accentColor, event.status, event.accessMode, event.maxParticipants, event.category], ['', 'active', 'role-required', 0, '']);
    assert.deepEqual(event.formFields, [{ label: 'Name', type: 'text' }]);
    // discord.js refuses an image that is no http(s) URL
    for (const bannerUrl of ['https://', 'javascript:alert(1)', 'ftp://example.com/a.png', 'banner.png']) {
        assert.equal(buildPreviewEvent({ bannerUrl }).bannerUrl, '', bannerUrl);
    }
    assert.equal(buildPreviewEvent({ bannerUrl: 'https://example.com/raid.png' }).bannerUrl, 'https://example.com/raid.png');
    // An uploaded banner (W-12) stays; the announcement turns it into an absolute URL
    assert.equal(buildPreviewEvent({ bannerUrl: '/uploads/banners/0f8fad5b-d9cb-469f-a165-70867728950e.webp' }).bannerUrl, '/uploads/banners/0f8fad5b-d9cb-469f-a165-70867728950e.webp');
    assert.equal(buildPreviewEvent({ bannerUrl: '/uploads/banners/../a.png' }).bannerUrl, '');
});

test('the preview carries both deadlines, so the announcement shows them (W-03)', () => {
    const event = buildPreviewEvent({ title: 'Raid', registrationDeadline: '2026-10-23T18:00:00.000Z', unregisterDeadline: 'x'.repeat(100) });
    assert.equal(event.registrationDeadline, '2026-10-23T18:00:00.000Z');
    assert.equal(event.unregisterDeadline.length, 40);
});
