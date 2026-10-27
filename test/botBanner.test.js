const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database and upload folder; the empty cwd keeps a local .env out
const tmpDir = createTempDir('bot-banner');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
delete process.env.PORT;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'bot-banner.sqlite');
process.env.DEV_UPLOAD_DIR = path.join(tmpDir, 'uploads');

const bot = require('../bot');
const { saveBanner } = require('../utils/bannerStore');

after(async () => {
    await bot.client.destroy();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
// Banner of the announcement: the first media gallery of its container (B-05)
const GALLERY = 12;
const imageOf = (event) => {
    const payload = bot.buildEventAnnouncement({ title: 'Raid', startDate: '2026-12-01T18:00:00.000Z', ...event }, 'evt1');
    const container = payload.components.map(component => component.toJSON()).find(component => component.type === 17);
    const gallery = container.components.find(component => component.type === GALLERY);
    return gallery ? { url: gallery.items[0].media.url } : undefined;
};

test('the announcement shows an uploaded banner under the absolute BASE_URL address', async () => {
    const bannerUrl = await saveBanner(PNG, 'png');
    assert.deepEqual(imageOf({ bannerUrl }), { url: `http://localhost:3000${bannerUrl}` });
});

test('the announcement passes an external banner on unchanged', () => {
    assert.deepEqual(imageOf({ bannerUrl: 'https://example.com/raid.png' }), { url: 'https://example.com/raid.png' });
});

test('the announcement has no image without a banner or when the uploaded file is gone', () => {
    assert.equal(imageOf({ bannerUrl: '' }), undefined);
    assert.equal(imageOf({ bannerUrl: '/uploads/banners/0f8fad5b-d9cb-469f-a165-70867728950e.png' }), undefined);
});
