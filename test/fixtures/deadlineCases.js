/**
 * Shared cases for the deadline helpers (W-03): utils/eventListing.js and
 * its browser twin in public/js/events/cards.js must answer them alike.
 */
const NOW = new Date('2026-10-10T15:00:00.000Z');
const START = '2026-10-12T18:00:00.000Z';

// [description, event, registrationClosed, unregisterClosed]
const DEADLINE_CASES = [
    ['no deadline', { startDate: START }, false, false],
    ['empty deadlines', { startDate: START, registrationDeadline: '', unregisterDeadline: '' }, false, false],
    ['deadlines in the future', { startDate: START, registrationDeadline: '2026-10-11T18:00:00.000Z', unregisterDeadline: '2026-10-12T12:00:00.000Z' }, false, false],
    ['one minute before', { startDate: START, registrationDeadline: '2026-10-10T15:01:00.000Z', unregisterDeadline: '2026-10-10T15:01:00.000Z' }, false, false],
    ['exactly now', { startDate: START, registrationDeadline: NOW.toISOString(), unregisterDeadline: NOW.toISOString() }, true, true],
    ['deadlines passed', { startDate: START, registrationDeadline: '2026-10-09T18:00:00.000Z', unregisterDeadline: '2026-10-09T18:00:00.000Z' }, true, true],
    ['invalid deadline counts as none', { startDate: START, registrationDeadline: 'kaputt', unregisterDeadline: 'kaputt' }, false, false],
    ['over without deadline: registration closed, unregistering open', { startDate: '2026-10-03T19:00:00.000Z' }, true, false],
    ['space instead of T', { startDate: START, registrationDeadline: '2026-10-09 18:00', unregisterDeadline: '' }, true, false]
];

module.exports = { NOW, DEADLINE_CASES };
