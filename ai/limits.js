'use strict';

/**
 * In-memory rate limits of the AI integration: per member (one question at a
 * time, N per sliding hour, a daily total for everyone) and per admin
 * (60 per sliding hour). DEMS runs as one process, so memory is exact; a
 * restart resets the hourly windows (the daily total lives in aiUsage).
 */
const { getAiSettings } = require('./settings');
const { questionsToday } = require('./usage');

const HOUR_MS = 60 * 60 * 1000;
const ADMIN_REQUESTS_PER_HOUR = 60;

const MEMBER_REFUSALS = Object.freeze({
    busy: 'Bitte warte, bis deine letzte Frage beantwortet ist.',
    hourly: 'Du hast das Fragenlimit für diese Stunde erreicht. Bitte versuche es später noch einmal.',
    daily: 'Der Event-Assistent hat sein Tageslimit erreicht. Morgen geht es weiter.'
});

const busyMembers = new Set();
const memberAsks = new Map();
const adminAsks = new Map();

/** Timestamps of a key that are still inside the sliding hour (drops the key when none are). */
function recent(map, key, nowMs) {
    const stamps = (map.get(key) || []).filter(stamp => stamp > nowMs - HOUR_MS);
    if (stamps.length) map.set(key, stamps); else map.delete(key);
    return stamps;
}

/**
 * Start a member question: refuses while the member's last one runs, above
 * the hourly limit and above the daily total. An accepted question marks the
 * member busy; the caller must call endMemberQuestion() in a `finally`.
 * Web and Discord share the counters through the user id.
 *
 * @param {string} userId
 * @param {Date} [now]
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'busy'|'hourly'|'daily' }>}
 */
async function beginMemberQuestion(userId, now = new Date()) {
    if (busyMembers.has(userId)) return { ok: false, reason: 'busy' };
    const nowMs = now.getTime();
    const { memberQuestionsPerHour, dailyQuestionLimit } = getAiSettings();
    const stamps = recent(memberAsks, userId, nowMs);
    if (stamps.length >= memberQuestionsPerHour) return { ok: false, reason: 'hourly' };

    busyMembers.add(userId); // before the first await, so a parallel request sees it
    try {
        if (dailyQuestionLimit > 0 && await questionsToday(now) >= dailyQuestionLimit) {
            busyMembers.delete(userId);
            return { ok: false, reason: 'daily' };
        }
    } catch (err) {
        busyMembers.delete(userId);
        throw err;
    }
    memberAsks.set(userId, [...recent(memberAsks, userId, nowMs), nowMs]);
    return { ok: true };
}

/** The member's question is over (answer, error or timeout). */
function endMemberQuestion(userId) {
    busyMembers.delete(userId);
}

/** Whether an admin may send another assistant request (60 per sliding hour); counts it when allowed. */
function allowAdminRequest(adminId, now = new Date()) {
    const nowMs = now.getTime();
    const stamps = recent(adminAsks, adminId, nowMs);
    if (stamps.length >= ADMIN_REQUESTS_PER_HOUR) return false;
    adminAsks.set(adminId, [...stamps, nowMs]);
    return true;
}

/** Forget all limiter state (tests). */
function resetLimits() {
    busyMembers.clear();
    memberAsks.clear();
    adminAsks.clear();
}

module.exports = { beginMemberQuestion, endMemberQuestion, allowAdminRequest, MEMBER_REFUSALS, resetLimits };
