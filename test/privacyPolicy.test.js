const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

const tmpDir = createTempDir('privacy-policy');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.SQLITE_PATH = path.join(tmpDir, 'privacy.sqlite');

const { db, doc, deleteDoc } = require('../firebaseAdmin');
const privacy = require('../utils/privacyPolicy');

beforeEach(async () => {
    await deleteDoc(doc(db, 'privacyPolicy', 'current'));
    privacy.forgetPrivacyPolicy();
});

test('without a policy there is nothing to accept', async () => {
    assert.equal(await privacy.getPrivacyPolicy(), null);
    assert.equal(await privacy.currentPrivacyVersion(), 0);
});

test('the first save is version 1, a changed text counts up, an unchanged one does not (#138)', async () => {
    const first = await privacy.savePrivacyPolicy('# Datenschutz\n\nErste Fassung', 'admin-1');
    assert.equal(first.version, 1);
    assert.equal(first.changed, true);

    const same = await privacy.savePrivacyPolicy('  # Datenschutz\n\nErste Fassung\n', 'admin-2');
    assert.equal(same.version, 1);
    assert.equal(same.changed, false);

    const second = await privacy.savePrivacyPolicy('# Datenschutz\n\nZweite Fassung', 'admin-2');
    assert.equal(second.version, 2);
    const policy = await privacy.getPrivacyPolicy();
    assert.equal(policy.markdown, '# Datenschutz\n\nZweite Fassung');
    assert.equal(policy.updatedBy, 'admin-2');
    assert.ok(Date.parse(policy.updatedAt));
    assert.equal(await privacy.currentPrivacyVersion(), 2);
});

test('an empty text removes the policy, a later one keeps counting up', async () => {
    await privacy.savePrivacyPolicy('Text', 'a');
    const removed = await privacy.savePrivacyPolicy('   ', 'a');
    assert.deepEqual(removed, { version: 0, changed: true });
    assert.equal(await privacy.getPrivacyPolicy(), null);
    assert.equal(await privacy.currentPrivacyVersion(), 0);

    privacy.forgetPrivacyPolicy();
    assert.equal((await privacy.savePrivacyPolicy('Neu', 'a')).version, 2);
});

test('texts longer than 50000 characters are refused', async () => {
    await assert.rejects(privacy.savePrivacyPolicy('x'.repeat(50001), 'a'), (err) => err.code === 'too_long');
    assert.equal(privacy.PRIVACY_MAX_LENGTH, 50000);
});

test('whether a member still has to accept', () => {
    assert.equal(privacy.needsConsent(0, undefined), false);
    assert.equal(privacy.needsConsent(1, undefined), true);
    assert.equal(privacy.needsConsent(3, 2), true);
    assert.equal(privacy.needsConsent(3, 3), false);
});
