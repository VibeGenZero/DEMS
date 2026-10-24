const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir } = require('./helpers');

// Own SQLite file and upload folder; the empty cwd keeps a local .env out
const tmpDir = createTempDir('banners');
process.chdir(tmpDir);
for (const key of Object.keys(process.env)) if (key.startsWith('FIREBASE_')) delete process.env[key];
process.env.SQLITE_PATH = path.join(tmpDir, 'banners.sqlite');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.BASE_URL = 'https://dems.example';

const store = require('../utils/bannerStore');
const { db, doc, setDoc, deleteDoc } = require('../firebaseAdmin');

const HOUR = 60 * 60 * 1000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const GIF87 = Buffer.from('GIF87a\x01\x00\x01\x00', 'latin1');
const GIF89 = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const bannerFiles = () => {
    const dir = store.bannerDir();
    return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

test('detectImageType reads the type from the first bytes', () => {
    assert.equal(store.detectImageType(PNG), 'png');
    assert.equal(store.detectImageType(JPEG), 'jpg');
    assert.equal(store.detectImageType(GIF87), 'gif');
    assert.equal(store.detectImageType(GIF89), 'gif');
    assert.equal(store.detectImageType(WEBP), 'webp');
});

test('detectImageType refuses everything else', () => {
    const others = [
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        Buffer.from('<!doctype html><script>alert(1)</script>'),
        Buffer.alloc(0),
        PNG.subarray(0, 4),
        Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE')]),
        'not a buffer',
        null
    ];
    for (const value of others) assert.equal(store.detectImageType(value), null, String(value));
});

test('isBannerPath accepts only upload paths with a uuid and an allowed extension', () => {
    for (const ext of ['png', 'jpg', 'gif', 'webp']) assert.equal(store.isBannerPath(`/uploads/banners/${UUID}.${ext}`), true, ext);
    const invalid = [
        `/uploads/banners/${UUID}.svg`, `/uploads/banners/${UUID}.PNG`, `/uploads/banners/${UUID.toUpperCase()}.png`,
        `/uploads/banners/../${UUID}.png`, `/uploads/banners/x/${UUID}.png`, `/uploads/banners/${UUID}.png?x=1`,
        `uploads/banners/${UUID}.png`, `https://dems.example/uploads/banners/${UUID}.png`, '/api/admin/reset', '', null
    ];
    for (const value of invalid) assert.equal(store.isBannerPath(value), false, String(value));
});

test('the frontend and the server share the same banner path pattern', async () => {
    const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'core', 'ui.js'), 'utf8');
    const match = ui.match(/export const BANNER_PATH = (\/.+\/);/);
    assert.ok(match, 'BANNER_PATH in public/js/core/ui.js');
    assert.equal(match[1], String(store.BANNER_PATH));
    const checks = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin', 'wizard-checks.js'), 'utf8');
    const wizardMatch = checks.match(/const UPLOADED_BANNER = (\/.+\/);/);
    assert.ok(wizardMatch, 'UPLOADED_BANNER in public/js/admin/wizard-checks.js');
    assert.equal(wizardMatch[1], String(store.BANNER_PATH));
});

test('saveBanner writes a new file and returns its path', async () => {
    const saved = await store.saveBanner(PNG, 'png');
    assert.ok(store.isBannerPath(saved), saved);
    const file = path.join(store.bannerDir(), path.basename(saved));
    assert.deepEqual(fs.readFileSync(file), PNG);
    assert.ok(bannerFiles().every(name => /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(name)), 'no temp file left');
    assert.equal(await store.isStoredBanner(saved), true);
    fs.unlinkSync(file);
    assert.equal(await store.isStoredBanner(saved), false);
});

test('isStoredBanner is false for anything that is not an upload path', async () => {
    assert.equal(await store.isStoredBanner('https://example.com/a.png'), false);
    assert.equal(await store.isStoredBanner(`/uploads/banners/${UUID}.png`), false);
});

test('bannerForDiscord turns a banner into what Discord needs', async () => {
    assert.deepEqual(store.bannerForDiscord(''), {});
    assert.deepEqual(store.bannerForDiscord(undefined), {});
    assert.deepEqual(store.bannerForDiscord('https://example.com/a.png'), { url: 'https://example.com/a.png' });
    assert.deepEqual(store.bannerForDiscord('javascript:alert(1)'), {});
    assert.deepEqual(store.bannerForDiscord(`/uploads/banners/${UUID}.png`), {}, 'missing file');

    const saved = await store.saveBanner(JPEG, 'jpg');
    assert.deepEqual(store.bannerForDiscord(saved), {
        url: `https://dems.example${saved}`,
        file: path.join(store.bannerDir(), path.basename(saved))
    });
    fs.unlinkSync(path.join(store.bannerDir(), path.basename(saved)));
});

test('releaseBanners deletes only files no event uses', async () => {
    const shared = await store.saveBanner(PNG, 'png');
    const lonely = await store.saveBanner(GIF89, 'gif');
    await setDoc(doc(db, 'events', 'rel-a'), { title: 'A', bannerUrl: shared });
    await setDoc(doc(db, 'events', 'rel-b'), { title: 'B', bannerUrl: shared });

    await deleteDoc(doc(db, 'events', 'rel-a'));
    await store.releaseBanners([shared, lonely, 'https://example.com/a.png', '', undefined]);
    assert.equal(await store.isStoredBanner(shared), true, 'still used by rel-b');
    assert.equal(await store.isStoredBanner(lonely), false);

    await deleteDoc(doc(db, 'events', 'rel-b'));
    await store.releaseBanners([shared]);
    assert.equal(await store.isStoredBanner(shared), false);
});

test('releaseBanners logs a failed delete and does not throw', async (t) => {
    const saved = await store.saveBanner(PNG, 'png');
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
    t.mock.method(fs.promises, 'unlink', async () => { throw new Error('busy'); });
    await store.releaseBanners([saved]);
    assert.ok(errors.some(line => line.includes('busy')), errors.join('\n'));
    t.mock.restoreAll();
    fs.unlinkSync(path.join(store.bannerDir(), path.basename(saved)));
});

test('sweepOrphanBanners deletes old unused files and keeps young or used ones', async () => {
    const now = Date.now();
    const oldUnused = await store.saveBanner(PNG, 'png');
    const oldUsed = await store.saveBanner(PNG, 'png');
    const young = await store.saveBanner(PNG, 'png');
    const age = (saved, ms) => {
        const file = path.join(store.bannerDir(), path.basename(saved));
        const when = new Date(now - ms);
        fs.utimesSync(file, when, when);
    };
    age(oldUnused, 25 * HOUR);
    age(oldUsed, 25 * HOUR);
    age(young, 1 * HOUR);
    await setDoc(doc(db, 'events', 'sweep-a'), { title: 'A', bannerUrl: oldUsed });

    const deleted = await store.sweepOrphanBanners({ maxAgeMs: 24 * HOUR, now });
    assert.equal(deleted, 1);
    assert.equal(await store.isStoredBanner(oldUnused), false);
    assert.equal(await store.isStoredBanner(oldUsed), true);
    assert.equal(await store.isStoredBanner(young), true);
});

test('sweepOrphanBanners copes with a missing folder', async () => {
    const before = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = path.join(tmpDir, 'nothing-here');
    try {
        assert.equal(await store.sweepOrphanBanners({ maxAgeMs: HOUR }), 0);
    } finally {
        process.env.UPLOAD_DIR = before;
    }
});
