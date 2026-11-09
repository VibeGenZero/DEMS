/**
 * The privacy policy an installation publishes (#138): Markdown with a version
 * that counts up on every changed text, so members accept it again.
 *
 * One document `privacyPolicy/current`: `{ markdown, version, updatedAt, updatedBy }`.
 * An empty `markdown` means "no policy" (nothing to accept, no page); the
 * version is kept, so a later policy still counts as new for everyone. The
 * cached copy is exact because DEMS runs as one process.
 */
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');

const POLICY_DOC = ['privacyPolicy', 'current'];
const PRIVACY_MAX_LENGTH = 50000;

let cached;

/** Error of savePrivacyPolicy: `code` is `too_long`. */
class PrivacyPolicyError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

async function readStored() {
    if (cached !== undefined) return cached;
    const snap = await getDoc(doc(db, ...POLICY_DOC));
    cached = snap.exists() ? snap.data() : null;
    return cached;
}

/**
 * The published policy.
 *
 * @returns {Promise<{ markdown: string, version: number, updatedAt: string, updatedBy: string|null }|null>} -> null without a policy.
 */
async function getPrivacyPolicy() {
    const stored = await readStored();
    if (!stored || !stored.markdown) return null;
    return { markdown: stored.markdown, version: stored.version, updatedAt: stored.updatedAt, updatedBy: stored.updatedBy || null };
}

/**
 * Version members have to accept.
 *
 * @returns {Promise<number>} -> 0 without a policy.
 */
async function currentPrivacyVersion() {
    const policy = await getPrivacyPolicy();
    return policy ? policy.version : 0;
}

/**
 * Store a new text. A changed text gets the next version, the same text
 * (ignoring surrounding white space) keeps it, an empty text removes the policy.
 *
 * @param {string} markdown -> Policy text.
 * @param {string|null} by -> Admin id (or a setup marker).
 * @returns {Promise<{ version: number, changed: boolean }>} -> Version now in force (0 = none).
 * @throws {PrivacyPolicyError} -> `too_long` above PRIVACY_MAX_LENGTH characters.
 */
async function savePrivacyPolicy(markdown, by) {
    const text = typeof markdown === 'string' ? markdown.trim() : '';
    if (text.length > PRIVACY_MAX_LENGTH) throw new PrivacyPolicyError('too_long');

    const stored = await readStored();
    const lastVersion = (stored && stored.version) || 0;
    const current = (stored && stored.markdown) || '';
    if (text === current) return { version: current ? lastVersion : 0, changed: false };

    const next = {
        markdown: text,
        version: text ? lastVersion + 1 : lastVersion,
        updatedAt: new Date().toISOString(),
        updatedBy: by || null
    };
    await setDoc(doc(db, ...POLICY_DOC), next);
    cached = next;
    return { version: text ? next.version : 0, changed: true };
}

/**
 * Whether a member still has to accept the policy.
 *
 * @param {number} currentVersion -> currentPrivacyVersion().
 * @param {number|undefined} acceptedVersion -> Version the member accepted.
 * @returns {boolean}
 */
function needsConsent(currentVersion, acceptedVersion) {
    return currentVersion > 0 && !(Number.isInteger(acceptedVersion) && acceptedVersion >= currentVersion);
}

/** Drop the cache, so the next read goes to the database (tests). */
function forgetPrivacyPolicy() {
    cached = undefined;
}

module.exports = {
    PRIVACY_MAX_LENGTH,
    PrivacyPolicyError,
    getPrivacyPolicy,
    currentPrivacyVersion,
    savePrivacyPolicy,
    needsConsent,
    forgetPrivacyPolicy
};
