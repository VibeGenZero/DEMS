'use strict';

/**
 * Behaviour settings of the AI integration (document `aiSettings/config`):
 * defaults merged with the stored keys, one cached copy for the process.
 * The cache is exact because DEMS runs as one process and every save goes
 * through saveAiSettings(). Database only, no provider calls.
 */
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const { isAiConfigured } = require('./client');

const DEFAULT_AI_SETTINGS = Object.freeze({
    memberWeb: true,
    memberDiscord: true,
    adminAssistant: true,
    teaserEnabled: true,
    teaserText: 'Fragen zum Event? Frag mich einfach.',
    assistantName: 'Event-Assistent',
    extraInstructions: '',
    memberQuestionsPerHour: 20,
    dailyQuestionLimit: 500
});

const SWITCHES = ['memberWeb', 'memberDiscord', 'adminAssistant', 'teaserEnabled'];
const FEATURES = ['memberWeb', 'memberDiscord', 'adminAssistant'];

const MESSAGES = Object.freeze({
    switches: 'Die Schalter müssen „an“ oder „aus“ sein.',
    teaserText: 'Der Hinweistext darf höchstens 120 Zeichen lang sein.',
    assistantName: 'Der Name des Assistenten darf höchstens 40 Zeichen lang sein.',
    extraInstructions: 'Die Zusatzanweisungen dürfen höchstens 1000 Zeichen lang sein.',
    memberQuestionsPerHour: 'Fragen pro Stunde: eine ganze Zahl von 1 bis 200.',
    dailyQuestionLimit: 'Tageslimit: eine ganze Zahl von 0 bis 100000.'
});

let cached = null;

const isText = (value, min, max) => typeof value === 'string' && value.length >= min && value.length <= max;
const isWhole = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/** Defaults merged with the stored keys; stored values of the wrong type fall back to the default. */
function normalizeAiSettings(raw) {
    const stored = raw && typeof raw === 'object' ? raw : {};
    const settings = { ...DEFAULT_AI_SETTINGS };
    for (const key of SWITCHES) if (typeof stored[key] === 'boolean') settings[key] = stored[key];
    if (isText(stored.teaserText, 1, 120)) settings.teaserText = stored.teaserText;
    if (isText(stored.assistantName, 1, 40)) settings.assistantName = stored.assistantName;
    if (isText(stored.extraInstructions, 0, 1000)) settings.extraInstructions = stored.extraInstructions;
    if (isWhole(stored.memberQuestionsPerHour, 1, 200)) settings.memberQuestionsPerHour = stored.memberQuestionsPerHour;
    if (isWhole(stored.dailyQuestionLimit, 0, 100000)) settings.dailyQuestionLimit = stored.dailyQuestionLimit;
    return settings;
}

/** Read the settings from the database into the cache. Falls back to the defaults on a read error. */
async function loadAiSettings() {
    try {
        const snap = await getDoc(doc(db, 'aiSettings', 'config'));
        cached = normalizeAiSettings(snap.exists() ? snap.data() : null);
    } catch (err) {
        console.error('KI-Einstellungen konnten nicht gelesen werden:', err.message);
        cached = normalizeAiSettings(null);
    }
    return cached;
}

/** The cached settings; the defaults before the first load. */
function getAiSettings() {
    return cached || normalizeAiSettings(null);
}

/** First rule violation of a partial input as a German sentence, or ''. */
function validationError(input) {
    for (const key of SWITCHES) if (key in input && typeof input[key] !== 'boolean') return MESSAGES.switches;
    if ('teaserText' in input && !isText(input.teaserText, 1, 120)) return MESSAGES.teaserText;
    if ('assistantName' in input && !isText(input.assistantName, 1, 40)) return MESSAGES.assistantName;
    if ('extraInstructions' in input && !isText(input.extraInstructions, 0, 1000)) return MESSAGES.extraInstructions;
    if ('memberQuestionsPerHour' in input && !isWhole(input.memberQuestionsPerHour, 1, 200)) return MESSAGES.memberQuestionsPerHour;
    if ('dailyQuestionLimit' in input && !isWhole(input.dailyQuestionLimit, 0, 100000)) return MESSAGES.dailyQuestionLimit;
    return '';
}

/**
 * Validate, store and cache settings. Keys missing from the input keep their
 * stored value; unknown keys are ignored.
 *
 * @param {Object} input -> Partial settings.
 * @returns {Promise<{ settings: Object }>}
 * @throws {{ status: 400, error: string }} -> A rule is violated.
 */
async function saveAiSettings(input) {
    const body = input && typeof input === 'object' ? input : {};
    const error = validationError(body);
    if (error) throw { status: 400, error };
    const current = cached || await loadAiSettings();
    const next = { ...current };
    for (const key of Object.keys(DEFAULT_AI_SETTINGS)) if (key in body) next[key] = body[key];
    await setDoc(doc(db, 'aiSettings', 'config'), { ...next, updatedAt: new Date().toISOString() });
    cached = next;
    return { settings: next };
}

/** Whether a feature switch is on and the AI is configured. */
function isFeatureOn(feature, env = process.env) {
    return FEATURES.includes(feature) && isAiConfigured(env) && getAiSettings()[feature] === true;
}

/** What the frontend may know without logging in as an admin. */
function publicAiInfo() {
    const settings = getAiSettings();
    const memberAssistant = isFeatureOn('memberWeb');
    return {
        memberAssistant,
        assistantName: settings.assistantName,
        teaserText: memberAssistant && settings.teaserEnabled ? settings.teaserText : ''
    };
}

module.exports = {
    DEFAULT_AI_SETTINGS, loadAiSettings, getAiSettings, saveAiSettings, isFeatureOn, publicAiInfo
};
