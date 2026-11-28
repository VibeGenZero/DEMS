/**
 * Minimal ZIP reader and writer for `.dems` packages (no dependency, only
 * `zlib`). The reader treats its input as hostile: sizes come from the central
 * directory only, every inflate is capped, and all limits are enforced before
 * memory is spent. Path safety is not decided here (see `packageEntryError`).
 */
const zlib = require('zlib');
const { LIMITS, IGNORED_ENTRY } = require('./files');
const { PackageError } = require('./errors');

const INVALID = 'Die Datei ist keine gültige ZIP-Datei.';
const UNSUPPORTED = 'Verschlüsselte oder geteilte ZIP-Dateien werden nicht unterstützt.';
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const DOS_DATE_1980 = 0x21; // 1980-01-01
const FLAG_UTF8 = 0x800;

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

/**
 * @param {Buffer} buf -> Bytes to checksum.
 * @returns {number} -> Unsigned CRC-32.
 */
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Array<{name: string, data: Buffer}>} entries -> Files in the order they are written.
 * @returns {Buffer} -> ZIP bytes (deterministic: fixed DOS time, UTF-8 names).
 */
function writeZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const deflated = zlib.deflateRawSync(data);
        const stored = deflated.length >= data.length;
        const body = stored ? data : deflated;
        const method = stored ? 0 : 8;
        const crc = crc32(data);

        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(SIG_LOCAL, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(FLAG_UTF8, 6);
        lh.writeUInt16LE(method, 8);
        lh.writeUInt16LE(0, 10);
        lh.writeUInt16LE(DOS_DATE_1980, 12);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(body.length, 18);
        lh.writeUInt32LE(data.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26);

        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(SIG_CENTRAL, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(FLAG_UTF8, 8);
        ch.writeUInt16LE(method, 10);
        ch.writeUInt16LE(0, 12);
        ch.writeUInt16LE(DOS_DATE_1980, 14);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(body.length, 20);
        ch.writeUInt32LE(data.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28);
        ch.writeUInt32LE(offset, 42);

        const local = Buffer.concat([lh, nameBuf, body]);
        locals.push(local);
        centrals.push(Buffer.concat([ch, nameBuf]));
        offset += local.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]);
}

/** @returns {number} -> Bytes as MB, one decimal at most (5 for the default limit). */
function megabytes(bytes) {
    return Math.round((bytes / 1048576) * 10) / 10;
}

/** Finds the end-of-central-directory record (it may be followed by a comment). */
function findEocd(buf) {
    const lowest = Math.max(0, buf.length - 22 - 0xffff);
    for (let i = buf.length - 22; i >= lowest; i--) {
        if (buf.readUInt32LE(i) === SIG_EOCD) return i;
    }
    return -1;
}

/**
 * @param {Buffer} buffer -> Uploaded ZIP bytes (untrusted).
 * @param {object} [limits] -> Defaults to `LIMITS`.
 * @returns {Array<{name: string, data: Buffer, symlink: boolean}>} -> Files; directories and OS litter are skipped.
 * @throws {PackageError} -> German message when the archive is invalid or exceeds a limit.
 */
