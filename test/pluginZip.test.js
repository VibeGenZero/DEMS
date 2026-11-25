const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { writeZip, readZip, crc32 } = require('../plugin-sdk/zip');
const { PackageError } = require('../plugin-sdk/errors');

/** Hand-built ZIP so tests can craft headers the writer never produces. */
function rawZip(entries, { descriptor = false, eocdTotal } = {}) {
    const locals = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
        const name = Buffer.from(e.name);
        const method = e.method ?? 8;
        const raw = e.data ?? Buffer.alloc(0);
        const comp = e.comp ?? (method === 8 ? zlib.deflateRawSync(raw) : raw);
        const flags = (e.flags ?? 0) | (descriptor ? 8 : 0);
        const crc = e.crc ?? crc32(raw);
        const usize = e.usize ?? raw.length;
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(flags, 6);
        lh.writeUInt16LE(method, 8);
        if (!descriptor) {
            lh.writeUInt32LE(crc, 14);
            lh.writeUInt32LE(comp.length, 18);
            lh.writeUInt32LE(usize, 22);
        }
        lh.writeUInt16LE(name.length, 26);
        const dd = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
        if (descriptor) {
            dd.writeUInt32LE(0x08074b50, 0);
            dd.writeUInt32LE(crc, 4);
            dd.writeUInt32LE(comp.length, 8);
            dd.writeUInt32LE(usize, 12);
        }
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(flags, 8);
        ch.writeUInt16LE(method, 10);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(comp.length, 20);
        ch.writeUInt32LE(usize, 24);
        ch.writeUInt16LE(name.length, 28);
        ch.writeUInt32LE(e.attrs ?? 0, 38);
        ch.writeUInt32LE(offset, 42);
        central.push(Buffer.concat([ch, name]));
        const local = Buffer.concat([lh, name, comp, dd]);
        locals.push(local);
        offset += local.length;
    }
    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(eocdTotal ?? entries.length, 8);
    eocd.writeUInt16LE(eocdTotal ?? entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]);
}

const expectError = (fn, message) =>
    assert.throws(fn, (err) => err instanceof PackageError && err.name === 'PackageError' && err.message === message);

test('round trip keeps names, order and bytes (text, binary, empty)', () => {
    const entries = [
        { name: 'plugin.json', data: Buffer.from('{"id":"x"}'.repeat(50)) },
        { name: 'assets/a.png', data: Buffer.from([0, 255, 1, 254, 2, 253]) },
        { name: 'empty.txt', data: Buffer.alloc(0) }
    ];
    const out = readZip(writeZip(entries));
    assert.deepEqual(out.map((e) => e.name), entries.map((e) => e.name));
    out.forEach((e, i) => {
        assert.ok(e.data.equals(entries[i].data));
        assert.equal(e.symlink, false);
    });
});

test('writer is deterministic, sets UTF-8 flag, fixed DOS time and stores incompressible data', () => {
    const data = Buffer.from([1, 2, 3]);
    const buf = writeZip([{ name: 'ä.bin', data }]);
    assert.ok(buf.equals(writeZip([{ name: 'ä.bin', data }])));
    assert.equal(buf.readUInt16LE(6) & 0x800, 0x800);
    assert.equal(buf.readUInt16LE(8), 0);
    assert.equal(buf.readUInt16LE(10), 0);
    assert.equal(buf.readUInt16LE(12), 0x21);
    assert.equal(readZip(buf)[0].name, 'ä.bin');
});

test('reads a stored entry and a data-descriptor entry', () => {
    const data = Buffer.from('hello hello hello');
    assert.ok(readZip(rawZip([{ name: 'a.txt', data, method: 0 }]))[0].data.equals(data));
    assert.ok(readZip(rawZip([{ name: 'a.txt', data }], { descriptor: true }))[0].data.equals(data));
});

test('skips directories and OS litter; flags symlinks', () => {
    const out = readZip(rawZip([
        { name: 'dir/', data: Buffer.alloc(0), method: 0 },
        { name: '__MACOSX/._x', data: Buffer.from('x') },
        { name: 'sub/.DS_Store', data: Buffer.from('x') },
        { name: 'link.js', data: Buffer.from('target'), attrs: (0o120777 << 16) >>> 0 },
        { name: 'ok.js', data: Buffer.from('1'), attrs: (0o100644 << 16) >>> 0 }
    ]));
    assert.deepEqual(out.map((e) => [e.name, e.symlink]), [['link.js', true], ['ok.js', false]]);
});

test('structural errors', () => {
    expectError(() => readZip(Buffer.from('not a zip at all')), 'Die Datei ist keine gültige ZIP-Datei.');
    expectError(() => readZip(Buffer.alloc(0)), 'Die Datei ist keine gültige ZIP-Datei.');
    const flipped = rawZip([{ name: 'a.txt', data: Buffer.from('abc'), crc: 12345 }]);
    expectError(() => readZip(flipped), 'Die Datei ist keine gültige ZIP-Datei.');
    const bad = rawZip([{ name: 'a.txt', data: Buffer.from('abc') }]);
    bad.writeUInt32LE(9999999, bad.length - 6); // central directory offset
    expectError(() => readZip(bad), 'Die Datei ist keine gültige ZIP-Datei.');
    expectError(() => readZip(rawZip([{ name: 'a', data: Buffer.from('x'), flags: 1 }])),
        'Verschlüsselte oder geteilte ZIP-Dateien werden nicht unterstützt.');
    expectError(() => readZip(rawZip([{ name: 'a.txt', data: Buffer.from('x'), method: 12 }])),
        'Nicht unterstütztes Packverfahren: 12');
});

test('limits', () => {
    const many = Array.from({ length: 301 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('x') }));
    expectError(() => readZip(rawZip(many)), 'Zu viele Dateien (höchstens 300).');
    expectError(() => readZip(Buffer.alloc(6 * 1024 * 1024)), 'Die Datei ist größer als 5 MB.');
    // bomb: declares 100 bytes, inflates to 3 MB
    const bomb = rawZip([{ name: 'b.txt', data: Buffer.alloc(3 * 1024 * 1024), usize: 100 }]);
    expectError(() => readZip(bomb), 'Datei zu groß: b.txt');
    // declared too large
    const big = rawZip([{ name: 'c.txt', data: Buffer.alloc(3 * 1024 * 1024) }]);
    expectError(() => readZip(big), 'Datei zu groß: c.txt');
    // total unpacked
    const parts = Array.from({ length: 11 }, (_, i) => ({ name: `p${i}.bin`, data: Buffer.alloc(2 * 1024 * 1024) }));
    expectError(() => readZip(rawZip(parts)), 'Entpackt zu groß (höchstens 20 MB).');
});

test('duplicate names, also case-insensitive', () => {
    expectError(() => readZip(rawZip([
        { name: 'A.js', data: Buffer.from('1') },
        { name: 'a.js', data: Buffer.from('2') }
    ])), 'Doppelte Datei: a.js');
});
