/**
 * Uploaded event banners: type check by content, storage as files in the
 * data volume, the form Discord needs, and clean-up of unused files.
 * The database stores only the path `/uploads/banners/<uuid>.<ext>`.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Path of an uploaded banner; the frontend copy lives in public/js/core/ui.js. */
const BANNER_PATH = /^\/uploads\/banners\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;
const BANNER_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;
const PUBLIC_PREFIX = '/uploads/banners/';
const MAX_BANNER_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['png', 'jpg', 'gif', 'webp'];

/**
 * Folder holding the banner files (read on every call so tests can move it).
 *
 * @returns {string} -> Absolute folder path.
 */
function bannerDir() {
    const base = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
    return path.resolve(base, 'banners');
}

/**
 * Image type from the first bytes of a file.
 *
 * @param {Buffer} buffer -> File content.
 * @returns {string|null} -> `png`, `jpg`, `gif`, `webp` or null.
 */
function detectImageType(buffer) {
    if (!Buffer.isBuffer(buffer)) return null;
    const starts = (bytes, offset = 0) => buffer.length >= offset + bytes.length
        && bytes.every((byte, i) => buffer[offset + i] === byte);
    if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (starts([0xff, 0xd8, 0xff])) return 'jpg';
    const head = buffer.subarray(0, 12).toString('latin1');
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif';
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp';
    return null;
}

/**
 * Whether a value is the path of an uploaded banner (no disk check).
 *
 * @param {*} value -> Banner value of an event.
 * @returns {boolean}
 */
function isBannerPath(value) {
    return typeof value === 'string' && BANNER_PATH.test(value);
}

/**
 * Absolute file of an upload path.
 *
 * @param {string} bannerPath -> Value that passed isBannerPath.
 * @returns {string} -> File path inside bannerDir().
 */
function fileOf(bannerPath) {
    return path.join(bannerDir(), bannerPath.slice(PUBLIC_PREFIX.length));
}

/**
 * Store an image under a new random name.
 *
 * @param {Buffer} buffer -> Checked image content.
 * @param {string} type -> Result of detectImageType.
 * @returns {Promise<string>} -> Upload path for `bannerUrl`.
 */
async function saveBanner(buffer, type) {
    if (!ALLOWED_TYPES.includes(type)) throw new Error(`Unsupported banner type: ${type}`);
    const dir = bannerDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const name = `${crypto.randomUUID()}.${type}`;
    // Write under a temp name first, so a half-written file never has a valid name
    const tempFile = path.join(dir, `.${name}.tmp`);
    await fs.promises.writeFile(tempFile, buffer);
    await fs.promises.rename(tempFile, path.join(dir, name));
    return PUBLIC_PREFIX + name;
}

/**
 * Whether a value is an upload path whose file exists.
 *
 * @param {*} value -> Banner value of an event.
 * @returns {Promise<boolean>}
 */
async function isStoredBanner(value) {
    if (!isBannerPath(value)) return false;
    try {
        return (await fs.promises.stat(fileOf(value))).isFile();
    } catch {
        return false;
    }
}

/**
 * What Discord needs for a banner.
 *
 * @param {*} bannerUrl -> Banner value of an event.
 * @returns {Object} -> `{}`, `{ url }` for an external URL or `{ url, file }` for an upload.
 */
function bannerForDiscord(bannerUrl) {
    if (isBannerPath(bannerUrl)) {
        const file = fileOf(bannerUrl);
        if (!fs.existsSync(file)) return {};
        const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
        return { url: base + bannerUrl, file };
    }
    if (typeof bannerUrl === 'string' && /^https?:\/\//i.test(bannerUrl)) return { url: bannerUrl };
    return {};
}

/**
 * Banner paths every stored event or event template still uses.
 *
 * @returns {Promise<Set<string>>}
 */
async function usedBanners() {
    // Loaded here so the pure helpers (eventPreview, validators) need no database
    const { db, collection, getDocs } = require('../firebaseAdmin');
    const used = new Set();
    const snapshot = await getDocs(collection(db, 'events'));
    snapshot.forEach(docSnap => {
        const bannerUrl = docSnap.data().bannerUrl;
        if (isBannerPath(bannerUrl)) used.add(bannerUrl);
    });
    // Event templates (W-10) keep their banner for the events still to come
    const templates = await getDocs(collection(db, 'eventTemplates'));
    templates.forEach(docSnap => {
        const bannerUrl = docSnap.data().settings?.bannerUrl;
        if (isBannerPath(bannerUrl)) used.add(bannerUrl);
    });
    return used;
}

/**
 * Delete files that just stopped being used, unless another event or a template still uses them.
 * Never throws; failures are logged.
 *
 * @param {Array<*>} values -> Former banner values (external URLs and empties are ignored).
 * @returns {Promise<number>} -> Number of deleted files.
 */
async function releaseBanners(values) {
    const candidates = [...new Set((values || []).filter(isBannerPath))];
    if (!candidates.length) return 0;
    let deleted = 0;
    try {
        const used = await usedBanners();
        for (const bannerPath of candidates) {
            if (used.has(bannerPath)) continue;
            try {
                await fs.promises.unlink(fileOf(bannerPath));
                deleted++;
            } catch (err) {
                if (err.code !== 'ENOENT') console.error(`Banner ${bannerPath} konnte nicht gelöscht werden:`, err.message);
            }
        }
    } catch (err) {
        console.error('Banner-Aufräumen fehlgeschlagen:', err.message);
    }
    return deleted;
}

/**
 * Delete banner files no event uses that are older than `maxAgeMs`
 * (uploads whose wizard was closed without saving). Never throws.
 *
 * @param {Object} options -> `{ maxAgeMs, now }`.
 * @returns {Promise<number>} -> Number of deleted files.
 */
async function sweepOrphanBanners({ maxAgeMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
    let names;
    try {
        names = await fs.promises.readdir(bannerDir());
    } catch {
        return 0;
    }
    let deleted = 0;
    try {
        const used = await usedBanners();
        for (const name of names) {
            if (!BANNER_FILE.test(name) || used.has(PUBLIC_PREFIX + name)) continue;
            const file = path.join(bannerDir(), name);
            try {
                const { mtimeMs } = await fs.promises.stat(file);
                if (now - mtimeMs <= maxAgeMs) continue;
                await fs.promises.unlink(file);
                deleted++;
            } catch (err) {
                if (err.code !== 'ENOENT') console.error(`Banner ${name} konnte nicht gelöscht werden:`, err.message);
            }
        }
    } catch (err) {
        console.error('Banner-Aufräumen fehlgeschlagen:', err.message);
    }
    return deleted;
}

module.exports = {
    BANNER_PATH,
    BANNER_FILE,
    MAX_BANNER_BYTES,
    ALLOWED_TYPES,
    bannerDir,
    detectImageType,
    isBannerPath,
    saveBanner,
    isStoredBanner,
    bannerForDiscord,
    releaseBanners,
    sweepOrphanBanners
};
