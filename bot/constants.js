/**
 * Constants of the Discord bot: time zone, Discord length limits and the
 * custom ID prefixes of buttons, selects and modals.
 */
const { ChannelType } = require('discord.js');

const TIMEZONE = process.env.TIMEZONE || 'Europe/Berlin';

// Discord length limits for modal components
const MODAL_TITLE_MAX_LENGTH = 45;
const MODAL_LABEL_MAX_LENGTH = 45;
const MODAL_DESCRIPTION_MAX_LENGTH = 100;
const MODAL_PLACEHOLDER_MAX_LENGTH = 100;
const SELECT_OPTION_LABEL_MAX_LENGTH = 100;

// Values of the yes/no select that represents a checkbox field
const CHECKBOX_VALUE_YES = 'true';
const CHECKBOX_VALUE_NO = 'false';

// Channel types offered by a channel select field
const SELECTABLE_CHANNEL_TYPES = [
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum
];

// Custom ID prefixes for the event registration components
const REGISTER_BUTTON_PREFIX = 'event_register';
const REGISTER_MODAL_PREFIX = 'event_register_modal';
const MODAL_FIELD_PREFIX = 'field';
const SLOT_BUTTON_PREFIX = 'event_slot';
const SLOT_MODAL_PREFIX = 'event_slot_modal';
const SLOT_SWITCH_PREFIX = 'slot_switch';
const SLOT_LEAVE_PREFIX = 'slot_leave';
const ALT_SLOTS_FIELD_ID = 'alt_slots';
// Buttons of the /my-events overview (B-04)
const MY_LEAVE_PREFIX = 'my_leave';
const MY_LEAVE_CANCEL_PREFIX = 'my_leave_cancel';
const MY_SWITCH_PREFIX = 'my_switch';
// Decisions on approval requests in the approval channel (B-06)
const APPROVAL_ACCEPT_PREFIX = 'approval_accept';
const APPROVAL_REJECT_PREFIX = 'approval_reject';
const APPROVAL_WAITLIST_PREFIX = 'approval_waitlist';
// „Einchecken“ in the check-in invitation DM (B-07)
const CHECKIN_BUTTON_PREFIX = 'event_checkin';
// Admin commands (B-13): modals, draft buttons and „Korrigieren“
const ADMIN_EVENT_MODAL_PREFIX = 'admin_event_modal';
const ADMIN_POLL_MODAL_PREFIX = 'admin_poll_modal';
const ADMIN_EVENT_PUBLISH_PREFIX = 'admin_event_publish';
const ADMIN_EVENT_ACTIVATE_PREFIX = 'admin_event_activate';
const ADMIN_RETRY_PREFIX = 'admin_retry';
// „Platz annehmen“ / „Doch nicht“ in the waitlist offer DM (B-15)
const OFFER_CONFIRM_PREFIX = 'offer_confirm';
const OFFER_DECLINE_PREFIX = 'offer_decline';

// Names listed per slot in the announcement
const ROSTER_NAMES_MAX = 5;
const POLL_VOTE_PREFIX = 'poll_vote';
const POLL_YES_PREFIX = 'poll_yes';
const POLL_MAYBE_PREFIX = 'poll_maybe';
// Names listed per date in the poll message
const POLL_NAMES_MAX = 5;
const POLL_DESCRIPTION_MAX_LENGTH = 1000;

module.exports = {
    OFFER_CONFIRM_PREFIX,
    OFFER_DECLINE_PREFIX,
    ADMIN_EVENT_MODAL_PREFIX,
    ADMIN_POLL_MODAL_PREFIX,
    ADMIN_EVENT_PUBLISH_PREFIX,
    ADMIN_EVENT_ACTIVATE_PREFIX,
    ADMIN_RETRY_PREFIX,
    TIMEZONE,
    MODAL_TITLE_MAX_LENGTH,
    MODAL_LABEL_MAX_LENGTH,
    MODAL_DESCRIPTION_MAX_LENGTH,
    MODAL_PLACEHOLDER_MAX_LENGTH,
    SELECT_OPTION_LABEL_MAX_LENGTH,
    CHECKBOX_VALUE_YES,
    CHECKBOX_VALUE_NO,
    SELECTABLE_CHANNEL_TYPES,
    REGISTER_BUTTON_PREFIX,
    REGISTER_MODAL_PREFIX,
    MODAL_FIELD_PREFIX,
    SLOT_BUTTON_PREFIX,
    SLOT_MODAL_PREFIX,
    SLOT_SWITCH_PREFIX,
    SLOT_LEAVE_PREFIX,
    ALT_SLOTS_FIELD_ID,
    MY_LEAVE_PREFIX,
    MY_LEAVE_CANCEL_PREFIX,
    MY_SWITCH_PREFIX,
    APPROVAL_ACCEPT_PREFIX,
    APPROVAL_REJECT_PREFIX,
    APPROVAL_WAITLIST_PREFIX,
    CHECKIN_BUTTON_PREFIX,
    ROSTER_NAMES_MAX,
    POLL_VOTE_PREFIX,
    POLL_YES_PREFIX,
    POLL_MAYBE_PREFIX,
    POLL_NAMES_MAX,
    POLL_DESCRIPTION_MAX_LENGTH
};
