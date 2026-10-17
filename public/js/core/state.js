/**
 * Values that several modules read or write. One object, so a module changes
 * `state.currentUser` instead of reassigning an imported binding.
 */
export const state = {
    currentUser: null,
    cachedRoles: [],
    countdownTimers: [],
    csrfToken: '',
    descriptionEditor: null,
    startDatePicker: null,
    endDatePicker: null,
    serverName: 'DEMS', // Default, will be loaded from API
    serverIconUrl: null, // Icon of the Discord server for the login card
    selectedSlotId: null,
    selectedAltSlotIds: [],
    detailEventId: null,
    currentPoll: null,
    pendingPollDecision: null,
    botStatusRefreshInterval: null,
    selectedGuests: [] // [{id, displayName, avatar}]
};
