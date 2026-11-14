const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

const tmpDir = createTempDir('ai-settings');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'ai-settings.sqlite');

const { db, doc, setDoc, getDoc, deleteDoc } = require('../firebaseAdmin');
const settings = require('../ai/settings');

beforeEach(async () => {
    await deleteDoc(doc(db, 'aiSettings', 'config'));
    await settings.loadAiSettings();
});

const rejects = async (input, error) => {
    await assert.rejects(() => settings.saveAiSettings(input), { status: 400, error });
};

test('an empty document gives the defaults', async () => {
    assert.deepEqual(await settings.loadAiSettings(), settings.DEFAULT_AI_SETTINGS);
    assert.equal(settings.DEFAULT_AI_SETTINGS.memberQuestionsPerHour, 20);
    assert.equal(settings.DEFAULT_AI_SETTINGS.dailyQuestionLimit, 500);
    assert.equal(settings.DEFAULT_AI_SETTINGS.assistantName, 'Event-Assistent');
});

test('a stored false switch stays false', async () => {
    await setDoc(doc(db, 'aiSettings', 'config'), { memberWeb: false });
    const loaded = await settings.loadAiSettings();
    assert.equal(loaded.memberWeb, false);
    assert.equal(loaded.memberDiscord, true);
    assert.equal(settings.getAiSettings().memberWeb, false);
});

test('saveAiSettings stores, refreshes the cache and keeps missing keys', async () => {
    await settings.saveAiSettings({ assistantName: 'Helfer', dailyQuestionLimit: 0 });
    const { settings: saved } = await settings.saveAiSettings({ memberWeb: false, bogus: 1 });
    assert.equal(saved.assistantName, 'Helfer');
    assert.equal(saved.dailyQuestionLimit, 0);
    assert.equal(saved.memberWeb, false);
    assert.equal('bogus' in saved, false);
    assert.deepEqual(settings.getAiSettings(), saved);
    const stored = (await getDoc(doc(db, 'aiSettings', 'config'))).data();
    assert.equal(stored.assistantName, 'Helfer');
    assert.equal('bogus' in stored, false);
});

test('validation rules answer with their sentence', async () => {
    await rejects({ memberWeb: 'yes' }, 'Die Schalter müssen „an“ oder „aus“ sein.');
    await rejects({ teaserText: '' }, 'Der Hinweistext darf höchstens 120 Zeichen lang sein.');
    await rejects({ teaserText: 'x'.repeat(121) }, 'Der Hinweistext darf höchstens 120 Zeichen lang sein.');
    await rejects({ assistantName: '' }, 'Der Name des Assistenten darf höchstens 40 Zeichen lang sein.');
    await rejects({ assistantName: 'x'.repeat(41) }, 'Der Name des Assistenten darf höchstens 40 Zeichen lang sein.');
    await rejects({ extraInstructions: 'x'.repeat(1001) }, 'Die Zusatzanweisungen dürfen höchstens 1000 Zeichen lang sein.');
    await rejects({ memberQuestionsPerHour: 0 }, 'Fragen pro Stunde: eine ganze Zahl von 1 bis 200.');
    await rejects({ memberQuestionsPerHour: 201 }, 'Fragen pro Stunde: eine ganze Zahl von 1 bis 200.');
    await rejects({ memberQuestionsPerHour: 2.5 }, 'Fragen pro Stunde: eine ganze Zahl von 1 bis 200.');
    await rejects({ dailyQuestionLimit: -1 }, 'Tageslimit: eine ganze Zahl von 0 bis 100000.');
    await rejects({ dailyQuestionLimit: '5' }, 'Tageslimit: eine ganze Zahl von 0 bis 100000.');
    await rejects({ dailyQuestionLimit: 100001 }, 'Tageslimit: eine ganze Zahl von 0 bis 100000.');
    const ok = await settings.saveAiSettings({ extraInstructions: 'x'.repeat(1000), dailyQuestionLimit: 100000, memberQuestionsPerHour: 200 });
    assert.equal(ok.settings.memberQuestionsPerHour, 200);
});

test('isFeatureOn is false while the AI is not configured', async () => {
    assert.equal(settings.isFeatureOn('memberWeb', {}), false);
    const env = { AI_PROVIDER: 'ollama', AI_MODEL: 'llama3' };
    assert.equal(settings.isFeatureOn('memberWeb', env), true);
    await settings.saveAiSettings({ memberWeb: false });
    assert.equal(settings.isFeatureOn('memberWeb', env), false);
    assert.equal(settings.isFeatureOn('adminAssistant', env), true);
});

test('publicAiInfo hides the teaser text when it or the feature is off', async () => {
    const prev = { p: process.env.AI_PROVIDER, m: process.env.AI_MODEL };
    process.env.AI_PROVIDER = 'ollama';
    process.env.AI_MODEL = 'llama3';
    try {
        assert.deepEqual(settings.publicAiInfo(), {
            memberAssistant: true, assistantName: 'Event-Assistent', teaserText: 'Fragen zum Event? Frag mich einfach.'
        });
        await settings.saveAiSettings({ teaserEnabled: false });
        assert.equal(settings.publicAiInfo().teaserText, '');
        await settings.saveAiSettings({ teaserEnabled: true, memberWeb: false });
        const info = settings.publicAiInfo();
        assert.equal(info.memberAssistant, false);
        assert.equal(info.teaserText, '');
    } finally {
        for (const [key, value] of [['AI_PROVIDER', prev.p], ['AI_MODEL', prev.m]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});
