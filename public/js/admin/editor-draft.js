/**
 * Unsaved input of the event editor, kept in this browser so a reload does not
 * lose it. One entry for a new event and one per edited event. Holds only what
 * the wizard collects for saving (no check-in code, a banner only as its path).
 * Storage may be blocked or full: every function then answers as if nothing
 * were stored.
 */
const KEY_PREFIX = 'dems_event_draft_';
const WIZARD_STEPS = 5;

/**
 * Storage key of an editor.
 *
 * @param {string} [editId] -> Event id; empty for a new event.
 * @returns {string}
 */
export function draftKey(editId) {
    return KEY_PREFIX + (editId || 'new');
}

/**
 * Keep the current input.
 *
 * @param {string} editId -> Event id; empty for a new event.
 * @param {Object} entry
 * @param {Object} entry.draft -> Result of collectEventDraft().
 * @param {number} entry.step -> Wizard step that is shown.
 * @param {string} entry.baseUpdatedAt -> `updatedAt` of the event the input is based on; '' for a new event.
 * @returns {boolean} -> false when the browser refused to store it.
 */
export function storeDraft(editId, { draft, step, baseUpdatedAt }) {
    try {
        localStorage.setItem(draftKey(editId), JSON.stringify({ draft, step, baseUpdatedAt: baseUpdatedAt || '', savedAt: new Date().toISOString() }));
        return true;
    } catch {
        return false;
    }
}

/**
 * Read the kept input of an editor.
 *
 * @param {string} editId -> Event id; empty for a new event.
 * @returns {Object|null} -> `{ draft, step, baseUpdatedAt, savedAt }`, or null when nothing usable is stored.
 */
export function readDraft(editId) {
    let stored;
    try {
        stored = JSON.parse(localStorage.getItem(draftKey(editId)));
    } catch {
        return null;
    }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
    if (!stored.draft || typeof stored.draft !== 'object' || Array.isArray(stored.draft)) return null;
    if (!Number.isInteger(stored.step)) return null;
    return {
        draft: stored.draft,
        step: stored.step >= 1 && stored.step <= WIZARD_STEPS ? stored.step : 1,
        baseUpdatedAt: typeof stored.baseUpdatedAt === 'string' ? stored.baseUpdatedAt : '',
        savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : ''
    };
}

/**
 * Forget the kept input of an editor.
 *
 * @param {string} editId -> Event id; empty for a new event.
 * @returns {void}
 */
export function clearDraft(editId) {
    try {
        localStorage.removeItem(draftKey(editId));
    } catch {
        // Nothing was stored in a blocked storage
    }
}

/**
 * Whether the event was saved after the kept input was started.
 *
 * @param {Object} stored -> Result of readDraft().
 * @param {Object|null} [event] -> The event as loaded from the server; none for a new event.
 * @returns {boolean} -> true: the kept input would overwrite newer data.
 */
export function isDraftStale(stored, event) {
    if (!event) return false;
    return stored.baseUpdatedAt !== (event.updatedAt || '');
}

/**
 * Note for the editor's top bar.
 *
 * @param {string} iso -> `savedAt` of a kept input.
 * @returns {string} -> „Entwurf gesichert HH:MM" in local time; '' for an unreadable time.
 */
export function formatSavedAt(iso) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';
    const two = (value) => String(value).padStart(2, '0');
    return `Entwurf gesichert ${two(at.getHours())}:${two(at.getMinutes())}`;
}