function readZip(buffer, limits = LIMITS) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new PackageError(INVALID);
    if (buffer.length > limits.packedBytes) throw new PackageError(`Die Datei ist größer als ${megabytes(limits.packedBytes)} MB.`);

    const eocd = findEocd(buffer);
    if (eocd < 0) throw new PackageError(INVALID);
    const diskNumber = buffer.readUInt16LE(eocd + 4);
    const cdDisk = buffer.readUInt16LE(eocd + 6);
    const count = buffer.readUInt16LE(eocd + 10);
    const cdSize = buffer.readUInt32LE(eocd + 12);
    const cdOffset = buffer.readUInt32LE(eocd + 16);
    if (diskNumber !== 0 || cdDisk !== 0) throw new PackageError(UNSUPPORTED);
    if (count > limits.entries) throw new PackageError(`Zu viele Dateien (höchstens ${limits.entries}).`);
    if (cdOffset + cdSize > eocd) throw new PackageError(INVALID);

    // Pass 1: parse every central-directory record and prove the data ranges are
    // sane and disjoint before anything is inflated (overlaps would multiply work).
    const records = [];
    const ranges = [];
    let pos = cdOffset;
    for (let i = 0; i < count; i++) {
        if (pos + 46 > eocd || buffer.readUInt32LE(pos) !== SIG_CENTRAL) throw new PackageError(INVALID);
        const flags = buffer.readUInt16LE(pos + 8);
        const method = buffer.readUInt16LE(pos + 10);
        const crc = buffer.readUInt32LE(pos + 16);
        const csize = buffer.readUInt32LE(pos + 20);
        const usize = buffer.readUInt32LE(pos + 24);
        const nameLen = buffer.readUInt16LE(pos + 28);
        const extraLen = buffer.readUInt16LE(pos + 30);
        const commentLen = buffer.readUInt16LE(pos + 32);
        const attrs = buffer.readUInt32LE(pos + 38);
        const localOffset = buffer.readUInt32LE(pos + 42);
        if (pos + 46 + nameLen > eocd) throw new PackageError(INVALID);
        const nameBytes = buffer.subarray(pos + 46, pos + 46 + nameLen);
        const name = nameBytes.toString('utf8');
        pos += 46 + nameLen + extraLen + commentLen;

        if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) throw new PackageError(INVALID);
        if (localOffset + 30 > cdOffset || buffer.readUInt32LE(localOffset) !== SIG_LOCAL) throw new PackageError(INVALID);
        const localNameLen = buffer.readUInt16LE(localOffset + 26);
        const start = localOffset + 30 + localNameLen + buffer.readUInt16LE(localOffset + 28);
        if (start + csize > cdOffset) throw new PackageError(INVALID);
        if (!buffer.subarray(localOffset + 30, localOffset + 30 + localNameLen).equals(nameBytes)) throw new PackageError(INVALID);
        ranges.push([localOffset, start + csize]);
        records.push({ name, flags, method, crc, csize, usize, attrs, start });
    }
    ranges.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < ranges.length; i++) {
        if (ranges[i][0] < ranges[i - 1][1]) throw new PackageError(INVALID);
    }

    // Pass 2: filter, inflate and verify.
    const result = [];
    const seen = new Set();
    let total = 0;
    for (const { name, flags, method, crc, csize, usize, attrs, start } of records) {
        if (name.endsWith('/') || IGNORED_ENTRY.test(name)) continue;
        if (flags & 0x41) throw new PackageError(UNSUPPORTED);
        if (method !== 0 && method !== 8) throw new PackageError(`Nicht unterstütztes Packverfahren: ${name}`);
        if (usize > limits.entryBytes) throw new PackageError(`Datei zu groß: ${name}`);
        const key = name.toLowerCase();
        if (seen.has(key)) throw new PackageError(`Doppelte Datei: ${name}`);
        seen.add(key);

        const packed = buffer.subarray(start, start + csize);

        let data;
        if (method === 0) {
            if (csize !== usize) throw new PackageError(INVALID);
            data = Buffer.from(packed);
        } else {
            try {
                data = zlib.inflateRawSync(packed, { maxOutputLength: Math.min(limits.entryBytes, usize) + 1 });
            } catch (err) {
                if (err instanceof RangeError || err.code === 'ERR_BUFFER_TOO_LARGE') {
                    throw new PackageError(`Datei zu groß: ${name}`);
                }
                throw new PackageError(INVALID);
            }
        }
        if (data.length !== usize || crc32(data) !== crc) throw new PackageError(INVALID);
        total += data.length;
        if (total > limits.unpackedBytes) throw new PackageError(`Entpackt zu groß (höchstens ${megabytes(limits.unpackedBytes)} MB).`);

        result.push({ name, data, symlink: ((attrs >>> 16) & 0o170000) === 0o120000 });
    }
    return result;
}

module.exports = { writeZip, readZip, crc32 };
