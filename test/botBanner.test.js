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
const imageOf = (event) => bot.buildEventEmbed({ title: 'Raid', startDate: '2026-12-01T18:00:00.000Z', ...event }).toJSON().image;

test('the embed shows an uploaded banner under the absolute BASE_URL address', async () => {
    const bannerUrl = await saveBanner(PNG, 'png');
    assert.deepEqual(imageOf({ bannerUrl }), { url: `http://localhost:3000${bannerUrl}` });
});

test('the embed passes an external banner on unchanged', () => {
    assert.deepEqual(imageOf({ bannerUrl: 'https://example.com/raid.png' }), { url: 'https://example.com/raid.png' });
});

test('the embed has no image without a banner or when the uploaded file is gone', () => {
    assert.equal(imageOf({ bannerUrl: '' }), undefined);
    assert.equal(imageOf({ bannerUrl: '/uploads/banners/0f8fad5b-d9cb-469f-a165-70867728950e.png' }), undefined);
});
