const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('status-notification');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'status.sqlite');

const bot = require('../bot');
const { notifyStatusChange } = require('../utils/registrationService');
const { db, doc, setDoc } = require('../firebaseAdmin');

after(async () => {
    await bot.client.destroy();
});

/** Run fn and return everything the mock bot logged meanwhile as one string. */
async function logOf(t, fn) {
    const lines = [];
    const log = t.mock.method(console, 'log', (...args) => lines.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')));
    try {
        await fn();
    } finally {
        log.mock.restore();
    }
    return lines.join('\n');
}

const EVENT = { title: 'Raidnacht', assignRoleId: 'role-raid', customBotMessages: {} };
const SLOT_EVENT = { ...EVENT, slots: [{ id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 2 }] };
const registration = (userId) => ({ id: `reg-${userId}`, eventId: 'evt-1', userId, userName: `Name ${userId}` });

test('accepted: default text with the slot line and the event role', async (t) => {
    const out = await logOf(t, () => notifyStatusChange({ registration: registration('u-acc'), eventId: 'evt-1', event: SLOT_EVENT, status: 'accepted', slotId: 'tank' }));
    assert.match(out, /DM an .*u-acc/);
    assert.match(out, /Du wurdest für \*\*Raidnacht\*\* angenommen/);
    assert.match(out, /Dein Slot: \*\*🛡️ Tank\*\*/);
    assert.match(out, /Rolle .* vergeben/);
});

test('accepted: the custom template of the event wins', async (t) => {
    const event = { ...EVENT, customBotMessages: { accepted: 'Willkommen {user.name} bei {event.title}!' } };
    const out = await logOf(t, () => notifyStatusChange({ registration: registration('u-tpl'), eventId: 'evt-1', event, status: 'accepted' }));
    assert.match(out, /Willkommen Name u-tpl bei Raidnacht!/);
});

test('rejected: the rejected text, no role', async (t) => {
    const out = await logOf(t, () => notifyStatusChange({ registration: registration('u-rej'), eventId: 'evt-1', event: EVENT, status: 'rejected' }));
    assert.match(out, /Leider wurde deine Anfrage für \*\*Raidnacht\*\* abgelehnt/);
    assert.doesNotMatch(out, /Rolle .* vergeben/);
});

test('waitlisted: the waitlist DM, unless the member switched it off (W-16)', async (t) => {
    const on = await logOf(t, () => notifyStatusChange({ registration: registration('u-wait'), eventId: 'evt-1', event: EVENT, status: 'waitlisted' }));
    assert.match(on, /DM an .*u-wait/);
    assert.match(on, /auf die \*\*Warteliste\*\* gesetzt/);

    await setDoc(doc(db, 'users', 'u-quiet'), { id: 'u-quiet', notifications: { waitlist: false } });
    const off = await logOf(t, () => notifyStatusChange({ registration: registration('u-quiet'), eventId: 'evt-1', event: EVENT, status: 'waitlisted' }));
    assert.doesNotMatch(off, /DM an/);
});

test('a failing notification is logged and does not throw', async (t) => {
    const broken = { ...EVENT };
    Object.defineProperty(broken, 'customBotMessages', { get() { throw new Error('Discord down'); } });
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
    await notifyStatusChange({ registration: registration('u-err'), eventId: 'evt-1', event: broken, status: 'rejected' });
    assert.ok(errors.some(line => line.includes('Discord down')), errors.join('\n'));
});
