/**
 * Router of the bot: hands every Discord interaction to the handler of its area.
 */
const { MessageFlags } = require('discord.js');
const { handleAutocomplete, handleChatCommand } = require('./commands');
const {
    REGISTER_BUTTON_PREFIX, REGISTER_MODAL_PREFIX, SLOT_BUTTON_PREFIX, SLOT_MODAL_PREFIX, SLOT_SWITCH_PREFIX,
    SLOT_LEAVE_PREFIX, POLL_VOTE_PREFIX, POLL_YES_PREFIX, POLL_MAYBE_PREFIX
} = require('./constants');
const {
    handleEventRegisterButton, handleEventRegisterModal, replyWithFailure, handleEventSlotButton,
    handleEventSlotModal, handleSlotSwitchButton, handleSlotLeaveButton
} = require('./registration');
const { handlePollVoteButton, handlePollVoteSelect } = require('./polls');
const { handleGuestButton } = require('./guests');
const { state } = require('./client');

/**
 * Route one interaction to its handler: autocomplete, modal submit, string
 * select, button (by custom ID prefix), then slash command.
 *
 * @param {Object} interaction -> Any discord.js interaction.
 */
async function handleInteraction(interaction) {
    // Handle autocomplete
    if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
        return;
    }

    // Handle the registration modal of an event announcement
    if (interaction.isModalSubmit()) {
        const [modalAction, modalEventId, modalSlotId] = interaction.customId.split(':');
        if (modalAction === SLOT_MODAL_PREFIX && modalEventId && modalSlotId) {
            try {
                await handleEventSlotModal(interaction, modalEventId, modalSlotId);
            } catch (err) {
                console.error('Event slot modal error:', err);
                await replyWithFailure(interaction);
            }
            return;
        }
        if (modalAction === REGISTER_MODAL_PREFIX && modalEventId) {
            try {
                await handleEventRegisterModal(interaction, modalEventId);
            } catch (err) {
                console.error('Event registration modal error:', err);
                const failureMessage = { content: '❌ Fehler bei der Anmeldung.', flags: MessageFlags.Ephemeral };
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ content: failureMessage.content });
                    } else {
                        await interaction.reply(failureMessage);
                    }
                } catch { /* interaction already expired */ }
            }
        }
        return;
    }

    // Handle guest invitation and event registration button interactions
    // Vote selects in the ephemeral answer of a poll
    if (interaction.isStringSelectMenu()) {
        const [selectAction, selectPollId] = interaction.customId.split(':');
        if ([POLL_YES_PREFIX, POLL_MAYBE_PREFIX].includes(selectAction) && selectPollId) {
            try {
                await handlePollVoteSelect(interaction, selectPollId, selectAction === POLL_YES_PREFIX ? 'yes' : 'maybe');
            } catch (err) {
                console.error('Poll vote select error:', err);
                await replyWithFailure(interaction, '❌ Fehler bei der Abstimmung.');
            }
        }
        return;
    }

    if (interaction.isButton()) {
        const [buttonAction, buttonEventId, buttonSlotId] = interaction.customId.split(':');
        if (buttonAction === POLL_VOTE_PREFIX && buttonEventId) {
            try {
                await handlePollVoteButton(interaction, buttonEventId);
            } catch (err) {
                console.error('Poll vote button error:', err);
                await replyWithFailure(interaction, '❌ Fehler bei der Abstimmung.');
            }
            return;
        }
        if ([SLOT_BUTTON_PREFIX, SLOT_SWITCH_PREFIX, SLOT_LEAVE_PREFIX].includes(buttonAction) && buttonEventId) {
            try {
                if (buttonAction === SLOT_BUTTON_PREFIX) {
                    await handleEventSlotButton(interaction, buttonEventId, buttonSlotId);
                } else if (buttonAction === SLOT_SWITCH_PREFIX) {
                    await handleSlotSwitchButton(interaction, buttonEventId, buttonSlotId);
                } else {
                    await handleSlotLeaveButton(interaction, buttonEventId);
                }
            } catch (err) {
                console.error('Slot button error:', err);
                await replyWithFailure(interaction);
            }
            return;
        }

        const [action, registrationId, guestId] = interaction.customId.split(':');

        if (action === REGISTER_BUTTON_PREFIX && registrationId) {
            // For this custom ID the second segment carries the event ID
            const eventId = registrationId;
            try {
                await handleEventRegisterButton(interaction, eventId);
            } catch (err) {
                console.error('Event registration button error:', err);
                const failureMessage = { content: '❌ Fehler bei der Anmeldung.', flags: MessageFlags.Ephemeral };
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ content: failureMessage.content });
                    } else {
                        await interaction.reply(failureMessage);
                    }
                } catch { /* interaction already expired */ }
            }
            return;
        }
        if ((action === 'guest_accept' || action === 'guest_decline') && registrationId && guestId) {
            await handleGuestButton(interaction, action, registrationId, guestId);
            return;
        }
    }

    if (!interaction.isChatInputCommand()) return;
    state.commandsProcessed++;

    await handleChatCommand(interaction);
}

module.exports = {
    handleInteraction
};
